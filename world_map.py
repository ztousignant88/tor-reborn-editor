"""Editable overworld markers, road geometry and replayable battle events."""

import base64
import binascii
from functools import lru_cache
from hashlib import sha256
from io import BytesIO
import json
import struct
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import battle_encounters as encounters
from art_registry import WORLD_EVENT_CAPACITY, WORLD_EVENT_SITE_COUNT
from art_pixels import read_overlay
from local_game_art import rebuild_texture
from tools.menu_mods.compiler import class_text
from tools.menu_mods.compiler.tor_formats import Xlce, u16
from versus import MAPS


KEY = 'worldMap'
EXPANSION = 'worldEventExpansion'
LEGACY_SLOTS = {'south': None, 'east': 'finalShowdown', 'west': 'walkingDead'}
SLOTS = LEGACY_SLOTS | {f'event-{i:02d}': None for i in range(4, WORLD_EVENT_SITE_COUNT + 1)}
SOUTHERN_SITE = {'node': 47, 'road': 49, 'marker': 46, 'markerSource': 19,
                 'stage': 178, 'chapterOneScene': 463, 'scene': 727, 'roster': 538,
                 'path': encounters.ROSTERS[2], 'position': [0.36, 1.59]}
ARENAS = {ident: (name, path, roster) for ident, name, path, roster in MAPS if ident != 67}
# Normal battle-stage rows for the same map and roster as each arena.
ARENA_STAGES = {264: 241, 81: 103, 79: 62, 69: 37, 12: 5, 17: 51, 20: 55, 24: 115, 82: 200}
LANGUAGES = encounters.MAP_NAME_LANGUAGES
TEXT_PREFIX = encounters.STRONGHOLD
BANNER_SIZE = (2048, 256)
# Use each topic's dedicated read bit. The numeric suffix identifies its stock Talk row.
WARREN_REPORT_TOPICS = {
    'phorampa-report': (0x0783, 'Phorampa Open to Hunting'),
    'warren-talk-68': (0x0848, 'Ravness Loxaerion Captured'),
    'warren-talk-138': (0x084B, "Punkin's Peddlin' Patch"),
    'warren-talk-139': (0x084C, 'Fortresses Under Siege'),
    'warren-talk-140': (0x084D, 'Galgastani Sighted at Lhazan'),
    'warren-talk-151': (0x084E, 'Lord of Coritanae Missing'),
    'warren-talk-156': (0x084F, 'San Bronsa Ruins Discovered'),
    'warren-talk-158': (0x0850, "Iuria's Requiem"),
    'warren-talk-161': (0x0851, "Deneb's Emporium"),
    'warren-talk-167': (0x0852, 'Mysterious Blast on Exeter'),
    'warren-talk-171': (0x0853, 'Rhamsen Wreck Raised'),
    'warren-talk-174': (0x0854, 'Traitor in the Resistance?'),
    'warren-talk-175': (0x0855, 'The Songstress of Omish'),
    'warren-talk-176': (0x0856, 'Pirates of Qadriga Fortress'),
    'warren-talk-177': (0x0857, 'The Bandits of Neimrahava'),
    'warren-talk-178': (0x0858, 'Port Omish, Den of Thieves'),
    'warren-talk-179': (0x0859, "The Pirate's Graveyard (first entry)"),
    'warren-talk-180': (0x085A, 'The Dread Pirate'),
    'warren-talk-182': (0x085B, 'The Ancient Temples'),
    'warren-talk-185': (0x085C, 'A Rift in the Dark Knights'),
    'warren-talk-186': (0x085D, 'The Balmamusa Dead'),
    'warren-talk-187': (0x085E, "Iuria's Secret"),
    'warren-talk-188': (0x085F, 'The King of Brigantys'),
    'warren-talk-189': (0x0860, 'Rising From the Ashes'),
    'warren-talk-190': (0x0861, 'A Monument to Peace'),
}
# These flags are set by the stock victory, chapter-end, or report read tasks.
MILESTONES = {
    'almorica-victory': (0x049D, 'After winning at Almorica Castle in Chapter 1'),
    'tynemouth-victory': (0x049E, 'After winning at Tynemouth Hill in Chapter 1'),
    'chapter-1': (0x0486, 'After clearing Chapter 1'),
    'chapter-2-chaos': (0x0487, 'After clearing Chapter 2 (Chaos)'),
    'chapter-2-law': (0x0488, 'After clearing Chapter 2 (Law)'),
    'chapter-3-neutral': (0x048A, 'After clearing Chapter 3 (Neutral)'),
    'chapter-3-chaos': (0x048B, 'After clearing Chapter 3 (Chaos)'),
    'chapter-3-law': (0x048C, 'After clearing Chapter 3 (Law)'),
    'chapter-4': (0x048F, 'After clearing Chapter 4'),
    'epilogue': (0x049A, 'After completing the Epilogue'),
    **{key: (flag, f'After reading {name}') for key, (flag, name) in WARREN_REPORT_TOPICS.items()},
}
MAP_IDS = {slot: (f'bg990_{i + 1:02d}_c0_t00', 320 + i, 1394 + i, i)
           for i, slot in enumerate(SLOTS)}
# These directions are empty for the named stock strongpoints. Additional sites
# extend one of these branches when its first site is in use.
BRANCHES = (
    (18, 1), (13, 2), (9, 0), (10, 2), (5, 2), (7, 0), (7, 1), (6, 0),
    (6, 2), (1, 0), (1, 2), (43, 0), (43, 3), (39, 1), (39, 2), (44, 0),
    (3, 0), (14, 0), (22, 0), (22, 1), (48, 0), (27, 0), (27, 2), (31, 1),
    (49, 0), (34, 0), (35, 3), (36, 1), (36, 3),
)
FREE_STAGES = (*range(179, 198), 250, *range(308, 320), 486, 488, 489, 539, 555, 556)
assert len(FREE_STAGES) == WORLD_EVENT_SITE_COUNT - len(LEGACY_SLOTS)
assert len(BRANCHES) <= len(FREE_STAGES) <= 2 * len(BRANCHES)
BRANCH_OFFSETS = ((0, -.38), (0, .38), (-.43, 0), (.43, 0))


def title(value, length=42):
    if (not isinstance(value, str) or not value.strip() or len(value.strip()) > length
            or any(not c.isprintable() for c in value)):
        raise ValueError(f'Use 1–{length} printable characters for the title.')
    return value.strip()


def position(value):
    if (not isinstance(value, list) or len(value) != 2 or
            not all(type(x) in (int, float) and -bound <= x <= bound for x, bound in zip(value, (8, 4.5)))):
        raise ValueError('Choose a location within the map bounds.')
    return value


def art(value):
    if not isinstance(value, str) or not 24 <= len(value) <= 180000:
        raise ValueError('The location title needs its generated banner.')
    try:
        if not base64.b64decode(value, validate=True).startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('The location title banner is not a PNG.')
    except binascii.Error as exc:
        raise ValueError('The location title banner is invalid.') from exc
    return value


def unlock_condition(value):
    if isinstance(value, dict) and value.keys() == {'kind', 'id'}:
        kind, ident = value['kind'], value['id']
        if kind == 'location' and type(ident) is int and 1 <= ident <= 50:
            return {'kind': kind, 'id': ident}
        if kind == 'milestone' and isinstance(ident, str) and ident in MILESTONES:
            return {'kind': kind, 'id': ident}
    raise ValueError('Choose a known event unlock condition.')


def edits(value):
    if value is None:
        return {'locations': {}, 'events': {}}
    if not isinstance(value, dict) or set(value) != {'locations', 'events'}:
        raise ValueError('Invalid world map changes.')
    locations, events = value['locations'], value['events']
    if (not isinstance(locations, dict) or not isinstance(events, dict) or
            len(locations) > 50 or len(events) > WORLD_EVENT_CAPACITY or any(key not in SLOTS for key in events)):
        raise ValueError('Invalid world map locations or events.')
    clean = {'locations': {}, 'events': {}}
    for key, settings in locations.items():
        if (not isinstance(key, str) or not key.isascii() or not key.isdecimal()
                or not 1 <= int(key) <= 50 or key != str(int(key))
                or not isinstance(settings, dict) or settings.keys() - {'position', 'title', 'art'}):
            raise ValueError('Invalid world map location.')
        row = {}
        if 'position' in settings:
            row['position'] = position(settings['position'])
        if 'title' in settings or 'art' in settings:
            row.update(title=title(settings.get('title')), art=art(settings.get('art')))
        if row:
            clean['locations'][key] = row
    for key, settings in events.items():
        if not isinstance(settings, dict) or settings.keys() - {'position', 'title', 'art', 'arena', 'players', 'markerSource', 'unlock'}:
            raise ValueError('Invalid world map battle.')
        arena, players = settings.get('arena'), settings.get('players')
        if type(arena) is not int or arena not in ARENAS or type(players) is not int or not 1 <= players <= 12:
            raise ValueError('Choose a battlefield and 1–12 deployment slots.')
        clean['events'][key] = dict(title=title(settings.get('title')), art=art(settings.get('art')),
                                    position=position(settings.get('position')), arena=arena, players=players)
        if 'unlock' in settings:
            clean['events'][key]['unlock'] = unlock_condition(settings['unlock'])
        if 'markerSource' in settings:
            source = settings['markerSource']
            if type(source) is not int or not 1 <= source <= 50:
                raise ValueError('Choose a location whose marker the battle should use.')
            clean['events'][key]['markerSource'] = source
    return clean


def revision(value, mod_settings):
    digest = {'map': value, 'slots': [k for k in encounters.FIGHTS if mod_settings.get(k)],
              'expansion': bool(mod_settings.get(EXPANSION))}
    return sha256(json.dumps(digest, sort_keys=True).encode()).hexdigest()


def requires_expansion(editor):
    saved = editor.get(KEY)
    events = saved.get('events') if isinstance(saved, dict) else None
    return isinstance(events, dict) and bool(events.keys() - LEGACY_SLOTS.keys())


def validate_expansion(saved, value):
    if saved['events'].keys() - LEGACY_SLOTS.keys() and not value.get(EXPANSION):
        raise ValueError('World Map Event Expansion is required while the project uses expanded event slots.')


def custom(value, editor):
    saved = edits(editor.get(KEY))
    validate_expansion(saved, value)
    result = {}
    for slot in saved['events']:
        recipe_key = SLOTS[slot]
        if value.get(recipe_key):
            raise ValueError(f"The {slot} location is in use by {encounters.recipes()[recipe_key]['title']}.")
    for slot, recipe_key in SLOTS.items():
        if slot not in saved['events']:
            continue
        item = saved['events'][slot]
        _, source_map, donor = ARENAS[item['arena']]
        map_file, map_number, map_archive, scene_slot = MAP_IDS[slot]
        recipe = slot_recipe(slot, saved['events'])
        result['world-' + slot] = recipe | {
            'title': item['title'], 'description': 'A replayable battle.',
            'position': item['position'], 'sourceMap': source_map, 'sourceMapNumber': item['arena'], 'mapFile': map_file,
            'mapNumber': map_number, 'mapArchiveId': map_archive, 'sceneSlot': scene_slot,
            'sourceStage': ARENA_STAGES[item['arena']],
            'players': item['players'], 'source': donor, 'art': item['art'],
            'markerSource': item.get('markerSource', recipe['markerSource']),
        }
        if unlock := item.get('unlock'):
            if unlock['kind'] == 'location':
                result['world-' + slot]['unlockSource'] = unlock['id']
            else:
                result['world-' + slot]['unlockFlag'] = MILESTONES[unlock['id']][0]
    return result


def slot_recipe(slot, active):
    if slot in LEGACY_SLOTS:
        builtin = LEGACY_SLOTS[slot]
        return encounters.recipes()[builtin] if builtin else SOUTHERN_SITE
    offset = MAP_IDS[slot][3] - len(LEGACY_SLOTS)
    branch = offset % len(BRANCHES)
    anchor, direction = BRANCHES[branch]
    recipe = {'node': 51 + offset, 'nameId': 372 + offset, 'road': 62 + offset,
              'stage': FREE_STAGES[offset], 'chapterOneScene': 728 + offset, 'scene': 728 + offset,
              'roster': 567 + offset, 'path': encounters.ROSTERS[len(LEGACY_SLOTS) + offset],
              'anchor': anchor, 'roadFrom': anchor, 'direction': direction, 'markerSource': anchor}
    if offset != branch:
        parent = f'event-{branch + len(LEGACY_SLOTS) + 1:02d}'
        recipe['parentSlot'] = parent
        if parent in active:
            recipe['roadFrom'] = 51 + branch
    return recipe


def asset_paths(fights):
    return {path for fight in fights.values() for path in (
        encounters.map_path(fight),
        *(encounters.scene_path(fight, directory) for directory in encounters.SCENE_DIRECTORY_PREFIXES),
    )}


def active(meta):
    value = edits(meta.get('editor', {}).get(KEY))
    return bool(value['locations'] or value['events'])


def name_path(node, language):
    return f'menu/mapname/{language}/STRONGHOLD_{node:03d}.dat'


def owned_paths(value, editor):
    saved = edits(editor.get(KEY))
    paths = encounters.owned_paths(value, custom(value, editor))
    if any('position' in row for row in saved['locations'].values()):
        paths.add(encounters.WORLD)
    renamed = [int(node) for node, row in saved['locations'].items() if 'title' in row]
    for language in LANGUAGES if renamed else ():
        paths.update(name_path(node, language) for node in renamed)
        paths.add(f'localize/LocalizeText_{language}.dat')
    return paths


def map_tables(read):
    _, system = encounters.archive(read(encounters.SYSTEM))
    _, world = encounters.archive(read(encounters.WORLD))
    nodes, links = (Xlce(system.entry(i)) for i in (2, 3))
    points, roads = (Xlce(world.entry(i)) for i in (23, 24))
    if (nodes.row_size, links.row_size, points.row_size, roads.row_size) != (16, 6, 12, 108):
        raise ValueError('This world map uses an unsupported location or road layout.')
    if nodes.count != points.count or links.count != roads.count:
        raise ValueError('The world map tables disagree on their location or road counts.')
    return nodes, links, points, roads


def view(read, value, editor, edited_routes=None):
    nodes, links, points, roads = map_tables(read)
    edited_nodes = Xlce(encounters.archive(edited_routes)[1].entry(2)) if edited_routes else None
    names = class_text.read_archive(read('localize/LocalizeText_en-us.dat'))
    locations, connections = [], []
    for node in range(1, nodes.count):
        fields, point = nodes.row(node), points.row(node)
        if not u16(fields, 0):
            continue
        coords = list(struct.unpack_from('<ff', point, 4))
        key = f'{TEXT_PREFIX}{node:03d}_NAME'
        label = class_text.display(names[key]).replace('\n', ' ') if key in names else f'Location {node}'
        locations.append({'id': node, 'name': label, 'position': coords,
                          'marker': u16(point, 2), 'rename': key in names})
    for i in range(1, roads.count):
        a, b = struct.unpack_from('<HH', roads.row(i))
        if a and b and (a, b) == tuple(links.row(i)[1:3]):
            connections.append({'id': i, 'from': a, 'to': b, 'points': route_points(roads.row(i))})
    slots = []
    saved = edits(editor.get(KEY))
    stock_flags = {location['id']: u16(nodes.row(location['id']), 10) for location in locations}
    for key, builtin in SLOTS.items():
        recipe = slot_recipe(key, saved['events'])
        anchor = recipe.get('anchor', encounters.TYNEMOUTH)
        unlock_flag = stock_flags.get(anchor, anchor) if 'anchor' in recipe else encounters.TYNEMOUTH
        slot = {'key': key, 'node': recipe['node'], 'anchor': anchor, 'roster': recipe['path'],
                'unlockLocation': anchor, 'unlockFlag': unlock_flag,
                'map': MAP_IDS[key][0],
                'scenes': {chapter: encounters.scene_path(recipe, directory).rsplit('/', 1)[-1][:-4]
                           for directory, chapter in encounters.SCENE_DIRECTORY_PREFIXES.items()},
                'builtIn': recipe['title'] if value.get(builtin) else None}
        if edited_nodes and (key in saved['events'] or slot['builtIn']):
            row = edited_nodes.row(recipe['node'])
            actual_flag = u16(row, 10)
            if actual_flag != unlock_flag:
                matching = [ident for ident, flag in stock_flags.items() if flag == actual_flag]
                slot['unlockLocation'] = actual_flag if actual_flag in matching else matching[0] if len(matching) == 1 else None
                slot['unlockFlag'] = actual_flag
            road_source = recipe.get('roadFrom', encounters.TYNEMOUTH)
            if row[5] != road_source:
                slot['roadSource'] = row[5]
        if 'anchor' in recipe:
            at = struct.unpack_from('<ff', points.row(anchor), 4)
            multiplier = 2 if 'parentSlot' in recipe else 1
            slot['position'] = [round(value + delta * multiplier, 3)
                                for value, delta in zip(at, BRANCH_OFFSETS[recipe['direction']])]
            if 'parentSlot' in recipe:
                slot['parentSlot'] = recipe['parentSlot']
        else:
            slot['position'] = recipe['position']
            slot['legacy'] = True
        slots.append(slot)
    return {'locations': locations, 'roads': connections, 'slots': slots,
            'unlockLocations': [location['id'] for location in locations if stock_flags[location['id']]],
            'unlockMilestones': [{'id': key, 'flag': flag, 'label': label, 'report': key in WARREN_REPORT_TOPICS}
                                 for key, (flag, label) in MILESTONES.items()],
            'arenas': [{'id': ident, 'name': data[0]} for ident, data in ARENAS.items()],
            'saved': saved, 'eventCapacity': WORLD_EVENT_CAPACITY,
            'baseEventCapacity': sum(slot.get('legacy', False) and not slot['builtIn'] for slot in slots),
            'eventExpansionEnabled': bool(value.get(EXPANSION)),
            'eventExpansionRequired': requires_expansion(editor),
            'limit': encounters.CAPACITY if value.get(encounters.KEY) else encounters.STOCK_CAPACITY}


def route_points(row):
    count = row[103]
    if not 2 <= count <= 10:
        raise ValueError('This road has an unsupported geometry layout.')
    return [list(p) for p in zip(struct.unpack_from(f'<{count}f', row, 12),
                                 struct.unpack_from(f'<{count}f', row, 52))]


def move_locations(data, moves):
    dat, pak = encounters.archive(data)
    points, roads = (Xlce(pak.entry(i)) for i in (23, 24))
    positions, routes, delta = {}, {}, {}
    for node, coords in moves.items():
        row = points.row(node)
        before = struct.unpack_from('<ff', row, 4)
        positions[node] = row[:4] + struct.pack('<ff', *coords)
        delta[node] = tuple(a - b for a, b in zip(coords, before))
    for i in range(1, roads.count):
        row = roads.row(i)
        a, b = struct.unpack_from('<HH', row)
        if a not in delta and b not in delta:
            continue
        first, last = delta.get(a, (0, 0)), delta.get(b, (0, 0))
        points_in_road = route_points(row)
        changed = bytearray(row)
        for index, point in enumerate(points_in_road):
            t = index / (len(points_in_road) - 1)
            for axis, base in enumerate((12, 52)):
                value = point[axis] + first[axis] * (1 - t) + last[axis] * t
                struct.pack_into('<f', changed, base + index * 4, value)
        routes[i] = changed
    return encounters.replace(dat, pak, {23: points.replace(positions), 24: roads.replace(routes)})


def banner_image(png):
    return read_overlay(base64.b64decode(png, validate=True), BANNER_SIZE)


@lru_cache(maxsize=64)
def banner(node, png):
    image = banner_image(png)
    template = (encounters.ROOT / 'finalShowdown-banner.dat').read_bytes()
    with ZipFile(BytesIO(encounters._crypt.decrypt(template))) as source:
        member, = source.namelist()
        texture = source.read(member)
    name = f'STRONGHOLD_{node:03d}'
    output = BytesIO()
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo(name + '.img'), rebuild_texture(texture, name, image), compress_type=ZIP_DEFLATED)
    return bytes(encounters._crypt.encrypt(output.getvalue()))


def banner_files(read, value, editor, only=None):
    """Native title textures are large to encode. Build only the paths a caller needs."""
    result = {}
    for key, fight in encounters.selected(value, custom(value, editor)).items():
        paths = [encounters.banner_path(fight, language) for language in LANGUAGES]
        if only is not None:
            paths = [path for path in paths if path == only]
        if paths:
            data = (banner(fight.get('nameId', fight['node']), fight['art']) if 'art' in fight
                    else (encounters.ROOT / f'{key}-banner.dat').read_bytes())
            result.update(dict.fromkeys(paths, data))
    for node, row in edits(editor.get(KEY))['locations'].items():
        if 'title' not in row:
            continue
        for language in LANGUAGES:
            path = name_path(int(node), language)
            if only is not None and path != only:
                continue
            try:
                read(path)
            except FileNotFoundError:
                continue  # Some locations have text only.
            result[path] = banner(int(node), row['art'])
    return result


def build(read, value, editor, assets=None, editor_view=False):
    saved = edits(editor.get(KEY))
    limit = encounters.CAPACITY if value.get(encounters.KEY) else encounters.STOCK_CAPACITY
    result = encounters.build(read, value, editor, custom(value, editor), limit, assets, editor_view)
    if not editor_view:
        result.update(banner_files(read, value, editor))
    if not saved['locations']:
        return result
    nodes, _, _, _ = map_tables(read)
    moves = {}
    renamed = {}
    built_in_nodes = {fight['node']: key for key, fight in encounters.recipes().items()}
    for key, row in saved['locations'].items():
        node = int(key)
        if node in built_in_nodes:
            if 'title' in row:
                raise ValueError('Change a Hard Mode encounter’s position in World Map.')
            if value.get(built_in_nodes[node]):
                moves[node] = row['position']
            continue
        if node >= nodes.count or not u16(nodes.row(node), 0):
            raise ValueError(f'World map location {node} is missing.')
        if 'position' in row:
            moves[node] = row['position']
        if 'title' in row:
            renamed[node] = row
    if moves:
        world = result[encounters.WORLD] if encounters.WORLD in result else read(encounters.WORLD)
        result[encounters.WORLD] = move_locations(world, moves)
    for language in LANGUAGES if renamed else ():
        rel = f'localize/LocalizeText_{language}.dat'
        source = result[rel] if rel in result else read(rel)
        current = class_text.read_archive(source)
        text = {}
        for node, row in renamed.items():
            native = f'{TEXT_PREFIX}{node:03d}_NAME'
            if native not in current:
                raise ValueError(f'The installed game is missing the name of location {node}.')
            label = row['title'].encode('utf-8')
            text[native] = text[native + '_2LINES'] = label
        result[rel] = class_text.patch_archive(source, text, TEXT_PREFIX)
    return result

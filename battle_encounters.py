"""Build the two optional Hard Mode encounters from the selected game's data."""

from functools import lru_cache
from io import BytesIO
import json
from pathlib import Path
import struct
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from ai_choices_data import rebuild_pakd
from art_registry import MAP_NAME_LANGUAGES, SCENE_DIRECTORY_PREFIXES, WORLD_EVENT_SITE_COUNT
from tools.menu_mods.compiler import class_text
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd, Xlce, _crypt, u16, u32


ROOT = Path(__file__).resolve().parent / 'tools/battle_encounters'
STEAM_HASH = 'da6504e9079ca6901569cb0fa4d0bc6eac72f6769996a8146e8be6581d9650dc'
STOCK_CAPACITY, CAPACITY, PLAYERS = 30, 62, 12
KEY = 'expandedBattleLimit'
FIGHTS = ('finalShowdown', 'walkingDead')
OPTIONS = (KEY, *FIGHTS)
BATTLE, SYSTEM, WORLD = 'battle/battle_data_release.dat', 'system/system_data.dat', 'worldmap/Worldmap.dat'
TYNEMOUTH, PHORAMPA = 19, 37
CHAPTERS = ('1', '2a', '2b', '3a', '3b', '3c', '4', 'ep', 'dlc')
# Keep authored scene IDs stable when other encounters or story steps are added.
# The first twelve IDs preserve the three legacy arenas. Later arenas each
# get a separate block for the opening, arrival, formation and continuation.
CUSTOM_SCENE_BASES = (240, 3296, 6176, 9312, 12224, 15280, 22000, 24176, 27264)
MAP, MAP_FILE = 264, 'bg300_50_c0_t00'
MARKER_SIZES = {0: 128, 1: 32, 20: 128, 21: 32, 22: 128}
RESERVED_POINTS = {
    45: bytes.fromhex('0000ff000000000000000000'), 47: bytes.fromhex('0000ff000000000000000000'),
    50: bytes.fromhex('000031009eef6f40e3a5dbbe'),
}
STRONGHOLD = 'STRONGHOLD_LC_STRONGHOLD_'
EMPTY_SCENE = b'pakd\0\0\0\0\x10\0\0\0\0\0\0\0'
ROSTERS = tuple(f'battle/entry/entry_unit_{i}.dat' for i in range(2000, 2000 + WORLD_EVENT_SITE_COUNT))
ROSTER_EDITS = 'battleEncounterRosters'


def recipes():
    return json.loads((ROOT / 'encounters.json').read_bytes())


def selected(value, custom=None):
    return {key: recipes()[key] for key in FIGHTS if value.get(key)} | (custom or {})


def scene_id(fight, directory):
    return fight['chapterOneScene'] if directory == 901 else fight['scene']


def scene_path(fight, directory):
    return f'event/scene/{SCENE_DIRECTORY_PREFIXES[directory]}_ST_{scene_id(fight, directory):03d}.dat'


def custom_scene_resource(fight, directory):
    slot = fight['sceneSlot']
    return CUSTOM_SCENE_BASES[directory - 901] + (slot if slot < 3 else 12 * (slot - 2))


def banner_path(fight, language):
    return f"menu/mapname/{language}/STRONGHOLD_{fight.get('nameId', fight['node']):03d}.dat"


def registrations(value, custom=None):
    result = []
    for fight in selected(value, custom).values():
        result.append({'directory': 1001, 'id': fight['roster'], 'path': fight['path']})
        if 'mapArchiveId' in fight:
            result.append({'directory': 100, 'id': fight['mapArchiveId'], 'path': map_path(fight)})
        result.extend({'directory': directory, 'id': scene_id(fight, directory), 'path': scene_path(fight, directory)}
                      for directory in SCENE_DIRECTORY_PREFIXES)
        result.extend({'directory': 500, 'id': 50000 + fight.get('nameId', fight['node']) * len(MAP_NAME_LANGUAGES) + i,
                       'path': banner_path(fight, language)} for i, language in enumerate(MAP_NAME_LANGUAGES))
    return result


def owned_paths(value, custom=None):
    entries = registrations(value, custom)
    if not entries:
        return set()
    return ({entry['path'] for entry in entries} | {BATTLE, SYSTEM, WORLD}
            | {f'event/chapter/chapter_{suffix}.dat' for suffix in CHAPTERS}
            | {f'localize/LocalizeText_{language}.dat' for language in MAP_NAME_LANGUAGES})


def validate_battle_limit(data, limit=CAPACITY):
    _, pack = archive(data)
    stages = Xlce(pack.entry(17))
    for index in range(stages.count):
        stage = stages.row(index)
        total = sum(stage[0x10:0x13])
        if total > limit:
            hint = ' Enable Expanded Battle Limit or reduce the roster.' if limit == STOCK_CAPACITY else ''
            raise ValueError(f'Battle {index} needs {total} slots including deployment and guests. The limit is {limit}.{hint}')


def preview_path(path):
    return (path in (SYSTEM, WORLD, *ROSTERS) or path.startswith(('event/chapter/chapter_', 'event/scene/', 'menu/mapname/', 'bg/bg990_')))


def map_path(fight):
    return f"bg/{fight['mapFile']}.dat"


def links(value, custom=None):
    result = []
    for fight in selected(value, custom).values():
        for directory in SCENE_DIRECTORY_PREFIXES:
            result.append({'roster': fight['path'].split('/')[-1][:-4], 'title': fight['title'],
                           'map': fight.get('mapFile', MAP_FILE), 'mapNumber': fight.get('mapNumber', MAP),
                           'place': fight['node'], 'stage': fight['stage'],
                           'scene': scene_path(fight, directory).split('/')[-1][:-4], 'custom': 'sourceMap' in fight,
                           'chapter': SCENE_DIRECTORY_PREFIXES[directory], 'storyStage': scene_id(fight, directory)})
    return result


def aligned(data, alignment=16):
    return data + bytes(-len(data) % alignment)


def archive(data):
    dat = DatArchive.read(data)
    return dat, Pakd(dat.pack)


def replace(dat, pack, changes):
    return dat.rebuild(rebuild_pakd(pack, changes))


def extend_rows(table, changes, empty=None):
    existing = {i: row for i, row in changes.items() if i < table.count}
    end = table.header + table.count * table.row_size
    data = bytearray(table.replace(existing)[:end])
    count = max(table.count, max(changes, default=-1) + 1)
    if any(table.data[end:]):
        raise ValueError('Unsupported auxiliary data in world-map table')
    empty = bytes(table.row_size) if empty is None else empty
    for i in range(table.count, count):
        data.extend(changes.get(i, empty))
    struct.pack_into('<I', data, 4, count)
    return aligned(bytes(data))


def connect_cursor(nav, source, target, direction):
    start = next((i for i, row in enumerate(nav) if row[0] == source), None)
    if start is not None:
        for i in range(start, len(nav)):
            row = nav[i]
            if i != start and row[0]:
                break
            if row[3] == direction and row[1] == 0:
                connection = bytes((row[0], target, target, direction, 1))
                if row[2]:
                    nav[i:i + 1] = [connection, b'\0' + row[1:]]
                else:
                    nav[i] = connection
                return
    raise ValueError(f'World map location {source} has no free cursor connection in direction {direction}.')


def patch_battle(data, fights, counts):
    dat, pak = archive(data)
    stages = Xlce(pak.entry(17))
    if stages.row_size != 230:
        raise ValueError('Unsupported battle stage layout for Hard Mode encounters')
    changes = {}
    for fight in fights:
        stage = fight['stage']
        if any(stages.row(stage)):
            raise ValueError(f"{fight['title']} needs unused battle stage {stage}, which this project already uses")
        # A stage and its terrain are a pair. Reusing the CODA stage for another
        # map sends placement and setup through data for the wrong battlefield.
        row = bytearray(stages.row(fight.get('sourceStage', 241)))
        row[4:6] = bytes((2, 0))
        row[0x10:0x13] = bytes((fight.get('players', PLAYERS), 0, counts[fight['path']]))
        struct.pack_into('<H', row, 0x28, fight['roster'])
        row[0x30:0x3a] = bytes(10)
        if 'sourceStage' in fight:
            row[0xda:0xdc] = bytes(2)  # Never load the template's special roster.
        changes[stage] = row
    replacements = {17: stages.replace(changes)}
    if custom_maps := [fight for fight in fights if 'sourceMapNumber' in fight]:
        # Party placement indexes this table by map number, then selects the
        # origin pair using the deployment direction in the battle stage.
        formations = Xlce(pak.entry(45))
        if formations.row_size != 12:
            raise ValueError('Unsupported map deployment table')
        for fight in custom_maps:
            direction = stages.row(fight['sourceStage'])[0x0e]
            coords = formations.row(fight['sourceMapNumber'])[2 * direction:2 * direction + 2]
            if direction >= 4 or len(coords) != 2 or 255 in coords:
                raise ValueError(f"{fight['title']} needs a template with a player deployment origin")
        replacements[45] = clone_map_rows(formations, custom_maps)
    return replace(dat, pak, replacements)


def event_unlock_flag(nodes, fight):
    if 'unlockFlag' in fight:
        return fight['unlockFlag']
    source = fight.get('unlockSource', fight.get('anchor'))
    if source is None:
        return TYNEMOUTH
    if source < nodes.count:
        row = nodes.row(source)
        if u16(row, 0) and (flag := u16(row, 10)):
            return flag
    raise ValueError(f"{fight['title']} needs an existing stock location with an unlock flag.")


def patch_event_unlocks(data, fights):
    """Keep the picker authoritative when older projects have binary route edits."""
    fights = [fight for fight in fights if 'unlockSource' in fight or 'unlockFlag' in fight]
    if not fights:
        return data
    dat, pak = archive(data)
    nodes, roads = (Xlce(pak.entry(i)) for i in (2, 3))
    node_changes, road_changes = {}, {}
    for fight in fights:
        node, road = fight['node'], fight['road']
        flag = struct.pack('<H', event_unlock_flag(nodes, fight))
        point = nodes.row(node)
        link = roads.row(road)
        if point[10:12] != flag:
            node_changes[node] = point[:10] + flag + point[12:]
        if link[4:6] != flag:
            road_changes[road] = link[:4] + flag
    changes = {}
    if node_changes:
        changes[2] = nodes.replace(node_changes)
    if road_changes:
        changes[3] = roads.replace(road_changes)
    return replace(dat, pak, changes) if changes else data


def patch_system(data, fights):
    dat, pak = archive(data)
    nodes, roads, navigation = (Xlce(pak.entry(i)) for i in (2, 3, 4))
    node_changes, road_changes = {}, {}
    nav = [navigation.row(i) for i in range(navigation.count)]
    nodes_selected = {fight['node'] for fight in fights}
    for fight in fights:
        node, road = fight['node'], fight['road']
        flag = event_unlock_flag(nodes, fight)
        if 'anchor' in fight:
            source, direction = fight['roadFrom'], fight['direction']
            if (node < nodes.count and any(nodes.row(node))) or (road < roads.count and any(roads.row(road))):
                raise ValueError(f"{fight['title']} conflicts with a world-map location or road.")
            # The visible name is a 16-bit resource ID. Route and story travel
            # keep the distinct byte-sized overworld location index.
            node_changes[node] = struct.pack('<8H', fight['nameId'], node, source << 8, 0,
                                             fight['mapNumber'], flag, 97, 0)
            road_changes[road] = struct.pack('<4BH', road, source, node, 0, flag)
            nav.extend(bytes((node if d == 0 else 0, 0, 0, d, 0)) for d in range(4))
            connect_cursor(nav, source, node, direction)
            connect_cursor(nav, node, source, direction ^ 1)
            continue
        if nodes.row(node) != struct.pack('<8H', 0, node, 0, 0, 0, 0, 0, 0):
            raise ValueError(f"{fight['title']} needs unused world-map location {node}")
        if roads.row(road) != bytes((road, 0, 0, 0, 0, 0)):
            raise ValueError(f"{fight['title']} needs unused world-map road {road}")
        node_changes[node] = struct.pack('<8H', node, node, TYNEMOUTH << 8, 0, fight.get('mapNumber', MAP),
                                         flag, node + 50, 0)
        road_changes[road] = struct.pack('<4BH', road, TYNEMOUTH, node, 0, flag)
        if node == 50:
            anchor = nav.index(bytes((TYNEMOUTH, PHORAMPA, PHORAMPA, 0, 0)))
            nav.insert(anchor, bytes((TYNEMOUTH, node, node, 0, 1)))
            nav.extend((bytes((node, PHORAMPA, PHORAMPA, 0, 0)), bytes((0, TYNEMOUTH, TYNEMOUTH, 1, 1))))
        elif node == 45:
            at = nav.index(bytes((node, 0, 0, 0, 0)))
            if nav[at+1:at+4] != [bytes((0, 0, 0, d, 0)) for d in range(1, 4)]:
                raise ValueError('The Walking Dead world-map navigation is already in use')
            nav[at+1:at+4] = [bytes((0, TYNEMOUTH, TYNEMOUTH, 1, 1)), bytes((0, 18, 18, 2, 0)),
                              bytes((0, PHORAMPA, 50 if 50 in nodes_selected else 0, 3, 0))]
            start = nav.index(bytes((TYNEMOUTH, PHORAMPA, PHORAMPA, 0, 0)))
            try:
                west = nav.index(bytes((0, 18, 18, 2, 0)), start, start + 5)
            except ValueError as exc:
                raise ValueError('Tynemouth Hill navigation does not match the supported world map') from exc
            nav.insert(west, bytes((0, node, node, 2, 1)))
        elif node == 47:
            start = nav.index(bytes((TYNEMOUTH, PHORAMPA, PHORAMPA, 0, 0)))
            south = nav.index(bytes((0, 20, 20, 1, 0)), start, start + 5)
            nav.insert(south, bytes((0, node, node, 1, 1)))
            nav.extend((bytes((node, TYNEMOUTH, TYNEMOUTH, 0, 1)),
                        *(bytes((0, 0, 0, direction, 0)) for direction in (1, 2, 3))))
        else:
            raise ValueError(f'Unsupported overworld battle location {node}')
    header = bytearray(navigation.data[:navigation.header])
    struct.pack_into('<I', header, 4, len(nav))
    changes = {2: extend_rows(nodes, node_changes), 3: extend_rows(roads, road_changes),
               4: aligned(bytes(header) + b''.join(nav))}
    if custom_maps := [fight for fight in fights if 'sourceMap' in fight]:
        map_info = Xlce(pak.entry(0))
        if map_info.row_size != 32:
            raise ValueError('Unsupported map settings table')
        changes[0] = clone_map_rows(map_info, custom_maps, string_pointer=True)
        changes[5] = append_maps(pak.entry(5), custom_maps)
    return replace(dat, pak, changes)


def clone_map_rows(table, fights, *, string_pointer=False):
    sources = {fight['mapNumber']: fight['sourceMapNumber'] for fight in fights}
    if min(sources) < table.count:
        raise ValueError('A reserved battlefield number is already in use in a map table')
    new_count = max(sources) + 1
    old_end = table.header + table.count * table.row_size
    extra_size = (new_count - table.count) * table.row_size
    data = bytearray(table.data[:old_end])
    for index in range(table.count, new_count):
        # Row zero is the stock fallback for unused map numbers.
        data.extend(table.row(sources.get(index, 0)))
    struct.pack_into('<I', data, 4, new_count)
    if string_pointer:
        for index in range(new_count):
            at = table.header + index * table.row_size
            offset, = struct.unpack_from('<Q', data, at)
            if offset < old_end or offset >= len(table.data) or b'\0' not in table.data[offset:]:
                raise ValueError('Unsupported map settings string offset')
            struct.pack_into('<Q', data, at, offset + extra_size)
    # Keep the stock trailing string pool or padding at the end of the rows.
    data.extend(table.data[old_end:])
    return aligned(bytes(data))


def append_maps(data, fights):
    length, count, head, pool_offset = struct.unpack_from('<4I', data)
    if head != 16 or pool_offset != head + count * 32 or length != len(data) - head:
        raise ValueError('Unsupported battlefield list layout')
    rows = bytearray(data[head:pool_offset])
    pool = bytearray(data[pool_offset:])
    used = {u16(rows, i * 32) for i in range(count)}
    for fight in fights:
        number = fight['mapNumber']
        if number in used:
            raise ValueError(f'Battlefield number {number} is already in use')
        path = map_path(fight).encode('ascii') + b'\0'
        rows.extend(struct.pack('<H14xQQ', number, len(pool), len(pool) + len(path)))
        pool.extend(path + fight['title'].encode('utf-8') + b'\0')
        used.add(number)
    offset = head + len(rows)
    payload = aligned(rows + pool)
    return struct.pack('<4I', len(payload), count + len(fights), head, offset) + payload


def copy_marker(data, size, donor, target):
    width, height, pitch = struct.unpack_from('<HHI', data, 8)
    if data[:4] != b'btx\0' or data[16] != 13 or pitch != width * 4 or width % size or height % size:
        raise ValueError('Unsupported world-map marker atlas')
    base, span = u32(data, 24), size * 4
    cols = width // size
    if max(donor, target) >= cols * (height // size) or base + pitch * (height // 4) > len(data):
        raise ValueError('World-map marker cell is outside the texture')

    def start(index):
        row, col = divmod(index, cols)
        return base + row * (size // 4) * pitch + col * span

    result = bytearray(data)
    first, second = start(donor), start(target)
    for shift in range(0, pitch * (size // 4), pitch):
        result[second+shift:second+shift+span] = data[first+shift:first+shift+span]
    return bytes(result)


def patch_world(data, fights):
    dat, pak = archive(data)
    points, roads = (Xlce(pak.entry(i)) for i in (23, 24))
    native = roads.row(39)
    if len(native) != 108 or struct.unpack_from('<HH', native) != (TYNEMOUTH, PHORAMPA) or native[103] != 4:
        raise ValueError('The Tynemouth–Phorampa road layout is unsupported')
    textures = {i: pak.entry(i) for i in MARKER_SIZES}
    point_changes, road_changes = {}, {}
    custom_positions = {fight['node']: fight['position'] for fight in fights}
    for fight in fights:
        node, road = fight['node'], fight['road']
        source_node = fight['markerSource']
        if not 0 < source_node < points.count or source_node in RESERVED_POINTS:
            raise ValueError('Choose an existing world map location as the source of the marker art.')
        source = u16(points.row(source_node), 2)
        if 'anchor' in fight:
            if (node < points.count and any(points.row(node))) or (road < roads.count and any(roads.row(road))):
                raise ValueError(f"{fight['title']} conflicts with a world-map marker or road.")
            parent = fight['roadFrom']
            start = custom_positions[parent] if parent in custom_positions else struct.unpack_from('<ff', points.row(parent), 4)
            end = fight['position']
            point_changes[node] = struct.pack('<HHff', 0, source, *end)
            route = bytearray(native)
            struct.pack_into('<HH', route, 0, parent, node)
            for at, first, last in zip((12, 52), start, end):
                struct.pack_into('<4f', route, at, first, (2 * first + last) / 3, (first + 2 * last) / 3, last)
            road_changes[road] = route
            continue
        marker = fight['marker']
        used = any(i != node and u16(points.row(i), 2) == marker for i in range(points.count))
        if points.row(node) != RESERVED_POINTS[node] or used or any(roads.row(road)):
            raise ValueError(f"{fight['title']} conflicts with a world-map marker or road in this project")
        end_x, end_y = fight['position']
        old_x, old_y = struct.unpack_from('<ff', points.row(PHORAMPA), 4)
        point_changes[node] = struct.pack('<HHff', 0, marker, end_x, end_y)
        route = bytearray(native)
        struct.pack_into('<HH', route, 0, TYNEMOUTH, node)
        for base, shift in ((12, end_x - old_x), (52, end_y - old_y)):
            for i in range(4):
                offset = base + i * 4
                value, = struct.unpack_from('<f', route, offset)
                struct.pack_into('<f', route, offset, value + shift * i / 3)
        road_changes[road] = route
        textures = {i: copy_marker(payload, MARKER_SIZES[i], source, marker) for i, payload in textures.items()}
    unused_point = struct.pack('<HHff', 0, 255, 0, 0)
    return replace(dat, pak, {**textures, 23: extend_rows(points, point_changes, unused_point),
                             24: extend_rows(roads, road_changes)})


# Operand widths for chapter invocations. Matches web/js/game/scenetriggers.js.
_TASK_WIDTHS = (0,3,3,2,1,4,1,1,1,1,1,1,1,1,1,3,2,3,2,1,2,4,2,1,0,1,1,3,1,2,0,3,2,1,1,2,2,1,1,3,3)
_COND_WIDTHS = (4,4,2,3,2,4,4,4,4,4,4,5,4,4,3,2,2,2,4,4,4,4,2,3,3,4,4,3,3,2,3,2,3,3,2,3,2,4,2)


def split_invocations(data):
    if data[:4] != b'INVK':
        raise ValueError('Invalid chapter invocation bank')
    count = u16(data, 4)
    offsets = [u32(data, 8 + i * 4) for i in range(count)] + [len(data)]
    if count <= 3 or offsets[0] < 8 + count * 4 or offsets != sorted(offsets):
        raise ValueError('Invalid chapter invocation offsets')
    groups, ids, locations = [], set(), set()
    for index, (begin, end) in enumerate(zip(offsets, offsets[1:])):
        at = begin + 2
        for _ in range(u16(data, begin)):
            ids.add(u16(data, at))
            at += 2
            while at < end:
                op = u16(data, at)
                at += 2
                if op == 0xffff:
                    break
                if op == 0x32 and index == 3 and data[at] == 0:
                    locations.add(data[at+1])
                if 0x60 <= op <= 0x71:
                    at += 1
                elif 0x30 <= op <= 0x56:
                    at += _COND_WIDTHS[op - 0x30]
                elif op < len(_TASK_WIDTHS):
                    at += _TASK_WIDTHS[op]
                else:
                    raise ValueError(f'Unsupported chapter invocation operation {op:#x}')
            else:
                raise ValueError('Truncated chapter invocation')
        padding = data[at:end]
        if at == begin + 2 and padding.startswith(b'\xff\xff'):
            padding = padding[2:]  # empty stock group sentinel
        if at > end or any(padding):
            raise ValueError('Unexpected trailing chapter invocation data')
        groups.append(data[begin:at])
    return groups, ids, locations


def patch_chapter(data, directory, fights, scripted=()):
    dat, pak = archive(data)
    pgrs, invk = pak.entry(0), pak.entry(1)
    count = u16(pgrs, 6)
    if pgrs[:4] != b'PGRS' or 8 + count * 44 > len(pgrs) or any(pgrs[8+count*44:]):
        raise ValueError('Invalid chapter progression bank')
    rows = [pgrs[8+i*44:52+i*44] for i in range(count)]
    groups, ids, locations = split_invocations(invk)
    occupied = ids | {u16(row, at) for row in rows for at in (4, 6, 10)}
    next_id = max(occupied, default=0) + 1
    added = {0: [], 3: []}
    for fight in fights:
        scene, battle, location = scene_id(fight, directory), fight['stage'], fight['node']
        resource = custom_scene_resource(fight, directory) if 'sceneSlot' in fight else next_id
        has_script = scene_path(fight, directory) in scripted
        used = {resource, resource + 3, resource + 6, resource + 9} if has_script else {resource}
        if (location in locations or min(used) < 1 or max(used) >= 32768 or occupied & used or
                any(u16(row, 0) == scene or u16(row, 0x10) == battle for row in rows)):
            raise ValueError(f"{fight['title']} conflicts with an event in this chapter")
        row = bytearray(44)
        struct.pack_into('<4H', row, 0, scene, fight.get('mapNumber', MAP), resource, resource)
        struct.pack_into('<H2B', row, 0x10, battle, 1, 100)
        row[0x27], row[0x2b] = 9, 255
        arrival = resource
        if has_script:
            arrival, formation, continuation = resource + 3, resource + 6, resource + 9
            # Follow the native arrival -> formation menu -> scripted battle
            # structure. A script flag on the arrival row alone skips this chain.
            start = bytearray(44)
            struct.pack_into('<4H', start, 0, scene, fight['mapNumber'], arrival, arrival)
            struct.pack_into('<H', start, 10, formation)
            start[0x14] = 40
            struct.pack_into('<HBBH', start, 0x16, 1, 0, 4, arrival)  # Group 0 rule returns 1.
            start[0x2b] = 255
            menu = bytearray(44)
            struct.pack_into('<3H', menu, 0, scene, fight['mapNumber'], formation)
            struct.pack_into('<H', menu, 10, resource)
            menu[0x14] = 40
            menu[0x1e:0x22] = b'\x01\x09\0\x10'  # Stock pre-battle formation menu.
            menu[0x2b] = 255
            rows.extend((start, menu))
            row[6:8] = bytes(2)
            struct.pack_into('<H', row, 10, continuation)
            row[0x13] = 0
            row[0x1e] = 0x80
            row[0x27] = 0
            resume = bytearray(menu)
            struct.pack_into('<H', resume, 4, continuation)
            struct.pack_into('<H', resume, 10, 0)
            struct.pack_into('<H', resume, 16, battle)
            resume[0x28:0x2a] = b'\x02\x02'
            rows.append(row)
            row = resume
        rows.append(row)
        rule = struct.pack('<HHBHBBH', arrival, 0x60, 1, 0x32, 0, location, 0xffff)
        added[3].append(rule)
        if has_script:
            added[0].append(rule)
        occupied.update(used)
        next_id += 1
    for i, rules in added.items():
        groups[i] = struct.pack('<H', u16(groups[i], 0) + len(rules)) + groups[i][2:] + b''.join(rules)
    invocations = bytearray(invk[:8] + bytes(len(groups)*4))
    for i, group in enumerate(groups):
        struct.pack_into('<I', invocations, 8 + i*4, len(invocations))
        invocations.extend(aligned(group, 4))
    progression = pgrs[:6] + struct.pack('<H', len(rows)) + b''.join(rows)
    return replace(dat, pak, {0: aligned(progression + b'\0'), 1: aligned(bytes(invocations))})


def new_scene(path):
    output = BytesIO()
    with ZipFile(output, 'w') as result:
        member = ZipInfo(path.split('/')[-1][:-4] + '.pack')
        result.writestr(member, EMPTY_SCENE, compress_type=ZIP_DEFLATED)
    return bytes(_crypt.encrypt(output.getvalue()))


def scripted_scene(data, resource):
    with ZipFile(BytesIO(_crypt.decrypt(data))) as archive:
        member, = archive.namelist()
        if not member.endswith('.pack') and member != 'pack':
            raise ValueError('Invalid cutscene archive')
        pack = Pakd(archive.read(member))
    header = 12 + len(pack) * 4
    if not pack.offsets or pack.offsets[0] < header + len(pack) * 4:
        return False
    return any(u32(pack.data, header + i * 4) == resource and
               len(pack.entry(i)) >= 0x64 and u32(pack.entry(i), 0) == 0x8000000c for i in range(len(pack)))


def roster_count(data, max_enemies=CAPACITY - PLAYERS):
    _, pack = archive(data)
    units, sprites = Xlce(pack.entry(0)), pack.entry(1)
    if (len(pack) != 2 or units.row_size != 196 or units.count != u32(sprites, 0)
            or len(sprites) < 16 + units.count * 8 or not 1 <= units.count <= max_enemies):
        raise ValueError(f'This encounter must have between 1 and {max_enemies} enemies')
    if not all(units.row(i)[16] == 2 and units.row(i)[13] == 1 for i in range(units.count)):
        raise ValueError('Hard Mode encounter rosters need enemies that appear at battle start')
    return units.count


def build_roster(fight, donor):
    dat, pack = donor(fight['donors'][0][0])
    units, sprites = [], []
    for slot, (battle, index, name, template, klass, x, y, *overrides) in enumerate(fight['donors']):
        _, source = donor(battle)
        table = Xlce(source.entry(0))
        unit = bytearray(table.row(index))
        if (len(unit) != 196 or (u16(unit, 0), u16(unit, 2), unit[6]) != (name, template, klass)
                or u32(source.entry(1), 0) != table.count):
            raise ValueError(f"{fight['title']} donor battle {battle}, slot {index} differs from stock")
        unit[4], unit[0x9a] = 200 + slot, 1
        unit[10:12] = bytes((x, y))
        unit[13:15] = b'\x01\0'
        unit[16:20] = b'\x02\0\0\0'
        if overrides:
            for at, value in overrides[0].items():
                unit[int(at)] = value
        units.append(unit)
        sprites.append(source.entry(1)[16+index*8:24+index*8])
    header = struct.pack('<4sIII', b'xlce', len(units), 16, 196)
    return replace(dat, pack, {0: aligned(header + b''.join(units) + b'\0'),
                               1: aligned(struct.pack('<I', len(units)) + bytes(12) + b''.join(sprites) + bytes(16))})


def build(read, value, editor, custom=None, limit=CAPACITY, assets=None, editor_view=False):
    active = selected(value, custom)
    if not active:
        return {}
    fights = list(active.values())
    assets = assets or {}
    result, counts, text = {}, {}, {}

    @lru_cache(maxsize=None)
    def donor(number):
        return archive(read(f'battle/entry/entry_unit_{number:03d}.dat'))

    overrides = editor.get(ROSTER_EDITS, {})
    for key, fight in active.items():
        path, name_id = fight['path'], fight.get('nameId', fight['node'])
        if key in overrides:
            result[path] = bytes.fromhex(overrides[key])
        elif fight.get('source') is not None:
            _, source = donor(fight['source'])
            table = Xlce(source.entry(0))
            enemies = [(fight['source'], i, u16(row, 0), u16(row, 2), row[6], row[10], row[11])
                       for i in range(table.count) if (row := table.row(i))[13] == 1 and row[16] == 2]
            if not enemies:
                raise ValueError(f"{fight['title']} needs an arena with enemies already placed")
            result[path] = build_roster(fight | {'donors': enemies}, donor)
        else:
            result[path] = build_roster(fight, donor)
        counts[path] = roster_count(result[path], limit - fight.get('players', PLAYERS))
        if 'sourceMap' in fight:
            path = map_path(fight)
            result[path] = assets[path] if path in assets else read(f"bg/{fight['sourceMap']}.dat")
        text.update({f'{STRONGHOLD}{name_id:03d}_{suffix}': fight['title'].encode('utf-8') for suffix in ('NAME', 'NAME_2LINES')})
        text[f'{STRONGHOLD}{name_id:03d}_TEXT'] = fight['description'].encode('utf-8')
    result[BATTLE] = patch_battle(read(BATTLE), fights, counts)
    result[SYSTEM] = patch_system(read(SYSTEM), fights)
    result[WORLD] = patch_world(read(WORLD), fights)
    for directory, suffix in enumerate(CHAPTERS, 901):
        path = f'event/chapter/chapter_{suffix}.dat'
        scripted = set()
        for fight in fights:
            scene = scene_path(fight, directory)
            result[scene] = assets[scene] if scene in assets else new_scene(scene)
            if not editor_view and scene in assets and scripted_scene(assets[scene], custom_scene_resource(fight, directory)):
                scripted.add(scene)
        result[path] = patch_chapter(read(path), directory, fights, scripted)
    for language in MAP_NAME_LANGUAGES:
        path = f'localize/LocalizeText_{language}.dat'
        source = read(path)
        if text.keys() & class_text.read_archive(source).keys():
            raise ValueError(f'Hard Mode encounter names already exist in {path}')
        result[path] = class_text.patch_archive(source, text, STRONGHOLD)
    return result

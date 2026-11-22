"""Build the two optional Hard Mode encounters from the selected game's data."""

from functools import lru_cache
from io import BytesIO
import json
from pathlib import Path
import struct
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from ai_choices_data import rebuild_pakd
from art_registry import MAP_NAME_LANGUAGES, SCENE_DIRECTORY_PREFIXES
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
MAP, MAP_FILE = 264, 'bg300_50_c0_t00'
MARKER_SIZES = {0: 128, 1: 32, 20: 128, 21: 32, 22: 128}
RESERVED_POINTS = {45: bytes.fromhex('0000ff000000000000000000'), 50: bytes.fromhex('000031009eef6f40e3a5dbbe')}
STRONGHOLD = 'STRONGHOLD_LC_STRONGHOLD_'
EMPTY_SCENE = b'pakd\0\0\0\0\x10\0\0\0\0\0\0\0'
ROSTERS = tuple(f'battle/entry/entry_unit_{i}.dat' for i in (2000, 2001))
ROSTER_EDITS = 'battleEncounterRosters'


def recipes():
    return json.loads((ROOT / 'encounters.json').read_bytes())


def selected(value):
    return {key: recipes()[key] for key in FIGHTS if value.get(key)}


def scene_id(fight, directory):
    return fight['chapterOneScene'] if directory == 901 else fight['scene']


def scene_path(fight, directory):
    return f'event/scene/{SCENE_DIRECTORY_PREFIXES[directory]}_ST_{scene_id(fight, directory):03d}.dat'


def banner_path(fight, language):
    return f"menu/mapname/{language}/STRONGHOLD_{fight['node']:03d}.dat"


def registrations(value):
    result = []
    for fight in selected(value).values():
        result.append({'directory': 1001, 'id': fight['roster'], 'path': fight['path']})
        result.extend({'directory': directory, 'id': scene_id(fight, directory), 'path': scene_path(fight, directory)}
                      for directory in SCENE_DIRECTORY_PREFIXES)
        result.extend({'directory': 500, 'id': 50000 + fight['node'] * len(MAP_NAME_LANGUAGES) + i,
                       'path': banner_path(fight, language)} for i, language in enumerate(MAP_NAME_LANGUAGES))
    return result


def owned_paths(value):
    entries = registrations(value)
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
    return (path in (SYSTEM, WORLD, *ROSTERS) or path.startswith(('event/chapter/chapter_', 'event/scene/', 'menu/mapname/')))


def links(value):
    result = []
    for fight in selected(value).values():
        for directory in SCENE_DIRECTORY_PREFIXES:
            result.append({'roster': fight['path'].split('/')[-1][:-4], 'title': fight['title'], 'map': MAP_FILE,
                           'mapNumber': MAP, 'place': fight['node'], 'stage': fight['stage'],
                           'scene': scene_path(fight, directory).split('/')[-1][:-4],
                           'chapter': SCENE_DIRECTORY_PREFIXES[directory], 'storyStage': scene_id(fight, directory)})
    return result


def aligned(data, alignment=16):
    return data + bytes(-len(data) % alignment)


def archive(data):
    dat = DatArchive.read(data)
    return dat, Pakd(dat.pack)


def replace(dat, pack, changes):
    return dat.rebuild(rebuild_pakd(pack, changes))


def patch_battle(data, fights, counts):
    dat, pak = archive(data)
    stages = Xlce(pak.entry(17))
    template = stages.row(241)
    if len(template) != 230:
        raise ValueError('Unsupported battle stage layout for Hard Mode encounters')
    changes = {}
    for fight in fights:
        stage = fight['stage']
        if any(stages.row(stage)):
            raise ValueError(f"{fight['title']} needs unused battle stage {stage}, which this project already uses")
        row = bytearray(template)
        row[4:6] = bytes((2, 0))
        row[0x10:0x13] = bytes((PLAYERS, 0, counts[fight['path']]))
        struct.pack_into('<H', row, 0x28, fight['roster'])
        row[0x30:0x3a] = bytes(10)
        changes[stage] = row
    return replace(dat, pak, {17: stages.replace(changes)})


def patch_system(data, fights):
    dat, pak = archive(data)
    nodes, roads, navigation = (Xlce(pak.entry(i)) for i in (2, 3, 4))
    node_changes, road_changes = {}, {}
    nav = [navigation.row(i) for i in range(navigation.count)]
    nodes_selected = {fight['node'] for fight in fights}
    for fight in fights:
        node, road = fight['node'], fight['road']
        if nodes.row(node) != struct.pack('<8H', 0, node, 0, 0, 0, 0, 0, 0):
            raise ValueError(f"{fight['title']} needs unused world-map location {node}")
        if roads.row(road) != bytes((road, 0, 0, 0, 0, 0)):
            raise ValueError(f"{fight['title']} needs unused world-map road {road}")
        node_changes[node] = struct.pack('<8H', node, node, TYNEMOUTH << 8, 0, MAP, TYNEMOUTH, node + 50, 0)
        road_changes[road] = struct.pack('<4BH', road, TYNEMOUTH, node, 0, TYNEMOUTH)
        if node == 50:
            anchor = nav.index(bytes((TYNEMOUTH, PHORAMPA, PHORAMPA, 0, 0)))
            nav.insert(anchor, bytes((TYNEMOUTH, node, node, 0, 1)))
            nav.extend((bytes((node, PHORAMPA, PHORAMPA, 0, 0)), bytes((0, TYNEMOUTH, TYNEMOUTH, 1, 1))))
        else:
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
    header = bytearray(navigation.data[:navigation.header])
    struct.pack_into('<I', header, 4, len(nav))
    return replace(dat, pak, {2: nodes.replace(node_changes), 3: roads.replace(road_changes),
                              4: aligned(bytes(header) + b''.join(nav))})


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
    for fight in fights:
        node, road, marker = fight['node'], fight['road'], fight['marker']
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
        source = u16(points.row(fight['markerSource']), 2)
        textures = {i: copy_marker(payload, MARKER_SIZES[i], source, marker) for i, payload in textures.items()}
    return replace(dat, pak, {**textures, 23: points.replace(point_changes), 24: roads.replace(road_changes)})


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


def patch_chapter(data, directory, fights):
    dat, pak = archive(data)
    pgrs, invk = pak.entry(0), pak.entry(1)
    count = u16(pgrs, 6)
    if pgrs[:4] != b'PGRS' or 8 + count * 44 > len(pgrs) or any(pgrs[8+count*44:]):
        raise ValueError('Invalid chapter progression bank')
    rows = [pgrs[8+i*44:52+i*44] for i in range(count)]
    groups, ids, locations = split_invocations(invk)
    next_id = max(ids | {u16(row, at) for row in rows for at in (4, 6, 10)}, default=0) + 1
    added = bytearray()
    for fight in fights:
        scene, battle, location = scene_id(fight, directory), fight['stage'], fight['node']
        if (location in locations or next_id >= 32768 or
                any(u16(row, 0) == scene or u16(row, 0x10) == battle for row in rows)):
            raise ValueError(f"{fight['title']} conflicts with an event in this chapter")
        row = bytearray(44)
        struct.pack_into('<4H', row, 0, scene, MAP, next_id, next_id)
        struct.pack_into('<4B', row, 0x10, battle, 0, 1, 100)
        row[0x27], row[0x2b] = 9, 255
        rows.append(row)
        added.extend(struct.pack('<HHBHBBH', next_id, 0x60, 1, 0x32, 0, location, 0xffff))
        next_id += 1
    groups[3] = struct.pack('<H', u16(groups[3], 0) + len(fights)) + groups[3][2:] + added
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


def roster_count(data):
    _, pack = archive(data)
    units, sprites = Xlce(pack.entry(0)), pack.entry(1)
    if (len(pack) != 2 or units.row_size != 196 or units.count != u32(sprites, 0)
            or len(sprites) < 16 + units.count * 8 or units.count > CAPACITY - PLAYERS):
        raise ValueError('A Hard Mode encounter must fit in its 50 enemy slots')
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


def build(read, value, editor):
    active = selected(value)
    if not active:
        return {}
    fights = list(active.values())
    result, counts, text = {}, {}, {}

    @lru_cache(maxsize=None)
    def donor(number):
        return archive(read(f'battle/entry/entry_unit_{number:03d}.dat'))

    overrides = editor.get(ROSTER_EDITS, {})
    for key, fight in active.items():
        path, node = fight['path'], fight['node']
        result[path] = bytes.fromhex(overrides[key]) if key in overrides else build_roster(fight, donor)
        counts[path] = roster_count(result[path])
        banner = (ROOT / f'{key}-banner.dat').read_bytes()
        for language in MAP_NAME_LANGUAGES:
            result[banner_path(fight, language)] = banner
        text.update({f'{STRONGHOLD}{node:03d}_{suffix}': fight['title'].encode('ascii') for suffix in ('NAME', 'NAME_2LINES')})
        text[f'{STRONGHOLD}{node:03d}_TEXT'] = fight['description'].encode('ascii')
    result[BATTLE] = patch_battle(read(BATTLE), fights, counts)
    result[SYSTEM] = patch_system(read(SYSTEM), fights)
    result[WORLD] = patch_world(read(WORLD), fights)
    for directory, suffix in enumerate(CHAPTERS, 901):
        path = f'event/chapter/chapter_{suffix}.dat'
        result[path] = patch_chapter(read(path), directory, fights)
        for fight in fights:
            path = scene_path(fight, directory)
            result[path] = new_scene(path)
    for language in MAP_NAME_LANGUAGES:
        path = f'localize/LocalizeText_{language}.dat'
        source = read(path)
        if text.keys() & class_text.read_archive(source).keys():
            raise ValueError(f'Hard Mode encounter names already exist in {path}')
        result[path] = class_text.patch_archive(source, text, STRONGHOLD)
    return result

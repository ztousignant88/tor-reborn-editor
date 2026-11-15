"""Build editor/web/data/battle_links.json: which map, cutscene file and place
each battle uses, and the English place name of each map, from the game's own
data (no guessing by fit).

  story steps   event/chapter/chapter_*.dat, PGRS: 44-byte records with the
                step's stage (its cutscene file is <chapter>_ST_<stage>), map
                number (+2), INVK id (+6) and battle stage (+0x10);
  battle stage  battle_data_release.dat entry 17: +0x28 = the battle's unit file,
                an index into battle/entry's files in FileTable order (+0xDA: a
                second, "special" one);
  map number    system/system_data.dat entry 5 (the map table: bg file names and
                Japanese place names);
  place         the stronghold the story is at: a step's INVK conditions say
                "CurrentStrongpoint == N" when entering it (as Asvel's
                ExtractScreenplay tracks it). The editor shows it in the text
                language chosen: STRONGHOLD_LC_STRONGHOLD_<N>_NAME.
Usage:
    python build_battle_links.py <game Data dir> <out json> [research/tools dir]
"""
import collections, io, json, re, struct, sys, zipfile
from pathlib import Path

sys.path.insert(0, sys.argv[3] if len(sys.argv) > 3 else str(Path(__file__).resolve().parents[2] / 'research' / 'tools'))
from torcrypt import decrypt
import pakd

CHAPTERS = [('chapter_1', 'C1', 26), ('chapter_2a', 'C2a', 9), ('chapter_2b', 'C2b', 13), ('chapter_3a', 'C3a', 25),
            ('chapter_3b', 'C3b', 9), ('chapter_3c', 'C3c', 25), ('chapter_4', 'C4', 15)]  # (file, scene prefix, starting stronghold)
# INVK condition and task parameter layouts (Asvel's ExtractScreenplay)
TASK = {0x00: '', 0x01: 'HB', 0x02: 'HB', 0x03: 'Bb', 0x04: 'B', 0x05: 'HH', 0x06: 'B', 0x07: 'b', 0x08: 'b', 0x09: 'b', 0x0a: 'b',
        0x0b: 'b', 0x0c: 'b', 0x0d: 'B', 0x0e: 'B', 0x0f: 'HB', 0x10: 'Bb', 0x11: 'HB', 0x12: 'H', 0x13: 'B', 0x14: 'H', 0x15: 'HH',
        0x16: 'H', 0x17: 'B', 0x18: '', 0x19: 'B', 0x1a: 'B', 0x1b: 'HB', 0x1c: 'B', 0x1d: 'BB', 0x1e: '', 0x1f: 'BBB', 0x20: 'H',
        0x21: 'B', 0x22: 'B', 0x23: 'H', 0x24: 'H', 0x25: 'B', 0x26: 'B', 0x27: 'HB', 0x28: 'HB'}
COND = {0x30: 'HBB', 0x31: 'HBB', 0x32: 'BB', 0x33: 'BH', 0x34: 'BB', 0x35: 'BBH', 0x36: 'BBH', 0x37: 'HH', 0x38: 'BBH', 0x39: 'BBH',
        0x3a: 'BBH', 0x3b: 'BBBH', 0x3c: 'HH', 0x3d: 'BBH', 0x3e: 'BH', 0x3f: 'BB', 0x40: 'BB', 0x41: 'BB', 0x42: 'BBH', 0x43: 'BBH',
        0x44: 'HBB', 0x45: 'HBB', 0x46: 'BB', 0x47: 'BBB', 0x48: 'BBB', 0x49: 'BBH', 0x4a: 'BBH', 0x4b: 'BH', 0x4c: 'BH', 0x4d: 'BB',
        0x4e: 'BH', 0x4f: 'BB', 0x50: 'BH', 0x51: 'BH', 0x52: 'BB', 0x53: 'BH', 0x54: 'BB', 0x55: 'HBB', 0x56: 'BB'}
INCOMING_STRONGPOINT, CURRENT_STRONGPOINT = 3, 0x32


def load(path):
    z = zipfile.ZipFile(io.BytesIO(decrypt(Path(path).read_bytes())))
    return pakd.parse(z.read(z.namelist()[0]))


def xlce_rows(d):
    n, hs, rs = struct.unpack_from('<III', d, 4)
    return [d[hs + i * rs: hs + (i + 1) * rs] for i in range(n)]


def entering(invk):
    """INVK id -> stronghold it is entered at (an incoming_strongpoint group with CurrentStrongpoint == N)."""
    groups = struct.unpack_from('<H', invk, 4)[0]
    out = {}
    for gi, go in enumerate(struct.unpack_from(f'<{groups}I', invk, 8)):
        n, o = struct.unpack_from('<H', invk, go)[0], go + 2
        for _ in range(n):
            iid = struct.unpack_from('<H', invk, o)[0]
            o += 5
            while True:
                t = struct.unpack_from('<h', invk, o)[0]
                o += 2
                if t == -1:
                    break
                fmt = COND.get(t, TASK.get(t))
                if fmt is None:
                    break
                args = struct.unpack_from('<' + fmt, invk, o) if fmt else ()
                o += struct.calcsize('<' + fmt) if fmt else 0
                if gi == INCOMING_STRONGPOINT and t == CURRENT_STRONGPOINT and args[0] == 0:
                    out[iid] = args[1]
            # an unknown opcode leaves the rest of this group unreadable
            if fmt is None:
                break
    return out


def indexed_entry_files(ft):
    """Directory 1001 file IDs -> document keys, including uppercase paths.

    Stage fields store IDs, not a position in a filtered list of path strings.
    Reborn batch flag 0 points to 8-byte units in the external path table.
    Container layout follows Gibbed.TacticsOgre FileTableFile (zlib license).
    """
    u16 = lambda o: struct.unpack_from('<H', ft, o)[0]
    u32 = lambda o: struct.unpack_from('<I', ft, o)[0]
    if u16(0) != 0x1EF1:
        raise ValueError('Unsupported FileTable signature')
    ds = 68 + u16(2) * 8
    bs = ds + u16(4) * 24
    fs, external = u32(8), u32(12)
    if external >= len(ft):
        raise ValueError('Expected Reborn external file paths')
    out = {}
    for i in range(u16(4)):
        pos = ds + 24 * i
        if u16(pos) != 1001:
            continue
        for j in range(u16(pos + 10)):
            at = bs + u32(pos + 16) + 8 * j
            base, count, raw = struct.unpack_from('<HHI', ft, at)
            if raw >> 29:
                raise ValueError('Unexpected Reborn batch flags')
            for k in range(count):
                offset = external + u32(fs + (raw & 0x1FFFFFFF) + 4 * k) * 8
                path = ft[offset:ft.index(b'\0', offset)].decode('ascii')
                key = Path(path).stem.lower()
                if not re.fullmatch(r'entry_unit_(?:\d+|pack\d+)', key):
                    raise ValueError('Unexpected battle entry path: ' + path)
                out[base + k] = key
    if not out:
        raise ValueError('Missing battle-entry directory 1001')
    return out


def main(data, out):
    import unicodedata
    data = Path(data)
    entry_files = indexed_entry_files((data / 'FileTable.bin').read_bytes())
    stages = xlce_rows(load(data / 'battle/battle_data_release.dat')[17][2])
    system = load(data / 'system/system_data.dat')
    maptab = system[5][2]
    count, head = struct.unpack_from('<II', maptab, 4)
    pool = head + count * 32
    cstr = lambda o: maptab[pool + o:maptab.index(b'\0', pool + o)].decode('utf-8', 'replace')
    maps = collections.defaultdict(list)
    for i in range(count):
        at = head + i * 32
        name = cstr(struct.unpack_from('<Q', maptab, at + 16)[0]).replace('bg/', '').replace('.dat', '')
        maps[struct.unpack_from('<H', maptab, at)[0]].append((maptab[at + 7], name, cstr(struct.unpack_from('<Q', maptab, at + 24)[0])))
    for variants in maps.values():
        variants.sort()

    # The current world-map node can remain unchanged inside a dungeon. Name
    # the background from its own native place name instead of that stale node.
    native_places = {}
    japanese = data / 'localize/LocalizeText_ja-jp.dat'
    if japanese.is_file():
        for _, _, table in load(japanese):
            if table[:4] != b'txte':
                continue
            n, start = struct.unpack_from('<II', table, 4)
            for i in range(n):
                key_at, value_at = struct.unpack_from('<QQ', table, start + i * 32)
                key = table[key_at:table.index(b'\0', key_at)].decode()
                match = re.fullmatch(r'STRONGHOLD_LC_STRONGHOLD_(\d+)_NAME', key)
                if match and 0 < int(match[1]) <= 50:
                    name = table[value_at:table.index(b'\0', value_at)].decode()
                    if name:
                        native_places[unicodedata.normalize('NFKC', name)] = int(match[1])
    def native_place(name):
        name = unicodedata.normalize('NFKC', name)
        matches = [(len(label), place) for label, place in native_places.items() if name.startswith(label)]
        if matches:
            return max(matches)[1], 'native Japanese map/place name'
        if name.startswith('死者宮'):
            return 1, 'native map-name abbreviation: 死者宮 = 死者の宮殿'
        return None, None

    scene_cache = {}
    def scene_parts(name):
        if name not in scene_cache:
            path = data / 'event/scene' / (name + '.dat')
            scene_cache[name] = {i for i, _, d in load(path) if len(d) >= 4 and struct.unpack_from('<I', d)[0] == 0x8000000C} if path.is_file() else set()
        return scene_cache[name]

    battles = {}
    map_info = collections.defaultdict(lambda: {'places': collections.Counter(), 'battles': set(), 'scenes': set(), 'contexts': []})
    chapter_stats = {}
    chapters = [*CHAPTERS, ('chapter_dlc', 'DLC', None), ('chapter_ep', 'EP', None)]
    for file, prefix, initial_place in chapters:
        entries = {i: d for i, _, d in load(data / 'event/chapter' / (file + '.dat'))}
        pgrs = next(d for d in entries.values() if d[:4] == b'PGRS')
        invk = next(d for d in entries.values() if d[:4] == b'INVK')
        enter = entering(invk)
        place = initial_place
        scripted = {}
        stats = {'records': struct.unpack_from('<H', pgrs, 6)[0], 'ignoredUnmatchedRecords': 0, 'battleContexts': 0}
        chapter_stats[prefix] = stats
        for k in range(stats['records']):
            at = 8 + k * 44
            story_stage, number, part, invk_id = struct.unpack_from('<HHHH', pgrs, at)
            battlestage = struct.unpack_from('<H', pgrs, at + 0x10)[0]
            scene = f'{prefix}_ST_{story_stage:03d}'
            has_script = bool(pgrs[at + 0x1E] & 0x80)
            parts = scene_parts(scene)
            # Reborn's DLC includes a copied C4 tail. Validate ownership against
            # real script parts, not a hard-coded PSP row cutoff or scene range.
            if has_script:
                if part in parts:
                    scripted[story_stage] = part
                else:
                    scripted.pop(story_stage, None)
            owned = part in parts or scripted.get(story_stage) in parts
            place = enter.get(invk_id, place)
            if prefix == 'DLC' and not owned:
                stats['ignoredUnmatchedRecords'] += 1
                continue
            variants = maps.get(number)
            if not variants:
                continue
            base = variants[0][1]
            info = map_info[base]
            info.update(number=number, ja=variants[0][2], variants=[v[1] for v in variants])
            if place is not None:
                info['places'][place] += 1
            if parts:
                info['scenes'].add(scene)
            if not battlestage or battlestage >= len(stages):
                continue
            row = stages[battlestage]
            for off, kind in ((0x28, 'normal'), (0xDA, 'special')):
                idx = struct.unpack_from('<H', row, off)[0]
                if not idx or idx not in entry_files:
                    continue
                key = entry_files[idx]
                if not re.fullmatch(r'entry_unit_\d+', key):
                    continue
                b = battles.setdefault(key, {'contexts': [], 'scenes': []})
                identity = f'{prefix}:{story_stage}:{battlestage}:{number}:{kind}'
                context = next((c for c in b['contexts'] if c['id'] == identity), None)
                if context is None:
                    start = scripted.get(story_stage)
                    context = {'id': identity, 'chapter': prefix, 'scene': scene, 'sceneExists': bool(parts),
                               'storyStage': story_stage, 'stage': battlestage, 'slot': kind, 'map': base,
                               'mapNumber': number, 'place': place, 'rows': [],
                               'start': {'scene': scene, 'part': start} if start in parts else None}
                    if prefix == 'EP':
                        context['review'] = 'Epilogue file record; use in normal play is not confirmed.'
                    b['contexts'].append(context)
                    info['contexts'].append({'battle': key, 'id': identity})
                    stats['battleContexts'] += 1
                context['rows'].append(k)
                if parts and scene not in b['scenes']:
                    b['scenes'].append(scene)
                if kind == 'special':
                    b['special'] = True
                info['battles'].add(key)

    for key, b in battles.items():
        # Preserve the first main-story association as the default. DLC precedes
        # EP so an epilogue record cannot displace a playable Coda association.
        default = b['contexts'][0]
        b.update({field: default[field] for field in ['map', 'mapNumber', 'stage', 'place', 'start']})
        b['defaultContext'] = default['id']

    stage_files = collections.defaultdict(list)
    for stage, row in enumerate(stages):
        for off, kind in ((0x28, 'normal'), (0xDA, 'special')):
            idx = struct.unpack_from('<H', row, off)[0]
            if idx and idx in entry_files:
                stage_files[entry_files[idx]].append({'stage': stage, 'slot': kind})
    out_maps = {}
    for base, info in sorted(map_info.items()):
        place = info['places'].most_common(1)[0][0] if info['places'] else None
        owner, source = native_place(info['ja'])
        if owner is not None:
            place = owner
        source = source or ('story world-map node' if place is not None else 'unknown')
        out_maps[base] = {'place': place, 'placeSource': source, 'ja': info['ja'], 'number': info['number'], 'variants': info['variants'],
                          'battles': sorted(info['battles']), 'scenes': sorted(info['scenes']), 'contexts': info['contexts']}
        for variant in info['variants'][1:]:
            out_maps.setdefault(variant, {'place': place, 'placeSource': source, 'ja': info['ja'], 'number': info['number'], 'variantOf': base})
    result = {'version': 2, 'note': 'Indexed FileTable IDs and all chapter files; each battle retains all map/stage contexts. DLC records checked against scene script parts; EP reachability labeled.',
              'chapters': chapter_stats, 'battles': dict(sorted(battles.items())), 'maps': out_maps, 'stages': dict(sorted(stage_files.items()))}
    Path(out).write_text(json.dumps(result, ensure_ascii=False, indent=0), encoding='utf-8')
    print(len(battles), 'battle files linked;', sum(len(b['contexts']) for b in battles.values()), 'contexts;', len(out_maps), 'map variants')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

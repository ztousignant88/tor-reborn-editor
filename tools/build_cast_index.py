"""Build editor/web/data/cast_index.json: every character that appears in a
cutscene cast table, its usual look, and scene files that bundle its resources.

A scene's cast table (xlce, 12-byte rows) gives each slot a character id,
portrait, a u16 used by generic units, and a sprite set. Named characters need
their portrait (pakd id 0x11000 + portrait, ashg) and sprite set (0x50000 +
sprite, pakd) inside the same scene file, so swapping one in means copying
those two entries from a donor scene. Usage:
    python build_cast_index.py <game Data dir> <out json> [research/tools dir]
"""
import collections, hashlib, io, json, os, struct, sys, zipfile
from pathlib import Path

sys.path.insert(0, sys.argv[3] if len(sys.argv) > 3 else str(Path(__file__).resolve().parents[2] / 'research' / 'tools'))
from torcrypt import decrypt
import pakd

PORTRAIT, SPRITE = 0x11000, 0x50000

def main(data_dir, out):
    scenes = sorted((Path(data_dir) / 'event' / 'scene').glob('*.dat'))
    looks = collections.defaultdict(collections.Counter)
    donors = collections.defaultdict(list)
    hashes = collections.defaultdict(set)
    for fp in scenes:
        z = zipfile.ZipFile(io.BytesIO(decrypt(fp.read_bytes())))
        entries = {i: d for i, _, d in pakd.parse(z.read(z.namelist()[0]))}
        for d in entries.values():
            if d[:4] != b'xlce' or struct.unpack_from('<I', d, 12)[0] != 12: continue
            for r in range(struct.unpack_from('<I', d, 4)[0]):
                char, portrait, generic, sprite = struct.unpack_from('<4H', d, 16 + 12 * r)
                if not char or not portrait or not sprite: continue
                looks[char][(portrait, sprite)] += 1
                p, s = entries.get(PORTRAIT + portrait), entries.get(SPRITE + sprite)
                if p is None or s is None: continue
                key = (portrait, sprite)
                if fp.name not in [n for n, k in donors[char] if k == key]: donors[char].append((fp.name, key))
                hashes[('p', portrait)].add(hashlib.sha1(p).hexdigest())
                hashes[('s', sprite)].add(hashlib.sha1(s).hexdigest())
    chars = []
    for char in sorted(looks):
        for (portrait, sprite), uses in looks[char].most_common():
            files = [n for n, k in donors[char] if k == (portrait, sprite)]
            if files: chars.append({'character': char, 'portrait': portrait, 'sprite': sprite, 'uses': uses, 'donors': files[:3]})
    differing = [k for k, v in hashes.items() if len(v) > 1]
    Path(out).write_text(json.dumps({'note': 'built by editor/tools/build_cast_index.py', 'looks': chars}, indent=0), encoding='utf-8')
    print(len(scenes), 'scenes;', len(chars), 'looks for', len({c['character'] for c in chars}), 'characters;',
          'resources that differ between scenes:', differing[:10])

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

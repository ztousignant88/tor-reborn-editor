"""Build editor/web/data/unit_copies.json: which scene files carry a copy of
which battle file.

Story steps that add characters (AddGuest, AddUnit, ...) name a battle file
(battle/entry/entry_unit_<n>.dat) and a character, but the game reads the
unit from a copy inside the scene file that is loaded at the time: pakd entry
0xD000 + n holds the battle file's unit table (its entry 0), byte for byte.
The editor uses this index to keep those copies in step when it saves a battle
file. Usage:
    python build_unit_copy_index.py <game Data dir> <out json> [research/tools dir]
"""
import collections, io, json, struct, sys, zipfile
from pathlib import Path

sys.path.insert(0, sys.argv[3] if len(sys.argv) > 3 else str(Path(__file__).resolve().parents[2] / 'research' / 'tools'))
from torcrypt import decrypt
import pakd

COPY_BASE = 0xD000


def main(data_dir, out):
    scenes = sorted((Path(data_dir) / 'event' / 'scene').glob('*.dat'))
    files = collections.defaultdict(list)
    differ = []
    for fp in scenes:
        z = zipfile.ZipFile(io.BytesIO(decrypt(fp.read_bytes())))
        for i, _, d in pakd.parse(z.read(z.namelist()[0])):
            if not COPY_BASE <= i < COPY_BASE + 0x1000 or d[:4] != b'xlce' or struct.unpack_from('<I', d, 12)[0] != 196:
                continue
            n = i - COPY_BASE
            files[n].append(fp.name)
            battle = Path(data_dir) / 'battle' / 'entry' / f'entry_unit_{n:03d}.dat'
            if battle.is_file():
                bz = zipfile.ZipFile(io.BytesIO(decrypt(battle.read_bytes())))
                if pakd.parse(bz.read(bz.namelist()[0]))[0][2] != d:
                    differ.append(f'{fp.name}:{n}')
    index = {str(n): names for n, names in sorted(files.items())}
    Path(out).write_text(json.dumps({'note': 'built by editor/tools/build_unit_copy_index.py', 'files': index}, indent=0), encoding='utf-8')
    print(len(scenes), 'scenes;', sum(map(len, files.values())), 'copies of', len(files), 'battle files;',
          len(differ), 'differ from their battle file:', differ[:12])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

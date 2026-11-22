"""Read-only validation of the AI rows a project will install.

DAT decoding follows Gibbed.Reborn DataBogoCrypt (zlib, Rick/gibbed), as
already used by web/js/lib/crypt.js. No optional research tools are required.
"""
import hashlib
from io import BytesIO
import re
import struct
import zipfile

BATTLE = 'battle/battle_data_release.dat'
UNIT_FILE = re.compile(r'battle/entry/entry_unit_[0-9]+\.dat', re.I)
_T2 = bytes.fromhex('b0bc6d19e514b6eaf4cb16b17de57fb50b7c5ec42d4f3199679819e82858dec9c19bc98334c4648536fa0edefbe7689971323436e5017d635c81777c')
_T3 = bytes.fromhex('c65398edd0aae01b43311632ce0d52577b720ffbb7a9c6f1f1722c895fb21bfaa8dbe3e241b5bec95daec621e4d2887497264f877af0697ab77e1509ba55adcab1603476')

def _decrypt(data):
    if len(data) < 16:
        raise ValueError('DAT is too short')
    bits = len(data) * 8
    value = int.from_bytes(data, 'big')
    out = bytearray((((value << 3) | (value >> (bits - 3))) & ((1 << bits) - 1)).to_bytes(len(data), 'big'))
    for offset, table, seed in [(0, _T2, 8), (16, _T3, None)]:
        seed = out[15] & 127 if seed is None else seed
        seed %= len(table) // 4
        rotated = table[seed * 4:] + table[:seed * 4]
        length = (len(out) - offset) // 4 * 4
        key = (rotated * (length // len(rotated) + 1))[:length]
        out[offset:offset + length] = (int.from_bytes(out[offset:offset + length], 'big') ^ int.from_bytes(key, 'big')).to_bytes(length, 'big')
    return bytes(out)

def _table(data, index, row_size):
    try:
        with zipfile.ZipFile(BytesIO(_decrypt(data))) as archive:
            info = archive.infolist()
            if len(info) != 1 or info[0].filename != 'pack' or info[0].file_size > 64 * 1024 * 1024:
                raise ValueError('Invalid DAT archive')
            pack = archive.read('pack')
        if len(pack) < 16 or pack[:4] != b'pakd':
            raise ValueError('Invalid PAKD')
        count = struct.unpack_from('<I', pack, 4)[0]
        if count <= index or 12 + count * 4 > len(pack):
            raise ValueError('Missing game table')
        start, end = struct.unpack_from('<II', pack, 8 + index * 4)
        if not 12 + count * 4 <= start <= end <= len(pack) or pack[start:start + 4] != b'xlce':
            raise ValueError('Invalid game table')
        rows, header, stride = struct.unpack_from('<III', pack, start + 4)
        if stride != row_size or header < 16 or start + header + rows * stride > end:
            raise ValueError('Unsupported game table layout')
        return [pack[start + header + i * stride:start + header + (i + 1) * stride] for i in range(rows)]
    except (zipfile.BadZipFile, struct.error, RuntimeError) as exc:
        raise ValueError('Cannot inspect AI assignments: invalid DAT') from exc

def validate(read, paths):
    """Validate the effective output, using the supplied read-only overlay."""
    profiles = _table(read(BATTLE), 27, 98)
    if not 1 <= len(profiles) <= 256:
        raise ValueError('AI table must have between 1 and 256 profiles')
    checked = 0
    problems = []
    for path in sorted(paths):
        if not UNIT_FILE.fullmatch(path):
            continue
        data = read(path)
        if data is None:
            continue
        units = _table(data, 0, 196)
        for slot, row in enumerate(units):
            if not any(row[:4]) and row[6] == 0:
                continue
            checked += 1
            if row[0x94] >= len(profiles):
                problems.append({'path': path, 'slot': slot, 'ai': row[0x94]})
    if problems:
        sample = '; '.join(f"{p['path']} unit {p['slot'] + 1}: AI {p['ai']}" for p in problems[:8])
        raise ValueError(f"Cannot apply: {len(problems)} unit assignments reference missing AI profiles. This project has profiles 0–{len(profiles) - 1}. {sample}. Enable AI Plus in this project and Save, or assign profiles present in its AI table.")
    return {'profiles': len(profiles), 'unitsChecked': checked}

def project(config, name, files, removed, generated=None):
    """Use exactly the same project/live/original precedence as project apply."""
    root = config.project_dir(name) / 'files'
    paths = set(files)
    paths.update(generated or {})
    directory = config.resolve('battle/entry')
    if directory.is_dir():
        paths.update(config.rel(p) for p in directory.glob('entry_unit_*.dat') if p.is_file())
    paths.update(removed)
    applied = config.state().get('applied') or {}
    def read(path):
        if generated and path in generated:
            return generated[path]
        if path in files:
            data = (root / path).read_bytes()
            if hashlib.sha1(data).hexdigest() != files[path]['sha1'] or len(data) != files[path]['size']:
                raise ValueError('Project file changed: ' + path)
            return data
        target = config.applied_base(path, applied) if path in removed else config.resolve(path)
        return target.read_bytes() if target is not None and target.is_file() else None
    return validate(read, paths)

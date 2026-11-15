"""Project-owned textures in the four native item and action icon archives."""
import hashlib
import struct

from tools.menu_mods.compiler.spell_icons import TextureArc, replace_single_pak
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd

BANKS = {
    'itemicon': 'item_icon_{:04d}_00',
    'spell_icon': 'icon_spell_{:04d}',
    'skill_icon': 'icon_skill_{:04d}',
    'finishblow_icon': 'icon_finishblow_{:04d}',
}
FIRST_FREE = 2000
LANGUAGES = ('de-de', 'en-us', 'es-es', 'fr-fr', 'ja-jp', 'ko-kr', 'zh-cn', 'zh-tw')


def archive_path(bank):
    return f'menu/texture_x4/{bank}.dat'


def icon_record(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid custom icon')
    bank, ident, label = (value.get(key) for key in ('bank', 'id', 'label'))
    if (not isinstance(bank, str) or bank not in BANKS or type(ident) is not int or not FIRST_FREE <= ident <= 9999
            or not isinstance(label, str) or not label.strip() or len(label) > 80):
        raise ValueError('Choose a valid icon type, slot and name')
    return {'bank': bank, 'id': ident, 'label': label.strip()}


def catalog(values):
    if values is not None and not isinstance(values, list):
        raise ValueError('Invalid custom icon catalog')
    icons = [icon_record(row) for row in values or []]
    if len({identity(row) for row in icons}) != len(icons):
        raise ValueError('Duplicate custom icon slot')
    return icons


def texture_arc(data):
    archive = DatArchive.read(data)
    pack = Pakd(archive.pack)
    return archive, pack, TextureArc(pack.entry(0))


def btx_body(body):
    return body[32:32 + struct.unpack_from('<I', body)[0]]


def append(data, effective, record, btx):
    bank, ident = record['bank'], record['id']
    name = BANKS[bank].format(ident)
    archive, pack, raw = texture_arc(data)
    visible = raw if effective == data else texture_arc(effective)[2]
    if any(occupied(bank, ident, resource.name) for resource in visible.resources):
        raise ValueError(f'Icon slot {ident} is already in use. Rebuild the preview.')
    if len(btx) != 4176 or btx[:4] != b'btx\0' or btx[16] != 13 or btx[18] != 0:
        raise ValueError('Expected a native 64 × 64 BC7 icon texture')
    if struct.unpack_from('<HHI', btx, 8) != (64, 64, 256) or struct.unpack_from('<I', btx, 24)[0] != 80:
        raise ValueError('Invalid icon texture dimensions or pixel data')
    at = struct.unpack_from('<I', btx, 36)[0]
    if not 52 <= at < 80 or btx[at:80].split(b'\0', 1)[0] != name.encode('ascii'):
        raise ValueError('The icon texture name must match its allocated slot')
    result = archive.rebuild(replace_single_pak(pack, raw.append({name: btx})))
    check = next((r for r in texture_arc(result)[2].resources if r.name == name), None)
    if check is None or btx_body(check.body) != btx:
        raise ValueError('Rebuilt icon archive could not be verified')
    return result


def occupied(bank, ident, name):
    expected = BANKS[bank].format(ident)
    return name.startswith(expected[:-2]) if bank == 'itemicon' else name == expected


def identity(row):
    return row['bank'], row['id']


def fingerprint(files, row):
    entry = files.get(archive_path(row['bank']))
    if entry:
        arc = texture_arc(entry[1])[2]
        name = BANKS[row['bank']].format(row['id'])
        texture = next((resource for resource in arc.resources if resource.name == name), None)
        if texture:
            return hashlib.sha256(btx_body(texture.body)).digest()
    return None


def merge_archive(resolve, values):
    """Merge by texture name while preserving the original resource IDs."""
    from integrated_content import rebuild_textures

    archive, pack, original = texture_arc(values[0])
    arcs = [original, *(texture_arc(data)[2] for data in values[1:])]
    banks = [{r.name: r.body for r in arc.resources} for arc in arcs]
    selected = {}
    for name in dict.fromkeys(key for bank in banks for key in bank):
        body = resolve(name, *(bank.get(name) for bank in banks))
        if body is not None:
            selected[name] = body
    if banks[0].keys() - selected.keys():
        raise ValueError('A base icon was removed')
    additions = {name: btx_body(body) for name, body in selected.items() if name not in banks[0]}
    appended = TextureArc(original.append(additions))
    bodies = {r.name: selected[r.name] if r.name in banks[0] else r.body for r in appended.resources}
    return archive.rebuild(replace_single_pak(pack, rebuild_textures(appended, bodies)))

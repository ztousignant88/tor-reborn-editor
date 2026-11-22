"""Edit the generated view of a project while retaining its ungenerated source."""
import struct
import battle_encounters

from ai_choices_data import rebuild_pakd
from project_merge_formats import BATTLE, MENU, TABLES, fields, pure_rows, table_tail
from tools.menu_mods.compiler.class_text import Txte
from tools.menu_mods.compiler.spell_icons import TextureArc, align
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd, Xlce


SETTINGS = ('rougesReborn', 'throwReborn', 'proficiencyII', 'specialClassChange',
            'aiChoices', 'dorgaluaXLFix', *battle_encounters.FIGHTS)
KEY = 'integratedContentEdits'


def preview_path(path):
    return (path in (BATTLE, MENU) or path.startswith(('localize/LocalizeText_', 'menu/texture_x4/'))
            or battle_encounters.preview_path(path))


def archive_parts(data):
    archive = DatArchive.read(data)
    return archive, Pakd(archive.pack)


def text_keys(base, generated):
    """Some restored records use stock text keys already present in the archives."""
    if not generated or generated == base:
        return set()
    raw, view = (archive_parts(data)[1] for data in (base, generated))
    sources = {11: ('ARMSTEXT_LC_ARMS_', 0x86, 0x62),
               13: ('COMMODITYTEXT_LC_COMMODITY_', None, None),
               16: ('EFFECTTEXT_LC_EFFECT_', 0x94, 0x16),
               25: ('SKILLTEXT_LC_SKILL_', 0x5a, 0x5c)}
    keys = set()
    for entry, (prefix, name, help_) in sources.items():
        before, after = Xlce(raw.entry(entry)), Xlce(view.entry(entry))
        for i in range(after.count):
            record = after.row(i)
            if i < before.count and record == before.row(i):
                continue
            for offset, suffix in ((name, 'NAME'), (help_, 'HELP')):
                ident = i if offset is None else int.from_bytes(record[offset:offset+2], 'little')
                if ident:
                    keys.add(f'{prefix}{ident:03}_{suffix}')
    return keys


def rebuilt(archive, pack, replacements):
    return archive.rebuild(rebuild_pakd(pack, replacements)) if replacements else archive.original


def textures(arc):
    return {record.name: record.body for record in arc.resources}


def rebuild_textures(arc, replacements):
    if replacements == textures(arc):
        return arc.data
    if replacements.keys() != textures(arc).keys():
        raise ValueError('An integrated texture archive must retain its resource names')
    count = len(arc.resources)
    first = align(48+4*count)+sum(len(r.record) for r in arc.resources)
    offsets, data = [], bytearray()
    for r in sorted(arc.resources, key=lambda record: record.index):
        offsets.append(first+len(data))
        data.extend(replacements[r.name])
    header = (arc.data[:48]+struct.pack(f'<{count}I', *offsets)).ljust(align(48+4*count), b'\0')
    rebuilt = header+b''.join(r.record for r in arc.resources)+data+arc.trailer
    if textures(TextureArc(rebuilt)) != replacements:
        raise ValueError('Integrated texture rebuild could not be verified')
    return rebuilt


def rows(table, shop):
    result = {}
    for i in range(table.count):
        row = table.row(i)
        key = str(int.from_bytes(row[:2], 'little') if shop else i)
        if key in result:
            raise ValueError('The shop has duplicate rows for item '+key)
        result[key] = row
    return result


def rebuild_rows(table, old, edited, shop):
    if edited == old:
        return table.data
    if edited.keys() == old.keys():
        return table.replace({i: edited[key] for i, key in enumerate(old) if old[key] != edited[key]})
    if not pure_rows(table):
        raise ValueError('This table has trailing data and cannot be resized in the generated view')
    if shop:
        result = list(edited.values())
    else:
        count = max(map(int, edited), default=-1)+1
        result = [edited.get(str(i), bytes(table.row_size)) for i in range(count)]
    header = bytearray(table.data[:table.header])
    struct.pack_into('<I', header, 4, len(result))
    data = bytes(header)+b''.join(result)
    return data+b'\0'*(16-len(data)%16)


def row_edits(path, entry, before, after, current):
    if len(current) != len(before) or len(before) != len(after):
        raise ValueError('The layout of an edited integrated mod record changed')
    schema = ('shop' if path == MENU and entry == 26 else
              'skill' if path == BATTLE and entry == 25 else TABLES.get(entry, ('', None))[1])
    result = bytearray(current)
    cursor = 0
    for start, end, _ in [*fields(schema, len(before)), (len(before), len(before), None)]:
        for i in range(cursor, start):
            if before[i] != after[i]:
                result[i] = after[i]
        if before[start:end] != after[start:end]:
            result[start:end] = after[start:end]
        cursor = end
    return bytes(result)


def replay(path, base, generated, edits, owned_text=()):
    if not edits:
        return generated
    _, raw = archive_parts(base)
    archive, view = archive_parts(generated)
    changes = {}
    for index, records in edits.items():
        i = int(index)
        old, new = raw.entry(i), view.entry(i)
        if not records or (old == new and not (new.startswith(b'txte') and owned_text)):
            continue
        if new.startswith(b'xlce'):
            shop = path == MENU and i == 26
            raw_rows = rows(Xlce(old), shop)
            table = Xlce(new)
            defaults = rows(table, shop)
            replacements = dict(defaults)
            for key, (before, after) in records.items():
                row = defaults.get(key)
                if row is not None and row != raw_rows.get(key):
                    before, after = bytes.fromhex(before), bytes.fromhex(after)
                    # A disabled or differently sized record has no live override.
                    if len(row) == len(before):
                        replacements[key] = row_edits(path, i, before, after, row)
            changes[i] = rebuild_rows(table, defaults, replacements, shop)
        elif new.startswith(b'txte'):
            raw_text, table = Txte(old).mapping(), Txte(new)
            defaults = table.mapping()
            changes[i] = table.rebuild({key: bytes.fromhex(after) for key, (_, after) in records.items()
                                        if key in owned_text or (key in defaults and defaults[key] != raw_text.get(key))})
        elif new.startswith(b'ARC\0') and path.startswith('menu/texture_x4/'):
            native, arc = textures(TextureArc(old)), TextureArc(new)
            replacements = textures(arc)
            replacements.update({key: bytes.fromhex(after) for key, (_, after) in records.items()
                                 if key in replacements and replacements[key] != native.get(key)})
            changes[i] = rebuild_textures(arc, replacements)
        else:
            raise ValueError('Unsupported integrated edit entry '+index)
    return rebuilt(archive, view, {i: data for i, data in changes.items() if data != view.entry(i)})


def split(path, base, generated, effective, submitted, saved, owned_text=()):
    """Store ordinary edits in the source and edits to generated records separately."""
    base_archive, raw = archive_parts(base)
    _, defaults = archive_parts(generated)
    _, current = archive_parts(effective)
    _, edited = archive_parts(submitted)
    if len({len(p) for p in (raw, defaults, current, edited)}) != 1:
        raise ValueError('The archive layout changed. Reload the project before editing integrated content.')
    overrides = {i: dict(records) for i, records in saved.items()}
    replacements = {}
    for i in range(len(raw)):
        original, default, old, new = (p.entry(i) for p in (raw, defaults, current, edited))
        if old == new:
            continue
        if original == default and not (default.startswith(b'txte') and owned_text):
            replacements[i] = new
            continue
        key = str(i)
        records = overrides.setdefault(key, {})
        if all(data.startswith(b'xlce') for data in (original, default, old, new)):
            raw_table, default_table, old_table, new_table = map(Xlce, (original, default, old, new))
            if old_table.row_size != new_table.row_size or old_table.header != new_table.header:
                raise ValueError('The integrated record layout changed. Reload before saving.')
            shop = path == MENU and i == 26
            native, baseline, before, after = [rows(t, shop) for t in (raw_table, default_table, old_table, new_table)]
            source = dict(native)
            update_records(native, baseline, before, after, source, records, f'{path}, table {i}')
            if any(len(row) != raw_table.row_size for row in source.values()):
                raise ValueError('New records in an expanded permission table must use its original layout')
            replacements[i] = rebuild_rows(raw_table, native, source, shop)
        elif all(data.startswith(b'txte') for data in (original, default, old, new)):
            raw_text, default_text, old_text, new_text = map(Txte, (original, default, old, new))
            native, baseline, before, after = [t.mapping() for t in (raw_text, default_text, old_text, new_text)]
            source = dict(native)
            update_records(native, baseline, before, after, source, records, f'{path}, text table {i}', owned_text)
            replacements[i] = raw_text.rebuild({k: v for k, v in source.items() if native.get(k) != v},
                                               removals=native.keys()-source.keys())
        elif path.startswith('menu/texture_x4/') and all(data.startswith(b'ARC\0') for data in (original, default, old, new)):
            raw_arc, default_arc, old_arc, new_arc = map(TextureArc, (original, default, old, new))
            if {r.name: r.identifier for r in old_arc.resources} != {r.name: r.identifier for r in new_arc.resources}:
                raise ValueError('An integrated texture archive must retain its resource IDs')
            native, baseline, before, after = [textures(arc) for arc in (raw_arc, default_arc, old_arc, new_arc)]
            source = dict(native)
            update_records(native, baseline, before, after, source, records, f'{path}, textures')
            replacements[i] = rebuild_textures(raw_arc, source)
        else:
            raise ValueError(f'{path}, entry {i} has an integrated layout that cannot be edited directly')
        if not records:
            overrides.pop(key, None)
    return rebuilt(base_archive, raw, {i: d for i, d in replacements.items() if d != raw.entry(i)}), overrides


def update_records(native, defaults, before, after, source, overrides, label, owned=()):
    for key in dict.fromkeys((*before, *after)):
        prior, new = before.get(key), after.get(key)
        if prior == new:
            continue
        default = defaults.get(key)
        if default != native.get(key) or key in owned:
            if new is None:
                raise ValueError(f'{label}: integrated record {key} must exist while its mod is enabled')
            if default == new:
                overrides.pop(key, None)
            else:
                overrides[key] = [(default or b'').hex(), new.hex()]
        elif new is None:
            source.pop(key, None)
        else:
            source[key] = new

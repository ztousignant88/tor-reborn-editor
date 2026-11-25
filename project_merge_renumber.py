"""Give clashing new records in the incoming project the next free IDs before a merge.

Two projects made from the same game data each give their new items, spells and
abilities, equipment, classes and character sheets the first free ID *of that
project*, so both often use the same number for different things. The merge would
then have to keep one side's linked files whole. When it is safe, this moves the
incoming project's clashing records to IDs neither project uses and rewrites what
refers to them in the incoming project's changes:

  * the record itself (its own ID fields and text IDs, with its texts moved along)
  * spells/abilities used by equipment, items and skills
  * units in battle entry files (character sheet, class, equipment, items, drops)
  * shop rows (items and equipment)
  * project characters' character sheet numbers

It is safe only when nothing else the incoming project changed could refer to the
old ID. Changed bytes elsewhere that hold the old ID mean the rewrite would be a
guess, so the merge falls back to keeping one side's linked files, with the reason.
"""
import re
import struct

from ai_choices_data import rebuild_pakd
from tools.menu_mods.compiler.class_text import Txte
from tools.menu_mods.compiler.loadout_controls import ENTRY_SPELL_TAGS, ENTRY_SPELL_ID_MASK
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd, Xlce

BATTLE = 'battle/battle_data_release.dat'
MENU = 'menu/menu_data.dat'
LOCALIZE = re.compile(r'localize/LocalizeText_[\w-]+\.dat')
ENTRY = re.compile(r'battle/entry/entry_unit_\w+\.dat', re.I)
ITEM_BASE = 1000

# table: title, can grow, own-ID fields, (name ID field, description ID field), text prefix, width, suffixes
KINDS = {
    13: dict(title='Item', grow=True, limit=1000, base=ITEM_BASE, own=(0x30, 0x2A, 0x0A),
             text=('COMMODITYTEXT_LC_COMMODITY_', 3, ('_NAME', '_HELP'))),
    16: dict(title='Spell / ability', grow=True, limit=0xFFFF, base=0, own=(),
             names=(0x94, 0x16), text=('EFFECTTEXT_LC_EFFECT_', 3, ('_NAME', '_HELP'))),
    11: dict(title='Equipment', grow=False, base=0, own=(0x90,),
             names=(0x86, 0x62), text=('ARMSTEXT_LC_ARMS_', 3, ('_NAME', '_HELP'))),
    14: dict(title='Class', grow=False, base=0, own=(),
             names=(0xB2, 0xB4), text=('CLASS_TEXT_DATA_CLASS', 4, ('_MALE', '_FEMALE', '_HELP'))),
    23: dict(title='Character sheet', grow=True, limit=0xFFFF, base=0, own=()),
}
# where battle tables refer to other records: referring table -> [(offset, referred table)]
TABLE_REFS = {11: [(0x44, 16)], 13: [(0x04, 16)], 25: [(0x04, 16)]}
# unit rows (196 bytes): offset, size, referred kind ('item' = equipment below 1000, items from 1000)
UNIT_REFS = ([(0x02, 2, 23), (0x06, 1, 14)] + [(0x4A + 4*k, 2, 11) for k in range(7)]
             + [(0x66 + 4*k, 2, 'item') for k in range(4)] + [(0x76 + 4*k, 2, 'item') for k in range(4)])
UNIT_GUESS = [(0x86 + 2*k, 16) for k in range(4)] + [(0x9C + 2*k, 16) for k in range(8)]  # spells, finishers
SHOP_REFS = [(0x00, 2, 'item')]


class Unsafe(Exception):
    pass


def u16(data, at):
    return struct.unpack_from('<H', data, at)[0]


def put16(row, at, value):
    struct.pack_into('<H', row, at, value)


def unused(index, original, named_classes):
    return (index == 11 and original[0x86:0x88] == b'\0\0' or index == 13 and original[2] == 0
            or index == 14 and u16(original, 0xB2) not in named_classes)


def table_bytes(template, rows):
    header = bytearray(template.data[:template.header])
    struct.pack_into('<I', header, 4, len(rows))
    data = bytes(header) + b''.join(rows)
    return data + b'\0'*(16 - len(data) % 16)


def text_tables(data):
    """{entry index: Txte} of a localize archive."""
    pack = Pakd(DatArchive.read(data).pack)
    return pack, {i: Txte(pack.entry(i)) for i in range(len(pack)) if pack.entry(i).startswith(b'txte')}


def all_keys(data):
    if data is None:
        return {}
    _, tables = text_tables(data)
    out = {}
    for t in tables.values():
        out.update(t.mapping())
    return out


def keys_for(kind, ident):
    prefix, width, suffixes = KINDS[kind]['text']
    return [f'{prefix}{ident:0{width}d}{s}' for s in suffixes]


def changed_positions(base, data):
    """Offsets (even and odd) whose u16 overlaps a byte the incoming project changed."""
    for at in range(len(data) - 1):
        if at + 1 >= len(base) or data[at] != base[at] or data[at + 1] != base[at + 1]:
            yield at


def renumber(config, current, incoming, left, right, named_classes, find_base, english, known=None):
    """Return (incoming files, incoming editor settings, notes), or raise Unsafe(reason).

    Returns None when there is nothing to renumber."""
    if BATTLE not in left or BATTLE not in right or left[BATTLE][1] == right[BATTLE][1]:
        return None
    (a, l_data), (b, r_data) = left[BATTLE], right[BATTLE]
    if a != b:
        return None
    base_data = find_base(config, BATTLE, a)
    if base_data is None:
        return None
    archives = [DatArchive.read(d) for d in (base_data, l_data, r_data)]
    packs = [Pakd(x.pack) for x in archives]
    if len({len(p) for p in packs}) != 1:
        return None

    # ---- which incoming records clash, and where they go ----
    moves = {}            # table -> {old: new}
    settled = set()       # (table, ID) rows the incoming side now shares with the current one
    new_tables = {}       # table -> rebuilt incoming table bytes
    text_moves = []       # (kind, old text ID, new text ID) for texts keyed by name IDs or item slots
    l_text, r_text = all_keys(left.get(english, (None, None))[1]), all_keys(right.get(english, (None, None))[1])
    base_text = all_keys(find_base(config, english, (left.get(english) or right.get(english) or (None,))[0])) \
        if english in left or english in right else None
    if base_text is None:
        backup = config.backup_root/english
        path = backup if backup.is_file() else config.resolve(english)
        base_text = all_keys(path.read_bytes()) if path.is_file() else {}
    l_text = l_text or base_text
    r_text = r_text or base_text

    def texts_of(kind, row, slot, mapping):
        if 'names' in KINDS[kind]:
            n, d = (u16(row, o) for o in KINDS[kind]['names'])
            prefix, width, suffixes = KINDS[kind]['text']
            return tuple(mapping.get(k) for k in keys_for(kind, n)[:-1] + [f'{prefix}{d:0{width}d}{suffixes[-1]}'])
        if 'text' in KINDS[kind]:
            return tuple(mapping.get(k) for k in keys_for(kind, slot))
        return ()

    for kind, spec in KINDS.items():
        old, lt, rt = (Xlce(p.entry(kind)) for p in packs)
        if len({(t.header, t.row_size) for t in (old, lt, rt)}) != 1:
            continue
        if min(lt.count, rt.count) < old.count:
            continue
        clash = []
        for ident in range(1, min(lt.count, rt.count)):
            x, y = lt.row(ident), rt.row(ident)
            if ident >= old.count:
                if x != y or kind == 23 or texts_of(kind, x, ident, l_text) != texts_of(kind, y, ident, r_text):
                    clash.append(ident)
                continue
            original = old.row(ident)
            if x != original and y != original and x != y and unused(kind, original, named_classes):
                clash.append(ident)
        if not clash and not (known or {}).get(kind):
            continue
        rows = [rt.row(i) for i in range(rt.count)]
        top = max(lt.count, rt.count)
        rows += [lt.row(i) for i in range(rt.count, top)]
        settled.update((kind, i) for i in range(old.count, top))
        taken = set()
        mapping = {}
        for ident in clash:
            same = (known or {}).get(kind, {}).get(ident)
            if same is not None:
                # already in the current project under another ID: refer to that one
                rows[ident] = old.row(ident) if ident < old.count else lt.row(ident)
                mapping[ident] = same
                continue
            target = None
            if not spec['grow'] or (kind == 13 and ident < old.count):
                target = next((i for i in range(1, old.count) if i not in taken and i not in clash
                               and unused(kind, old.row(i), named_classes)
                               and lt.row(i) == old.row(i) and rt.row(i) == old.row(i)
                               and not any(k in t for t in (l_text, r_text) for k in
                                           (keys_for(kind, i) if kind == 13 else ()))), None)
            if target is None and spec['grow']:
                target = len(rows)
                if target >= spec['limit']:
                    raise Unsafe(f"{spec['title']} IDs are full, so incoming {spec['title'].lower()} #{ident} "
                                 'cannot get a new number.')
                rows.append(None)
            if target is None:
                raise Unsafe(f"No unused {spec['title'].lower()} row is left for incoming "
                             f"{spec['title'].lower()} #{ident}.")
            taken.add(target)
            moved = bytearray(rt.row(ident))
            for at in spec['own']:
                if u16(moved, at) == ident + spec['base']:
                    put16(moved, at, target + spec['base'])
            rows[target] = bytes(moved)
            rows[ident] = old.row(ident) if ident < old.count else lt.row(ident)
            mapping[ident] = target
            if kind == 13:
                text_moves.append((kind, ident, target))
        for ident, same in (known or {}).get(kind, {}).items():
            mapping.setdefault(ident, same)
        if not mapping:
            continue
        moves[kind] = mapping
        new_tables[kind] = (rt, rows)

    if not moves:
        return None

    # ---- texts keyed by name IDs: move them when the current project uses the same name ID ----
    def name_fields(t, rows=None):
        rows = rows if rows is not None else [t.row(i) for i in range(t.count)]
        return rows

    for kind in (16, 11, 14):
        if kind not in moves:
            continue
        old, lt = Xlce(packs[0].entry(kind)), Xlce(packs[1].entry(kind))
        rt, rows = new_tables[kind]
        fields = KINDS[kind]['names']
        prefix, width, _ = KINDS[kind]['text']
        used = {u16(r, o) for t in (old, lt) for r in (t.row(i) for i in range(t.count)) for o in fields}
        used |= {u16(r, o) for r in rows for o in fields}
        text_keys = {k for t in (base_text, l_text, r_text) for k in t}
        renames = {}
        for new in moves[kind].values():
            row = bytearray(rows[new])
            for at in fields:
                n = u16(row, at)
                if n == 0:
                    continue
                if n not in renames:
                    mine = [k for k in text_keys if k.startswith(f'{prefix}{n:0{width}d}_')]
                    in_base = any(k in base_text for k in mine)
                    in_current = any(l_text.get(k) != r_text.get(k) for k in mine if k in l_text) or any(
                        u16(lt.row(i), o) == n and (i >= old.count or lt.row(i) != old.row(i))
                        for i in range(lt.count) for o in fields)
                    if in_base or not in_current:
                        renames[n] = n
                    else:
                        free = next(i for i in range(1, 10**width)
                                    if i not in used and not any(k.startswith(f'{prefix}{i:0{width}d}_') for k in text_keys))
                        used.add(free)
                        renames[n] = free
                        text_moves.append((kind, n, free))
                put16(row, at, renames[n])
            rows[new] = bytes(row)

    # ---- rewrite references in the incoming battle data ----
    def value(kind, ident):
        return ident + KINDS[kind]['base']

    by_value = {}
    for kind, mapping in moves.items():
        for o, n in mapping.items():
            by_value.setdefault(kind, {})[value(kind, o)] = value(kind, n)

    def remap_item(v):
        if v >= ITEM_BASE:
            return by_value.get(13, {}).get(v, v)
        return by_value.get(11, {}).get(v, v)

    replacements = {}
    base_pack, r_pack = packs[0], packs[2]
    tables = {kind: rows for kind, (_, rows) in new_tables.items()}
    for kind in set(TABLE_REFS) | set(tables):
        refs = [(at, to) for at, to in TABLE_REFS.get(kind, []) if to in by_value]
        if not refs and kind not in tables:
            continue
        rt = Xlce(r_pack.entry(kind))
        old = Xlce(base_pack.entry(kind))
        rows = tables.get(kind) or [rt.row(i) for i in range(rt.count)]
        out = []
        for i, row in enumerate(rows):
            if refs and (i >= old.count or row != old.row(i)):
                row = bytearray(row)
                for at, to in refs:
                    put16(row, at, by_value[to].get(u16(row, at), u16(row, at)))
                row = bytes(row)
            out.append(row)
        replacements[kind] = table_bytes(rt, out) if kind in tables else rt.replace(
            {i: r for i, r in enumerate(out) if r != rt.row(i)})

    # anything else the incoming project changed that holds an old ID is a reference we cannot rewrite
    watched = {v for mapping in by_value.values() for v in mapping}
    handled = set(KINDS) | set(TABLE_REFS)
    for index in range(len(r_pack)):
        if index in handled:
            continue
        before, after = base_pack.entry(index), r_pack.entry(index)
        if before == after:
            continue
        for at in changed_positions(before, after):
            if u16(after, at) in watched and u16(after, at) > 1:
                raise Unsafe(f'Battle data table {index} in {incoming} changed bytes that hold ID {u16(after, at)}, '
                             'which may refer to a renumbered record.')

    files = dict(right)
    pack = rebuild_pakd(r_pack, replacements)
    files[BATTLE] = (b, archives[2].rebuild(pack))

    # ---- units in battle entry files, and shops ----
    for path in sorted(right):
        if not (ENTRY.fullmatch(path) or path == MENU):
            continue
        original, data = right[path]
        base = find_base(config, path, original)
        if base is None:
            raise Unsafe(f'The original of {path} is unavailable, so its references cannot be checked.')
        arch, barch = DatArchive.read(data), DatArchive.read(base)
        p, bp = Pakd(arch.pack), Pakd(barch.pack)
        if len(p) != len(bp):
            raise Unsafe(f'{path} has a different layout in {incoming}.')
        reps = {}
        for index in range(len(p)):
            entry, before = p.entry(index), bp.entry(index)
            if entry == before:
                continue
            if path == MENU and index != 26 or not entry.startswith(b'xlce'):
                for at in changed_positions(before, entry):
                    if u16(entry, at) in watched and u16(entry, at) >= ITEM_BASE and 13 in by_value:
                        raise Unsafe(f'{path} (part {index}) changed bytes that hold item ID {u16(entry, at)}.')
                continue
            t, bt = Xlce(entry), Xlce(before)
            refs = SHOP_REFS if path == MENU else UNIT_REFS
            changes = {}
            for i in range(t.count):
                row = t.row(i)
                if i < bt.count and row == bt.row(i):
                    continue
                if t.row_size < max(at + size for at, size, _ in refs):
                    raise Unsafe(f'{path} uses an unknown row layout.')
                row = bytearray(row)
                for at, size, to in refs:
                    v = row[at] if size == 1 else u16(row, at)
                    n = remap_item(v) if to == 'item' else by_value.get(to, {}).get(v, v)
                    if n != v:
                        if size == 1:
                            if n > 255:
                                raise Unsafe(f'A unit in {path} stores its class in one byte; class #{n} does not fit.')
                            row[at] = n
                        else:
                            put16(row, at, n)
                if path != MENU:
                    if t.row_size == 196 and all(
                        u16(row, 0x42 + 2*k) & 0xf000 == tag for k, tag in enumerate(ENTRY_SPELL_TAGS)
                    ):
                        for k, tag in enumerate(ENTRY_SPELL_TAGS):
                            at = 0x42 + 2*k
                            effect = u16(row, at) & ENTRY_SPELL_ID_MASK
                            replacement = by_value.get(16, {}).get(effect, effect)
                            if replacement > ENTRY_SPELL_ID_MASK:
                                raise Unsafe(f'A unit in {path} uses an extra spell slot. Effect #{replacement} does not fit.')
                            put16(row, at, tag | replacement)
                    for at, to in UNIT_GUESS:
                        if to in by_value and u16(row, at) in by_value[to]:
                            raise Unsafe(f'A unit in {path} lists ID {u16(row, at)} as a spell or finisher, '
                                         'which may be a renumbered ability.')
                changes[i] = bytes(row)
            if changes:
                reps[index] = t.replace({i: r for i, r in changes.items() if r != t.row(i)})
        if reps:
            files[path] = (original, arch.rebuild(rebuild_pakd(p, reps)))

    # ---- texts follow their records ----
    notes = []
    names = {}
    for kind, old_id, new_id in text_moves:
        old_keys, new_keys = keys_for(kind, old_id), keys_for(kind, new_id)
        for path in sorted(right):
            if not LOCALIZE.fullmatch(path):
                continue
            original, data = files[path]
            base = find_base(config, path, original)
            base_map = all_keys(base) if base is not None else {}
            arch = DatArchive.read(data)
            pack, parsed = text_tables(data)
            reps = {}
            for index, t in parsed.items():
                current = t.mapping()
                changes, removals = {}, []
                for ok, nk in zip(old_keys, new_keys):
                    if ok not in current or current.get(ok) == base_map.get(ok) and ok in base_map:
                        continue
                    changes[nk] = current[ok]
                    if ok in base_map:
                        changes[ok] = base_map[ok]
                    else:
                        removals.append(ok)
                    if path == english and ok.endswith(('_NAME', '_MALE')):
                        names[(kind, new_id)] = current[ok].decode('utf-8', 'replace')
                if changes or removals:
                    reps[index] = t.rebuild(changes, removals)
            if reps:
                files[path] = (original, arch.rebuild(rebuild_pakd(pack, reps)))

    editor = dict(incoming)
    if 23 in moves and editor.get('customCharacters'):
        editor['customCharacters'] = [
            {**c, 'template': moves[23].get(c.get('template'), c.get('template'))} if isinstance(c, dict) else c
            for c in editor['customCharacters']]
    for kind, mapping in moves.items():
        for o, n in mapping.items():
            label = KINDS[kind]['title']
            text_id = n if kind == 13 else None
            name = names.get((kind, text_id)) if text_id is not None else None
            notes.append(f'{label} #{o} from the incoming project is now #{n}' + (f' ({name})' if name else '') + '.')
    return files, editor, notes, settled

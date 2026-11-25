"""Attach eight-button controls to the spell and skill sections of Unit Details."""

import struct
from hashlib import sha256

from ai_choices_data import rebuild_pakd
from . import loadout_layout
from .spell_icons import align, name_hash
from .tor_formats import DatArchive, Pakd


ITEM_PART = 'pt_organize_equip_items'
LOADOUT_PART = 'pt_organize_equip_slots'
ITEM_ROW_LIFT = 7
PART_INDEX = 37
KEY = 'expandedLoadout'
PARTS_PATH = 'menu/menu_parts.dat'
PATHS = (loadout_layout.PATH, PARTS_PATH)

# The four spare words after skill slot 8 carry tagged battle spell effect IDs.
ENTRY_SPELL_TAGS = (0xd000, 0xe000, 0xf000, 0xc000)
ENTRY_SPELL_ID_MASK = 0x0fff


def write_entry_spells(row, effects):
    """Write a battle roster's stock effects and optional extra bank."""
    for i, ident in enumerate(effects[:4]):
        struct.pack_into("<H", row, 0x86 + 2 * i, ident)
    if len(effects) > 4:
        extra = list(effects[4:8])
        extra.extend([0] * (4 - len(extra)))
        if any(not 0 <= effect <= ENTRY_SPELL_ID_MASK for effect in extra):
            raise ValueError("Spell effect IDs in slots 5–8 must be between 0 and 4095.")
        for i, (tag, effect) in enumerate(zip(ENTRY_SPELL_TAGS, extra, strict=True)):
            struct.pack_into("<H", row, 0x42 + 2 * i, tag | effect)


def project(read):
    layout, parts = (read(path) for path in PATHS)
    return dict(zip(PATHS, build(loadout_layout.build(layout), parts)))


def ini(read):
    layout, parts = (sha256(read(path)).hexdigest() for path in PATHS)
    return f'\r\n[ExpandedLoadout]\r\nEnabled=1\r\nLayoutSHA256={layout}\r\nPartsSHA256={parts}\r\n'.encode('ascii')


def _eight_buttons(part):
    data = bytearray(part)
    if struct.unpack_from('<I', part, 8)[0] != len(part):
        raise ValueError('Unsupported equipment-control part header')
    root = loadout_layout._node(data, 'root', 4)
    grid = loadout_layout._node(data, 'list', 5)
    button = loadout_layout._node(data, 'list_item_button', 10)
    values = (
        (root, -0x4c, '<f', (112,), (176,)),
        (grid, -0x4c, '<f', (80,), (144,)),
        (button, -0x4c, '<f', (75,), (64,)),
        (grid, 0x170, '<2f2I2H', (68, 80, 0xffffffff, 0xffffffff, 1, 4),
         (68, 64, 0xffffffff, 0xffffffff, 2, 4)),
    )
    for node, offset, fmt, old, new in values:
        loadout_layout._replace(data, node, offset, fmt, old, new)
    return bytes(data)


def _append_part(arc):
    locations = loadout_layout._resources(arc)
    if set(locations) != {ITEM_PART} or struct.unpack_from('<HH', arc, 6) != (1, 1):
        raise ValueError('Equipment controls archive no longer contains one stock part')
    record_at = align(48 + 4)
    body_at, = struct.unpack_from('<I', arc, 48)
    record = arc[record_at:body_at]
    start, end = locations[ITEM_PART]
    if record[:4] != b'lyt\0' or start < body_at + 8 or name_hash(ITEM_PART) != struct.unpack_from('<I', record, 8)[0]:
        raise ValueError('Invalid equipment controls resource identity')
    size = record[14]
    new_name = (LOADOUT_PART.encode('ascii') + b'\0').ljust(size, b'\0')
    if len(new_name) != size:
        raise ValueError('Equipment control name does not fit its native record')
    other = bytearray(record)
    other[20:20 + size] = new_name
    struct.pack_into('<HI', other, 6, 1, name_hash(LOADOUT_PART))
    struct.pack_into('<I', other, 16, 1)

    # Both ARC directory rows are sorted by their names' hashes. The physical
    # bodies keep their index order, and the stock resource retains ID 0.
    directory = b''.join(sorted((record, bytes(other)), key=lambda row: struct.unpack_from('<I', row, 8)[0]))
    bodies = align(48 + 8) + len(directory)
    header = bytearray(arc[:48])
    struct.pack_into('<HH', header, 6, 2, 2)
    native = bytearray(arc[body_at:body_at + align(end - body_at)])
    item = bytearray(arc[start:end])
    # The part contains both the header bar and the picker. Move the list
    # inside the part so the bar stays at its original position.
    grid = loadout_layout._node(item, 'list', 5)
    loadout_layout._replace(item, grid, -0x5c, '<f', (40,), (40 - ITEM_ROW_LIFT,))
    native[start - body_at:end - body_at] = item
    footer = arc[body_at + len(native):]
    if len(footer) > 63 or any(footer):
        raise ValueError('Unexpected data after the stock equipment control')
    pointers = struct.pack('<II', bodies, bodies + len(native)).ljust(align(48 + 8) - 48, b'\0')
    part = _eight_buttons(arc[start:end])
    out = bytes(header) + pointers + directory + native + arc[body_at:start] + part
    out += bytes(-len(out) % 32) + footer
    result = loadout_layout._resources(out)
    if result.keys() != {ITEM_PART, LOADOUT_PART}:
        raise ValueError('Added equipment control could not be found after rebuilding')
    return out


def _align_finishers(layout):
    # Finishers have their own lists. Match the gap below the header and the
    # row spacing used by Spells and Skills in both the tiles and the picker.
    for name, kind, old_y, new_y in (
        ('image_04_copy_14', 1, 43, 37),
        ('parts_equip_finisher_select_frame', 8, 28, 21),
        ('parts_equip_finisher_highlight_frame', 8, 37, 31),
        ('list_equip_finisher', 5, 39, 33),
        ('parts_finifher_equip_item_icon', 8, -1, -2),
    ):
        node = loadout_layout._node(layout, name, kind)
        loadout_layout._replace(layout, node, -0x5c, '<f', (old_y,), (new_y,))
    for name in ('list_zabuton_04', 'list_equip_finisher'):
        grid = loadout_layout._node(layout, name, 5)
        loadout_layout._replace(layout, grid, 0x174, '<f', (68,), (64,))


def build(layout_data, parts_data):
    """Return native archives for the expanded Unit Details controls."""
    base = DatArchive.read(layout_data)
    menus = Pakd(base.pack)
    unit_screen = bytearray(menus.entry(loadout_layout.ARCHIVE_INDEX))
    start, end = loadout_layout._resources(unit_screen)[loadout_layout.SCREEN]
    layout = bytearray(unit_screen[start:end])
    # Move the tiles and focus frames with the list, keeping the part origin.
    loadout_layout._lift_row(layout, 'item', '05', ITEM_ROW_LIFT, (46, None, 28, 39))
    for section, tile in (('spell', '08'), ('skill', '11')):
        # Steam loads the same list by its compiled resource name for all
        # three sections. Match the outer slot frames to the list's new origin.
        loadout_layout._lift_row(layout, section, tile, ITEM_ROW_LIFT, (32, None, 15, 25))
        node = loadout_layout._node(layout, f'parts_equip_items_{section}', 8)
        source_name, target_name = (name.encode('ascii') + b'.lyp\0' for name in (ITEM_PART, LOADOUT_PART))
        at = layout.find(source_name, node + 0x170, node + 0x1e0)
        if at < 0 or len(source_name) != len(target_name):
            raise ValueError(f'Could not find the native {section} control reference')
        layout[at:at + len(source_name)] = target_name
    _align_finishers(layout)
    unit_screen[start:end] = layout
    menu_result = base.rebuild(menus.replace({loadout_layout.ARCHIVE_INDEX: unit_screen}))
    parts_base = DatArchive.read(parts_data)
    parts = Pakd(parts_base.pack)
    parts_result = parts_base.rebuild(rebuild_pakd(parts, {PART_INDEX: _append_part(parts.entry(PART_INDEX))}))
    return menu_result, parts_result

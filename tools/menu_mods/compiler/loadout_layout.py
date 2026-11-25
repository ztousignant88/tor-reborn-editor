"""Patch the native Unit Details layout for a two-row spell and skill preview."""

import struct

from .tor_formats import DatArchive, Pakd


PATH = 'menu/menu_layout.dat'
SCREEN = 'mn_organize_unit_detail'
ARCHIVE_INDEX = 49
# The texture overlays use 4-pixel BC7 blocks and a half-resolution canvas on Steam.
# Choose section positions near the reference that can reuse whole native blocks.
SECTION_Y = {'item': (330, 330), 'spell': (458, 443),
             'skill': (582, 611), 'finisher': (707, 763)}
EARLIER_PREVIEW_Y = (314, 419, 579, 739)
CAPTION_Y = 16


def _resources(arc):
    if arc[:6] != b'ARC\0\0\x01':
        raise ValueError('Unsupported Unit Details resource archive')
    count, offsets = struct.unpack_from('<HH', arc, 6)
    current = (48 + offsets * 4 + 31) & ~31
    result = {}
    for _ in range(count):
        index = struct.unpack_from('<H', arc, current + 6)[0]
        name_length = arc[current + 14]
        name = arc[current + 20:current + 20 + name_length].split(b'\0', 1)[0].decode('ascii')
        if index >= offsets or name in result:
            raise ValueError('Invalid Unit Details resource index')
        record = struct.unpack_from('<I', arc, 48 + 4 * index)[0]
        length, header_size = struct.unpack_from('<IH', arc, record)
        start, end = record + header_size, record + header_size + length
        if header_size < 8 or end > len(arc):
            raise ValueError('Truncated Unit Details resource')
        result[name] = (start, end)
        current = (current + 20 + name_length + 31) & ~31
    return result


def _node(layout, name, kind):
    key = name.encode('ascii') + b'\0'
    positions = [at for at in range(0x70, len(layout) - 0x190, 16)
                 if layout[at:at + len(key)] == key
                 and struct.unpack_from('<I', layout, at - 0x64)[0] == kind]
    if len(positions) != 1:
        raise ValueError(f'Expected one Unit Details node named {name}')
    return positions[0]


def _replace(layout, node, offset, fmt, before, after):
    position = node + offset
    if struct.unpack_from(fmt, layout, position) != before:
        raise ValueError(f'Unexpected Unit Details value at 0x{position:X}')
    struct.pack_into(fmt, layout, position, *after)


def _layout(data, earlier_preview):
    layout = bytearray(data)
    if struct.unpack_from('<I', layout, 8)[0] != len(layout):
        raise ValueError('Unsupported Unit Details layout header')
    prior_positions = EARLIER_PREVIEW_Y if earlier_preview else tuple(old for old, _ in SECTION_Y.values())
    for (section, (_, new_y)), old_y in zip(SECTION_Y.items(), prior_positions):
        group = _node(layout, 'equip_' + section, 4)
        _replace(layout, group, -0x5C, '<f', (old_y,), (new_y,))

    item = _node(layout, 'equip_item', 4)
    item_button = _node(layout, 'equip_item_group_button', 10)
    _replace(layout, item, -0x4C, '<f', (105 if earlier_preview else 126,), (112,))
    _replace(layout, item_button, -0x4C, '<f', (100 if earlier_preview else 127,), (108,))
    if earlier_preview:
        _lift_row(layout, 'item', '05', -5, (41, -4, 23, 34))

    finisher_grid = _node(layout, 'list_zabuton_04', 5)
    grid_format = '<2f2I2H'
    two_rows = (68, 68, 0xFFFFFFFF, 0xFFFFFFFF, 2, 4)
    if struct.unpack_from(grid_format, layout, finisher_grid + 0x170) != two_rows:
        raise ValueError('Unexpected native two-row finisher grid')
    for section, number, tile, group_height, button_height, grid_height in (
        ('spell', '02', '08', 130, 124, 190), ('skill', '03', '11', 114, 125, 120),
    ):
        group = _node(layout, 'equip_' + section, 4)
        button = _node(layout, f'equip_{section}_group_button', 10)
        grid = _node(layout, 'list_zabuton_' + number, 5)
        part = _node(layout, f'parts_equip_items_{section}', 8)
        _replace(layout, part, -0x4C, '<f', (285,), (176,))
        _replace(layout, group, -0x4C, '<f', (166 if earlier_preview else group_height,), (166,))
        _replace(layout, button, -0x4C, '<f', (156 if earlier_preview else button_height,), (156,))
        _replace(layout, grid, -0x4C, '<f', (190 if earlier_preview else grid_height,), (164,))
        if not earlier_preview:
            _replace(layout, grid, 0x170, grid_format, (68, 300, 0xFFFFFFFF, 0xFFFFFFFF, 1, 4),
                     (68, 64, *two_rows[2:]))
            _lift_row(layout, section, tile, 13, (45, 0, 28, 38))
        caption = _node(layout, f'equip_{section}_caption', 2)
        _replace(layout, caption, -0x5C, '<f', (22 if earlier_preview else 29,), (CAPTION_Y,))
    return bytes(layout)


def _lift_row(layout, section, tile, lift, original_y):
    nodes = ((f'image_04_copy_{tile}', 1), (f'parts_equip_items_{section}', 8),
             (f'parts_equip_{section}_select_frame', 8), (f'parts_equip_{section}_highlight_frame', 8))
    for (name, kind), y in zip(nodes, original_y):
        if y is not None:
            _replace(layout, _node(layout, name, kind), -0x5C, '<f', (y,), (y - lift,))


def _shift_mask(original, donor, layout_delta):
    """Translate a native mask by whole BC7 block rows without recompression."""
    width, height = struct.unpack_from('<HH', original, 8)
    if (width, height) not in ((960, 540), (1920, 1080)):
        raise ValueError('Unexpected Unit Details mask dimensions')
    stride = width // 4 * 16
    old_at, donor_at = (struct.unpack_from('<I', data, 24)[0] for data in (original, donor))
    for data, at in ((original, old_at), (donor, donor_at)):
        if (data[:4] != b'btx\0' or data[16] != 13
                or struct.unpack_from('<HH', data, 8) != (width, height)
                or at + width * height != len(data)):
            raise ValueError('Unexpected Unit Details mask texture')
    shift, remainder = divmod(layout_delta * height, 1080)
    if remainder or shift % 4 or abs(shift) >= height:
        raise ValueError('Unit Details mask shift is outside block boundaries')
    pixels = donor[donor_at:]
    if shift >= 0:
        line = pixels[:stride]
        size = shift // 4 * stride
        moved = line * (shift // 4) + pixels[:len(pixels) - size]
    else:
        line = pixels[-stride:]
        moved = pixels[-shift // 4 * stride:] + line * (-shift // 4)
    return original[:old_at] + moved


def build(data):
    """Repack only the Unit Details resource and its four focus masks."""
    dat = DatArchive.read(data)
    pack = Pakd(dat.pack)
    arc = pack.entry(ARCHIVE_INDEX)
    result = bytearray(arc)
    locations = _resources(arc)

    def asset(name):
        start, end = locations[name]
        return arc[start:end]

    def put(name, payload):
        start, end = locations[name]
        if len(payload) != end - start:
            raise ValueError(f'Unit Details resource size changed for {name}')
        result[start:end] = payload

    screen = asset(SCREEN)
    positions = tuple(struct.unpack_from('<f', screen, _node(screen, 'equip_' + section, 4) - 0x5c)[0]
                      for section in SECTION_Y)
    original, revised = zip(*SECTION_Y.values())
    if positions == revised:
        layout = bytearray(screen)
        for section in ('spell', 'skill'):
            caption = _node(screen, f'equip_{section}_caption', 2)
            if struct.unpack_from('<f', screen, caption - 0x5C) != (CAPTION_Y,):
                _replace(layout, caption, -0x5C, '<f', (22,), (CAPTION_Y,))
        if layout == screen:
            return data
        put(SCREEN, layout)
        return dat.rebuild(pack.replace({ARCHIVE_INDEX: bytes(result)}))
    earlier_preview = positions == EARLIER_PREVIEW_Y
    if not earlier_preview and positions != original:
        raise ValueError('The Unit Details layout is different from the supported Steam layout')
    put(SCREEN, _layout(screen, earlier_preview))
    for i, (section, (_, new_y)) in enumerate(SECTION_Y.items()):
        name = f'org_highlight_filter_{section}'
        donor = section if earlier_preview or section == 'item' else 'finisher'
        delta = new_y - (EARLIER_PREVIEW_Y[i] if earlier_preview else SECTION_Y[donor][0])
        put(name, _shift_mask(asset(name), asset(f'org_highlight_filter_{donor}'), delta))
    return dat.rebuild(pack.replace({ARCHIVE_INDEX: bytes(result)}))

"""Data overlay and local sprite archive for the recruited XL Dorgalua fix."""
import struct

from class_change import BATTLE, DatArchive, Pakd, Xlce, rebuild_pakd


CLASS = 77
LEARNED = (179, 411, 419)  # Deathproof, Exhalatio, Umbra
PUNCH_ACTIONS = {66: 101, 67: 103, 68: 104}
SIDECAR = 'DorgaluaXL00.roster.pak'
SPRITE = 'object/DorgaluaXL00.dat'
PACK_HEADER = bytes.fromhex(
    '70616b640200000020000000a0691301908e1501230000009b00010000000000'
)


def roster_sidecar(sprite_dat):
    raw = DatArchive.read(sprite_dat).pack
    if len(raw) != 18189968 or not raw.startswith(PACK_HEADER):
        raise ValueError('Dorgalua XL sprite archive differs from the supported layout')
    pack = Pakd(raw)
    if not pack.entry(0).startswith(b'pakd') or not pack.entry(1).startswith(b'ashg'):
        raise ValueError('Dorgalua XL sprite archive has unexpected entries')
    return raw


def punch_fallback(sequence):
    if len(sequence) < 16 or sequence[:4] != b'SAS3':
        raise ValueError('Expected the Dorgalua XL animation bank')
    slots, = struct.unpack_from('<I', sequence, 12)
    first = 16 + 4 * slots
    if slots < 4 * (max(PUNCH_ACTIONS.values()) + 1) or first > len(sequence):
        raise ValueError('Dorgalua XL animation slot table is truncated')
    updated = bytearray(sequence)
    for destination, source in PUNCH_ACTIONS.items():
        target_at, source_at = 16 + 16 * destination, 16 + 16 * source
        target = sequence[target_at:target_at + 16]
        punch = sequence[source_at:source_at + 16]
        for pointer in struct.unpack('<4I', punch):
            offset = pointer >> 1
            if not first <= offset <= len(sequence) - 4:
                raise ValueError('Dorgalua XL punch is missing a directional sequence')
            count, _, duration = struct.unpack_from('<BBH', sequence, offset)
            if not count or not duration or offset + 4 + count * 14 > len(sequence):
                raise ValueError('Dorgalua XL punch sequence is invalid')
        if any(target) and target != punch:
            raise ValueError(f'Dorgalua XL axe action {destination} already has a custom animation')
        updated[target_at:target_at + 16] = punch
    return bytes(updated)


def build(battle_data):
    """Give XL an exclusive skill set and alias his unsupported axe motions."""
    archive = DatArchive.read(battle_data)
    pack = Pakd(archive.pack)
    banks = Pakd(pack.entry(0))
    classes, skills = Xlce(pack.entry(14)), Xlce(pack.entry(25))
    if classes.count <= CLASS or classes.row_size < 0x54 or skills.count <= max(LEARNED) or skills.row_size < 102:
        raise ValueError('Dorgalua XL class or skill data has an unsupported layout')
    xl = bytearray(classes.row(CLASS))
    current = xl[0x53]
    if 64 <= current < 86 or 0x10 + current >= skills.row_size:
        raise ValueError('Dorgalua XL uses an invalid skill set')
    in_use = {classes.row(i)[0x53] for i in range(classes.count) if i != CLASS}
    column = current if current and current not in in_use else next(
        (i for i in range(63, 0, -1) if i not in in_use), None
    )
    if column is None:
        raise ValueError('Dorgalua XL needs a free skill set. Free a stock skill set or assign XL a dedicated expanded set.')
    xl[0x53] = column
    changes = {}
    for i in range(skills.count):
        previous = skills.row(i)
        row = bytearray(previous)
        row[0x10 + column] = previous[0x10 + current]
        if i in LEARNED:
            row[0x10] = 255
            row[0x10 + column] = 1
            row[0x55] = row[0x5e] = 0
        if row != previous:
            changes[i] = bytes(row)
    entries = {
        0: banks.replace({24: punch_fallback(banks.entry(24))}),
        14: classes.replace({CLASS: bytes(xl)}),
        25: skills.replace(changes),
    }
    updated = {index: data for index, data in entries.items() if data != pack.entry(index)}
    return archive.rebuild(rebuild_pakd(pack, updated)) if updated else battle_data

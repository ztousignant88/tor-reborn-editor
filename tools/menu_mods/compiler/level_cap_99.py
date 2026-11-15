"""Apply the level-99 cap and extended XP curve to a battle DAT."""
import struct

from .tor_formats import DatArchive, Pakd, Xlce

CAP = 99
SETTINGS_ENTRY = 52
CAP_ROW = 0x103
XP_ENTRY = 49
LAST_UNCHANGED_LEVEL = 51


def build_archive(original: bytes) -> tuple[bytes, list[int], int]:
    archive = DatArchive.read(original)
    pack = Pakd(archive.pack)
    experience = Xlce(pack.entry(XP_ENTRY))
    settings = Xlce(pack.entry(SETTINGS_ENTRY))
    if experience.row_size != 4 or experience.count < CAP:
        raise ValueError("Expected cumulative XP thresholds through level 100.")
    thresholds = [0] + [struct.unpack("<I", experience.row(i))[0] for i in range(CAP)]
    unchanged = thresholds[:LAST_UNCHANGED_LEVEL]
    if any(current <= previous for previous, current in zip(unchanged, unchanged[1:])):
        raise ValueError("XP thresholds must increase through level 51.")
    if settings.row_size != 4:
        raise ValueError("Expected 32-bit player settings.")
    previous_cap = struct.unpack("<I", settings.row(CAP_ROW))[0]
    if previous_cap not in (50, CAP):
        raise ValueError("Expected a player cap of 50 or 99.")
    xp_rows = {}
    for current_level in range(LAST_UNCHANGED_LEVEL, CAP + 1):
        # Keep the level-100 lookup boundary above level 99 as well.
        thresholds[current_level] = thresholds[current_level - 1] + 40 * current_level
        xp_rows[current_level - 1] = struct.pack("<I", thresholds[current_level])
    patched_settings = settings.replace({CAP_ROW: struct.pack("<I", CAP)})
    patched = pack.replace({
        SETTINGS_ENTRY: patched_settings,
        XP_ENTRY: experience.replace(xp_rows),
    })
    return archive.rebuild(patched), thresholds, previous_cap

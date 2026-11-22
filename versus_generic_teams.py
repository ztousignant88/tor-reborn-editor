"""Assemble reproducible themed squads from the installed generic battle units."""

from collections import defaultdict
from hashlib import sha256
from random import Random
import re
import struct
from uuid import uuid4

import battle_encounters
from tools.menu_mods.compiler.tor_formats import Xlce, u16, u32


HUMAN = range(159, 167)
HUMAN_MALE = range(159, 163)
HUMAN_FEMALE = range(163, 167)
HAWKMAN = range(167, 171)
LIZARDMAN = range(171, 175)
LAMIA = range(175, 179)
ORC = range(179, 183)
SKELETON = range(183, 191)
GHOST = range(191, 199)
FAERIE = range(199, 203)
GREMLIN = range(203, 207)
PUMPKINHEAD = range(207, 211)
GOLEM = range(235, 239)
GENERIC = range(159, 431)
LARGE = (*range(27, 36), 40, 41, 42, 43)
FLYING_LARGE = (40, 41, 157, 158, 159)
LEVEL = 50
CORE_SIZE, SQUAD_SIZE = 24, 30

# Counts are per half. A 12-unit lineup has the same mix as a 24-unit lineup.
# Each role specifies its classes, template range and whether it needs zombies.
THEMES = {
    "human": ("Generic Humans", (
        (4, (1, 5, 6, 7, 8, 9, 10, 11), HUMAN, False),
        (3, (2,), HUMAN, False),
        (3, (3, 15), HUMAN, False),
        (2, (4,), HUMAN, False),
    )),
    "beastfolk": ("Generic Beastfolk", (
        (4, (8, 19, 20, 21), LIZARDMAN, False),
        (4, (15, 19, 20, 21), LAMIA, False),
        (4, (2, 3, 5, 7, 8, 19, 20, 21), ORC, False),
    )),
    "flying": ("Flying Units and Monsters", (
        (3, (1, 2, 3), HAWKMAN, False),
        (2, (4,), HAWKMAN, False),
        (3, (22,), FAERIE, False),
        (4, FLYING_LARGE, GENERIC, False),
    )),
    "tamers": ("Beast Tamers and Fusiliers", (
        (3, (14,), HUMAN, False),
        (4, LARGE, GENERIC, False),
        (3, (4,), HUMAN, False),
        (2, (13,), HUMAN, False),
    )),
    "templar": ("Generic Templars", (
        (4, (86,), HUMAN, False),
        (3, (81, 85, 87, 88, 89, 90, 91), HUMAN, False),
        (2, (82, 93), HUMAN, False),
        (2, (83, 95), HUMAN, False),
        (1, (84,), HUMAN, False),
    )),
    "undead": ("Undead and Necromancers", (
        (2, (16,), HUMAN, False),
        (4, (1, 2, 5, 6, 7, 8, 11), SKELETON, False),
        (3, (3, 15), GHOST, False),
        (2, (1, 6, 7, 8, 9, 10), HUMAN, True),
        (1, LARGE, GENERIC, True),
    )),
    "divine": ("Divine Host", (
        (4, (18,), HUMAN, False),
        (3, (6,), HUMAN, False),
        (3, (4,), HUMAN, False),
        (2, (5,), HUMAN, False),
    )),
    "umbra": ("Umbra", (
        (3, (12, 22), GREMLIN, False),
        (3, (7, 8, 19, 20, 21), ORC, False),
        (3, (22,), PUMPKINHEAD, False),
        (3, (34, 35, 41, 43), GENERIC, False),
    )),
    "constructs": ("Warlocks, Witches and Golems", (
        (2, (15,), HUMAN_MALE, False),
        (2, (15,), HUMAN_FEMALE, False),
        (1, (36,), GOLEM, False),
        (1, (37,), GOLEM, False),
        (1, (38,), GOLEM, False),
        (1, (39,), GOLEM, False),
        (4, (22,), PUMPKINHEAD, False),
    )),
}
RACE_TITLES = (
    (HAWKMAN, "Hawkman"), (LIZARDMAN, "Lizardman"), (LAMIA, "Lamia"), (ORC, "Orc"),
    (SKELETON, "Skeleton"), (GHOST, "Ghost"), (FAERIE, "Faerie"), (GREMLIN, "Gremlin"),
    (PUMPKINHEAD, "Pumpkinhead"),
)


def catalog():
    return [{"id": ident, "name": theme[0]} for ident, theme in THEMES.items()]


def exists(table, idx):
    return 0 < idx < table.count and any(table.row(idx))


def valid_loadout(game, row):
    for start, count, stride, table, base, blocked in (
        (0x22, 4, 4, game.skills, 0, 0),
        (0x4a, 7, 4, game.arms, 0, 999),
        (0x66, 4, 4, game.items, 1000, 0),
        (0x86, 4, 2, game.effects, 0, 0),
        (0x9c, 8, 2, game.effects, 0, 0),
    ):
        for pos in range(start, start + count * stride, stride):
            ident = u16(row, pos)
            if ident not in (0, blocked) and not exists(table, ident - base):
                return False
    return True


def read_donors(game, directory):
    classes = {klass for _, roles in THEMES.values() for _, ids, _, _ in roles for klass in ids}
    ai = {profile["id"] for profile in game.profiles()}
    actors, sprites = game.sprite_index
    donors = defaultdict(dict)
    for file in sorted(directory.glob("*")):
        match = re.fullmatch(r"entry_unit_(\d+)\.dat", file.name, re.IGNORECASE)
        if not match or file.is_symlink() or not 1 <= int(match[1]) < 2000 or int(match[1]) == 1574:
            continue
        try:
            _, pack = battle_encounters.archive(file.read_bytes())
            units = Xlce(pack.entry(0))
            art = pack.entry(1)
            if units.count != u32(art, 0) or len(art) < 16 + units.count * 8:
                continue
        except (OSError, ValueError, IndexError, struct.error):
            continue
        for i in range(units.count):
            row = units.row(i)
            if len(row) != 196 or u16(row, 0) or not row[5] or row[0x10] != 2 or not row[0x0d]:
                continue
            template, klass = u16(row, 2), row[6]
            if (template not in GENERIC or klass not in classes or row[0x94] not in ai or
                not exists(game.templates, template) or not exists(game.classes, klass)):
                continue
            actor, sprite = struct.unpack_from("<II", art, 16 + i * 8)
            if actor not in actors or sprite not in sprites or not valid_loadout(game, row):
                continue
            # One good native loadout per class and template keeps frequently
            # reused story units from dominating the random draw.
            score = (sum(bool(u16(row, at)) for at in range(0x22, 0x32, 4)),
                     bool(row[0x1c]), row[7])
            group = donors[klass, bool(row[0x1e])]
            if template not in group or score > group[template][0]:
                group[template] = (score, row, actor, sprite)
    return donors


def battle_entry(loadouts, donor, klass, template, element, random):
    row = bytearray(196)
    row[2:4] = donor[2:4]
    row[5:7] = donor[5:7]
    row[8] = LEVEL
    row[0x14:0x17] = donor[0x14:0x17]
    row[0x1e] = bool(donor[0x1e])
    row[0x94] = donor[0x94]
    row[0x98] = element
    row[0x99] = donor[0x99]
    row[0x9a] = 1
    # Leave the native gear, spell and finisher auto-fill flags at zero.
    loadouts.fill(row, donor, klass, template, random)
    return bytes(row)


def build(game, selection):
    theme = selection.get("theme")
    if not isinstance(theme, str) or theme not in THEMES:
        raise ValueError("Choose a random squad theme.")
    label, roles = THEMES[theme]
    seed = selection.get("seed", uuid4().hex)
    if not isinstance(seed, str) or not re.fullmatch(r"[0-9a-f]{32}", seed):
        raise ValueError("The randomized lineup needs to be rolled again.")
    random = Random(int(seed, 16))
    loadout_random = Random(f"loadouts:{seed}")
    reserves_random = Random(f"reserves:{seed}")
    halves = ([], [])
    reserve_counts = [count // 2 for count, *_ in roles]
    ties = [index for index, (count, *_) in enumerate(roles) if count % 2]
    reserves_random.shuffle(ties)
    for index in ties[:SQUAD_SIZE - CORE_SIZE - sum(reserve_counts)]:
        reserve_counts[index] += 1
    reserves = []
    for (count, classes, templates, zombie), reserve_count in zip(roles, reserve_counts, strict=True):
        pool = [
            entry for klass in classes
            for template, entry in sorted(game.generic_donors.get((klass, zombie), {}).items())
            if template in templates
        ]
        if not pool:
            raise ValueError(f"The installed game data is missing a loadout needed for {label}.")
        random.shuffle(pool)
        members = [pool[i % len(pool)] for i in range(2 * count)]
        halves[0].extend(members[:count])
        halves[1].extend(members[count:])
        reserves.extend(pool[(2 * count + i) % len(pool)] for i in range(reserve_count))
    for half in halves:
        random.shuffle(half)
    # Append the extra fighters so existing seeds keep their original 24.
    reserves_random.shuffle(reserves)
    units = {}
    digest = sha256(f"{theme}:{seed}".encode("ascii"))
    for slot, (_, donor, actor, sprite) in enumerate(halves[0] + halves[1] + reserves):
        template_id = u16(donor, 2)
        template = game.templates.row(template_id)
        klass = game.classes.row(donor[6])
        class_name = game.class_name(klass, template) or f"Class {donor[6]}"
        if 81 <= donor[6] <= 96 and class_name == "Templar":
            base = game.classes.row(donor[6] - 80)
            class_name += f" ({game.class_name(base, template)})"
        race = next((label for ids, label in RACE_TITLES if template_id in ids), "")
        prefix = "Zombie" if donor[0x1e] else race
        name = f"{prefix} {class_name} {slot + 1}".strip()
        palette = template[0x3d] if template[0x3d] not in (0, 255) else klass[0x94]
        entry = battle_entry(game.generic_loadouts, donor, klass, template, random.randint(1, 8), loadout_random)
        preload = struct.pack("<II", actor, sprite)
        digest.update(entry + preload)
        if slot + 1 == CORE_SIZE:
            prior_fingerprint = digest.hexdigest()
        units[slot] = {
            "slot": slot, "name": name, "level": LEVEL, "className": class_name, "actor": actor,
            "palette": 0 if palette == 255 else palette, "ai": donor[0x94], "error": None,
            "entry": entry, "preload": preload, "equipment": [u16(entry, at) for at in range(0x4a, 0x66, 4)],
            "relics": [], "omittedSnapshots": 0,
        }
    fingerprint = digest.hexdigest()
    if selection.get("sha256") and selection["sha256"] not in (prior_fingerprint, fingerprint):
        raise ValueError("The installed generic loadouts changed. Roll the squad again.")
    return fingerprint, label, seed, units

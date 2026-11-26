"""Read-only army imports and validation for spectator matches."""

from __future__ import annotations

from collections import Counter, deque
from functools import cache, cached_property
from http import HTTPStatus
import base64
import binascii
from hashlib import sha256
import json
from pathlib import Path
from random import shuffle
import struct

import battle_encounters
import ai_choices_data
import save_editor
import versus_generic_teams
import versus_loadouts
from tools.menu_mods.compiler.class_text import read_archive
from tools.menu_mods.compiler.loadout_controls import KEY as LOADOUT_KEY, write_entry_spells
from tools.menu_mods.compiler.tor_formats import Xlce, filetable_records, u16, u32


API = "/api/versus/"
MAPS = (
    (264, "Golyat — Residential District", "bg300_50_c0_t00", 650),
    (67, "Madura Drift", "bg127_01_c0_t00", 448),
    (81, "Tzorious Field", "bg130_01_c0_t00", 310),
    (79, "The Reisan Way", "bg115_01_c0_t00", 184),
    (69, "Tynemouth Hill", "bg016_15_c1_t00", 107),
    (12, "Krysaro", "bg002_02_c0_t00", 9),
    (17, "Coritanae Keep — Gates", "bg004_01_c0_t00", 151),
    (20, "Phidoch Castle — South", "bg006_01_c0_t00", 163),
    (24, "Heim — Gates", "bg008_01_c0_t00", 346),
    (82, "The Leupha Coast", "bg135_01_c0_t00", 671),
)
UNIT_LIMIT = 100
TEAM_SIZES = (3, 6, 12, 24, 30)
RANDOM_ARENA = "random"
SAVE_SIZE_LIMIT = 8 * 1024 * 1024
TRAINING_STAGE = 547
TRAINING_ROSTER = "battle/entry/ENTRY_UNIT_1574.dat"
EVENT = "event/event_data.dat"
PILOT_KEY = "versusPilot"
MOD_KEY = "versusEnabled"
SNAPSHOT_BASE, SNAPSHOT_COUNT = 2000, 85
RELIC_BASE, RELIC_COUNT = 3000, 1000
RELIC_BANK, RELIC_RECORD_SIZE = 0x35712, 94
EQUIPMENT_OFFSET, EQUIPMENT_SLOTS = 0x93, 7
PERMANENT_STAT_ROW = 22


def enabled_in(meta):
    editor = meta.get("editor", {})
    value = editor.get("menuMods")
    return (value.get(MOD_KEY, bool(editor.get(PILOT_KEY))) if isinstance(value, dict)
            else bool(editor.get(PILOT_KEY))) is True


def project_enabled(config):
    name = config.open_project()
    return bool(name and enabled_in(config.project(name)))


def pilot_ini(meta, steam, expanded, queue_key):
    if not enabled_in(meta):
        return b""
    pilot = meta.get("editor", {}).get(PILOT_KEY) or {"queueOnly": True}
    if not steam:
        raise ValueError("Versus requires the supported Steam build.")
    if not isinstance(pilot, dict):
        raise ValueError("Invalid Versus pilot settings.")
    queue_only = pilot.get("queueOnly") is True
    count, tile = (0, [0, 0]) if queue_only else (pilot.get("size"), pilot.get("spectator"))
    if (type(count) is not int or (count not in TEAM_SIZES and not queue_only) or
            not isinstance(tile, list) or len(tile) != 2 or
            any(type(n) is not int or not 0 <= n < 128 for n in tile)):
        raise ValueError("Invalid Versus roster size or spectator tile.")
    if count > 12 and not expanded:
        raise ValueError(f"Enable Expanded Battle Limit for {count} vs {count}.")
    return (f"\r\n[VersusPilot]\r\nEnabled=1\r\nTeamSize={count}\r\n"
            f"SpectatorX={tile[0]}\r\nSpectatorY={tile[1]}\r\nQueueKey={queue_key}\r\n").encode("ascii")


def project_options(config):
    import menu_runtime

    state = config.state()
    name = config.open_project()
    meta = config.project(name) if name else {}
    settings = menu_runtime.project_settings(meta)
    runtime = state.get("menuRuntime") or {}
    expanded = settings[battle_encounters.KEY]
    return {"name": name, "dataRoot": str(config.data_root), "enabled": settings[MOD_KEY], "expanded": expanded,
            "battleUnitLimit": battle_encounters.CAPACITY if expanded else battle_encounters.STOCK_CAPACITY,
            "supported": menu_runtime.battle_capacity_supported(config),
            "applied": state.get("applied", {}).get("name") if state.get("applied") else None,
            "runtime": bool(name and runtime.get("project") == name and runtime.get("versusQueue")),
            "appliedExpanded": bool(runtime.get("settings", {}).get(battle_encounters.KEY)),
            "maxTeamSize": runtime.get("versusMaxTeamSize", 24),
            "smallTeams": bool(runtime.get("versusSmallTeams")), "readOnly": config.read_only,
            **random_loadout_options(runtime, name, settings)}


def random_loadout_options(runtime, name, settings):
    expanded = bool(runtime.get("settings", {}).get(LOADOUT_KEY))
    return {"randomLoadoutSlots": 8 if expanded else 4,
            "randomLoadoutPending": bool(settings[LOADOUT_KEY] and (not expanded or runtime.get("project") != name))}


def configure(config, body):
    import menu_runtime

    if not isinstance(body, dict):
        raise ValueError("Choose a Versus project setting.")
    enable_expansion = body.get("enableExpanded") is True
    if not enable_expansion and type(body.get("enabled")) is not bool:
        raise ValueError("Choose whether to enable Versus.")
    name = config.open_project()
    if not name or name != body.get("project"):
        raise ValueError("Open the project where you want to enable Versus and try again.")
    meta = config.project(name)
    settings = menu_runtime.project_settings(meta)
    if enable_expansion:
        require_project(config)
        settings[battle_encounters.KEY] = True
    else:
        settings[MOD_KEY] = body["enabled"]
    menu_runtime.validate_versus(config, name, settings, meta)
    meta.setdefault("editor", {})["menuMods"] = settings
    config.save_project(name, meta)
    return project_options(config)


def require_project(config, count=None, *, random_loadouts=False):
    import menu_runtime

    name = config.open_project()
    if not name:
        raise ValueError("Open a project and enable Versus in Integrated Mods.")
    settings = menu_runtime.project_settings(config.project(name))
    if not settings[MOD_KEY]:
        raise ValueError("Enable Versus in Integrated Mods and save the project.")
    if count is not None and count > 12 and not settings[battle_encounters.KEY]:
        raise ValueError(f"Enable Expanded Battle Limit for {count} vs {count}.")
    if random_loadouts:
        runtime = config.state().get("menuRuntime") or {}
        if random_loadout_options(runtime, name, settings)["randomLoadoutPending"]:
            raise ValueError("Apply Expand Skill & Spell Slots before generating random Versus loadouts.")


def cstring(data):
    return data.split(b"\0", 1)[0].decode("utf-8", "replace")


def army(raw):
    _, data = save_editor.load_archive(raw)
    return army_from_payload(data)


def army_from_payload(data):
    if len(data) != 383896 or u32(data, 0) not in (0x81000102, 0x81000103):
        raise ValueError("This save uses a different character layout.")
    units = {}
    for slot in range(UNIT_LIMIT):
        offset = save_editor.UNIT_START + slot * save_editor.UNIT_SIZE
        row = data[offset:offset + save_editor.UNIT_SIZE]
        if row[0]:
            units[slot] = row
    if not units:
        raise ValueError("This save has no army units.")
    return cstring(data[0x54:0x75]), units


def slot_data(config, selection):
    if not isinstance(selection, dict):
        raise ValueError("Choose a save for each team.")
    if "upload" in selection:
        encoded = selection["upload"]
        if not isinstance(encoded, str) or len(encoded) > 4 * ((SAVE_SIZE_LIMIT + 2) // 3):
            raise ValueError("The save file is too large.")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except binascii.Error as exc:
            raise ValueError("Could not read the uploaded save.") from exc
    else:
        profile, profiles = save_editor.selected_profile(config, selection)
        if profile is None:
            raise ValueError("No local save profiles were found.")
        path = save_editor.save_path(profiles[profile], selection.get("name"))
        if path.stat().st_size > SAVE_SIZE_LIMIT:
            raise ValueError("The save file is too large.")
        raw = path.read_bytes()
    if len(raw) > SAVE_SIZE_LIMIT:
        raise ValueError("The save file is too large.")
    digest = save_editor.sha(raw)
    if selection.get("sha256") and selection["sha256"] != digest:
        raise ValueError("A source save changed. Reload its squad before preparing the match.")
    _, data = save_editor.load_archive(raw)
    title, units = army_from_payload(data)
    return digest, title, units, data


def rows(pack, entry):
    return Xlce(pack.entry(entry))


def battle_without_ai(data):
    _, pack = battle_encounters.archive(data)
    digest = sha256()
    for i in range(len(pack)):
        if i != ai_choices_data.AI_PROFILES:
            entry = pack.entry(i)
            digest.update(struct.pack("<II", i, len(entry)))
            digest.update(entry)
    return digest.hexdigest()


def art_without_ai(data, original_assignment_sizes=None):
    # AI Plus writes these UI assets as well as the AI profile table.
    ignored = {"menu/menu_data.dat", battle_encounters.BATTLE}
    for language in battle_encounters.MAP_NAME_LANGUAGES:
        ignored.update((f"localize/localizetext_{language.lower()}.dat",
                        f"menu/texture_x4/{language.lower()}/com_icon.dat"))
    records = [r for r in filetable_records(data) if r["path"].casefold() not in ignored]
    if original_assignment_sizes:
        for record in records:
            size = original_assignment_sizes.get(record["path"].casefold())
            if size is not None:
                record["size"] = size
    return save_editor.sha(json.dumps(records, sort_keys=True).encode())


def checked_row(table, ident, field):
    if not 0 <= ident < table.count:
        raise ValueError(f"{field} #{ident} is outside the active game's tables.")
    row = table.row(ident)
    if not any(row):
        raise ValueError(f"{field} #{ident} is empty in the active game's tables.")
    return row


def worn_items(unit):
    return struct.unpack_from("<7H", unit, EQUIPMENT_OFFSET)


def permanent_stats(unit):
    """Copy permanent HP, MP and STR through RES in the game's tenths."""
    return unit[0x1c8:0x1cc] + unit[0x1aa:0x1bc]


def imported_equipment(game, unit, data, omit_snapshots):
    ids, relics, omitted = [], [], 0
    for slot, item in enumerate(worn_items(unit)):
        if SNAPSHOT_BASE <= item < SNAPSHOT_BASE + SNAPSHOT_COUNT:
            if not omit_snapshots:
                raise ValueError("Equipped snapshot weapon. Enable “Leave snapshot weapons unequipped” or choose another fighter.")
            item = 0
            omitted += 1
        elif RELIC_BASE <= item < RELIC_BASE + RELIC_COUNT:
            offset = RELIC_BANK + (item - RELIC_BASE) * RELIC_RECORD_SIZE
            record = data[offset:offset + RELIC_RECORD_SIZE]
            if len(record) != RELIC_RECORD_SIZE or not (base := u16(record, 0)):
                raise ValueError(f"Relic copy #{item - RELIC_BASE} is missing from the source save.")
            item = base
            relics.append((slot, record))
        elif item == 0xffff:
            item = 0
        if item:
            checked_row(game.arms, item, "Equipment")
        ids.append(item)
    return ids, relics, omitted


class GameData:
    def __init__(self, config):
        self.entry_path = config.resolve("battle/entry")
        self.read = lambda path: config.resolve(path).read_bytes()
        self.battle_data = self.read(battle_encounters.BATTLE)
        _, battle = battle_encounters.archive(self.battle_data)
        self.arms, self.items, self.classes, self.effects, self.templates, self.skills, self.ai = (
            rows(battle, i) for i in (11, 13, 14, 16, 23, 25, 27)
        )
        self.text = read_archive(self.read("localize/LocalizeText_en-us.dat"))
        self.runtime_settings = (config.state().get("menuRuntime") or {}).get("settings", {})
        self.ai_plus = bool(self.runtime_settings.get("aiChoices"))

    @cached_property
    def generic_loadouts(self):
        _, battle = battle_encounters.archive(self.battle_data)
        return versus_loadouts.Loadouts(self, rows(battle, 51), rows(battle, 26), rows(battle, 72),
                                        self.runtime_settings)

    @cached_property
    def generic_donors(self):
        return versus_generic_teams.read_donors(self, self.entry_path)

    def class_name(self, klass, template):
        name = f"CLASS_TEXT_DATA_CLASS{u16(klass, 0xb2):04d}"
        key = name + ("_FEMALE" if template[3] == 1 else "_MALE")
        return cstring(self.text.get(key) or self.text.get(name + "_MALE") or b"")

    def profiles(self):
        names = {}
        if self.runtime_settings.get("rougesReborn") and (trap := self.runtime_settings.get("trapAiProfile")):
            names[trap] = "Trap AI"
        for index, ((base, weights), label) in enumerate(zip(
            ai_choices_data.PROFILES, ("Support (Buff)", "Ailments (Debuff)"), strict=True
        ), ai_choices_data.STOCK_AI_ROWS):
            if index >= self.ai.count:
                continue
            expected = bytearray(self.ai.row(base))
            for at, weight in weights.items():
                struct.pack_into("<h", expected, at, weight)
            if self.ai_plus or self.ai.row(index) == expected:
                names[index] = label
        return [{"id": i, "name": f"{i} · {names[i]}" if i in names else f"AI {i}"}
                for i in range(1, min(256, self.ai.count)) if any(self.ai.row(i))]

    @cached_property
    def revisions(self):
        table = self.read("FileTable.bin")
        return {"battleRevision": save_editor.sha(self.battle_data), "artRevision": save_editor.sha(table),
                "battleWithoutAI": battle_without_ai(self.battle_data), "artWithoutAI": art_without_ai(table)}

    def default_ai(self, unit):
        # Use the class's most frequent stock enemy profile when no override
        # was supplied. Several class rows share a default stock fallback.
        scores = stock_ai()
        candidates = scores.get(unit[0x88], [])
        fallback = {53: 75, 56: 14, 57: 72, 58: 14, 59: 14}.get(unit[0x88], 7)
        return next((i for i in candidates if i < self.ai.count and any(self.ai.row(i))), fallback)

    @cached_property
    def sprite_index(self):
        index = {20: {}, 30: {}}
        for record in filetable_records(self.read("FileTable.bin")):
            if record["directory_id"] in index:
                index[record["directory_id"]][record["file_id"]] = record["path"]
        return index[20], index[30]

    def sprite(self, unit, team, template, klass):
        female = template[3] == 1
        template_actor = u16(template, 0x3a)
        template_sprite = u16(template, 0x40)
        class_actor = u16(klass, 0x92 if female else 0x90)
        start = 0x76 if female else 0x68
        variants = struct.unpack_from("<7H", klass, start)
        sprite = u16(unit, 0x43)
        actors, sprites = self.sprite_index
        if template_actor in actors and sprite in sprites:
            stem = Path(actors[template_actor]).stem.casefold()
            sprite_stem = Path(sprites[sprite]).stem.casefold()
            if sprite == template_sprite or (sprite_stem.startswith(stem) and sprite_stem[len(stem):].isdigit()):
                return template_actor, sprite
        # The game accepts table-defined pairs with unrelated filenames.
        # Dark Hawkman uses a Yobikao variant and some golems share a bank.
        if class_actor in actors and sprite in sprites and sprite in variants:
            return class_actor, sprite
        if template_actor in actors and template_sprite in sprites:
            return template_actor, template_sprite
        if class_actor in actors:
            for variant in (variants[team - 1], variants[0]):
                if variant in sprites:
                    return class_actor, variant
        raise ValueError("The selected installation is missing this character's battle art.")

    def preview_unit(self, slot, unit):
        template_id, class_id = u16(unit, 0x3f), unit[0x88]
        name = cstring(unit[1:38]) or f"Unit {slot + 1}"
        try:
            template = checked_row(self.templates, template_id, "Template")
            klass = checked_row(self.classes, class_id, "Class")
            class_name = self.class_name(klass, template) or f"Class {class_id}"
            actor, _ = self.sprite(unit, 1, template, klass)
            palette = template[0x3d] if template[0x3d] not in (0, 255) else klass[0x94]
            error = None
        except ValueError as exc:
            class_name, actor, palette, error = f"Class {class_id}", 0, 0, str(exc)
        return dict(slot=slot, name=name, level=unit[0x89], className=class_name,
                    actor=actor, palette=0 if palette == 255 else palette,
                    ai=self.default_ai(unit), error=error,
                    snapshotCount=sum(SNAPSHOT_BASE <= item < SNAPSHOT_BASE + SNAPSHOT_COUNT
                                      for item in worn_items(unit)))


@cache
def stock_ai():
    return {
        int(klass): choices
        for klass, choices in json.loads((Path(__file__).parent / "web/data/versus-ai.json").read_bytes()).items()
    }


def map_formation(game, arena, count):
    """Choose two approaches in the same ground-connected region."""
    _, _, path, donor = arena
    _, pack = battle_encounters.archive(game.read(f"bg/{path}.dat"))
    scene = pack.entry(0)
    width, depth = struct.unpack_from("<HH", scene, 0x56)
    if not (0 < width <= 127 and 0 < depth <= 127 and u16(scene, 0x50) == width * depth):
        raise ValueError("This arena does not have a supported battle grid.")
    cursor = u32(scene, 0x28) + 0x10
    tiles = {}
    for y in range(depth):
        for x in range(width):
            length = u32(scene, cursor)
            if length < 0x4c or cursor + length > len(scene):
                raise ValueError("This arena has an invalid terrain record.")
            tiles[x, y] = (u16(scene, cursor + 0x46), scene[cursor + 0x48], u16(scene, cursor + 0x4a))
            cursor += length
    _, pack = battle_encounters.archive(game.read(f"battle/entry/entry_unit_{donor:03d}.dat"))
    roster = rows(pack, 0)
    occupied = [tuple(unit[10:12]) for i in range(roster.count)
                if (unit := roster.row(i))[13] and tuple(unit[10:12]) in tiles]
    surfaces = Counter(tiles[tile][1] for tile in occupied)
    ground = {tile: height for tile, (height, surface, obj) in tiles.items()
              if surface in surfaces and obj == 65535}

    def walk(start, available):
        dist = {start: 0}
        queue = deque([start])
        while queue:
            x, y = queue.popleft()
            for tile in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if tile in available and tile not in dist and abs(ground[tile] - ground[x, y]) <= 2:
                    dist[tile] = dist[x, y] + 1
                    queue.append(tile)
        return dist

    remaining = set(ground)
    field = {}
    while remaining:
        component = walk(min(remaining), remaining)
        remaining.difference_update(component)
        if len(component) > len(field):
            field = component
    if len(field) < 2 * count + 12:
        raise ValueError("This arena does not have two connected deployment areas of that size.")
    a = max(field, key=lambda tile: (field[tile], tile))
    da = walk(a, field)
    b = max(field, key=lambda tile: (da[tile], tile))
    db = walk(b, field)
    # Spread from the front of each deployment area, leaving a neutral lane.
    side_a = sorted((p for p in field if da[p] + 3 < db[p]),
                    key=lambda p: (abs(da[p] - da[b] // 4), db[p], p))
    side_b = sorted((p for p in field if db[p] + 3 < da[p]),
                    key=lambda p: (abs(db[p] - da[b] // 4), da[p], p))
    if min(len(side_a), len(side_b)) < count:
        raise ValueError("This arena does not have room for both teams at that size.")
    occupied = set(side_a[:count] + side_b[:count])
    spectator = min(field.keys() - occupied, key=lambda p: (da[p], -db[p], p))
    return side_a[:count], side_b[:count], spectator


def prepare_format(body):
    if not isinstance(body, dict):
        raise ValueError("Invalid match selection.")
    count = body.get("size")
    if type(count) is not int or count not in TEAM_SIZES:
        raise ValueError("Choose 3 vs 3, 6 vs 6, 12 vs 12, 24 vs 24, or 30 vs 30.")
    if type(body.get("hideSpectator", True)) is not bool:
        raise ValueError("Invalid spectator visibility setting.")
    omit_snapshots = body.get("omitSnapshots", False)
    if type(omit_snapshots) is not bool:
        raise ValueError("Invalid snapshot weapon setting.")
    requested = body.get("arena")
    arena = RANDOM_ARENA if requested == RANDOM_ARENA else next(
        (m for m in MAPS if type(requested) is int and m[0] == requested), None)
    if arena is None:
        raise ValueError("Choose one of the Versus arenas.")
    return count, arena, omit_snapshots


def random_formations(game, count, *, single=False):
    candidates = list(MAPS)
    if single:
        shuffle(candidates)
    formations = {}
    for arena in candidates:
        try:
            formations[arena] = map_formation(game, arena, count)
        except (ValueError, FileNotFoundError, struct.error):
            continue
        if single:
            break
    if not formations:
        raise ValueError(f"No Versus arena has a valid formation for {count} vs {count}.")
    return formations


def prepare_teams(config, selections, count, omit_snapshots):
    if any(isinstance(selection, dict) and "theme" in selection for selection in selections):
        require_project(config, random_loadouts=True)
    game = GameData(config)
    profiles = {p["id"] for p in game.profiles()}
    prepared = []
    for selection in selections:
        if not isinstance(selection, dict):
            raise ValueError("Choose a squad for each team.")
        generated = "theme" in selection
        if generated:
            if "seed" not in selection:
                raise ValueError("Roll the random squad before preparing the match.")
            digest, title, _, units = versus_generic_teams.build(game, selection)
        else:
            digest, title, units, data = slot_data(config, selection)
        picked = selection.get("units")
        if not isinstance(picked, list) or len(picked) != count:
            raise ValueError(f"Each squad needs exactly {count} units.")
        seen, lineup = set(), []
        for pick in picked:
            if not isinstance(pick, dict):
                raise ValueError("Invalid squad entry.")
            slot, ai = pick.get("slot"), pick.get("ai")
            if type(slot) is not int or slot not in units or slot in seen:
                raise ValueError("Each squad must use distinct fighters from its source.")
            if type(ai) is not int or ai not in profiles:
                raise ValueError("Each character needs a valid AI profile.")
            seen.add(slot)
            row = units[slot]
            if generated:
                lineup.append(row | {"ai": ai})
                continue
            unit = game.preview_unit(slot, row)
            if unit["error"]:
                raise ValueError(f'{unit["name"]}: {unit["error"]}')
            try:
                equipment, relics, omitted = imported_equipment(game, row, data, omit_snapshots)
            except ValueError as exc:
                raise ValueError(f'{unit["name"]}: {exc}') from exc
            lineup.append(unit | {"ai": ai, "raw": row, "equipment": equipment, "relics": relics,
                                  "omittedSnapshots": omitted})
        prepared.append({"sha256": digest, "title": title, "lineup": lineup})
    return game, prepared


def prepare(config, body):
    count, arena, omit_snapshots = prepare_format(body)
    require_project(config, count)
    selections = body.get("teams")
    if not isinstance(selections, list) or len(selections) != 2:
        raise ValueError("Choose two squads.")
    game, teams = prepare_teams(config, selections, count, omit_snapshots)
    if arena == RANDOM_ARENA:
        arena, formation = next(iter(random_formations(game, count, single=True).items()))
        return game, arena, teams, formation
    return game, arena, teams, map_formation(game, arena, count)


def unit_row(game, unit, position, side, event_id, facing):
    """Encode a selected fighter's loadout into a native battle entry record."""
    if "entry" in unit:
        row = bytearray(unit["entry"])
        row[4] = event_id
        row[10:14] = bytes((*position, facing, 1))
        row[0x10:0x12] = bytes((side, side == 1))
        row[0x94] = unit["ai"]
        return row, unit["preload"]
    saved = unit["raw"]
    row = bytearray(196)
    template_id = u16(saved, 0x3f)
    # The native entry retains its stock identity. Saved display names travel
    # separately in the queued match.
    name = template_id if f"UNITNAME0_LC_UNITNAME_{template_id:03d}_TEXT" in game.text else 0
    struct.pack_into("<HH", row, 0, name, template_id)
    row[4], row[5], row[6], row[8] = event_id, 1 if not name else 0, saved[0x88], saved[0x89]
    if not 1 <= row[8] <= 99:
        raise ValueError("Invalid saved character level.")
    row[10:14] = bytes((*position, facing, 1))
    row[0x10:0x12] = bytes((side, side == 1))
    row[0x14], row[0x15], row[0x16] = (saved[0x8d] >> 3) & 3, saved[0x84], saved[0x8d] & 7
    row[0x94], row[0x98], row[0x9a] = unit["ai"], saved[0x8c], 1
    for i, item in enumerate(unit["equipment"]):
        struct.pack_into("<H", row, 0x4a + i * 4, item)
    for i in range(4):
        item = u16(saved, 0x134 + i * 2)
        if item:
            checked_row(game.items, item - 1000, "Consumable")
        struct.pack_into("<H", row, 0x66 + i * 4, item)
    expanded = game.runtime_settings.get("expandedLoadout") and saved[0x128:0x12c] == b"TO8\x01"
    effects = []
    for i in range(8 if expanded else 4):
        skill_offset = 0xf0 + i * 6
        skill = u16(saved, skill_offset)
        book_offset = 0x12c + i * 2 if i < 4 else 0x120 + (i - 4) * 2
        book = u16(saved, book_offset)
        if skill:
            checked_row(game.skills, skill, "Skill")
        effect = 0
        if book:
            record = checked_row(game.items, book - 1000, "Spellbook")
            if record[2] != 34:
                raise ValueError(f"Item #{book} is not a spellbook in the active game.")
            effect = u16(record, 4)
            checked_row(game.effects, effect, "Spell")
        struct.pack_into("<HH", row, 0x22 + i * 4, skill, saved[skill_offset + 2])
        effects.append(effect)
    write_entry_spells(row, effects)
    for i in range(8):
        effect = u16(saved, 0x73 + i * 2)
        if effect:
            checked_row(game.effects, effect, "Finisher")
        struct.pack_into("<H", row, 0x9c + i * 2, effect)
    template, klass = game.templates.row(template_id), game.classes.row(saved[0x88])
    return row, struct.pack("<II", *game.sprite(saved, side, template, klass))


def starting_facing(left, right):
    delta = (right[0][0] - left[0][0], right[0][1] - left[0][1])
    if abs(delta[0]) >= abs(delta[1]):
        return 0 if delta[0] > 0 else 2
    return 1 if delta[1] > 0 else 3


def roster_payload(game, teams, positions):
    left, right, _ = positions
    units, sprites, relics = [], [], []
    facing = starting_facing(left, right)
    for side, team, field in zip((1, 2), teams, (left, right), strict=True):
        for unit, position in zip(team["lineup"], field, strict=True):
            try:
                row, preload = unit_row(game, unit, position, side, 160 + len(units),
                                        (facing + (side - 1) * 2) % 4)
            except ValueError as exc:
                raise ValueError(f'{unit["name"]}: {exc}') from exc
            relics.extend(struct.pack("<HH", len(units), slot) + record for slot, record in unit["relics"])
            units.append(row)
            sprites.append(preload)
    return b"".join(units), b"".join(sprites), b"".join(relics)


def training_assets(game, arena, teams, positions):
    """Build the 547 training event and roster using their original archive paths."""
    left, _, spectator = positions
    count = len(left)
    roster_dat, roster_pack = battle_encounters.archive(game.read(TRAINING_ROSTER))
    battle_dat, battle_pack = battle_encounters.archive(game.read(battle_encounters.BATTLE))
    event_dat, event_pack = battle_encounters.archive(game.read(EVENT))
    stages = rows(battle_pack, 17)
    stage = bytearray(stages.row(TRAINING_STAGE))
    if len(stage) != 230 or not stage[0x22] or u16(stage, 0x28) != 249:
        raise ValueError("Almorica Training uses a different stage layout in this installation.")
    stage[0x10:0x14] = bytes((1, count, count, 0))
    pgrs = bytearray(event_pack.entry(15))
    if pgrs[:4] != b"PGRS":
        raise ValueError("Almorica Training has no event progression table.")
    matches = [at for at in range(8, 8 + u16(pgrs, 6) * 44, 44)
               if u16(pgrs, at + 16) == TRAINING_STAGE and u16(pgrs, at + 6) == 8]
    if len(matches) != 1:
        raise ValueError("Could not identify the Almorica Training event.")
    struct.pack_into("<H", pgrs, matches[0] + 2, arena[0])
    units, sprites, _ = roster_payload(game, teams, positions)
    total = count * 2
    return {
        EVENT: battle_encounters.replace(event_dat, event_pack, {15: bytes(pgrs)}),
        battle_encounters.BATTLE: battle_encounters.replace(battle_dat, battle_pack, {17: stages.replace({TRAINING_STAGE: stage})}),
        TRAINING_ROSTER: battle_encounters.replace(roster_dat, roster_pack, {
            0: battle_encounters.aligned(struct.pack("<4sIII", b"xlce", total, 16, 196) + units + b"\0"),
            1: battle_encounters.aligned(struct.pack("<I", total) + bytes(12) + sprites + bytes(16)),
        }),
    }, {"stage": TRAINING_STAGE, "spectator": spectator, "fighters": total}


def get(handler, route):
    config = handler.config
    if route == API + "queue":
        import versus_queue
        return handler._json(versus_queue.status(config))
    if route == API + "tournaments":
        import versus_tournaments
        return handler._json(versus_tournaments.status(config))
    if route == API + "result":
        return handler._json({"result": last_result(config.data_root.parent / "menu-mods.log")})
    if route == API + "project":
        return handler._json(project_options(config))
    if route == API + "setup":
        require_project(config)
        key, profiles = save_editor.selected_profile(config, handler._query())
        game = GameData(config)
        return handler._json({
            "profile": key, "profiles": list(profiles),
            "saves": [save_editor.summarize(path) for path in save_editor.save_files(profiles[key])] if key else [],
            "maps": [{"id": ident, "name": name} for ident, name, _, _ in MAPS],
            "ai": game.profiles(),
            "themes": versus_generic_teams.catalog(),
        })
    return handler._error(HTTPStatus.NOT_FOUND, "Unknown Versus endpoint.")


def last_result(path):
    """Only report a winner recorded for the most recent Versus match."""
    try:
        with path.open("rb") as stream:
            size = stream.seek(0, 2)
            stream.seek(max(0, size - 65536))
            lines = stream.read(65536).splitlines()
    except FileNotFoundError:
        return None
    for line in reversed(lines):
        if line == b"Versus: match started.":
            return None
        if line in (b"Versus: result Team A wins.", b"Versus: result Team B wins.", b"Versus: result draw."):
            return line.removeprefix(b"Versus: result ").decode("ascii")
    return None


def post(handler, route, atomic_replace):
    team_limit = 8 if route == API + "tournaments" else 2
    limit = team_limit * (4 * ((SAVE_SIZE_LIMIT + 2) // 3)) + 32768
    length = int(handler.headers.get("Content-Length", "0"))
    if not 0 < length <= limit:
        raise ValueError("Invalid Versus request size.")
    body = json.loads(handler.rfile.read(length))
    config = handler.config
    if route == API + "tournaments":
        import versus_tournaments
        if config.read_only:
            raise PermissionError("The editor is running in read-only mode.")
        with config.write_lock:
            require_project(config)
            return handler._json(versus_tournaments.update(config, body, atomic_replace))
    if route in (API + "project", API + "save", API + "queue"):
        import versus_queue
        if config.read_only:
            raise PermissionError("The editor is running in read-only mode.")
        with config.write_lock:
            if route == API + "project":
                return handler._json(configure(config, body))
            if route == API + "save":
                if not isinstance(body, dict) or type(body.get("queue", False)) is not bool:
                    raise ValueError("Invalid Versus save request.")
                match = versus_queue.create(config, body, atomic_replace)
                if body.get("queue"):
                    try:
                        versus_queue.select(config, match["id"], atomic_replace)
                    except (ValueError, OSError) as exc:
                        return handler._json(match | {"queued": False, "queueError": str(exc)})
                    match["queued"] = True
                return handler._json(match)
            if not isinstance(body, dict):
                raise ValueError("Choose a saved match.")
            if body.get("clear") is True:
                return handler._json(versus_queue.clear(config, atomic_replace))
            return handler._json({"queued": versus_queue.select(config, body.get("id"), atomic_replace)})
    if route == API + "squad":
        generated = isinstance(body, dict) and "theme" in body
        require_project(config, random_loadouts=generated)
        if generated:
            digest, title, seed, units = versus_generic_teams.build(GameData(config), body)
            return handler._json({"sha256": digest, "title": title, "seed": seed,
                                  "units": [{k: v for k, v in unit.items() if k not in ("entry", "preload", "relics")}
                                            for unit in units.values()]})
        digest, title, units, _ = slot_data(config, body)
        game = GameData(config)
        return handler._json({"sha256": digest, "title": title,
                              "units": [game.preview_unit(slot, row) for slot, row in units.items()]})
    if route == API + "preview":
        game, arena, teams, (left, right, spectator) = prepare(config, body)
        training_assets(game, arena, teams, (left, right, spectator))
        result = []
        for team, positions in zip(teams, (left, right), strict=True):
            result.append({"title": team["title"], "lineup": [
                {k: v for k, v in unit.items() if k not in ("raw", "relics", "entry", "preload")} | {"tile": tile}
                for unit, tile in zip(team["lineup"], positions, strict=True)
            ]})
        return handler._json({"arena": arena[1], "arenaId": arena[0], "teams": result, "spectator": spectator,
                              "hideSpectator": body.get("hideSpectator", True)})
    return handler._error(HTTPStatus.NOT_FOUND, "Unknown Versus endpoint.")

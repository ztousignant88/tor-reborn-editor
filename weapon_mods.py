"""Build reversible Proficiency II and Throw Reborn project data overlays."""

from base64 import b64decode
import hashlib
import json
from pathlib import Path
import struct
import zlib

from ai_choices_data import rebuild_pakd
from class_change import BATTLE, MENU
from modprep_groups import GROUP_START
from tools.menu_mods.compiler.class_text import Txte
from tools.menu_mods.compiler.spell_icons import TextureArc, make_btx
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd, Xlce
from tools.menu_mods.compiler.save_archive import SaveArchive, MAIN_TAG
from local_game_art import rename_texture, texture_bank

ROOT = Path(__file__).resolve().parent / "tools/weapon_mods"
ENGLISH = "localize/LocalizeText_en-us.dat"
SKILL_ART = "menu/texture_x4/skill_icon.dat"
KEYS = ("proficiencyII", "throwReborn", "rougesReborn")
ROGUE_FILES = ("RougesReborn/steal-config.ini", "RougesReborn/enable-awards.flag",
               "RougesReborn/enable-equipment-theft.flag")
ROGUE_CLASS = 12
ROGUE_MARK = 1427


def active(value):
    return any(value[key] for key in KEYS)


def checked_file(name):
    manifest = json.loads((ROOT / "manifest.json").read_bytes())
    data = (ROOT / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != manifest["files"][name]:
        raise ValueError("The bundled weapon mod does not match this editor")
    return data


def loader_hashes():
    manifest = json.loads((ROOT / "manifest.json").read_bytes())
    return tuple(manifest["files"][n] for n in ("standard.dll","throw.dll")) + tuple(manifest.get("replaces", []))


def unpack(data):
    archive = DatArchive.read(data)
    return archive, Pakd(archive.pack)


def rogue_files(value):
    if not value["rougesReborn"]:
        return {}
    config = ("[Steal]\r\nEquipmentMode=4\r\n\r\n[Testing]\r\nDenamAllStealSkills=0\r\n\r\n"
              "[Trap]\r\nEnabled=1\r\n")
    return {ROGUE_FILES[0]: config.encode("ascii"), **dict.fromkeys(ROGUE_FILES[1:], b"Enabled\r\n")}


def separate_trap_learning(pack, edits, trap_skills):
    """Keep traps exclusive to Rogue even when other classes share its skill set."""
    classes = Xlce(edits[14])
    skills = Xlce(edits[25])
    original_skills = Xlce(pack.entry(25))
    class_rows = {i: classes.row(i) for i in range(classes.count) if any(classes.row(i))}
    rogue_group = class_rows[ROGUE_CLASS][0x53]
    if rogue_group >= 64:
        raise ValueError("Rouges Reborn needs a native Rogue skill set before project expansions")
    shared = {i: bytearray(row) for i, row in class_rows.items()
              if i != ROGUE_CLASS and row[0x53] == rogue_group}
    spare = None
    if shared:
        occupied = {row[0x53] for row in class_rows.values()}
        # These two stock columns contain only disabled levels and the shared
        # elemental Augment skills. Preserve any project-authored learning set.
        spare = next((n for n in (63, 62) if n not in occupied and all(
            original_skills.row(i)[0x10 + n] in (0, 255) or
            (791 <= i <= 799 and original_skills.row(i)[0x10 + n] == 1)
            for i in range(original_skills.count))), None)
        if spare is None:
            raise ValueError("Rouges Reborn needs unused skill set 62 or 63 to separate Rogue trap learning")
        for row in shared.values():
            row[0x53] = spare
        edits[14] = classes.replace(shared)
    rows = {}
    for i in range(skills.count):
        row = bytearray(skills.row(i))
        if not any(row):
            continue
        if spare is not None:
            row[0x10 + spare] = 255 if i in trap_skills else row[0x10 + rogue_group]
        if i in trap_skills:
            row[0x10:0x50] = b"\xff" * 64
            row[0x10 + rogue_group] = 1
        rows[i] = row
    edits[25] = skills.replace(rows)


def merge_battle(data, standard, throwing, rogues, variant):
    archive, pack = unpack(data)
    edits = {}
    for recipe in (standard, throwing, rogues):
        for table_id, edits_by_row in recipe.get("battleRows", {}).items():
            index = int(table_id)
            table = Xlce(edits.get(index, pack.entry(index)))
            rows = {}
            for slot, edit in edits_by_row.items():
                slot = int(slot)
                if slot >= table.count:
                    raise ValueError(f"Weapon mod conflicts with battle table {index}, row {slot}")
                row = table.row(slot)
                before, after = (bytes.fromhex(edit[k]) for k in ("before","after"))
                if recipe is rogues and index in (14,23):
                    # Preserve project edits to character appearance and class
                    # stats while verifying every byte this recipe owns.
                    merged = bytearray(row)
                    for at,(old,new) in enumerate(zip(before,after)):
                        if old!=new:
                            if row[at]!=old:
                                raise ValueError(f"Rouges Reborn conflicts with battle table {index}, row {slot}, byte {at}")
                            merged[at]=new
                    rows[slot]=bytes(merged)
                else:
                    if row!=before:
                        raise ValueError(f"Weapon mod conflicts with battle table {index}, row {slot}")
                    if recipe is standard and index == 25:
                        # The mod adds the skills. Class learning is set by the project.
                        after = after[:0x10] + b"\xff" * 64 + after[0x50:]
                    rows[slot]=after
            edits[index] = table.replace(rows)
    if variant:
        table = Xlce(edits[25])
        row = bytearray(table.row(variant["original"]))
        slot = variant["variant"]
        if slot >= table.count or any(table.row(slot)):
            raise ValueError(f"Thrown II needs unused skill row {slot}")
        if row[7] != variant["weaponCategory"] or struct.unpack_from("<H", row, 0x52)[0] != variant["rankBank"]:
            raise ValueError("Thrown proficiency has an unexpected rank bank")
        row[0x10:0x50] = b"\xff" * 64
        for offset in (0x5a, 0x5c):
            struct.pack_into("<H", row, offset, slot)
        edits[25] = table.replace({slot: bytes(row)})
    if trap_skills := rogues.get("rogueOnlyTrapSkills"):
        separate_trap_learning(pack, edits, trap_skills)
    index_edits = throwing.get("battleTextIndex", {})
    if index_edits:
        table = Xlce(pack.entry(35))
        raw = bytearray(table.data)
        for slot, row in index_edits.items():
            slot = int(slot)
            if table.row_size != 24 or slot >= table.count or table.row(slot) != bytes.fromhex(row["before"]):
                raise ValueError(f"Throw Reborn conflicts with battle text index {slot}")
            offsets = []
            for name in ("nameKey", "helpKey"):
                offsets.append(len(raw))
                raw.extend(row[name].encode("utf-8") + b"\0")
            struct.pack_into("<3Q", raw, table.header+slot*table.row_size, row["flags"], *offsets)
        raw.extend(bytes((len(table.data)-len(raw)) % 16))
        edits[35] = bytes(raw)
    return archive.rebuild(rebuild_pakd(pack, edits))


def merge_text(data, standard, throwing, rogues, variant):
    archive, pack = unpack(data)
    edits = {}
    for recipe in (standard, throwing, rogues):
        for table, rows in recipe.get("localization", {}).items():
            changes = edits.setdefault(int(table), {})
            if changes.keys() & rows.keys():
                raise ValueError("Weapon mod text allocations overlap")
            changes.update(rows)
    if variant:
        prefix = f"SKILLTEXT_LC_SKILL_{variant['variant']:03d}_"
        edits.setdefault(13, {}).update({
            prefix+"NAME": {"before":"Attenuate Water", "after":"Thrown II"},
            prefix+"HELP": {
                "before":"REDUCES water DAMAGE. Amount reduced increases with AUGMENT WATER rank.",
                "after":"Shares Thrown weapon level, experience and finishers. Allows thrown weapons in any class. Replaces Thrown when equipped.",
            },
        })
    output = {}
    for index, rows in edits.items():
        table = Txte(pack.entry(index))
        mapping = table.mapping()
        updated = {}
        for key, edit in rows.items():
            prior = edit["before"]
            if mapping.get(key) != (prior.encode("utf-8") if prior is not None else None):
                raise ValueError("Weapon mod conflicts with text " + key)
            updated[key] = edit["after"].encode("utf-8")
        output[index] = table.rebuild(updated)
    return archive.rebuild(rebuild_pakd(pack, output))


def merge_shop(data, rows, edits):
    archive, pack = unpack(data)
    shop = Xlce(pack.entry(26))
    ids = {struct.unpack_from("<H",shop.row(i))[0]:i for i in range(shop.count)}
    additions = []
    for row in rows:
        raw = bytes.fromhex(row["row"])
        item = row["itemId"]
        if item in ids or shop.row_size != len(raw):
            raise ValueError(f"Integrated mod conflicts with shop item {item}")
        ids[item] = None
        additions.append(raw)
    end = shop.header + shop.count*shop.row_size
    updated = bytearray(shop.data[:end]+b"".join(additions)+shop.data[end:])
    for row in edits:
        item = row["itemId"]
        slot = ids.get(item)
        if slot is None or shop.row(slot)!=bytes.fromhex(row["before"]):
            raise ValueError(f"Rouges Reborn conflicts with shop item {item}")
        start = shop.header+slot*shop.row_size
        updated[start:start+shop.row_size] = bytes.fromhex(row["after"])
    struct.pack_into("<I", updated, 4, shop.count+len(additions))
    return archive.rebuild(rebuild_pakd(pack, {26:bytes(updated)}))


def build(value, read):
    recipes = json.loads(checked_file("recipes.json"))
    standard = recipes["proficiencies"] if value["proficiencyII"] else {}
    throwing = recipes["throw"] if value["throwReborn"] else {}
    rogues = json.loads(checked_file("rogues.json")) if value["rougesReborn"] else {}
    variant = recipes["thrownII"] if standard and throwing else None
    files = {
        BATTLE: merge_battle(read(BATTLE), standard, throwing, rogues, variant),
        ENGLISH: merge_text(read(ENGLISH), standard, throwing, rogues, variant),
    }
    shop_rows = throwing.get("appendShopRows", [])
    shop_edits = rogues.get("shopEdits", [])
    if shop_rows or shop_edits:
        files[MENU] = merge_shop(read(MENU), shop_rows, shop_edits)
    icons = {}
    for path, aliases in standard.get("textureAliases", {}).items():
        bank = texture_bank(read(path))
        icons[path] = {name: rename_texture(bank[donor], name) for name, donor in aliases.items()}
    for recipe in (standard, throwing, rogues):
        for path, textures in recipe.get("textures", {}).items():
            additions = icons.setdefault(path, {})
            if additions.keys() & textures.keys():
                raise ValueError("Weapon mod texture allocations overlap")
            additions.update({name:b64decode(texture) for name,texture in textures.items()})
    if variant:
        original = icons[SKILL_ART][f"icon_skill_{variant['original']:04d}"]
        name = f"icon_skill_{variant['variant']:04d}"
        icons[SKILL_ART][name] = make_btx(original, name, original[80:])
    for path, additions in icons.items():
        archive, pack = unpack(read(path))
        arc = TextureArc(pack.entry(0)).append(additions)
        files[path] = archive.rebuild(rebuild_pakd(pack, {0:arc}))
    return files


def rebase_rogue_permissions(data, payload, overrides=None):
    """Match the extended class groups to the final, Rogue-enabled tables."""
    _,pack = unpack(data)
    classes,templates = (Xlce(pack.entry(i)) for i in (14,23))
    section,sidecars = payload
    name = "modprep-classgroups.bin"
    permission = bytearray(sidecars[name])
    groups, class_count, template_count, stride, matrix, assignments = struct.unpack_from("<6I",permission,16)
    if (class_count,template_count)!=(classes.count,templates.count):
        raise ValueError("Rouges Reborn class groups do not match the project's tables")
    for i in range(class_count):
        start = matrix+i*stride
        permission[start:start+8] = classes.row(i)[0x88:0x90]

    mask = int.from_bytes(classes.row(ROGUE_CLASS)[0x88:0x90],"little")
    extended = {}
    for i in range(template_count):
        at = assignments+4*i
        group = struct.unpack_from("<I",permission,at)[0]
        if group>=GROUP_START:
            continue  # Community groups explicitly select whether Rogue is allowed.
        if str(ROGUE_CLASS) in (overrides or {}).get(str(group), {}):
            continue  # The project chose this built-in group's Rogue permission.
        native = templates.row(i)[0x38]
        if native>=64 or native>=groups:
            raise ValueError(f"Unsupported Rogue class group for template {i}")
        if group<64:
            struct.pack_into("<I",permission,at,native)
        else:
            allowed = bool(mask & (1<<native))
            if extended.setdefault(group,allowed)!=allowed:
                raise ValueError(f"Special class group {group} mixes incompatible Rogue permissions")
    for group,allowed in extended.items():
        at = matrix+ROGUE_CLASS*stride+group//8
        bit = 1<<(group%8)
        permission[at] = permission[at]|bit if allowed else permission[at]&~bit
    struct.pack_into("<I",permission,44,zlib.crc32(permission[112:]))
    return section,{**sidecars,name:bytes(permission)}


def rogue_recruitment(data):
    _,pack = unpack(data)
    templates = Xlce(pack.entry(23))
    return {(ROGUE_CLASS,i) for i in range(templates.count) if templates.row(i)[0x14]==1}


def assert_can_remove(previous, value):
    """Refuse to leave a normal PC save equipped with removed content."""
    remove_ii = previous.get("proficiencyII") and not value["proficiencyII"]
    remove_throw = previous.get("throwReborn") and not value["throwReborn"]
    remove_rogues = previous.get("rougesReborn") and not value["rougesReborn"]
    if not (remove_ii or remove_throw or remove_rogues):
        return
    recipes = json.loads(checked_file("recipes.json"))
    skills = set(map(int, recipes["proficiencies"]["battleRows"]["25"])) if remove_ii else set()
    if (remove_ii and previous.get("throwReborn")) or (remove_throw and previous.get("proficiencyII")):
        skills.add(recipes["thrownII"]["variant"])
    if remove_throw:
        skills.add(recipes["thrownII"]["original"])
    if remove_rogues:
        rogues = json.loads(checked_file("rogues.json"))
        skills.update(map(int,rogues["battleRows"]["25"]))
    saves = Path.home() / "Documents/My Games/Tactics Ogre Reborn/Steam"
    inventory = 0xc6+0x7b5*105+5*128+0x5f2
    for path in saves.glob("*/GAME-*.SAV"):
        try:
            main = SaveArchive(path.read_bytes()).blocks[MAIN_TAG].payload
            if len(main) != 383896:
                raise ValueError("unsupported save layout")
        except (OSError,ValueError,KeyError) as exc:
            raise ValueError(f"Could not verify weapon-mod usage in {path.name}") from exc
        if remove_throw and (
            any(struct.unpack_from("<16H",main,inventory+2*591))
            or any(struct.unpack_from("<2H",main,inventory+2*(0x300+579)))
        ):
            raise ValueError(f"{path.name} still holds Throw Reborn equipment or items")
        if remove_rogues and struct.unpack_from("<H",main,inventory+2*(0x300+ROGUE_MARK-1000))[0]:
            raise ValueError(f"{path.name} still holds a Bandit's Mark")
        for i in range(105):
            unit = 0xc6+i*0x7b5
            if not main[unit]:
                continue
            if remove_rogues and main[unit+0x88]==ROGUE_CLASS:
                raise ValueError(f"{path.name} still has a unit in the Rogue class")
            if any(struct.unpack_from("<H",main,unit+0xf0+6*j)[0] in skills for j in range(4)):
                raise ValueError(f"{path.name} still has a skill equipped from a weapon mod being removed")
            if remove_throw and any(591<=item<=606 for item in struct.unpack_from("<7H",main,unit+0x93)):
                raise ValueError(f"{path.name} still has a throwing weapon equipped")

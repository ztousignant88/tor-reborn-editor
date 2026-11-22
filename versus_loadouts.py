"""Roll complete Versus entries using the Hard Mode loadout rules."""

from collections import defaultdict
from functools import cached_property, lru_cache
import struct

from tools.menu_mods.compiler.tor_formats import u16


OPERATIONS = (0x2a, 0x44, 0x5e)
WEAPON_TYPES = range(1, 22)
GEAR_TYPES = (WEAPON_TYPES, (22,), (23,), (24,), (25,), (27,), (29,))
HEAVENLY_WEAPONS = {24, 49, 77, 110, 137, 165, 188, 219, 243, 270, 312, 338}
HP, MP, BUFF, DEBUFF, CURE = 1, 2, 4, 8, 32
NON_ORB_ITEMS = HP | MP | BUFF | DEBUFF | CURE


def item_categories(item, effects, statuses):
    """Match enemy_items.c, with the orb category omitted from Versus."""
    if item[2] != 32 or item[12] or item[13]:
        return 0
    effect_id = u16(item, 4)
    if not 0 < effect_id < effects.count:
        return 0
    effect = effects.row(effect_id)
    if effect[2] != 16:
        return 0
    categories = 0
    for offset in OPERATIONS:
        op, status_id = effect[offset], u16(effect, offset + 2)
        categories |= {2: HP, 5: MP, 23: DEBUFF, 24: CURE, 25: CURE}.get(op, 0)
        if op in (18, 19) and 0 < status_id < statuses.count:
            status = statuses.row(status_id)
            if status[10]:
                categories |= BUFF if op == 18 else DEBUFF
            elif status[11] or status_id == 34:
                categories |= DEBUFF if op == 18 else CURE
    if item[17]:
        return categories & DEBUFF if item[15] else 0
    return categories


def skill_family(skill, ident):
    return 0x10000 + skill[7] if skill[7] else u16(skill, 0x58) or ident


def accessory_level(name, stock_level):
    if 535 <= name <= 558:
        return 7 if name <= 536 or name & 1 else 19
    if 559 <= name <= 575:
        return 45
    if 576 <= name <= 588:
        return 34
    return stock_level


def equipment_level(arm, ident, settings):
    """Use the broadened non-unique gear and accessory presets for squads."""
    kind, name, level = arm[2], u16(arm, 0x86), arm[0x60]
    if kind not in range(1, 30) or (ident >= 761 and not settings.get("modPreparation")):
        return None
    if kind == 29 and settings.get("enemyForceCrestOfFire"):
        return 1 if ident == 590 else None
    if ident in (386, 394) or 661 <= ident <= 685 or level == 255:
        return None
    movement = (kind == 27 and 524 <= name <= 526) or (kind == 29 and name in (584, 585, 586, 590))
    if kind == 29:
        level = 50 if name == 590 else 33 if movement else accessory_level(name, level)
    allowed = not arm[0x50] or bool(settings.get("enemyAutoRareGear"))
    if movement:
        allowed = bool(settings.get("enemyAutoMovement"))
    elif ident in HEAVENLY_WEAPONS:
        allowed = bool(settings.get("enemyAutoHeavenlyWeapons"))
    elif 610 <= ident <= 660:
        allowed = False
    override = settings.get("enemyEquipmentOverrides", {}).get(str(ident), {})
    return override.get("level", level) if override.get("allowed", allowed) else None


class Loadouts:
    def __init__(self, game, spell_sets, statuses, spell_presets, settings):
        self.game = game
        self.spell_sets = spell_sets
        self.statuses = statuses
        self.settings = settings
        self.item_limit = min(game.items.count, 1000 if settings.get("modPreparation") else 732)
        self.learned_skills = lru_cache(maxsize=256)(self.learned_skills)
        self.learned_spells = lru_cache(maxsize=256)(self.learned_spells)
        self.spell_presets = {}
        for i in range(spell_presets.count):
            preset = spell_presets.row(i)
            self.spell_presets[preset[0], preset[1]] = struct.unpack_from("<7H", preset, 2)

    @cached_property
    def items(self):
        mask = self.settings.get("enemyItemPool", 0) & NON_ORB_ITEMS
        candidates = {}
        for ident in range(1, self.item_limit):
            categories = item_categories(self.game.items.row(ident), self.game.effects, self.statuses)
            if categories:
                candidates[ident + 1000] = categories
        return tuple(i for i, categories in candidates.items() if categories & mask) or tuple(candidates)

    @cached_property
    def scroll_effects(self):
        return tuple(dict.fromkeys(
            u16(item, 4) for ident in range(1, self.item_limit)
            if (item := self.game.items.row(ident))[2] == 34
        ))

    @cached_property
    def equipment_pool(self):
        pool = defaultdict(lambda: defaultdict(list))
        for ident in range(1, self.game.arms.count):
            arm = self.game.arms.row(ident)
            level = equipment_level(arm, ident, self.settings)
            if level is not None and level < 255:
                pool[arm[2]][level].append(ident)
        return pool

    @cached_property
    def finisher_pool(self):
        pool = defaultdict(list)
        # The native generator reads the category from the proficiency table.
        # Ranged categories skip reserved IDs, so weapon type alone is not a formula.
        categories = {self.game.skills.row(kind)[6] for kind in WEAPON_TYPES}
        categories.discard(0)
        for ident in range(1, self.game.effects.count):
            effect = self.game.effects.row(ident)
            if effect[2] in categories and effect[0x82] <= 40:
                pool[effect[2]].append((ident, effect[0x82], u16(effect, 0x7c)))
        return pool

    def learned_skills(self, klass, restriction, level):
        column = 0x10 + klass[0x53]
        learned = {}
        if column >= self.game.skills.row_size:
            return learned
        for ident in range(1, min(self.game.skills.count, 1024)):
            skill = self.game.skills.row(ident)
            if not 0 < skill[column] <= level or skill[2] in (0, 6) or skill[0x5e]:
                continue
            if restriction and skill[0x65] and restriction != skill[0x65]:
                continue
            effect_id = u16(skill, 4)
            if 0 < effect_id < self.game.effects.count:
                effect = self.game.effects.row(effect_id)
                if any(effect[op] == 29 for op in OPERATIONS):
                    continue
            learned[ident] = skill
        return learned

    def learned_spells(self, class_id, column, level):
        if column >= self.spell_sets.row_size:
            return ()
        choices = []
        for ident in self.scroll_effects:
            if not 0 < ident < self.game.effects.count:
                continue
            effect = self.game.effects.row(ident)
            group = u16(effect, 0x90)
            if (1 <= effect[2] <= 13 and u16(effect, 0x7c) in (0, class_id)
                    and group < self.spell_sets.count
                    and 0 < self.spell_sets.row(group)[column] <= level):
                choices.append(ident)
        return tuple(choices)

    def gear(self, donor, klass, template, level, weapon_types, random):
        def permitted(ident):
            arm = self.game.arms.row(ident)
            group = klass[0x60]
            return (group < 64 and bool(arm[0x58 + group // 8] & (1 << (group % 8)))
                    and arm[0xf] in (0, template[3] + 1))

        gear = []
        for i, types in enumerate(GEAR_TYPES):
            fixed = u16(donor, 0x4a + 4 * i)
            if fixed == 999 or (i == 1 and gear[0] and self.game.arms.row(gear[0])[0xd]):
                gear.append(0)
                continue
            if fixed and permitted(fixed) and not (i == 6 and self.settings.get("enemyForceCrestOfFire")):
                gear.append(fixed)
                continue
            candidates = defaultdict(list)
            for kind in types:
                for minimum, ids in self.equipment_pool[kind].items():
                    if minimum <= level:
                        candidates[minimum].extend(ident for ident in ids if permitted(ident))
            candidates = {minimum: ids for minimum, ids in candidates.items() if ids}
            if i == 0:
                preferred = {minimum: [ident for ident in ids if self.game.arms.row(ident)[2] in weapon_types]
                             for minimum, ids in candidates.items()}
                candidates = {minimum: ids for minimum, ids in preferred.items() if ids} or candidates
            gear.append(random.choice(candidates[max(candidates)]) if candidates else 0)
        return gear

    def skills_and_finishers(self, donor, learned, gear, column, level, random):
        weapon_types = {self.game.arms.row(ident)[2] for ident in gear[:2] if ident}
        weapon_types.intersection_update(WEAPON_TYPES)
        skills, finishers, families = [], [], set()

        def take(ident, rank):
            skill = learned[ident]
            family = skill_family(skill, ident)
            if family not in families:
                skills.append((ident, rank))
                families.add(family)
                return True
            return False

        for kind in sorted(weapon_types):
            proficiency = next((ident for ident, skill in learned.items() if skill[7] == kind), 0)
            if not proficiency:
                continue
            rank = min(level, 40)
            take(proficiency, rank)
            category = self.game.skills.row(kind)[6]
            finishers.extend(ident for ident, required, restricted in self.finisher_pool[category]
                             if required <= rank and restricted in (0, donor[6]))
        best = {}
        for ident, skill in learned.items():
            family = skill_family(skill, ident)
            if skill[7] in WEAPON_TYPES or family in families:
                continue
            previous = best.get(family)
            if previous is None or skill[column] > learned[previous][column]:
                best[family] = ident
        for offset in range(0x22, 0x32, 4):
            ident = u16(donor, offset)
            if ident in learned and learned[ident][7] not in WEAPON_TYPES and len(skills) < 4:
                take(ident, u16(donor, offset + 2))
        choices = [ident for family, ident in best.items() if family not in families]
        skills.extend((ident, 1) for ident in random.sample(choices, min(4 - len(skills), len(choices))))
        return skills, finishers[:8]

    def fill(self, row, donor, klass, template, random):
        level = row[8]
        learned = self.learned_skills(klass, template[0x53], level)
        preferred_weapons = {self.game.skills.row(ident)[7] for at in range(0x22, 0x32, 4)
                             if (ident := u16(donor, at)) in learned}
        preferred_weapons.intersection_update(WEAPON_TYPES)
        if not preferred_weapons:
            preferred_weapons = {skill[7] for skill in learned.values() if skill[7] in WEAPON_TYPES}
        gear = self.gear(donor, klass, template, level, preferred_weapons, random)
        skills, finishers = self.skills_and_finishers(donor, learned, gear, 0x10 + klass[0x53], level, random)
        pool = self.learned_spells(donor[6], klass[0x51], level)
        spells = list(dict.fromkeys(u16(donor, at) for at in range(0x86, 0x8e, 2)
                                   if u16(donor, at) in pool))
        if not spells:
            # Preserve a role-defining preset spell, such as a Cleric's heal,
            # then fill the remaining slots from the Hard Mode pool.
            preset = self.spell_presets.get((donor[6], donor[0x1b]), ())
            lead = next((ident for ident in preset if ident in pool), None)
            if lead:
                spells.append(lead)
        choices = [ident for ident in pool if ident not in spells]
        spells.extend(random.sample(choices, min(4 - len(spells), len(choices))))
        if not self.items:
            raise ValueError("The installed game data has no eligible non-orb consumables for Versus.")
        items = random.choices(self.items, k=4)

        for i, (ident, rank) in enumerate(skills):
            struct.pack_into("<HH", row, 0x22 + 4 * i, ident, rank)
        for values, offset, stride in ((gear, 0x4a, 4), (items, 0x66, 4),
                                       (spells, 0x86, 2), (finishers, 0x9c, 2)):
            for i, ident in enumerate(values):
                struct.pack_into("<H", row, offset + stride * i, ident)

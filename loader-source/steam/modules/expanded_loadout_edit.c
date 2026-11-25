/* Stock equip conversions and class rules used by the eight-slot menus. */
typedef int (*LoadoutResolveBooks)(const uint8_t *, uint16_t *, uint8_t);
typedef uint8_t *(*LoadoutBuildSkillState)(uint8_t *, const uint16_t *);

static const uint8_t *loadout_spell_bank(const uint8_t *unit, unsigned slot) {
    if (slot < LOADOUT_STOCK) return unit + LOADOUT_SPELL_AT;
    return loadout_has_extension(unit) ? unit + LOADOUT_EXTRA_SPELL_AT : NULL;
}

static uint16_t loadout_effect_at(const uint8_t *unit, unsigned slot) {
    if (!unit || slot >= LOADOUT_SLOTS) return 0;
    const uint8_t *books = loadout_spell_bank(unit, slot);
    if (!books) return 0;
    uint16_t effects[LOADOUT_STOCK] = {0};
    ((LoadoutResolveBooks)(mm_base + 0x43f860))(books, effects, 1);
    return effects[slot % LOADOUT_STOCK];
}

static int loadout_equip_effect(uint8_t *unit, unsigned slot, uint16_t effect) {
    if (!unit || slot >= LOADOUT_SLOTS || (slot >= LOADOUT_STOCK && !loadout_can_extend(unit))) return 0;
    if (!effect) return loadout_set_spellbook(unit, slot, 0);
    typedef uint16_t *(*BookForEffect)(uint16_t *, uint16_t);
    uint16_t book = 0;
    ((BookForEffect)(mm_base + 0x3363a0))(&book, effect);
    if (!book) return 0;

    const uint16_t previous = loadout_spellbook(unit, slot);
    for (unsigned other = 0; other < LOADOUT_SLOTS; ++other) {
        if (other != slot && loadout_effect_at(unit, other) == effect) {
            loadout_set_spellbook(unit, other, previous);
            break;
        }
    }
    return loadout_set_spellbook(unit, slot, book);
}

static void loadout_clear_spell(uint8_t *books, unsigned slot) {
    uint8_t *unit = books - LOADOUT_SPELL_AT;
    if (slot < LOADOUT_STOCK || loadout_has_extension(unit)) loadout_set_spellbook(unit, slot, 0);
}

static void loadout_clear_spells(uint8_t *books) {
    uint8_t *unit = books - LOADOUT_SPELL_AT;
    memset(books, 0, 2 * LOADOUT_STOCK);
    if (loadout_has_extension(unit)) memset(unit + LOADOUT_EXTRA_SPELL_AT, 0, 2 * LOADOUT_STOCK);
}

static void loadout_clear_skills(uint8_t *status) {
    typedef void (*Clear)(uint8_t *);
    uint8_t *unit = status - (LOADOUT_SKILL_AT - 2);
    if (loadout_has_extension(unit)) {
        enum { SPELL_TAIL = LOADOUT_SPELL_AT - LOADOUT_EXTRA_SPELL_AT };
        uint8_t saved[SPELL_TAIL];
        memcpy(saved, unit + LOADOUT_EXTRA_SPELL_AT, SPELL_TAIL);
        ((Clear)(mm_base + 0x447d10))(status);
        memcpy(unit + LOADOUT_EXTRA_SPELL_AT, saved, SPELL_TAIL);
    } else {
        ((Clear)(mm_base + 0x447d10))(status);
    }
}

static uint16_t loadout_skill_id_at(const uint8_t *unit, unsigned slot) {
    typedef uint16_t (*SkillAt)(const uint8_t *, unsigned);
    const SkillAt get = (SkillAt)(mm_base + 0x333690);
    if (!unit || slot >= LOADOUT_SLOTS) return 0;
    if (slot < LOADOUT_STOCK) return get(unit, slot);
    if (!loadout_has_extension(unit)) return 0;
    uint8_t copy[LOADOUT_CORE_PREFIX];
    loadout_copy_extra_skills(copy, unit);
    return get(copy, slot - LOADOUT_STOCK);
}

static void loadout_skill_rank_mask(const uint8_t *unit, uint8_t mask[3]) {
    typedef uint8_t *(*RankMask)(const uint16_t *, uint8_t *);
    const RankMask scan = (RankMask)(mm_base + 0x448320);
    uint16_t ids[LOADOUT_SLOTS];
    for (unsigned slot = 0; slot < LOADOUT_SLOTS; ++slot) ids[slot] = loadout_skill_id_at(unit, slot);
    uint8_t more[3];
    scan(ids, mask);
    scan(ids + LOADOUT_STOCK, more);
    for (unsigned i = 0; i < 3; ++i) mask[i] |= more[i];
}

static void loadout_equip_skill(uint8_t *unit, unsigned slot, uint16_t skill) {
    if (!unit || slot >= LOADOUT_SLOTS || (slot >= LOADOUT_STOCK && !loadout_can_extend(unit))) return;
    typedef uint8_t *(*PartyUnit)(uint8_t *, const uint8_t *);
    typedef uint8_t *(*LearnedSkillState)(const uint8_t *, uint8_t *, const uint16_t *);
    typedef void (*ApplySkillState)(uint8_t *, const uint8_t *);
    typedef void (*RemoveConflicts)(uint16_t *, uint16_t);
    typedef void (*UpdateFinishers)(uint8_t *, const uint8_t *, const uint8_t *);

    const uint8_t *selected = loadout_skill_at(unit, slot);
    if (selected && loadout_word(selected) == skill) return;
    uint8_t before[3], after[3], old[LOADOUT_SKILL_SIZE] = {0}, replacement[LOADOUT_SKILL_SIZE] = {0};
    if (selected) memcpy(old, selected, sizeof(old));
    loadout_skill_rank_mask(unit, before);

    uint16_t raw[LOADOUT_SLOTS] = {0};
    for (unsigned index = 0; index < LOADOUT_SLOTS; ++index) {
        const uint8_t *record = loadout_skill_at(unit, index);
        if (record) raw[index] = loadout_word(record);
    }
    unsigned other = 0;
    while (other < LOADOUT_SLOTS && (other == slot || raw[other] != skill)) ++other;
    if (skill && other < LOADOUT_SLOTS) memcpy(replacement, loadout_skill_at(unit, other), sizeof(replacement));
    if (skill && other == LOADOUT_SLOTS) {
        const uint8_t *party = ((PartyUnit)(mm_base + 0x31ecc0))(mm_base + 0xed3960, unit);
        const uint16_t single[LOADOUT_STOCK] = {skill};
        uint8_t state[40], copy[LOADOUT_CORE_PREFIX];
        if (party) ((LearnedSkillState)(mm_base + 0x4408f0))(party, state, single);
        else ((LoadoutBuildSkillState)(mm_base + 0x447500))(state, single);
        memcpy(copy, unit, sizeof(copy));
        ((ApplySkillState)(mm_base + 0x335200))(copy, state);
        memcpy(replacement, copy + LOADOUT_SKILL_AT, sizeof(replacement));
    }

    if (skill) {
        uint16_t filtered[LOADOUT_SLOTS];
        memcpy(filtered, raw, sizeof(raw));
        const RemoveConflicts filter = (RemoveConflicts)(mm_base + 0x448a40);
        filter(filtered, skill);
        filter(filtered + LOADOUT_STOCK, skill);
        for (unsigned index = 0; index < LOADOUT_SLOTS; ++index) {
            if (index != slot && index != other && raw[index] && !filtered[index]) {
                const uint8_t empty[LOADOUT_SKILL_SIZE] = {0};
                loadout_set_skill(unit, index, empty);
            }
        }
        if (other < LOADOUT_SLOTS) loadout_set_skill(unit, other, old);
    }
    loadout_set_skill(unit, slot, replacement);
    loadout_skill_rank_mask(unit, after);
    ((UpdateFinishers)(mm_base + 0x46b230))(unit, before, after);
}

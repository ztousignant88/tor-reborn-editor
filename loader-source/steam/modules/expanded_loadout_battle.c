static int loadout_collect_special_skills(uint16_t *out, const uint8_t *unit) {
    return loadout_collect_skills(out, unit, (LoadoutSkillCollector)(mm_base + 0x3c0880));
}

static int loadout_extra_passive_bonus(const void *actor, const int16_t *modifiers, unsigned count) {
    typedef struct { const uint8_t *unit; uint8_t blocked; } UnitView;
    typedef UnitView *(*GetUnit)(const void *, UnitView *);
    typedef uint16_t (*GetSkill)(const uint8_t *, unsigned);
    typedef int (*GetMultiplier)(const uint8_t *, unsigned);
    UnitView storage;
    const UnitView *view = ((GetUnit)(mm_base + 0x3418c0))(actor, &storage);
    if (view->blocked || !loadout_has_extension(view->unit)) return 0;

    const GetSkill skill_at = (GetSkill)(mm_base + 0x333690);
    const GetMultiplier multiplier_at = (GetMultiplier)(mm_base + 0x333850);
    uint8_t copy[LOADOUT_CORE_PREFIX];
    loadout_copy_extra_skills(copy, view->unit);
    int sum = 0;
    for (unsigned i = 0; i < LOADOUT_STOCK; ++i) {
        const uint16_t id = skill_at(copy, i);
        if (!id) continue;
        for (unsigned row = 0; row < count; ++row) {
            if (modifiers[row] / 100 == id) {
                sum += modifiers[row] * multiplier_at(copy, i);
                break;
            }
        }
    }
    return sum;
}

static void loadout_collect_automatic(void *actions, const uint8_t *unit) {
    typedef void (*Collect)(void *, const uint8_t *);
    const Collect collect = (Collect)(mm_base + 0x44c790);
    collect(actions, unit);
    if (!loadout_has_extension(unit)) return;

    /* The stock builder also consults the status queue at unit+0x11a.
     * It bounds the shared result at 14 entries and skips duplicate IDs. */
    uint8_t copy[0x126];
    memcpy(copy, unit, sizeof(copy));
    memcpy(copy + LOADOUT_SKILL_AT, unit + LOADOUT_FIRST_EXTRA, LOADOUT_STOCK * LOADOUT_SKILL_SIZE);
    memcpy(copy + LOADOUT_SPELL_AT, unit + LOADOUT_EXTRA_SPELL_AT, 2 * LOADOUT_STOCK);
    collect(actions, copy);
}

static void loadout_restrict_spellbooks(uint8_t *books, unsigned class_id) {
    typedef void (*Restrict)(uint8_t *, unsigned);
    const Restrict restrict_books = (Restrict)(mm_base + 0x43fb50);
    restrict_books(books, class_id);
    uint8_t *unit = books - LOADOUT_SPELL_AT;
    if (loadout_has_extension(unit)) restrict_books(unit + LOADOUT_EXTRA_SPELL_AT, class_id);
}

static uint16_t loadout_raw_skill(const uint8_t *status, unsigned slot) {
    const uint8_t *record = loadout_skill_at(status - (LOADOUT_SKILL_AT - 2), slot);
    return record ? loadout_word(record) : 0;
}

static void loadout_clear_skill_record(uint8_t *status, unsigned slot) {
    uint8_t *unit = status - (LOADOUT_SKILL_AT - 2);
    if (slot >= LOADOUT_STOCK && !loadout_has_extension(unit)) return;
    const uint8_t empty[LOADOUT_SKILL_SIZE] = {0};
    loadout_set_skill(unit, slot, empty);
}

enum { LOADOUT_SKILL_HEADER = LOADOUT_SKILL_AT - 2 };

static uint8_t loadout_has_skill_family(const uint8_t *status, uint16_t id) {
    typedef uint8_t (*Check)(const uint8_t *, uint16_t);
    const Check check = (Check)(mm_base + 0x4488e0);
    if (check(status, id)) return 1;
    const uint8_t *unit = status - LOADOUT_SKILL_HEADER;
    /* Membership checks only inspect record IDs, so no header is read. */
    return loadout_has_extension(unit) && check(status + LOADOUT_STOCK * LOADOUT_SKILL_SIZE, id);
}

static uint8_t loadout_has_active_skill(const uint8_t *status) {
    typedef uint8_t (*Check)(const uint8_t *);
    const Check check = (Check)(mm_base + 0x448890);
    if (check(status)) return 1;
    const uint8_t *unit = status - LOADOUT_SKILL_HEADER;
    return loadout_has_extension(unit) && check(status + LOADOUT_STOCK * LOADOUT_SKILL_SIZE);
}

static uint8_t loadout_has_book(const uint8_t *books, uint16_t book) {
    typedef uint8_t (*Check)(const uint8_t *, uint16_t);
    const Check check = (Check)(mm_base + 0x43f9f0);
    if (check(books, book)) return 1;
    const uint8_t *unit = books - LOADOUT_SPELL_AT;
    return loadout_has_extension(unit) && check(unit + LOADOUT_EXTRA_SPELL_AT, book);
}

static uint8_t *loadout_skill_details(const uint8_t *status, uint8_t *result, uint16_t id,
                                     const void *identity, int roster_slot, const void *learned) {
    typedef uint8_t *(*Get)(const uint8_t *, uint8_t *, uint16_t, const void *, int, const void *);
    const Get get = (Get)(mm_base + 0x448200);
    get(status, result, id, identity, roster_slot, learned);
    const uint8_t *unit = status - LOADOUT_SKILL_HEADER;
    if (result[0] || !loadout_has_extension(unit)) return result;
    uint8_t extra[2 + LOADOUT_STOCK * LOADOUT_SKILL_SIZE];
    memcpy(extra, status, 2);
    memcpy(extra + 2, unit + LOADOUT_FIRST_EXTRA, sizeof(extra) - 2);
    return get(extra, result, id, identity, roster_slot, learned);
}

static void loadout_recheck_weapon_skills(uint8_t *status, const void *equipment) {
    typedef void (*Recheck)(uint8_t *, const void *);
    const Recheck recheck = (Recheck)(mm_base + 0x448b30);
    recheck(status, equipment);
    if (loadout_has_extension(status - LOADOUT_SKILL_HEADER)) {
        recheck(status + LOADOUT_STOCK * LOADOUT_SKILL_SIZE, equipment);
    }
}

typedef struct {
    uint8_t levels, count;
    uint16_t finishers[4];
} LoadoutSkillRewards;

static LoadoutSkillRewards *loadout_weapon_skill_rewards(
    uint8_t *status, LoadoutSkillRewards *result, const void *identity, int roster_slot, const void *learned) {
    typedef LoadoutSkillRewards *(*Update)(uint8_t *, LoadoutSkillRewards *, const void *, int, const void *);
    const Update update = (Update)(mm_base + 0x447750);
    update(status, result, identity, roster_slot, learned);
    uint8_t *unit = status - LOADOUT_SKILL_HEADER;
    if (!loadout_has_extension(unit)) return result;

    uint8_t extra[2 + LOADOUT_STOCK * LOADOUT_SKILL_SIZE];
    memcpy(extra, status, 2);
    memcpy(extra + 2, unit + LOADOUT_FIRST_EXTRA, sizeof(extra) - 2);
    LoadoutSkillRewards earned = {0};
    update(extra, &earned, identity, roster_slot, learned);
    memcpy(unit + LOADOUT_FIRST_EXTRA, extra + 2, sizeof(extra) - 2);
    result->levels += earned.levels;
    for (unsigned i = 0; i < earned.count && result->count < 4; ++i) {
        result->finishers[result->count++] = earned.finishers[i];
    }
    return result;
}

static void loadout_swap_skill_records(uint8_t *left, uint8_t *right) {
    typedef void (*Swap)(uint8_t *, uint8_t *);
    ((Swap)(mm_base + 0x447bb0))(left, right);
    uint8_t *left_unit = left - LOADOUT_SKILL_HEADER;
    uint8_t *right_unit = right - LOADOUT_SKILL_HEADER;
    if (!(loadout_has_extension(left_unit) || loadout_has_extension(right_unit)) ||
        !loadout_can_extend(left_unit) || !loadout_can_extend(right_unit)) return;
    uint8_t saved[LOADOUT_STOCK * LOADOUT_SKILL_SIZE];
    memcpy(saved, left_unit + LOADOUT_FIRST_EXTRA, sizeof(saved));
    for (unsigned i = 0; i < LOADOUT_STOCK; ++i) {
        loadout_set_skill(left_unit, LOADOUT_STOCK + i, right_unit + LOADOUT_FIRST_EXTRA + i * LOADOUT_SKILL_SIZE);
        loadout_set_skill(right_unit, LOADOUT_STOCK + i, saved + i * LOADOUT_SKILL_SIZE);
    }
}

typedef struct {
    uint16_t type, effect, target, secondary;
    uint32_t availability;
} LoadoutAIAction;

static int loadout_ai_spells(const void *context, LoadoutAIAction *out, int capacity) {
    typedef int (*Native)(const void *, LoadoutAIAction *, int);
    typedef uint8_t (*CanUse)(const uint8_t *, uint16_t);
    typedef void (*BuildAction)(LoadoutAIAction *, uint16_t);
    typedef uint32_t (*Availability)(const LoadoutAIAction *, const uint8_t *, const void *, uint8_t, uint8_t);
    int count = ((Native)(mm_base + 0x3c24a0))(context, out, capacity);
    if (count < 0 || count >= capacity) return count;

    const uint8_t *actor;
    memcpy(&actor, context, sizeof(actor));
    const uint8_t *unit = actor + 0x138;
    if (!loadout_has_extension(unit)) return count;

    const void *battle;
    memcpy(&battle, actor + 0x728, sizeof(battle));
    uint16_t effects[LOADOUT_STOCK];
    int extra = ((LoadoutSpellCollector)(mm_base + 0x43f910))(unit + LOADOUT_EXTRA_SPELL_AT, effects);
    for (int i = 0; i < extra && count < capacity; ++i) {
        const uint16_t effect = effects[i];
        int existing = 0;
        while (existing < count && out[existing].effect != effect) ++existing;
        if (existing < count || !((CanUse)(mm_base + 0x4466e0))(actor + 0x1d8, effect)) continue;

        LoadoutAIAction action = {0};
        ((BuildAction)(mm_base + 0x3c1520))(&action, effect);
        const uint32_t availability = ((Availability)(mm_base + 0x3c0a80))(&action, actor, battle, 1, 1);
        if (availability != 0 && availability != 7) continue;
        action.availability = availability;
        out[count++] = action;
    }
    return count;
}

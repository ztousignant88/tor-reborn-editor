/* The Steam command pickers have room for more results than the equip arrays.
 * Invoke the native four-slot collectors twice. Their own stack locals and
 * other callers still depend on the original four-slot ABI. */
#include "expanded_loadout_storage.h"

typedef int (*LoadoutSpellCollector)(const uint8_t *books, uint16_t *out);
typedef int (*LoadoutSkillCollector)(uint16_t *out, const uint8_t *unit);

enum { LOADOUT_CORE_PREFIX = 0x118 };

static void loadout_copy_extra_skills(uint8_t copy[LOADOUT_CORE_PREFIX], const uint8_t *unit) {
    memcpy(copy, unit, LOADOUT_CORE_PREFIX);
    memcpy(copy + LOADOUT_SKILL_AT, unit + LOADOUT_FIRST_EXTRA, LOADOUT_STOCK * LOADOUT_SKILL_SIZE);
}

static int loadout_append_commands(uint16_t *out, int count, const uint16_t *more, int added) {
    if (count < 0 || count > LOADOUT_STOCK || added < 0 || added > LOADOUT_STOCK) return count;
    for (int n = 0; n < added; ++n) {
        if (!more[n]) continue;
        int i = 0;
        while (i < count && out[i] != more[n]) ++i;
        if (i == count) out[count++] = more[n];
    }
    return count;
}

/* Only use at call sites with at least eight output words. The caller supplies
 * the normal spellbook array embedded in the live unit core. */
static int loadout_collect_spells(const uint8_t *books, uint16_t *out) {
    const LoadoutSpellCollector collect = (LoadoutSpellCollector)(mm_base + 0x43f910);
    const int count = collect(books, out);
    const uint8_t *unit = books - LOADOUT_SPELL_AT;
    if (!loadout_has_extension(unit)) return count;
    uint16_t more[LOADOUT_STOCK];
    const int added = collect(unit + LOADOUT_EXTRA_SPELL_AT, more);
    return loadout_append_commands(out, count, more, added);
}

static int loadout_collect_skills(uint16_t *out, const uint8_t *unit, LoadoutSkillCollector collect) {
    const int count = collect(out, unit);
    if (!loadout_has_extension(unit)) return count;
    uint8_t copy[LOADOUT_CORE_PREFIX];
    uint16_t more[LOADOUT_STOCK];
    loadout_copy_extra_skills(copy, unit);
    const int added = collect(more, copy);
    return loadout_append_commands(out, count, more, added);
}

static int loadout_collect_active_skills(uint16_t *out, const uint8_t *unit) {
    return loadout_collect_skills(out, unit, (LoadoutSkillCollector)(mm_base + 0x3bfb20));
}

static uint8_t loadout_knows_spell(const uint8_t *books, uint16_t effect) {
    typedef uint8_t (*Knows)(const uint8_t *, uint16_t);
    const Knows knows = (Knows)(mm_base + 0x43f980);
    if (knows(books, effect)) return 1;
    const uint8_t *unit = books - LOADOUT_SPELL_AT;
    return loadout_has_extension(unit) && knows(unit + LOADOUT_EXTRA_SPELL_AT, effect);
}

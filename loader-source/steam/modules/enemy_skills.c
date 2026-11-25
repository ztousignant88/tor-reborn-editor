/* Fill vacant equipped skill records from the game's learnable-skill scan. */
#include "expanded_loadout_storage.h"

enum { ES_NATIVE_SKILL_COUNT = 800, ES_BITMAP_CAPACITY = 1024 };
static int enemy_loadouts_expanded;

static unsigned es_slot_limit(const uint8_t *character) {
    return enemy_loadouts_expanded && loadout_can_extend(character) ? LOADOUT_SLOTS : LOADOUT_STOCK;
}

typedef struct {
    const uint8_t *rows;
    uint32_t count;
    uint32_t stride;
} EsTable;

static EsTable es_table(unsigned pointer_rva, unsigned minimum_stride) {
    const uint8_t *table;
    memcpy(&table, mm_base + pointer_rva, sizeof table);
    EsTable result = {0};
    if (!mm_readable(table, 16) || memcmp(table, "xlce", 4))
        return result;
    uint32_t header;
    memcpy(&result.count, table + 4, 4);
    memcpy(&header, table + 8, 4);
    memcpy(&result.stride, table + 12, 4);
    if (header < 16 || header > 4096 || !result.count || result.count > 4096 ||
        result.stride < minimum_stride || result.stride > 512 ||
        !mm_readable(table + header, (size_t)result.count * result.stride))
        return (EsTable){0};
    result.rows = table + header;
    return result;
}

static uint16_t es_word(const uint8_t *at) {
    uint16_t value;
    memcpy(&value, at, sizeof value);
    return value;
}

static unsigned es_family(const EsTable *skills, unsigned id) {
    if (id >= skills->count)
        return id;
    const uint8_t *row = skills->rows + id * skills->stride;
    if (row[7])
        return 0x10000u + row[7];
    const unsigned group = es_word(row + 0x58);
    return group ? group : id;
}

static int es_is_recruitment(const EsTable *effects, const uint8_t *skill) {
    const unsigned effect = es_word(skill + 4);
    if (effect >= effects->count)
        return 0;
    const uint8_t *row = effects->rows + effect * effects->stride;
    // The native effect dispatcher uses operation 29 for recruitment.
    return row[0x2a] == 29 || row[0x44] == 29 || row[0x5e] == 29;
}

static unsigned es_choose(uint32_t *seed, unsigned count) {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 17;
    *seed ^= *seed << 5;
    return *seed % count;
}

static unsigned es_fill_skills(uint8_t *unit) {
    uint8_t *character = unit + 0x138;
    const unsigned slot_limit = es_slot_limit(character);
    uint16_t slots[LOADOUT_SLOTS] = {0};
    unsigned vacancies[LOADOUT_SLOTS], blocked[LOADOUT_SLOTS];
    unsigned vacancy_count = 0, blocked_count = 0;
    for (unsigned slot = 0; slot < slot_limit; ++slot) {
        const uint8_t *record = loadout_skill_at(character, slot);
        slots[slot] = record ? es_word(record) : 0;
        if (!slots[slot])
            vacancies[vacancy_count++] = slot;
    }
    if (!vacancy_count || !character[0x4a])
        return 0;

    const EsTable skills = es_table(0xd682f8, 102);
    const EsTable classes = es_table(0xd68338, 0x54);
    const EsTable templates = es_table(0xd68340, 0x54);
    const EsTable effects = es_table(0xd68348, 180);
    if (!effects.rows)
        return 0;
    const uint16_t info[] = {character[0x49], character[0x4a], es_word(character)};
    if (skills.count < ES_NATIVE_SKILL_COUNT || info[0] >= classes.count ||
        info[2] >= templates.count)
        return 0;
    const unsigned column = 0x10u + classes.rows[info[0] * classes.stride + 0x53];
    if (column >= skills.stride)
        return 0;

    /* Native learning scan takes a bitset with room for the expanded skill table and a separate
     * ranked-skill result with 100 IDs and its count at +0xc8. */
    uint8_t learned[ES_BITMAP_CAPACITY / 8] = {0};
    uint32_t ranked[51] = {0};
    typedef unsigned (*LearnableSkills)(uint8_t *, const uint16_t *, uint32_t *);
    ((LearnableSkills)(mm_base + 0x43f2e0))(learned, info, ranked);

    for (unsigned slot = 0; slot < slot_limit; ++slot) {
        if (slots[slot])
            blocked[blocked_count++] = es_family(&skills, slots[slot]);
    }

    const unsigned limit = skills.count < ES_BITMAP_CAPACITY ? skills.count : ES_BITMAP_CAPACITY;
    uint16_t candidates[ES_BITMAP_CAPACITY];
    unsigned candidate_count = 0;
    for (unsigned id = 1; id < limit; ++id) {
        if (!(learned[id / 8] & (1u << (id % 8))))
            continue;
        /* Rank types 1–21 are weapon proficiencies, including variants. */
        const uint8_t *skill = skills.rows + id * skills.stride;
        if (es_is_recruitment(&effects, skill))
            continue;
        const unsigned rank_type = skill[7];
        if (rank_type >= 1 && rank_type <= 21)
            continue;
        const unsigned family = es_family(&skills, id);
        unsigned j = 0;
        while (j < blocked_count && blocked[j] != family)
            ++j;
        if (j != blocked_count)
            continue;
        for (j = 0; j < candidate_count; ++j)
            if (es_family(&skills, candidates[j]) == family)
                break;
        if (j == candidate_count)
            candidates[candidate_count++] = (uint16_t)id;
        else if (skills.rows[id * skills.stride + column] >
                 skills.rows[candidates[j] * skills.stride + column])
            candidates[j] = (uint16_t)id;
    }
    LARGE_INTEGER now = {0};
    QueryPerformanceCounter(&now);
    uint32_t seed = (uint32_t)now.QuadPart ^ ((uint32_t)es_word(character + 2) << 16) ^ unit[0x2fc];
    if (!seed)
        seed = 1;
    unsigned added = 0;
    for (; added < vacancy_count && candidate_count; ++added) {
        unsigned pick = es_choose(&seed, candidate_count);
        uint16_t id = candidates[pick];
        candidates[pick] = candidates[--candidate_count];
        uint8_t record[LOADOUT_SKILL_SIZE] = {0, 0, 1};
        memcpy(record, &id, sizeof id);
        if (!loadout_set_skill(character, vacancies[added], record))
            break;
        slots[vacancies[added]] = id;
    }
    static volatile LONG logged;
    if (added && InterlockedIncrement(&logged) <= 120) {
        char line[220];
        snprintf(line, sizeof line,
            "Enemy skills: unit %u class %u level %u, added %u, limit %u, slots [%u,%u,%u,%u,%u,%u,%u,%u].\r\n",
            unit[0x2fc], info[0], info[1], added, slot_limit,
            slots[0], slots[1], slots[2], slots[3], slots[4], slots[5], slots[6], slots[7]);
        mm_log(line);
    }
    return added;
}

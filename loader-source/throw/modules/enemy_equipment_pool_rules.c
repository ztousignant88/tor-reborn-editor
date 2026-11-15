enum { EE_RANDOM = 1, EE_GEAR = 2, EE_RARE = 4, EE_ACCESSORIES = 8, EE_MOVEMENT = 16, EE_FORCE_CREST = 32, EE_HEAVENLY = 128 };
enum { EE_CREST_ID = 590 };
static unsigned ee_options;
#include "enemy_equipment_overrides.c"

static int ee_movement(unsigned type, unsigned name) {
    return (type == 27 && name >= 524 && name <= 526) ||
           (type == 29 && ((name >= 584 && name <= 586) || name == EE_CREST_ID));
}

static int ee_heavenly_weapon(unsigned id) {
    switch (id) {
        case 24: case 49: case 77: case 110: case 137: case 165: case 188: case 219: case 243: case 270: case 312: case 338:
            return 1;
        default:
            return 0;
    }
}

static unsigned ee_accessory_tier(unsigned name, unsigned fallback) {
    if (name >= 535 && name <= 558) {
        // The two starting necklaces and the unupgraded stat rings.
        return name <= 536 || (name & 1) ? 7 : 19;
    }
    if (name >= 559 && name <= 575)
        return 45;  // Weapon earrings.
    if (name >= 576 && name <= 588)
        return 34;  // Chokers and advanced rings.
    return fallback;
}

static unsigned ee_minimum(const uint8_t *row, unsigned id) {
    const unsigned entry = ee_override(id);
    if (entry & EE_HAS_LEVEL)
        return entry & 0xff;
    const unsigned name = es_word(row + 0x86);
    if (row[2] == 29 && (ee_options & (EE_ACCESSORIES | EE_MOVEMENT))) {
        if (name == EE_CREST_ID)
            return 50;
        if (ee_movement(29, name))
            return 33;
        if (ee_options & EE_ACCESSORIES)
            return ee_accessory_tier(name, row[0x60]);
    }
    return row[0x60];
}

static int ee_in_pool(const uint8_t *row, unsigned id, int level) {
    const unsigned type = row[2], name = es_word(row + 0x86);
    if (type == 29 && (ee_options & EE_FORCE_CREST))
        return id == EE_CREST_ID && level >= 1;
    // Extra scripted copies of the staff, bow and commander weapons.
    if (id == 386 || id == 394 || (id >= 661 && id <= 685))
        return 0;
    const unsigned minimum = ee_minimum(row, id);
    const unsigned entry = ee_override(id);
    if (!type || type > 29 || minimum == 255 || row[0x60] == 255 || level < (int)minimum)
        return 0;
    if (entry & EE_HAS_ALLOWED)
        return (entry & EE_ALLOW) != 0;
    if (ee_movement(type, name) && (ee_options & (EE_GEAR | EE_RARE | EE_ACCESSORIES | EE_MOVEMENT)))
        return (ee_options & EE_MOVEMENT) != 0;
    if (type == 29)
        return (ee_options & EE_ACCESSORIES) != 0;
    if (ee_heavenly_weapon(id))
        return (ee_options & EE_HEAVENLY) != 0;
    if (ee_options & (EE_GEAR | EE_RARE)) {
        // Empty cursed weapons and hidden test rows have separate initialization.
        if (id >= 610 && id <= 660)
            return 0;
        // Same single-copy flag used by the game's inventory check.
        return !row[0x50] || (ee_options & EE_RARE);
    }
    return row[0xe] == 0;
}

static void ee_fill_accessory(uint8_t *unit, const uint8_t *entry, const EeRoll *roll) {
    if ((ee_options & EE_FORCE_CREST) || !(ee_options & (EE_ACCESSORIES | EE_MOVEMENT | EE_OVERRIDES)) ||
        es_word(unit + 0x60) ||
        es_word(entry + 0x62) == 999)
        return;
    typedef int16_t (*UnitLevel)(const uint8_t *);
    typedef uint8_t (*Eligible)(const void *, const uint8_t *, uint16_t);
    const int level = ((UnitLevel)(mm_base + EE_UNIT_LEVEL))(unit);
    const EsTable table = es_table(EE_EQUIPMENT_TABLE, 152);
    const EsTable classes = es_table(EE_CLASS_TABLE, 0x61);
    if (!table.rows || unit[0x49] >= classes.count)
        return;
    const struct {
        const uint8_t *unit;
        const void *pool;
        uint32_t slot, flags;
        const uint8_t *class_row;
    } request = {unit, NULL, 6, 0, classes.rows + unit[0x49] * classes.stride};
    Eligible eligible = (Eligible)(mm_base + EE_ELIGIBLE);
    uint16_t selected = 0;
    unsigned best = 0;
    for (unsigned id = 1; id < table.count && id < EQUIPMENT_CAP; ++id) {
        const uint8_t *row = table.rows + id * table.stride;
        if (row[2] != 29 ||
            !ee_in_pool(row, id, level) ||
            (id >= EQUIPMENT_FIRST && !equipment_has_added_definition((uint16_t)id)))
            continue;
        const unsigned score = ee_minimum(row, id) * EE_SCORE_STRIDE + roll->priority[id];
        if (score > best && eligible(&request, row, (uint16_t)id)) {
            selected = (uint16_t)id;
            best = score;
        }
    }
    if (selected) {
        memcpy(unit + 0x60, &selected, sizeof selected);
        ((void (*)(uint8_t *))(mm_base + EE_REFRESH))(unit);
    }
}

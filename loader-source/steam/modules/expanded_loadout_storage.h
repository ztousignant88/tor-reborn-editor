#ifndef TOR_EXPANDED_LOADOUT_STORAGE_H
#define TOR_EXPANDED_LOADOUT_STORAGE_H

#include <stdint.h>
#include <string.h>

/* The stock unit codec already saves ten six-byte records beginning at +0xc0.
 * The ordinary four spellbook IDs immediately follow at +0xfc. Keep the format
 * and stride: four dormant records hold skills 5–8, and the last two hold four
 * spellbook IDs and a signature. Never claim a nonempty unmarked tail. */
enum {
    LOADOUT_STOCK = 4,
    LOADOUT_SLOTS = 8,
    LOADOUT_SKILL_AT = 0xc0,
    LOADOUT_SKILL_SIZE = 6,
    LOADOUT_FIRST_EXTRA = LOADOUT_SKILL_AT + LOADOUT_STOCK * LOADOUT_SKILL_SIZE,
    LOADOUT_EXTRA_SPELL_AT = LOADOUT_SKILL_AT + LOADOUT_SLOTS * LOADOUT_SKILL_SIZE,
    LOADOUT_SIGNATURE_AT = LOADOUT_EXTRA_SPELL_AT + 2 * LOADOUT_STOCK,
    LOADOUT_SPELL_AT = 0xfc,
    LOADOUT_STOCK_ITEM_AT = 0x104,
};

static const uint8_t loadout_signature[4] = {'T', 'O', '8', 1};

static uint16_t loadout_word(const uint8_t *at) {
    uint16_t value;
    memcpy(&value, at, sizeof(value));
    return value;
}

static int loadout_has_extension(const uint8_t *unit) {
    return memcmp(unit + LOADOUT_SIGNATURE_AT, loadout_signature, sizeof(loadout_signature)) == 0;
}

static int loadout_can_extend(const uint8_t *unit) {
    if (loadout_has_extension(unit)) return 1;
    static const uint8_t blank[LOADOUT_SPELL_AT - LOADOUT_FIRST_EXTRA] = {0};
    return memcmp(unit + LOADOUT_FIRST_EXTRA, blank, sizeof(blank)) == 0;
}

static const uint8_t *loadout_skill_at(const uint8_t *unit, unsigned slot) {
    if (slot >= LOADOUT_SLOTS || (slot >= LOADOUT_STOCK && !loadout_has_extension(unit))) return NULL;
    return unit + LOADOUT_SKILL_AT + slot * LOADOUT_SKILL_SIZE;
}

static uint16_t loadout_spellbook(const uint8_t *unit, unsigned slot) {
    if (slot < LOADOUT_STOCK) return loadout_word(unit + LOADOUT_SPELL_AT + 2 * slot);
    if (slot >= LOADOUT_SLOTS || !loadout_has_extension(unit)) return 0;
    return loadout_word(unit + LOADOUT_EXTRA_SPELL_AT + 2 * (slot - LOADOUT_STOCK));
}

static int loadout_set_skill(uint8_t *unit, unsigned slot, const uint8_t record[LOADOUT_SKILL_SIZE]) {
    if (slot >= LOADOUT_SLOTS || (slot >= LOADOUT_STOCK && !loadout_can_extend(unit))) return 0;
    memmove(unit + LOADOUT_SKILL_AT + slot * LOADOUT_SKILL_SIZE, record, LOADOUT_SKILL_SIZE);
    if (slot >= LOADOUT_STOCK) memcpy(unit + LOADOUT_SIGNATURE_AT, loadout_signature, sizeof(loadout_signature));
    return 1;
}

static int loadout_set_spellbook(uint8_t *unit, unsigned slot, uint16_t book) {
    if (slot >= LOADOUT_SLOTS || (slot >= LOADOUT_STOCK && !loadout_can_extend(unit))) return 0;
    const unsigned offset = slot < LOADOUT_STOCK ? LOADOUT_SPELL_AT + 2 * slot
                                                : LOADOUT_EXTRA_SPELL_AT + 2 * (slot - LOADOUT_STOCK);
    memcpy(unit + offset, &book, sizeof(book));
    if (slot >= LOADOUT_STOCK) memcpy(unit + LOADOUT_SIGNATURE_AT, loadout_signature, sizeof(loadout_signature));
    return 1;
}

#endif

/* See web/js/game/entryunit.js for the battle row format. The stock roster
 * loader only consumes the first four source skill records and clears the tail
 * of the character's ten-record skill buffer. Populate it before auto loadout
 * and stat initialization run. */
static void loadout_entry(uint8_t *skills, const uint8_t *entry, int level) {
    typedef void (*LoadStock)(uint8_t *, const uint8_t *, int);
    ((LoadStock)(mm_base + 0x448cc0))(skills, entry, level);

    static const uint16_t spell_tags[] = {0xd000, 0xe000, 0xf000, 0xc000};
    for (unsigned i = 0; i < LOADOUT_STOCK; ++i)
        if ((loadout_word(entry + 0x42 + i * 2) & 0xf000) != spell_tags[i]) return;

    uint8_t *unit = skills - 0xbe;
    const uint8_t *skill_table;
    uint32_t skill_count = 0;
    memcpy(&skill_table, mm_base + 0xd682f8, sizeof(skill_table));
    if (skill_table) memcpy(&skill_count, skill_table + 4, sizeof(skill_count));
    typedef void (*BookForEffect)(uint16_t *, uint16_t);
    const BookForEffect book_for_effect = (BookForEffect)(mm_base + 0x3363a0);
    for (unsigned i = 0; i < LOADOUT_STOCK; ++i) {
        const uint16_t id = loadout_word(entry + 0x32 + i * 4);
        if (id && id < skill_count) {
            unsigned rank = loadout_word(entry + 0x34 + i * 4);
            if (level > 0 && rank > (unsigned)level) rank = level;
            uint8_t record[LOADOUT_SKILL_SIZE] = {0};
            memcpy(record, &id, sizeof(id));
            record[2] = (uint8_t)rank;
            loadout_set_skill(unit, LOADOUT_STOCK + i, record);
        }
        const uint16_t effect = loadout_word(entry + 0x42 + i * 2) & 0x0fff;
        if (effect) {
            uint16_t book = 0;
            book_for_effect(&book, effect);
            if (book) loadout_set_spellbook(unit, LOADOUT_STOCK + i, book);
        }
    }
}

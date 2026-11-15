/* Fill battle spell slots with the same scroll-backed magic that native
 * automatic loadouts consider, using the live class spell-set thresholds. */
static void esp_fill_spells(uint8_t *unit) {
    enum { SLOT_COUNT = 4, STOCK_SCROLL_ROWS = 732, EXPANDED_SCROLL_ROWS = 1000, SPELL_SCROLL = 0x22 };
    const uint8_t *character = unit + 0x138;
    uint8_t *equipped = unit + 0x138 + 0xfc;
    uint16_t slots[SLOT_COUNT];
    memcpy(slots, equipped, sizeof slots);
    unsigned free_slot = 0;
    while (free_slot < SLOT_COUNT && slots[free_slot])
        ++free_slot;
    const unsigned class_id = character[0x49], level = character[0x4a];
    if (free_slot == SLOT_COUNT || !level)
        return;

    const EsTable classes = es_table(0xd68338, 0x52);
    const EsTable effects = es_table(0xd68348, 0x92);
    const EsTable sets = es_table(0xd68350, 1);
    const EsTable items = es_table(0xd68318, 6);
    if (class_id >= classes.count)
        return;
    const unsigned column = classes.rows[class_id * classes.stride + 0x51];
    if (column >= sets.stride)
        return;

    const unsigned capacity = mfx_spellbook_capacity_active ? EXPANDED_SCROLL_ROWS : STOCK_SCROLL_ROWS;
    const unsigned item_count = items.count < capacity ? items.count : capacity;
    uint8_t seen[4096 / 8] = {0}; /* es_table caps the effect count at 4096. */
    for (unsigned slot = 0; slot < SLOT_COUNT; ++slot) {
        if (slots[slot] < 1000 || slots[slot] >= 1000 + item_count)
            continue;
        const unsigned item = slots[slot] - 1000;
        const unsigned effect = es_word(items.rows + item * items.stride + 4);
        if (effect < effects.count)
            seen[effect / 8] |= 1u << (effect % 8);
    }
    uint16_t candidates[EXPANDED_SCROLL_ROWS];
    unsigned count = 0;
    for (unsigned i = 1; i < item_count; ++i) {
        const uint8_t *item = items.rows + i * items.stride;
        if (item[2] != SPELL_SCROLL)
            continue;
        const unsigned effect_id = es_word(item + 4);
        if (!effect_id || effect_id >= effects.count ||
            (seen[effect_id / 8] & (1u << (effect_id % 8))))
            continue;
        const uint8_t *effect = effects.rows + effect_id * effects.stride;
        const unsigned type = effect[2], group = es_word(effect + 0x90);
        if (type < 1 || type > 13 || group >= sets.count ||
            (effect[0x7c] && effect[0x7c] != class_id))
            continue;
        const unsigned minimum = sets.rows[group * sets.stride + column];
        /* Native class permission rejects both 0 and 255. */
        if (!minimum || minimum == 255 || minimum > level)
            continue;
        seen[effect_id / 8] |= 1u << (effect_id % 8);
        candidates[count++] = (uint16_t)(1000 + i);
    }
    if (!count)
        return;
    LARGE_INTEGER now = {0};
    QueryPerformanceCounter(&now);
    uint32_t seed = (uint32_t)now.QuadPart ^ ((uint32_t)es_word(character + 2) << 16) ^ unit[0x2fc];
    if (!seed)
        seed = 1;
    unsigned added = 0;
    for (unsigned slot = free_slot; slot < SLOT_COUNT && count; ++slot) {
        if (slots[slot])
            continue;
        const unsigned pick = es_choose(&seed, count);
        slots[slot] = candidates[pick];
        candidates[pick] = candidates[--count];
        ++added;
    }
    memcpy(equipped, slots, sizeof slots);

    static volatile LONG logged;
    if (InterlockedIncrement(&logged) <= 120) {
        char line[180];
        snprintf(line, sizeof line,
            "Enemy spells: unit %u class %u level %u, added %u, slots [%u,%u,%u,%u].\r\n",
            unit[0x2fc], class_id, level, added, slots[0], slots[1], slots[2], slots[3]);
        mm_log(line);
    }
}

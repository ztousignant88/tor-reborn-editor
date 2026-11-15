/* Build the pool from live consumables and their battle effects. An item can
 * qualify for both recovery categories. Orb effects stay in the orb pool. */
enum {
    EI_HP = 1, EI_MP = 2, EI_BUFF = 4, EI_DEBUFF = 8, EI_ORB = 16, EI_CURE = 32,
    EI_ALL = EI_HP | EI_MP | EI_BUFF | EI_DEBUFF | EI_ORB | EI_CURE,
    EI_STOCK_ITEMS = 732, EI_EXPANDED_ITEMS = 1000, EI_SLOT_COUNT = 4
};

static unsigned ei_category(const uint8_t *item, const EsTable *effects, const EsTable *statuses) {
    if (item[2] != 32 || item[12] || item[13]) /* consumable, nonunique, nonkey */
        return 0;
    const unsigned effect_id = es_word(item + 4);
    if (!effect_id || effect_id >= effects->count)
        return 0;
    const uint8_t *effect = effects->rows + effect_id * effects->stride;
    if (effect[2] == 18 && effect[0x2a] == 1)
        return item[17] ? 0 : EI_ORB;
    if (effect[2] != 16)
        return 0;

    unsigned result = 0;
    const unsigned operations[] = {0x2a, 0x44, 0x5e};
    for (unsigned i = 0; i < sizeof operations / sizeof operations[0]; ++i) {
        const uint8_t *process = effect + operations[i];
        const unsigned status_id = es_word(process + 2);
        switch (process[0]) {
        case 2:  result |= EI_HP; break;
        case 5:  result |= EI_MP; break;
        case 23: result |= EI_DEBUFF; break; /* dispel */
        case 24:
        case 25: result |= EI_CURE; break;   /* ease / ease all */
        case 18: /* apply status */
        case 19: { /* remove status */
            if (!status_id || status_id >= statuses->count)
                break;
            const uint8_t *status = statuses->rows + status_id * statuses->stride;
            if (status[10])
                result |= process[0] == 18 ? EI_BUFF : EI_DEBUFF;
            else if (status[11] || status_id == 34) /* Pain Aura lacks the ordinary flags */
                result |= process[0] == 18 ? EI_DEBUFF : EI_CURE;
            break;
        }
        }
    }
    /* The stock throwable debuff items carry the AI-use flag too. Include
     * them when explicitly selected, while excluding internal cards and
     * other hidden consumables with that flag. The engine controls use. */
    return item[17] ? (item[15] ? result & EI_DEBUFF : 0) : result;
}

static void ei_fill_items(uint8_t *unit, unsigned mask) {
    /* The native initializer copies entry-unit items here as four IDs, then
     * four drop rates and four per-slot runtime bytes. */
    uint8_t *items = unit + 0x138 + 0x104;
    unsigned slot = 0;
    while (slot < EI_SLOT_COUNT && es_word(items + slot * 2))
        ++slot;
    if (slot == EI_SLOT_COUNT)
        return;

    const EsTable commodities = es_table(0xd68318, 18);
    const EsTable effects = es_table(0xd68348, 0x62);
    const EsTable statuses = es_table(0xd68368, 12);
    const unsigned capacity = mfx_spellbook_capacity_active ? EI_EXPANDED_ITEMS : EI_STOCK_ITEMS;
    const unsigned limit = commodities.count < capacity ? commodities.count : capacity;
    uint16_t pool[EI_EXPANDED_ITEMS];
    unsigned count = 0;
    for (unsigned i = 1; i < limit; ++i) {
        const uint8_t *item = commodities.rows + i * commodities.stride;
        if (ei_category(item, &effects, &statuses) & mask)
            pool[count++] = (uint16_t)(1000 + i);
    }
    if (!count)
        return;

    LARGE_INTEGER now = {0};
    QueryPerformanceCounter(&now);
    uint32_t seed = (uint32_t)now.QuadPart ^ ((uint32_t)es_word(unit + 0x13a) << 16) ^ unit[0x2fc];
    if (!seed)
        seed = 1;
    typedef void (*SetItem)(uint8_t *, unsigned, uint16_t, unsigned);
    const SetItem set_item = (SetItem)(mm_base + 0x3bc7e0);
    unsigned added = 0;
    for (; slot < EI_SLOT_COUNT; ++slot) {
        if (es_word(items + slot * 2))
            continue;
        /* Each draw uses the full pool. A repeated item occupies its own slot. */
        set_item(items, slot, pool[es_choose(&seed, count)], 0);
        ++added;
    }
    static volatile LONG logged;
    if (InterlockedIncrement(&logged) <= 120) {
        char line[160];
        snprintf(line, sizeof line, "Enemy items: unit %u, added %u, slots [%u,%u,%u,%u].\r\n",
                 unit[0x2fc], added, es_word(items), es_word(items+2), es_word(items+4), es_word(items+6));
        mm_log(line);
    }
}

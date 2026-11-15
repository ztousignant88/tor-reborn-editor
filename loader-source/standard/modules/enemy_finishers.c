/* Append eligible finishers to the deployed enemy's native eight slots. */
static void ef_add_finishers(uint8_t *character) {
    enum { FINISHER_SLOTS = 8 };
    uint16_t slots[FINISHER_SLOTS];
    memcpy(slots, character + 0x34, sizeof slots);
    unsigned free_slot = 0;
    while (free_slot < FINISHER_SLOTS && slots[free_slot])
        ++free_slot;
    if (free_slot == FINISHER_SLOTS)
        return;

    uint16_t generated[FINISHER_SLOTS] = {0};
    typedef void (*GenerateFinishers)(uint16_t *, const uint8_t *);
    ((GenerateFinishers)(mm_base + 0x445e50))(generated, character);
    unsigned added = 0;
    for (unsigned i = 0; i < FINISHER_SLOTS && free_slot < FINISHER_SLOTS; ++i) {
        const uint16_t id = generated[i];
        if (!id)
            continue;
        unsigned j = 0;
        while (j < FINISHER_SLOTS && slots[j] != id)
            ++j;
        if (j != FINISHER_SLOTS)
            continue;
        slots[free_slot++] = id;
        ++added;
        while (free_slot < FINISHER_SLOTS && slots[free_slot])
            ++free_slot;
    }
    if (!added)
        return;
    memcpy(character + 0x34, slots, sizeof slots);

    static volatile LONG logged;
    if (InterlockedIncrement(&logged) <= 120) {
        char line[180];
        snprintf(line, sizeof line,
            "Enemy finishers: class %u, added %u, slots [%u,%u,%u,%u,%u,%u,%u,%u].\r\n",
            character[0x49], added, slots[0], slots[1], slots[2],
            slots[3], slots[4], slots[5], slots[6], slots[7]);
        mm_log(line);
    }
}

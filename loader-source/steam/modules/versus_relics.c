/* Relic IDs in a save refer to that army's own inventory. Reserve unused
 * battle IDs and resolve them to separate rows. The host's banks stay intact. */
enum { VS_RELIC_FIRST = 3000, VS_RELIC_SLOTS = 1000, VS_RESOLVED_GEAR = 152,
       VS_RELIC_OWNERSHIP = 0xdd0 };
static uint8_t vs_relic_rows[VS_MAX_FIGHTERS * VS_GEAR_SLOTS][VS_RESOLVED_GEAR];
static uint16_t vs_relic_slots[VS_RELIC_SLOTS];
static uint16_t vs_spectator_gear[VS_GEAR_SLOTS];
static const uint8_t *vs_relic_table;

static void vs_reset_relics(void) {
    vs_relic_table = NULL;
    memset(vs_relic_slots, 0, sizeof vs_relic_slots);
}

static const uint8_t *vs_relic_get(const uint8_t *table, uint16_t id) {
    const unsigned slot = id % VS_RELIC_SLOTS;
    const unsigned row = vs_relic_slots[slot];
    if (row && table == vs_relic_table && vs_is_training()) return vs_relic_rows[row - 1];
    return table + slot * VS_RESOLVED_GEAR;
}

static int vs_relic_slot_free(const uint8_t *owned, unsigned slot) {
    if (owned[slot >> 3] & (1u << (slot & 7))) return 0;
    for (unsigned i = 0; i < VS_GEAR_SLOTS; ++i)
        if (vs_spectator_gear[i] == slot + VS_RELIC_FIRST) return 0;
    return 1;
}

static unsigned vs_bind_relics(uint8_t *roster, const uint8_t *records, unsigned count,
                               const uint8_t *owned, const uint8_t *table) {
    void (*resolve)(const uint8_t *, uint8_t *) = (void *)(mm_base + 0x386100);
    int slot = VS_RELIC_SLOTS - 1;
    unsigned bound = 0;
    vs_reset_relics();
    while (bound < count) {
        while (slot >= 0 && !vs_relic_slot_free(owned, (unsigned)slot)) --slot;
        if (slot < 0) break;
        const uint16_t id = (uint16_t)(VS_RELIC_FIRST + slot);
        const unsigned offset = vs_u16(records) * VS_ROSTER_ROW + 0x4a + vs_u16(records + 2) * 4;
        resolve(records + 4, vs_relic_rows[bound]);
        memcpy(roster + offset, &id, sizeof id);
        vs_relic_slots[slot] = (uint16_t)(++bound);
        records += VS_RELIC_ENTRY;
        --slot;
    }
    vs_relic_table = table;
    return bound;
}

static void vs_spawn_fighters(uint8_t *scene, uint8_t *battle, void *party,
                              unsigned side, unsigned limit, void *options) {
    const unsigned fighters = 2 * vs_team_size;
    const unsigned plain_length = VS_HEADER + fighters * VS_BASE_ENTRY;
    const unsigned relic_end = vs_roster_loaded ? vs_relic_end(vs_match, vs_match_bytes, fighters) : 0;
    if (side == 1 && vs_is_training() && relic_end > plain_length) {
        uint8_t *roster, *manager;
        memcpy(&roster, scene + 0x1da68, sizeof roster);
        memcpy(&manager, battle + 0x1b68, sizeof manager);
        const uint8_t *items = ((const uint8_t *(*)(void))(mm_base + 0x2e6f20))();
        const unsigned count = (relic_end - plain_length) / VS_RELIC_ENTRY;
        const uint8_t *owned = manager ? manager + 0x64 + VS_RELIC_OWNERSHIP : NULL;
        unsigned bound = 0;
        if (items && vs_spectator && mm_readable(roster, 2 * vs_team_size * VS_ROSTER_ROW) &&
            mm_readable(owned, VS_RELIC_SLOTS / 8))
            bound = vs_bind_relics(roster, vs_match + plain_length, count, owned, items + 0x4fb8);
        if (bound != count) vs_log_state("some relics used base stats");
    }
    ((void (*)(uint8_t *, uint8_t *, void *, unsigned, unsigned, void *))(mm_base + 0x2f0ca0))
        (scene, battle, party, side, limit, options);
}

static int vs_install_relic_lookup(void) {
    static const uint8_t expected[] = {0x44,0x0f,0xb7,0xc2,0xb8,0xd3,0x4d,
                                       0x62,0x10,0x41,0xf7,0xe0,0xc1,0xea};
    /* The entry is replaced in full, so the overwritten prefix never resumes. */
    uint8_t *site = mm_base + 0x386cf0;
    if (memcmp(site, expected, sizeof expected)) return 0;
    uint8_t patch[sizeof expected];
    mm_abs_jump(patch, (void *)vs_relic_get);
    if (mm_write(site, patch, sizeof patch)) return 1;
    mm_write(site, expected, sizeof expected);
    return 0;
}

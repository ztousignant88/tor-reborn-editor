/* Included in the Menu Mods runtime after its patch helpers. */
typedef struct {
    uint16_t entries[5];
    uint8_t first, end;
} EnemyCardRing;

typedef struct {
    const uint8_t *ids;
    uint32_t count;
} EnemyCardSpan;

typedef struct {
    uint8_t ids[4];
    unsigned count;
} StartingCardLoadout;

static StartingCardLoadout starting_cards[3];

static const StartingCardLoadout *starting_card_loadout(const EnemyCardRing *ring) {
    /* The ring lives at battle unit +0x252. Team is at +0x188. */
    const uint8_t *team = (const uint8_t *)((uintptr_t)ring - 0xca);
    if (!ring || !mm_readable(team, 1) || (*team != 1 && *team != 2))
        return NULL;
    return starting_cards[*team].count ? &starting_cards[*team] : NULL;
}

static void starting_card_seed(EnemyCardRing *ring, const StartingCardLoadout *loadout) {
    ring->first = 0;
    ring->end = (uint8_t)loadout->count;
    for (unsigned i = 0; i < loadout->count; ++i)
        ring->entries[i] = (uint16_t)(loadout->ids[i] - 1);
}

static void *starting_card_spawn(void *units, const void *unit_data, unsigned a,
                                 unsigned b, unsigned c, uint8_t d) {
    uint8_t *unit = ((void *(*)(void *, const void *, unsigned, unsigned, unsigned, uint8_t))
        (mm_base + 0x3720b0))(units, unit_data, a, b, c, d);
    if (unit && unit[0x188] == 1 && starting_cards[1].count)
        starting_card_seed((EnemyCardRing *)(unit + 0x252), &starting_cards[1]);
    starting_status_seed(unit);
    return unit;
}

static void enemy_card_init(EnemyCardRing *ring, const EnemyCardSpan *original) {
    const StartingCardLoadout *loadout = starting_card_loadout(ring);
    if (loadout)
        starting_card_seed(ring, loadout);
    else
        ((void (*)(EnemyCardRing *, const EnemyCardSpan *))(mm_base + 0x391170))(ring, original);
    if (ring)
        starting_status_seed((uint8_t *)ring - 0x252);
}

static void enemy_card_append(EnemyCardRing *ring, uint16_t id) {
    const StartingCardLoadout *loadout = starting_card_loadout(ring);
    if (!loadout) {
        ((void (*)(EnemyCardRing *, uint16_t))(mm_base + 0x391040))(ring, id);
        return;
    }
    /* Reset clears ordinary pickups. The starting slots are restored. */
    if (id == 13) {
        starting_card_seed(ring, loadout);
        return;
    }
    const unsigned capacity = 4 - loadout->count;
    if (!capacity)
        return;
    uint16_t extras[4];
    unsigned used = 0;
    if (ring->first == 0 && ring->end <= 4) {
        unsigned first_extra = loadout->count;
        if (ring->end == 4)
            ++first_extra;
        for (unsigned i = first_extra; i < ring->end; ++i)
            extras[used++] = ring->entries[i];
    }
    starting_card_seed(ring, loadout);
    for (unsigned i = 0; i < used; ++i)
        ring->entries[ring->end++] = extras[i];
    ring->entries[ring->end++] = id;
}

static void enemy_card_reset(EnemyCardRing *ring) {
    const StartingCardLoadout *loadout = starting_card_loadout(ring);
    if (loadout)
        starting_card_seed(ring, loadout);
    else
        ((void (*)(EnemyCardRing *))(mm_base + 0x390d90))(ring);
}

static int read_starting_cards(const wchar_t *config, const wchar_t *section,
                               StartingCardLoadout *loadout) {
    static const wchar_t *const slots[] = {L"Card1", L"Card2", L"Card3", L"Card4"};
    for (unsigned i = 0; i < 4; ++i) {
        unsigned id = GetPrivateProfileIntW(section, slots[i], 0, config);
        switch (id) {
        case 0: break;
        case 1: case 2: case 3: case 13: case 15:
            loadout->ids[loadout->count++] = (uint8_t)id;
            break;
        default:
            return 0;
        }
    }
    return 1;
}

static void mm_install_enemy_starting_cards(const wchar_t *config) {
    if (!read_starting_cards(config, L"PlayerStartingCards", &starting_cards[1]) ||
        !read_starting_cards(config, L"EnemyStartingCards", &starting_cards[2])) {
        mm_log("Starting cards: invalid card setting.\r\n");
        return;
    }
    const int cards_enabled = starting_cards[1].count || starting_cards[2].count;
    if (!cards_enabled &&
        !starting_status[1].count && !starting_status[2].count)
        return;

    const struct {
        unsigned address;
        unsigned char original[5];
        void *hook;
    } sites[] = {
        {0x2ee249, {0xe8,0x62,0x3e,0x08,0x00}, (void *)starting_card_spawn},
        {0x2eecbf, {0xe8,0xec,0x33,0x08,0x00}, (void *)starting_card_spawn},
        {0x2ef072, {0xe8,0xf9,0x20,0x0a,0x00}, (void *)enemy_card_init},
        {0x331c47, {0xe8,0xf4,0xf3,0x05,0x00}, (void *)enemy_card_append},
        {0x44b5bb, {0xe8,0x80,0x5a,0xf4,0xff}, (void *)enemy_card_append},
        {0x369487, {0xe8,0x04,0x79,0x02,0x00}, (void *)enemy_card_reset},
        {0x3ad22b, {0xe9,0x60,0x3b,0xfe,0xff}, (void *)enemy_card_reset},
    };
    /* Status-only loadouts use setup hooks. Card pickup and reset stay native. */
    const unsigned count = cards_enabled ? sizeof sites / sizeof sites[0] : 3;
    for (unsigned i = 0; i < count; ++i) {
        if (memcmp(mm_base + sites[i].address, sites[i].original, 5)) {
            mm_log("Starting cards: disabled because native code differs.\r\n");
            return;
        }
    }
    unsigned char *relay = mm_near_page();
    if (!relay)
        return;
    for (unsigned i = 0; i < count; ++i)
        mm_abs_jump(relay + 16 * i, sites[i].hook);
    FlushInstructionCache(GetCurrentProcess(), relay, 16 * count);
    for (unsigned i = 0; i < count; ++i) {
        unsigned char *site = mm_base + sites[i].address;
        unsigned char patch[5] = {sites[i].original[0]};
        int32_t offset = (int32_t)((intptr_t)(relay + 16 * i) - (intptr_t)(site + 5));
        memcpy(patch + 1, &offset, sizeof offset);
        if (!mm_write(site, patch, sizeof patch)) {
            for (unsigned j = 0; j <= i; ++j)
                mm_write(mm_base + sites[j].address, sites[j].original, 5);
            mm_log("Starting cards: hook installation failed.\r\n");
            return;
        }
    }
    if (cards_enabled) mm_log("Starting cards: enabled and protected from replacement.\r\n");
    else mm_log("Starting status: battle setup hooks enabled.\r\n");
}

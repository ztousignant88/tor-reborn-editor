/* Set base ranks in the enemy's equipped skill records. Native consumers
 * continue to apply their ordinary weapon, class and equipment rules. */
enum EpRankMode { EP_RANK_OFF, EP_RANK_FIXED, EP_RANK_LEVEL };
enum { EP_RANK_CAP = 40 };
static enum EpRankMode ep_rank_mode;
static int ep_finishers_enabled;
static int ep_skills_enabled;
static int ep_spells_enabled;
static unsigned ep_item_pool;

static void ep_set_ranks(uint8_t *character) {
    if (character[0x50] != 2 || ep_rank_mode == EP_RANK_OFF)
        return;
    const uint8_t level = character[0x4a]; /* Effective battle level. */
    if (ep_rank_mode == EP_RANK_LEVEL && !level)
        return;
    const uint8_t rank = ep_rank_mode == EP_RANK_LEVEL && level < EP_RANK_CAP ? level : EP_RANK_CAP;

    const uint8_t *skill_table;
    memcpy(&skill_table, mm_base + 0xd78e38, sizeof skill_table);
    if (!mm_readable(skill_table, 16) || memcmp(skill_table, "xlce", 4))
        return;

    uint32_t count, header_size, row_size;
    memcpy(&count, skill_table + 4, 4);
    memcpy(&header_size, skill_table + 8, 4);
    memcpy(&row_size, skill_table + 12, 4);
    if (header_size < 16 || row_size < 8)
        return;

    unsigned changed = 0;
    for (unsigned slot = 0; slot < 4; ++slot) {
        uint8_t *skill = character + 0xc0 + slot * 6;
        uint16_t id;
        memcpy(&id, skill, sizeof id);
        if (!id || id >= count)
            continue;
        const uint8_t *row = skill_table + header_size + (size_t)id * row_size;
        if (!mm_readable(row, 8))
            continue;
        /* The skill's rank type identifies its weapon family. This also
         * recognizes proficiency variants that share that rank type. */
        const unsigned weapon_family = row[7];
        if (weapon_family < 1 || weapon_family > 21 || skill[2] == rank)
            continue;
        skill[2] = rank;
        skill[4] = skill[5] = 0;
        ++changed;
    }
    static volatile LONG logged;
    if (changed && InterlockedIncrement(&logged) <= 120) {
        char line[120];
        snprintf(line, sizeof line,
            "Enemy proficiency: class %u, level %u, set %u equipped weapon ranks to %u.\r\n",
            character[0x49], level, changed, rank);
        mm_log(line);
    }
}

static uint16_t ep_before_finishers(uint8_t *character) {
    ep_set_ranks(character);
    return ((uint16_t (*)(uint8_t *))(mm_base + 0x32ece0))(character);
}

/* Deployment already computed these stats from the original slots. The
 * same native refresh handles passives granted by the new loadout. */
static void ep_refresh_skill_stats(uint8_t *character) {
    const unsigned hp = el_u16(character + 0x10);
    const int full_hp = hp && hp == el_u16(character + 0x12e);
    ((void (*)(void *))(mm_base + 0x32d7f0))(character);
    if (full_hp)
        el_put16(character + 0x10, el_u16(character + 0x12e));
}

static void ep_apply_loadout(uint8_t *unit, int fill_slots) {
    uint8_t *character = unit + 0x138;
    const unsigned skills_added = ep_skills_enabled && fill_slots ? es_fill_skills(unit) : 0;
    if (skills_added)
        ep_refresh_skill_stats(character);
    if (ep_spells_enabled && fill_slots)
        esp_fill_spells(unit);
    ep_set_ranks(character);
    // In level mode, use the final rank before adding optional finishers.
    if (ep_finishers_enabled && (fill_slots || ep_rank_mode != EP_RANK_LEVEL))
        ef_add_finishers(character);
}

static uint8_t *ep_spawn(void *units, const uint8_t *character, uint32_t position,
                         uint32_t flags, int index, uint32_t mode, uint8_t id) {
    typedef uint8_t *(*Spawn)(void *, const uint8_t *, uint32_t, uint32_t,
                              int, uint32_t, uint8_t);
    uint8_t *unit = ((Spawn)(mm_base + 0x373db0))(units, character, position,
                                               flags, index, mode, id);
    if (unit && unit[0x188] == 2) {
        if (ep_item_pool)
            ei_fill_items(unit, ep_item_pool);
        if (el_enabled && el_locked && (ep_skills_enabled || ep_spells_enabled || ep_rank_mode == EP_RANK_LEVEL))
            el_adjust(unit, el_target);
        ep_apply_loadout(unit, !el_enabled || el_locked);
    }
    return unit;
}

static void mm_install_enemy_loadouts(const wchar_t *config) {
    enum EpRankMode rank_mode = EP_RANK_OFF;
    if (GetPrivateProfileIntW(L"EnemyProficiency", L"ScaleToLevel", 0, config))
        rank_mode = EP_RANK_LEVEL;
    else if (GetPrivateProfileIntW(L"EnemyProficiency", L"Enabled", 0, config))
        rank_mode = EP_RANK_FIXED;
    const int finishers_enabled = GetPrivateProfileIntW(L"EnemyFinishers", L"Enabled", 0, config) != 0;
    const int skills_enabled = GetPrivateProfileIntW(L"EnemySkills", L"Enabled", 0, config) != 0;
    const int spells_enabled = GetPrivateProfileIntW(L"EnemySpells", L"Enabled", 0, config) != 0;
    unsigned item_pool = GetPrivateProfileIntW(L"EnemyItems", L"Pool", 0, config);
    static const uint8_t item_setter[] = {0x48,0x63,0xc2,0x66,0x44,0x89,0x04,0x41,0x44,0x88,0x4c,0x08,0x08,0xc6,0x44,0x08,0x0c,0x00,0xc3};
    if (item_pool && (item_pool > EI_ALL || memcmp(mm_base + 0x3b9770, item_setter, sizeof item_setter))) {
        mm_log("Enemy items: invalid pool or native item setter differs.\r\n");
        item_pool = 0;
    }
    if (rank_mode == EP_RANK_OFF && !finishers_enabled && !skills_enabled && !spells_enabled && !item_pool)
        return;
    static const uint8_t scan_entry[] = {0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x6c,0x24,0x10};
    if (skills_enabled && memcmp(mm_base + 0x43bf90, scan_entry, sizeof scan_entry)) {
        mm_log("Enemy skills: native skill-learning scan differs.\r\n");
        return;
    }
    static const uint8_t refresh_entry[] = {0x48,0x89,0x5c,0x24,0x10,0x48,0x89,0x6c};
    if (skills_enabled && memcmp(mm_base + 0x32d7f0, refresh_entry, sizeof refresh_entry)) {
        mm_log("Enemy skills: native stat refresh differs.\r\n");
        return;
    }
    const struct {
        unsigned address;
        uint8_t original[5];
        void *callback;
    } sites[] = {
        {0x332f2c, {0xe8,0xaf,0xbd,0xff,0xff}, (void *)ep_before_finishers},
        {0x37213a, {0xe8,0x71,0x1c,0x00,0x00}, (void *)ep_spawn},
    };
    const unsigned first = rank_mode == EP_RANK_OFF ? 1 : 0;
    const unsigned count = sizeof sites / sizeof sites[0];
    for (unsigned i = first; i < count; ++i) {
        if (memcmp(mm_base + sites[i].address, sites[i].original, 5)) {
            mm_log("Enemy proficiency: native character or deployment call differs.\r\n");
            return;
        }
    }
    uint8_t *relay = mm_near_page();
    if (!relay) {
        mm_log("Enemy proficiency: relay allocation failed.\r\n");
        return;
    }
    for (unsigned i = first; i < count; ++i)
        mm_abs_jump(relay + i * 16, sites[i].callback);
    FlushInstructionCache(GetCurrentProcess(), relay, count * 16);
    for (unsigned i = first; i < count; ++i) {
        uint8_t *site = mm_base + sites[i].address;
        uint8_t patch[5] = {0xe8};
        int32_t displacement = (int32_t)((intptr_t)(relay + i * 16) - (intptr_t)(site + 5));
        memcpy(patch + 1, &displacement, sizeof displacement);
        if (!mm_write(site, patch, sizeof patch)) {
            for (unsigned j = first; j <= i; ++j)
                mm_write(mm_base + sites[j].address, sites[j].original, 5);
            mm_log("Enemy proficiency: installation failed.\r\n");
            return;
        }
    }
    ep_rank_mode = rank_mode;
    ep_finishers_enabled = finishers_enabled;
    ep_skills_enabled = skills_enabled;
    ep_spells_enabled = spells_enabled;
    ep_item_pool = item_pool;
    if (item_pool)
        mm_log("Enemy items: filling vacant enemy slots from the configured pool.\r\n");
    if (skills_enabled || spells_enabled || (finishers_enabled && rank_mode == EP_RANK_LEVEL))
        el_finish_loadout = ep_apply_loadout;
    if (rank_mode == EP_RANK_LEVEL)
        el_refresh_ranks = ep_set_ranks;
    if (skills_enabled)
        mm_log("Enemy skills: filling vacant enemy slots from class and level.\r\n");
    if (spells_enabled)
        mm_log("Enemy spells: filling vacant enemy slots from class spell-set thresholds.\r\n");
    if (rank_mode == EP_RANK_FIXED)
        mm_log("Enemy proficiency: rank 40 enabled for equipped enemy weapon skills.\r\n");
    if (rank_mode == EP_RANK_LEVEL)
        mm_log("Enemy proficiency: equipped enemy weapon ranks follow battle level, up to 40.\r\n");
    if (finishers_enabled)
        mm_log("Enemy finishers: automatic assignment enabled for deployed enemies.\r\n");
}

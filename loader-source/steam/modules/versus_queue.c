/* The companion publishes a complete packet. Read once, at Training selection. */
enum { VS_HEADER = 36, VS_ROSTER_ROW = 196, VS_PRELOAD_ROW = 8, VS_MAX_FIGHTERS = 60,
       VS_GEAR_SLOTS = 7, VS_RELIC_RAW = 94, VS_RELIC_ENTRY = 4 + VS_RELIC_RAW,
       VS_BASE_ENTRY = VS_ROSTER_ROW + VS_PRELOAD_ROW, VS_NAME_ROW = 56, VS_STAT_ROW = 22,
       VS_PLAYER_UNION = 0, VS_BAKRAM_UNION = 3, VS_BONUS_OFFSET = 0x30, VS_BONUS_BYTES = 10 };
static wchar_t vs_queue_path[32768];
static wchar_t vs_launch_path[32768];
static uint8_t vs_match[VS_HEADER + VS_MAX_FIGHTERS * (VS_BASE_ENTRY + VS_GEAR_SLOTS * VS_RELIC_ENTRY + VS_NAME_ROW + VS_STAT_ROW)];
static uint8_t vs_pending_match[sizeof vs_match];
static unsigned vs_match_bytes;
static unsigned vs_auto_packet_length;
enum { VS_DEPLOY_MANUAL = 0, VS_DEPLOY_REUSE = 1, VS_DEPLOY_OPENING = 2 };
static int vs_auto_deploy;
static uint8_t *vs_deployment_dialog;
static char vs_match_id[33];
static unsigned vs_default_size, vs_default_position, vs_default_map;
static uint8_t vs_default_teams[4];
static uint8_t vs_default_bonus[VS_BONUS_BYTES];
static int vs_default_captured;
static int vs_roster_loaded;
static void vs_reset_relics(void);
static void vs_cover_opening_round(void);

/* The native preload manager has two 50-entry lists. On 30 vs 30, use a
 * native-layout bank per fighter so all of its texture records fit. */
enum { VS_NATIVE_PRELOAD_BANK_SIZE = 0x198 };
static uint32_t vs_fighter_preloads[VS_MAX_FIGHTERS][VS_NATIVE_PRELOAD_BANK_SIZE / sizeof(uint32_t)];
static void *vs_preload_owner;
static unsigned vs_preload_count;

static void vs_release_fighter_preloads(void) {
    void (*clear)(void *) = (void *)(mm_base + 0x2f02b0);
    for (unsigned i = 0; i < vs_preload_count; ++i)
        clear(vs_fighter_preloads[i]);
    vs_preload_count = 0;
    vs_preload_owner = NULL;
}

static void vs_clear_scene_preloads(void *preloads) {
    if (preloads == vs_preload_owner) vs_release_fighter_preloads();
    ((void (*)(void *))(mm_base + 0x2f02b0))(preloads);
}

static unsigned vs_u16(const uint8_t *p) {
    uint16_t v;
    memcpy(&v, p, sizeof v);
    return v;
}

static unsigned vs_u32(const uint8_t *p) {
    uint32_t v;
    memcpy(&v, p, sizeof v);
    return v;
}

static uint32_t vs_crc32(const uint8_t *data, unsigned length) {
    uint32_t crc = UINT32_MAX;
    for (unsigned i = 0; i < length; ++i) {
        crc ^= data[i];
        for (unsigned bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

static unsigned vs_relic_end(const uint8_t *data, unsigned length, unsigned fighters) {
    if (data[5] == '4') length -= fighters * VS_STAT_ROW;
    if (data[5] >= '3') length -= fighters * VS_NAME_ROW;
    return length;
}

static int vs_fighter_index(const uint8_t *character) {
    if (!vs_roster_loaded || !vs_is_training() || character[8] != 2)
        return -1;
    const unsigned index = character[9];
    if (index >= 2 * vs_team_size)
        return -1;
    const uint8_t *row = vs_match + VS_HEADER + index * VS_ROSTER_ROW;
    return vs_u16(character) == vs_u16(row + 2) ? (int)index : -1;
}

static int vs_packet_valid(const uint8_t *data, unsigned length, unsigned capacity) {
    static const uint16_t arenas[] = {264, 67, 81, 79, 69, 12, 17, 20, 24, 82};
    if (length < VS_HEADER || length > sizeof vs_match) return 0;
    const int basic = !memcmp(data, "TORVS1\0\0", 8);
    const int relics = !memcmp(data, "TORVS2\0\0", 8);
    const int stats = !memcmp(data, "TORVS4\0\0", 8);
    const int named = stats || !memcmp(data, "TORVS3\0\0", 8);
    if (!basic && !relics && !named) return 0;
    const unsigned map = vs_u16(data + 24);
    const unsigned size = vs_u16(data + 26);
    const unsigned x = vs_u16(data + 28), y = vs_u16(data + 30);
    const unsigned total = size * 2;
    const unsigned plain_length = VS_HEADER + total * VS_BASE_ENTRY;
    unsigned found = 0;
    for (unsigned i = 0; i < sizeof arenas / sizeof arenas[0]; ++i) found |= map == arenas[i];
    if (!found || !vs_team_size_supported(size) || x > 127 || y > 127 || total + 1 > capacity ||
        length < plain_length + total * (named * VS_NAME_ROW + stats * VS_STAT_ROW) ||
        vs_u32(data + 32) != vs_crc32(data + VS_HEADER, length - VS_HEADER)) return 0;
    const unsigned relic_end = vs_relic_end(data, length, total);
    const unsigned relic_bytes = relic_end - plain_length;
    if ((basic && relic_bytes) || (relics && !relic_bytes) || relic_bytes % VS_RELIC_ENTRY ||
        relic_bytes / VS_RELIC_ENTRY > total * VS_GEAR_SLOTS) return 0;
    const uint8_t *rows = data + VS_HEADER;
    const uint8_t *sprites = rows + total * VS_ROSTER_ROW;
    for (unsigned i = 0; i < total; ++i) {
        const uint8_t *row = rows + i * VS_ROSTER_ROW;
        const uint8_t *art = sprites + i * VS_PRELOAD_ROW;
        if (row[4] != 160 + i || row[0x0d] != 1 || row[0x10] != (i < size ? 1 : 2) ||
            row[0x11] != (i < size) || !row[0x94] || row[10] > 127 || row[11] > 127 ||
            (row[10] == x && row[11] == y) || !vs_u32(art) || vs_u32(art) > 65535 ||
            !vs_u32(art + 4) || vs_u32(art + 4) > 65535) return 0;
        for (unsigned j = 0; j < i; ++j)
            if (!memcmp(rows + j * VS_ROSTER_ROW + 10, row + 10, 2)) return 0;
    }
    uint8_t used[VS_MAX_FIGHTERS] = {0};
    for (unsigned i = plain_length; i < relic_end; i += VS_RELIC_ENTRY) {
        const unsigned index = vs_u16(data + i), slot = vs_u16(data + i + 2);
        const unsigned base = vs_u16(data + i + 4);
        if (index >= total || slot >= VS_GEAR_SLOTS || (used[index] & (1u << slot)) ||
            !base || base >= 999 || base != vs_u16(rows + index * VS_ROSTER_ROW + 0x4a + slot * 4)) return 0;
        used[index] |= (uint8_t)(1u << slot);
    }
    const unsigned names_end = length - (stats ? total * VS_STAT_ROW : 0);
    for (unsigned i = relic_end; i < names_end; i += VS_NAME_ROW)
        if (data[i + VS_NAME_ROW - 1]) return 0;
    return 1;
}

static unsigned vs_read_queue(uint8_t *packet) {
    HANDLE file = CreateFileW(vs_queue_path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    LARGE_INTEGER size = {0};
    DWORD read = 0;
    const int usable = GetFileSizeEx(file, &size) && size.QuadPart > 0 &&
        size.QuadPart <= (LONGLONG)sizeof vs_match &&
        ReadFile(file, packet, (DWORD)size.QuadPart, &read, NULL) &&
        read == (DWORD)size.QuadPart && vs_packet_valid(packet, read, battle_capacity_unit_count());
    CloseHandle(file);
    if (!usable && size.QuadPart > 0) mm_log("Versus: queued match packet rejected.\r\n");
    return usable ? read : 0;
}

static uint8_t *vs_training_row(uint8_t *world) {
    if (!mm_readable(world, 0x18)) return NULL;
    uint8_t *pgrs;
    memcpy(&pgrs, world + 0x10, sizeof pgrs);
    if (!mm_readable(pgrs, 8) || memcmp(pgrs, "PGRS", 4)) return NULL;
    const unsigned size = vs_u16(pgrs + 6);
    if (size > 64 || !mm_readable(pgrs, 8 + size * 44)) return NULL;
    for (unsigned i = 0; i < size; ++i) {
        uint8_t *row = pgrs + 8 + i * 44;
        if (vs_u16(row) == 1250 && vs_u16(row + 6) == 8 && vs_u16(row + 16) == VS_STAGE) return row;
    }
    return NULL;
}

static uint8_t *vs_stage_row(void) {
    uint8_t *table;
    memcpy(&table, mm_base + 0xd682e8, sizeof table);
    if (!mm_readable(table, 16) || memcmp(table, "xlce", 4) ||
        vs_u32(table + 4) <= VS_STAGE || vs_u32(table + 8) != 16 || vs_u32(table + 12) != 230)
        return NULL;
    uint8_t *row = table + 16 + 230 * VS_STAGE;
    return mm_readable(row, 230) && row[0x22] == 1 &&
           vs_u16(row + 0x28) == 249 ? row : NULL;
}

static void vs_team_art(const uint8_t *row, unsigned union_id, uint16_t *actor, uint16_t *sprite) {
    const uint16_t template = (uint16_t)vs_u16(row + 2);
    const unsigned background = mm_base[0xd5263a];
    const uint8_t *data = ((const uint8_t *(*)(const void *, uint16_t))(mm_base + 0x2d47a0))
        (mm_base + 0xd68290, template);
    *actor = ((uint16_t (*)(uint16_t, unsigned, unsigned, unsigned))(mm_base + 0x330a80))
        (template, row[6], background, data[3]);
    *sprite = ((uint16_t (*)(uint16_t, unsigned, unsigned, unsigned, unsigned))(mm_base + 0x330910))
        (template, row[6], background, union_id, row[0x10]);
}

static uint8_t vs_select_training(uint8_t *world, int invocation) {
    uint8_t (*native)(uint8_t *, int) = (void *)(mm_base + 0x3556f0);
    if (invocation != 8) return native(world, invocation);
    uint8_t *route = vs_training_row(world);
    uint8_t *stage = vs_stage_row();
    if (!route || !stage) {
        mm_log("Versus: could not verify the Training map and stage tables.\r\n");
        return native(world, invocation);
    }
    if (!vs_default_captured) {
        vs_default_map = vs_u16(route + 2);
        memcpy(vs_default_teams, stage + 0x10, sizeof vs_default_teams);
        memcpy(vs_default_bonus, stage + VS_BONUS_OFFSET, sizeof vs_default_bonus);
        vs_default_captured = 1;
    }
    uint8_t *packet = vs_pending_match;
    const unsigned length = vs_auto_packet_length ? vs_auto_packet_length : vs_read_queue(packet);
    const uint16_t map = (uint16_t)(length ? vs_u16(packet + 24) : vs_default_map);
    const unsigned size = length ? vs_u16(packet + 26) : vs_default_size;
    const uint8_t teams[] = {1, (uint8_t)size, (uint8_t)size, 0};
    const uint8_t no_bonus[VS_BONUS_BYTES] = {0};
    uint8_t prior[2], prior_teams[sizeof teams];
    memcpy(prior, route + 2, sizeof prior);
    memcpy(prior_teams, stage + 0x10, sizeof prior_teams);
    if (!mm_write(route + 2, &map, sizeof map)) return native(world, invocation);
    if (!mm_write(stage + 0x10, length ? teams : vs_default_teams, sizeof teams)) {
        mm_write(route + 2, prior, sizeof prior);
        return native(world, invocation);
    }
    /* Each chapter variant points to a bonus pool. Native pool zero has no
     * objectives, while the regular victory and defeat rules stay active. */
    if (!mm_write(stage + VS_BONUS_OFFSET, length ? no_bonus : vs_default_bonus, sizeof no_bonus)) {
        mm_write(stage + 0x10, prior_teams, sizeof prior_teams);
        mm_write(route + 2, prior, sizeof prior);
        return native(world, invocation);
    }
    vs_team_size = size;
    vs_position = length ? vs_u16(packet + 28) | (vs_u16(packet + 30) << 16) : vs_default_position;
    vs_match_id[0] = 0;
    vs_roster_loaded = 0;
    vs_spectator = NULL;
    vs_match_bytes = length;
    vs_auto_deploy = !length ? VS_DEPLOY_MANUAL :
                     vs_auto_packet_length ? VS_DEPLOY_REUSE : VS_DEPLOY_OPENING;
    vs_deployment_dialog = NULL;
    vs_reset_relics();
    if (length) {
        static const char hex[] = "0123456789abcdef";
        memcpy(vs_match, packet, length);
        for (unsigned i = 0; i < 16; ++i) {
            vs_match_id[i * 2] = hex[vs_match[8 + i] >> 4];
            vs_match_id[i * 2 + 1] = hex[vs_match[8 + i] & 15];
        }
        vs_match_id[32] = 0;
    }
    const uint8_t started = native(world, invocation);
    if (!started)
        vs_auto_deploy = VS_DEPLOY_MANUAL;
    else if (vs_auto_deploy == VS_DEPLOY_OPENING)
        vs_cover_opening_round();
    return started;
}

static void vs_load_roster(uint8_t *scene, const uint8_t *descriptor) {
    ((void (*)(uint8_t *, const uint8_t *))(mm_base + 0x2ef910))(scene, descriptor);
    if (vs_u32(descriptor) != VS_STAGE || !vs_matches_stage(scene)) return;
    uint8_t *destination;
    memcpy(&destination, scene + 0x1da68, sizeof destination);
    const unsigned count = vs_team_size * 2;
    const unsigned length = count * VS_ROSTER_ROW;
    if (!mm_readable(destination, length)) return;
    const int queued = vs_match_id[0] != 0;
    if (!queued && vs_u32(scene + 0x1da70) != count) return;
    const uint8_t *rows = queued ? vs_match + VS_HEADER : destination;
    const uint8_t *sprites = vs_match + VS_HEADER + length;
    uint16_t art[VS_MAX_FIGHTERS][2];
    for (unsigned i = 0; i < count; ++i) {
        const uint8_t *row = rows + i * VS_ROSTER_ROW;
        if (row[4] != 160 + i || row[0x10] != (i < vs_team_size ? 1 : 2)) return;
        // Native union 0 uses the player palette, and union 3 uses Bakram's.
        // The two unions also select the game's own movement-range colours.
        vs_team_art(row, i < vs_team_size ? VS_PLAYER_UNION : VS_BAKRAM_UNION, &art[i][0], &art[i][1]);
        if (!art[i][0] || !art[i][1]) {
            if (!queued) return;
            art[i][0] = (uint16_t)vs_u32(sprites + i * VS_PRELOAD_ROW);
            art[i][1] = (uint16_t)vs_u32(sprites + i * VS_PRELOAD_ROW + 4);
        }
    }
    if (queued) memcpy(destination, rows, length);
    for (unsigned i = 0; i < count; ++i)
        destination[i * VS_ROSTER_ROW + 0x17] = i < vs_team_size ? VS_PLAYER_UNION : VS_BAKRAM_UNION;
    memcpy(scene + 0x1da70, &count, sizeof count);
    uint8_t *preloads = scene + 0x1d820;
    vs_clear_scene_preloads(preloads);
    void (*preload)(void *, unsigned, unsigned) = (void *)(mm_base + 0x2efac0);
    if (queued && count == VS_MAX_FIGHTERS) {
        vs_release_fighter_preloads();
        vs_preload_owner = preloads;
        for (unsigned i = 0; i < count; ++i) {
            preload(vs_fighter_preloads[i], art[i][1], art[i][0]);
            ++vs_preload_count;
        }
    } else {
        for (unsigned i = 0; i < count; ++i)
            preload(preloads, art[i][1], art[i][0]);
    }
    vs_roster_loaded = queued;
}

static void vs_log_state(const char *event) {
    if (vs_match_id[0] && vs_roster_loaded) {
        char line[100];
        snprintf(line, sizeof line, "Versus: %s %s.\r\n", vs_match_id, event);
        mm_log(line);
    }
}

/* Almorica's Training command, called only from the world-map UI frame. */
static uint8_t vs_winning_match[16];
static int vs_launch_eligible;
static ULONGLONG vs_check_launch_at;
static uint8_t *vs_round_message, *vs_round_message_owner;
static uint8_t vs_round_message_text[32];
static ULONGLONG vs_check_result_at;
static uint8_t *vs_result_page;
static unsigned vs_result_page_phase;
static ULONGLONG vs_check_page_at;
static wchar_t vs_round_path[MAX_PATH];
static wchar_t vs_round_teams_path[MAX_PATH];
static int vs_round_card_available;
static wchar_t vs_final_teams[2][VS_TEAM_NAME_CAPACITY];
static unsigned vs_final_winner;
static ULONGLONG vs_champions_until;
static uint8_t vs_covered_match[16];
static int vs_waited_for_round;

struct VersusRound {
    uint8_t title, auto_next;
};

static struct VersusRound vs_read_round(const uint8_t *match) {
    const struct VersusRound missing = {0, 0};
    if (!vs_round_path[0]) return missing;
    HANDLE file = CreateFileW(vs_round_path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return missing;
    uint8_t data[19];
    DWORD length = 0;
    const int read = ReadFile(file, data, sizeof data, &length, NULL);
    CloseHandle(file);
    if (!read || length != 18 || memcmp(match, data, 16) || data[17] > 1 ||
        data[16] < VS_SEMIFINAL_ONE || data[16] > VS_QUARTERFINAL_FOUR)
        return missing;
    return (struct VersusRound){data[16], data[17]};
}

static int vs_read_round_teams(const uint8_t *match, unsigned title,
                               wchar_t names[2][VS_TEAM_NAME_CAPACITY]) {
    enum { NAME_BYTES = 113, TICKET_BYTES = 16 + 2 * NAME_BYTES };
    if (title < VS_SEMIFINAL_ONE || title > VS_QUARTERFINAL_FOUR ||
        !vs_round_card_available || !vs_round_teams_path[0]) return 0;
    HANDLE file = CreateFileW(vs_round_teams_path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    uint8_t data[TICKET_BYTES + 1];
    DWORD length = 0;
    const int read = ReadFile(file, data, sizeof data, &length, NULL);
    CloseHandle(file);
    if (!read || length != TICKET_BYTES || memcmp(match, data, 16)) return 0;
    for (unsigned i = 0; i < 2; ++i) {
        const char *name = (const char *)(data + 16 + i * NAME_BYTES);
        const char *end = memchr(name, '\0', NAME_BYTES);
        if (!end || end == name ||
            !MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, name, (int)(end - name + 1),
                                 names[i], VS_TEAM_NAME_CAPACITY))
            return 0;
    }
    return 1;
}

static void vs_cover_round(const uint8_t *match, unsigned title) {
    wchar_t names[2][VS_TEAM_NAME_CAPACITY] = {0};
    if (vs_read_round_teams(match, title, names))
        vs_set_matchup_card(title, VS_TRANSITION_MS, names);
    else
        vs_set_round_card(title ? title : VS_ROUND_TITLE, VS_TRANSITION_MS);
}

static void vs_cover_opening_round(void) {
    vs_cover_round(vs_match + 8, vs_read_round(vs_match + 8).title);
}

static void vs_show_round_start(void) {
    if (!vs_match_id[0]) return;
    const unsigned title = vs_read_round(vs_match + 8).title;
    vs_final_winner = 0;
    vs_champions_until = 0;
    memset(vs_final_teams, 0, sizeof vs_final_teams);
    const int covered = !memcmp(vs_covered_match, vs_match + 8, 16) && vs_visible_round_card();
    wchar_t names[2][VS_TEAM_NAME_CAPACITY] = {0};
    if (vs_read_round_teams(vs_match + 8, title, names)) {
        if (title == VS_FINAL_TITLE) memcpy(vs_final_teams, names, sizeof vs_final_teams);
        vs_set_matchup_card(title, covered ? 1250 : 2300, names);
    } else {
        vs_set_round_card(title ? title : VS_ROUND_TITLE, covered ? 650 : VS_CARD_MS);
    }
    memset(vs_covered_match, 0, sizeof vs_covered_match);
    vs_waited_for_round = 0;
}

static void vs_show_champions(void) {
    if (!vs_champions_until && vs_final_winner) {
        vs_set_champions_card(vs_final_teams[vs_final_winner - 1]);
        vs_champions_until = GetTickCount64() + VS_CHAMPIONS_MS;
    }
}

static int vs_launch_request(const uint8_t *pair, unsigned length, unsigned packet_length) {
    return length == 32 && packet_length >= VS_HEADER &&
           !memcmp(pair, vs_winning_match, 16) &&
           memcmp(pair, pair + 16, 16) &&
           !memcmp(pair + 16, vs_pending_match + 8, 16);
}

static unsigned vs_read_launch(uint8_t *pair) {
    HANDLE file = CreateFileW(vs_launch_path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
                              NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    DWORD length = 0;
    const int read = ReadFile(file, pair, 33, &length, NULL);
    CloseHandle(file);
    return read ? length : 0;
}

static unsigned vs_next_round(void) {
    uint8_t pair[33];
    const unsigned length = vs_read_launch(pair);
    if (length != 32 || memcmp(pair, vs_winning_match, 16)) return 0;
    const unsigned packet_length = vs_read_queue(vs_pending_match);
    if (!vs_launch_request(pair, length, packet_length)) return 0;
    const uint8_t *next_match = pair + 16;
    if (memcmp(vs_covered_match, next_match, 16)) {
        const unsigned title = vs_read_round(next_match).title;
        if (title) {
            memcpy(vs_covered_match, next_match, 16);
            vs_cover_round(next_match, title);
        }
    }
    return packet_length;
}

static unsigned vs_prepare_round_transition(void) {
    if (vs_final_winner) {
        vs_show_champions();
        return 0;
    }
    const unsigned next = vs_next_round();
    if (!next && !vs_waited_for_round) {
        const struct VersusRound current = vs_read_round(vs_winning_match);
        /* Give the companion time to publish the next packet. A stopped
         * companion or a canceled queue leaves native menus visible again. */
        if (current.auto_next && current.title != VS_FINAL_TITLE) {
            const unsigned title = current.title == VS_QUARTERFINAL_FOUR ? VS_SEMIFINAL_ONE : current.title + 1;
            vs_set_round_card(title, 5000);
        }
        vs_waited_for_round = 1;
    }
    return next;
}

static void vs_watch_round_message(uint8_t *battle) {
    uint8_t *message, *owner;
    if (!vs_launch_eligible || !vs_is_training()) return;
    memcpy(&message, mm_base + 0xd6a340, sizeof message);
    if (!mm_readable(message, 0x3a8 + sizeof vs_round_message_text)) return;
    memcpy(&owner, message + 0x3a0, sizeof owner);
    if (owner != battle || vs_u32(message + 0x394) != UINT32_MAX) return;
    vs_round_message = message;
    vs_round_message_owner = owner;
    memcpy(vs_round_message_text, message + 0x3a8, sizeof vs_round_message_text);
    vs_check_result_at = 0;
}

static void vs_result_win_message(uint8_t *battle, int type, const void *text, int speed, uint8_t focus) {
    ((void (*)(uint8_t *, int, const void *, int, uint8_t))(mm_base + 0x2eaba0))(battle, type, text, speed, focus);
    vs_watch_round_message(battle);
}

static void vs_result_loss_message(uint8_t *battle, int type, const void *text, int speed, uint8_t focus) {
    ((void (*)(uint8_t *, int, const void *, int, uint8_t))(mm_base + 0x2ea9e0))(battle, type, text, speed, focus);
    vs_watch_round_message(battle);
}

static void vs_result_text_tick(uint8_t *message) {
    ((void (*)(uint8_t *))(mm_base + 0x2eb590))(message);
    if (!vs_launch_eligible || !vs_is_training() || message != vs_round_message) return;
    uint8_t *owner;
    memcpy(&owner, message + 0x3a0, sizeof owner);
    if (owner != vs_round_message_owner || memcmp(message + 0x3a8, vs_round_message_text, sizeof vs_round_message_text)) {
        vs_round_message = NULL;
        return;
    }
    const ULONGLONG time = GetTickCount64();
    if (time < vs_check_result_at || vs_u32(message + 0x394) != UINT32_MAX) return;
    vs_check_result_at = time + 500;
    if (vs_final_winner || vs_next_round()) {
        /* The game counts this field down and runs its own close transition. */
        vs_show_champions();
        const uint32_t frames = vs_final_winner ? 1 : 90;
        memcpy(message + 0x394, &frames, sizeof frames);
        vs_round_message = NULL;
        mm_log("Versus: the round result will close automatically.\r\n");
    }
}

static int vs_result_page_can_continue(uint8_t *page, unsigned page_slot, unsigned vtable, unsigned phase) {
    if (!vs_launch_eligible || !vs_is_training()) return 0;
    uint8_t *manager, *current, *type;
    memcpy(&manager, mm_base + 0xf2d2a8, sizeof manager);
    if (!mm_readable(manager, page_slot + sizeof current) || manager[0x269] != 3)
        return 0;
    memcpy(&current, manager + page_slot, sizeof current);
    memcpy(&type, page, sizeof type);
    if (page != current || type != mm_base + vtable) return 0;
    const ULONGLONG now = GetTickCount64();
    if (page != vs_result_page || phase != vs_result_page_phase) {
        vs_result_page = page;
        vs_result_page_phase = phase;
        vs_check_page_at = now + 750;
        return 0;
    }
    if (now < vs_check_page_at) return 0;
    vs_check_page_at = now + 500;
    if (vs_final_winner) {
        vs_show_champions();
        return 1;
    }
    return vs_next_round() != 0;
}

static void vs_open_exp_page(uint8_t *page, const void *message) {
    /* The companion has had the result since the closing animation began.
     * Try to cover the frame before the native page is opened. */
    if (vs_launch_eligible && vs_is_training()) vs_prepare_round_transition();
    ((void (*)(uint8_t *, const void *))(mm_base + 0x3710c0))(page, message);
}

static uint8_t vs_exp_result_ready(uint8_t *page) {
    if (!page[0x30d] && vs_u32(page + 0x2e8) == 9 &&
        vs_result_page_can_continue(page, 0x290, 0x695910, 9)) {
        page[0x30d] = 1;
        mm_log("Versus: continued past the EXP results.\r\n");
    }
    return ((uint8_t (*)(uint8_t *))(mm_base + 0x47f720))(page);
}

static unsigned vs_total_exp_tick(uint8_t *page) {
    const unsigned phase = vs_u32(page + 0x238);
    if (!page[0x2ba] && phase >= 11 && phase <= 13 &&
        vs_result_page_can_continue(page, 0x298, 0x6958a0, phase))
        page[0x2ba] = 1;
    return ((unsigned (*)(uint8_t *))(mm_base + 0x47e080))(page);
}

static int vs_at_almorica(void) {
    const uint8_t *world_map, *party_node;
    memcpy(&world_map, mm_base + 0xece930, sizeof world_map);
    if (!mm_readable(world_map, 0x4750)) return 0;
    memcpy(&party_node, world_map + 0x4748, sizeof party_node);
    return mm_readable(party_node, 0x3340) && vs_u32(party_node + 0x333c) == 25;
}

static int vs_world_map_open(void) {
    const uint8_t *ui;
    memcpy(&ui, mm_base + 0xf2eef8, sizeof ui);
    /* Canceling formation can leave the last battle stage set on the map. */
    return mm_readable(ui, 0x1069) &&
           ui[0x1065] == 10 && ui[0x1066] == 1 && ui[0x1067] == 1 && !ui[0x1068];
}

static const char *(*vs_command_text_native)(void *, const char *, uint8_t);

static const char *vs_command_text(void *text, const char *key, uint8_t options) {
    const char *replacement = NULL;
    if (key && !strcmp(key, "COMMAND_LC_COMMAND_NAME_TRAINING_NAME"))
        replacement = "Versus";
    else if (key && !strcmp(key, "COMMAND_LC_COMMAND_NAME_TRAINING_TEXT"))
        replacement = "Start the queued Versus battle.";

    if (replacement && vs_world_map_open() && vs_at_almorica() &&
        !vs_auto_packet_length && vs_training_row(mm_base + 0xd5c670) && vs_stage_row()) {
        /* Localization can run independently of the battle handoff. */
        HANDLE heap = GetProcessHeap();
        uint8_t *packet = HeapAlloc(heap, 0, sizeof vs_match);
        if (packet) {
            const unsigned length = vs_read_queue(packet);
            HeapFree(heap, 0, packet);
            if (length) return replacement;
        }
    }
    return vs_command_text_native(text, key, options);
}

static int vs_almorica_ready(uint8_t *ui) {
    uint8_t *current_ui;
    memcpy(&current_ui, mm_base + 0xf2eef8, sizeof current_ui);
    if (ui != current_ui || !mm_readable(ui, 0x107c) ||
        ui[0x1065] != 10 || ui[0x1066] != 1 || ui[0x1067] != 1 ||
        ui[0x1068] || ui[0x106f] || ui[0xa0] == 3 || ui[0xa0] == 4 ||
        vs_u16(mm_base + 0xd525e8))
        return 0;
    uint32_t (*menu)(unsigned) = (void *)(mm_base + 0x329560);
    uint8_t (*fade_finished)(unsigned) = (void *)(mm_base + 0x377530);
    if (menu(4) || !fade_finished(0) || !fade_finished(1) || !vs_at_almorica()) return 0;

    const uint8_t **(*training_node)(unsigned) = (void *)(mm_base + 0x3e3f80);
    const uint8_t **node = training_node(25);
    if (!mm_readable(node, sizeof *node) || !mm_readable(*node, 16)) return 0;
    int (*training_unlocked)(const void *, int) = (void *)(mm_base + 0x2cde80);
    return training_unlocked(mm_base + 0xd520a0, (*node)[0xf]) &&
           vs_training_row(mm_base + 0xd5c670) && vs_stage_row();
}

static void vs_world_tick(uint8_t *ui) {
    ((void (*)(uint8_t *))(mm_base + 0x3e5d50))(ui);
    if (vs_final_winner) {
        if (vs_world_map_open()) {
            vs_show_champions();
            if (GetTickCount64() >= vs_champions_until) {
                vs_set_round_card(0, 0);
                vs_final_winner = 0;
                vs_launch_eligible = 0;
            }
        }
        return;
    }
    if (!vs_launch_eligible || !vs_launch_path[0]) return;
    const ULONGLONG time = GetTickCount64();
    if (time < vs_check_launch_at) return;
    vs_check_launch_at = time + 500;
    const unsigned packet_length = vs_prepare_round_transition();
    if (!packet_length || !vs_almorica_ready(ui)) return;

    // Keep the validated packet for the existing Training hook. The queue can
    // change while the native command prepares the stage.
    vs_launch_eligible = 0;
    vs_auto_packet_length = packet_length;
    ((void (*)(uint8_t *, int))(mm_base + 0x3e3700))(ui, 0x6d);
    vs_auto_packet_length = 0;
    if (vs_match_bytes == packet_length && !memcmp(vs_match + 8, vs_pending_match + 8, 16))
        mm_log("Versus: automatically opened Almorica Training.\r\n");
    else
        vs_set_round_card(0, 0);
}

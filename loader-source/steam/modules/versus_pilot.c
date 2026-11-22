/* Local spectator test on the Almorica Training stage. */
enum {
    VS_STAGE = 547,
    VS_STOP = 14,
    VS_UNIT_STRIDE = 0x7d0,
    VS_CONDITIONS = 0x1a8,
    VS_UNIT_SLOT = 0x2fc,
    VS_CHARACTER = 0x138,
    VS_TARGET_FLAGS = 0x618,
    VS_AI_EXCLUDE = 8,
};

static uint8_t *vs_spectator;
static unsigned vs_position;
static unsigned vs_team_size;
static int vs_result_recorded;
static void (*vs_tick_native)(uint8_t *, int, uint8_t *, void *, unsigned);
static uint8_t (*vs_defeat_native)(uint8_t *);

static int vs_team_size_supported(unsigned size) {
    return size == 3 || size == 6 || size == 12 || size == 24 || size == 30;
}

static int vs_is_training(void) {
    uint16_t stage;
    memcpy(&stage, mm_base + 0xd525e8, sizeof stage);
    return vs_team_size && stage == VS_STAGE;
}

static int vs_visible_actor(const uint8_t *unit) {
    return !vs_spectator || unit != vs_spectator || !vs_is_training();
}

static void vs_draw_unit(uint8_t *unit, void *layer, void *state) {
    if (vs_visible_actor(unit))
        ((void (*)(uint8_t *, void *, void *))(mm_base + 0x33e6c0))(unit, layer, state);
}

static void vs_draw_shadow(uint8_t *unit, void *layer) {
    if (vs_visible_actor(unit))
        ((void (*)(uint8_t *, void *))(mm_base + 0x3402a0))(unit, layer);
}

static int vs_install_spectator_render(void) {
    /* Both native actor vtables use the same separate unit and ground-shadow
     * draw callbacks. Keep the actor's presence and conditions intact. */
    const struct { unsigned slot, original; void *hook; } draws[] = {
        {0x686950, 0x33e6c0, (void *)vs_draw_unit},
        {0x686958, 0x3402a0, (void *)vs_draw_shadow},
        {0x687ea0, 0x33e6c0, (void *)vs_draw_unit},
        {0x687ea8, 0x3402a0, (void *)vs_draw_shadow},
    };
    void *stock[sizeof draws / sizeof draws[0]];
    for (unsigned i = 0; i < sizeof draws / sizeof draws[0]; ++i) {
        memcpy(&stock[i], mm_base + draws[i].slot, sizeof stock[i]);
        if (stock[i] != mm_base + draws[i].original) return 0;
    }
    for (unsigned i = 0; i < sizeof draws / sizeof draws[0]; ++i) {
        if (mm_write(mm_base + draws[i].slot, &draws[i].hook, sizeof draws[i].hook)) continue;
        for (unsigned j = 0; j <= i; ++j)
            mm_write(mm_base + draws[j].slot, &stock[j], sizeof stock[j]);
        return 0;
    }
    return 1;
}

static int vs_matches_stage(const uint8_t *scene) {
    const uint8_t *stage;
    memcpy(&stage, scene + 0x1da78, sizeof stage);
    return vs_team_size && mm_readable(stage, 230) &&
           stage[0x10] == 1 && stage[0x11] == vs_team_size &&
           stage[0x12] == vs_team_size && stage[0x22] == 1;
}

#include "versus_queue.c"
#include "versus_relics.c"
#include "versus_names.c"
#include "versus_round_card.h"
#include "versus_auto_launch.c"
#include "versus_formation.c"

static void vs_refresh_fighter(uint8_t *character) {
    const int index = vs_match[5] == '4' ? vs_fighter_index(character) : -1;
    if (index >= 0) {
        const uint8_t *stats = vs_match + vs_match_bytes - 2 * vs_team_size * VS_STAT_ROW +
                               index * VS_STAT_ROW;
        // The save codec stores HP in the 32-bit bank and the other nine
        // modifiers in the 16-bit bank. Let the native refresh recompute
        // totals with the fighter's actual equipment and set bonus.
        memcpy(character + 0x1a0, stats, 4);
        memcpy(character + 0x180, stats + 4, VS_STAT_ROW - 4);
    }
    ((void (*)(uint8_t *))(mm_base + 0x330650))(character);
}

static void vs_stop(uint8_t *unit) {
    uint8_t *state = unit + VS_CONDITIONS;
    const uint8_t *row = starting_status_row(VS_STOP);
    uint8_t *timer = starting_status_timer(state, row);
    if (!timer) return;
    if (!starting_status_active(state, VS_STOP)) {
        ((uint8_t (*)(uint8_t *, unsigned, int, void *, void *))(mm_base + 0x392d10))
            (state, VS_STOP, row[6], unit, NULL);
    }
    if (starting_status_active(state, VS_STOP)) starting_status_mark(timer, row[0]);
}

static uint8_t *vs_spawn(uint8_t *scene, void *battle, uint8_t *character,
                         unsigned coordinates, unsigned facing) {
    uint8_t *(*spawn)(uint8_t *, void *, uint8_t *, unsigned, unsigned) =
        (void *)(mm_base + 0x2f0bd0);
    if (!vs_is_training() || !vs_matches_stage(scene)) {
        vs_spectator = NULL;
        return spawn(scene, battle, character, coordinates, facing);
    }
    memcpy(vs_spectator_gear, character + 0x54, sizeof vs_spectator_gear);
    vs_spectator = spawn(scene, battle, character, vs_position, facing);
    if (vs_spectator) {
        vs_spectator_template = vs_u16(character);
        vs_spectator_serial = vs_u32(character + 4);
        vs_have_spectator_identity = 1;
        vs_auto_deploy = 0;
        vs_deployment_dialog = NULL;
        vs_round_message = NULL;
        vs_result_page = NULL;
        vs_result_recorded = 0;
        vs_launch_eligible = 0;
        vs_show_round_start();
        mm_log("Versus: match started.\r\n");
        vs_log_state("started");
        vs_stop(vs_spectator);
        mm_log(starting_status_active(vs_spectator + VS_CONDITIONS, VS_STOP) ?
               "Versus: spectator deployed with Stop.\r\n" :
               "Versus: spectator deployed but native Stop did not apply.\r\n");
    }
    return vs_spectator;
}

static void vs_tick(uint8_t *state, int elapsed, uint8_t *unit, void *rng, unsigned mode) {
    if (unit && unit == vs_spectator && state == unit + VS_CONDITIONS && vs_is_training()) {
        /* Keep the spectator's native Stop active. Their other conditions
         * remain out of the turn loop along with the spectator. */
        vs_stop(unit);
        return;
    }
    vs_tick_native(state, elapsed, unit, rng, mode);
}

static void vs_prepare_ai_targets(void *workspace, void *criteria) {
    // Let stock targeting apply its usual Invisibility and target priorities.
    ((void (*)(void *, void *))(mm_base + 0x2f66b0))(workspace, criteria);
    if (!vs_is_training() || !mm_readable(vs_spectator, VS_UNIT_SLOT + 1)) return;
    const unsigned slot = vs_spectator[VS_UNIT_SLOT];
    if (slot >= battle_capacity_unit_count()) return;
    uint8_t *simulation = ((uint8_t *(*)(void *))(mm_base + 0x2ed1f0))(mm_base + 0xd6ab80);
    if (!mm_readable(simulation, 0x1b50)) return;
    uint8_t *pool;
    memcpy(&pool, simulation + 0x1b48, sizeof pool);
    if (!pool) return;
    uint8_t *unit = pool + slot * VS_UNIT_STRIDE;
    if (unit == vs_spectator || !mm_readable(unit, VS_TARGET_FLAGS + 1) ||
        unit[VS_UNIT_SLOT] != slot || !vs_same_spectator(unit + VS_CHARACTER)) return;
    // Keep the same exclusion in the look-ahead copy regardless of the side
    // that is thinking. Stock Invisibility has a fallback for sole targets.
    unit[VS_TARGET_FLAGS] |= VS_AI_EXCLUDE;
}

static uint8_t *vs_live_pool(const uint8_t *battle) {
    if (!vs_spectator || !vs_is_training()) return NULL;
    uint8_t *pool;
    memcpy(&pool, battle + 0x1b48, sizeof pool);
    if (!pool) return NULL;
    uintptr_t offset = (uintptr_t)vs_spectator - (uintptr_t)pool;
    if (offset >= (uintptr_t)battle_capacity_unit_count() * VS_UNIT_STRIDE ||
        offset % VS_UNIT_STRIDE) return NULL;
    return pool;
}

static int vs_team_a_down(uint8_t *pool) {
    unsigned (*count)(uint8_t *, unsigned) = (void *)(mm_base + 0x3753d0);
    const unsigned alive = count(pool, 2);
    uint8_t (*present)(const void *) = (void *)(mm_base + 0x342860);
    uint8_t (*able)(const void *) = (void *)(mm_base + 0x3427b0);
    const unsigned spectator_active = vs_spectator[0x188] == 1 &&
                                      present(vs_spectator) && able(vs_spectator);
    return alive <= spectator_active;
}

static uint8_t vs_defeat(uint8_t *battle) {
    uint32_t state;
    memcpy(&state, battle + 0x1a2c, sizeof state);
    uint8_t *pool = state ? vs_live_pool(battle) : NULL;
    return pool ? vs_team_a_down(pool) : vs_defeat_native(battle);
}

static void vs_record_result(uint8_t *battle) {
    uint8_t *pool = vs_result_recorded ? NULL : vs_live_pool(battle);
    if (!pool) return;
    unsigned (*count)(uint8_t *, unsigned) = (void *)(mm_base + 0x3753d0);
    const int defeated = vs_team_a_down(pool);
    const int enemy_defeated = count(pool, 4) == 0;
    if (defeated || enemy_defeated) {
        vs_result_recorded = 1;
        if (vs_match_id[0] && defeated != enemy_defeated) {
            memcpy(vs_winning_match, vs_match + 8, sizeof vs_winning_match);
            vs_launch_eligible = 1;
            vs_check_launch_at = 0;
            if (vs_final_teams[0][0] && vs_final_teams[1][0])
                vs_final_winner = defeated ? 2 : 1;
        }
        mm_log(defeated && enemy_defeated ? "Versus: result draw.\r\n" :
               defeated ? "Versus: result Team B wins.\r\n" :
                          "Versus: result Team A wins.\r\n");
        vs_log_state(defeated && enemy_defeated ? "draw" : defeated ? "Team B wins" : "Team A wins");
    }
}

static void vs_commit_result(uint8_t *battle, unsigned mode) {
    /* The turn job and the per-frame update both commit results. Report the
     * outcome before starting the transition out of the battle. */
    vs_record_result(battle);
    ((void (*)(uint8_t *, unsigned))(mm_base + 0x3678a0))(battle, mode);
}

static int vs_competitor(const uint8_t *unit) {
    return vs_spectator && unit && unit != vs_spectator && vs_is_training() &&
           unit[0x188] == 1 && (unit[0x18a] & 0x20);
}

static unsigned vs_competitor_outcome(uint8_t *unit) {
    uint8_t (*undead)(const void *) = (void *)(mm_base + 0x334710);
    return undead(unit + 0x138) ? 5 : 2;
}

static unsigned vs_outcome_preview(uint8_t *unit) {
    if (vs_competitor(unit)) return vs_competitor_outcome(unit);
    return ((unsigned (*)(uint8_t *))(mm_base + 0x340940))(unit);
}

static uint8_t vs_resolve_fall(void *source, uint8_t *unit, void *pool) {
    if (vs_competitor(unit)) {
        uint32_t outcome;
        memcpy(&outcome, unit + 0x2f0, sizeof outcome);
        /* 3 is the guest's Shiftstone retreat, and 8 is the alternate
         * story-protected outcome. Use the same fall as Team B. */
        if (outcome == 3 || outcome == 8) {
            outcome = vs_competitor_outcome(unit);
            memcpy(unit + 0x2f0, &outcome, sizeof outcome);
        }
    }
    return ((uint8_t (*)(void *, uint8_t *, void *))(mm_base + 0x4582a0))(source, unit, pool);
}

static int vs_install_hooks(unsigned count, unsigned x, unsigned y, unsigned capacity) {
    if ((count != 0 && !vs_team_size_supported(count)) || x > 127 || y > 127 ||
        2 * count + 1 > capacity) {
        mm_log("Versus: invalid team size, spectator tile or battle capacity.\r\n");
        return 0;
    }

    const struct { unsigned site, original, length; void *hook; } calls[] = {
        {0x2f086e, 0x2f0bd0, 5, (void *)vs_spawn},
        {0x34464b, 0x393490, 5, (void *)vs_tick},
        {0x362e30, 0, 6, (void *)vs_defeat},
        {0x2f5980, 0x2f66b0, 5, (void *)vs_prepare_ai_targets},
        {0x44effc, 0x340940, 5, (void *)vs_outcome_preview},
        {0x453b19, 0x340940, 5, (void *)vs_outcome_preview},
        {0x470f85, 0x340940, 5, (void *)vs_outcome_preview},
        {0x34207a, 0x4582a0, 5, (void *)vs_resolve_fall},
        {0x36ceec, 0x3678a0, 5, (void *)vs_commit_result},
        {0x368479, 0x3678a0, 5, (void *)vs_commit_result},
        {0x367af6, 0x2eaba0, 5, (void *)vs_result_win_message},
        {0x367ab7, 0x2ea9e0, 5, (void *)vs_result_loss_message},
        {0x2eadd6, 0x2eb590, 5, (void *)vs_result_text_tick},
        {0x371a6d, 0x47f720, 5, (void *)vs_exp_result_ready},
        {0x47ad8f, 0x47e080, 5, (void *)vs_total_exp_tick},
        {0x3e39d3, 0x3556f0, 5, (void *)vs_select_training},
        {0x3e5615, 0x3e5d50, 5, (void *)vs_world_tick},
        {0x494b73, 0x495bc0, 5, (void *)vs_formation_tick},
        {0x2d29a8, 0x2ef910, 5, (void *)vs_load_roster},
        {0x2f08fb, 0x2f0ca0, 5, (void *)vs_spawn_fighters},
        {0x2f0b4a, 0x330650, 5, (void *)vs_refresh_fighter},
        {0x371a0a, 0x3710c0, 5, (void *)vs_open_exp_page},
        {0x371a58, 0x3710c0, 5, (void *)vs_open_exp_page},
        {0x2efa5c, 0x2f02b0, 5, (void *)vs_clear_scene_preloads},
        {0x2f0290, 0x2f02b0, 5, (void *)vs_clear_scene_preloads},
        /* The castle popup and the sidebar resolve their text independently. */
        {0x2b95d0, 0, 12, (void *)vs_command_text},
    };
    enum { SITE_COUNT = sizeof calls / sizeof calls[0], DEFEAT_SITE = 2,
           TEXT_SITE = SITE_COUNT - 1, MAX_PATCH_LENGTH = 12 };
    unsigned char stock[SITE_COUNT][MAX_PATCH_LENGTH];
    vs_tick_native = (void *)(mm_base + 0x393490);
    for (unsigned i = 0; i < SITE_COUNT; ++i) {
        const uint8_t *site = mm_base + calls[i].site;
        memcpy(stock[i], site, calls[i].length);
        if (!calls[i].original) {
            /* The copied entry instructions must be whole and position independent. */
            const char *prefix = i == DEFEAT_SITE ? "\x40\x53\x48\x83\xec\x20" :
                "\x40\x55\x56\x57\x41\x54\x41\x55\x41\x56\x41\x57";
            if (memcmp(site, prefix, calls[i].length)) {
                mm_log("Versus: unexpected function entry in the executable.\r\n");
                return 0;
            }
            continue;
        }
        int32_t relative;
        memcpy(&relative, site + 1, sizeof relative);
        if (site[0] != 0xe8) {
            mm_log("Versus: unexpected setup or RT instruction.\r\n");
            return 0;
        }
        const uint8_t *target = site + 5 + relative;
        if (target == mm_base + calls[i].original) continue;
        /* Starting Status can already own the RT call, so keep its behavior
         * for every other unit. */
        if (i != 1 || !mm_readable(target, 14) ||
            memcmp(target, "\xff\x25\0\0\0\0", 6)) {
            mm_log("Versus: setup or RT call has an unsupported target.\r\n");
            return 0;
        }
        void *hook;
        memcpy(&hook, target + 6, sizeof hook);
        if (hook != (void *)starting_status_tick) {
            mm_log("Versus: RT call is already hooked by a different module.\r\n");
            return 0;
        }
        vs_tick_native = starting_status_tick;
    }
    unsigned char *relay = mm_near_page();
    if (!relay) return 0;
    for (unsigned i = 0; i < SITE_COUNT; ++i) mm_abs_jump(relay + 16 * i, calls[i].hook);
    unsigned char *trampoline = relay + SITE_COUNT * 16;
    for (unsigned i = 0; i < SITE_COUNT; ++i) {
        if (calls[i].original) continue;
        const unsigned length = calls[i].length;
        memcpy(trampoline, stock[i], length);
        mm_abs_jump(trampoline + length, mm_base + calls[i].site + length);
        if (i == DEFEAT_SITE) vs_defeat_native = (void *)trampoline;
        if (i == TEXT_SITE) vs_command_text_native = (void *)trampoline;
        trampoline += length + 14;
    }
    FlushInstructionCache(GetCurrentProcess(), relay, (SIZE_T)(trampoline - relay));
    for (unsigned i = 0; i < SITE_COUNT; ++i) {
        uint8_t *site = mm_base + calls[i].site;
        uint8_t patch[MAX_PATCH_LENGTH];
        memset(patch, 0x90, sizeof patch);
        patch[0] = calls[i].original ? 0xe8 : 0xe9;
        int32_t relative = (int32_t)((intptr_t)(relay + 16 * i) - (intptr_t)(site + 5));
        memcpy(patch + 1, &relative, sizeof relative);
        if (!mm_write(site, patch, calls[i].length)) {
            for (unsigned j = 0; j <= i; ++j)
                mm_write(mm_base + calls[j].site, stock[j], calls[j].length);
            return 0;
        }
    }
    vs_position = x | (y << 16);
    vs_team_size = count;
    vs_default_position = vs_position;
    vs_default_size = count;
    mm_log("Versus: Almorica Training hooks ready. Both teams use combat knockout rules.\r\n");
    return 1;
}

static int vs_install_round_card(void) {
    /* Present for the game's swap chains. Preserve RCX (swap chain) and
     * ESI (sync interval), and keep the original zero flags in the wrapper. */
    uint8_t *site = mm_base + 0x53362;
    const uint8_t stock[] = {0x45, 0x33, 0xc0, 0x8b, 0xd6, 0xff, 0x50, 0x40};
    if (memcmp(site, stock, sizeof stock)) return 0;
    uint8_t *relay = mm_near_page();
    if (!relay) return 0;
    mm_abs_jump(relay, (void *)vs_present_round_card);
    FlushInstructionCache(GetCurrentProcess(), relay, 14);
    uint8_t patch[] = {0x8b, 0xd6, 0xe8, 0, 0, 0, 0, 0x90};
    const int32_t relative = (int32_t)((intptr_t)relay - (intptr_t)(site + 7));
    memcpy(patch + 3, &relative, sizeof relative);
    if (mm_write(site, patch, sizeof patch)) {
        vs_round_card_available = 1;
        return 1;
    }
    VirtualFree(relay, 0, MEM_RELEASE);
    return 0;
}

static int mm_install_versus_pilot(const wchar_t *config) {
    if (!GetPrivateProfileIntW(L"VersusPilot", L"Enabled", 0, config)) return 1;
    const wchar_t *name = wcsrchr(config, L'\\');
    wchar_t sidecar[sizeof L"versus-next-0123456789abcdef.dat" / sizeof(wchar_t)];
    wchar_t key[18];
    unsigned key_length = GetPrivateProfileStringW(L"VersusPilot", L"QueueKey", L"", key,
                                                   sizeof key / sizeof key[0], config);
    if (key_length && (key_length != 16 || wcsspn(key, L"0123456789abcdef") != key_length)) return 0;
    int sidecar_length = key_length ? swprintf(sidecar, sizeof sidecar / sizeof sidecar[0],
                                                L"versus-next-%ls.dat", key)
                                    : swprintf(sidecar, sizeof sidecar / sizeof sidecar[0], L"versus-next.dat");
    if (!name || sidecar_length < 0 || (size_t)(name - config + 2 + sidecar_length) >
                 sizeof vs_queue_path / sizeof vs_queue_path[0]) return 0;
    size_t prefix = (size_t)(name - config + 1);
    memcpy(vs_queue_path, config, prefix * sizeof(wchar_t));
    memcpy(vs_queue_path + prefix, sidecar, (sidecar_length + 1) * sizeof(wchar_t));
    if (key_length) {
        memcpy(vs_launch_path, config, prefix * sizeof(wchar_t));
        swprintf(vs_launch_path + prefix, sizeof vs_launch_path / sizeof vs_launch_path[0] - prefix,
                 L"versus-start-%ls.dat", key);
        if (prefix + sizeof L"versus-round-0123456789abcdef.dat" / sizeof(wchar_t) <= MAX_PATH) {
            memcpy(vs_round_path, config, prefix * sizeof(wchar_t));
            swprintf(vs_round_path + prefix, MAX_PATH - prefix, L"versus-round-%ls.dat", key);
            memcpy(vs_round_teams_path, config, prefix * sizeof(wchar_t));
            swprintf(vs_round_teams_path + prefix, MAX_PATH - prefix, L"versus-final-%ls.dat", key);
        }
    }
    const int installed = vs_install_hooks(GetPrivateProfileIntW(L"VersusPilot", L"TeamSize", 0, config),
                                  GetPrivateProfileIntW(L"VersusPilot", L"SpectatorX", 255, config),
                                  GetPrivateProfileIntW(L"VersusPilot", L"SpectatorY", 255, config),
                                  battle_capacity_unit_count());
    if (installed && !vs_install_relic_lookup()) {
        mm_log("Versus: relic resolver could not be installed.\r\n");
        return 0;
    }
    if (installed && !vs_install_names())
        mm_log("Versus: saved fighter names were unavailable. The match can still run.\r\n");
    if (installed && !vs_install_round_card())
        mm_log("Versus: round title display was unavailable. The match can still run.\r\n");
    if (installed)
        mm_log(vs_install_spectator_render() ? "Versus: spectator drawing disabled.\r\n" :
               "Versus: spectator render hooks were unavailable.\r\n");
    return installed;
}

#ifdef TOR_VERSUS_PILOT_TEST
__declspec(dllexport) int vs_capacity_test(uint8_t *image, size_t size) {
    return battle_capacity_install(image, size, 0);
}

__declspec(dllexport) int vs_ai_plus_test(uint8_t *image) {
    mm_base = image;
    mm_install_ai_status(1, 1, 1, 1);
    const int choices = mm_install_ai_choices();
    mm_install_ai_mp_recovery();
    return choices;
}

__declspec(dllexport) int vs_install_test(unsigned char *image, unsigned capacity) {
    mm_base = image;
    return vs_install_hooks(12, 31, 0, capacity);
}

__declspec(dllexport) int vs_spectator_render_test(uint8_t *spectator) {
    vs_spectator = spectator;
    return vs_install_spectator_render();
}

__declspec(dllexport) unsigned vs_outcome_test(uint8_t *unit, uint8_t *spectator) {
    vs_spectator = spectator;
    const unsigned forecast = vs_outcome_preview(unit);
    vs_resolve_fall(NULL, unit, NULL);
    vs_spectator = NULL;
    return forecast;
}

__declspec(dllexport) int vs_packet_test(const uint8_t *data, unsigned length, unsigned capacity) {
    return vs_packet_valid(data, length, capacity);
}

__declspec(dllexport) unsigned vs_select_test(const wchar_t *path, uint8_t *world) {
    if (wcslen(path) >= sizeof vs_queue_path / sizeof vs_queue_path[0]) return 0;
    wcscpy(vs_queue_path, path);
    return vs_select_training(world, 8);
}

__declspec(dllexport) void vs_setup_auto_tick_test(const wchar_t *path) {
    wcscpy(vs_launch_path, path);
    vs_check_launch_at = 0;
    vs_check_result_at = 0;
    vs_check_page_at = 0;
}

__declspec(dllexport) int vs_setup_round_test(const wchar_t *path) {
    wcscpy(vs_round_path, path);
    return vs_install_round_card();
}

__declspec(dllexport) unsigned vs_visible_round_test(void) {
    return vs_visible_round_card();
}

__declspec(dllexport) void vs_setup_round_teams_test(const wchar_t *path) {
    wcscpy(vs_round_teams_path, path);
    vs_show_round_start();
}

__declspec(dllexport) void vs_champions_elapsed_test(void) {
    vs_champions_until = 1;
}

__declspec(dllexport) void vs_formation_test(unsigned template, unsigned serial, int armed) {
    vs_spectator_template = template;
    vs_spectator_serial = serial;
    vs_have_spectator_identity = template != 0;
    vs_deployment_dialog = NULL;
    vs_auto_deploy = armed;
}

__declspec(dllexport) int vs_roster_test(uint8_t *scene, const uint8_t *descriptor) {
    vs_load_roster(scene, descriptor);
    return vs_roster_loaded;
}

__declspec(dllexport) void vs_set_stock_fallback_test(void) {
    vs_default_captured = 0;
    vs_default_size = 0;
    vs_team_size = 0;
}

__declspec(dllexport) int vs_install_relic_test(void) {
    return vs_install_relic_lookup();
}

__declspec(dllexport) int vs_install_names_test(void) {
    return vs_install_names();
}

__declspec(dllexport) void vs_setup_result_test(uint8_t *spectator, const wchar_t *log_path) {
    vs_spectator = spectator;
    vs_result_recorded = 0;
    wcscpy(mm_log_path, log_path);
}

__declspec(dllexport) void vs_form_test(uint8_t *scene, uint8_t *battle, const uint16_t *worn) {
    memcpy(vs_spectator_gear, worn, sizeof vs_spectator_gear);
    vs_spectator = scene;
    vs_spawn_fighters(scene, battle, NULL, 1, vs_team_size, NULL);
    vs_spectator = NULL;
}
#endif

/* Give a waiting enemy a second search limited to self-use MP consumables.
 * The game still validates targets and builds the normal item command.
 */
enum {
    MP_SEARCH_CALL = 0x2f5604,
    MP_SELECT_CALL = 0x2f575b,
    MP_SCORE_ENTRY = 0x3c3e30,
    MP_ITEM_COMMAND = 5,
    MP_MAX_ITEMS = 4,
    MP_HEALING_WEIGHT = 100,
    MP_ACTOR = 0x1cb78,
    MP_PROFILE = 0x1cb88,
    MP_CURRENT = 0x14a,
    MP_MAXIMUM = 0x268,
};

typedef struct {
    uint8_t type, mode;
    uint16_t id, variant, effect;
    uint32_t excluded;
} MpAction;

typedef struct {
    const MpAction *actions;
    int count;
} MpActionList;

typedef struct {
    uint8_t *workspace, *actor;
    uint8_t search_context[16];
    MpAction items[MP_MAX_ITEMS];
    int count, threshold, scoring;
} MpFallback;

typedef void (*MpSearchFn)(uint8_t *, void *, const void *, const MpActionList *, int);
typedef void (*MpSelectFn)(void *, uint8_t *, uint32_t);
typedef int32_t *(*MpScoreFn)(const void *, int32_t *, const void *, unsigned);
typedef void (*MpResetFn)(void *, uint32_t);
typedef void (*MpPositionFn)(void *, uint32_t, uint8_t *);

static MpSearchFn mp_search_native;
static MpSelectFn mp_select_native;
static MpScoreFn mp_score_native;
static DWORD mp_tls = TLS_OUT_OF_INDEXES;

static uint16_t mp_u16(const void *data) {
    uint16_t value;
    memcpy(&value, data, sizeof value);
    return value;
}

static const uint8_t *mp_row(unsigned table_rva, unsigned id, unsigned min_stride) {
    const uint8_t *table = *(const uint8_t **)(mm_base + table_rva);
    if (!table) return NULL;
    uint32_t count, start, stride;
    memcpy(&count, table + 4, sizeof count);
    memcpy(&start, table + 8, sizeof start);
    memcpy(&stride, table + 12, sizeof stride);
    return id && id < count && stride >= min_stride ? table + start + (size_t)id * stride : NULL;
}

static int mp_action_needs_recovery(unsigned effect_id, int current, int maximum) {
    const uint8_t *effect = mp_row(0xd78e88, effect_id, 10);
    if (!effect || effect[7] != 2) return 0;
    int cost = mp_u16(effect + 8);
    return cost > current && cost <= maximum;
}

static int mp_needs_recovery(const uint8_t *actor) {
    int current = mp_u16(actor + MP_CURRENT), maximum = mp_u16(actor + MP_MAXIMUM);
    if (current >= maximum) return 0;
    for (unsigned i = 0; i < 4; ++i) {
        unsigned spell = mp_u16(actor + 0x234 + 2 * i);
        const uint8_t *book = spell >= 1000 && spell < 2000 ? mp_row(0xd78e58, spell - 1000, 6) : NULL;
        if (book && mp_action_needs_recovery(mp_u16(book + 4), current, maximum)) return 1;
        const uint8_t *skill = mp_row(0xd78e38, mp_u16(actor + 0x1f8 + 6 * i), 6);
        if (skill && mp_action_needs_recovery(mp_u16(skill + 4), current, maximum)) return 1;
    }
    return 0;
}

static int mp_restores_mp(const MpAction *action) {
    if (action->type != MP_ITEM_COMMAND || action->excluded) return 0;
    const uint8_t *effect = mp_row(0xd78e88, action->effect, 0x66);
    if (!effect || effect[2] != 16) return 0;
    return effect[0x2a] == 5 || effect[0x44] == 5 || effect[0x5e] == 5;
}

static MpFallback *mp_state(void) {
    return TlsGetValue(mp_tls);
}

static void mp_capture_search(uint8_t *workspace, void *results, const void *context,
                              const MpActionList *list, int threshold) {
    uint8_t *actor = *(uint8_t **)(workspace + MP_ACTOR);
    if (actor && actor[0x188] == 2 && mp_needs_recovery(actor)) {
        MpFallback pending = {.workspace = workspace, .actor = actor, .threshold = threshold};
        memcpy(pending.search_context, context, sizeof pending.search_context);
        for (int i = 0; i < list->count && pending.count < MP_MAX_ITEMS; ++i)
            if (mp_restores_mp(list->actions + i))
                pending.items[pending.count++] = list->actions[i];
        if (pending.count) {
            MpFallback *state = HeapAlloc(GetProcessHeap(), 0, sizeof *state);
            if (state) {
                *state = pending;
                if (!TlsSetValue(mp_tls, state)) HeapFree(GetProcessHeap(), 0, state);
            }
        }
    }
    mp_search_native(workspace, results, context, list, threshold);
}

static int32_t *mp_score_target(const void *simulation, int32_t *out, const void *target, unsigned flags) {
    MpFallback *state = mp_state();
    if (state && state->scoring) {
        /* The simulation starts with the caster tile. Only try the item on that tile. */
        uint32_t from, to;
        memcpy(&from, simulation, sizeof from);
        memcpy(&to, target, sizeof to);
        if (from != to) {
            out[0] = 0;
            out[1] = -1;
            return out;
        }
    }
    return mp_score_native(simulation, out, target, flags);
}

static void mp_select_action(void *command, uint8_t *selected, uint32_t position) {
    MpFallback *state = mp_state();
    if (!state) {
        mp_select_native(command, selected, position);
        return;
    }
    const MpActionList items = {state->items, state->count};
    uint32_t selected_flags;
    memcpy(&selected_flags, selected + 0x10, sizeof selected_flags);
    if (!selected_flags && selected[8] <= 1) {
        /* Use the same simulated battlefield that the primary native search uses. */
        const uint8_t *battles = *(const uint8_t **)(mm_base + 0xd7b6c0 + 0x1b0);
        void *field = battles ? *(void * const *)(battles + 0xdd580 + 0x1b70) : NULL;
        if (field) {
            void (*init_result)(void *) = (void *)(mm_base + 0x2f3210);
            const uint8_t *(*best_result)(void *, int) = (void *)(mm_base + 0x3cb950);
            MpResetFn reset_field = (void *)(mm_base + 0x3ba870);
            MpPositionFn set_position = (void *)(mm_base + 0x3bc4b0);
            _Alignas(16) uint8_t results[0x134 * 5];
            for (int i = 0; i < 5; ++i) init_result(results + i * 0x134);
            uint8_t *weight = state->workspace + MP_PROFILE + 0x1a;
            uint16_t original = mp_u16(weight), recovery = MP_HEALING_WEIGHT;
            memcpy(weight, &recovery, sizeof recovery);
            reset_field(field, position);
            state->scoring = 1;
            mp_search_native(state->workspace, results, state->search_context, &items, state->threshold);
            state->scoring = 0;
            memcpy(weight, &original, sizeof original);
            set_position(field, position, state->actor);
            const uint8_t *choice = best_result(results, 0);
            if (choice && choice[8] == MP_ITEM_COMMAND) {
                memcpy(selected, choice, 0x2c);
                mm_log("AI Plus: enemy selected an MP recovery item.\r\n");
            }
        }
    }
    TlsSetValue(mp_tls, NULL);
    HeapFree(GetProcessHeap(), 0, state);
    mp_select_native(command, selected, position);
}

static int mp_read_call(unsigned site, unsigned target) {
    const uint8_t *code = mm_base + site;
    int32_t relative;
    memcpy(&relative, code + 1, sizeof relative);
    return code[0] == 0xe8 && (int64_t)site + 5 + relative == target;
}

static void mm_install_ai_mp_recovery(void) {
    const unsigned sites[] = {MP_SEARCH_CALL, MP_SELECT_CALL, MP_SCORE_ENTRY};
    const unsigned targets[] = {0x2f4990, 0x3bf8f0};
    void *const hooks[] = {(void *)mp_capture_search, (void *)mp_select_action, (void *)mp_score_target};
    static const uint8_t score_prologue[] = {0x40, 0x55, 0x53, 0x57, 0x41, 0x54};
    const size_t lengths[] = {5, 5, sizeof score_prologue};
    uint8_t originals[3][sizeof score_prologue];
    for (int i = 0; i < 3; ++i) {
        int matches = i < 2 ? mp_read_call(sites[i], targets[i])
                            : !memcmp(mm_base + sites[i], score_prologue, sizeof score_prologue);
        if (!matches) {
            mm_log("AI Plus: MP recovery disabled because the game code differs.\r\n");
            return;
        }
        memcpy(originals[i], mm_base + sites[i], lengths[i]);
    }
    uint8_t *relay = mm_near_page();
    if (!relay) return;
    mp_tls = TlsAlloc();
    if (mp_tls == TLS_OUT_OF_INDEXES) {
        VirtualFree(relay, 0, MEM_RELEASE);
        return;
    }
    mp_search_native = (void *)(mm_base + targets[0]);
    mp_select_native = (void *)(mm_base + targets[1]);
    /* Trap AI already owns the caller. Hook the score function it calls. */
    uint8_t *score_trampoline = relay + 48;
    memcpy(score_trampoline, score_prologue, sizeof score_prologue);
    mm_abs_jump(score_trampoline + sizeof score_prologue, mm_base + MP_SCORE_ENTRY + sizeof score_prologue);
    mp_score_native = (void *)score_trampoline;
    for (int i = 0; i < 3; ++i) mm_abs_jump(relay + i * 16, hooks[i]);
    FlushInstructionCache(GetCurrentProcess(), relay, 48 + sizeof score_prologue + 14);
    for (int i = 0; i < 3; ++i) {
        uint8_t patch[sizeof score_prologue] = {i < 2 ? 0xe8 : 0xe9, 0, 0, 0, 0, 0x90};
        int32_t relative = (int32_t)((intptr_t)(relay + i * 16) - (intptr_t)(mm_base + sites[i] + 5));
        memcpy(patch + 1, &relative, sizeof relative);
        if (!mm_write(mm_base + sites[i], patch, lengths[i])) {
            for (int j = 0; j <= i; ++j) mm_write(mm_base + sites[j], originals[j], lengths[j]);
            TlsFree(mp_tls);
            VirtualFree(relay, 0, MEM_RELEASE);
            mm_log("AI Plus: MP recovery hooks could not be installed.\r\n");
            return;
        }
    }
    mm_log("AI Plus: enemy MP recovery fallback enabled.\r\n");
}

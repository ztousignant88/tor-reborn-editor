/* Enemy level scaling. Included after starting_status.c so the shared status
 * tick can be chained without replacing its persistent-condition behavior.
 * Only live battle character copies are changed. No roster/save editing. */
static int el_enabled, el_offset, el_locked, el_target;
static void (*el_tick_native)(uint8_t *, int, uint8_t *, void *, unsigned);
static void (*el_finish_loadout)(uint8_t *, int);
static void (*el_refresh_ranks)(uint8_t *);

static unsigned el_u16(const uint8_t *p) {
    uint16_t v; memcpy(&v, p, sizeof v); return v;
}
static void el_put16(uint8_t *p, unsigned v) {
    uint16_t n = (uint16_t)v; memcpy(p, &n, sizeof n);
}
static uint8_t *el_battle_units(void) {
    const uint8_t *manager = mm_base + 0xd6ab80;
    if (!mm_readable(manager, 0x1bc)) return NULL;
    const uint8_t *contexts; int index;
    memcpy(&contexts, manager + 0x1b0, sizeof contexts);
    memcpy(&index, manager + 0x1b8, sizeof index);
    if (!contexts || index < 0 || index > 2) return NULL;
    const uint8_t *battle = contexts + (size_t)index * 0xdd580;
    if (!mm_readable(battle, 0x1b50)) return NULL;
    uint8_t *units; memcpy(&units, battle + 0x1b48, sizeof units);
    return mm_readable(units, battle_capacity_unit_count() * 0x7d0) ? units : NULL;
}
static int el_highest(const uint8_t *units) {
    int highest = 0;
    const unsigned count = battle_capacity_unit_count();
    for (unsigned i = 0; i < count; ++i) {
        const uint8_t *u = units + i * 0x7d0;
        /* Include fallen deployed allies; exclude undeployed reserve records.
         * +0x24c is the character's original level, before battle level sync. */
        if (u[0x10] && u[0x188] == 1 && u[0x24c] > highest)
            highest = u[0x24c];
    }
    return highest;
}
static void el_adjust(uint8_t *u, int target) {
    uint8_t *c = u + 0x138;
    const int old = c[0x114];
    if (old == target && c[0x4a] == target) return;
    if (old < 1 || old > 99) return;
    const unsigned hp = el_u16(u + 0x148), mp = el_u16(u + 0x14a);
    const unsigned max_hp = el_u16(u + 0x266), max_mp = el_u16(u + 0x268);
    _Alignas(16) int32_t stats[40];
    int32_t delta[10];
    ((void *(*)(void *, const void *, const void *))(mm_base + 0x351710))
        (stats, c + 0x142, c + 0x194);
    /* The game's class+race growth calculator multiplies each growth by the
     * signed level difference. This preserves custom/boss stat bonuses. */
    ((void (*)(void *, void *, unsigned, unsigned, int))(mm_base + 0x353d60))
        (NULL, delta, c[0x49], el_u16(c), target - old);
    for (unsigned i = 0; i < 10; ++i) {
        int64_t n = (int64_t)stats[10 + i] + delta[i];
        const int64_t cap = i ? 65535 : 2147483647;
        stats[10 + i] = (int32_t)(n < 0 ? 0 : n > cap ? cap : n);
    }
    ((void (*)(void *, void *, void *))(mm_base + 0x353770))
        (stats, c + 0x142, c + 0x194);
    /* Native 3324f0 writes exactly these two bytes after clamping. Some enemy
     * records select the Union Level clamp, so use our validated 1..99 target
     * directly rather than letting that story cap undo the requested offset. */
    c[0x114] = c[0x4a] = (uint8_t)target;
    if (el_refresh_ranks)
        el_refresh_ranks(c);
    ((void (*)(void *))(mm_base + 0x330650))(c);
    const unsigned new_hp = el_u16(u + 0x266), new_mp = el_u16(u + 0x268);
    unsigned scaled_hp = max_hp ? (unsigned)(((uint64_t)hp * new_hp) / max_hp) : hp;
    unsigned scaled_mp = max_mp ? (unsigned)(((uint64_t)mp * new_mp) / max_mp) : mp;
    if (hp && new_hp && !scaled_hp) scaled_hp = 1;
    el_put16(u + 0x148, scaled_hp > new_hp ? new_hp : scaled_hp);
    el_put16(u + 0x14a, scaled_mp > new_mp ? new_mp : scaled_mp);
    static unsigned logged;
    if (logged++ < 300) {
        char line[180];
        snprintf(line, sizeof line,
            "Enemy levels: unit %u, level %d -> %u (effective %u), target %d, HP %u/%u.\r\n",
            u[0x2fc], old, c[0x114], c[0x4a], target, el_u16(u + 0x148), new_hp);
        mm_log(line);
    }
}
static void el_apply(int lock) {
    if (!el_enabled) return;
    uint8_t *units = el_battle_units();
    if (!units) return;
    const int first_combat_tick = lock && !el_locked;
    if (!el_locked) {
        const int highest = el_highest(units);
        if (!highest) return;
        int n = highest + el_offset;
        el_target = n < 1 ? 1 : n > 99 ? 99 : n;
        if (lock) {
            el_locked = 1;
            char line[120];
            snprintf(line, sizeof line, "Enemy levels: combat reference locked at %d, offset +%d, target %d.\r\n",
                highest, el_offset, el_target);
            mm_log(line);
        }
    }
    const unsigned count = battle_capacity_unit_count();
    for (unsigned i = 0; i < count; ++i) {
        uint8_t *u = units + i * 0x7d0;
        if (u[0x10] && u[0x188] == 2) {
            el_adjust(u, el_target);
            if (first_combat_tick && el_finish_loadout)
                el_finish_loadout(u, 1);
        }
    }
}
static uintptr_t el_frame(void *state) {
    el_apply(0);
    return ((uintptr_t (*)(void *))(mm_base + 0x3b8410))(state);
}
static uintptr_t el_setup(void *stage, void *battle, void *random,
                          void *base_level, void *names) {
    el_locked = el_target = 0;
    return ((uintptr_t (*)(void *, void *, void *, void *, void *))(mm_base + 0x2f07b0))
        (stage, battle, random, base_level, names);
}
static void el_tick(uint8_t *state, int elapsed, uint8_t *unit, void *random, unsigned mode) {
    el_apply(1);
    el_tick_native(state, elapsed, unit, random, mode);
}
/* The native derived-stat routine separately clamps effective level to 50.
 * Override only the effective-level argument for above-50 enemies. No global
 * caps or player limits are changed. Other stat inputs retain native values. */
static uintptr_t el_derived(void *out, void *stats, uint8_t *character,
                             int bonus_a, int bonus_b, uint16_t race,
                             uint16_t original, uint16_t effective) {
    if (el_enabled && character && character[0x50] == 2 &&
        character[0x4a] > 50 && character[0x4a] <= 99) {
        int n = character[0x4a] + (int8_t)character[0x115];
        effective = (uint16_t)(n < 1 ? 1 : n > 99 ? 99 : n);
    }
    return ((uintptr_t (*)(void *, void *, void *, int, int, uint16_t, uint16_t, uint16_t))
        (mm_base + 0x352f00))(out, stats, character, bonus_a, bonus_b, race, original, effective);
}
static void mm_install_enemy_levels(const wchar_t *config) {
    if (!GetPrivateProfileIntW(L"EnemyLevels", L"Enabled", 0, config)) return;
    unsigned offset = GetPrivateProfileIntW(L"EnemyLevels", L"Offset", 1, config);
    if (offset > 49) { mm_log("Enemy levels: offset must be 0..49.\r\n"); return; }
    const struct { unsigned rva; uint8_t bytes[8]; } helpers[] = {
        {0x351710,{0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x74}},
        {0x353d60,{0x48,0x89,0x5c,0x24,0x08,0x57,0x48,0x83}},
        {0x353770,{0x8b,0x01,0x48,0x83,0xc2,0x2a,0x41,0x89}},
        {0x330650,{0x48,0x89,0x5c,0x24,0x10,0x48,0x89,0x6c}},
        {0x352f00,{0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x6c}},
    };
    for (unsigned i = 0; i < sizeof helpers / sizeof helpers[0]; ++i) {
        if (memcmp(mm_base + helpers[i].rva, helpers[i].bytes, 8)) {
            mm_log("Enemy levels: native stat helper differs.\r\n"); return;
        }
    }
    const unsigned rvas[] = {0x2ee8a7, 0x2ee16c, 0x34464b, 0x330821};
    unsigned char originals[4][5];
    const unsigned char expected[4][5] = {{0xe8,0x04,0x1f,0x00,0x00},
        {0xe8,0x9f,0xa2,0x0c,0x00},
        {0xe8,0x40,0xee,0x04,0x00},
        {0xe8,0xda,0x26,0x02,0x00}};
    void *hooks[] = {(void *)el_setup, (void *)el_frame, (void *)el_tick, (void *)el_derived};
    for (unsigned i = 0; i < 4; ++i) memcpy(originals[i], mm_base + rvas[i], 5);
    for (unsigned i = 0; i < 2; ++i) {
        if (memcmp(originals[i], expected[i], 5)) {
            mm_log("Enemy levels: setup/frame fingerprint differs.\r\n"); return;
        }
    }
    if (memcmp(originals[3], expected[3], 5)) {
        mm_log("Enemy levels: derived-stat call differs.\r\n"); return;
    }
    el_tick_native = (void *)(mm_base + 0x393490);
    if (memcmp(originals[2], expected[2], 5)) {
        int32_t disp; memcpy(&disp, originals[2] + 1, 4);
        const uint8_t *relay = mm_base + rvas[2] + 5 + disp;
        void *to = NULL;
        if (originals[2][0] == 0xe8 && mm_readable(relay, 14) &&
            !memcmp(relay, "\xff\x25\0\0\0\0", 6)) memcpy(&to, relay + 6, 8);
        if (to != (void *)starting_status_tick) {
            mm_log("Enemy levels: unrecognized status tick hook.\r\n"); return;
        }
        el_tick_native = (void *)starting_status_tick;
    }
    unsigned char *relay = mm_near_page();
    if (!relay) return;
    for (unsigned i = 0; i < 4; ++i) mm_abs_jump(relay + 16 * i, hooks[i]);
    FlushInstructionCache(GetCurrentProcess(), relay, 64);
    for (unsigned i = 0; i < 4; ++i) {
        unsigned char patch[5] = {0xe8};
        int32_t disp = (int32_t)((intptr_t)(relay + 16 * i) - (intptr_t)(mm_base + rvas[i] + 5));
        memcpy(patch + 1, &disp, 4);
        if (!mm_write(mm_base + rvas[i], patch, 5)) {
            for (unsigned j = 0; j <= i; ++j) mm_write(mm_base + rvas[j], originals[j], 5);
            mm_log("Enemy levels: installation failed; restoration attempted.\r\n"); return;
        }
    }
    el_offset = (int)offset;
    el_enabled = 1;
    mm_log("Enemy levels: highest deployed player level plus offset; native stats; maximum 99.\r\n");
}

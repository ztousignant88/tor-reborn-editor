/* The project can contain 39 custom events alongside two built-in fights. */
static uint16_t world_battle_stages[41];
static uint16_t world_battle_clear_flags[41];
/* The two built-ins and 41 custom site IDs have distinct saved flags. */
enum { WORLD_CLEAR_FIRST = 3731, WORLD_CLEAR_COUNT = 43, WORLD_CLEAR_BIT = 4096 - WORLD_CLEAR_COUNT };
#include "world_map_routes.c"

static unsigned world_battle_u16(const uint8_t *row, unsigned offset) {
    uint16_t field;
    memcpy(&field, row + offset, sizeof field);
    return field;
}

static void world_battle_complete(unsigned stage) {
    for (unsigned i = 0; i < sizeof world_battle_stages / sizeof world_battle_stages[0]; ++i) {
        unsigned flag = world_battle_clear_flags[i];
        if (!flag || stage != world_battle_stages[i])
            continue;
        /* Verify the loaded flag table before writing to the native campaign state. */
        const uint8_t *table;
        memcpy(&table, mm_base + 0xd68150, sizeof table);
        if (!table || world_battle_u16(table, 4) <= flag || world_battle_u16(table, 12) != 4)
            return;
        unsigned definition = ((WORLD_CLEAR_BIT + flag - WORLD_CLEAR_FIRST) << 4) | 1;
        unsigned offset = world_battle_u16(table, 8) + flag * 4;
        if (world_battle_u16(table, offset) != definition || world_battle_u16(table, offset + 2))
            return;
        typedef unsigned (*GetGlobalFlag)(const void *, unsigned);
        typedef void (*SetGlobalFlag)(void *, unsigned, unsigned);
        uint8_t *campaign = mm_base + 0xd520a0;
        if (!((GetGlobalFlag)(mm_base + 0x2cdbd0))(campaign, flag)) {
            ((SetGlobalFlag)(mm_base + 0x2cf2a0))(campaign, flag, 1);
            mm_log("World map battles: one-time victory recorded.\r\n");
        }
        return;
    }
}

/* The turn job and per-frame update make this call with 0 after enemies are
 * defeated and the player is still standing. The special defeat route passes 1.
 * Retreat uses separate callers. Victory text can be skipped on these stages. */
static void world_battle_result(uint8_t defeated) {
    if (!defeated)
        world_battle_complete(world_battle_u16(mm_base, 0xd525e8));
    typedef void (*FinishBattle)(uint8_t);
    ((FinishBattle)(mm_base + 0x2d1530))(defeated);
}

static void world_battle_select(unsigned invocation) {
    typedef const uint8_t *(*FindProgression)(void *, unsigned, int *);
    FindProgression lookup = (void *)(mm_base + 0x3565f0);
    const uint8_t *row = lookup(mm_base + 0xd5c670, invocation, NULL);
    if (row && invocation) {
        const unsigned scene = world_battle_u16(row, 0);
        /* An opening scene can put the stage on a later row in the chain. */
        for (unsigned step = 0; step < 4 && row && world_battle_u16(row, 0) == scene; ++step) {
            const unsigned stage = world_battle_u16(row, 0x10);
            if (stage) {
                for (unsigned i = 0; i < sizeof world_battle_stages / sizeof world_battle_stages[0]; ++i) {
                    if (stage != world_battle_stages[i])
                        continue;
                    uint8_t *last = mm_base + 0xd52634;  /* Last scene and invocation. */
                    if (world_battle_u16(last, 0) == scene || world_battle_u16(last, 2) == invocation)
                        memset(last, 0, 4);
                    break;
                }
                break;
            }
            unsigned next = world_battle_u16(row, 0x0a);
            if (!next)
                break;
            row = lookup(mm_base + 0xd5c670, next, NULL);
        }
    }
    ((void (*)(unsigned))(mm_base + 0x2d1900))(invocation);
}

static void mm_install_world_map_battles(const wchar_t *config) {
    int enabled = 0, one_time = 0;
    for (unsigned i = 0; i < sizeof world_battle_stages / sizeof world_battle_stages[0]; ++i) {
        wchar_t key[] = L"Stage00";
        const unsigned number = i + 1;
        if (number < 10) {
            key[5] = (wchar_t)(L'0' + number);
            key[6] = 0;
        } else {
            key[5] = (wchar_t)(L'0' + number / 10);
            key[6] = (wchar_t)(L'0' + number % 10);
        }
        unsigned stage = GetPrivateProfileIntW(L"WorldMapBattles", key, 0, config);
        if (stage > UINT16_MAX)
            return;
        world_battle_stages[i] = (uint16_t)stage;
        enabled |= stage != 0;
        wchar_t clear_key[] = L"ClearFlag00";
        memcpy(clear_key + 9, key + 5, 3 * sizeof(wchar_t));
        unsigned flag = GetPrivateProfileIntW(L"WorldMapBattles", clear_key, 0, config);
        if (flag && (!stage || flag < WORLD_CLEAR_FIRST || flag >= WORLD_CLEAR_FIRST + WORLD_CLEAR_COUNT))
            return;
        world_battle_clear_flags[i] = (uint16_t)flag;
        one_time |= flag != 0;
    }
    if (!enabled)
        return;

    /* Both world-map entry routes select a fresh invocation. The normal
       cutscene and combat progression calls retain their duplicate guard. */
    static const struct { unsigned address; uint8_t original[5]; void *destination; } sites[] = {
        {0x3552f3, {0xe8, 0x08, 0xc6, 0xf7, 0xff}, (void *)world_battle_select},
        {0x355764, {0xe8, 0x97, 0xc1, 0xf7, 0xff}, (void *)world_battle_select},
        {0x31941f, {0xe8, 0x9c, 0xb1, 0x11, 0x00}, (void *)world_route_rebuild},
        {0x319a75, {0xe8, 0x46, 0xab, 0x11, 0x00}, (void *)world_route_rebuild},
        {0x4393ee, {0xe8, 0xcd, 0xb9, 0xff, 0xff}, (void *)world_route_query},
        {0x36ce9d, {0xe8, 0x8e, 0x46, 0xf6, 0xff}, (void *)world_battle_result},
        {0x36842a, {0xe8, 0x01, 0x91, 0xf6, 0xff}, (void *)world_battle_result},
    };
    const int expanded = GetPrivateProfileIntW(L"WorldMapBattles", L"ExpandedRoutes", 0, config);
    unsigned indices[] = {0, 1, 2, 3, 4, 5, 6};
    unsigned count = expanded ? 5 : 2;
    if (one_time) {
        indices[count++] = 5;
        indices[count++] = 6;
    }
    for (unsigned i = 0; i < count; ++i) {
        const unsigned index = indices[i];
        if (memcmp(mm_base + sites[index].address, sites[index].original, 5)) {
            mm_log("World map battles: native selection calls differ.\r\n");
            return;
        }
    }
    uint8_t *relay = mm_near_page();
    if (!relay) {
        mm_log("World map battles: could not allocate the selection hook.\r\n");
        return;
    }
    for (unsigned i = 0; i < count; ++i)
        mm_abs_jump(relay + 16 * i, sites[indices[i]].destination);
    FlushInstructionCache(GetCurrentProcess(), relay, 16 * count);
    for (unsigned i = 0; i < count; ++i) {
        uint8_t *site = mm_base + sites[indices[i]].address;
        uint8_t patch[5] = {0xe8};
        int32_t relative = (int32_t)((intptr_t)(relay + 16 * i) - (intptr_t)(site + 5));
        memcpy(patch + 1, &relative, sizeof relative);
        if (!mm_write(site, patch, sizeof patch)) {
            for (unsigned j = 0; j <= i; ++j)
                mm_write(mm_base + sites[indices[j]].address, sites[indices[j]].original, 5);
            mm_log("World map battles: selection hook could not be installed.\r\n");
            return;
        }
    }
    mm_log(one_time ? "World map battles: one-time battle tracking installed.\r\n" :
                       "World map battles: repeat entry enabled for the project's encounters.\r\n");
}

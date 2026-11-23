/* The project can contain 39 custom events alongside two built-in fights. */
static uint16_t world_battle_stages[41];
#include "world_map_routes.c"

static unsigned world_battle_u16(const uint8_t *row, unsigned offset) {
    uint16_t field;
    memcpy(&field, row + offset, sizeof field);
    return field;
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
    int enabled = 0;
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
    };
    const int expanded = GetPrivateProfileIntW(L"WorldMapBattles", L"ExpandedRoutes", 0, config);
    const unsigned count = expanded ? sizeof sites / sizeof sites[0] : 2;
    for (unsigned i = 0; i < count; ++i) {
        if (memcmp(mm_base + sites[i].address, sites[i].original, 5)) {
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
        mm_abs_jump(relay + 16 * i, sites[i].destination);
    FlushInstructionCache(GetCurrentProcess(), relay, 16 * count);
    for (unsigned i = 0; i < count; ++i) {
        uint8_t *site = mm_base + sites[i].address;
        uint8_t patch[5] = {0xe8};
        int32_t relative = (int32_t)((intptr_t)(relay + 16 * i) - (intptr_t)(site + 5));
        memcpy(patch + 1, &relative, sizeof relative);
        if (!mm_write(site, patch, sizeof patch)) {
            for (unsigned j = 0; j <= i; ++j)
                mm_write(mm_base + sites[j].address, sites[j].original, 5);
            mm_log("World map battles: selection hook could not be installed.\r\n");
            return;
        }
    }
    mm_log("World map battles: repeat entry enabled for the project's encounters.\r\n");
}

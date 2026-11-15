/* Included by the isolated Menu Mods runtime. */
#include <stddef.h>

enum { BOW_CATEGORY = 18, WEAPON_ACTION = 2, ENEMY_TEAM = 2, PLAYER_TEAM = 1 };
enum { UNIT_COUNT = 30, UNIT_STRIDE = 0x7d0, TILE_CAPACITY = 1024 };

typedef struct {
    void *battle;
    uint32_t reserved;
    uint32_t count;
    uint32_t tiles[TILE_CAPACITY];
} ArcherTiles;

typedef struct {
    uint8_t valid;
    uint8_t padding[7];
    void *unit;
    uint32_t tile;
    uint32_t reserved;
} ArcherImpact;

_Static_assert(offsetof(ArcherTiles, tiles) == 0x10, "candidate buffer layout");
_Static_assert(offsetof(ArcherImpact, tile) == 0x10, "trajectory result layout");

static void archer_candidates(ArcherTiles *list, const uint8_t *action,
                              uint32_t origin, const uint8_t *actor) {
    ((void (*)(ArcherTiles *, const uint8_t *, uint32_t, const uint8_t *))
        (mm_base + 0x3ccba0))(list, action, origin, actor);

    if (!actor || actor[0x188] != ENEMY_TEAM || action[0] != WEAPON_ACTION)
        return;

    uint16_t item;
    memcpy(&item, action + 2, sizeof item);
    if (!item || item >= 761)
        return;
    void *manager = ((void *(*)(void))(mm_base + 0x2e5030))();
    const uint8_t *row = ((const uint8_t *(*)(void *, uint16_t))
        (mm_base + 0x2e4bc0))(manager, item);
    if (!mm_readable(row, 3) || row[2] != BOW_CATEGORY)
        return;

    uint8_t range[8] = {0};
    ((void *(*)(const uint8_t *, uint8_t *, const uint8_t *))
        (mm_base + 0x33e9b0))(actor, range, action);
    const unsigned maximum = range[1];
    const unsigned x = origin & 0xffff, y = origin >> 16;
    if (!maximum || x >= 32 || y >= 32 || list->count >= TILE_CAPACITY)
        return;
    if (!mm_readable(list->battle, 0x1b50))
        return;

    const uint8_t *units;
    memcpy(&units, (const uint8_t *)list->battle + 0x1b48, sizeof units);
    if (!mm_readable(units, UNIT_COUNT * UNIT_STRIDE))
        return;
    int (*height)(unsigned, unsigned) = (void *)(mm_base + 0x2da280);
    const int origin_height = height(x, y);
    _Alignas(16) uint8_t trajectory[0x110];
    int initialized = 0;

    for (unsigned slot = 0; slot < UNIT_COUNT && list->count < TILE_CAPACITY; ++slot) {
        const uint8_t *target = units + slot * UNIT_STRIDE;
        if (!target[0x10] || target[0x142] || target[0x188] != PLAYER_TEAM)
            continue;
        uint32_t tile;
        memcpy(&tile, target + 0x14, sizeof tile);
        const unsigned tx = tile & 0xffff, ty = tile >> 16;
        const unsigned distance = (x > tx ? x - tx : tx - x) +
                                  (y > ty ? y - ty : ty - y);
        if (tx >= 32 || ty >= 32 || distance <= maximum || height(tx, ty) >= origin_height)
            continue;
        unsigned index = 0;
        while (index < list->count && list->tiles[index] != tile)
            ++index;
        if (index < list->count)
            continue;
        if (!initialized) {
            ((void *(*)(void *, void *, const uint8_t *, uint32_t, const uint8_t *))
                (mm_base + 0x470790))(trajectory, list->battle, actor, origin, action);
            initialized = 1;
        }
        ArcherImpact hit = {0};
        ((void *(*)(void *, ArcherImpact *, uint32_t))
            (mm_base + 0x470d40))(trajectory, &hit, tile);
        if (!hit.valid || !hit.unit || hit.tile != tile)
            continue;
        list->tiles[list->count++] = tile;
        static volatile LONG logged;
        if (InterlockedIncrement(&logged) <= 100) {
            char message[160];
            snprintf(message, sizeof message,
                "Hard Mode: bow %u from (%u,%u) can reach (%u,%u), distance %u, effective max %u.\r\n",
                item, x, y, tx, ty, distance, maximum);
            mm_log(message);
        }
    }
}

static void mm_install_archer_range(void) {
    unsigned char *site = mm_base + 0x2f4fb6;
    const unsigned char original[] = {0xe8, 0xe5, 0x7b, 0x0d, 0x00};
    if (memcmp(site, original, sizeof original)) {
        mm_log("Hard Mode: bow range disabled because the AI call differs.\r\n");
        return;
    }
    unsigned char *relay = mm_near_page();
    if (!relay)
        return;
    mm_abs_jump(relay, (void *)archer_candidates);
    FlushInstructionCache(GetCurrentProcess(), relay, 14);
    unsigned char patch[5] = {0xe8};
    const int32_t displacement = (int32_t)((intptr_t)relay - (intptr_t)(site + 5));
    memcpy(patch + 1, &displacement, sizeof displacement);
    if (!mm_write(site, patch, sizeof patch)) {
        mm_write(site, original, sizeof original);
        mm_log("Hard Mode: bow range installation failed.\r\n");
        return;
    }
    mm_log("Hard Mode: enemy downhill bow range enabled.\r\n");
}

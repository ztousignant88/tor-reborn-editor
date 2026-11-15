#define PSP_SHARED_RUNTIME
/* Restored PSP status behavior. No persistent custom save fields. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

enum {
    CHARMED = 5, BEWITCHED = 6, SPENDTHRIFT = 7, PARANOIA = 8,
    POISONED = 15, ENVENOMED = 16, SPENDTHRIFT_GOTH_LOSS = 100,
    AUTO_CONTROL = 0x33f710, TURN_METHOD = 0x3b0480,
    TURN_VTABLE_SLOT = 0x6938c0, EFFECT = 0x44b690,
    STATUS_TABLE = 0xd78ea8, BATTLE_MANAGER = 0xd7b6c0,
    OBJECT_BY_ID = 0x35ecc0, TOAST_OPEN = 0x2fa710,
    PLAN_TURN_CALL = 0x2f3eea, PLAN_TURN = 0x2f5370,
    BUILD_REACHABLE = 0x2f3f50, PICK_FACING = 0x2f51b0,
    SIMULATE_MOVE = 0x2f4690, QUEUE_MOVE = 0x3bf960, QUEUE_WAIT = 0x3bf990,
    PERIODIC_POISON_CHECK = 0x3906fc, PERIODIC_DAMAGE = 0x390719,
    PERIODIC_FINISH = 0x3907ad, ADJUST_LOYALTY = 0x32c640,
    CHARMED_COUNT_MASK = 0x372078, CHARM_STATUS_LIST = 0x6911c0,
    UNIT_HAS_STATUS = 0x33fc00
};

// Each pair is the RIP-relative address of the first entry and the end.
static const unsigned charm_list_sites[][2] = {
    {0x33f744, 0x33f74b}, {0x33f7f0, 0x33f7f7}, {0x38f8bc, 0x38f8c6}
};

// AI profile, approach and attack targets, team relation, and assist checks.
// Only these Charm checks share Bewitched; other callers can test either ID.
static const unsigned charm_target_sites[] = {
    0x2f3560, 0x2f3b23, 0x2f40ed, 0x3c1a35, 0x453c76
};

// Rouges Reborn owns a hook at the dispatcher entry. Route only the native
// callers through the status filter, then call through the shared entry.
static const unsigned effect_call_sites[] = {0x44da5a, 0x44dcbb, 0x44de0a, 0x44e2bf};

typedef uint8_t (*AutoControl)(const uint8_t *);
typedef uint8_t (*TurnMethod)(const uint8_t *);
typedef uint8_t (*EffectMethod)(uint8_t *, const uint8_t *, void *, const uint8_t *, void *, void *, uint16_t);
typedef uint8_t *(*FindObject)(const uint8_t *, int);
typedef uint8_t (*IsUnit)(const uint8_t *);
static uint8_t *image;
#ifdef PSP_SHARED_RUNTIME
static void (*shared_log)(const char *);
#else
static wchar_t log_path[MAX_PATH];
#endif
static AutoControl original_auto;
static TurnMethod original_turn;
static EffectMethod original_effect;

typedef struct {
    char *text;
    uint32_t duration;
    uint16_t style;
    uint8_t zero, flag, replace;
} ToastArgs;

static void show_loss(uint32_t lost) {
    if (!lost) return;
    static char message[40];
    static ToastArgs toast = {message, 180, 0x100, 0, 1, 0};
    snprintf(message, sizeof message, "Lost %u Goth.", lost);
    ((void (*)(ToastArgs *, int))(image + TOAST_OPEN))(&toast, 0);
}

static uint16_t word(const uint8_t *p) {
    uint16_t value;
    memcpy(&value, p, sizeof value);
    return value;
}

static uint32_t dword(const uint8_t *p) {
    uint32_t value;
    memcpy(&value, p, sizeof value);
    return value;
}

static uint8_t *pointer(const uint8_t *p) {
    uint8_t *value;
    memcpy(&value, p, sizeof value);
    return value;
}

static void log_line(const char *message) {
#ifdef PSP_SHARED_RUNTIME
    shared_log(message);
#else
    if (!log_path[0]) return;
    HANDLE log = CreateFileW(log_path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                             NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (log != INVALID_HANDLE_VALUE) {
        DWORD written;
        WriteFile(log, message, (DWORD)strlen(message), &written, NULL);
        CloseHandle(log);
    }
#endif
}

static const uint8_t *status_row(unsigned id) {
    const uint8_t *table = pointer(image + STATUS_TABLE);
    if (!table || id >= dword(table + 4) || dword(table + 12) != 126) return NULL;
    return table + dword(table + 8) + id * 126;
}

static int has_status(const uint8_t *unit, unsigned id) {
    return unit && (unit[0x1a8 + id / 8] & (1u << (id % 8)));
}

static uint8_t charm_targeting(const uint8_t *unit, uint16_t id) {
    typedef uint8_t (*QueryStatus)(const uint8_t *, uint16_t);
    const QueryStatus query = (QueryStatus)(image + UNIT_HAS_STATUS);
    if (id == CHARMED && query(unit, BEWITCHED)) return 1;
    return query(unit, id);
}

static int active_on_turn(const uint8_t *unit, unsigned id) {
    if (!has_status(unit, id)) return 0;
    const uint8_t *row = status_row(id);
    // Use the same pre-turn countdown rule as Charm.
    return row && row[0] == 1 && row[1] < 20 && unit[0x1b4 + row[1]] > 1;
}

static uint8_t auto_control(const uint8_t *unit) {
    if (active_on_turn(unit, SPENDTHRIFT) || active_on_turn(unit, PARANOIA)) return 1;
    return original_auto(unit);
}

static uint8_t *live_battle(void) {
    const uint8_t *manager = image + BATTLE_MANAGER;
    return manager[0] ? pointer(manager + 0x1b0) : NULL;
}

static int live_actor(const uint8_t *battle, const uint8_t *unit) {
    if (!battle || !unit || pointer(unit + 0x728) != battle) return 0;
    unsigned slot = unit[0x2fc];
    const uint8_t *units = pointer(battle + 0x1b48);
    return units && slot < 30 && units + slot * 0x7d0 == unit && word(unit + 0x148) != 0;
}

static uint8_t status_turn(const uint8_t *job) {
    const uint8_t *unit = pointer(job + 0x10);
    uint8_t *battle = live_battle();
    uint32_t lost = 0;
    if (live_actor(battle, unit) && unit[0x188] == 1 && active_on_turn(unit, SPENDTHRIFT)) {
        // This wallet is part of the native battle snapshot.  The earnings
        // counter tracks loot and remains intact when spending party funds.
        uint8_t *wallet = pointer(battle + 0x1b68);
        if (wallet) {
            const uint32_t before = dword(wallet + 0x14);
            lost = before < SPENDTHRIFT_GOTH_LOSS ? before : SPENDTHRIFT_GOTH_LOSS;
            const uint32_t after = before - lost;
            memcpy(wallet + 0x14, &after, sizeof after);
            char line[128];
            snprintf(line, sizeof line, "Spendthrift: unit %u lost %u Goth (%u -> %u).\r\n",
                     unit[0x2fc], lost, before, after);
            log_line(line);
        }
    }
    uint8_t result = original_turn(job);
    show_loss(lost);
    return result;
}

static unsigned tile_distance(uint32_t a, uint32_t b) {
    int dx = (int)(a & 0xffff) - (int)(b & 0xffff);
    int dy = (int)(a >> 16) - (int)(b >> 16);
    return (unsigned)((dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy));
}

typedef struct {
    uint32_t tiles[30];
    unsigned count;
} TileGroup;

static unsigned nearest(uint32_t tile, const TileGroup *allies) {
    unsigned distance = UINT32_MAX;
    for (unsigned i = 0; i < allies->count; ++i) {
        unsigned next = tile_distance(tile, allies->tiles[i]);
        if (next < distance) distance = next;
    }
    return distance;
}

static uint32_t retreat_tile(uint32_t origin, const uint8_t *options, unsigned count,
                             const TileGroup *allies, const TileGroup *occupied) {
    uint32_t best = origin;
    if (!allies->count || count > 1024) return best;
    unsigned separation = nearest(origin, allies);
    for (unsigned i = 0; i < count; ++i) {
        uint32_t tile = dword(options + i * sizeof tile);
        if ((tile & 0x80008000u) || nearest(tile, occupied) == 0) continue;
        unsigned distance = nearest(tile, allies);
        if (distance > separation) {
            separation = distance;
            best = tile;
        }
    }
    return best;
}

static void plan_turn(uint8_t *workspace, uint8_t *command, void *script, unsigned flags) {
    const uint8_t *actor = pointer(workspace + 0x1cb78);
    if (!has_status(actor, PARANOIA) && !has_status(actor, SPENDTHRIFT)) {
        ((void (*)(void *, void *, void *, unsigned))(image + PLAN_TURN))(workspace, command, script, flags);
        return;
    }
    uint8_t *queue = workspace + 0x1cbe0;
    if (has_status(actor, PARANOIA)) {
        // AI plans against a copy of the battle. Reuse its legal destination
        // list and its normal move encoder. Live unit positions are untouched.
        const uint8_t *battle = pointer(actor + 0x728);
        const uint8_t *units = battle ? pointer(battle + 0x1b48) : NULL;
        TileGroup allies = {0}, occupied = {0};
        for (unsigned i = 0; units && i < 30; ++i) {
            const uint8_t *other = units + i * 0x7d0;
            if (other == actor || !live_actor(battle, other)) continue;
            uint32_t tile = dword(other + 0x14);
            occupied.tiles[occupied.count++] = tile;
            if (other[0x188] == actor[0x188]) allies.tiles[allies.count++] = tile;
        }
        ((void (*)(void *, int))(image + BUILD_REACHABLE))(workspace, -1);
        const uint8_t *options = workspace + 0x22dcc;
        const uint32_t origin = dword(actor + 0x14);
        const uint32_t tile = retreat_tile(origin, options, dword(options + 0x1000), &allies, &occupied);
        if (tile != origin) {
            memset(command + 0x16, 0, 8);
            command[0x16] = 1;
            memcpy(command + 0x1e, &tile, sizeof tile);
            unsigned facing = ((unsigned (*)(void *, uint32_t))(image + PICK_FACING))(workspace, tile);
            ((uint8_t (*)(void *, void *))(image + SIMULATE_MOVE))(workspace, command);
            if (command[0x14]) {
                ((void (*)(void *, uint32_t, unsigned))(image + QUEUE_MOVE))(queue, tile, facing);
                char line[128];
                snprintf(line, sizeof line, "Paranoia: unit %u retreats from (%u,%u) to (%u,%u).\r\n",
                         actor[0x2fc], origin & 0xffff, origin >> 16, tile & 0xffff, tile >> 16);
                log_line(line);
                return;
            }
        }
    }
    ((void (*)(void *, unsigned))(image + QUEUE_WAIT))(queue, actor[0x30]);
}

static int is_aid(const uint8_t *sub) {
    switch (sub[0]) {
    case 2:  // HP recovery
    case 5:  // MP gain
    case 13: // take next turn
    case 24: // Ease
    case 25: // Ease All
    case 51: // Revive
    case 72: // Velocity Shift
    case 75: // Revive at next turn
        return 1;
    case 18: // Apply a beneficial status.
    case 19: { // Remove a harmful status.
        const unsigned id = word(sub + 2);
        const uint8_t *row = status_row(id);
        // Awaken II explicitly treats Paranoia. General healing still fails.
        return row && (sub[0] == 18 ? id >= 23 && row[0x0b] == 0 : id != PARANOIA && row[0x0b] != 0);
    }
    default:
        return 0;
    }
}

static int same_side_aid(const uint8_t *source, const uint8_t *target) {
    return source && target && source != target &&
           source[0x188] == target[0x188] && has_status(target, PARANOIA);
}

static const uint8_t *unit_by_id(const uint8_t *battle, uint16_t id) {
    if (!battle || id >= 0x8000) return NULL;
    const uint8_t *obj = ((FindObject)(image + OBJECT_BY_ID))(battle, id);
    const uint8_t *vtable = obj ? pointer(obj) : NULL;
    return vtable && ((IsUnit)pointer(vtable + 0x20))(obj) ? obj : NULL;
}

static uint8_t effect(uint8_t *out, const uint8_t *sub, void *context, const uint8_t *battle_context,
                      void *values, void *work, uint16_t delay) {
    if (out && sub && sub[0] == 18 && word(out) == word(out + 2)) {
        unsigned status = word(sub + 2);
        if (status == SPENDTHRIFT || status == PARANOIA) return 0;
    }
    if (out && sub && battle_context && is_aid(sub)) {
        const uint8_t *battle = pointer(battle_context);
        const uint8_t *target = unit_by_id(battle, word(out + 2));
        if (has_status(target, PARANOIA) && same_side_aid(unit_by_id(battle, word(out)), target))
            return 0; // Same return as the native empty-operation path.
    }
    return original_effect(out, sub, context, battle_context, values, work, delay);
}

static int patch(void *where, const void *data, size_t size) {
    DWORD prior;
    if (!VirtualProtect(where, size, PAGE_EXECUTE_READWRITE, &prior)) return 0;
    memcpy(where, data, size);
    FlushInstructionCache(GetCurrentProcess(), where, size);
    VirtualProtect(where, size, prior, &prior);
    return 1;
}

static void absolute_jump(uint8_t *slot, const void *target) {
    memcpy(slot, "\xff\x25\0\0\0\0", 6);
    memcpy(slot + 6, &target, sizeof target);
}

static uint8_t *near_page(void) {
    SYSTEM_INFO info;
    GetSystemInfo(&info);
    const uintptr_t granularity = info.dwAllocationGranularity;
    const uintptr_t base = (uintptr_t)image & ~(granularity - 1);
    for (uintptr_t offset = granularity; offset < 0x70000000; offset += granularity) {
        uint8_t *page = VirtualAlloc((void *)(base + offset), 4096, MEM_COMMIT | MEM_RESERVE,
                                     PAGE_EXECUTE_READWRITE);
        if (page) return page;
        if (base > offset) {
            page = VirtualAlloc((void *)(base - offset), 4096, MEM_COMMIT | MEM_RESERVE,
                                PAGE_EXECUTE_READWRITE);
            if (page) return page;
        }
    }
    return NULL;
}

static void relay_code(uint8_t *entry, const uint8_t *relay, unsigned length, uint8_t *bytes) {
    const int32_t delta = (int32_t)((uintptr_t)relay - ((uintptr_t)entry + 5));
    memset(bytes, 0x90, length);
    bytes[0] = 0xe9;
    memcpy(bytes + 1, &delta, 4);
}

typedef struct {
    uint8_t *where;
    size_t size;
    uint8_t before[8], after[8];
} HookWrite;

static void hook_write(HookWrite *write, uint8_t *where, const void *after, size_t size) {
    write->where = where;
    write->size = size;
    memcpy(write->before, where, size);
    memcpy(write->after, after, size);
}

static int32_t displacement(const uint8_t *target, const uint8_t *next) {
    return (int32_t)((intptr_t)target - (intptr_t)next);
}

static int verify_calls(const unsigned *sites, size_t count, unsigned target) {
    for (size_t i = 0; i < count; ++i) {
        const uint8_t *call = image + sites[i];
        const int32_t original = displacement(image + target, call + 5);
        if (*call != 0xe8 || memcmp(call + 1, &original, sizeof original)) return 0;
    }
    return 1;
}

static void route_calls(HookWrite *writes, const unsigned *sites, size_t count, const uint8_t *target) {
    for (size_t i = 0; i < count; ++i) {
        uint8_t *call = image + sites[i];
        const int32_t updated = displacement(target, call + 5);
        hook_write(&writes[i], call + 1, &updated, sizeof updated);
    }
}

static void periodic_relay(uint8_t *relay) {
    // Keep the status ID and its own data row. Either poison uses the native
    // periodic damage path, including its HP update and battle feedback.
    const uint8_t checks[] = {0x66, 0x83, 0xfb, BEWITCHED, 0x74, 40,
                              0x66, 0x83, 0xfb, POISONED, 0x74, 6,
                              0x66, 0x83, 0xfb, ENVENOMED, 0x75, 14};
    memcpy(relay, checks, sizeof checks);
    absolute_jump(relay + sizeof checks, image + PERIODIC_DAMAGE);
    absolute_jump(relay + sizeof checks + 14, image + PERIODIC_POISON_CHECK + 6);
    uint8_t *loyalty = relay + sizeof checks + 28;
    // RSI is the battle unit and R10 is its status row. Reuse the game’s
    // bounded loyalty adjustment with the amount from the Bewitched row.
    const uint8_t adjust[] = {0x48, 0x8d, 0x8e, 0x38, 0x01, 0, 0, // lea rcx,[rsi+0x138]
                              0x41, 0x0f, 0xb6, 0x52, 4,         // movzx edx,[r10+4]
                              0xf7, 0xda,                         // neg edx
                              0xe8, 0, 0, 0, 0};                 // call adjust_loyalty
    memcpy(loyalty, adjust, sizeof adjust);
    const int32_t call = displacement(image + ADJUST_LOYALTY, loyalty + sizeof adjust);
    memcpy(loyalty + sizeof adjust - sizeof call, &call, sizeof call);
    absolute_jump(loyalty + sizeof adjust, image + PERIODIC_FINISH);
}

static int install_hooks(void) {
    static const uint8_t auto_original[] = {0x40, 0x53, 0x48, 0x83, 0xec, 0x20};
    static const uint8_t toast_signature[] = {0x40, 0x57, 0x48, 0x83, 0xec, 0x60};
    static const uint8_t poison_original[] = {0x66, 0x83, 0xfb, POISONED, 0x74, 0x17};
    static const uint8_t loyalty_signature[] = {0x0f, 0xb6, 0x41, 0x45, 0x44, 0x0f, 0xbf, 0xc2};
    static const uint8_t mask_original[] = {0xa8, 1 << CHARMED};
    static const uint32_t charm_only[] = {CHARMED};
    static const uint32_t charm_and_bewitch[] = {CHARMED, BEWITCHED};
    uint8_t *auto_entry = image + AUTO_CONTROL;
    uint8_t *turn_slot = image + TURN_VTABLE_SLOT;
    uint8_t *plan_call = image + PLAN_TURN_CALL;
    uint8_t *poison_check = image + PERIODIC_POISON_CHECK;
    uint8_t *count_mask = image + CHARMED_COUNT_MASK;
    if (memcmp(auto_entry, auto_original, sizeof auto_original) ||
        !verify_calls(&((const unsigned){PLAN_TURN_CALL}), 1, PLAN_TURN) ||
        !verify_calls(effect_call_sites, sizeof effect_call_sites / sizeof effect_call_sites[0], EFFECT) ||
        !verify_calls(charm_target_sites, sizeof charm_target_sites / sizeof charm_target_sites[0], UNIT_HAS_STATUS) ||
        memcmp(image + TOAST_OPEN, toast_signature, sizeof toast_signature) ||
        memcmp(poison_check, poison_original, sizeof poison_original) ||
        memcmp(image + ADJUST_LOYALTY, loyalty_signature, sizeof loyalty_signature) ||
        memcmp(count_mask - 1, mask_original, sizeof mask_original) ||
        memcmp(image + CHARM_STATUS_LIST, charm_only, sizeof charm_only) ||
        pointer(turn_slot) != image + TURN_METHOD)
        return 0;
    for (unsigned pair = 0; pair < sizeof charm_list_sites / sizeof charm_list_sites[0]; ++pair) {
        for (unsigned side = 0; side < 2; ++side) {
            const uint8_t *lea = image + charm_list_sites[pair][side];
            const int32_t original = displacement(image + CHARM_STATUS_LIST + side * 4, lea + 7);
            if ((lea[0] != 0x48 && lea[0] != 0x4c) || lea[1] != 0x8d ||
                (lea[2] & 0xc7) != 5 || memcmp(lea + 3, &original, sizeof original)) return 0;
        }
    }
    uint8_t *relay = near_page();
    if (!relay) return 0;
    absolute_jump(relay, auto_control);
    absolute_jump(relay + 16, effect);
    absolute_jump(relay + 96, plan_turn);
    periodic_relay(relay + 112);
    uint8_t *status_list = relay + 192;
    memcpy(status_list, charm_and_bewitch, sizeof charm_and_bewitch);
    uint8_t *target_query = relay + 208;
    absolute_jump(target_query, charm_targeting);
    memcpy(relay + 32, auto_original, sizeof auto_original);
    absolute_jump(relay + 32 + sizeof auto_original, auto_entry + sizeof auto_original);
    FlushInstructionCache(GetCurrentProcess(), relay, 222);
    original_auto = (AutoControl)(relay + 32);
    original_effect = (EffectMethod)(image + EFFECT);
    original_turn = (TurnMethod)pointer(turn_slot);
    uint8_t auto_patch[sizeof auto_original], poison_patch[sizeof poison_original];
    relay_code(auto_entry, relay, sizeof auto_patch, auto_patch);
    relay_code(poison_check, relay + 112, sizeof poison_patch, poison_patch);
    const TurnMethod turn_hook = status_turn;
    const uint8_t bewitched_mask = (1 << CHARMED) | (1 << BEWITCHED);
    const size_t charm_calls = sizeof charm_target_sites / sizeof charm_target_sites[0];
    const size_t effect_calls = sizeof effect_call_sites / sizeof effect_call_sites[0];
    HookWrite writes[5 + 2 * sizeof charm_list_sites / sizeof charm_list_sites[0]
                       + sizeof charm_target_sites / sizeof charm_target_sites[0]
                       + sizeof effect_call_sites / sizeof effect_call_sites[0]];
    hook_write(&writes[0], auto_entry, auto_patch, sizeof auto_patch);
    const int32_t plan_delta = displacement(relay + 96, plan_call + 5);
    hook_write(&writes[1], plan_call + 1, &plan_delta, sizeof plan_delta);
    hook_write(&writes[2], turn_slot, &turn_hook, sizeof turn_hook);
    hook_write(&writes[3], poison_check, poison_patch, sizeof poison_patch);
    hook_write(&writes[4], count_mask, &bewitched_mask, sizeof bewitched_mask);
    size_t count = 5;
    for (unsigned pair = 0; pair < sizeof charm_list_sites / sizeof charm_list_sites[0]; ++pair) {
        for (unsigned side = 0; side < 2; ++side) {
            uint8_t *lea = image + charm_list_sites[pair][side];
            const int32_t updated = displacement(status_list + side * sizeof charm_and_bewitch, lea + 7);
            hook_write(&writes[count++], lea + 3, &updated, sizeof updated);
        }
    }
    route_calls(writes + count, charm_target_sites, charm_calls, target_query);
    count += charm_calls;
    route_calls(writes + count, effect_call_sites, effect_calls, relay + 16);
    count += effect_calls;
    unsigned applied = 0;
    while (applied < count && patch(writes[applied].where, writes[applied].after, writes[applied].size)) ++applied;
    if (applied == count) return 1;
    while (applied) {
        const HookWrite *write = &writes[--applied];
        patch(write->where, write->before, write->size);
    }
    VirtualFree(relay, 0, MEM_RELEASE);
    return 0;
}

#if defined(PSP_SHARED_RUNTIME)
int psp_install_status(unsigned char *base, void (*logger)(const char *)) {
    image = base;
    shared_log = logger;
    return install_hooks();
}
#elif !defined(STATUS_FIXTURE)
static INIT_ONCE init_once = INIT_ONCE_STATIC_INIT;
static HMODULE module;

static BOOL CALLBACK initialize(PINIT_ONCE once, PVOID unused, PVOID *context) {
    (void)once;
    (void)unused;
    (void)context;
    DWORD n = GetModuleFileNameW(module, log_path, MAX_PATH);
    wchar_t *slash = n && n < MAX_PATH ? wcsrchr(log_path, L'\\') : NULL;
    if (!slash || (size_t)(slash - log_path) + 28 >= MAX_PATH) return TRUE;
    wcscpy(slash + 1, L"psp-status-playtest.log");
    image = (uint8_t *)GetModuleHandleW(NULL);
    const IMAGE_DOS_HEADER *dos = (const void *)image;
    if (!image || dos->e_magic != IMAGE_DOS_SIGNATURE) return TRUE;
    const IMAGE_NT_HEADERS64 *nt = (const void *)(image + dos->e_lfanew);
    if (nt->Signature == IMAGE_NT_SIGNATURE && nt->OptionalHeader.SizeOfImage > BATTLE_MANAGER + 0x1b8 &&
        install_hooks()) {
        log_line("PSP status playtest ready.\r\n");
    } else {
        log_line("PSP status playtest inactive: game signatures differ.\r\n");
    }
    return TRUE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        module = instance;
        DisableThreadLibraryCalls(instance);
    }
    return TRUE;
}
#endif

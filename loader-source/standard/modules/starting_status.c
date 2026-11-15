/* Persistent timers are stored in the native condition state, so battle
 * snapshots copy the marker along with the condition itself. */
#include "starting_status_catalog.h"
#define STARTING_STATUS_SLOTS (sizeof starting_status_ids / sizeof starting_status_ids[0])

typedef struct {
    unsigned ids[STARTING_STATUS_SLOTS];
    unsigned count;
    int persistent;
} StartingStatus;

static StartingStatus starting_status[3];
static int starting_status_allow_cure;
static uint8_t (*starting_status_remove_native)(uint8_t *, unsigned, void *);
static uint8_t (*starting_status_apply_native)(uint8_t *, unsigned, int, void *, void *);
static uint8_t (*starting_status_turn_native)(uint8_t *, void *, void *, unsigned);

static const uint8_t *starting_status_row(unsigned id) {
    const uint8_t *table = *(const uint8_t **)(mm_base + 0xd78ea8);
    if (!table || id >= 89) return NULL;
    int32_t offset, stride;
    memcpy(&offset, table + 8, sizeof offset);
    memcpy(&stride, table + 12, sizeof stride);
    return table + offset + id * stride;
}

static int starting_status_active(const uint8_t *state, unsigned id) {
    return (state[id / 8] & (1u << (id % 8))) != 0;
}

static uint8_t *starting_status_timer(uint8_t *state, const uint8_t *row) {
    if (!row) return NULL;
    if (row[0] == 1 && row[1] < 20) return state + 0xc + row[1];
    if (row[0] == 2 && row[1] < 5) return state + 0x20 + row[1] * 2;
    return NULL;
}

static void starting_status_mark(uint8_t *timer, unsigned type) {
    timer[0] = UINT8_MAX;
    if (type == 2) timer[1] = UINT8_MAX;
}

static int starting_status_marked(uint8_t *state, unsigned id, const uint8_t *row) {
    uint8_t *timer = starting_status_timer(state, row);
    return timer && starting_status_active(state, id) &&
           timer[0] == UINT8_MAX && (row[0] == 1 || timer[1] == UINT8_MAX);
}

static int starting_status_protected(uint8_t *state, unsigned id) {
    int configured = 0;
    for (unsigned team = 1; team <= 2; ++team) {
        const StartingStatus *choice = &starting_status[team];
        if (!choice->persistent) continue;
        for (unsigned i = 0; i < choice->count; ++i)
            configured |= choice->ids[i] == id;
    }
    return configured && starting_status_marked(state, id, starting_status_row(id));
}

static uint8_t starting_status_remove(uint8_t *state, unsigned id, void *unit) {
    if (starting_status_protected(state, id)) {
        if (!starting_status_allow_cure) return 0;
        uint8_t removed = starting_status_remove_native(state, id, unit);
        if (removed) {
            const uint8_t *row = starting_status_row(id);
            uint8_t *timer = starting_status_timer(state, row);
            timer[0] = 0;
            if (row[0] == 2) timer[1] = 0;
        }
        return removed;
    }
    return starting_status_remove_native(state, id, unit);
}

static uint8_t starting_status_apply(uint8_t *state, unsigned id, int duration, void *unit, void *source) {
    const uint8_t *row = starting_status_row(id);
    int marked = starting_status_marked(state, id, row);
    if (!starting_status_allow_cure && row) {
        uint8_t *timer = starting_status_timer(state, row);
        for (unsigned team = 1; team <= 2; ++team) {
            const StartingStatus *choice = &starting_status[team];
            if (!choice->persistent) continue;
            for (unsigned i = 0; i < choice->count; ++i) {
                unsigned existing = choice->ids[i];
                const uint8_t *existing_row = starting_status_row(existing);
                if (existing != id &&
                    (row[0x15 + existing] == 1 ||
                     (timer && timer == starting_status_timer(state, existing_row))) &&
                    starting_status_marked(state, existing, existing_row))
                    return 0;
            }
        }
    }
    uint8_t result = starting_status_apply_native(state, id, duration, unit, source);
    if (marked && starting_status_active(state, id))
        starting_status_mark(starting_status_timer(state, row), row[0]);
    return result;
}

static void starting_status_seed(uint8_t *unit) {
    if (!unit || unit[0x188] < 1 || unit[0x188] > 2) return;
    const StartingStatus *choice = &starting_status[unit[0x188]];
    int16_t hp;
    memcpy(&hp, unit + 0x148, sizeof hp);
    if (hp <= 0) return;
    uint8_t *state = unit + 0x1a8;
    for (unsigned i = 0; i < choice->count; ++i) {
        unsigned id = choice->ids[i];
        const uint8_t *row = starting_status_row(id);
        uint8_t *timer = starting_status_timer(state, row);
        if (!row || (row[0] != 0 && (!timer || !row[6]))) continue;
        ((uint8_t (*)(uint8_t *, unsigned, int, void *, void *))(mm_base + 0x38fdd0))
            (state, id, row[6], unit, NULL);
        int active = starting_status_active(state, id);
        if (choice->persistent && active && timer) starting_status_mark(timer, row[0]);
        char line[112];
        snprintf(line, sizeof line, "Starting status: unit %u team %u condition %u active %d.\r\n",
                 unit[0x2fc], unit[0x188], id, active);
        mm_log(line);
    }
}

static unsigned starting_status_marked_timers(uint8_t *state, const uint8_t *unit, unsigned type) {
    unsigned timers = 0;
    if (!unit || unit[0x188] < 1 || unit[0x188] > 2) return timers;
    const StartingStatus *choice = &starting_status[unit[0x188]];
    if (!choice->persistent) return timers;
    for (unsigned i = 0; i < choice->count; ++i) {
        const uint8_t *row = starting_status_row(choice->ids[i]);
        if (row && row[0] == type && starting_status_marked(state, choice->ids[i], row))
            timers |= 1u << row[1];
    }
    return timers;
}

/* Track the game's 20 turn timers and five RT timers independently of the
 * number or ordering of selected conditions. */
static void starting_status_restore_marks(uint8_t *state, const uint8_t *unit, unsigned timers, unsigned type) {
    if (!timers) return;
    const StartingStatus *choice = &starting_status[unit[0x188]];
    for (unsigned i = 0; i < choice->count; ++i) {
        unsigned id = choice->ids[i];
        const uint8_t *row = starting_status_row(id);
        if (row && row[0] == type && (timers & (1u << row[1])) && starting_status_active(state, id)) {
            starting_status_mark(starting_status_timer(state, row), row[0]);
        }
    }
}

static void starting_status_tick(uint8_t *state, int elapsed, uint8_t *unit,
                                 void *random, unsigned mode) {
    unsigned timers = starting_status_marked_timers(state, unit, 2);
    ((void (*)(void *, int, void *, void *, unsigned))(mm_base + 0x390550))
        (state, elapsed, unit, random, mode);
    starting_status_restore_marks(state, unit, timers, 2);
}

static uint8_t starting_status_turn(uint8_t *state, void *unit, void *random, unsigned mode) {
    unsigned timers = starting_status_marked_timers(state, unit, 1);
    uint8_t result = starting_status_turn_native(state, unit, random, mode);
    starting_status_restore_marks(state, unit, timers, 1);
    return result;
}

/* The action simulator uses these queries to generate cure results.
 * Filter its candidates without changing the actual unit or status display. */
static uint8_t starting_status_cure_target(uint8_t *state, uint16_t id) {
    return !starting_status_protected(state, id) &&
           ((uint8_t (*)(uint8_t *, uint16_t))(mm_base + 0x38ee70))(state, id);
}

static void starting_status_cure_state(uint8_t *state, uint8_t copy[0x30]) {
    memcpy(copy, state, 0x30);
    for (unsigned team = 1; team <= 2; ++team) {
        const StartingStatus *choice = &starting_status[team];
        if (!choice->persistent) continue;
        for (unsigned i = 0; i < choice->count; ++i) {
            unsigned id = choice->ids[i];
            if (starting_status_marked(state, id, starting_status_row(id)))
                copy[id / 8] &= (uint8_t)~(1u << (id % 8));
        }
    }
}

static void starting_status_cure_candidates(uint8_t *state, void *list) {
    uint8_t copy[0x30];
    starting_status_cure_state(state, copy);
    ((void (*)(uint8_t *, void *))(mm_base + 0x38f330))(copy, list);
}

static unsigned starting_status_cure_count(uint8_t *state) {
    uint8_t copy[0x30];
    starting_status_cure_state(state, copy);
    return ((unsigned (*)(uint8_t *))(mm_base + 0x38f4c0))(copy);
}

static int starting_status_supported(unsigned id) {
    for (unsigned i = 0; i < sizeof starting_status_ids / sizeof starting_status_ids[0]; ++i)
        if (id == starting_status_ids[i]) return 1;
    return 0;
}

static void mm_install_starting_status(const wchar_t *config) {
    const wchar_t *sections[] = {L"PlayerStartingStatus", L"EnemyStartingStatus"};
    StartingStatus choices[3] = {0};
    int persistent = 0;
    for (unsigned team = 1; team <= 2; ++team) {
        StartingStatus *choice = &choices[team];
        const wchar_t *section = sections[team - 1];
        for (unsigned i = 0; i < STARTING_STATUS_SLOTS; ++i) {
            wchar_t key[32] = L"Condition";
            if (i) swprintf(key, sizeof key / sizeof key[0], L"Condition%u", i + 1);
            unsigned id = GetPrivateProfileIntW(section, key, 0, config);
            if (!id) continue;
            if (!starting_status_supported(id)) {
                mm_log("Starting status: unsupported condition.\r\n");
                return;
            }
            for (unsigned j = 0; j < choice->count; ++j) {
                unsigned other = choice->ids[j];
                int conflict = id == other;
                /* Battle data may not be loaded when the loader reads the INI. */
                for (unsigned pair = 0; pair < sizeof starting_status_conflicts / sizeof starting_status_conflicts[0]; ++pair) {
                    const uint8_t *entry = starting_status_conflicts[pair];
                    conflict |= (entry[0] == id && entry[1] == other) ||
                                (entry[0] == other && entry[1] == id);
                }
                if (conflict) {
                    mm_log("Starting status: duplicate or conflicting conditions.\r\n");
                    return;
                }
            }
            choice->ids[choice->count++] = id;
        }
        choice->persistent = choice->count && GetPrivateProfileIntW(section, L"Persistent", 0, config) != 0;
        persistent |= choice->persistent;
    }
    starting_status_allow_cure = GetPrivateProfileIntW(L"StartingStatus", L"AllowCure", 1, config) != 0;
    if (persistent) {
        const struct { unsigned rva; unsigned char original[5]; void *hook; int entry; } sites[] = {
            {0x34173b, {0xe8,0x10,0xee,0x04,0x00}, (void *)starting_status_tick, 0},
            {0x3903f0, {0x48,0x89,0x5c,0x24,0x10}, (void *)starting_status_turn, 1},
            {0x38fdd0, {0x48,0x89,0x5c,0x24,0x08}, (void *)starting_status_apply, 1},
            {0x38fb60, {0x48,0x89,0x5c,0x24,0x08}, (void *)starting_status_remove, 1},
            {0x44c23d, {0xe8,0x2e,0x2c,0xf4,0xff}, (void *)starting_status_cure_target, 0},
            {0x44c4ad, {0xe8,0x7e,0x2e,0xf4,0xff}, (void *)starting_status_cure_candidates, 0},
            {0x44c4db, {0xe8,0xe0,0x2f,0xf4,0xff}, (void *)starting_status_cure_count, 0},
        };
        const unsigned count = starting_status_allow_cure ? 4 : sizeof sites / sizeof sites[0];
        for (unsigned i = 0; i < count; ++i) {
            if (memcmp(mm_base + sites[i].rva, sites[i].original, 5)) {
                mm_log("Starting status: native code differs.\r\n");
                return;
            }
        }
        unsigned char *relay = mm_near_page();
        if (!relay) return;
        for (unsigned i = 1; i < count; ++i) {
            if (!sites[i].entry) continue;
            unsigned char *trampoline = relay + 128 + 32 * i;
            memcpy(trampoline, sites[i].original, 5);
            mm_abs_jump(trampoline + 5, mm_base + sites[i].rva + 5);
        }
        starting_status_turn_native = (void *)(relay + 160);
        starting_status_apply_native = (void *)(relay + 192);
        starting_status_remove_native = (void *)(relay + 224);
        FlushInstructionCache(GetCurrentProcess(), relay + 128, 128);
        for (unsigned i = 0; i < count; ++i) {
            unsigned char *site = mm_base + sites[i].rva;
            unsigned char *slot = relay + 16 * i;
            mm_abs_jump(slot, sites[i].hook);
            FlushInstructionCache(GetCurrentProcess(), slot, 16);
            unsigned char patch[5] = {sites[i].entry ? 0xe9 : 0xe8};
            int32_t displacement = (int32_t)((intptr_t)slot - (intptr_t)(site + 5));
            memcpy(patch + 1, &displacement, sizeof displacement);
            if (!mm_write(site, patch, sizeof patch)) {
                for (unsigned j = 0; j <= i; ++j)
                    mm_write(mm_base + sites[j].rva, sites[j].original, 5);
                mm_log("Starting status: installation failed.\r\n");
                return;
            }
        }
    }
    memcpy(starting_status, choices, sizeof choices);
    if (choices[1].count || choices[2].count)
        mm_log(starting_status_allow_cure ? "Starting status: cures allowed.\r\n" :
                                           "Starting status: persistent conditions protected from cures.\r\n");
}

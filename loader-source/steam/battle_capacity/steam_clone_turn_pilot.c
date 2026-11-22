/* Steam research component. The hook installer and remaining engine checks
 * are separate. These callbacks are exercised with isolated native fixtures. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#if defined(_WIN32)
#define API __declspec(dllexport)
#else
#define API
#endif

#ifndef PILOT_COUNT
#define PILOT_COUNT 31
#endif

enum {
    STOCK_COUNT = 30,
    UNIT_SIZE = 0x7d0,
    UNIT_ACTIVE = 0x10,
    SNAPSHOT_SIZE = 0x1c0,
    CONTEXT_POOL = 0x1b48,
    CONTEXT_MAP_OBJECTS = 0x1b58,
    VIEW_TURN_COUNT = 40,
    MAP_TURN_COUNT = 110,
    AI_OUTCOME_HEADER = 0xc,
    AI_OUTCOME_SIZE = 0x48,
    STOCK_OUTCOME_BYTES = AI_OUTCOME_HEADER + STOCK_COUNT * AI_OUTCOME_SIZE,
    EXTRA_COUNT = PILOT_COUNT - STOCK_COUNT,
    STATUS_COUNT = 89,
    STATUS_RESULT_FLAGS = 0x34,
    CONTEXT_OBJECT_LIST = 0x1b40,
    OBJECT_LIST_COUNT = 0x7c0,
    OBJECT_LIST_LIMIT = 0xf8,
    HISTORY_COUNT = 50,
    HISTORY_STRIDE = 0x73fc,
    HISTORY_COPY_BYTES = 0x6ea8,
    SUSPEND_COMMAND = 0x111,
    UNIT_CHARACTER = 0x138,
    UNIT_LOGICAL_SLOT = 0x2fc,
    UNIT_POSITION = 0x14,
    OUTCOME_POSITION = 0x40,
    HISTORY_NODE_RECORD = 0x30,
    HISTORY_RECORD_METADATA = 0x10,
    CONDITION_DESCRIPTOR_COUNT = 100,
    CONDITION_ROW_BYTES = 0x100,
    CONDITION_ROW_CHARACTER = 0xe0,
    CONDITION_ROW_SLOT = 0xf4,
    CONDITION_ROW_ORDER = 0xfa,
    BATTLE_ORDER_CACHE = 0x5aba,
};

typedef void (*SnapshotUnitInit)(void *snapshot);
typedef void (*CaptureUnit)(const void *actor, void *snapshot);
typedef void (*RestoreContext)(void *destination, const void *snapshot, const void *metadata, unsigned mode);
typedef void (*RestoreUnit)(void *actor, const void *snapshot, unsigned mode, unsigned slot);
typedef unsigned (*CollectTurns)(const void *units, uint64_t *entries);
typedef void (*SortTurns)(uint64_t *begin, uint64_t *end, size_t count, unsigned char predicate);
typedef void (*CollectOutcome)(void *outcome, const void *units, void *random);
typedef void (*CollectUnitOutcome)(void *entry, const void *unit);
typedef uintptr_t (*ResolveAction)(void *action, const void *combat, const void *parameters);
typedef void (*ClampAction)(void *outcome, const void *units);
typedef unsigned char (*CompareOutcome)(const void *left, const void *right);
typedef void *(*GetConditionDelta)(const void *native_action, void *output, int slot, const void *before);
typedef void (*CompareConditions)(void *output, const void *after, const void *before);
typedef void (*ResetUnits)(void *units, void *context);
typedef void (*RegisterObjects)(void *objects, void *registry, unsigned char primary);
typedef unsigned char (*RegisterActor)(void *registry, void *actor);
typedef void (*RestorePool)(void *units, const void *snapshot, unsigned mode);
typedef unsigned char (*CaptureHistoryNode)(void *node, uint16_t sequence, void *metadata,
                                           void *provided_snapshot);
typedef void *(*SnapshotByIndex)(int index);
typedef void *(*CopySnapshot)(void *destination, const void *source, size_t length);
typedef void *(*GetLiveContext)(void);
typedef void (*DispatchSystemCommand)(void *menu, int command);
typedef void *(*FindTileTarget)(void *battle, uint32_t coordinate);

struct ActionScope {
    struct ActionScope *previous;
    void *stock_outcome;
    void *extra_record;
};

static _Thread_local struct ActionScope *action_scope;
static CollectOutcome live_initialize;
static CollectUnitOutcome live_collect_unit;

API void *bc31_secondary_tile_target(FindTileTarget find, void *battle, uint32_t coordinate,
                                    unsigned count)
{
    return count < PILOT_COUNT ? find(battle, coordinate) : NULL;
}

struct CloneNativeCalls {
    SnapshotUnitInit initialize_unit_snapshot;
    CaptureUnit capture_unit;
    RestoreContext restore_context;
    RestoreUnit restore_extra_unit;
};

struct CloneScope {
    struct CloneScope *previous;
    const void *native_snapshot;
    const void *extra_snapshot;
    RestoreUnit restore_unit;
    int restored;
};

static _Thread_local struct CloneScope *clone_scope;

struct TurnNativeCalls {
    CollectTurns collect_map;
    CollectTurns collect_stock;
    CollectTurns collect_extra;
    SortTurns sort;
};

static struct TurnNativeCalls turn_native;

struct HistoryNativeCalls {
    CaptureUnit capture_pool;
    RestorePool restore_pool;
    SnapshotUnitInit initialize_unit;
    CaptureUnit capture_unit;
    RestoreUnit restore_unit;
    CaptureHistoryNode first_node;
    SnapshotByIndex snapshot_by_index;
    CopySnapshot copy_snapshot;
};

struct HistoryRecord {
    _Alignas(16) uint8_t snapshot[EXTRA_COUNT][SNAPSHOT_SIZE];
    unsigned char known;
};

static struct HistoryNativeCalls history_native;
static struct HistoryRecord history_records[HISTORY_COUNT];
static uintptr_t history_begin;
static const void *history_extra_pool;
static GetLiveContext get_live_context;
static DispatchSystemCommand dispatch_system_command;

static uint8_t *extra_unit(const void *context)
{
    if (!context)
        return NULL;
    uint8_t *pool;
    memcpy(&pool, (const uint8_t *)context + CONTEXT_POOL, sizeof(pool));
    return pool ? pool + STOCK_COUNT * UNIT_SIZE : NULL;
}

struct ConditionDescriptor {
    const void *character;
    const uint8_t *actor;
    int party_index;
};

_Static_assert(sizeof(struct ConditionDescriptor) == 0x18, "native battle roster descriptor layout");

typedef unsigned char (*FormatConditionRow)(void *row, const struct ConditionDescriptor *descriptor, int index);

static unsigned append_actor_row(FormatConditionRow format, uint8_t *rows, unsigned count,
                                 const uint8_t *actor, const struct ConditionDescriptor *roster, unsigned slot)
{
    if (count >= PILOT_COUNT)
        return count;
    if (!actor[UNIT_ACTIVE] || actor[UNIT_LOGICAL_SLOT] != slot)
        return count;

    const void *character = actor + UNIT_CHARACTER;
    for (unsigned row = 0; row < count; ++row) {
        const void *displayed;
        memcpy(&displayed, rows + row * CONDITION_ROW_BYTES + CONDITION_ROW_CHARACTER, sizeof(displayed));
        if (displayed == character)
            return count;
    }

    /* A removed descriptor leaves a hole, so the occupied count need not be
     * the index just past the last descriptor. Match the actual actor. */
    for (unsigned index = 0; index < CONDITION_DESCRIPTOR_COUNT; ++index) {
        if (roster[index].actor == actor && roster[index].character == character)
            return count + !!format(rows + count * CONDITION_ROW_BYTES, &roster[index], count);
    }
    return count;
}

API unsigned bc31_append_condition_row(FormatConditionRow format, uint8_t *rows, unsigned count,
                                       const void *context, const struct ConditionDescriptor *roster)
{
    const uint8_t *extra = extra_unit(context);
    if (extra) {
        for (unsigned i = 0; i < EXTRA_COUNT; ++i)
            count = append_actor_row(format, rows, count, extra + i * UNIT_SIZE, roster, STOCK_COUNT + i);
    }
    return count;
}

API void bc31_store_condition_order(uint8_t *save, const uint8_t *rows, int count)
{
    /* The UI can sort its full roster. Persist only the native physical
     * slots in their displayed order, within the existing 30 save pairs. */
    if (!save || count <= 0)
        return;
    uint8_t *entry = save + BATTLE_ORDER_CACHE;
    const uint8_t *limit = entry + STOCK_COUNT * 2;
    for (; count > 0 && entry < limit; --count, rows += CONDITION_ROW_BYTES) {
        if (rows[CONDITION_ROW_SLOT] >= STOCK_COUNT && rows[CONDITION_ROW_SLOT] < PILOT_COUNT)
            continue;
        entry[0] = rows[CONDITION_ROW_ORDER];
        entry[1] = rows[CONDITION_ROW_SLOT];
        entry += 2;
    }
}

static struct HistoryRecord *history_record(const void *snapshot)
{
    uintptr_t address = (uintptr_t)snapshot;
    if (!history_begin || address < history_begin)
        return NULL;
    uintptr_t offset = address - history_begin;
    if (offset >= HISTORY_COUNT * HISTORY_STRIDE || offset % HISTORY_STRIDE)
        return NULL;
    return &history_records[offset / HISTORY_STRIDE];
}

API const uint8_t *bc31_chariot_icon_snapshot(const uint8_t *node, const uint8_t *snapshot,
                                             unsigned metadata_offset)
{
    static const uint8_t empty[SNAPSHOT_SIZE];
    const uint8_t *record = NULL;
    if (node)
        memcpy(&record, node + HISTORY_NODE_RECORD, sizeof(record));
    if (!snapshot || !record)
        return empty;
    unsigned slot = record[HISTORY_RECORD_METADATA + metadata_offset];
    if (slot < STOCK_COUNT)
        return snapshot + slot * SNAPSHOT_SIZE;
    const struct HistoryRecord *history = history_record(snapshot);
    if (slot < PILOT_COUNT && history && history->known)
        return history->snapshot[slot - STOCK_COUNT];
    return empty;
}

/* Combat actions store registry IDs. Outcome rows use indices in the actor
 * pool. Map objects and unregistered IDs have no actor outcome row. */
static uint8_t *reaction_position_row(const uint8_t *combat, const uint8_t *actor)
{
    const uint8_t *battle, *pool;
    uint8_t *outcome;
    memcpy(&battle, combat, sizeof(battle));
    memcpy(&outcome, combat + 0x10, sizeof(outcome));
    if (!battle || !outcome || !actor)
        return NULL;
    memcpy(&pool, battle + CONTEXT_POOL, sizeof(pool));
    uintptr_t offset = (uintptr_t)actor - (uintptr_t)pool;
    if (!pool || offset >= UNIT_SIZE * PILOT_COUNT || offset % UNIT_SIZE)
        return NULL;
    return outcome + AI_OUTCOME_HEADER + (offset / UNIT_SIZE) * AI_OUTCOME_SIZE + OUTCOME_POSITION;
}

API uint32_t bc31_reaction_position(const uint8_t *combat, unsigned object_id)
{
    const uint8_t *battle, *registry, *actor;
    uint32_t count, position = UINT32_MAX;
    memcpy(&battle, combat, sizeof(battle));
    if (!battle || object_id >= OBJECT_LIST_LIMIT)
        return position;
    memcpy(&registry, battle + CONTEXT_OBJECT_LIST, sizeof(registry));
    if (!registry)
        return position;
    memcpy(&count, registry + OBJECT_LIST_COUNT, sizeof(count));
    if (object_id >= count)
        return position;
    memcpy(&actor, registry + object_id * sizeof(actor), sizeof(actor));
    const uint8_t *row = reaction_position_row(combat, actor);
    if (row)
        memcpy(&position, row, sizeof(position));
    else if (actor)
        memcpy(&position, actor + UNIT_POSITION, sizeof(position));
    return position;
}

API void bc31_store_reaction_position(const uint8_t *combat, const uint8_t *actor, uint32_t position)
{
    uint8_t *row = reaction_position_row(combat, actor);
    if (row)
        memcpy(row, &position, sizeof(position));
}

API void bc31_bind_history(const struct HistoryNativeCalls *native)
{
    history_native = *native;
    history_begin = 0;
    history_extra_pool = NULL;
}

/* This call site is reached only when the native history has no initial node. */
API unsigned char bc31_first_history_node(void *node, uint16_t sequence,
                                          void *metadata, void *provided_snapshot)
{
    memset(history_records, 0, sizeof(history_records));
    history_extra_pool = NULL;
    history_begin = (uintptr_t)history_native.snapshot_by_index(1);
    return history_native.first_node(node, sequence, metadata, provided_snapshot);
}

API void bc31_capture_history_units(const void *units, void *snapshot)
{
    history_native.capture_pool(units, snapshot);
    struct HistoryRecord *record = history_record(snapshot);
    if (!record)
        return;
    memset(record->snapshot, 0, sizeof(record->snapshot));
    for (unsigned i = 0; i < EXTRA_COUNT; ++i) {
        const uint8_t *actor = (const uint8_t *)units + (STOCK_COUNT + i) * UNIT_SIZE;
        history_native.initialize_unit(record->snapshot[i]);
        history_native.capture_unit(actor, record->snapshot[i]);
        if (actor[UNIT_ACTIVE])
            history_extra_pool = units;
    }
    record->known = 1;
}

/* This call replaces the unit restore inside the native context restore.
 * Restore the extra actor before the rest of the context uses the unit pool. */
API void bc31_restore_history_units(void *units, const void *snapshot, unsigned mode)
{
    history_native.restore_pool(units, snapshot, mode);
    uint8_t *extra = (uint8_t *)units + STOCK_COUNT * UNIT_SIZE;
    for (struct CloneScope *scope = clone_scope; scope; scope = scope->previous) {
        if (scope->native_snapshot == snapshot) {
            for (unsigned i = 0; i < EXTRA_COUNT; ++i)
                scope->restore_unit(extra + i * UNIT_SIZE,
                                    (const uint8_t *)scope->extra_snapshot + i * SNAPSHOT_SIZE, mode, STOCK_COUNT + i);
            scope->restored = 1;
            return;
        }
    }
    const struct HistoryRecord *record = history_record(snapshot);
    if (record && record->known) {
        for (unsigned i = 0; i < EXTRA_COUNT; ++i)
            history_native.restore_unit(extra + i * UNIT_SIZE, record->snapshot[i], mode, STOCK_COUNT + i);
    }
}

API void *bc31_copy_history_snapshot(void *destination, const void *source, size_t length)
{
    void *result = history_native.copy_snapshot(destination, source, length);
    struct HistoryRecord *target = history_record(destination);
    const struct HistoryRecord *original = history_record(source);
    if (length == HISTORY_COPY_BYTES && target && target != original) {
        if (original)
            *target = *original;
        else
            target->known = 0;
    }
    return result;
}

API void bc31_bind_suspend_command(GetLiveContext get_context, DispatchSystemCommand dispatch_command)
{
    get_live_context = get_context;
    dispatch_system_command = dispatch_command;
}

/* The first pilot exercises the battle without creating a suspend file that
 * would omit its 31st actor. Preserve other commands and stock encounters. */
API void bc31_dispatch_system_command(void *menu, int command)
{
    if (command == SUSPEND_COMMAND) {
        const uint8_t *actor = extra_unit(get_live_context());
        if (actor) {
            if (actor - STOCK_COUNT * UNIT_SIZE == history_extra_pool)
                return;
            for (unsigned i = 0; i < EXTRA_COUNT; ++i) {
                if (actor[i * UNIT_SIZE + UNIT_ACTIVE])
                    return;
            }
        }
    }
    dispatch_system_command(menu, command);
}

/* The original snapshot pointer and all of its section offsets stay native.
 * The extra record belongs to this clone call, including nested simulation. */
API void bc31_restore_clone(const struct CloneNativeCalls *game,
                            void *destination, const void *stock_snapshot,
                            const void *metadata, unsigned mode, const void *source)
{
    _Alignas(16) uint8_t extension[EXTRA_COUNT][SNAPSHOT_SIZE] = {0};
    uint8_t *original = extra_unit(source);
    for (unsigned i = 0; i < EXTRA_COUNT; ++i) {
        game->initialize_unit_snapshot(extension[i]);
        if (original && original[i * UNIT_SIZE + UNIT_ACTIVE])
            game->capture_unit(original + i * UNIT_SIZE, extension[i]);
    }

    struct CloneScope scope = {clone_scope, stock_snapshot, extension, game->restore_extra_unit, 0};
    clone_scope = &scope;
    game->restore_context(destination, stock_snapshot, metadata, mode);
    clone_scope = scope.previous;
    if (!scope.restored) {
        uint8_t *restored = extra_unit(destination);
        if (restored) {
            for (unsigned i = 0; i < EXTRA_COUNT; ++i)
                game->restore_extra_unit(restored + i * UNIT_SIZE, extension[i], mode, STOCK_COUNT + i);
        }
    }
}

API void bc31_bind_timeline(const struct TurnNativeCalls *native)
{
    turn_native = *native;
}

/* Native eligibility and sorting still apply. The clock uses all 141
 * records. Display callers get the earliest 40 in their native format. */
static void build_timeline(const void *context, void *output, unsigned capacity)
{
    const uint8_t *units;
    const void *objects;
    memcpy(&units, (const uint8_t *)context + CONTEXT_POOL, sizeof(units));
    memcpy(&objects, (const uint8_t *)context + CONTEXT_MAP_OBJECTS, sizeof(objects));
    uint64_t entries[MAP_TURN_COUNT + PILOT_COUNT];
    unsigned count = turn_native.collect_map(objects, entries);
    count += turn_native.collect_stock(units, entries + count);
    for (unsigned i = STOCK_COUNT; i < PILOT_COUNT; ++i)
        count += turn_native.collect_extra(units + i * UNIT_SIZE, entries + count);
    if (count > 1)
        turn_native.sort(entries, entries + count, count, 0);
    unsigned written = count < capacity ? count : capacity;
    memcpy(output, entries, written * sizeof(*entries));
    memcpy((uint8_t *)output + capacity * sizeof(*entries), &written, sizeof(written));
}

API void bc31_build_clock_timeline(const void *context, void *output)
{
    build_timeline(context, output, MAP_TURN_COUNT + PILOT_COUNT);
}

API void bc31_build_view_timeline(const void *context, void *output)
{
    build_timeline(context, output, VIEW_TURN_COUNT);
}

API int32_t bc31_min_clock_rt(const void *output)
{
    uint32_t count;
    memcpy(&count, (const uint8_t *)output + (MAP_TURN_COUNT + PILOT_COUNT) * sizeof(uint64_t), sizeof(count));
    if (!count)
        return -1;
    int32_t rt;
    memcpy(&rt, output, sizeof(rt));
    return rt;
}

/* Only for a caller that has grown its scoring buffer. The shared native
 * initializer still owns RNG state and the first 30 actor records. */
API void bc31_collect_ai_outcome(CollectOutcome native, CollectUnitOutcome collect_one,
                                 void *outcome, const void *units, void *random)
{
    uint8_t *entry = (uint8_t *)outcome + AI_OUTCOME_HEADER + STOCK_COUNT * AI_OUTCOME_SIZE;
    const uint8_t *unit = (const uint8_t *)units + STOCK_COUNT * UNIT_SIZE;
    native(outcome, units, random);
    memset(entry, 0, EXTRA_COUNT * AI_OUTCOME_SIZE);
    for (unsigned i = 0; i < EXTRA_COUNT; ++i)
        collect_one(entry + i * AI_OUTCOME_SIZE, unit + i * UNIT_SIZE);
}

/* The live action embeds exactly 30 records. Leave its following fields in
 * place and route in-flight resolution through the separate 31-record frame. */
API void bc31_begin_live_action(CollectOutcome native, CollectUnitOutcome collect_one,
                               void *inline_stock, const void *units, void *random, void *extended)
{
    /* Native initialization leaves a few header bytes untouched. */
    memcpy(extended, inline_stock, STOCK_OUTCOME_BYTES);
    bc31_collect_ai_outcome(native, collect_one, extended, units, random);
    memcpy(inline_stock, extended, STOCK_OUTCOME_BYTES);
}

/* Set once before publishing the live call relay. The relay supplies the
 * private frame address as its fourth argument, so the original native
 * outcome, actor pool and random stream remain in the first three. */
API void bc31_bind_live_outcome(CollectOutcome initialize, CollectUnitOutcome one)
{
    live_initialize = initialize;
    live_collect_unit = one;
}

API void bc31_begin_live_action_entry(void *inline_stock, const void *units,
                                      void *random, void *extended)
{
    bc31_begin_live_action(live_initialize, live_collect_unit, inline_stock, units, random, extended);
}

/* This replaces the stock status matrix walk for the live action only.
 * In the widened matrix, slot 30 of one status and slot 0 of the next
 * status have independent pointers. */
API void bc31_finish_live_action(void *const *status_results, void *inline_stock,
                                 const void *extended)
{
    for (unsigned i = 0; i < STATUS_COUNT * PILOT_COUNT; ++i) {
        uint8_t *result = status_results[i];
        if (result) {
            uint32_t flags;
            memcpy(&flags, result + STATUS_RESULT_FLAGS, sizeof(flags));
            flags |= 0x40u;
            memcpy(result + STATUS_RESULT_FLAGS, &flags, sizeof(flags));
        }
    }
    memcpy(inline_stock, extended, STOCK_OUTCOME_BYTES);
    for (struct ActionScope *scope = action_scope; scope; scope = scope->previous) {
        if (scope->stock_outcome == inline_stock) {
            memcpy(scope->extra_record, (const uint8_t *)extended + STOCK_OUTCOME_BYTES,
                   EXTRA_COUNT * AI_OUTCOME_SIZE);
            break;
        }
    }
}

/* Secondary-effect simulation has its own stack-local result object, whose
 * inline storage still has 30 records. Export the extra outcome from that
 * action alone. Nested evaluations and parallel AI workers isolate theirs. */
API uintptr_t bc31_resolve_scoped_action(ResolveAction native, void *action,
                                        const void *combat, const void *parameters, void *extra)
{
    struct ActionScope scope = {action_scope, (uint8_t *)action + 0x5588, extra};
    memset(extra, 0, EXTRA_COUNT * AI_OUTCOME_SIZE);
    action_scope = &scope;
    uintptr_t result = native(action, combat, parameters);
    action_scope = scope.previous;
    return result;
}

API void bc31_clamp_secondary_outcome(ClampAction native, void *stock_outcome,
                                       const void *units, void *extra)
{
    native(stock_outcome, units);
    const uint8_t *unit = (const uint8_t *)units + STOCK_COUNT * UNIT_SIZE;
    for (unsigned slot = 0; slot < EXTRA_COUNT; ++slot) {
        for (unsigned i = 0; i < 2; ++i) {
            uint8_t *result = (uint8_t *)extra + slot * AI_OUTCOME_SIZE + i * 2;
            int16_t stored, maximum;
            memcpy(&stored, result, sizeof(stored));
            memcpy(&maximum, unit + slot * UNIT_SIZE + 0x266 + i * 2, sizeof(maximum));
            int16_t limited = stored < maximum ? stored : maximum;
            if (limited < 0)
                limited = 0;
            memcpy(result, &limited, sizeof(limited));
        }
    }
}

API unsigned char bc31_secondary_changed(CompareOutcome native, CompareOutcome compare_effects,
                                          CompareOutcome compare_statuses, const void *action,
                                          const void *before, const void *after_extra)
{
    if (native(action, before))
        return 1;
    const uint8_t *baseline = (const uint8_t *)before + STOCK_OUTCOME_BYTES;
    const uint8_t *after = after_extra;
    for (unsigned i = 0; i < EXTRA_COUNT; ++i, baseline += AI_OUTCOME_SIZE, after += AI_OUTCOME_SIZE) {
        if (memcmp(baseline, after, 4) || baseline[0x44] != after[0x44] ||
            !compare_effects(after + 8, baseline + 8) || !compare_statuses(after + 0x38, baseline + 0x38))
            return 1;
    }
    return 0;
}

API void *bc31_secondary_condition_delta(GetConditionDelta native, CompareConditions compare,
                                         const void *action, void *output, int slot,
                                         const void *before, const void *after_extra)
{
    if (slot < STOCK_COUNT || slot >= PILOT_COUNT)
        return native(action, output, slot, before);
    size_t offset = (slot - STOCK_COUNT) * AI_OUTCOME_SIZE + 0x38;
    compare(output, (const uint8_t *)after_extra + offset,
            (const uint8_t *)before + STOCK_OUTCOME_BYTES + offset);
    return output;
}

/* Keep the stock object IDs stable. Initialize the extra record alongside
 * the other actors, then register it after the map's objects have their IDs. */
API void bc31_reset_context_units(ResetUnits native, ResetUnits reset_one, void *units, void *context)
{
    native(units, context);
    for (unsigned i = STOCK_COUNT; i < PILOT_COUNT; ++i)
        reset_one((uint8_t *)units + i * UNIT_SIZE, context);
}

static unsigned char register_one_extra(RegisterActor register_actor, void *registry, uint8_t *extra)
{
    uint32_t count;
    memcpy(&count, (const uint8_t *)registry + OBJECT_LIST_COUNT, sizeof(count));
    if (count > OBJECT_LIST_LIMIT)
        return 0;
    for (unsigned i = 0; i < count; ++i) {
        void *registered;
        memcpy(&registered, (const uint8_t *)registry + i * sizeof(registered), sizeof(registered));
        if (registered == extra)
            return 1;
    }
    if (count == OBJECT_LIST_LIMIT)
        return 0;
    return register_actor(registry, extra);
}

API unsigned char bc31_register_after_objects(RegisterObjects native, RegisterActor register_actor,
                                               void *objects, void *registry, unsigned char primary,
                                               const void *context, unsigned char skip_actor_registration)
{
    native(objects, registry, primary);
    if (skip_actor_registration)
        return 1;
    uint8_t *extra = extra_unit(context);
    if (!extra)
        return 0;
    for (unsigned i = 0; i < EXTRA_COUNT; ++i) {
        if (!register_one_extra(register_actor, registry, extra + i * UNIT_SIZE))
            return 0;
    }
    return 1;
}

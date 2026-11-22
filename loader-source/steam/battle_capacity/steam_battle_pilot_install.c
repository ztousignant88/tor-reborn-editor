/* Compose the locally verified Steam pilot. Tests pass a scratch-mapped
 * image to this installer. The game launch and project apply are separate. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include "battle_capacity.h"

#define PILOT_COUNT 62
#define PILOT_PORTRAIT_COUNT 192
#include "steam_clone_turn_pilot.c"
#ifdef PILOT_PORTRAIT_COUNT
#include "steam_battle_portrait_pilot.h"
#endif

static struct CloneNativeCalls clone_calls;
static ResolveAction resolve_action;
static ClampAction clamp_outcome;
static CompareOutcome compare_outcome, compare_effects, compare_statuses;
static GetConditionDelta condition_delta;
static CompareConditions compare_conditions;
static ResetUnits reset_context, reset_unit;
static RegisterObjects register_objects;
static RegisterActor register_actor;
static FindTileTarget find_tile_target;
static unsigned (*build_condition_roster)(uint8_t *rows);
static void (*write_condition_order)(const uint8_t *rows, int count);
static uint8_t *(*get_order_save)(void);
static FormatConditionRow format_condition_row;
static uint8_t *condition_rows;
static const uint8_t *condition_mode;
static const struct ConditionDescriptor *condition_descriptors;

static void restore_clone_entry(void *destination, const void *snapshot, const void *metadata,
                                unsigned mode, const void *source)
{
    bc31_restore_clone(&clone_calls, destination, snapshot, metadata, mode, source);
}

static void collect_outcome_entry(void *outcome, const void *units, void *random)
{
    bc31_collect_ai_outcome(live_initialize, live_collect_unit, outcome, units, random);
}

static uintptr_t resolve_secondary_entry(void *action, const void *combat, const void *parameters, void *extra)
{
    return bc31_resolve_scoped_action(resolve_action, action, combat, parameters, extra);
}

static void clamp_secondary_entry(void *outcome, const void *units, void *extra)
{
    bc31_clamp_secondary_outcome(clamp_outcome, outcome, units, extra);
}

static void *secondary_delta_entry(const void *action, void *output, int slot,
                                   const void *before, const void *after_extra)
{
    return bc31_secondary_condition_delta(condition_delta, compare_conditions,
                                          action, output, slot, before, after_extra);
}

static unsigned char compare_secondary_entry(const void *action, const void *before, const void *after_extra)
{
    return bc31_secondary_changed(compare_outcome, compare_effects, compare_statuses, action, before, after_extra);
}

static void reset_context_entry(void *units, void *context)
{
    bc31_reset_context_units(reset_context, reset_unit, units, context);
}

static void register_on_reset(void *objects, void *registry, unsigned char primary, const void *context)
{
    (void)bc31_register_after_objects(register_objects, register_actor, objects, registry, primary, context, 0);
}

static void register_on_scene_bind(void *objects, void *registry, unsigned char primary,
                                   const void *context, unsigned char skip)
{
    (void)bc31_register_after_objects(register_objects, register_actor, objects, registry, primary, context, skip);
}

static void *secondary_target_entry(void *battle, uint32_t coordinate, unsigned count)
{
    return bc31_secondary_tile_target(find_tile_target, battle, coordinate, count);
}

static void *effect_actor_entry(const uint8_t *battle, unsigned id)
{
    /* Effect descriptors carry battle slots. The extra actors register after
       map objects, so indexing the object list by slot selects a map object. */
    if (id >= STOCK_COUNT && id < PILOT_COUNT) {
        uint8_t *units;
        memcpy(&units, battle + CONTEXT_POOL, sizeof(units));
        if (units) {
            uint8_t *actor = units + id * UNIT_SIZE;
            if (actor[UNIT_ACTIVE] && actor[UNIT_LOGICAL_SLOT] == id)
                return actor;
        }
        return NULL;
    }
    void *const *objects;
    memcpy(&objects, battle + CONTEXT_OBJECT_LIST, sizeof(objects));
    return objects && id < OBJECT_LIST_LIMIT ? objects[id] : NULL;
}

static unsigned condition_roster_entry(uint8_t *rows)
{
    unsigned count = build_condition_roster(rows);
    if (rows != condition_rows || (*condition_mode != 2 && *condition_mode != 3))
        return count;
    return bc31_append_condition_row(format_condition_row, rows, count, get_live_context(), condition_descriptors);
}

static void condition_order_entry(const uint8_t *rows, int count)
{
    if (*condition_mode == 2 || *condition_mode == 3)
        bc31_store_condition_order(get_order_save(), rows, count);
    else
        write_condition_order(rows, count);
}

struct BytePatch {
    uint32_t rva;
    size_t length;
    const char *before, *after;
};

struct CallRelay {
    uint32_t rva;
    size_t length;
    uint8_t opcode;
    const char *before;
    size_t prefix_length;
    const char *prefix;
    uint32_t native_target;
    void *adapter;
};

struct AnimationRelocation {
    uint32_t rva;
    int32_t displacement;
    unsigned backing;
};

#if PILOT_COUNT > 46
struct SpriteRelocation {
    uint32_t rva;
    uint32_t old_offset;
};

static uint8_t *sprite_slots;
static void reset_sprite_slots_entry(void *manager);
#endif

#ifndef PILOT_PATCH_TABLE
#define PILOT_PATCH_TABLE "steam_battle_patch_sites.inc"
#endif
#include PILOT_PATCH_TABLE

enum { RELAY_PAGE_BYTES = 4096, ABS_JUMP_BYTES = 14,
#ifdef EXPANDED_ANIMATION_POOL
       ANIM_COUNT = ANIM_PRIMARY_COUNT + ANIM_SECONDARY_COUNT,
       ANIM_DESCRIPTORS_ALLOC = (ANIM_COUNT * ANIM_DESCRIPTOR_BYTES + RELAY_PAGE_BYTES - 1) & -RELAY_PAGE_BYTES,
       ANIM_BACKING_ALLOC = (ANIM_PRIMARY_COUNT * ANIM_PRIMARY_BYTES + ANIM_SECONDARY_COUNT * ANIM_SECONDARY_BYTES +
                             RELAY_PAGE_BYTES - 1) & -RELAY_PAGE_BYTES,
       RELAY_ALLOCATION_BYTES = RELAY_PAGE_BYTES * 2 + ANIM_DESCRIPTORS_ALLOC + ANIM_BACKING_ALLOC,
#elif PILOT_COUNT > 46
       RELAY_ALLOCATION_BYTES = RELAY_PAGE_BYTES * 2,
#else
       RELAY_ALLOCATION_BYTES = RELAY_PAGE_BYTES,
#endif
};
#define COUNT(array) (sizeof(array) / sizeof((array)[0]))

#if PILOT_COUNT > 46
static void reset_sprite_slots_entry(void *manager)
{
    (void)manager;
    for (size_t i = 0; i < SPRITE_SLOT_COUNT; ++i)
        sprite_slots[i * 8 + 4] = 0xff;
}
#endif

#ifdef EXPANDED_ANIMATION_POOL
static void initialize_animation_pool(uint8_t *table, uint8_t *backing)
{
    for (unsigned i = 0; i < ANIM_COUNT; ++i) {
        unsigned bytes = i < ANIM_PRIMARY_COUNT ? ANIM_PRIMARY_BYTES : ANIM_SECONDARY_BYTES;
        uint8_t *first = backing, *second = backing + bytes / 2;
        memcpy(table, &first, sizeof(first));
        memcpy(table + 8, &second, sizeof(second));
        table[0x30] = 0xff;
        table[0x31] = (uint8_t)i;
        table[0x32] = 1;
        backing += bytes;
        table += ANIM_DESCRIPTOR_BYTES;
    }
}
#endif

static void bind_native_calls(uint8_t *image, const void *restore, const void *collect)
{
#define FN(type, rva) ((type)(void *)(image + (rva)))
    clone_calls = (struct CloneNativeCalls){FN(SnapshotUnitInit, 0x2ec780), FN(CaptureUnit, 0x3430b0),
                                           FN(RestoreContext, 0x3631a0), (RestoreUnit)restore};
    struct HistoryNativeCalls history = {FN(CaptureUnit, 0x376d00), FN(RestorePool, 0x376aa0),
                                         clone_calls.initialize_unit_snapshot, clone_calls.capture_unit,
                                         clone_calls.restore_extra_unit, FN(CaptureHistoryNode, 0x479710),
                                         FN(SnapshotByIndex, 0x36e140), FN(CopySnapshot, 0x551522)};
    bc31_bind_history(&history);
    struct TurnNativeCalls turns = {FN(CollectTurns, 0x3b93c0), FN(CollectTurns, 0x376850),
                                     (CollectTurns)collect, FN(SortTurns, 0x35d1c0)};
    bc31_bind_timeline(&turns);
    bc31_bind_live_outcome(FN(CollectOutcome, 0x470e40), FN(CollectUnitOutcome, 0x470f10));
    bc31_bind_suspend_command(FN(GetLiveContext, 0x345180), FN(DispatchSystemCommand, 0x3e3700));
    resolve_action = FN(ResolveAction, 0x456220);
    clamp_outcome = FN(ClampAction, 0x470b80);
    compare_outcome = FN(CompareOutcome, 0x44a5a0);
    compare_effects = FN(CompareOutcome, 0x3929c0);
    compare_statuses = FN(CompareOutcome, 0x353f20);
    condition_delta = FN(GetConditionDelta, 0x449fc0);
    compare_conditions = FN(CompareConditions, 0x353f50);
    reset_context = FN(ResetUnits, 0x376910);
    reset_unit = FN(ResetUnits, 0x342270);
    register_objects = FN(RegisterObjects, 0x3ae430);
    register_actor = FN(RegisterActor, 0x3a25c0);
    find_tile_target = FN(FindTileTarget, 0x361de0);
    build_condition_roster = FN(unsigned (*)(uint8_t *), 0x348e10);
    write_condition_order = FN(void (*)(const uint8_t *, int), 0x349430);
    get_order_save = FN(uint8_t *(*)(void), 0x2c80e0);
    format_condition_row = FN(FormatConditionRow, 0x349850);
    condition_rows = image + 0xf25d90;
    condition_mode = image + 0xf23658;
    condition_descriptors = (const struct ConditionDescriptor *)(image + 0xf25330);
#ifdef PILOT_PORTRAIT_COUNT
    portrait_native_allocate = (void *)(image + 0x198c90);
    portrait_native_free = (void *)(image + 0x37770);
    portrait_native_render = (void *)(image + 0x2f24c0);
    portrait_native_render_mode = (void *)(image + 0x2f28f0);
#endif
#undef FN
}

static unsigned char *allocate_relays(const void *image)
{
    SYSTEM_INFO info;
    GetSystemInfo(&info);
    uintptr_t granularity = info.dwAllocationGranularity;
    uintptr_t base = (uintptr_t)image & ~(granularity - 1);
    for (uintptr_t distance = granularity; distance < 0x40000000; distance += granularity) {
        void *page = VirtualAlloc((void *)(base + distance), RELAY_ALLOCATION_BYTES,
                                  MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
        if (page)
            return page;
        if (base > distance) {
            page = VirtualAlloc((void *)(base - distance), RELAY_ALLOCATION_BYTES,
                               MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
            if (page)
                return page;
        }
    }
    return NULL;
}

static uint8_t *append_relay(uint8_t **cursor, const uint8_t *end, const char *prefix, size_t length,
                             const void *target)
{
    if ((size_t)(end - *cursor) < length + ABS_JUMP_BYTES)
        return NULL;
    uint8_t *start = *cursor;
    memcpy(start, prefix, length);
    uint8_t *instruction = start + length;
    memcpy(instruction, "\xff\x25\0\0\0\0", 6);
    memcpy(instruction + 6, &target, sizeof(target));
    *cursor = instruction + ABS_JUMP_BYTES;
    return start;
}

static int write_bytes(uint8_t *target, const void *value, size_t length)
{
    DWORD previous;
    if (!VirtualProtect(target, length, PAGE_EXECUTE_READWRITE, &previous))
        return 0;
    memcpy(target, value, length);
    int flushed = FlushInstructionCache(GetCurrentProcess(), target, length) != 0;
    DWORD ignored;
    return VirtualProtect(target, length, previous, &ignored) && flushed;
}

static int matches(const uint8_t *image, size_t image_size, uint32_t rva, size_t length, const char *bytes)
{
    return rva <= image_size && length <= image_size - rva && !memcmp(image + rva, bytes, length);
}

API int bc31_verify_native_image(const uint8_t *image, size_t image_size)
{
    if (!image)
        return 0;
    for (size_t i = 0; i < COUNT(native_changes); ++i) {
        const struct BytePatch *p = &native_changes[i];
        if (!matches(image, image_size, p->rva, p->length, p->before))
            return 0;
    }
    for (size_t i = 0; i < COUNT(native_relays); ++i) {
        const struct CallRelay *hook = &native_relays[i];
        if (!matches(image, image_size, hook->rva, hook->length, hook->before))
            return 0;
    }
#if PILOT_COUNT > 46
    for (size_t i = 0; i < COUNT(sprite_relocations); ++i) {
        const struct SpriteRelocation *reloc = &sprite_relocations[i];
        if (!matches(image, image_size, reloc->rva, sizeof(reloc->old_offset), (const char *)&reloc->old_offset))
            return 0;
    }
#endif
#ifdef EXPANDED_ANIMATION_POOL
    for (size_t i = 0; i < COUNT(animation_relocations); ++i) {
        const struct AnimationRelocation *r = &animation_relocations[i];
        if (!matches(image, image_size, r->rva, sizeof(r->displacement), (const char *)&r->displacement))
            return 0;
    }
#endif
    return 1;
}

static int install_capacity(uint8_t *image, size_t image_size, int equipment_owns_history)
{
    if (!bc31_verify_native_image(image, image_size))
        return 0;
#ifdef EXPANDED_ANIMATION_POOL
    // The linked lists must be empty before relocating their descriptors.
    static const char empty_groups[4 * sizeof(void *)] = {0};
    if (!matches(image, image_size, ANIM_GROUP_RVA, sizeof(empty_groups), empty_groups))
        return 0;
#endif

    uint8_t *page = allocate_relays(image);
    if (!page)
        return 0;
    uint8_t *cursor = page;
    const uint8_t *end = page + RELAY_PAGE_BYTES;
#if PILOT_COUNT > 46
    _Static_assert(SPRITE_SLOT_COUNT * 8 <= RELAY_PAGE_BYTES, "sprite slot records fit in the writable page");
    uint8_t *extended_sprites = page + RELAY_PAGE_BYTES;
    uint8_t *original_sprites = image + SPRITE_MANAGER_RVA + SPRITE_TABLE_OFFSET;
    int32_t sprite_offsets[COUNT(sprite_relocations)];
    int64_t shift = (int64_t)(uintptr_t)extended_sprites - (int64_t)(uintptr_t)original_sprites;
    for (size_t i = 0; i < COUNT(sprite_relocations); ++i) {
        int64_t offset = shift + sprite_relocations[i].old_offset;
        if (offset < INT32_MIN || offset > INT32_MAX)
            goto unavailable;
        sprite_offsets[i] = (int32_t)offset;
    }
    memcpy(extended_sprites, original_sprites, SPRITE_STOCK_SLOTS * 8);
    memset(extended_sprites + SPRITE_STOCK_SLOTS * 8, 0xff, (SPRITE_SLOT_COUNT - SPRITE_STOCK_SLOTS) * 8);
#endif
#ifdef EXPANDED_ANIMATION_POOL
    _Static_assert(ANIM_COUNT == 255, "animation handles fit in the command queue's byte index");
    uint8_t *descriptors = page + RELAY_PAGE_BYTES * 2;
    uint8_t *backing = descriptors + ANIM_DESCRIPTORS_ALLOC;
    const int64_t animation_shifts[] = {
        (int64_t)(uintptr_t)descriptors - (int64_t)(uintptr_t)(image + ANIM_DESCRIPTOR_RVA),
        (int64_t)(uintptr_t)backing - (int64_t)(uintptr_t)(image + ANIM_BACKING_RVA),
    };
    int32_t animation_offsets[COUNT(animation_relocations)];
    for (size_t i = 0; i < COUNT(animation_relocations); ++i) {
        const struct AnimationRelocation *r = &animation_relocations[i];
        int64_t offset = r->displacement + animation_shifts[r->backing];
        if (offset < INT32_MIN || offset > INT32_MAX)
            goto unavailable;
        animation_offsets[i] = (int32_t)offset;
    }
    initialize_animation_pool(descriptors, backing);
#endif
    uint8_t *restore = append_relay(&cursor, end, restore_unit_prefix, sizeof(restore_unit_prefix) - 1,
                                    image + restore_unit_continuation);
    uint8_t *collect = append_relay(&cursor, end, collect_unit_prefix, sizeof(collect_unit_prefix) - 1,
                                    image + collect_unit_continuation);
    uint8_t calls[COUNT(native_relays)][7];
    if (!restore || !collect)
        goto unavailable;
    for (size_t i = 0; i < COUNT(native_relays); ++i) {
        const struct CallRelay *hook = &native_relays[i];
        void *target = hook->adapter ? hook->adapter : (void *)(image + hook->native_target);
        uint8_t *relay = append_relay(&cursor, end, hook->prefix, hook->prefix_length, target);
        if (!relay)
            goto unavailable;
        int64_t distance = (int64_t)(uintptr_t)relay - (int64_t)(uintptr_t)(image + hook->rva + 5);
        if (distance < INT32_MIN || distance > INT32_MAX)
            goto unavailable;
        memset(calls[i], 0x90, sizeof(calls[i]));
        calls[i][0] = hook->opcode;
        int32_t relative = (int32_t)distance;
        memcpy(calls[i] + 1, &relative, sizeof(relative));
    }
    DWORD old;
    if (!VirtualProtect(page, RELAY_PAGE_BYTES, PAGE_EXECUTE_READ, &old) ||
        !FlushInstructionCache(GetCurrentProcess(), page, RELAY_PAGE_BYTES))
        goto unavailable;

    bind_native_calls(image, restore, collect);
    size_t changed = 0, hooked = 0;
#ifdef EXPANDED_ANIMATION_POOL
    size_t animation_relocated = 0;
#endif
#if PILOT_COUNT > 46
    sprite_slots = extended_sprites;
    size_t relocated = 0;
    while (relocated < COUNT(sprite_relocations)) {
        size_t index = relocated++;
        if (!write_bytes(image + sprite_relocations[index].rva, &sprite_offsets[index], sizeof(sprite_offsets[index])))
            goto rollback;
    }
#endif
#ifdef EXPANDED_ANIMATION_POOL
    while (animation_relocated < COUNT(animation_relocations)) {
        const size_t index = animation_relocated++;
        if (!write_bytes(image + animation_relocations[index].rva, &animation_offsets[index], sizeof(animation_offsets[index])))
            goto rollback;
    }
#endif
    while (changed < COUNT(native_changes)) {
        const struct BytePatch *p = &native_changes[changed++];
        if (!write_bytes(image + p->rva, p->after, p->length))
            goto rollback;
    }
    while (hooked < COUNT(native_relays)) {
        size_t entry = hooked++;
        if (equipment_owns_history && native_relays[entry].adapter == (void *)bc31_copy_history_snapshot)
            continue;
        if (!write_bytes(image + native_relays[entry].rva, calls[entry], native_relays[entry].length))
            goto rollback;
    }
    return 1;

rollback: {
    int restored = 1;
    while (hooked) {
        const struct CallRelay *hook = &native_relays[--hooked];
        if (equipment_owns_history && hook->adapter == (void *)bc31_copy_history_snapshot)
            continue;
        restored &= write_bytes(image + hook->rva, hook->before, hook->length);
    }
    while (changed) {
        const struct BytePatch *p = &native_changes[--changed];
        restored &= write_bytes(image + p->rva, p->before, p->length);
    }
#if PILOT_COUNT > 46
    while (relocated) {
        const struct SpriteRelocation *reloc = &sprite_relocations[--relocated];
        restored &= write_bytes(image + reloc->rva, &reloc->old_offset, sizeof(reloc->old_offset));
    }
    sprite_slots = NULL;
#endif
#ifdef EXPANDED_ANIMATION_POOL
    while (animation_relocated) {
        const struct AnimationRelocation *r = &animation_relocations[--animation_relocated];
        restored &= write_bytes(image + r->rva, &r->displacement, sizeof(r->displacement));
    }
#endif
    if (!restored)
        return -1;
}
unavailable:
    VirtualFree(page, 0, MEM_RELEASE);
    return 0;
}

static int capacity_active;

API int bc31_install_verified_image(uint8_t *image, size_t image_size)
{
    return install_capacity(image, image_size, 0);
}

int battle_capacity_install(uint8_t *image, size_t image_size, int equipment_owns_history)
{
    int result = install_capacity(image, image_size, equipment_owns_history);
    capacity_active = result == 1;
    return result;
}

unsigned battle_capacity_unit_count(void)
{
    return capacity_active ? PILOT_COUNT : STOCK_COUNT;
}

void *battle_capacity_copy_history(void *destination, const void *source, size_t size,
                                   void *(*native_copy)(void *, const void *, size_t))
{
    if (capacity_active)
        return bc31_copy_history_snapshot(destination, source, size);
    return native_copy(destination, source, size);
}

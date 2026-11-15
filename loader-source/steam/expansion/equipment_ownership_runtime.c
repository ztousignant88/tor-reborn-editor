/* PC 1.0.2 party/staging/battle bindings at the original copy call sites. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stddef.h>
#include <string.h>
#include "equipment_bank.h"

typedef void *(*CopyFn)(void *, const void *);
typedef void (*CaptureFn)(const void *, void *, void *);
typedef void (*RestoreFn)(void *, const void *, const void *);
typedef void *(*CopyBytesFn)(void *, const void *, size_t);
typedef void (*CloseSaveFn)(void *);
typedef void (*OpenSaveFn)(void *, void *, uint32_t);
typedef void (*ReadPartyFn)(void *, uint32_t, void *);
typedef void (*CloneSceneFn)(void *, const void *);
typedef int (*PatchFn)(void *, const void *, size_t);

static CopyFn native_copy;
static CaptureFn native_capture;
static RestoreFn native_restore;
static CopyBytesFn native_copy_bytes;
static CloseSaveFn native_close_save;
static OpenSaveFn native_open_save;
static ReadPartyFn native_read_party;
static CloneSceneFn native_clone_scene;
static const unsigned char *snapshot_pool_address;
static const unsigned char *battle_scenes_address;
static void *party_pointer, *battle_pointer;
static EquipmentBank party_bank, battle_bank;
static EquipmentHistory history;
static EquipmentBank resumed_battle;
static EquipmentHistory resumed_history;
static int resume_pending;
static struct { void *pointer; EquipmentBank bank; } staging[2];
static struct { void *pointer; EquipmentBank bank; } previews[2];
static unsigned char *installed;
static int install_result;
static uint8_t save_namespace[16];
static int save_namespace_set;
static _Thread_local int save_status;
static const void *load_context;
static const uint8_t *load_payload;
static uint32_t load_length;
static int load_status;

typedef struct {
    void *job;
    uint32_t phase, code;
    uintptr_t detail;
    uint32_t detail_type;
} SaveDispatch;

enum { DISPATCH_NEW = 0, DISPATCH_PENDING = 1, DISPATCH_FAILED = 2, SAVE_ERROR = 2 };
typedef void (*DispatchFn)(SaveDispatch *);
typedef void (*SubmitFn)(SaveDispatch *, void **);
static DispatchFn native_dispatch;
static SubmitFn native_submit;
static const void *load_job_vtable, *write_job_vtable;
static _Thread_local SaveDispatch *cancel_write;
static void (*native_write_snapshot)(void);
static void (*native_restore_snapshot)(void *);
static void (*native_release)(void *);
static void (*native_reset_save)(const void *);
static const void *failed_snapshot_owner;
static unsigned char *guard_image;
static int guard_result;

_Static_assert(offsetof(SaveDispatch, detail_type) == 0x18, "Native save dispatcher layout");

static void *copy_to_stage(void *destination, const void *source, unsigned slot)
{
    void *result = native_copy(destination, source);
    if (source != party_pointer) {
        for (unsigned i = 0; i < 2; i++) {
            if (staging[i].pointer == destination) {
                equipment_unbind_inventory(destination);
                staging[i].pointer = NULL;
            }
        }
        return result;
    }
    /* If both native entry paths use the same staging buffer, reuse its bank. */
    if (staging[1 - slot].pointer == destination)
        slot = 1 - slot;
    if (staging[slot].pointer != destination) {
        equipment_unbind_inventory(staging[slot].pointer);
        staging[slot].pointer = NULL;
        if (!equipment_bind_inventory(destination, &staging[slot].bank))
            return result;
        staging[slot].pointer = destination;
    }
    equipment_transfer_inventory(destination, source);
    return result;
}

static void *stage_for_entry(void *destination, const void *source)
{
    return copy_to_stage(destination, source, 0);
}

static void *stage_for_setup(void *destination, const void *source)
{
    return copy_to_stage(destination, source, 1);
}

static void clear_previews(void)
{
    for (unsigned i = 0; i < sizeof(previews) / sizeof(previews[0]); i++) {
        equipment_unbind_inventory(previews[i].pointer);
        previews[i].pointer = NULL;
    }
}

static const unsigned char *battle_scenes(void)
{
    const unsigned char *scenes;
    memcpy(&scenes, battle_scenes_address, sizeof(scenes));
    return scenes;
}

static void *scene_inventory(const unsigned char *scene)
{
    unsigned char *manager;
    memcpy(&manager, scene + 0x1b68, sizeof(manager));
    return manager ? manager + 0x64 : NULL;
}

static void attach_preview(void *inventory, const EquipmentBank *bank)
{
    const unsigned char *scenes = battle_scenes();
    if (!scenes || !inventory || inventory == battle_pointer)
        return;
    enum { SCENE_STRIDE = 0xdd580 };
    for (unsigned i = 0; i < sizeof(previews) / sizeof(previews[0]); i++) {
        if (scene_inventory(scenes + (i + 1) * SCENE_STRIDE) != inventory)
            continue;
        if (previews[i].pointer != inventory) {
            equipment_unbind_inventory(previews[i].pointer);
            previews[i].pointer = NULL;
            if (!equipment_bind_inventory(inventory, &previews[i].bank))
                return;
            previews[i].pointer = inventory;
        }
        equipment_restore_bank(inventory, bank);
        return;
    }
}

static void clone_preview(void *destination, const void *source)
{
    native_clone_scene(destination, source);
    const unsigned char *scenes = battle_scenes();
    if (!scenes || source != scenes || destination != scenes + 0xdd580)
        return;
    EquipmentBank bank = {0};
    equipment_capture_bank(scene_inventory(source), &bank);
    attach_preview(scene_inventory(destination), &bank);
}

static void clear_battle(void)
{
    clear_previews();
    equipment_unbind_inventory(battle_pointer);
    battle_pointer = NULL;
    history.occupied = 0;
}

static int bind_battle(void *destination)
{
    if (battle_pointer != destination) {
        clear_battle();
        if (!equipment_bind_inventory(destination, &battle_bank))
            return 0;
        battle_pointer = destination;
    }
    return 1;
}

static void *copy_into_battle(void *destination, const void *source)
{
    void *result = native_copy(destination, source);
    if (resume_pending) {
        if (bind_battle(destination) && equipment_restore_bank(destination, &resumed_battle)) {
            history = resumed_history;
            resume_pending = 0;
        }
        return result;
    }
    if (!source || (source != staging[0].pointer && source != staging[1].pointer)) {
        if (battle_pointer == destination)
            clear_battle();
        return result;
    }
    if (!bind_battle(destination))
        return result;
    /* A new battle can reuse the same manager and numbered slot addresses. */
    clear_previews();
    history.occupied = 0;
    equipment_transfer_inventory(destination, source);
    return result;
}

static unsigned numbered_slot(const void *snapshot, size_t section_offset)
{
    uintptr_t pool;
    memcpy(&pool, snapshot_pool_address, sizeof(pool));
    uintptr_t position = (uintptr_t)snapshot;
    enum { STRIDE = 0x73fc };
    if (!pool || position < pool || position - pool < section_offset)
        return 0;
    size_t delta = position - pool - section_offset;
    return delta < HISTORY_SLOTS * STRIDE && delta % STRIDE == 0
        ? (unsigned)(delta / STRIDE) + 1 : 0;
}

static void capture_turn(const void *manager, void *snapshot, void *extra)
{
    native_capture(manager, snapshot, extra);
    unsigned slot = numbered_slot(snapshot, 0x3f38);
    if (!slot)
        return;
    uint64_t bit = (uint64_t)1 << (slot - 1);
    const void *inventory = (const unsigned char *)manager + 0x64;
    if (inventory == battle_pointer && equipment_capture_bank(inventory, &history.snapshots[slot - 1]))
        history.occupied |= bit;
    else if (!battle_pointer)
        history.occupied &= ~bit;
}

static void restore_turn(void *manager, const void *snapshot, const void *extra)
{
    native_restore(manager, snapshot, extra);
    unsigned slot = numbered_slot(snapshot, 0x3f38);
    if (slot && (history.occupied & ((uint64_t)1 << (slot - 1)))) {
        void *inventory = (unsigned char *)manager + 0x64;
        const EquipmentBank *bank = &history.snapshots[slot - 1];
        if (!equipment_restore_bank(inventory, bank))
            attach_preview(inventory, bank);
    }
}

static void *copy_turn(void *destination, const void *source, size_t size)
{
    void *result = native_copy_bytes(destination, source, size);
    unsigned to = numbered_slot(destination, 0);
    if (to && size == 0x6ea8) {
        unsigned from = numbered_slot(source, 0);
        if (from)
            equipment_copy_history(&history, to, from);
        else
            history.occupied &= ~((uint64_t)1 << (to - 1));
    }
    return result;
}

static void *settle_battle(void *destination, const void *source)
{
    void *result = native_copy(destination, source);
    if (destination == party_pointer && source && source == battle_pointer) {
        equipment_transfer_inventory(destination, source);
        clear_previews();
    }
    return result;
}

EQUIPMENT_API int equipment_set_save_namespace(const uint8_t owner[16])
{
    static const uint8_t empty[16] = {0};
    if (!owner || memcmp(owner, empty, sizeof(empty)) == 0 ||
        (save_namespace_set && memcmp(owner, save_namespace, sizeof(save_namespace))))
        return 0;
    memcpy(save_namespace, owner, sizeof(save_namespace));
    save_namespace_set = 1;
    return 1;
}

EQUIPMENT_API int equipment_read_save_namespace(const wchar_t *config)
{
    /* One spare character lets us detect a value longer than 32 hex digits. */
    wchar_t hex[34];
    if (!config || GetPrivateProfileStringW(L"ModPreparationEquipment", L"SaveNamespace", L"",
                                             hex, sizeof(hex) / sizeof(hex[0]), config) != 32)
        return 0;
    uint8_t owner[16] = {0};
    for (unsigned i = 0; i < 32; i++) {
        wchar_t ch = hex[i];
        unsigned digit;
        if (ch >= L'0' && ch <= L'9')
            digit = ch - L'0';
        else if (ch >= L'a' && ch <= L'f')
            digit = 10 + ch - L'a';
        else
            return 0;
        owner[i / 2] = (uint8_t)((owner[i / 2] << 4) | digit);
    }
    return equipment_set_save_namespace(owner);
}

EQUIPMENT_API int equipment_last_save_status(void)
{
    return save_status;
}

EQUIPMENT_API int equipment_last_load_status(void)
{
    return load_status;
}

/* The archive loader supplies the validated decrypted main-block length. */
EQUIPMENT_API int equipment_load_owned_payload(const uint8_t *payload, size_t length, int suspended)
{
    if (!save_namespace_set || !party_pointer)
        return -1;
    EquipmentBank decoded_party;
    EquipmentBank decoded_battle;
    EquipmentHistory decoded_history;
    int status = suspended
        ? equipment_load_suspend(&decoded_party, &decoded_battle, &decoded_history,
                                 save_namespace, payload, length)
        : equipment_load(&decoded_party, save_namespace, payload, length);
    if (status < 0 || !equipment_restore_bank(party_pointer, &decoded_party))
        return -1;
    clear_battle();
    for (unsigned i = 0; i < 2; i++) {
        equipment_unbind_inventory(staging[i].pointer);
        staging[i].pointer = NULL;
    }
    resume_pending = suspended != 0;
    if (resume_pending) {
        resumed_battle = decoded_battle;
        resumed_history = decoded_history;
    }
    return status;
}

static int valid_owned_payload(const uint8_t *payload, uint32_t length)
{
    if (!payload || length > 0x2f0000 || !save_namespace_set)
        return 0;
    int mode = equipment_payload_mode(payload, length);
    EquipmentBank party, battle;
    EquipmentHistory rewind;
    if (mode == 0)
        return equipment_load(&party, save_namespace, payload, length) >= 0;
    if (mode == 1)
        return equipment_load_suspend(&party, &battle, &rewind, save_namespace, payload, length) >= 0;
    return 0;
}

static void fail_dispatch(SaveDispatch *dispatch)
{
    /* Leave the job attached. The native error dialog and its cleanup read
     * this state, then dispose of the job and its owned buffers. */
    dispatch->code = SAVE_ERROR;
    dispatch->detail = 0;
    dispatch->detail_type = 0;
    dispatch->phase = DISPATCH_FAILED;
}

static void dispatch_save_job(SaveDispatch *dispatch)
{
    const unsigned char *job = dispatch->job;
    const void *vtable = NULL;
    if (job)
        memcpy(&vtable, job, sizeof(vtable));
    if (dispatch == cancel_write && dispatch->phase == DISPATCH_NEW && vtable == write_job_vtable) {
        fail_dispatch(dispatch);
        return;
    }
    if (dispatch->phase == DISPATCH_PENDING && vtable == load_job_vtable) {
        const unsigned char *result;
        memcpy(&result, job + 8, sizeof(result));
        if (result && result[0x1c]) {
            uint32_t code;
            memcpy(&code, result + 0xc, sizeof(code));
            if (!code) {
                const uint8_t *payload;
                uint32_t length;
                memcpy(&payload, job + 0x50, sizeof(payload));
                memcpy(&length, job + 0x58, sizeof(length));
                if (!valid_owned_payload(payload, length)) {
                    load_status = -1;
                    fail_dispatch(dispatch);
                    return;
                }
            }
        }
    }
    native_dispatch(dispatch);
}

static void submit_save_job(SaveDispatch *dispatch, void **job)
{
    SaveDispatch *parent = cancel_write;
    if (save_status != 1)
        cancel_write = dispatch;
    native_submit(dispatch, job);
    cancel_write = parent;
}

static int write_internal_snapshot(void *owner)
{
    native_write_snapshot();
    if (save_status != 1) {
        /* Keep the last buffer intact, but never apply stale state when the
         * current battle's snapshot could not be made. */
        failed_snapshot_owner = owner;
        native_reset_save(load_context);
        return 0;
    }
    failed_snapshot_owner = NULL;
    void *previous;
    memcpy(&previous, (unsigned char *)owner + 0x3a0, sizeof(previous));
    if (previous)
        native_release(previous);
    return 1;
}

static void restore_internal_snapshot(void *owner)
{
    const uint8_t *payload;
    uint32_t length;
    memcpy(&payload, (const unsigned char *)owner + 0x3a0, sizeof(payload));
    memcpy(&length, (const unsigned char *)owner + 0x3a8, sizeof(length));
    if (owner == failed_snapshot_owner ||
        (payload && (!valid_owned_payload(payload, length) || equipment_payload_mode(payload, length) != 0))) {
        load_status = -1;
        return;
    }
    native_restore_snapshot(owner);
}

static void absolute_jump(unsigned char *out, const void *target)
{
    memcpy(out, "\xff\x25\0\0\0\0", 6);
    memcpy(out + 6, &target, sizeof(target));
}

EQUIPMENT_API int equipment_install_save_guards(unsigned char *image, unsigned char *relay, PatchFn patch)
{
    if (guard_image)
        return guard_image == image ? guard_result : 0;
    static const unsigned char dispatch_start[] = {0x40,0x56,0x48,0x83,0xec,0x30,0x48,0xc7,0x44,0x24,0x20,0xfe,0xff,0xff,0xff};
    static const unsigned char snapshot_start[] = {0xe8,0x5a,0xe0,0x03,0x00,0x48,0x8b,0x8b,0xa0,0x03,0x00,0x00,0x48,0x85,0xc9,0x74,0x05,0xe8,0xd9,0x9b,0xd4,0xff};
    enum { DISPATCH = 0x2d9ae0, SNAPSHOT = 0x2edb81,
           TRAMPOLINE = 0, SUBMIT = 32, SNAPSHOT_RESTORE = 48, SNAPSHOT_WRITE = 64 };
    static const struct { unsigned rva, relay_offset; unsigned char before[5]; } calls[] = {
        {0x32b8ca,SUBMIT,{0xe8,0x71,0xf5,0xff,0xff}},
        {0x32ba28,SUBMIT,{0xe8,0x13,0xf4,0xff,0xff}},
        {0x3558c7,SNAPSHOT_RESTORE,{0xe8,0xd4,0x80,0xf9,0xff}},
    };
    enum { CALL_COUNT = sizeof(calls)/sizeof(calls[0]) };
    unsigned char patched_calls[CALL_COUNT][5];
    if (memcmp(image + DISPATCH, dispatch_start, sizeof(dispatch_start)) ||
        memcmp(image + SNAPSHOT, snapshot_start, sizeof(snapshot_start)))
        return 0;
    for (unsigned i = 0; i < CALL_COUNT; i++) {
        intptr_t displacement = (intptr_t)(relay + calls[i].relay_offset) - (intptr_t)(image + calls[i].rva + 5);
        if (displacement < INT32_MIN || displacement > INT32_MAX ||
            memcmp(image + calls[i].rva, calls[i].before, sizeof(calls[i].before)))
            return 0;
        int32_t relative = (int32_t)displacement;
        patched_calls[i][0] = 0xe8;
        memcpy(patched_calls[i] + 1, &relative, sizeof(relative));
    }
    memcpy(relay + TRAMPOLINE, dispatch_start, sizeof(dispatch_start));
    absolute_jump(relay + sizeof(dispatch_start), image + DISPATCH + sizeof(dispatch_start));
    absolute_jump(relay + SUBMIT, submit_save_job);
    absolute_jump(relay + SNAPSHOT_RESTORE, restore_internal_snapshot);
    /* RCX receives the current world owner from RBX. A failed write skips
     * allocation and jumps straight to the native function's epilogue. */
    const unsigned char snapshot_bridge[] = {
        0x48,0x89,0xd9,0x48,0xb8,0,0,0,0,0,0,0,0,0xff,0xd0,0x85,0xc0,0x74,0x0e
    };
    unsigned char *snapshot_relay = relay + SNAPSHOT_WRITE;
    memcpy(snapshot_relay, snapshot_bridge, sizeof(snapshot_bridge));
    int (*write_snapshot)(void *) = write_internal_snapshot;
    memcpy(snapshot_relay + 5, &write_snapshot, sizeof(write_snapshot));
    absolute_jump(snapshot_relay + sizeof(snapshot_bridge), image + SNAPSHOT + sizeof(snapshot_start));
    absolute_jump(snapshot_relay + sizeof(snapshot_bridge) + 14, image + 0x2eddd4);
    FlushInstructionCache(GetCurrentProcess(), relay, SNAPSHOT_WRITE + sizeof(snapshot_bridge) + 28);
    native_dispatch = (DispatchFn)(relay + TRAMPOLINE);
    native_submit = (SubmitFn)(image + 0x32ae40);
    load_job_vtable = image + 0x67f030;
    write_job_vtable = image + 0x67eff0;
    native_write_snapshot = (void (*)(void))(image + 0x32bbe0);
    native_restore_snapshot = (void (*)(void *))(image + 0x2ed9a0);
    native_release = (void (*)(void *))(image + 0x37770);
    native_reset_save = (void (*)(const void *))(image + 0x2d8660);
    unsigned char dispatch_jump[sizeof(dispatch_start)];
    absolute_jump(dispatch_jump, dispatch_save_job);
    dispatch_jump[14] = 0x90;
    unsigned char snapshot_jump[sizeof(snapshot_start)];
    memset(snapshot_jump, 0x90, sizeof(snapshot_jump));
    absolute_jump(snapshot_jump, snapshot_relay);
    int patched = patch(image + DISPATCH, dispatch_jump, sizeof(dispatch_jump)) &&
                  patch(image + SNAPSHOT, snapshot_jump, sizeof(snapshot_jump));
    unsigned attempted = 0;
    while (patched && attempted < CALL_COUNT) {
        patched = patch(image + calls[attempted].rva, patched_calls[attempted], sizeof(patched_calls[attempted]));
        attempted++;
    }
    if (!patched) {
        int restored = patch(image + DISPATCH, dispatch_start, sizeof(dispatch_start));
        if (!patch(image + SNAPSHOT, snapshot_start, sizeof(snapshot_start)))
            restored = 0;
        for (unsigned i = 0; i < attempted; i++) {
            if (!patch(image + calls[i].rva, calls[i].before, sizeof(calls[i].before)))
                restored = 0;
        }
        if (restored)
            return 0;
        guard_result = -1;
    } else {
        guard_result = 1;
    }
    guard_image = image;
    return guard_result;
}

static void close_save(void *context, int suspended)
{
    native_close_save(context);
    save_status = 0;
    if (!save_namespace_set)
        return;
    save_status = -1;
    uint8_t *base, *end;
    memcpy(&base, (uint8_t *)context + 8, sizeof(base));
    memcpy(&end, (uint8_t *)context + 16, sizeof(end));
    enum { CAPACITY = 0x2f0000 };
    if (!base || (uintptr_t)end < (uintptr_t)base ||
        (uintptr_t)end - (uintptr_t)base > CAPACITY)
        return;
    EquipmentBank party, battle;
    if (!equipment_capture_bank(party_pointer, &party))
        return;
    size_t size = (uintptr_t)end - (uintptr_t)base;
    size_t length;
    if (suspended) {
        if (!equipment_capture_bank(battle_pointer, &battle))
            return;
        length = equipment_append_suspend(&party, &battle, &history, save_namespace, base, size, CAPACITY);
    } else {
        length = equipment_append(&party, save_namespace, base, size, CAPACITY);
    }
    if (length) {
        end = base + length;
        memcpy((uint8_t *)context + 16, &end, sizeof(end));
        save_status = 1;
    }
}

static void close_normal_save(void *context)
{
    close_save(context, 0);
}

static void close_suspended_save(void *context)
{
    close_save(context, 1);
}

static void open_save(void *context, void *payload, uint32_t length)
{
    native_open_save(context, payload, length);
    if (context != load_context)
        return;
    load_payload = payload;
    load_length = length;
    load_status = 0;
}

static void read_party(void *party, uint32_t version, void *cursor)
{
    native_read_party(party, version, cursor);
    if (party != party_pointer || !save_namespace_set || !load_payload)
        return;
    const uint8_t *base;
    memcpy(&base, (const uint8_t *)load_context + 8, sizeof(base));
    int mode = base == load_payload ? equipment_payload_mode(load_payload, load_length) : -1;
    load_status = mode < 0 ? -1 : equipment_load_owned_payload(load_payload, load_length, mode);
    load_payload = NULL;
    load_length = 0;
}

static const struct {
    unsigned rva;
    unsigned char original[5];
    void *replacement;
} transfers[] = {
    {0x31d684,{0xe8,0x37,0x9d,0x06,0x00},stage_for_entry},
    {0x31d72e,{0xe8,0x8d,0x9c,0x06,0x00},stage_for_setup},
    {0x39e5ab,{0xe8,0x10,0x8e,0xfe,0xff},copy_into_battle},
    {0x31f1e0,{0xe8,0xdb,0x81,0x06,0x00},settle_battle},
    {0x364f7e,{0xe8,0xcd,0x97,0x03,0x00},capture_turn},
    {0x363237,{0xe8,0xa4,0xb3,0x03,0x00},restore_turn},
    {0x4797e0,{0xe8,0x3d,0x7d,0x0d,0x00},copy_turn},
    {0x32be7c,{0xe8,0xaf,0xd0,0x04,0x00},close_normal_save},
    {0x32c2ad,{0xe8,0x7e,0xcc,0x04,0x00},close_suspended_save},
    {0x32a33b,{0xe8,0x70,0xee,0x04,0x00},open_save},
    {0x2ed9d9,{0xe8,0xd2,0xb7,0x08,0x00},open_save},
    {0x329ce8,{0xe8,0x63,0x24,0xff,0xff},read_party},
    {0x2f5612,{0xe8,0xa9,0x10,0x07,0x00},clone_preview},
    {0x36c631,{0xe8,0x8a,0xa0,0xff,0xff},clone_preview},
    {0x36c753,{0xe8,0x68,0x9f,0xff,0xff},clone_preview},
    {0x36cb8b,{0xe8,0x30,0x9b,0xff,0xff},clone_preview},
};

EQUIPMENT_API int equipment_install_ownership_routes(unsigned char *image, unsigned char *relay, PatchFn patch)
{
    if (installed)
        return installed == image ? install_result : 0;
    enum { COUNT = sizeof(transfers) / sizeof(transfers[0]), STRIDE = 16 };
    unsigned char calls[COUNT][5];
    for (unsigned i = 0; i < COUNT; i++) {
        if (memcmp(image + transfers[i].rva, transfers[i].original, 5))
            return 0;
        intptr_t displacement = (intptr_t)(relay + i * STRIDE) -
                               (intptr_t)(image + transfers[i].rva + 5);
        if (displacement < INT32_MIN || displacement > INT32_MAX)
            return 0;
        int32_t relative = (int32_t)displacement;
        calls[i][0] = 0xe8;
        memcpy(calls[i] + 1, &relative, sizeof(relative));
    }
    native_copy = (CopyFn)(image + 0x3873c0);
    native_capture = (CaptureFn)(image + 0x39e750);
    native_restore = (RestoreFn)(image + 0x39e5e0);
    native_copy_bytes = (CopyBytesFn)(image + 0x551522);
    native_close_save = (CloseSaveFn)(image + 0x378f30);
    native_open_save = (OpenSaveFn)(image + 0x3791b0);
    native_read_party = (ReadPartyFn)(image + 0x31c150);
    native_clone_scene = (CloneSceneFn)(image + 0x3666c0);
    load_context = image + 0xc9c280;
    snapshot_pool_address = image + 0xf2d298;
    battle_scenes_address = image + 0xd6ab80 + 0x1b0;
    party_pointer = image + 0xed3960;
    if (!equipment_bind_inventory(party_pointer, &party_bank))
        return 0;
    for (unsigned i = 0; i < COUNT; i++) {
        unsigned char *entry = relay + i * STRIDE;
        const unsigned char jump[6] = {0xff,0x25,0,0,0,0};
        memcpy(entry, jump, sizeof(jump));
        memcpy(entry + 6, &transfers[i].replacement, 8);
    }
    FlushInstructionCache(GetCurrentProcess(), relay, COUNT * STRIDE);
    for (unsigned i = 0; i < COUNT; i++) {
        if (!patch(image + transfers[i].rva, calls[i], 5)) {
            int restored = 1;
            for (unsigned j = 0; j <= i; j++) {
                if (!patch(image + transfers[j].rva, transfers[j].original, 5))
                    restored = 0;
            }
            if (restored)
                equipment_unbind_inventory(party_pointer);
            else {
                installed = image;
                install_result = -1;
            }
            return restored ? 0 : -1;
        }
    }
    installed = image;
    install_result = 1;
    return 1;
}

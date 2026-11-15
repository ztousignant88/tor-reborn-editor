/* PC 1.0.2 quantity routes. Lab installation until all writers are covered. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stddef.h>
#include <string.h>
#include "equipment_bank.h"

typedef uint8_t *(*AwardFn)(void *, uint8_t *, uint16_t);
typedef uint32_t (*SetFn)(void *, uint16_t, uint16_t);
typedef void (*RemoveFn)(void *, uint16_t);
typedef void (*BulkAwardFn)(void *, const uint16_t *);
typedef uint16_t (*QuantityFn)(const void *, uint16_t);
typedef uint8_t (*HasItemFn)(const void *, uint16_t);
typedef uint8_t (*UniqueFn)(uint16_t);
typedef const void *(*RowTextFn)(const void *, const void *);
typedef int (*PatchFn)(void *, const void *, size_t);

typedef void (*RecordOwnedFn)(unsigned char *, const void *);

static AwardFn original_award;
static SetFn original_set;
static RemoveFn original_remove, original_consume;
static BulkAwardFn original_award_gear, original_award_items, original_award_drops;
static QuantityFn original_quantity;
static HasItemFn original_has_item;
static RecordOwnedFn native_record_owned;
static UniqueFn native_unique;
static RowTextFn native_name_for_row, native_help_for_row;
static const unsigned char *definition_manager;
static unsigned char *installed_image;
static int install_result;
static SRWLOCK inventory_lock = SRWLOCK_INIT;
static struct { const void *inventory; EquipmentBank *bank; } owners[8];

static int is_added(uint16_t id)
{
    return id >= EQUIPMENT_FIRST && id < EQUIPMENT_FIRST + EQUIPMENT_COUNT;
}

static const unsigned char *definition_table(const void *manager)
{
    const unsigned char *table;
    memcpy(&table, (const unsigned char *)manager + 0x78, sizeof(table));
    return table;
}

static int expanded_definition_count(const uint32_t fields[4])
{
    return fields[0] == 0x65636c78 && fields[2] == 16 && fields[3] == 152 &&
           fields[1] >= EQUIPMENT_FIRST && fields[1] <= EQUIPMENT_FIRST + EQUIPMENT_COUNT
        ? (int)fields[1] : EQUIPMENT_FIRST;
}

static const unsigned char *route_definition(const void *manager, uint16_t id)
{
    const unsigned char *table = definition_table(manager);
    if (!table)
        return NULL;
    uint32_t fields[4];
    memcpy(fields, table, sizeof(fields));
    unsigned count = (unsigned)expanded_definition_count(fields);
    return table + fields[2] + (id < count ? (size_t)id * fields[3] : 0);
}

static const void *route_name(const void *manager, uint16_t id)
{
    return native_name_for_row(manager, route_definition(manager, id));
}

static const void *route_help(const void *manager, uint16_t id)
{
    return native_help_for_row(manager, route_definition(manager, id));
}

int equipment_has_added_definition(uint16_t id)
{
    if (!definition_manager || !is_added(id))
        return 0;
    const unsigned char *table = definition_table(definition_manager);
    if (!table)
        return 0;
    uint32_t fields[4];
    memcpy(fields, table, sizeof(fields));
    return id < expanded_definition_count(fields) && table[16 + (size_t)id * 152 + 2] != 0;
}

/* The owner keeps the bank alive until unbind. Never fall back to the party
 * bank for an unknown battle or preview pointer. */
EQUIPMENT_API int equipment_bind_inventory(const void *inventory, EquipmentBank *bank)
{
    if (!inventory || !bank)
        return 0;
    int slot = -1;
    AcquireSRWLockExclusive(&inventory_lock);
    for (unsigned i = 0; i < sizeof(owners) / sizeof(owners[0]); i++) {
        if (owners[i].inventory == inventory || owners[i].bank == bank) {
            int same = owners[i].inventory == inventory && owners[i].bank == bank;
            ReleaseSRWLockExclusive(&inventory_lock);
            return same;
        }
        if (!owners[i].inventory && slot < 0)
            slot = (int)i;
    }
    if (slot >= 0) {
        owners[slot].inventory = inventory;
        owners[slot].bank = bank;
    }
    ReleaseSRWLockExclusive(&inventory_lock);
    return slot >= 0;
}

EQUIPMENT_API void equipment_unbind_inventory(const void *inventory)
{
    if (!inventory)
        return;
    AcquireSRWLockExclusive(&inventory_lock);
    for (unsigned i = 0; i < sizeof(owners) / sizeof(owners[0]); i++) {
        if (owners[i].inventory == inventory) {
            owners[i].inventory = NULL;
            owners[i].bank = NULL;
            break;
        }
    }
    ReleaseSRWLockExclusive(&inventory_lock);
}

static EquipmentBank *owned_bank(const void *inventory)
{
    for (unsigned i = 0; i < sizeof(owners) / sizeof(owners[0]); i++) {
        if (owners[i].inventory == inventory)
            return owners[i].bank;
    }
    return NULL;
}

int equipment_transfer_inventory(const void *destination, const void *source)
{
    AcquireSRWLockExclusive(&inventory_lock);
    EquipmentBank *dst = owned_bank(destination);
    const EquipmentBank *src = owned_bank(source);
    int known = dst && src;
    if (known)
        *dst = *src;
    ReleaseSRWLockExclusive(&inventory_lock);
    return known;
}

int equipment_capture_bank(const void *inventory, EquipmentBank *out)
{
    AcquireSRWLockShared(&inventory_lock);
    const EquipmentBank *bank = owned_bank(inventory);
    if (bank)
        *out = *bank;
    ReleaseSRWLockShared(&inventory_lock);
    return bank != NULL;
}

int equipment_restore_bank(const void *inventory, const EquipmentBank *source)
{
    AcquireSRWLockExclusive(&inventory_lock);
    EquipmentBank *bank = owned_bank(inventory);
    if (bank)
        *bank = *source;
    ReleaseSRWLockExclusive(&inventory_lock);
    return bank != NULL;
}

EQUIPMENT_API int equipment_inventory_count(const void *inventory, uint16_t id)
{
    AcquireSRWLockShared(&inventory_lock);
    EquipmentBank *bank = owned_bank(inventory);
    int count = bank ? equipment_count(bank, id) : -1;
    ReleaseSRWLockShared(&inventory_lock);
    return count;
}

EQUIPMENT_API int equipment_try_award_added(const void *inventory, uint16_t id, unsigned quantity)
{
    if (!is_added(id) || !quantity || quantity > EQUIPMENT_CAP)
        return 0;
    AcquireSRWLockExclusive(&inventory_lock);
    EquipmentBank *bank = owned_bank(inventory);
    int awarded = 0;
    if (bank && equipment_has_added_definition(id)) {
        uint16_t *count = &bank->quantities[id - EQUIPMENT_FIRST];
        unsigned cap = native_unique(id) ? 1 : EQUIPMENT_CAP;
        if (*count + quantity <= cap) {
            *count += (uint16_t)quantity;
            awarded = 1;
        }
    }
    ReleaseSRWLockExclusive(&inventory_lock);
    return awarded;
}

static uint16_t route_quantity(const void *inventory, uint16_t id)
{
    if (!is_added(id))
        return original_quantity(inventory, id);
    int count = equipment_inventory_count(inventory, id);
    return count < 0 ? 0 : (uint16_t)count;
}

static uint8_t route_has_item(const void *inventory, uint16_t id)
{
    if (!is_added(id))
        return original_has_item(inventory, id);
    return route_quantity(inventory, id) != 0;
}

static uint8_t *route_award(void *inventory, uint8_t *result, uint16_t id)
{
    if (!is_added(id))
        return original_award(inventory, result, id);
    AcquireSRWLockExclusive(&inventory_lock);
    EquipmentBank *bank = owned_bank(inventory);
    int status = bank && equipment_has_added_definition(id) ? equipment_award(bank, id, native_unique(id)) : 0;
    ReleaseSRWLockExclusive(&inventory_lock);
    result[0] = (uint8_t)status;
    result[1] = (uint8_t)(status >> 8);
    return result;
}

static uint32_t route_set(void *inventory, uint16_t id, uint16_t count)
{
    if (!is_added(id))
        return original_set(inventory, id, count);
    AcquireSRWLockExclusive(&inventory_lock);
    EquipmentBank *bank = owned_bank(inventory);
    uint32_t remaining = bank && equipment_has_added_definition(id)
        ? (uint32_t)equipment_set(bank, id, count, native_unique(id)) : count;
    ReleaseSRWLockExclusive(&inventory_lock);
    return remaining;
}

static int route_remove_added(void *inventory, uint16_t id)
{
    if (!is_added(id))
        return 0;
    AcquireSRWLockExclusive(&inventory_lock);
    EquipmentBank *bank = owned_bank(inventory);
    if (bank)
        equipment_remove(bank, id);
    ReleaseSRWLockExclusive(&inventory_lock);
    return 1;
}

static void route_remove(void *inventory, uint16_t id)
{
    /* The stock entry returns before its prologue on a zero ID. */
    if (id && !route_remove_added(inventory, id))
        original_remove(inventory, id);
}

static void route_consume(void *inventory, uint16_t id)
{
    if (!route_remove_added(inventory, id))
        original_consume(inventory, id);
}

static void record_owned_equipment(unsigned char *flags, const void *stock_list, const void *inventory)
{
    /* Stock gear and relic definition IDs share a bitmap. Preserve the
     * stock enumeration and add the new IDs after it has set its bits. */
    native_record_owned(flags, stock_list);
    EquipmentBank bank;
    if (!equipment_capture_bank(inventory, &bank))
        return;
    for (unsigned i = 0; i < EQUIPMENT_COUNT; i++) {
        uint16_t id = EQUIPMENT_FIRST + i;
        if (bank.quantities[i] && equipment_has_added_definition(id))
            flags[id / 8] |= (unsigned char)(1u << (id % 8));
    }
}

static void route_award_slots(BulkAwardFn original, void *inventory,
                              const uint16_t *ids, unsigned slots)
{
    uint16_t native_ids[7];
    memcpy(native_ids, ids, slots * sizeof(*ids));
    for (unsigned i = 0; i < slots; i++) {
        if (is_added(native_ids[i]))
            native_ids[i] = 0;
    }
    original(inventory, native_ids);
    for (unsigned i = 0; i < slots; i++) {
        if (is_added(ids[i])) {
            uint8_t result[2];
            route_award(inventory, result, ids[i]);
        }
    }
}

static void route_award_gear(void *inventory, const uint16_t *ids)
{
    route_award_slots(original_award_gear, inventory, ids, 7);
}

static void route_award_items(void *inventory, const uint16_t *ids)
{
    route_award_slots(original_award_items, inventory, ids, 4);
}

static void route_award_drops(void *inventory, const uint16_t *ids)
{
    route_award_slots(original_award_drops, inventory, ids, 4);
}

enum { RECORD_OWNED_ROUTE = 4 };
static const struct {
    unsigned rva, length, skip;
    unsigned char before[19];
    void *replacement;
} routes[] = {
    {0x39a920,15,0,{0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x74,0x24,0x10,0x48,0x89,0x7c,0x24,0x20},route_award},
    {0x39a5d0,15,0,{0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x74,0x24,0x10,0x48,0x89,0x7c,0x24,0x18},route_set},
    {0x39a6b0,19,9,{0x66,0x85,0xd2,0x0f,0x84,0xfc,0x00,0x00,0x00,0x57,0x48,0x83,0xec,0x20,0x48,0x89,0x5c,0x24,0x30},route_remove},
    {0x39a7c0,15,0,{0x44,0x0f,0xb7,0xc2,0xb8,0xd3,0x4d,0x62,0x10,0x41,0xf7,0xe0,0x4c,0x8b,0xc9},route_consume},
    [RECORD_OWNED_ROUTE] =
    {0x31ca06,15,15,{0x48,0x8b,0xd0,0x48,0x8d,0x8e,0x84,0xaa,0x01,0x00,0xe8,0x5b,0x2e,0x12,0x00},NULL},
    {0x2d15a0,14,14,{0x4c,0x8b,0x41,0x78,0xb8,0xf9,0x02,0x00,0x00,0x66,0x3b,0xd0,0x73,0x18},route_definition},
    {0x398130,17,0,{0x40,0x55,0x56,0x57,0x41,0x54,0x41,0x57,0x48,0x83,0xec,0x20,0xbd,0x07,0x00,0x00,0x00},route_award_gear},
    {0x398270,17,0,{0x40,0x56,0x57,0x41,0x56,0x41,0x57,0x48,0x83,0xec,0x38,0x33,0xf6,0x48,0x8d,0x42,0x08},route_award_items},
    {0x3983e0,16,0,{0x40,0x56,0x57,0x41,0x56,0x48,0x83,0xec,0x30,0x4c,0x8d,0x72,0x08,0x48,0x8b,0xfa},route_award_drops},
    {0x2d1670,14,14,{0x4c,0x8b,0x41,0x78,0xb8,0xf9,0x02,0x00,0x00,0x66,0x3b,0xd0,0x73,0x16},route_name},
    {0x2d15d0,14,14,{0x4c,0x8b,0x41,0x78,0xb8,0xf9,0x02,0x00,0x00,0x66,0x3b,0xd0,0x73,0x16},route_help},
    {0x3998d0,15,0,{0x44,0x0f,0xb7,0xc2,0xb8,0xd3,0x4d,0x62,0x10,0x41,0xf7,0xe0,0x4c,0x8b,0xc9},route_quantity},
    {0x39a4e0,15,0,{0x44,0x0f,0xb7,0xc2,0xb8,0xd3,0x4d,0x62,0x10,0x41,0xf7,0xe0,0x4c,0x8b,0xc9},route_has_item},
};

static void jump_to(unsigned char *bytes, void *destination)
{
    bytes[0] = 0xff;
    bytes[1] = 0x25;
    memset(bytes + 2, 0, 4);
    memcpy(bytes + 6, &destination, 8);
}

int equipment_inventory_fingerprints(const unsigned char *image)
{
    for (unsigned i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        if (memcmp(image + routes[i].rva, routes[i].before, routes[i].length))
            return 0;
    }
    return 1;
}

EQUIPMENT_API int equipment_install_inventory_routes(unsigned char *image, PatchFn patch)
{
    if (installed_image)
        return installed_image == image ? install_result : 0;
    if (!equipment_inventory_fingerprints(image))
        return 0;
    enum { STRIDE = 32, RECORD_OWNED_RELAY = 512 };
    unsigned char *relay = VirtualAlloc(NULL, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
    if (!relay)
        return 0;
    for (unsigned i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        unsigned keep = routes[i].length - routes[i].skip;
        if (!keep)
            continue;
        unsigned char *trampoline = relay + STRIDE * i;
        memcpy(trampoline, routes[i].before + routes[i].skip, keep);
        jump_to(trampoline + keep, image + routes[i].rva + routes[i].length);
    }
    /* RAX holds the stock list and RSI holds the party inventory.
     * The enclosing native function has reserved shadow space. */
    unsigned char *record = relay + RECORD_OWNED_RELAY;
    const unsigned char setup[] = {
        0x48,0x89,0xc2,                          /* mov rdx, rax */
        0x48,0x8d,0x8e,0x84,0xaa,0x01,0x00,     /* lea rcx, [rsi + 0x1aa84] */
        0x49,0x89,0xf0,                          /* mov r8, rsi */
        0x48,0xb8,0,0,0,0,0,0,0,0,             /* mov rax, record_owned_equipment */
        0xff,0xd0,                               /* call rax */
    };
    memcpy(record, setup, sizeof(setup));
    void (*record_owned)(unsigned char *, const void *, const void *) = record_owned_equipment;
    memcpy(record + 15, &record_owned, sizeof(record_owned));
    jump_to(record + sizeof(setup), image + routes[RECORD_OWNED_ROUTE].rva + routes[RECORD_OWNED_ROUTE].length);
    FlushInstructionCache(GetCurrentProcess(), relay, 4096);
    original_award = (AwardFn)relay;
    original_set = (SetFn)(relay + STRIDE);
    original_remove = (RemoveFn)(relay + 2 * STRIDE);
    original_consume = (RemoveFn)(relay + 3 * STRIDE);
    native_record_owned = (RecordOwnedFn)(image + 0x43f870);
    original_award_gear = (BulkAwardFn)(relay + 6 * STRIDE);
    original_award_items = (BulkAwardFn)(relay + 7 * STRIDE);
    original_award_drops = (BulkAwardFn)(relay + 8 * STRIDE);
    original_quantity = (QuantityFn)(relay + 11 * STRIDE);
    original_has_item = (HasItemFn)(relay + 12 * STRIDE);
    native_unique = (UniqueFn)(image + 0x334310);
    native_name_for_row = (RowTextFn)(image + 0x2d16d0);
    native_help_for_row = (RowTextFn)(image + 0x2d1630);
    definition_manager = image + 0xd78dd0;
    for (unsigned i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        unsigned char replacement[sizeof(routes[i].before)];
        memset(replacement, 0x90, sizeof(replacement));
        jump_to(replacement, i == RECORD_OWNED_ROUTE ? record : routes[i].replacement);
        if (!patch(image + routes[i].rva, replacement, routes[i].length)) {
            int restored = 1;
            for (unsigned j = 0; j <= i; j++) {
                if (!patch(image + routes[j].rva, routes[j].before, routes[j].length))
                    restored = 0;
            }
            if (restored)
                VirtualFree(relay, 0, MEM_RELEASE);
            else {
                installed_image = image;
                install_result = -1;
            }
            return restored ? 0 : -1;
        }
    }
    installed_image = image;
    install_result = 1;
    return 1;
}

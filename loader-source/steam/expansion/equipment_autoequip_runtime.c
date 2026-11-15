/* PC 1.0.2 auto-equip: keep stock scratch buffers and widen the selectors' view. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string.h>
#include "equipment_bank.h"

enum { STOCK_CAPACITY = 0x736, WIDE_CAPACITY = STOCK_CAPACITY + EQUIPMENT_COUNT };

typedef struct {
    uint16_t ids[WIDE_CAPACITY];
    uint32_t count;
} WideList;

_Static_assert(offsetof(WideList,count)==0xf6c,"Native selector displacement");

typedef struct {
    const void *inventory;
    WideList list;
} AutoEquipFrame;

typedef uintptr_t (*AutoEquipFn)(void *, void *, unsigned char, void *);
typedef int (*PatchFn)(void *, const void *, size_t);

static _Thread_local AutoEquipFrame *current_frame;
static const WideList empty_list;
static AutoEquipFn native_autoequip;
static unsigned char *installed_image;
static int install_result;

static uintptr_t route_autoequip(void *unit, void *inventory, unsigned char use_inventory, void *entry)
{
    AutoEquipFrame frame;
    frame.inventory = use_inventory ? inventory : NULL;
    AutoEquipFrame *parent = current_frame;
    current_frame = &frame;
    uintptr_t result = native_autoequip(unit, inventory, use_inventory, entry);
    current_frame = parent;
    return result;
}

static const WideList *copy_for_selector(void *stock_copy, const void *ids, size_t bytes)
{
    AutoEquipFrame *frame = current_frame;
    if (!frame || bytes > STOCK_CAPACITY * sizeof(uint16_t) || bytes % sizeof(uint16_t))
        return &empty_list;

    memcpy(stock_copy, ids, bytes);
    WideList *list = &frame->list;
    memcpy(list->ids, stock_copy, bytes);
    list->count = (uint32_t)(bytes / sizeof(uint16_t));
    EquipmentBank bank;
    if (frame->inventory && equipment_capture_bank(frame->inventory, &bank)) {
        for (unsigned index = 0; index < EQUIPMENT_COUNT; index++) {
            uint16_t id = EQUIPMENT_FIRST + index;
            if (bank.quantities[index] && equipment_has_added_definition(id))
                list->ids[list->count++] = id;
        }
    }
    return list;
}

/* Stock enumerators still write no more than 1,846 IDs to their local arrays.
 * The copy relay also prepares a 1,974-ID view and returns it in RAX.
 * The regular selectors and the inlined shield loop all use that view. */
static const struct {
    unsigned rva, length;
    unsigned char before[27], after[27];
} edits[] = {
    {0x444750,15,{0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x6c,0x24,0x10,0x48,0x89,0x74,0x24,0x18},{0}},
    {0x4449d7,5,{0xe8,0x4c,0xcb,0x10,0x00},{0}},
    {0x444c07,5,{0xe8,0x1c,0xc9,0x10,0x00},{0}},
    {0x444e74,5,{0xe8,0xaf,0xc6,0x10,0x00},{0}},
    {0x4449e0,7,{0x48,0x8d,0x85,0xd0,0x0d,0x00,0x00},{0x90,0x90,0x90,0x90,0x90,0x90,0x90}},
    {0x444c10,7,{0x48,0x8d,0x85,0xd0,0x0d,0x00,0x00},{0x90,0x90,0x90,0x90,0x90,0x90,0x90}},
    {0x444e7e,4,{0x48,0x8d,0x45,0x80},{0x90,0x90,0x90,0x90}},
    {0x444eb5,27,{0x44,0x8b,0xa5,0xec,0x0d,0x00,0x00,0x48,0x8d,0x45,0x80,0x45,0x33,0xc0,0x48,0x8d,0x55,0x80,0xb9,0x36,0x07,0x00,0x00,0x48,0x8d,0x5d,0x80},
                 {0x48,0x8b,0x44,0x24,0x60,0x44,0x8b,0xa0,0x6c,0x0f,0x00,0x00,0x45,0x33,0xc0,
                  0x48,0x89,0xc2,0xb9,0x36,0x07,0x00,0x00,0x48,0x89,0xc3,0x90}},
    {0x443e7b,7,{0x44,0x8b,0xa3,0x6c,0x0e,0x00,0x00},{0x44,0x8b,0xa3,0x6c,0x0f,0x00,0x00}},
    {0x44401d,6,{0x8b,0x8f,0x6c,0x0e,0x00,0x00},{0x8b,0x8f,0x6c,0x0f,0x00,0x00}},
    {0x44428d,6,{0x8b,0x8f,0x6c,0x0e,0x00,0x00},{0x8b,0x8f,0x6c,0x0f,0x00,0x00}},
};

static void absolute_jump(unsigned char *out, const void *target)
{
    static const unsigned char opcode[] = {0xff,0x25,0,0,0,0};
    memcpy(out, opcode, sizeof(opcode));
    memcpy(out + sizeof(opcode), &target, sizeof(target));
}

EQUIPMENT_API int equipment_install_autoequip_routes(unsigned char *image, unsigned char *relay, PatchFn patch)
{
    if (installed_image)
        return installed_image == image ? install_result : 0;
    enum { COUNT = sizeof(edits) / sizeof(edits[0]), COPY_RELAY = 32 };
    unsigned char replacements[COUNT][sizeof(edits[0].before)];
    for (unsigned i = 0; i < COUNT; i++) {
        if (memcmp(image + edits[i].rva, edits[i].before, edits[i].length))
            return 0;
        memcpy(replacements[i], edits[i].after, edits[i].length);
    }
    for (unsigned i = 1; i <= 3; i++) {
        intptr_t offset = (intptr_t)(relay + COPY_RELAY) - (intptr_t)(image + edits[i].rva + 5);
        if (offset < INT32_MIN || offset > INT32_MAX)
            return 0;
        int32_t displacement = (int32_t)offset;
        replacements[i][0] = 0xe8;
        memcpy(replacements[i] + 1, &displacement, sizeof(displacement));
    }
    absolute_jump(replacements[0], route_autoequip);
    replacements[0][14] = 0x90;
    memcpy(relay, edits[0].before, edits[0].length);
    absolute_jump(relay + edits[0].length, image + edits[0].rva + edits[0].length);
    absolute_jump(relay + COPY_RELAY, copy_for_selector);
    FlushInstructionCache(GetCurrentProcess(), relay, COPY_RELAY + 14);
    native_autoequip = (AutoEquipFn)relay;

    for (unsigned i = 0; i < COUNT; i++) {
        if (!patch(image + edits[i].rva, replacements[i], edits[i].length)) {
            int restored = 1;
            for (unsigned j = 0; j <= i; j++) {
                if (!patch(image + edits[j].rva, edits[j].before, edits[j].length))
                    restored = 0;
            }
            if (restored)
                return 0;
            installed_image = image;
            install_result = -1;
            return -1;
        }
    }
    installed_image = image;
    install_result = 1;
    return 1;
}

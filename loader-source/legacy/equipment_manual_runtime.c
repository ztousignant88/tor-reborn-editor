/* PC 1.0.2 manual equipment and shop catalog routes. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string.h>
#include "equipment_bank.h"

enum {
    STOCK_EQUIPMENT_ROWS = 1846,
    SUNDRY_ROWS = 1000,
    /* Two spare positions for the native empty-row writes. */
    ROW_CAPACITY = STOCK_EQUIPMENT_ROWS + SUNDRY_ROWS + EQUIPMENT_COUNT + 2,
    ROW_BYTES = ROW_CAPACITY * 0x70,
    BACKUP_ROWS = 0x1168 + ROW_BYTES,
    SCREEN_FIELDS = BACKUP_ROWS + ROW_BYTES,
    CANDIDATE_OFFSET = SCREEN_FIELDS + 0x28,
    SCREEN_BYTES = CANDIDATE_OFFSET + ROW_CAPACITY * sizeof(uint16_t),
    CATEGORY_COUNT = 32,
    /* A multiple of eight keeps the shop's trailing fields aligned. */
    SHOP_EXTRA = (ROW_CAPACITY - STOCK_EQUIPMENT_ROWS + 7) & ~7,
    SHOP_CAPACITY = STOCK_EQUIPMENT_ROWS + SHOP_EXTRA,
    SHOP_ROW_DELTA = SHOP_EXTRA * 0x70,
    SHOP_FLAG_DELTA = SHOP_ROW_DELTA + SHOP_EXTRA * sizeof(uint16_t),
    SHOP_TRAILING_DELTA = SHOP_FLAG_DELTA + SHOP_EXTRA,
    SHOP_BYTES = 0x34870 + SHOP_TRAILING_DELTA,
};

typedef struct {
    const uint16_t *categories;
    int count;
} CategorySpan;

typedef int (*PatchFn)(void *, const void *, size_t);
typedef int (*CategoryFn)(const void *, uint16_t *, uint16_t, uint8_t, uint8_t);
typedef int (*CategoriesFn)(const void *, uint16_t *, const CategorySpan *, uint8_t, uint8_t);
typedef int (*TabsFn)(uint16_t *, int);
typedef uint16_t (*ItemCategoryFn)(uint16_t);
typedef unsigned char *(*ContextFn)(void);
typedef void (*SortFn)(void *, unsigned, uint16_t *, int);
typedef void (*SortRecipesFn)(void *, uint16_t *, int);

typedef struct {
    unsigned char *image;
    int result;
} InstallState;

static InstallState manual, shop, slot;

static int collect_equipment(const unsigned char *game, const void *inventory, uint16_t *out,
                             int category, int tab, uint8_t hide_key)
{
    if (!inventory) {
        out[0] = 0;
        return 0;
    }
    uint16_t categories[CATEGORY_COUNT];
    int category_count = 1;
    categories[0] = (uint16_t)category;
    if (category == 0xff) {
        const TabsFn native_categories = (TabsFn)(game + 0x467560);
        int count = native_categories(categories, tab);
        if (count <= 0 || count > CATEGORY_COUNT)
            return 0;
        /* A type can appear only once so a tab cannot enumerate one ID twice. */
        category_count = 0;
        for (int i = 0; i < count; i++) {
            uint16_t candidate = categories[i];
            int match = 0;
            while (match < category_count && categories[match] != candidate)
                match++;
            if (match == category_count)
                categories[category_count++] = candidate;
        }
    }

    int count;
    if (category == 0xff) {
        const CategoriesFn collect = (CategoriesFn)(game + 0x399640);
        CategorySpan span = {categories, category_count};
        count = collect(inventory, out, &span, 0, hide_key);
    } else {
        const CategoryFn collect = (CategoryFn)(game + 0x399440);
        count = collect(inventory, out, categories[0], 0, hide_key);
    }

    EquipmentBank bank;
    if (equipment_capture_bank(inventory, &bank)) {
        const ItemCategoryFn item_category = (ItemCategoryFn)(game + 0x3335b0);
        uint8_t (*is_key)(uint16_t) = (void *)(game + 0x334280);
        for (unsigned index = 0; index < EQUIPMENT_COUNT; index++) {
            uint16_t id = EQUIPMENT_FIRST + index;
            if (!bank.quantities[index] || !equipment_has_added_definition(id))
                continue;
            uint16_t type = item_category(id);
            if (type >= 0x20 || (hide_key && is_key(id)))
                continue;
            for (int i = 0; i < category_count; i++) {
                if (categories[i] == type) {
                    out[count++] = id;
                    break;
                }
            }
        }
    }
    if (count > 1) {
        const ContextFn menu_context = (ContextFn)(game + 0x2c6080);
        void *sort_state = menu_context() + 0x500;
        if (category == 0x22)
            ((SortRecipesFn)(game + 0x2c6a70))(sort_state, out, count);
        else
            ((SortFn)(game + 0x2c6b20))(sort_state, out[0] / 1000, out, count);
    }
    return count;
}

static int collect_party(uint16_t *out, int category, int tab)
{
    return collect_equipment(manual.image, manual.image + 0xee4380, out, category, tab, 0);
}

static int collect_battle(uint16_t *out, int category, int tab)
{
    const ContextFn battle_inventory = (ContextFn)(manual.image + 0x3424d0);
    return collect_equipment(manual.image, battle_inventory(), out, category, tab, 0);
}

static int collect_shop_sell(uint16_t *out, int category, int tab, uint8_t hide_key)
{
    return collect_equipment(shop.image, shop.image + 0xee4380, out, category, tab, hide_key);
}

static int count_shop_tab(uint16_t *stock_scratch, int category, int tab, uint8_t hide_key)
{
    (void)stock_scratch; /* The caller only reads the returned count. */
    uint16_t scratch[ROW_CAPACITY];
    return collect_shop_sell(scratch, category, tab, hide_key);
}

static int collect_shop_owned(uint16_t *out, int category, int tab, uint8_t hide_key)
{
    uint16_t scratch[ROW_CAPACITY];
    int count = collect_shop_sell(scratch, category, tab, hide_key);
    /* The native merge accepts only ordinary gear. Its old scratch buffer
     * fits every ordinary ID once we drop sundries and instance IDs here. */
    int ordinary = 0;
    for (int i = 0; i < count; i++)
        if (scratch[i] < 1000)
            out[ordinary++] = scratch[i];
    return ordinary;
}

typedef struct {
    unsigned rva, field, length;
    uint32_t value;
    const char *before, *after;
} LayoutEdit;

typedef struct {
    unsigned rva;
    unsigned char before[5];
    const void *target;
} CallEdit;

#define EDIT(rva, field, value, original) {rva, field, sizeof(original) - 1, value, original, NULL}
#define RAW(rva, original, replacement) {rva, 0, sizeof(original) - 1, 0, original, replacement}
static const LayoutEdit manual_layout[] = {
#include "equipment_manual_layout.inc"
};
static const LayoutEdit shop_layout[] = {
#include "equipment_shop_layout.inc"
};
static const LayoutEdit slot_layout[] = {
#include "equipment_slot_layout.inc"
};
#undef EDIT
#undef RAW

typedef void (*SlotRowFn)(void *);

/* The individual-slot chooser keeps its original native stack frame. Its
 * candidate and format scratch live in the enlarged widget's owned tail. */
__attribute__((used, noinline))
static int slot_collect(unsigned char *widget, int category, int tab, uint8_t battle)
{
    const void *inventory = battle ? ((ContextFn)(slot.image + 0x3424d0))()
                                   : slot.image + 0xee4380;
    uint16_t *ids = (void *)(widget + SLOT_IDS);
    int count = collect_equipment(slot.image, inventory, ids, category, tab, 0);
    SlotRowFn initialize = (SlotRowFn)(slot.image + 0x2fb300);
    for (int i = 0; i < count; i++)
        initialize(widget + SLOT_SCRATCH + i * 0x70);
    return count;
}

__attribute__((naked)) static void slot_collect_bridge(void)
{
    __asm__("mov %rbp, %rcx\n\tjmp slot_collect");
}

/* Other tabs keep their stock scratch sizes. Clear the new widget rows once
 * when the native loop starts so old equipment entries cannot survive a switch. */
__attribute__((used, noinline))
static void slot_clear(unsigned char *row, unsigned char *widget)
{
    SlotRowFn clear = (SlotRowFn)(slot.image + 0x3d6400);
    if (row == widget + 0x7e0)
        for (unsigned i = STOCK_EQUIPMENT_ROWS; i < ROW_CAPACITY; i++)
            clear(row + i * 0x70);
    clear(row);
}

__attribute__((naked)) static void slot_clear_rsi(void)
{
    __asm__("mov %rsi, %rdx\n\tjmp slot_clear");
}

__attribute__((naked)) static void slot_clear_rbp(void)
{
    __asm__("mov %rbp, %rdx\n\tjmp slot_clear");
}

/* The existing class filter at 0x462FA0 still receives the list and count. */
static const CallEdit manual_calls[] = {
    {0x462fb0, {0xe8,0x0b,0xe2,0xff,0xff}, collect_battle},
    {0x462fba, {0xe8,0x51,0xdb,0xff,0xff}, collect_party},
};
static const CallEdit shop_calls[] = {
    {0x40220b, {0xe8,0x00,0xe9,0x05,0x00}, collect_shop_sell},
    {0x4644f3, {0xe8,0x18,0xc6,0xff,0xff}, count_shop_tab},
    {0x46291c, {0xe8,0xef,0xe1,0xff,0xff}, collect_shop_owned},
};
static const CallEdit slot_calls[] = {
    {0x51aab7, {0xe8,0x14,0x6b,0xf4,0xff}, slot_collect_bridge},
    {0x51b58a, {0xe8,0x71,0xae,0xeb,0xff}, slot_clear_rsi},
    {0x51be3b, {0xe8,0xc0,0xa5,0xeb,0xff}, slot_clear_rsi},
    {0x51cd8a, {0xe8,0x71,0x96,0xeb,0xff}, slot_clear_rbp},
};

static int install_routes(InstallState *state, unsigned char *image, unsigned char *relay, PatchFn patch,
                          const LayoutEdit *layout, unsigned layout_count,
                          const CallEdit *calls, unsigned call_count)
{
    if (state->image)
        return state->image == image ? state->result : 0;
    enum { RELAY_STRIDE = 16 };
    struct {
        unsigned rva, length;
        const void *before;
        unsigned char after[32];
    } edits[layout_count + call_count];
    for (unsigned i = 0; i < layout_count; i++) {
        if (layout[i].length > sizeof(edits[i].after) ||
            (!layout[i].after && layout[i].field + 4 > layout[i].length))
            return 0;
        edits[i].rva = layout[i].rva;
        edits[i].length = layout[i].length;
        edits[i].before = layout[i].before;
        memcpy(edits[i].after, layout[i].after ? layout[i].after : layout[i].before, layout[i].length);
        if (!layout[i].after)
            memcpy(edits[i].after + layout[i].field, &layout[i].value, sizeof(layout[i].value));
    }
    for (unsigned i = 0; i < call_count; i++) {
        unsigned index = layout_count + i;
        unsigned char *stub = relay + i * RELAY_STRIDE;
        intptr_t offset = (intptr_t)stub - (intptr_t)(image + calls[i].rva + 5);
        if (offset < INT32_MIN || offset > INT32_MAX)
            return 0;
        int32_t displacement = (int32_t)offset;
        edits[index].rva = calls[i].rva;
        edits[index].length = sizeof(calls[i].before);
        edits[index].before = calls[i].before;
        edits[index].after[0] = 0xe8;
        memcpy(edits[index].after + 1, &displacement, sizeof(displacement));
    }
    for (unsigned i = 0; i < layout_count + call_count; i++) {
        if (memcmp(image + edits[i].rva, edits[i].before, edits[i].length))
            return 0;
    }
    for (unsigned i = 0; i < call_count; i++) {
        unsigned char *stub = relay + i * RELAY_STRIDE;
        memcpy(stub, "\xff\x25\0\0\0\0", 6);
        memcpy(stub + 6, &calls[i].target, sizeof(calls[i].target));
    }
    FlushInstructionCache(GetCurrentProcess(), relay, call_count * RELAY_STRIDE);
    state->image = image;
    for (unsigned i = 0; i < layout_count + call_count; i++) {
        if (!patch(image + edits[i].rva, edits[i].after, edits[i].length)) {
            int restored = 1;
            for (unsigned j = 0; j <= i; j++) {
                if (!patch(image + edits[j].rva, edits[j].before, edits[j].length))
                    restored = 0;
            }
            if (restored)
                state->image = NULL;
            state->result = restored ? 0 : -1;
            return state->result;
        }
    }
    state->result = 1;
    return 1;
}

#define COUNT(array) (sizeof(array) / sizeof((array)[0]))
EQUIPMENT_API int equipment_install_manual_routes(unsigned char *image, unsigned char *relay, PatchFn patch)
{
    return install_routes(&manual, image, relay, patch, manual_layout, COUNT(manual_layout),
                          manual_calls, COUNT(manual_calls));
}

EQUIPMENT_API int equipment_install_shop_routes(unsigned char *image, unsigned char *relay, PatchFn patch)
{
    return install_routes(&shop, image, relay, patch, shop_layout, COUNT(shop_layout),
                          shop_calls, COUNT(shop_calls));
}

EQUIPMENT_API int equipment_install_slot_routes(unsigned char *image, unsigned char *relay, PatchFn patch)
{
    return install_routes(&slot, image, relay, patch, slot_layout, COUNT(slot_layout),
                          slot_calls, COUNT(slot_calls));
}

/* Keep the engine's Face allocation at its stock size. The added compressed
 * slots use separate Windows storage and are released with the native block. */
enum { PORTRAIT_SLOT_BYTES = 0x28000, PORTRAIT_STOCK_COUNT = 105 };

struct PortraitCache {
    uint8_t native_header[0x348];
    uint8_t *data;
    uint32_t insertion_cursor;
};

struct PortraitRow {
    int16_t id;
    uint16_t references;
    int32_t length;
};

_Static_assert(offsetof(struct PortraitCache, insertion_cursor) == 0x350, "native portrait cache layout");
_Static_assert(sizeof(struct PortraitRow) == 8, "native compressed portrait index layout");

static void *(*portrait_native_allocate)(size_t, unsigned, unsigned, const char *, unsigned);
static void (*portrait_native_free)(void *);
static uint8_t (*portrait_native_render)(struct PortraitCache *, void *, int, const uint8_t *, int, uint8_t, uint8_t);
static uint8_t (*portrait_native_render_mode)(struct PortraitCache *, void *, int, const uint8_t *, int, int, uint8_t, uint8_t);
static struct PortraitRow portrait_index[PILOT_PORTRAIT_COUNT];
static const uint8_t *portrait_owner;
static uint8_t *portrait_extra;

static void clear_portrait_allocation(void)
{
    if (portrait_extra)
        VirtualFree(portrait_extra, 0, MEM_RELEASE);
    portrait_extra = NULL;
    portrait_owner = NULL;
}

static void *portrait_allocate_entry(size_t length, unsigned alignment, unsigned kind, const char *file, unsigned line)
{
    uint8_t *data = portrait_native_allocate(length, alignment, kind, file, line);
    clear_portrait_allocation();
    if (data) {
        portrait_extra = VirtualAlloc(NULL, (PILOT_PORTRAIT_COUNT - PORTRAIT_STOCK_COUNT) * PORTRAIT_SLOT_BYTES,
                                      MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
        portrait_owner = data;
        for (unsigned i = 0; i < PILOT_PORTRAIT_COUNT; ++i)
            portrait_index[i] = (struct PortraitRow){.id = -1};
    }
    return data;
}

static void portrait_free_entry(void *data)
{
    if (data == portrait_owner)
        clear_portrait_allocation();
    portrait_native_free(data);
}

static struct PortraitRow *portrait_rows(const struct PortraitCache *cache)
{
    return cache && cache->data && cache->data == portrait_owner ? portrait_index : NULL;
}

static unsigned portrait_capacity(void)
{
    return portrait_extra ? PILOT_PORTRAIT_COUNT : PORTRAIT_STOCK_COUNT;
}

static uint8_t *portrait_pixels(const struct PortraitCache *cache, size_t slot)
{
    if (slot < PORTRAIT_STOCK_COUNT)
        return cache->data + slot * PORTRAIT_SLOT_BYTES;
    return portrait_extra + (slot - PORTRAIT_STOCK_COUNT) * PORTRAIT_SLOT_BYTES;
}

static struct PortraitRow *find_portrait(struct PortraitRow *rows, int id)
{
    if (!rows || id < 0 || id > INT16_MAX)
        return NULL;
    for (unsigned i = 0, count = portrait_capacity(); i < count; ++i) {
        if (rows[i].id == id)
            return &rows[i];
    }
    return NULL;
}

static void retain_portrait(struct PortraitRow *row)
{
    if (row->references < UINT16_MAX)
        ++row->references;
}

static void portrait_reset_references_entry(struct PortraitCache *cache)
{
    struct PortraitRow *rows = portrait_rows(cache);
    if (rows) {
        for (unsigned i = 0, count = portrait_capacity(); i < count; ++i)
            rows[i].references = 0;
    }
}

static void portrait_retain_entry(struct PortraitCache *cache, int id)
{
    struct PortraitRow *row = find_portrait(portrait_rows(cache), id);
    if (row)
        retain_portrait(row);
}

static void portrait_release_entry(struct PortraitCache *cache, int id)
{
    struct PortraitRow *row = find_portrait(portrait_rows(cache), id);
    if (row && row->references)
        --row->references;
}

static uint8_t portrait_contains_entry(struct PortraitCache *cache, int id)
{
    return find_portrait(portrait_rows(cache), id) != NULL;
}

static void portrait_store_entry(struct PortraitCache *cache, const uint8_t *encoded, int length, int id)
{
    struct PortraitRow *rows = portrait_rows(cache);
    if (!rows || !encoded || length <= 0 || length > PORTRAIT_SLOT_BYTES || id < 0 || id > INT16_MAX)
        return;
    struct PortraitRow *row = find_portrait(rows, id);
    if (row) {
        retain_portrait(row);
        return;
    }
    unsigned count = portrait_capacity();
    unsigned cursor = cache->insertion_cursor % count;
    for (unsigned i = 0; i < count; ++i) {
        unsigned slot = (cursor + i) % count;
        if (rows[slot].references)
            continue;
        memcpy(portrait_pixels(cache, slot), encoded, (size_t)length);
        rows[slot] = (struct PortraitRow){(int16_t)id, 1, length};
        cache->insertion_cursor = (cursor + 1) % count;
        return;
    }
}

static uint8_t portrait_render_entry(struct PortraitCache *cache, void *target, int id, uint8_t first, uint8_t second)
{
    struct PortraitRow *rows = portrait_rows(cache);
    const struct PortraitRow *row = find_portrait(rows, id);
    if (!row)
        return 0;
    const uint8_t *encoded = portrait_pixels(cache, (size_t)(row - rows));
    return portrait_native_render(cache, target, id, encoded, row->length, first, second);
}

static uint8_t portrait_render_mode_entry(struct PortraitCache *cache, void *target, int id, int mode,
                                          uint8_t first, uint8_t second)
{
    struct PortraitRow *rows = portrait_rows(cache);
    const struct PortraitRow *row = find_portrait(rows, id);
    if (!row)
        return 0;
    const uint8_t *encoded = portrait_pixels(cache, (size_t)(row - rows));
    return portrait_native_render_mode(cache, target, id, encoded, row->length, mode, first, second);
}

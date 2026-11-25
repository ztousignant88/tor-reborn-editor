/* Unit Details and equip-picker adapters. Keep the original four-slot render
 * buffer and feed it one bank at a time. The UI objects' cached ID arrays
 * themselves must be allocated for eight before the draw loops are enabled. */
typedef uint8_t *(*LoadoutIconEntry)(const void *, uint8_t *, unsigned);

static uint8_t *loadout_widget_pointer(const uint8_t *widget, unsigned field) {
    uint8_t *value;
    memcpy(&value, widget + field, sizeof(value));
    return value;
}

static void loadout_expand_grid(uint8_t *grid) {
    enum { COUNT = 0x80, ROW_STEP = 0x84, COLUMNS = 0x9a, ROWS = 0x9c, PITCH = 64 };
    if (!grid || loadout_word(grid + COLUMNS) != LOADOUT_STOCK) return;
    uint8_t *viewport = loadout_widget_pointer(grid, 0x10);
    uint8_t *part = loadout_widget_pointer(grid, 0x28);
    const unsigned count = loadout_word(grid + COUNT);
    const unsigned pitch = loadout_word(grid + ROW_STEP);
    if (!viewport || !part || (count != LOADOUT_STOCK && count != LOADOUT_SLOTS) ||
        (pitch != 80 && pitch != PITCH)) return;

    /* The direction handler uses the live slot count, rows and viewport
     * height. Reconcile the native grid with the eight-slot drawing path
     * before slot handlers are populated. */
    if (count != LOADOUT_SLOTS || pitch != PITCH || loadout_word(grid + ROWS) != 2) {
        typedef void (*SetCount)(uint8_t *, unsigned);
        const uint16_t step = PITCH;
        const float spacing = PITCH;
        memcpy(grid + ROW_STEP, &step, sizeof(step));
        memcpy(part + 0x394, &spacing, sizeof(spacing));
        ((SetCount)(mm_base + 0x280320))(grid, LOADOUT_SLOTS);
    }

    float bounds[4];
    memcpy(bounds, viewport + 0x140, sizeof(bounds));
    if (bounds[3] >= PITCH && bounds[3] < 2 * PITCH) {
        typedef void (*SetBounds)(uint8_t *, int, int, int, int);
        ((SetBounds)(mm_base + 0x2794c0))(viewport, (int)bounds[0], (int)bounds[1],
                                        (int)bounds[2], 2 * PITCH);
    }
}

static uint8_t *loadout_resolve_grid(void *layout, uint32_t name) {
    typedef uint8_t *(*Resolve)(void *, uint32_t);
    uint8_t *widget = ((Resolve)(mm_base + 0x266360))(layout, name);
    if (widget) loadout_expand_grid(loadout_widget_pointer(widget, 0xb8));
    return widget;
}

static uint8_t *loadout_spell_icon(const void *first, uint8_t *entry, unsigned slot, const uint8_t *unit) {
    const LoadoutIconEntry get = (LoadoutIconEntry)(mm_base + 0x43f830);
    if (slot < LOADOUT_STOCK) return get(first, entry, slot);
    /* The stock initializer clears 20 bytes even though the first twelve
     * carry the four IDs and class restriction flags. */
    uint8_t bank[20] = {0};
    if (slot < LOADOUT_SLOTS && loadout_has_extension(unit)) {
        typedef void *(*Build)(const uint8_t *, void *);
        uint8_t copy[LOADOUT_CORE_PREFIX];
        memcpy(copy, unit, sizeof(copy));
        memcpy(copy + LOADOUT_SPELL_AT, unit + LOADOUT_EXTRA_SPELL_AT, 2 * LOADOUT_STOCK);
        ((Build)(mm_base + 0x331fa0))(copy, bank);
    }
    return get(bank, entry, slot % LOADOUT_STOCK);
}

static uint8_t *loadout_skill_icon(const void *first, uint8_t *entry, unsigned slot, const uint8_t *unit) {
    const LoadoutIconEntry get = (LoadoutIconEntry)(mm_base + 0x43f830);
    if (slot < LOADOUT_STOCK) return get(first, entry, slot);
    uint8_t bank[16] = {0};
    if (slot < LOADOUT_SLOTS && loadout_has_extension(unit)) {
        typedef uint16_t *(*Context)(const uint8_t *, uint16_t *);
        typedef const uint8_t *(*PartyUnit)(uint8_t *, const uint8_t *);
        typedef void *(*Build)(const uint8_t *, void *, uint16_t *);
        uint8_t copy[LOADOUT_CORE_PREFIX];
        uint16_t context[3];
        loadout_copy_extra_skills(copy, unit);
        const uint8_t *party = ((PartyUnit)(mm_base + 0x31ecc0))(mm_base + 0xed3960, unit);
        ((Context)(mm_base + 0x3338d0))(party ? party + 0x40 : unit, context);
        ((Build)(mm_base + 0x333940))(copy, bank, context);
    }
    return get(bank, entry, slot % LOADOUT_STOCK);
}

static uint8_t *loadout_picker_unit(const uint8_t *dialog) {
    uint8_t *unit;
    memcpy(&unit, dialog + 0x7d0, sizeof(unit));
    return unit;
}

static unsigned loadout_picker_category(const uint8_t *dialog) {
    uint32_t category;
    memcpy(&category, dialog + 0x7c4, sizeof(category));
    return category;
}

static uint16_t loadout_picker_current(const uint8_t *dialog) {
    const uint8_t *unit = loadout_picker_unit(dialog);
    const unsigned slot = dialog[0x7c0];
    return loadout_picker_category(dialog) == 3 ? loadout_effect_at(unit, slot) : loadout_skill_id_at(unit, slot);
}

static uint8_t loadout_picker_matches(uint8_t *dialog, uint32_t id) {
    typedef uint8_t (*Matches)(uint8_t *, uint32_t);
    const unsigned category = loadout_picker_category(dialog);
    if (category != 2 && category != 3) return ((Matches)(mm_base + 0x51be60))(dialog, id);
    if (category == 2 && id && id <= UINT16_MAX) {
        return loadout_skill_family_at(loadout_picker_unit(dialog), dialog[0x7c0]) == loadout_skill_family((uint16_t)id);
    }
    return !id || loadout_picker_current(dialog) == id;
}

static void loadout_picker_equip(uint8_t *dialog, uint16_t id) {
    uint8_t *unit = loadout_picker_unit(dialog);
    const unsigned slot = dialog[0x7c0];
    if (loadout_picker_category(dialog) == 3) {
        loadout_equip_effect(unit, slot, id);
    } else {
        typedef void (*RefreshStats)(uint8_t *, unsigned);
        loadout_equip_skill(unit, slot, id);
        ((RefreshStats)(mm_base + 0x462450))(unit, 0);
    }
}

static uint8_t loadout_unit_has_skill(const uint8_t *unit, uint16_t id) {
    if (!id) return 0;
    const uint16_t family = loadout_skill_family(id);
    for (unsigned slot = 0; slot < LOADOUT_SLOTS; ++slot) {
        if (loadout_skill_family_at(unit, slot) == family) return 1;
    }
    return 0;
}

static uint8_t loadout_picker_knows_skill(const uint8_t *dialog, uint16_t id) {
    return loadout_unit_has_skill(loadout_picker_unit(dialog), id);
}

static void loadout_remove_skill(uint8_t *unit, unsigned slot) {
    loadout_equip_skill(unit, slot, 0);
}

typedef struct {
    uint32_t type;
    uint8_t slot, icon, padding[2];
} LoadoutMenuChange;

static void *loadout_menu_changes(void **vector, const uint8_t *unit, unsigned type, uint8_t all, int16_t slot) {
    typedef void *(*Native)(void **, const uint8_t *, unsigned, uint8_t, int16_t);
    typedef uint8_t (*Icon)(unsigned, uint16_t);
    typedef void (*Insert)(void **, void *, const LoadoutMenuChange *);
    if (type != 2 && type != 3) return ((Native)(mm_base + 0x4eb1a0))(vector, unit, type, all, slot);
    memset(vector, 0, 3 * sizeof(*vector));
    if (!all && (slot < 0 || slot >= LOADOUT_SLOTS)) return vector;
    const unsigned end = all ? LOADOUT_SLOTS : (unsigned)slot + 1;
    for (unsigned i = all ? 0 : (unsigned)slot; i < end; ++i) {
        uint16_t id = type == 3 ? loadout_effect_at(unit, i) : loadout_skill_id_at(unit, i);
        const LoadoutMenuChange row = {.type = type, .slot = (uint8_t)i, .icon = ((Icon)(mm_base + 0x4eb090))(type, id)};
        if (vector[1] == vector[2]) {
            ((Insert)(mm_base + 0x36f7c0))(vector, vector[1], &row);
        } else {
            memcpy(vector[1], &row, sizeof(row));
            vector[1] = (uint8_t *)vector[1] + sizeof(row);
        }
    }
    return vector;
}

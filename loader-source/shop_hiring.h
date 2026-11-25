/* The ten native class entries feed the generator, list labels and class
   details. The two template relays replace just the randomly picked sheet. */
enum { HIRE_COUNT = 10, HIRE_POOL = 4, HIRE_BANK = HIRE_COUNT / 2 };
enum { HIRE_UNIT_START = 0x260, HIRE_UNIT_STRIDE = 0x1b8 };
enum { HIRE_MAX_CHOICES = 81, HIRE_MONSTER_BANK = 2 };
enum { HIRE_NAME_START = HIRE_UNIT_START + HIRE_COUNT * HIRE_UNIT_STRIDE, HIRE_NAME_STRIDE = 0x3e, HIRE_NAME_BYTES = 56 };

static uint16_t hire_templates[HIRE_COUNT][HIRE_POOL];
static uint32_t hire_name_banks[HIRE_COUNT];
static unsigned hire_active_choices[HIRE_COUNT];
static struct {
    uint32_t klass;
    uint16_t sheets[HIRE_POOL];
    unsigned bank;
    uint8_t clan;
    uint16_t name_id;
    char name[HIRE_NAME_BYTES + 1];
} hire_choices[HIRE_MAX_CHOICES];
static unsigned hire_choice_count;
static uint32_t hire_last_battle;
static uint32_t hire_visit;
static int hire_rotation_enabled;
static int hire_whole_pool;
static int hire_rotate_after_battle;
static int hire_rotate_on_open;
static int hire_rotation_synced;

static const struct { unsigned at; uint8_t original[5]; } hire_generation_calls[] = {
#ifdef SHOP_HIRING_STEAM
    {0x3fc9cb, {0xe8,0xd0,0xce,0xff,0xff}},
    {0x408f6f, {0xe8,0x2c,0x09,0xff,0xff}},
#else
    {0x3f983b, {0xe8,0xe0,0xcf,0xff,0xff}},
    {0x405dcf, {0xe8,0x4c,0x0a,0xff,0xff}},
#endif
};

#ifdef SHOP_HIRING_STEAM
static const unsigned hire_class_table = 0xc9cc18;
static const unsigned hire_generator = 0x3f98a0;
static const unsigned hire_prepare_appearance = 0x3494f0;
static const unsigned hire_campaign = 0x2c80e0;
static const unsigned hire_template_pointer = 0xd68340;
static const unsigned hire_class_pointer = 0xd68338;
static const unsigned hire_native_format = 0x5c7f0;
static const unsigned hire_bind_picture = 0x2698b0;
static const unsigned hire_size_picture = 0x25e760;
static const unsigned hire_party_sex = 0x333440;
static const unsigned hire_name_table = 0xd68290;
static const unsigned hire_lookup_name = 0x2d4750;
static const struct { unsigned at; uint8_t original[5]; } hire_art_calls[] = {
    {0x3fcbd9, {0xe8,0x12,0xfc,0xc5,0xff}},
    {0x3fe4f0, {0xe8,0xfb,0xe2,0xc5,0xff}},
    {0x3fe551, {0xe8,0x9a,0xe2,0xc5,0xff}},
    {0x3fe482, {0xe8,0x69,0x55,0xf3,0xff}},
    {0x3fcbe5, {0xe8,0xc6,0xcc,0xe6,0xff}},
    {0x3fe56b, {0xe8,0x40,0xb3,0xe6,0xff}},
    {0x3fcc16, {0xe8,0x25,0x68,0xf3,0xff}},
};
static const uint8_t hire_campaign_signature[] = {0x48,0x8d,0x05,0x19,0xda,0xa1,0x00,0xc3};
static const struct { unsigned at; uint8_t original[12]; } hire_sites[] = {
    {0x3f9b47, {0xb8,0,1,0,0,0x41,0x81,0xc6,0x9f,0,0,0}},
    {0x3f9c4d, {0xb8,0,2,0,0,0x41,0x81,0xc6,0xa3,0,0,0}},
};
#else
static const unsigned hire_class_table = 0xcadab0;
static const unsigned hire_generator = 0x3f6820;
static const unsigned hire_prepare_appearance = 0x346570;
static const unsigned hire_campaign = 0x2c6080;
static const unsigned hire_template_pointer = 0xd78e80;
static const unsigned hire_class_pointer = 0xd78e78;
static const unsigned hire_native_format = 0x5bfc0;
static const unsigned hire_bind_picture = 0x267720;
static const unsigned hire_size_picture = 0x25c580;
static const unsigned hire_party_sex = 0x3305e0;
static const unsigned hire_name_table = 0xd78dd0;
static const unsigned hire_lookup_name = 0x2d26f0;
static const struct { unsigned at; uint8_t original[5]; } hire_art_calls[] = {
    {0x3f9a49, {0xe8,0x72,0x25,0xc6,0xff}},
    {0x3fb354, {0xe8,0x67,0x0c,0xc6,0xff}},
    {0x3fb3b5, {0xe8,0x06,0x0c,0xc6,0xff}},
    {0x3fb2e6, {0xe8,0xa5,0x58,0xf3,0xff}},
    {0x3f9a55, {0xe8,0xc6,0xdc,0xe6,0xff}},
    {0x3fb3cf, {0xe8,0x4c,0xc3,0xe6,0xff}},
    {0x3f9a86, {0xe8,0x55,0x6b,0xf3,0xff}},
};
static const uint8_t hire_campaign_signature[] = {0x48,0x8d,0x05,0xb9,0x05,0xa3,0x00,0xc3};
static const struct { unsigned at; uint8_t original[11]; } hire_sites[] = {
    {0x3f6a87, {0xb8,0,1,0,0,0x81,0xc6,0x9f,0,0,0}},
    {0x3f6b0c, {0xb8,0,2,0,0,0x81,0xc6,0xa3,0,0,0}},
};
#endif

enum { HIRE_ART_CALLS = sizeof(hire_art_calls) / sizeof(hire_art_calls[0]) };

static const uint8_t *hire_table_row(unsigned global, unsigned id, size_t size) {
    const uint8_t *table;
    uint32_t count, offset, stride;
    memcpy(&table, mm_base + global, sizeof(table));
    if (!mm_readable(table, 16))
        return NULL;
    memcpy(&count, table + 4, sizeof(count));
    memcpy(&offset, table + 8, sizeof(offset));
    memcpy(&stride, table + 12, sizeof(stride));
    if (id >= count || stride < size)
        return NULL;
    const uint8_t *row = table + offset + (size_t)id * stride;
    return mm_readable(row, size) ? row : NULL;
}

static const uint8_t *hire_sheet(const uint8_t *unit) {
    uint16_t ident;
    memcpy(&ident, unit, sizeof(ident));
    return hire_table_row(hire_template_pointer, ident, 0x3a);
}

/* The stock status window compares template IDs to the first female human.
   Supply the equivalent branch value from the actual sheet's sex field. */
static unsigned hire_status_sex(const uint8_t *unit) {
    const uint8_t *sheet = hire_sheet(unit);
    return sheet && sheet[3] == 1 ? 163 : 159;
}

static unsigned hire_count_sex(const void *member, const uint8_t *shop, unsigned slot) {
    unsigned (*sex)(const void *) = (void *)(mm_base + hire_party_sex);
    const unsigned member_sex = sex(member);
    const unsigned row_sex = slot >= HIRE_BANK;
    const uint8_t *sheet = hire_sheet(shop + HIRE_UNIT_START + slot * HIRE_UNIT_STRIDE);
    /* The native comparison uses the row's sex, so translate a match against
       the recruit's actual sex to the row expected by the original code. */
    return sheet && sheet[3] < 2 && member_sex < 2 ? member_sex ^ sheet[3] ^ row_sex : member_sex;
}

static int hire_picture_name(char *out, const char *format, const char *prefix, const uint8_t *unit) {
    int (*native_format)(char *, const char *, ...) = (void *)(mm_base + hire_native_format);
    const uint8_t *sheet = hire_sheet(unit);
    const uint8_t *klass = hire_table_row(hire_class_pointer, unit[0x49], 0xa8);
    unsigned icon = 255;
    if (klass && sheet) {
        unsigned column = sheet[0x39]; /* Same picture column as Class Change. */
        if (column == 1)
            column = sheet[3] == 1;
        if (column < 16)
            icon = klass[0x98 + column];
        if (icon == 255)
            icon = klass[0x98 + (sheet[3] == 1)];
        for (unsigned i = 0; icon == 255 && i < 16; ++i)
            icon = klass[0x98 + i];
    }
    return native_format(out, format, prefix, icon);
}

/* The Class Change path sizes the live renderer after binding its artwork. */
static uint8_t hire_bind_and_size_picture(void *widget, const char *name) {
    uint8_t (*bind)(void *, const char *) = (void *)(mm_base + hire_bind_picture);
    const uint8_t result = bind(widget, name);
    if (result) {
        void (*size)(void *) = (void *)(mm_base + hire_size_picture);
        size(widget);
    }
    return result;
}

/* Draw from the campaign's saved Battles counter without touching game RNG. */
static uint32_t hire_random(uint32_t *seed) {
    uint32_t value = (*seed += 0x9e3779b9u);
    value = (value ^ (value >> 16)) * 0x21f0aaadu;
    value = (value ^ (value >> 15)) * 0x735a2d97u;
    return value ^ (value >> 15);
}

static void hire_refresh_roster(uint32_t battles, int entering) {
    const int same_battle = hire_rotation_synced &&
        (battles == hire_last_battle || (!hire_rotate_after_battle && !hire_rotate_on_open));
    if (same_battle && !(hire_rotate_on_open && entering))
        return;
    const uint32_t visit = same_battle ? hire_visit + 1 : 0;
    uint32_t seed = battles ^ (visit * 0x9e3779b9u);
    uint32_t classes[HIRE_COUNT];
    uint16_t templates[HIRE_COUNT];
    uint32_t names[HIRE_COUNT];
    unsigned choices[HIRE_COUNT];
    uint8_t taken[HIRE_MAX_CHOICES] = {0};
    const unsigned banks = hire_whole_pool ? 1 : 2;
    const unsigned draws = HIRE_COUNT / banks;
    for (unsigned bank = 0; bank < banks; ++bank) {
        unsigned pool[HIRE_MAX_CHOICES], remaining = 0;
        for (unsigned choice = 0; choice < hire_choice_count; ++choice)
            if (!taken[choice] && (hire_whole_pool || hire_choices[choice].bank == bank || hire_choices[choice].bank == HIRE_MONSTER_BANK))
                pool[remaining++] = choice;
        for (unsigned i = 0; i < draws; ++i) {
            const unsigned draw = hire_random(&seed) % remaining;
            const unsigned chosen = pool[draw];
            pool[draw] = pool[--remaining];
            taken[chosen] = 1;
            const unsigned slot = bank * draws + i;
            choices[slot] = chosen;
            classes[slot] = hire_choices[chosen].klass;
            templates[slot] = hire_choices[chosen].sheets[hire_random(&seed) % HIRE_POOL];
            names[slot] = hire_choices[chosen].bank == 1 ? 0x200 : 0x100;
        }
    }
    if (!mm_write(mm_base + hire_class_table, classes, sizeof(classes))) {
        mm_log("Shop hiring: could not refresh the roster.\r\n");
        return;
    }
    for (unsigned slot = 0; slot < HIRE_COUNT; ++slot)
        for (unsigned draw = 0; draw < HIRE_POOL; ++draw)
            hire_templates[slot][draw] = templates[slot];
    memcpy(hire_name_banks, names, sizeof(names));
    memcpy(hire_active_choices, choices, sizeof(choices));
    hire_last_battle = battles;
    hire_visit = visit;
    hire_rotation_synced = 1;
}

static void hire_set_identity(void *shop, unsigned slot) {
    const unsigned choice = hire_active_choices[slot];
    const char *name = hire_choices[choice].name;
    const unsigned name_id = hire_choices[choice].name_id;
    if (name_id) {
        const uint8_t *root = mm_base + hire_name_table;
        /* Same localized name table the game's named-unit display uses. */
        if (!hire_table_row(hire_name_table + 0x148, name_id, sizeof(uint64_t)))
            return;
        const char *(*lookup)(const void *, unsigned) = (void *)(mm_base + hire_lookup_name);
        name = lookup(root, name_id);
    }
    if (!name || !name[0])
        return;
    uint8_t *unit = (uint8_t *)shop + HIRE_UNIT_START + slot * HIRE_UNIT_STRIDE;
    unit[0x4e] = (unit[0x4e] & 0xf8) | hire_choices[choice].clan;
    uint8_t *entry = (uint8_t *)shop + HIRE_NAME_START + slot * HIRE_NAME_STRIDE;
    /* Zero the ID and language tag so the game keeps the literal UTF-8 name
       when it displays the offer, opens name entry or copies it into the army. */
    memset(entry, 0, HIRE_NAME_STRIDE);
    size_t length = 0;
    while (length < HIRE_NAME_BYTES && name[length])
        ++length;
    while (length && ((unsigned char)name[length] & 0xc0) == 0x80)
        --length; /* Keep a complete UTF-8 character at the end. */
    memcpy(entry, name, length);
#ifdef SHOP_HIRING_STEAM
    memcpy(entry + HIRE_COUNT * HIRE_NAME_STRIDE, entry, HIRE_NAME_STRIDE);
#endif
}

static void hire_generate(void *shop, int entering) {
    if (hire_rotation_enabled) {
        const uint8_t *(*campaign)(void) = (void *)(mm_base + hire_campaign);
        uint32_t battles;
        /* This is the first u32 in the Warren Report statistics block. */
        memcpy(&battles, campaign() + 0x319c, sizeof(battles));
        hire_refresh_roster(battles, entering);
    }
    ((void (*)(void *))(mm_base + hire_generator))(shop);
    for (unsigned slot = 0; slot < HIRE_COUNT; ++slot)
        hire_set_identity(shop, slot);
    if (entering) {
        /* Widget initialization already runs this pass. The separate Hire
           command regenerates the offers without recalculating their face
           IDs or registering the new art before opening the list. */
        void (*prepare)(void *) = (void *)(mm_base + hire_prepare_appearance);
        uint8_t *unit = (uint8_t *)shop + HIRE_UNIT_START;
        for (unsigned i = 0; i < HIRE_COUNT; ++i, unit += HIRE_UNIT_STRIDE)
            prepare(unit);
    }
}

static unsigned hire_hex_digit(wchar_t digit) {
    if (digit >= L'0' && digit <= L'9') return (unsigned)(digit - L'0');
    if (digit >= L'a' && digit <= L'f') return (unsigned)(digit - L'a') + 10;
    if (digit >= L'A' && digit <= L'F') return (unsigned)(digit - L'A') + 10;
    return 16;
}

static int hire_read_identity(const wchar_t *section, const wchar_t *config, unsigned choice) {
    wchar_t key[32], encoded[HIRE_NAME_BYTES * 2 + 2];
    char *name = hire_choices[choice].name;
    name[0] = 0;
    swprintf(key, sizeof(key) / sizeof(key[0]), L"NameId%u", choice + 1);
    const unsigned name_id = GetPrivateProfileIntW(section, key, 0, config);
    if (name_id > UINT16_MAX) return 0;
    hire_choices[choice].name_id = (uint16_t)name_id;
    swprintf(key, sizeof(key) / sizeof(key[0]), L"Name%u", choice + 1);
    const DWORD size = GetPrivateProfileStringW(section, key, L"", encoded, sizeof(encoded) / sizeof(encoded[0]), config);
    if (!size && !name_id) return 1;
    if ((name_id && size) || size > HIRE_NAME_BYTES * 2 || size % 2) return 0;
    for (unsigned i = 0; i < size; i += 2) {
        const unsigned high = hire_hex_digit(encoded[i]), low = hire_hex_digit(encoded[i + 1]);
        const unsigned byte = (high << 4) | low;
        if (high > 15 || low > 15 || byte < 32 || byte == 127) return 0;
        name[i / 2] = (char)byte;
    }
    name[size / 2] = 0;
    if (size && !MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, name, (int)(size / 2), NULL, 0))
        return 0;
    swprintf(key, sizeof(key) / sizeof(key[0]), L"Clan%u", choice + 1);
    const unsigned clan = GetPrivateProfileIntW(section,key,8,config);
    if (clan > 7) return 0;
    hire_choices[choice].clan = (uint8_t)clan;
    return 1;
}

static void hire_make_call(uint8_t patch[5], unsigned site, uint8_t *relay) {
    const int32_t delta = (int32_t)((intptr_t)relay - (intptr_t)(mm_base + site + 5));
    patch[0] = 0xe8;
    memcpy(patch + 1, &delta, sizeof(delta));
}

static void hire_template_relay(uint8_t *relay, void *resume) {
#ifdef SHOP_HIRING_STEAM
    static const uint8_t index[] = {
        0x8b,0x44,0x24,0x28,  /* mov eax, [rsp+0x28] (hire slot) */
        0x41,0x8d,0x04,0x86,  /* lea eax, [r14+rax*4] */
        0x49,0xbe,            /* mov r14, template table address */
    };
    static const uint8_t load[] = {0x45,0x0f,0xb7,0x34,0x46}; /* movzx r14d, word [r14+rax*2] */
    static const uint8_t name_index[] = {0x8b,0x44,0x24,0x28,0x41,0x53,0x49,0xbb};
    static const uint8_t name_load[] = {0x41,0x8b,0x04,0x83,0x41,0x5b}; /* mov eax,[r11+rax*4]; pop r11 */
#else
    static const uint8_t index[] = {
        0x42,0x8d,0x04,0xa6,  /* lea eax, [rsi+r12*4] (random index and hire slot) */
        0x48,0xbe,            /* mov rsi, template table address */
    };
    static const uint8_t load[] = {0x0f,0xb7,0x34,0x46}; /* movzx esi, word [rsi+rax*2] */
    static const uint8_t name_index[] = {0x48,0xb8}; /* mov rax, name bank table */
    static const uint8_t name_load[] = {0x42,0x8b,0x04,0xa0}; /* mov eax,[rax+r12*4] */
#endif
    const void *table = hire_templates;
    const void *names = hire_name_banks;
    memcpy(relay, index, sizeof(index));
    relay += sizeof(index);
    memcpy(relay, &table, sizeof(table));
    relay += sizeof(table);
    memcpy(relay, load, sizeof(load));
    relay += sizeof(load);
    /* Use the offer's name bank, including monsters drawn into either half. */
    memcpy(relay, name_index, sizeof(name_index));
    relay += sizeof(name_index);
    memcpy(relay, &names, sizeof(names));
    relay += sizeof(names);
    memcpy(relay, name_load, sizeof(name_load));
    relay += sizeof(name_load);
    mm_abs_jump(relay, resume);
}

static void mm_install_shop_hiring(const wchar_t *config) {
    static const wchar_t section[] = L"ShopHiring";
    if (!GetPrivateProfileIntW(section, L"Enabled", 0, config))
        return;
    hire_rotate_on_open = GetPrivateProfileIntW(section, L"RotateOnOpen", 0, config) != 0;
    hire_rotate_after_battle = GetPrivateProfileIntW(section, L"RotateAfterBattle", 0, config) != 0;
    hire_whole_pool = GetPrivateProfileIntW(section, L"WholePool", 0, config) != 0;
    hire_rotation_enabled = hire_whole_pool || hire_rotate_after_battle || hire_rotate_on_open || GetPrivateProfileIntW(section, L"UsePool", 0, config) != 0;
    hire_choice_count = hire_rotation_enabled ? GetPrivateProfileIntW(section, L"ChoiceCount", HIRE_COUNT, config) : HIRE_COUNT;
    if (hire_choice_count < HIRE_COUNT || hire_choice_count > HIRE_MAX_CHOICES) {
        mm_log("Shop hiring: invalid number of choices.\r\n");
        return;
    }
    uint32_t classes[HIRE_COUNT];
    unsigned bank_count[3] = {0};
    for (unsigned i = 0; i < hire_choice_count; ++i) {
        wchar_t key[32];
        swprintf(key, sizeof(key) / sizeof(key[0]), L"Class%u", i + 1);
        const unsigned klass = GetPrivateProfileIntW(section, key, 0, config);
        if (!klass || klass > 255) {
            mm_log("Shop hiring: invalid class in roster.\r\n");
            return;
        }
        hire_choices[i].klass = klass;
        swprintf(key, sizeof(key) / sizeof(key[0]), L"Bank%u", i + 1);
        const unsigned bank = GetPrivateProfileIntW(section, key, i < HIRE_COUNT ? 1 + (i >= HIRE_BANK) : 0, config);
        if (bank < 1 || bank > 3) {
            mm_log("Shop hiring: invalid name bank in roster.\r\n");
            return;
        }
        hire_choices[i].bank = bank - 1;
        ++bank_count[bank - 1];
        if (i < HIRE_COUNT) {
            classes[i] = klass;
            hire_name_banks[i] = bank == 2 ? 0x200 : 0x100;
            hire_active_choices[i] = i;
        }
        for (unsigned j = 0; j < HIRE_POOL; ++j) {
            swprintf(key, sizeof(key) / sizeof(key[0]), L"Template%u_%u", i + 1, j + 1);
            unsigned sheet = GetPrivateProfileIntW(section, key, 0, config);
            if (!sheet || sheet > UINT16_MAX) {
                mm_log("Shop hiring: invalid character sheet in roster.\r\n");
                return;
            }
            hire_choices[i].sheets[j] = (uint16_t)sheet;
            if (i < HIRE_COUNT)
                hire_templates[i][j] = (uint16_t)sheet;
        }
        if (!hire_read_identity(section, config, i)) {
            mm_log("Shop hiring: invalid fixed name or clan.\r\n");
            return;
        }
    }
    if (hire_rotation_enabled && !hire_whole_pool && bank_count[HIRE_MONSTER_BANK] < HIRE_COUNT &&
        (bank_count[0] < HIRE_BANK || bank_count[1] < HIRE_BANK)) {
        mm_log("Shop hiring: not enough choices per name bank.\r\n");
        return;
    }
    static const uint32_t original_classes[] = {1,2,3,4,5,1,2,3,4,5};
    if (memcmp(mm_base + hire_class_table, original_classes, sizeof(original_classes))) {
        mm_log("Shop hiring: native class list differs.\r\n");
        return;
    }
    for (unsigned i = 0; i < 2; ++i) {
        if (memcmp(mm_base + hire_sites[i].at, hire_sites[i].original, sizeof(hire_sites[i].original))) {
            mm_log("Shop hiring: native character selection differs.\r\n");
            return;
        }
        if (memcmp(mm_base + hire_generation_calls[i].at, hire_generation_calls[i].original, 5)) {
            mm_log("Shop hiring: menu entry fingerprint differs.\r\n");
            return;
        }
    }
    for (unsigned i = 0; i < HIRE_ART_CALLS; ++i) {
        if (memcmp(mm_base + hire_art_calls[i].at, hire_art_calls[i].original, 5)) {
            mm_log("Shop hiring: preview fingerprint differs.\r\n");
            return;
        }
    }
    static const uint8_t size_signature[] = {0x48,0x89,0x5c,0x24,0x18,0x57,0x48,0x83,0xec,0x20};
    if (memcmp(mm_base + hire_size_picture, size_signature, sizeof(size_signature))) {
        mm_log("Shop hiring: picture resizing fingerprint differs.\r\n");
        return;
    }
    if (hire_rotation_enabled) {
        if (memcmp(mm_base + hire_campaign, hire_campaign_signature, sizeof(hire_campaign_signature))) {
            mm_log("Shop hiring: roster rotation fingerprint differs.\r\n");
            return;
        }
        hire_rotation_synced = 0;
    }
    static const uint8_t prepare_signature[] = {0x48,0x85,0xc9,0x74,0x1c,0x53,0x48,0x83,0xec,0x20};
    if (memcmp(mm_base + hire_prepare_appearance, prepare_signature, sizeof(prepare_signature))) {
        mm_log("Shop hiring: appearance preparation fingerprint differs.\r\n");
        return;
    }
    uint8_t *relay = mm_near_page();
    if (!relay) {
        mm_log("Shop hiring: could not allocate the template relays.\r\n");
        return;
    }
    uint8_t patches[2][sizeof(hire_sites[0].original)];
    for (unsigned i = 0; i < 2; ++i) {
        uint8_t *entry = relay + 64 * i, *site = mm_base + hire_sites[i].at;
        hire_template_relay(entry, site + sizeof(hire_sites[i].original));
        memset(patches[i], 0x90, sizeof(patches[i]));
        patches[i][0] = 0xe9;
        const int32_t delta = (int32_t)((intptr_t)entry - (intptr_t)(site + 5));
        memcpy(patches[i] + 1, &delta, sizeof(delta));
    }
    uint8_t calls[2][5], art[HIRE_ART_CALLS][5];
    for (unsigned i = 0; i < 2; ++i) {
        uint8_t *entry = relay + 128 + 32 * i;
        entry[0] = 0xba; /* mov edx, entering: only the Employ sequence starts a visit */
        memcpy(entry + 1, &i, 4);
        mm_abs_jump(entry + 5, (void *)hire_generate);
        hire_make_call(calls[i], hire_generation_calls[i].at, entry);
    }
    static const uint8_t list_unit[] = {
        0x45,0x69,0xcf,0xb8,0x01,0,0,      /* imul r9d, r15d, 0x1b8 */
        0x4e,0x8d,0x8c,0x0f,0x60,0x02,0,0 /* lea r9, [rdi+r9+0x260] */
    };
    static const uint8_t status_unit[] = {0x4d,0x89,0xe9}; /* mov r9, r13 */
    memcpy(relay + 192, list_unit, sizeof(list_unit));
    mm_abs_jump(relay + 192 + sizeof(list_unit), (void *)hire_picture_name);
    memcpy(relay + 224, status_unit, sizeof(status_unit));
    mm_abs_jump(relay + 224 + sizeof(status_unit), (void *)hire_picture_name);
    mm_abs_jump(relay + 256, (void *)hire_status_sex);
    hire_make_call(art[0], hire_art_calls[0].at, relay + 192);
    hire_make_call(art[1], hire_art_calls[1].at, relay + 224);
    hire_make_call(art[2], hire_art_calls[2].at, relay + 224);
    hire_make_call(art[3], hire_art_calls[3].at, relay + 256);
    mm_abs_jump(relay + 288, (void *)hire_bind_and_size_picture);
    hire_make_call(art[4], hire_art_calls[4].at, relay + 288);
    hire_make_call(art[5], hire_art_calls[5].at, relay + 288);
    static const uint8_t count_args[] = {0x48,0x89,0xfa,0x45,0x89,0xf8}; /* mov rdx,rdi; mov r8d,r15d */
    memcpy(relay + 320, count_args, sizeof(count_args));
    mm_abs_jump(relay + 320 + sizeof(count_args), (void *)hire_count_sex);
    hire_make_call(art[6], hire_art_calls[6].at, relay + 320);
    FlushInstructionCache(GetCurrentProcess(), relay, 340);
    if (!mm_write(mm_base + hire_class_table, classes, sizeof(classes)) ||
        !mm_write(mm_base + hire_sites[0].at, patches[0], sizeof(patches[0])) ||
        !mm_write(mm_base + hire_sites[1].at, patches[1], sizeof(patches[1])) ||
        !mm_write(mm_base + hire_generation_calls[0].at, calls[0], sizeof(calls[0])) ||
        !mm_write(mm_base + hire_generation_calls[1].at, calls[1], sizeof(calls[1])) ||
        !mm_write(mm_base + hire_art_calls[0].at, art[0], sizeof(art[0])) ||
        !mm_write(mm_base + hire_art_calls[1].at, art[1], sizeof(art[1])) ||
        !mm_write(mm_base + hire_art_calls[2].at, art[2], sizeof(art[2])) ||
        !mm_write(mm_base + hire_art_calls[3].at, art[3], sizeof(art[3])) ||
        !mm_write(mm_base + hire_art_calls[4].at, art[4], sizeof(art[4])) ||
        !mm_write(mm_base + hire_art_calls[5].at, art[5], sizeof(art[5])) ||
        !mm_write(mm_base + hire_art_calls[6].at, art[6], sizeof(art[6]))) {
        mm_write(mm_base + hire_class_table, original_classes, sizeof(original_classes));
        for (unsigned i = 0; i < 2; ++i)
            mm_write(mm_base + hire_sites[i].at, hire_sites[i].original, sizeof(hire_sites[i].original));
        for (unsigned i = 0; i < 2; ++i)
            mm_write(mm_base + hire_generation_calls[i].at, hire_generation_calls[i].original, sizeof(calls[i]));
        for (unsigned i = 0; i < HIRE_ART_CALLS; ++i)
            mm_write(mm_base + hire_art_calls[i].at, hire_art_calls[i].original, sizeof(art[i]));
        mm_log("Shop hiring: could not install the roster.\r\n");
        return;
    }
    mm_log(hire_rotate_on_open ? "Shop hiring: visit rotation enabled.\r\n" :
           hire_rotate_after_battle ? "Shop hiring: battle-based rotation enabled.\r\n" :
           hire_rotation_enabled ? "Shop hiring: hiring pool enabled.\r\n" : "Shop hiring: custom roster enabled.\r\n");
}

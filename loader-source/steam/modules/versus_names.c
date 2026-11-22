static const char *(*vs_native_name)(const uint8_t *);
static uint8_t *(*vs_native_name_copy)(const uint8_t *, uint8_t *);

static const char *vs_saved_name(const uint8_t *character) {
    if (vs_match[5] < '3') return NULL;
    /* The stock NPC initializer records the entry index at character +9.
     * The same index is serialized during Chariot and follows the fighter. */
    const int index = vs_fighter_index(character);
    if (index < 0) return NULL;
    const char *name = (const char *)vs_match + vs_relic_end(vs_match, vs_match_bytes, 2 * vs_team_size) +
                       index * VS_NAME_ROW;
    return *name ? name : NULL;
}

static const char *vs_display_name(const uint8_t *character) {
    const char *name = vs_saved_name(character);
    return name ? name : vs_native_name(character);
}

static uint8_t *vs_copy_name(const uint8_t *character, uint8_t *out) {
    const char *name = vs_saved_name(character);
    if (!name) return vs_native_name_copy(character, out);
    /* Store the literal name in the native copied-name format. A zero
     * language tag keeps the game from re-localizing it later. */
    memset(out, 0, 0x3e);
    memcpy(out, name, strlen(name));
    return out;
}

static int vs_install_names(void) {
    const struct { unsigned site, length; const char *prefix; void *replacement; } hooks[] = {
        {0x332e10, 6, "\x40\x53\x48\x83\xec\x20", (void *)vs_display_name},
        {0x332fc0, 5, "\x48\x89\x74\x24\x20", (void *)vs_copy_name},
    };
    for (unsigned i = 0; i < 2; ++i)
        if (memcmp(mm_base + hooks[i].site, hooks[i].prefix, hooks[i].length)) return 0;
    uint8_t *relay = mm_near_page();
    if (!relay) return 0;
    for (unsigned i = 0; i < 2; ++i) {
        uint8_t *block = relay + i * 48;
        memcpy(block, hooks[i].prefix, hooks[i].length);
        mm_abs_jump(block + hooks[i].length, mm_base + hooks[i].site + hooks[i].length);
        mm_abs_jump(block + 24, hooks[i].replacement);
    }
    vs_native_name = (void *)relay;
    vs_native_name_copy = (void *)(relay + 48);
    FlushInstructionCache(GetCurrentProcess(), relay, 96);
    for (unsigned i = 0; i < 2; ++i) {
        uint8_t *site = mm_base + hooks[i].site;
        const int32_t delta = (int32_t)((intptr_t)(relay + i * 48 + 24) - (intptr_t)(site + 5));
        uint8_t patch[6] = {0xe9, 0, 0, 0, 0, 0x90};
        memcpy(patch + 1, &delta, sizeof delta);
        if (!mm_write(site, patch, hooks[i].length)) {
            for (unsigned j = 0; j <= i; ++j)
                mm_write(mm_base + hooks[j].site, hooks[j].prefix, hooks[j].length);
            return 0;
        }
    }
    return 1;
}

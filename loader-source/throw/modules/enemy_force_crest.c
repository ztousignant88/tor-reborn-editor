/* Both native deployment paths copy the incoming character into the live unit.
 * Override the accessory on that copy before movement and turn state initialize. */
static void ee_deploy_with_crest(uint8_t *unit, int index, const uint8_t *source,
                                 uint32_t position, uint32_t flags, uint8_t id) {
    typedef void (*Deploy)(uint8_t *, int, const uint8_t *, uint32_t, uint32_t, uint8_t);
    Deploy deploy = (Deploy)(mm_base + EE_DEPLOY);
    _Alignas(16) uint8_t character[0x1b8];
    if (source[0x50] == 2 && es_word(source + 0x60) != EE_CREST_ID) {
        memcpy(character, source, sizeof character);
        const uint16_t crest = EE_CREST_ID;
        memcpy(character + 0x60, &crest, sizeof crest);
        const uint16_t hp = es_word(character + 0x10), old_max_hp = es_word(character + 0x12e);
        ((void (*)(uint8_t *))(mm_base + EE_REFRESH))(character);
        if (hp && hp == old_max_hp)
            memcpy(character + 0x10, character + 0x12e, sizeof hp);
        source = character;
    }
    deploy(unit, index, source, position, flags, id);
}

/* Fill the active profile after the game has selected it and run its scripts. */
enum {
    AIS_WORKSPACE_PROFILE = 0x1cb88,
    AIS_BUFF_WEIGHT = 0x12,
    AIS_HEAL_AMOUNT_WEIGHT = 0x16,
    AIS_HEAL_NEED_WEIGHT = 0x18,
    AIS_SUPPORT_DEFAULT = 25,
};

static int ais_default_buffs, ais_default_healing;
static AisFn ais_prepare;

static void ais_default_if_zero(uint8_t *field) {
    int16_t value;
    memcpy(&value, field, sizeof value);
    if (value == 0) {
        value = AIS_SUPPORT_DEFAULT;
        memcpy(field, &value, sizeof value);
    }
}

static uint64_t ais_prepare_hook(uint64_t a,uint64_t b,uint64_t c,uint64_t d,uint64_t e,uint64_t f) {
    uint8_t *profile = (uint8_t *)a + AIS_WORKSPACE_PROFILE;
    if (ais_default_buffs) ais_default_if_zero(profile + AIS_BUFF_WEIGHT);
    if (ais_default_healing) {
        ais_default_if_zero(profile + AIS_HEAL_AMOUNT_WEIGHT);
        ais_default_if_zero(profile + AIS_HEAL_NEED_WEIGHT);
    }
    return ais_prepare(a,b,c,d,e,f);
}

static int ais_is_helpful_buff(uint64_t a, int gain) {
    const uint8_t *ctx = (const uint8_t *)a;
    if (!ais_default_buffs || gain <= 0 || !mm_readable(ctx, 0x44)) return 0;
    int32_t hostile;
    memcpy(&hostile, ctx + 0x40, sizeof hostile);
    /* The native status scorer already rejects harmful statuses on this side. */
    return hostile == 0;
}

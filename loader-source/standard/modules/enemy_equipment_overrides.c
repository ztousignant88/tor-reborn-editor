enum { EE_OVERRIDES = 64, EE_OVERRIDE_LIMIT = EQUIPMENT_FIRST + EQUIPMENT_COUNT };
enum { EE_HAS_LEVEL = 0x100, EE_HAS_ALLOWED = 0x200, EE_ALLOW = 0x400 };
static uint16_t ee_overrides[EE_OVERRIDE_LIMIT];

static unsigned ee_read_overrides(const wchar_t *config) {
    wchar_t encoded[EE_OVERRIDE_LIMIT * 3 + 1];
    const DWORD length = GetPrivateProfileStringW(L"EnemyEquipment", L"Overrides", L"",
        encoded, sizeof encoded / sizeof encoded[0], config);
    if (!length || length % 3 || length > EE_OVERRIDE_LIMIT * 3)
        return 0;
    uint16_t decoded[EE_OVERRIDE_LIMIT] = {0};
    for (unsigned i = 0; i < length; ++i) {
        const wchar_t c = encoded[i];
        unsigned digit;
        if (c >= L'0' && c <= L'9')
            digit = c - L'0';
        else if (c >= L'a' && c <= L'f')
            digit = c - L'a' + 10;
        else
            return 0;
        decoded[i / 3] = (uint16_t)((decoded[i / 3] << 4) | digit);
    }
    for (unsigned i = 0; i < length / 3; ++i) {
        const unsigned entry = decoded[i];
        if (entry > 0x7ff || (!i && entry) || (!(entry & EE_HAS_LEVEL) && (entry & 0xff)) ||
            (!(entry & EE_HAS_ALLOWED) && (entry & EE_ALLOW)))
            return 0;
    }
    memcpy(ee_overrides, decoded, sizeof ee_overrides);
    return EE_OVERRIDES;
}

static unsigned ee_override(unsigned id) {
    return id < EE_OVERRIDE_LIMIT ? ee_overrides[id] : 0;
}


#ifdef GUEST_CONTROL_STEAM
enum { GUEST_INIT_VISUAL = 0x3423b0 };
#else
enum { GUEST_INIT_VISUAL = 0x33f450 };
#endif

static void guest_initialize_control(uint8_t *unit, int visual) {
    ((void (*)(uint8_t *, int))(mm_base + GUEST_INIT_VISUAL))(unit, visual);
    if (unit[0x188] != 1 || (unit[0x18a] & 0x20) == 0)
        return;
#ifdef GUEST_CONTROL_STEAM
    if (vs_is_training())
        return;
#endif
    unit[0x1d8] = 0;
}

static void mm_install_guest_control(const wchar_t *config) {
    if (!GetPrivateProfileIntW(L"GuestControl", L"Enabled", 0, config))
        return;

    /* Each path has just copied the battle roster into the live unit. */
    static const struct { unsigned address; uint8_t original[5]; } sites[] = {
#ifdef GUEST_CONTROL_STEAM
        {0x376bb1, {0xe8, 0xfa, 0xb7, 0xfc, 0xff}},
        {0x376e77, {0xe8, 0x34, 0xb5, 0xfc, 0xff}},
#else
        {0x373bd1, {0xe8, 0x7a, 0xb8, 0xfc, 0xff}},
        {0x373e97, {0xe8, 0xb4, 0xb5, 0xfc, 0xff}},
#endif
    };
    for (unsigned i = 0; i < sizeof sites / sizeof sites[0]; ++i) {
        if (memcmp(mm_base + sites[i].address, sites[i].original, 5)) {
            mm_log("Guest control: native deployment calls differ.\r\n");
            return;
        }
    }

    uint8_t *relay = mm_near_page();
    if (!relay) {
        mm_log("Guest control: could not allocate the deployment hook.\r\n");
        return;
    }
    mm_abs_jump(relay, (void *)guest_initialize_control);
    FlushInstructionCache(GetCurrentProcess(), relay, 14);
    for (unsigned i = 0; i < sizeof sites / sizeof sites[0]; ++i) {
        uint8_t *site = mm_base + sites[i].address;
        uint8_t patch[5] = {0xe8};
        int32_t relative = (int32_t)((intptr_t)relay - (intptr_t)(site + 5));
        memcpy(patch + 1, &relative, sizeof relative);
        if (!mm_write(site, patch, sizeof patch)) {
            for (unsigned j = 0; j <= i; ++j)
                mm_write(mm_base + sites[j].address, sites[j].original, 5);
            mm_log("Guest control: deployment hook could not be installed.\r\n");
            return;
        }
    }
    mm_log("Guest control: allied guests start in Manual.\r\n");
}

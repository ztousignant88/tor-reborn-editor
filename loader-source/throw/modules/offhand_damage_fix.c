/* Spells and specials can match the empty offhand's weapon type. Fall
 * back to the equipped main hand if the native damage selector returns 0. */
static uint16_t mm_offhand_damage_weapon(const unsigned char *unit, const unsigned char *action) {
    typedef uint16_t (*SelectWeapon)(const unsigned char *, const unsigned char *);
    uint16_t selected = ((SelectWeapon)(mm_base + 0x33d750))(unit, action);
    if (selected || (action[0] != 3 && action[0] != 4)) return selected;

    uint16_t main_hand, offhand;
    memcpy(&main_hand, unit + 0x18c, sizeof main_hand);
    memcpy(&offhand, unit + 0x18e, sizeof offhand);
    return offhand ? selected : main_hand;
}

static void mm_install_offhand_damage_fix(void) {
    unsigned char *site = mm_base + 0x44dfb4;
    static const unsigned char original[] = {0xe8, 0x97, 0xf7, 0xee, 0xff};
    if (memcmp(site, original, sizeof original)) {
        mm_log("Offhand damage fix: unsupported patch site.\r\n");
        return;
    }
    unsigned char *relay = mm_near_page();
    if (!relay) {
        mm_log("Offhand damage fix: relay allocation failed.\r\n");
        return;
    }
    mm_abs_jump(relay, (void *)mm_offhand_damage_weapon);
    FlushInstructionCache(GetCurrentProcess(), relay, 14);
    unsigned char patch[5] = {0xe8};
    int32_t offset = (int32_t)((intptr_t)relay - (intptr_t)(site + 5));
    memcpy(patch + 1, &offset, sizeof offset);
    if (!mm_write(site, patch, sizeof patch)) {
        mm_write(site, original, sizeof original);
        mm_log("Offhand damage fix: installation failed.\r\n");
        return;
    }
    mm_log("Offhand damage fix: enabled.\r\n");
}

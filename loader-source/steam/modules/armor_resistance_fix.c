/* The defensive damage-modifier call receives a packed physical/element
 * selector read from the defender's main-hand weapon. Substitute only the
 * physical byte from the incoming action context at RBX+0x28. */
static int mm_install_armor_resistance_fix(void) {
    unsigned char *site = mm_base + 0x388e6b;
    static const unsigned char original[] = {0x48,0x8b,0x84,0x24,0x80,0x00,0x00,0x00};
    static const unsigned char context_load[] = {0x48,0x8b,0x9c,0x24,0xf8,0x00,0x00,0x00};
    static const unsigned char modifier_call[] = {0xe8,0x15,0x0a,0x00,0x00};
    if (memcmp(site,original,sizeof original) ||
        memcmp(mm_base+0x388e46,context_load,sizeof context_load) ||
        memcmp(mm_base+0x388e96,modifier_call,sizeof modifier_call)) {
        mm_log("Armor resistance fix: unsupported damage calculation.\r\n");
        return 0;
    }
    unsigned char *relay = mm_near_page();
    if (!relay) {
        mm_log("Armor resistance fix: relay allocation failed.\r\n");
        return 0;
    }
    memcpy(relay,original,sizeof original);
    /* mov al,byte ptr [rbx+0x28]. MOV preserves the caller's flags. */
    const unsigned char incoming_physical[] = {0x8a,0x43,0x28};
    memcpy(relay+sizeof original,incoming_physical,sizeof incoming_physical);
    mm_abs_jump(relay+sizeof original+sizeof incoming_physical,site+sizeof original);
    FlushInstructionCache(GetCurrentProcess(),relay,32);
    unsigned char patch[sizeof original] = {0xe9,0,0,0,0,0x90,0x90,0x90};
    int32_t offset = (int32_t)((intptr_t)relay-(intptr_t)(site+5));
    memcpy(patch+1,&offset,sizeof offset);
    if (!mm_write(site,patch,sizeof patch)) {
        mm_write(site,original,sizeof original);
        mm_log("Armor resistance fix: installation failed.\r\n");
        return 0;
    }
    mm_log("Armor resistance fix: incoming physical damage type selected.\r\n");
    return 1;
}

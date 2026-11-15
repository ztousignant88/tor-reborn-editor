/* Shared formation limit used for the counter, confirmation and deployment. */
static void mm_install_formation_limit(unsigned limit) {
    if (limit == 0 || limit > 12) return;
    static const unsigned char original[] = {0x40,0x53,0x48,0x83,0xec,0x20};
    unsigned char replacement[] = {0xb8,(unsigned char)limit,0,0,0,0xc3};
    unsigned char *site = mm_base + 0x374f60;
    if (memcmp(site,original,sizeof(original))) {
        mm_log("Formation limit: unsupported patch site.\r\n");
        return;
    }
    if (!mm_write(site,replacement,sizeof(replacement))) {
        mm_write(site,original,sizeof(original));
        mm_log("Formation limit: patch failed; restoration attempted.\r\n");
        return;
    }
    char message[64];
    snprintf(message,sizeof(message),"Formation limit: %u selectable units.\r\n",limit);
    mm_log(message);
}

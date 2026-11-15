/* Battle sync keeps the original unit level at +0x114 and writes the
 * effective level at +0x4a. Keep the original level and recalculate stats.
 * Equipment sync has its own combat and item-preview cap readers. */
static void mm_disable_battle_sync(void) {
    static const struct {
        unsigned rva, length;
        unsigned char original[6], replacement[6];
    } patches[] = {
        {0x32ddc7, 4, {0x44,0x0f,0x42,0xc0}, {0x90,0x90,0x90,0x90}},
        {0x31d4c2, 2, {0xb2,0x01}, {0x32,0xd2}},
        {0x32f860, 4, {0x80,0x79,0x28,0x00}, {0x33,0xc0,0xc3,0x90}},
        {0x4615f0, 4, {0x48,0x83,0xec,0x28}, {0x33,0xc0,0xc3,0x90}},
        /* Select the native unavailable state for the formation control. */
        {0x47daf3, 5, {0x45,0x84,0xc0,0x75,0x19}, {0x33,0xc0,0xeb,0x13,0x90}},
    };
    const unsigned count = sizeof(patches) / sizeof(patches[0]);
    for (unsigned i = 0; i < count; ++i) {
        if (memcmp(mm_base + patches[i].rva, patches[i].original, patches[i].length)) {
            mm_log("Battle level sync: unsupported patch site.\r\n");
            return;
        }
    }
    for (unsigned i = 0; i < count; ++i) {
        if (!mm_write(mm_base + patches[i].rva, patches[i].replacement, patches[i].length)) {
            for (unsigned j = 0; j <= i; ++j)
                mm_write(mm_base + patches[j].rva, patches[j].original, patches[j].length);
            mm_log("Battle level sync: patch failed; restoration attempted.\r\n");
            return;
        }
    }
    mm_log("Battle level sync: unit and equipment scaling disabled.\r\n");
}

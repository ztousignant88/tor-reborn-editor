/* The recurring battlefield card branch in ATAutoDropBuffCardJob's worker
 * already has a no-spawn path. Take it before choosing a tile or card. */
static void mm_disable_buff_card_spawns(void) {
    unsigned char *block = mm_base + 0x35dace;
    const unsigned char expected[] = {
        0x48, 0x8d, 0x0d, 0xbb, 0x4f, 0xb2, 0x00,
        0xe8, 0x66, 0xec, 0xf8, 0xff, 0x84, 0xc0, 0x74, 0x60,
        0xf6, 0x43, 0x20, 0x01, 0x74, 0x5a
    };
    unsigned char *object_drop = mm_base + 0x35c00a;
    const unsigned char expected_object[] = {
        0x83, 0xff, 0x11, 0x74, 0x11, 0x48, 0x8b, 0x8e, 0x50, 0x1b, 0x00,
        0x00, 0x44, 0x8b, 0xc7, 0x8b, 0xd3, 0xe8, 0xa0, 0xec, 0x04, 0x00
    };
    if (memcmp(block, expected, sizeof expected) ||
        memcmp(object_drop, expected_object, sizeof expected_object)) {
        mm_log("Buff card spawns: skipped because the native code differs.\r\n");
        return;
    }
    const unsigned char skip = 0xeb;
    /* The object is already marked destroyed here. Skip its card creation. */
    const unsigned char skip_object_card[] = {0xeb, 0x14, 0x90, 0x90, 0x90};
    if (!mm_write(block + 20, &skip, sizeof skip) ||
        !mm_write(object_drop, skip_object_card, sizeof skip_object_card)) {
        mm_write(block + 20, expected + 20, 1);
        mm_write(object_drop, expected_object, sizeof skip_object_card);
        mm_log("Buff card spawns: runtime patch failed.\r\n");
        return;
    }
    mm_log("Buff card spawns: recurring spawns and object card drops disabled.\r\n");
}

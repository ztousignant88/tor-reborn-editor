/* PC 1.0.2. Enable with a matching verified table and widened picker.
 * The native bitmap and battle results record keep their original sizes. */
#ifndef SKL_CAPACITY
#define SKL_CAPACITY 928
#endif
_Static_assert(SKL_CAPACITY==928||SKL_CAPACITY==1024,"Unsupported learning layout");
#define SKL_LE32(n) ((n)&0xff), (((n)>>8)&0xff), 0, 0

static unsigned char skl_knows(const unsigned char *bitmap,uint16_t skill) {
    return bitmap&&skill<SKL_CAPACITY&&(bitmap[skill/8]&(1u<<(skill%8)))!=0;
}

static int mm_install_skill_learning_capacity(void) {
    static const struct {
        unsigned rva,length;
        unsigned char before[7],after[7];
    } changes[]={
        {0x43f34b,6,{0x41,0xbc,0x1e,0x03,0x00,0x00},{0x41,0xbc,SKL_LE32(SKL_CAPACITY-2)}},
        {0x43f41f,7,{0x41,0x81,0xf9,0x20,0x03,0x00,0x00},{0x41,0x81,0xf9,SKL_LE32(SKL_CAPACITY)}},
        {0x43f132,7,{0x41,0x81,0xf9,0x20,0x03,0x00,0x00},{0x41,0x81,0xf9,SKL_LE32(SKL_CAPACITY)}},
        /* Templates can grant skills directly, outside the learn-level loop. */
        {0x43f4e3,6,{0x41,0xb8,0x1e,0x03,0x00,0x00},{0x41,0xb8,SKL_LE32(SKL_CAPACITY-2)}},
    };
    static const unsigned char query_before[]={
        0x4c,0x8b,0xc9,0x0f,0xb7,0xc2,0x48,0xc1,0xe8,0x03,0x41,0xb8,0x01,0,0,0
    };
    const unsigned count=sizeof(changes)/sizeof(changes[0]);
    unsigned char *query_site=mm_base+0x43f2b0;
    if (memcmp(query_site,query_before,sizeof(query_before))) return 0;
    for (unsigned i=0;i<count;i++) {
        if (memcmp(mm_base+changes[i].rva,changes[i].before,changes[i].length)) return 0;
    }
    unsigned char patch[sizeof(query_before)];
    memset(patch,0x90,sizeof(patch));
    mm_abs_jump(patch,(void*)skl_knows);
    if (!mm_write(query_site,patch,sizeof(patch))) {
        mm_write(query_site,query_before,sizeof(query_before));
        return 0;
    }
    for (unsigned i=0;i<count;i++) {
        if (!mm_write(mm_base+changes[i].rva,changes[i].after,changes[i].length)) {
            for (unsigned n=i+1;n>0;n--) {
                const unsigned j=n-1;
                mm_write(mm_base+changes[j].rva,changes[j].before,changes[j].length);
            }
            mm_write(query_site,query_before,sizeof(query_before));
            return 0;
        }
    }
    return 1;
}
#undef SKL_LE32

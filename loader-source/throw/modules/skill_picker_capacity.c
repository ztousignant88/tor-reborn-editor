/* PC 1.0.2 skill-picker adapter. Load only with a matching expanded
 * skill table and the matching expanded learning rules. */
#ifndef SKP_CAPACITY
#define SKP_CAPACITY 1024
#endif
enum {
    SKP_STOCK=800, SKP_ORDER=0x1890,
    SKP_GROWTH=(SKP_CAPACITY-SKP_STOCK)*2,
    SKP_FRAME=0x698+SKP_GROWTH
};
_Static_assert(SKP_CAPACITY==928||SKP_CAPACITY==1024||SKP_CAPACITY==1056,"Unsupported picker layout");
#define SKP_LE16(n) ((n)&0xff), (((n)>>8)&0xff)
#define SKP_LE32(n) SKP_LE16(n), 0, 0

static void skp_sort(const unsigned char *context,uint16_t *items,int count) {
    if (count<2||count>SKP_CAPACITY) return;
    uint16_t sorted[SKP_CAPACITY];
    unsigned char written[SKP_CAPACITY]={0};
    unsigned used=0;
    for (unsigned n=0;n<SKP_STOCK;n++) {
        uint16_t ident;
        memcpy(&ident,context+SKP_ORDER+2*n,2);
        if (ident>=SKP_STOCK) continue;
        for (int i=0;i<count;i++) {
            if (!written[i]&&(items[i]&0x7fff)==ident) {
                sorted[used++]=items[i];
                written[i]=1;
            }
        }
    }
    /* IDs outside the stock order keep their order in the native scan. */
    for (int i=0;i<count;i++) if (!written[i]) sorted[used++]=items[i];
    memcpy(items,sorted,used*sizeof(*items));
}

static int mm_install_skill_picker_capacity(void) {
    static const struct {
        unsigned rva,length;
        unsigned char before[8],after[8];
    } changes[]={
        /* Original caller's frame, ID buffer, cookie and saved registers. */
        {0x465749,7,{0x48,0x81,0xec,0x98,0x06,0,0},{0x48,0x81,0xec,SKP_LE32(SKP_FRAME)}},
        {0x46575a,8,{0x48,0x89,0x84,0x24,0x80,0x06,0,0},{0x48,0x89,0x84,0x24,SKP_LE32(SKP_FRAME-0x18)}},
        {0x46578c,6,{0x41,0xb8,0x40,0x06,0,0},{0x41,0xb8,SKP_LE32(SKP_CAPACITY*2)}},
        {0x4657f1,8,{0x4c,0x89,0xa4,0x24,0xe8,0x06,0,0},{0x4c,0x89,0xa4,0x24,SKP_LE32(SKP_FRAME+0x50)}},
        {0x465822,8,{0x4c,0x89,0xbc,0x24,0x90,0x06,0,0},{0x4c,0x89,0xbc,0x24,SKP_LE32(SKP_FRAME-8)}},
        {0x4658f5,8,{0x4c,0x8b,0xbc,0x24,0x90,0x06,0,0},{0x4c,0x8b,0xbc,0x24,SKP_LE32(SKP_FRAME-8)}},
        {0x465900,8,{0x4c,0x8b,0xa4,0x24,0xe8,0x06,0,0},{0x4c,0x8b,0xa4,0x24,SKP_LE32(SKP_FRAME+0x50)}},
        {0x46590e,8,{0x48,0x8b,0x8c,0x24,0x80,0x06,0,0},{0x48,0x8b,0x8c,0x24,SKP_LE32(SKP_FRAME-0x18)}},
        {0x46591e,7,{0x48,0x81,0xc4,0x98,0x06,0,0},{0x48,0x81,0xc4,SKP_LE32(SKP_FRAME)}},
        /* Windows unwind records and the GS handler's cookie displacement. */
        {0xc7f626,2,{0xd3,0x00},{SKP_LE16(SKP_FRAME/8)}},
        {0xc7f638,4,{0x80,0x06,0,0},{SKP_LE32(SKP_FRAME-0x18)}},
        {0xc7f642,2,{0xdd,0x00},{SKP_LE16((SKP_FRAME+0x50)/8)}},
        {0xc7f656,2,{0xd2,0x00},{SKP_LE16((SKP_FRAME-8)/8)}},
        /* A unit with only expanded skills must be able to open the menu. */
        {0x4614ae,6,{0x81,0xfb,0x20,0x03,0,0},{0x81,0xfb,SKP_LE32(SKP_CAPACITY)}},
        {0x464977,6,{0x81,0xfb,0x20,0x03,0,0},{0x81,0xfb,SKP_LE32(SKP_CAPACITY)}},
        /* Widen the picker scan only after the caller and sorter are ready. */
        {0x43d722,6,{0x81,0xfb,0x20,0x03,0,0},{0x81,0xfb,SKP_LE32(SKP_CAPACITY)}},
    };
    static const unsigned char sort_before[]={0xe8,0x19,0x14,0xe6,0xff};
    static const unsigned char rows_before[]={0xbe,0x36,0x07,0,0};
    const unsigned count=sizeof(changes)/sizeof(changes[0]);
    unsigned char *sort_site=mm_base+0x465812;
    if (memcmp(sort_site,sort_before,5)||memcmp(mm_base+0x51cbfe,rows_before,5)) return 0;
    for (unsigned i=0;i<count;i++) {
        if (memcmp(mm_base+changes[i].rva,changes[i].before,changes[i].length)) return 0;
    }
    unsigned char *relay=mm_near_page();
    if (!relay) return 0;
    mm_abs_jump(relay,(void*)skp_sort);
    FlushInstructionCache(GetCurrentProcess(),relay,14);
    unsigned char call[5]={0xe8};
    const int32_t delta=(int32_t)((intptr_t)relay-(intptr_t)(sort_site+5));
    memcpy(call+1,&delta,4);
    if (!mm_write(sort_site,call,5)) {
        mm_write(sort_site,sort_before,5);
        return 0;
    }
    for (unsigned i=0;i<count;i++) {
        if (!mm_write(mm_base+changes[i].rva,changes[i].after,changes[i].length)) {
            for (unsigned n=i+1;n>0;n--) {
                const unsigned j=n-1;
                mm_write(mm_base+changes[j].rva,changes[j].before,changes[j].length);
            }
            mm_write(sort_site,sort_before,5);
            return 0;
        }
    }
    return 1;
}
#undef SKP_LE32
#undef SKP_LE16

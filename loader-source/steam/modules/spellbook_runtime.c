/* PC 1.0.2 isolated shared-loader candidate.
 * Install only with verified effect, commodity and profile table layouts. */
#include "spellbook_pool.c"

static const unsigned char *sb_table(unsigned rva){
    const unsigned char *table;
    memcpy(&table,mm_base+rva,sizeof(table));
    return table;
}

static void sb_npc(unsigned char *unit,const unsigned char *entry,uint32_t *seed){
    npc_spellbook_loadout(mm_base,unit,entry,seed);
}

static void sb_party(unsigned char *state,unsigned unit_index){
    party_spellbook_loadout(mm_base,state,unit_index);
}

static int sb_fallback(uint16_t *dst,const uint16_t *source,const struct Families *families){
    return build_book_pool(dst,source,sb_table(0xd68318),sb_table(0xd68348),families);
}

struct SbVariant {
    uint16_t effect;
    const unsigned char *row;
};
_Static_assert(sizeof(struct SbVariant)==16,"Unexpected effect variant layout");

static int sb_variants(const unsigned char *manager,uint32_t family,struct SbVariant *out){
    const unsigned char *effects;
    memcpy(&effects,manager+0xb8,sizeof(effects));
    const unsigned count=book_u32(effects+4),stride=book_u32(effects+12);
    if(!family||count>EFFECT_CAPACITY||stride!=180)return 0;
    const unsigned char *rows=effects+book_u32(effects+8);
    int written=0;
    /* 0x4405F0 reserves exactly 16 variants in its original stack frame. */
    for(unsigned id=(uint16_t)family;id<count&&written<16;id++){
        const unsigned char *row=rows+id*stride;
        if(book_u16(row+0x1a)==family)out[written++]=(struct SbVariant){(uint16_t)id,row};
    }
    return written;
}

static int sb_branch(unsigned char *out,unsigned from,const void *to){
    intptr_t delta=(intptr_t)to-(intptr_t)(mm_base+from+5);
    if(delta<INT32_MIN||delta>INT32_MAX)return 0;
    int32_t rel=(int32_t)delta;
    out[0]=0xe8;
    memcpy(out+1,&rel,sizeof(rel));
    return 1;
}

static int mm_install_spellbook_capacity(void){
    enum { FALLBACK_RVA=0x445469 };
    struct {
        unsigned rva,length;
        unsigned char before[83],after[83];
    } changes[]={
        {0x3363bf,5,{0xbf,0xdc,0x02,0x00,0x00},{0x41,0x8b,0x7a,0x04,0x90}},
        {0x443cbc,6,{0x41,0xbf,0xdc,0x02,0x00,0x00},{0x45,0x8b,0x78,0x04,0x90,0x90}},
        {0x443d85,5,{0xbe,0xdc,0x02,0x00,0x00},{0x41,0x8b,0x71,0x04,0x90}},
        {0x445283,7,{0x48,0x8d,0x8d,0x00,0x06,0x00,0x00},{0x48,0x8d,0x8d,0x40,0,0,0}},
        {0x44529c,7,{0x48,0x8d,0x8d,0x00,0x06,0x00,0x00},{0x48,0x8d,0x8d,0x40,0,0,0}},
        {0x44528d,6,{0x41,0xb8,0xb8,0x05,0x00,0x00},{0x41,0xb8,0xd0,0x07,0,0}},
        {0x335e64,5,{0xe8,0xb7,0xe5,0x10,0x00},{0}},
        {0x525aab,5,{0xe8,0xa0,0x9f,0xdf,0xff},{0}},
        {0x4454dc,5,{0xe8,0xff,0xe6,0xff,0xff},{0}},
        {0x4439b0,5,{0xe8,0xcb,0x08,0xe9,0xff},{0}},
        {FALLBACK_RVA,83,{0x48,0x8d,0x55,0xc0,0x48,0x89,0x85,0xc8,0x0b,0x00,0x00,0x4c,0x8d,0x85,0xc8,0x0b,0x00,0x00,0x48,0x8d,0x0d,0x0e,0x2e,0x92,0x00,0xe8,0x89,0xea,0xe8,0xff,0x4c,0x8d,0x45,0xc0,0x48,0x8d,0x54,0x24,0x60,0x48,0x8d,0x0d,0xf9,0x2d,0x92,0x00,0xe8,0x44,0xeb,0xe8,0xff,0x48,0x8d,0x4d,0x40,0x49,0x8b,0xd6,0x41,0xb8,0xb8,0x05,0x00,0x00,0xe8,0x74,0xc0,0x10,0x00,0x48,0x8d,0x54,0x24,0x60,0x48,0x8d,0x4d,0x40,0xe8,0x44,0xe3,0xff,0xff},{0}},
    };
    const unsigned count=sizeof(changes)/sizeof(changes[0]);
    for(unsigned i=0;i<count;i++){
        if(memcmp(mm_base+changes[i].rva,changes[i].before,changes[i].length))return 0;
    }
    unsigned char *relay=mm_near_page();
    if(!relay)return 0;
    void *const helpers[]={(void*)sb_npc,(void*)sb_party,(void*)pick_spellbook_slot,
                          (void*)sb_variants,(void*)sb_fallback};
    for(unsigned i=0;i<sizeof(helpers)/sizeof(helpers[0]);i++)mm_abs_jump(relay+i*16,helpers[i]);
    for(unsigned i=6;i<=9;i++){
        if(!sb_branch(changes[i].after,changes[i].rva,relay+(i-6)*16)){
            VirtualFree(relay,0,MEM_RELEASE);
            return 0;
        }
    }
    const unsigned char setup[]={
        0x48,0x89,0x85,0xc8,0x0b,0,0, /* list pointer */
        0x4c,0x8d,0x85,0xc8,0x0b,0,0, /* r8: family list */
        0x49,0x8b,0xd6,                /* rdx: original 1,000-word pool */
        0x48,0x8d,0x4d,0x40            /* rcx: shared scratch */
    };
    unsigned char *fallback=changes[10].after;
    memset(fallback,0x90,changes[10].length);
    memcpy(fallback,setup,sizeof(setup));
    if(!sb_branch(fallback+sizeof(setup),FALLBACK_RVA+sizeof(setup),relay+64)){
        VirtualFree(relay,0,MEM_RELEASE);
        return 0;
    }
    const unsigned char check[]={0x85,0xc0,0x0f,0x84};
    unsigned tail=sizeof(setup)+5;
    memcpy(fallback+tail,check,sizeof(check));
    const int32_t skip=0x4455f5-(FALLBACK_RVA+tail+sizeof(check)+4);
    memcpy(fallback+tail+sizeof(check),&skip,sizeof(skip));
    FlushInstructionCache(GetCurrentProcess(),relay,80);
    for(unsigned i=0;i<count;i++){
        if(!mm_write(mm_base+changes[i].rva,changes[i].after,changes[i].length)){
            int restored=1;
            for(unsigned n=i+1;n>0;n--){
                const unsigned j=n-1;
                if(!mm_write(mm_base+changes[j].rva,changes[j].before,changes[j].length))restored=0;
            }
            if(restored)VirtualFree(relay,0,MEM_RELEASE);
            return 0;
        }
    }
    return 1;
}

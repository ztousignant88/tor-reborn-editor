/* Expanded spell IDs have no corresponding numbered texture. Use the icon
 * assigned to the effect row, as the shop's spellbook preview already does. */
static const char *mfx_spell_icon(unsigned id){
    typedef const char *(*IconName)(unsigned);
    if(id>=902 && id<1030){
        const unsigned char *effects=sb_table(0xd78e88);
        if(effects && book_u32(effects+4)>id && book_u32(effects+12)==180){
            const unsigned char *row=effects+book_u32(effects+8)+id*180;
            if(row[0xac]==1)return ((IconName)(mm_base+0x2bbe10))(id);
        }
    }
    return ((IconName)(mm_base+0x2bc010))(id);
}

static int mfx_install_spell_icons(unsigned char *relay){
    static const unsigned calls[]={0x46a42b,0x4ca6a6,0x513660,0x51a534,0x522374,0x546fc0};
    static const unsigned jumps[]={0x512cdd,0x54686d};
    mm_abs_jump(relay,(void*)mfx_spell_icon);
    FlushInstructionCache(GetCurrentProcess(),relay,16);
    for(unsigned opcode=0xe8;opcode<=0xe9;opcode++){
        const unsigned *sites=opcode==0xe8?calls:jumps;
        unsigned count=opcode==0xe8?sizeof(calls)/sizeof(*calls):sizeof(jumps)/sizeof(*jumps);
        for(unsigned i=0;i<count;i++){
            unsigned site=sites[i];
            unsigned char before[5],after[5];
            sb_branch(before,site,mm_base+0x2bc010);
            before[0]=(unsigned char)opcode;
            if(memcmp(mm_base+site,before,5) || !sb_branch(after,site,relay))return 0;
            after[0]=(unsigned char)opcode;
            if(!mfx_write(mm_base+site,after,5))return 0;
        }
    }
    return 1;
}

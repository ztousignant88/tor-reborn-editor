/* Expanded spell IDs have no corresponding numbered texture. Use the icon
 * assigned to the effect row, as the shop's spellbook preview already does. */
static const char *mfx_spell_icon(unsigned id){
    typedef const char *(*IconName)(unsigned);
    if(id>=902 && id<1030){
        const unsigned char *effects=sb_table(0xd68348);
        if(effects && book_u32(effects+4)>id && book_u32(effects+12)==180){
            const unsigned char *row=effects+book_u32(effects+8)+id*180;
            if(row[0xac]==1)return ((IconName)(mm_base+0x2bde80))(id);
        }
    }
    return ((IconName)(mm_base+0x2be080))(id);
}

static int mfx_install_spell_icons(unsigned char *relay){
    static const unsigned calls[]={0x46d77b,0x4cd9d6,0x5169d0,0x51d884,0x525734,0x54a300};
    static const unsigned jumps[]={0x51604d,0x549bad};
    mm_abs_jump(relay,(void*)mfx_spell_icon);
    FlushInstructionCache(GetCurrentProcess(),relay,16);
    for(unsigned opcode=0xe8;opcode<=0xe9;opcode++){
        const unsigned *sites=opcode==0xe8?calls:jumps;
        unsigned count=opcode==0xe8?sizeof(calls)/sizeof(*calls):sizeof(jumps)/sizeof(*jumps);
        for(unsigned i=0;i<count;i++){
            unsigned site=sites[i];
            unsigned char before[5],after[5];
            sb_branch(before,site,mm_base+0x2be080);
            before[0]=(unsigned char)opcode;
            if(memcmp(mm_base+site,before,5) || !sb_branch(after,site,relay))return 0;
            after[0]=(unsigned char)opcode;
            if(!mfx_write(mm_base+site,after,5))return 0;
        }
    }
    return 1;
}

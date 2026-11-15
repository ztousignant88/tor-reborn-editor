#define CI_EFFECTS 0xd68348
#define CI_SKILLS 0xd682f8
#define CI_EFFECT_ICON 0x2bde80
static const unsigned ci_sites[][2] = {
    {0x2be080, 0xc9aa10},
    {0x2be050, 0xc9aa08},
    {0x2bdf40, 0xc9aa18},
};
/* Included after effect_runtime.c. Keep native fallbacks for unassigned icons. */
typedef const char *(*CustomIconName)(unsigned);
static CustomIconName ci_native[3];

static const unsigned char *ci_row(const unsigned char *table, unsigned id, unsigned stride){
    if (!table || id >= book_u32(table+4) || book_u32(table+12) != stride)
        return NULL;
    return table+book_u32(table+8)+(size_t)id*stride;
}

static unsigned ci_word(const unsigned char *data){
    return data[0] | ((unsigned)data[1]<<8);
}

static const char *ci_lookup(unsigned bank, unsigned id){
    unsigned effect = id;
    if (bank == 2){
        const unsigned char *skills = sb_table(CI_SKILLS);
        unsigned stride = skills ? book_u32(skills+12) : 0;
        const unsigned char *skill = stride == 102 || stride == 166 ? ci_row(skills,id,stride) : NULL;
        effect = skill && skill[2] ? ci_word(skill+4) : 0;
    }
    const unsigned char *row = effect ? ci_row(sb_table(CI_EFFECTS),effect,180) : NULL;
    if (row && row[2] && row[0xac] == bank){
        unsigned icon = ci_word(row+0xaa);
        if (icon >= 2000 && icon <= 9999)
            return ((CustomIconName)(mm_base+CI_EFFECT_ICON))(effect);
    }
    return ci_native[bank-1](id);
}

static const char *ci_spell(unsigned id){return ci_lookup(1,id);}
static const char *ci_skill(unsigned id){return ci_lookup(2,id);}
static const char *ci_finisher(unsigned id){return ci_lookup(3,id);}

static int ci_install(void){
    static const CustomIconName dispatch[] = {ci_spell,ci_skill,ci_finisher};
    unsigned char before[3][11], after[3][11];
    for (unsigned i=0; i<3; ++i){
        const unsigned site = ci_sites[i][0], pattern = ci_sites[i][1];
        const int32_t offset = (int32_t)(pattern - (site + 11));
        const unsigned char prologue[] = {0x48,0x83,0xec,0x28,0x48,0x8b,0x15};
        memcpy(before[i],prologue,sizeof(prologue));
        memcpy(before[i]+sizeof(prologue),&offset,sizeof(offset));
        if (memcmp(mm_base+site,before[i],sizeof(before[i]))) return 0;
    }
    unsigned char *page = mm_near_page();
    if (!page) return 0;
    for (unsigned i=0; i<3; ++i){
        const unsigned site = ci_sites[i][0];
        unsigned char *relay = page+i*48, *native = relay+16;
        const intptr_t offset = (mm_base+ci_sites[i][1]) - (native+11);
        memset(after[i],0x90,sizeof(after[i]));
        if (offset < INT32_MIN || offset > INT32_MAX || !sb_branch(after[i],site,relay)){
            VirtualFree(page,0,MEM_RELEASE);
            return 0;
        }
        after[i][0] = 0xe9;
        const int32_t relative = (int32_t)offset;
        mm_abs_jump(relay,(void *)dispatch[i]);
        memcpy(native,before[i],sizeof(before[i]));
        memcpy(native+7,&relative,sizeof(relative));
        mm_abs_jump(native+11,mm_base+site+11);
        ci_native[i] = (CustomIconName)native;
    }
    FlushInstructionCache(GetCurrentProcess(),page,3*48);
    for (unsigned i=0; i<3; ++i){
        if (mm_write(mm_base+ci_sites[i][0],after[i],sizeof(after[i]))) continue;
        int restored=1;
        for (unsigned j=0; j<=i; ++j)
            if (!mm_write(mm_base+ci_sites[j][0],before[j],sizeof(before[j]))) restored=0;
        if (restored) VirtualFree(page,0,MEM_RELEASE);
        return 0;
    }
    return 1;
}

static void mm_install_custom_icons(const wchar_t *config){
    if (GetPrivateProfileIntW(L"CustomIcons",L"Enabled",0,config))
        mm_log(ci_install() ? "Custom ability icons installed.\r\n" : "Custom ability icons could not be installed.\r\n");
}

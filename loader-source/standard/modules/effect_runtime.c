/* PC 1.0.2 effects playtest. Included after class_groups.c. */
static struct {
    void *address;
    size_t length;
    unsigned char original[83];
} mfx_writes[32];
static unsigned mfx_count;
static void *mfx_pages[2];
static unsigned mfx_page_count;

static int mfx_write(void *address,const void *data,size_t length){
    if(mfx_count>=32||length>sizeof(mfx_writes[0].original))return 0;
    mfx_writes[mfx_count].address=address;
    mfx_writes[mfx_count].length=length;
    memcpy(mfx_writes[mfx_count++].original,address,length);
    return mm_write(address,data,length);
}
static void *mfx_near_page(void){
    if(mfx_page_count>=2)return NULL;
    void *page=mm_near_page();
    if(page)mfx_pages[mfx_page_count++]=page;
    return page;
}
/* The outer transaction owns relay cleanup after it restores all writes. */
static BOOL WINAPI mfx_keep_page(void *page,SIZE_T size,DWORD mode){
    (void)page;(void)size;(void)mode;return TRUE;
}

#define mm_write mfx_write
#define mm_near_page mfx_near_page
#define VirtualFree mfx_keep_page
#include "spellbook_runtime.c"
#undef VirtualFree
#undef mm_near_page
#undef mm_write

#include "effect_rank.c"
#include "effect_sort.c"

static int mfx_rank(uint16_t *out,uint16_t proficiency,uint16_t weapon,int old_rank,int new_rank){
    return effect_rank_unlocks(out,sb_table(0xd78e38),sb_table(0xd78e88),proficiency,weapon,old_rank,new_rank);
}

static unsigned char mfx_reorder(void *context,uint16_t from,uint16_t to){
    typedef unsigned char (*Reorder)(void *,uint16_t,uint16_t);
    if(from>=STOCK_EFFECTS||to>=STOCK_EFFECTS)return 0;
    return ((Reorder)(mm_base+0x2c6330))(context,from,to);
}

#include "spell_menu_icons.c"

static int mfx_sort_and_rank(void){
    static const struct {unsigned site,target;unsigned char before[5];} patches[]={
        {0x44437c,0,{0xe8,0xcf,0xfb,0xff,0xff}},
        {0x444555,0,{0xe8,0xf6,0xf9,0xff,0xff}},
        {0x3bd1df,1,{0xe8,0xcc,0x97,0xf0,0xff}},
        {0x3bd305,1,{0xe8,0xa6,0x96,0xf0,0xff}},
        {0x3bd421,1,{0xe8,0x8a,0x95,0xf0,0xff}},
        {0x54957f,2,{0xe8,0xac,0xcd,0xd7,0xff}},
    };
    for(unsigned i=0;i<sizeof(patches)/sizeof(patches[0]);i++){
        if(memcmp(mm_base+patches[i].site,patches[i].before,5))return 0;
    }
    unsigned char *relay=mfx_near_page();
    if(!relay)return 0;
    mm_abs_jump(relay,(void*)mfx_rank);
    mm_abs_jump(relay+16,(void*)sort_effects);
    mm_abs_jump(relay+32,(void*)mfx_reorder);
    FlushInstructionCache(GetCurrentProcess(),relay,48);
    for(unsigned i=0;i<sizeof(patches)/sizeof(patches[0]);i++){
        unsigned char branch[5];
        unsigned site=patches[i].site;
        if(!sb_branch(branch,site,relay+16*patches[i].target)||!mfx_write(mm_base+site,branch,5))return 0;
    }
    return mfx_install_spell_icons(relay+48);
}

static int mfx_install(void){
    mfx_count=0;
    mfx_page_count=0;
    if(mm_install_spellbook_capacity()&&mfx_sort_and_rank()){
        mfx_count=0;
        return 1;
    }
    int restored=1;
    while(mfx_count){
        --mfx_count;
        if(!mm_write(mfx_writes[mfx_count].address,mfx_writes[mfx_count].original,mfx_writes[mfx_count].length))restored=0;
    }
    if(restored)for(unsigned i=0;i<mfx_page_count;i++)VirtualFree(mfx_pages[i],0,MEM_RELEASE);
    return 0;
}

static int mfx_archive_matches(const wchar_t *config,const wchar_t *section){
    wchar_t text[66],path[32768];
    unsigned char expected[32],actual[32];
    if(GetPrivateProfileStringW(section,L"BattleSHA256",L"",text,66,config)!=64||
       !mpg_hex(text,expected))return 0;
    const wchar_t *slash=wcsrchr(config,L'\\');
    static const wchar_t suffix[]=L"\\Data\\battle\\battle_data_release.dat";
    if(!slash)return 0;
    size_t prefix=(size_t)(slash-config);
    if(prefix+sizeof(suffix)/sizeof(*suffix)>sizeof(path)/sizeof(*path))return 0;
    wmemcpy(path,config,prefix);
    wcscpy(path+prefix,suffix);
    DWORD size=0;
    unsigned char *archive=mpg_read_file(path,&size);
    if(!archive)return 0;
    int okay=mpg_sha256(archive,size,actual)&&!memcmp(actual,expected,32);
    HeapFree(GetProcessHeap(),0,archive);
    return okay;
}

static void mm_install_effect_slots(const wchar_t *config){
    if(!GetPrivateProfileIntW(L"ModPreparationEffects",L"Enabled",0,config))return;
    if(!mfx_archive_matches(config,L"ModPreparationEffects")){
        mm_log("Mod Preparation effects disabled: battle archive mismatch.\r\n");
        return;
    }
    if(!mfx_install()){
        mm_log("Mod Preparation effects disabled: native hook installation failed.\r\n");
        return;
    }
    mfx_spellbook_capacity_active = 1;
    mm_log("Mod Preparation effect capacity: 1030 rows.\r\n");
}

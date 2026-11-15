/* Included after class_groups.c for the shared archive and SHA-256 helpers. */
enum { MPS_MAX_WRITES=48, MPS_MAX_BYTES=16 };
static struct {
    void *address;
    size_t size;
    unsigned char original[MPS_MAX_BYTES];
} mps_writes[MPS_MAX_WRITES];
static unsigned mps_count;
static void *mps_relay;

static int mps_write(void *address,const void *data,size_t size){
    if(mps_count>=MPS_MAX_WRITES||size>MPS_MAX_BYTES)return 0;
    mps_writes[mps_count].address=address;
    mps_writes[mps_count].size=size;
    memcpy(mps_writes[mps_count++].original,address,size);
    return mm_write(address,data,size);
}
static void *mps_near_page(void){
    mps_relay=mm_near_page();
    return mps_relay;
}

#define mm_write mps_write
#define mm_near_page mps_near_page
#define SKP_CAPACITY 928
#include "skill_picker_capacity.c"
#include "skill_learning_capacity.c"
#undef SKP_CAPACITY
#undef mm_near_page
#undef mm_write

static int mps_install_hooks(void){
    mps_count=0;
    mps_relay=NULL;
    if(mm_install_skill_learning_capacity()&&mm_install_skill_picker_capacity()){
        mps_count=0;
        return 1;
    }
    int restored=1;
    while(mps_count){
        --mps_count;
        if(!mm_write(mps_writes[mps_count].address,mps_writes[mps_count].original,
                     mps_writes[mps_count].size))restored=0;
    }
    if(restored&&mps_relay)VirtualFree(mps_relay,0,MEM_RELEASE);
    return 0;
}

static int mps_verify_archive(const wchar_t *config,const wchar_t *section){
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

static void mm_install_skill_slots(const wchar_t *config){
    if(!GetPrivateProfileIntW(L"ModPreparationSkills",L"Enabled",0,config))return;
    if(!mps_verify_archive(config,L"ModPreparationSkills")){
        mm_log("Mod Preparation skills disabled: the battle archive does not match Apply Project.\r\n");
        return;
    }
    if(!mps_install_hooks()){
        mm_log("Mod Preparation skills disabled: native hook installation failed.\r\n");
        return;
    }
    mm_log("Mod Preparation skill capacity: 928 rows.\r\n");
}

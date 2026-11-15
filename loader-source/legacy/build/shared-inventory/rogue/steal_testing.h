/* Optional Denam battle-menu fixture. No extra skills are written to saves. */
typedef int (*TestSkillListFn)(uint16_t *,void *);
typedef int (*SkillRankFn)(void *,uint16_t);
static TestSkillListFn native_test_skill_list;
static SkillRankFn original_skill_rank;
static int denam_test_enabled;
static byte *test_skill_gateway;
static int test_skill_call_installed;

static int test_denam(void *character) {
    return denam_test_enabled && equipment_theft_enabled &&
        (steal_mode==STEAL_MODE_CATEGORIES || steal_mode==STEAL_MODE_COMBINED) && character &&
        word(character,0)==1 && ((byte*)character)[0x50]==1;
}
static int test_skill(uint16_t skill) {
    if(steal_mode==STEAL_MODE_COMBINED && skill==228)return 1;
    if(traps_enabled && (skill==327 || skill==346 || skill==274 || skill==275))return 1;
    for(unsigned i=1;i<sizeof(theft_skills)/sizeof(theft_skills[0]);++i)
        if(theft_skills[i].skill==skill)return 1;
    return 0;
}
static int hook_skill_rank(void *character,uint16_t skill) {
    if(test_denam(character) && test_skill(skill))return 1;
    return original_skill_rank(character,skill);
}
static int hook_test_skill_list(uint16_t *out,void *character) {
    int count=native_test_skill_list(out,character);
    int extra=(steal_mode==STEAL_MODE_COMBINED?10:9)+(traps_enabled?4:0);
    if(!test_denam(character) || !out || count<0 || count>300-extra)return count;
    int used=0;
    for(int i=0;i<count;++i){
        if(steal_mode!=STEAL_MODE_COMBINED && out[i]==228)continue;
        int duplicate=0;if(test_skill(out[i]))for(int j=0;j<used;++j)if(out[j]==out[i])duplicate=1;
        if(!duplicate)out[used++]=out[i];
    }
    for(unsigned r=steal_mode==STEAL_MODE_COMBINED?0:1;r<sizeof(theft_skills)/sizeof(theft_skills[0]);++r){
        uint16_t id=theft_skills[r].skill;int found=0;
        for(int i=0;i<used;++i)if(out[i]==id)found=1;
        if(!found)out[used++]=id;
    }
    if(traps_enabled){
        const uint16_t extra[4]={327,274,346,275};
        for(unsigned r=0;r<4;++r){int found=0;for(int i=0;i<used;++i)if(out[i]==extra[r])found=1;
            if(!found)out[used++]=extra[r];}
    }
    return used;
}
/* Only this native call has a 300-u16 scratch array and builds the scrolling
 * battle Action list. Never extend the four-u16 party/equipment buffers. */
static int install_test_skill_call(void) {
    if(!denam_test_enabled)return 1;
    byte *site=base+0x4201b6;
    if(memcmp(site,fp_test_skill_call,5))return 0;
    SYSTEM_INFO info;GetSystemInfo(&info);
    uintptr_t step=info.dwAllocationGranularity;
    uintptr_t origin=(uintptr_t)site&~(step-1u);
    for(uintptr_t distance=step;distance<0x70000000u && !test_skill_gateway;distance+=step){
        uintptr_t candidates[2]={origin+distance,origin>distance?origin-distance:0};
        for(unsigned i=0;i<2 && !test_skill_gateway;++i){
            if(candidates[i]<0x10000u)continue;
            MEMORY_BASIC_INFORMATION memory;
            if(!VirtualQuery((void*)candidates[i],&memory,sizeof(memory)) || memory.State!=MEM_FREE)continue;
            test_skill_gateway=VirtualAlloc((void*)candidates[i],14,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);
        }
    }
    if(!test_skill_gateway)return 0;
    test_skill_gateway[0]=0xff;test_skill_gateway[1]=0x25;
    memset(test_skill_gateway+2,0,4);
    void *handler=hook_test_skill_list;memcpy(test_skill_gateway+6,&handler,8);
    DWORD old,unused;
    if(!VirtualProtect(test_skill_gateway,14,PAGE_EXECUTE_READ,&old))return 0;
    FlushInstructionCache(GetCurrentProcess(),test_skill_gateway,14);
    int64_t delta=(int64_t)(uintptr_t)test_skill_gateway-(int64_t)(uintptr_t)(site+5);
    if(delta<INT32_MIN || delta>INT32_MAX)return 0;
    byte patch[5]={0xe8};int32_t relative=(int32_t)delta;memcpy(patch+1,&relative,4);
    if(!VirtualProtect(site,5,PAGE_EXECUTE_READWRITE,&old))return 0;
    memcpy(site,patch,5);
    if(!VirtualProtect(site,5,old,&unused)){
        memcpy(site,fp_test_skill_call,5);VirtualProtect(site,5,old,&unused);
        FlushInstructionCache(GetCurrentProcess(),site,5);return 0;
    }
    FlushInstructionCache(GetCurrentProcess(),site,5);test_skill_call_installed=1;
    return 1;
}
static void rollback_test_skill_call(void) {
    if(test_skill_call_installed){
        DWORD old,unused;byte *site=base+0x4201b6;
        if(VirtualProtect(site,5,PAGE_EXECUTE_READWRITE,&old)){
            memcpy(site,fp_test_skill_call,5);VirtualProtect(site,5,old,&unused);
            FlushInstructionCache(GetCurrentProcess(),site,5);
        }
        test_skill_call_installed=0;
    }
    if(test_skill_gateway){VirtualFree(test_skill_gateway,0,MEM_RELEASE);test_skill_gateway=NULL;}
}

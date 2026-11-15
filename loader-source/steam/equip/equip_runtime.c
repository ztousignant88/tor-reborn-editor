#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>
#include "equip_rules.h"
#include "fingerprints.h"
static unsigned char *base;
static wchar_t log_path[32768];
static volatile LONG grant_log_count;
#include "equipment_bank.h"
enum { EQ_PERM_CLASSES=256, EQ_PERM_GROUPS=64,
       EQ_PERM_ITEMS=EQUIPMENT_FIRST+EQUIPMENT_COUNT,
       EQ_PERM_STRIDE=(EQ_PERM_ITEMS+7)/8,
       EQ_PERM_LEGACY_STRIDE=(EQUIPMENT_FIRST+7)/8,
       EQ_PERM_HEADER=8+EQ_PERM_CLASSES,
       EQ_PERM_SIZE=EQ_PERM_HEADER+EQ_PERM_GROUPS*EQ_PERM_STRIDE,
       EQ_PERM_LEGACY_SIZE=EQ_PERM_HEADER+EQ_PERM_GROUPS*EQ_PERM_LEGACY_STRIDE };
static unsigned permission_stride, permission_limit;
static unsigned char permission_data[EQ_PERM_SIZE];
static int expanded_permissions,proficiency_enabled;
static void log_text(const char *s){HANDLE f=CreateFileW(log_path,FILE_APPEND_DATA,FILE_SHARE_READ|FILE_SHARE_WRITE,0,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,0);if(f!=INVALID_HANDLE_VALUE){DWORD n;WriteFile(f,s,(DWORD)strlen(s),&n,0);CloseHandle(f);}}
static int readable(const void *p,size_t n){uintptr_t a=(uintptr_t)p,end=a+n;if(!p||end<a)return 0;while(a<end){MEMORY_BASIC_INFORMATION m;if(!VirtualQuery((void*)a,&m,sizeof(m))||m.State!=MEM_COMMIT||(m.Protect&(PAGE_NOACCESS|PAGE_GUARD)))return 0;uintptr_t next=(uintptr_t)m.BaseAddress+m.RegionSize;if(next<=a)return 0;a=next;}return 1;}
typedef void *(*ManagerFn)(void);
typedef void *(*RowFn)(void*,uint16_t);
typedef unsigned char (*AllowFn)(uint16_t,unsigned);
typedef unsigned char (*SelectFn)(void*,const void*,uint16_t);
typedef void (*CleanFn)(void*,unsigned);
static AllowFn allow_original;
static SelectFn select_original;
static CleanFn clean_original;
typedef void *(*RankLookupFn)(void*,void*,uint16_t,const void*,int,const void*);
typedef unsigned char (*SkillSlotFn)(void*,uint16_t,const void*,int,const void*);
static RankLookupFn rank_original;
static SkillSlotFn slot_original;
typedef int (*UnlockFn)(uint16_t*,uint16_t,uint16_t,unsigned,unsigned);
static UnlockFn unlock_original;
static int unlock_hook(uint16_t *out,uint16_t skill,uint16_t class_id,unsigned previous,unsigned current){
    return unlock_original(out,eq_canonical_skill(skill),class_id,previous,current);
}
static unsigned char weapon_skill_hook(unsigned skill){
    // Only this finisher-list call site takes skill IDs, rather than weapon
    // categories. Do not widen the global predicate used for category arrays.
    if(eq_is_family((uint16_t)skill))return 1;
    return ((unsigned char(*)(unsigned))(base+0x3374a0))(skill);
}
typedef void (*InitializeRankFn)(void*,uint16_t);
static InitializeRankFn initialize_rank_original;
static volatile LONG preserve_log_count;
static void initialize_rank_hook(void *bank,uint16_t skill){
    // Native learning initializes each skill ID independently. I and II share
    // one rank index, so learning either must retain an already populated bank.
    if(readable(bank,100*8)&&eq_preserve_initialized_progress(bank,skill)){
        if(InterlockedIncrement(&preserve_log_count)<=20)log_text("Preserved shared weapon rank/XP while learning I or II.\r\n");
        return;
    }
    initialize_rank_original(bank,skill);
}
static void *rank_hook(void *skills,void *out,uint16_t query,const void *info,int party,const void *learned){
    if(readable(skills,0x1a))query=eq_resolve_skill(skills,query);
    return rank_original(skills,out,query,info,party,learned);
}
static unsigned char slot_hook(void *skills,uint16_t query,const void *info,int party,const void *learned){
    if(readable(skills,0x1a))query=eq_resolve_skill(skills,query);
    return slot_original(skills,query,info,party,learned);
}
static void *arm_row(uint16_t id){if(!id||id>=EQ_PERM_ITEMS)return 0;return ((RowFn)(base+0x2e6ab0))(((ManagerFn)(base+0x2e6f20))(),id);}
static int bonus(void *character,const void *row){return proficiency_enabled&&readable(character,0x1b8)&&readable(row,152)&&eq_bonus(character,row);}
static int expanded_rule(uint16_t item,unsigned class_id) {
    if (!expanded_permissions||!item||item>=permission_limit||class_id>=EQ_PERM_CLASSES) return -1;
    unsigned group=permission_data[8+class_id];
    if (group>=EQ_PERM_GROUPS) return -1;
    if (item>=EQUIPMENT_FIRST) {
        const unsigned char *row=arm_row(item);
        if (!readable(row,152)||!row[2]) return 0;
    }
    const unsigned char *bits=permission_data+EQ_PERM_HEADER+group*permission_stride;
    return (bits[item/8]>>(item%8))&1;
}
static unsigned class_id_of(const void *row) {
    const unsigned char *table=*(const unsigned char **)(base+0xd68338);
    if (!row||!readable(table,16)||memcmp(table,"xlce",4)) return EQ_PERM_CLASSES;
    uint32_t count,header,stride;
    memcpy(&count,table+4,4);memcpy(&header,table+8,4);memcpy(&stride,table+12,4);
    if (count!=EQ_PERM_CLASSES||stride!=208||header<16||header>4096) return EQ_PERM_CLASSES;
    const uintptr_t start=(uintptr_t)table+header, address=(uintptr_t)row;
    if (address<start||address-start>=count*stride||(address-start)%stride) return EQ_PERM_CLASSES;
    return (unsigned)((address-start)/stride);
}
static unsigned char base_permission(uint16_t item,unsigned class_id) {
    int rule=expanded_rule(item,class_id);
    return rule<0?allow_original(item,class_id):(unsigned char)rule;
}
unsigned char permission_with_owner(uint16_t item,unsigned class_id,void *owner){
    unsigned char result=base_permission(item,class_id);
    if(!result&&bonus(owner,arm_row(item))){if(InterlockedIncrement(&grant_log_count)<=40)log_text("Weapon permission granted by matching equipped proficiency II.\r\n");return 1;}return result;
}
// These call sites previously used a two-argument helper. Pass the observed
// character pointer as a third argument; preserve the ordinary Win64 ABI.
__attribute__((naked)) static void menu_bridge(void){__asm__("mov 0x60(%rsp), %r8\n\tjmp permission_with_owner");}
__attribute__((naked)) static void filter_bridge(void){__asm__("mov 0x78(%rsp), %r8\n\tjmp permission_with_owner");}
static unsigned char select_hook(void *context,const void *row,uint16_t id){
    if(!readable(context,0x20)||!readable(row,152))return select_original(context,row,id);
    const unsigned char *class_row=*((const void**)context+3);
    if(!readable(class_row,208))return select_original(context,row,id);
    int rule=expanded_permissions?expanded_rule(id,class_id_of(class_row)):-1;
    if(bonus(*(void**)context,row))rule=1;
    if(rule<0)return select_original(context,row,id);
    unsigned set=class_row[0x60]&63;
    unsigned char copy[152];memcpy(copy,row,152);
    unsigned char bit=(unsigned char)(1u<<(set%8));
    if(rule)copy[0x58+set/8]|=bit;else copy[0x58+set/8]&=(unsigned char)~bit;
    // Native slot, gender and other item checks still execute against a local copy.
    return select_original(context,copy,id);
}
static void clean_hook(void *gear,unsigned class_id){
    unsigned char *owner=(unsigned char*)gear-0x54;
    if (expanded_permissions&&class_id<EQ_PERM_CLASSES&&permission_data[8+class_id]<EQ_PERM_GROUPS) {
        // The original cleanup visits slots 2–5. Its slot bookkeeping is
        // exactly the two bytes beside each removed equipment word.
        for (unsigned slot=2;slot<=5;slot++) {
            const uint16_t item=eq_word(gear,2*slot);
            if (item&&!base_permission(item,class_id)&&!bonus(owner,arm_row(item))) {
                unsigned char *bytes=gear;
                bytes[2*slot]=bytes[2*slot+1]=bytes[14+slot]=bytes[21+slot]=0;
            }
        }
        return;
    }
    unsigned char old[28];memcpy(old,gear,sizeof(old));
    int keep[7]={0};if(readable(owner,0x1b8))for(unsigned i=0;i<7;i++)keep[i]=bonus(owner,arm_row(eq_word(old,2*i)));
    clean_original(gear,class_id);
    for(unsigned i=0;i<7;i++)if(keep[i]&&!eq_word(gear,2*i)){
        memcpy((char*)gear+2*i,old+2*i,2);((unsigned char*)gear)[14+i]=old[14+i];((unsigned char*)gear)[21+i]=old[21+i];
        log_text("Preserved sword during native class equipment cleanup.\r\n");
    }
}
static void *shield_accept __attribute__((used)),*shield_reject __attribute__((used));
__attribute__((used,noinline)) static int shield_permission(const unsigned char *klass,uint16_t item,const unsigned char *row) {
    int rule=expanded_rule(item,class_id_of(klass));
    if (rule>=0) return rule;
    unsigned group=klass[0x60]&63;
    return (row[0x58+group/8]>>(group%8))&1;
}
__attribute__((naked)) static void shield_bridge(void) {
    __asm__(
        "push %rdx\n\tpush %r8\n\tpush %r9\n\tpush %r10\n\tpush %r11\n\t"
        "sub $0x28,%rsp\n\tmov 0x39b8(%rbp),%rcx\n\tmovzwl %di,%edx\n\tmov %rsi,%r8\n\t"
        "call shield_permission\n\tadd $0x28,%rsp\n\t"
        "pop %r11\n\tpop %r10\n\tpop %r9\n\tpop %r8\n\tpop %rdx\n\t"
        "test %eax,%eax\n\tjz 1f\n\tjmp *shield_accept(%rip)\n1:\tjmp *shield_reject(%rip)"
    );
}
typedef void (*SkillSetFn)(void*,unsigned,uint16_t);
typedef void (*SkillClearFn)(void*,unsigned);
typedef unsigned char (*UnequipFn)(void*,unsigned,unsigned char);
static void remove_unsupported_weapons(void *owner,int preview){
    if(!readable(owner,0x1b8))return;
    // The public unequip helper maintains inventory, hand transfers and equipment
    // effects. Its preview flag suppresses inventory awards for temporary UI copies.
    // Restart after each removal because off-hand weapons can move to the main hand.
    for(unsigned removed=0;removed<2;removed++){
        int found=0;
        for(unsigned slot=0;slot<2;slot++){
            uint16_t item=eq_word(owner,0x54+2*slot);void *row=arm_row(item);
            if(!readable(row,152)||!eq_is_family(((uint8_t*)row)[2]))continue;
            unsigned class_id=((uint8_t*)owner)[0x49];
            if(!eq_requires_removal(owner,row,base_permission(item,class_id)))continue;
            unsigned char result=((UnequipFn)(base+0x4698c0))(owner,slot,(unsigned char)preview);
            if(!result){log_text("Sword removal helper returned no change.\r\n");return;}
            log_text(preview?"Preview: removed sword after skill permission lost; inventory untouched.\r\n":"Removed sword after skill permission lost through native unequip.\r\n");
            found=1;break;
        }
        if(!found)break;
    }
}
static void change_skill(void *owner,unsigned slot,uint16_t skill,int preview){
    int had=readable(owner,0x1b8)&&eq_has_any_ii(owner);
    // I and II share a proficiency; replacing another slot removes the duplicate
    // identity instead of awarding proficiency twice or consuming two slots.
    if(readable(owner,0x1b8)&&slot<4&&eq_is_family(skill))for(unsigned i=0;i<4;i++){
        uint16_t existing=eq_word(owner,0xc0+6*i);
        if(i!=slot&&eq_same_family(existing,skill))((SkillClearFn)(base+0x469aa0))(owner,i);
    }
    ((SkillSetFn)(base+0x46a4b0))(owner,slot,skill);
    if(had)remove_unsupported_weapons(owner,preview);
    if(readable(owner,0x1b8)&&(had||eq_is_family(skill)))((void(*)(void*))(base+0x334d20))(owner);
}
static void clear_skill(void *owner,unsigned slot,int preview){
    int had=readable(owner,0x1b8)&&eq_has_any_ii(owner);
    ((SkillClearFn)(base+0x469aa0))(owner,slot);
    if(had)remove_unsupported_weapons(owner,preview);
    if(had)((void(*)(void*))(base+0x334d20))(owner);
}
static void skill_set_hook(void *owner,unsigned slot,uint16_t skill){change_skill(owner,slot,skill,0);}
static void skill_clear_hook(void *owner,unsigned slot){clear_skill(owner,slot,0);}
static void preview_set_hook(void *owner,unsigned slot,uint16_t skill){change_skill(owner,slot,skill,1);}
static void preview_clear_hook(void *owner,unsigned slot){clear_skill(owner,slot,1);}
static void abs_jump(unsigned char *p,void *to){p[0]=0xff;p[1]=0x25;memset(p+2,0,4);memcpy(p+6,&to,8);}
static int protect_write(void *p,const void *data,size_t n){DWORD old;if(!VirtualProtect(p,n,PAGE_EXECUTE_READWRITE,&old))return 0;memcpy(p,data,n);FlushInstructionCache(GetCurrentProcess(),p,n);DWORD unused;return VirtualProtect(p,n,old,&unused)!=0;}
static void *trampoline(unsigned rva,unsigned n){unsigned char *p=VirtualAlloc(0,n+14,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(!p)return 0;memcpy(p,base+rva,n);abs_jump(p+n,base+rva+n);return p;}
static void *near_page(void){SYSTEM_INFO si;GetSystemInfo(&si);uintptr_t origin=(uintptr_t)base,gran=si.dwAllocationGranularity;for(uintptr_t d=gran;d<0x70000000;d+=gran){void *p=VirtualAlloc((void*)((origin+d)&~(gran-1)),4096,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(p)return p;if(origin>d){p=VirtualAlloc((void*)((origin-d)&~(gran-1)),4096,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(p)return p;}}return 0;}
static int read_permissions(const wchar_t *config) {
    wchar_t path[32768];
    wcscpy(path,config);
    wchar_t *slash=wcsrchr(path,L'\\');
    if(!slash)return 0;
    wcscpy(slash+1,L"modprep-equipment-permissions.bin");
    HANDLE file=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file==INVALID_HANDLE_VALUE)return 0;
    LARGE_INTEGER size;
    DWORD count=0;
    int ok=GetFileSizeEx(file,&size)&&
        (size.QuadPart==EQ_PERM_SIZE||size.QuadPart==EQ_PERM_LEGACY_SIZE)&&
        ReadFile(file,permission_data,(DWORD)size.QuadPart,&count,NULL)&&count==size.QuadPart;
    CloseHandle(file);
    if (!ok||permission_data[8]!=255) return 0;
    int legacy=count==EQ_PERM_LEGACY_SIZE;
    if (memcmp(permission_data,legacy?"TOREQP01":"TOREQP02",8)) return 0;
    for(unsigned i=1;i<EQ_PERM_CLASSES;i++) {
        unsigned group=permission_data[8+i];
        if(group!=255&&group>=EQ_PERM_GROUPS)return 0;
    }
    permission_stride=legacy?EQ_PERM_LEGACY_STRIDE:EQ_PERM_STRIDE;
    permission_limit=legacy?EQUIPMENT_FIRST:EQ_PERM_ITEMS;
    return 1;
}

static int install_equipment_rules(int proficiency,int expanded) {
    static const unsigned char fp_shield[]={0x48,0x8b,0x85,0xb8,0x39,0x00,0x00,0x0f,0xb6,0x48,0x60,0x48,0x8b,0x46,0x58,0x48,0x0f,0xa3,0xc8,0x73,0x57};
    const struct {unsigned rva,length;const unsigned char *original;void *target;unsigned char branch;} sites[]={
        {0x4446c0,sizeof(fp_select),fp_select,(void*)select_hook,0},
        {0x3a2050,sizeof(fp_clean),fp_clean,(void*)clean_hook,0},
        {0x336050,5,fp_allow,(void*)base_permission,0xe9},
        {0x444f1d,sizeof(fp_shield),fp_shield,(void*)shield_bridge,0},
        {0x448200,sizeof(fp_rank),fp_rank,(void*)rank_hook,0},
        {0x448690,sizeof(fp_slot),fp_slot,(void*)slot_hook,0},
        {0x4472b0,sizeof(fp_unlock),fp_unlock,(void*)unlock_hook,0},
        {0x51deaf,5,fp_menu,(void*)menu_bridge,0xe8},
        {0x4663ab,5,fp_filter,(void*)filter_bridge,0xe8},
        {0x51e51c,5,fp_skill_set,(void*)skill_set_hook,0xe8},
        {0x51c6c9,5,fp_skill_clear,(void*)skill_clear_hook,0xe8},
        {0x51eded,5,fp_preview_set,(void*)preview_set_hook,0xe8},
        {0x51edac,5,fp_preview_clear,(void*)preview_clear_hook,0xe8},
        {0x441023,5,fp_initialize_a,(void*)initialize_rank_hook,0xe8},
        {0x44145a,5,fp_initialize_b,(void*)initialize_rank_hook,0xe8},
        {0x441aca,5,fp_initialize_c,(void*)initialize_rank_hook,0xe8},
        {0x333e4c,5,fp_weapon_skill,(void*)weapon_skill_hook,0xe8},
    };
    unsigned indices[sizeof(sites)/sizeof(sites[0])],count=0;
    indices[count++]=0;indices[count++]=1;
    if(expanded){indices[count++]=2;indices[count++]=3;}
    if(proficiency)for(unsigned i=4;i<sizeof(sites)/sizeof(sites[0]);i++)indices[count++]=i;
    if(memcmp(base+0x336050,fp_allow,sizeof(fp_allow)))return 0;
    for(unsigned n=0;n<count;n++){
        unsigned i=indices[n];
        if(memcmp(base+sites[i].rva,sites[i].original,sites[i].length))return 0;
    }
    allow_original=expanded?(AllowFn)trampoline(0x336050,5):(AllowFn)(base+0x336050);
    select_original=(SelectFn)trampoline(0x4446c0,sizeof(fp_select));
    clean_original=(CleanFn)trampoline(0x3a2050,sizeof(fp_clean));
    unsigned char *relay=near_page();
    if(!allow_original||!select_original||!clean_original||!relay)return 0;
    if(proficiency){
        initialize_rank_original=(InitializeRankFn)(base+0x43f260);
        rank_original=(RankLookupFn)trampoline(0x448200,sizeof(fp_rank));
        slot_original=(SkillSlotFn)trampoline(0x448690,sizeof(fp_slot));
        unlock_original=(UnlockFn)trampoline(0x4472b0,sizeof(fp_unlock));
        if(!rank_original||!slot_original||!unlock_original)return 0;
    }
    shield_accept=base+0x444f32;shield_reject=base+0x444f89;
    for(unsigned n=0;n<count;n++)if(sites[indices[n]].branch)abs_jump(relay+16*n,sites[indices[n]].target);
    FlushInstructionCache(GetCurrentProcess(),relay,16*count);
    expanded_permissions=expanded;
    proficiency_enabled=proficiency;
    for(unsigned n=0;n<count;n++){
        unsigned i=indices[n];
        unsigned char *site=base+sites[i].rva,patch[32];
        unsigned length=sites[i].length;
        memset(patch,0x90,length);
        if(sites[i].branch){
            patch[0]=sites[i].branch;
            int32_t delta=(int32_t)((relay+16*n)-(site+5));
            memcpy(patch+1,&delta,4);
        }else abs_jump(patch,sites[i].target);
        if(!protect_write(site,patch,length)){
            for(unsigned j=n+1;j>0;j--){
                i=indices[j-1];
                protect_write(base+sites[i].rva,sites[i].original,sites[i].length);
            }
            expanded_permissions=proficiency_enabled=0;
            return 0;
        }
    }
    return 1;
}

DWORD WINAPI eq_initialize(void *module,const wchar_t *config){
    const int proficiency=GetPrivateProfileIntW(L"Proficiencies",L"Enabled",0,config)!=0;
    const int requested=GetPrivateProfileIntW(L"ModPreparationEquipmentPermissions",L"Enabled",0,config)!=0;
    if(!proficiency&&!requested)return 0;
    base=(unsigned char*)GetModuleHandleW(0);
    GetModuleFileNameW((HMODULE)module,log_path,32768);
    wchar_t *slash=wcsrchr(log_path,L'\\');if(!slash)return 0;wcscpy(slash+1,L"equip-skill.log");
    IMAGE_NT_HEADERS64 *nt=(void*)(base+((IMAGE_DOS_HEADER*)base)->e_lfanew);
    if(nt->FileHeader.TimeDateStamp!=EQUIP_TIMESTAMP||nt->OptionalHeader.SizeOfImage!=EQUIP_IMAGE_SIZE){
        log_text("Equipment rules: executable version mismatch.\r\n");
        return 0;
    }
    const int expanded=requested&&read_permissions(config);
    if(requested&&!expanded)log_text("Equipment rules: invalid permission definitions. Native groups retained.\r\n");
    if((proficiency||expanded)&&!install_equipment_rules(proficiency,expanded)){
        log_text("Equipment rules: hook validation or installation failed. Original checks retained.\r\n");
        return 0;
    }
    if(expanded)log_text("Equipment rules: expanded groups active.\r\n");
    if(proficiency)log_text("Equipment rules: Proficiency II active.\r\n");
    return 0;
}

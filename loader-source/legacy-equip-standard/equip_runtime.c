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
    return ((unsigned char(*)(unsigned))(base+0x334560))(skill);
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
static void *arm_row(uint16_t id){if(!id||id>760)return 0;return ((RowFn)(base+0x2e4bc0))(((ManagerFn)(base+0x2e5030))(),id);}
static int bonus(void *character,void *row){return readable(character,0x1b8)&&readable(row,152)&&eq_bonus(character,row);}
unsigned char permission_with_owner(uint16_t item,unsigned class_id,void *owner){
    unsigned char result=allow_original(item,class_id);
    if(!result&&bonus(owner,arm_row(item))){if(InterlockedIncrement(&grant_log_count)<=40)log_text("Weapon permission granted by matching equipped proficiency II.\r\n");return 1;}return result;
}
// These call sites previously used a two-argument helper. Pass the observed
// character pointer as a third argument; preserve the ordinary Win64 ABI.
__attribute__((naked)) static void menu_bridge(void){__asm__("mov 0x60(%rsp), %r8\n\tjmp permission_with_owner");}
__attribute__((naked)) static void filter_bridge(void){__asm__("mov 0x78(%rsp), %r8\n\tjmp permission_with_owner");}
static unsigned char select_hook(void *context,const void *row,uint16_t id){
    void *owner=readable(context,0x20)?*(void**)context:0;
    if(!bonus(owner,(void*)row))return select_original(context,row,id);
    void *class_row=*((void**)context+3);
    if(!readable(class_row,208))return select_original(context,row,id);
    unsigned set=((uint8_t*)class_row)[0x60];if(set>=64)return select_original(context,row,id);
    unsigned char copy[152];memcpy(copy,row,152);uint64_t mask;memcpy(&mask,copy+0x58,8);mask|=(uint64_t)1<<set;memcpy(copy+0x58,&mask,8);
    // Native slot, gender and other item checks still execute against a local copy.
    return select_original(context,copy,id);
}
static void clean_hook(void *gear,unsigned class_id){
    unsigned char old[28];memcpy(old,gear,sizeof(old));void *owner=(unsigned char*)gear-0x54;
    int keep[7]={0};if(readable(owner,0x1b8))for(unsigned i=0;i<7;i++)keep[i]=bonus(owner,arm_row(eq_word(old,2*i)));
    clean_original(gear,class_id);
    for(unsigned i=0;i<7;i++)if(keep[i]&&!eq_word(gear,2*i)){
        memcpy((char*)gear+2*i,old+2*i,2);((unsigned char*)gear)[14+i]=old[14+i];((unsigned char*)gear)[21+i]=old[21+i];
        log_text("Preserved sword during native class equipment cleanup.\r\n");
    }
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
            if(!eq_requires_removal(owner,row,allow_original(item,class_id)))continue;
            unsigned char result=((UnequipFn)(base+0x466570))(owner,slot,(unsigned char)preview);
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
        if(i!=slot&&eq_same_family(existing,skill))((SkillClearFn)(base+0x466750))(owner,i);
    }
    ((SkillSetFn)(base+0x467160))(owner,slot,skill);
    if(had)remove_unsupported_weapons(owner,preview);
    if(readable(owner,0x1b8)&&(had||eq_is_family(skill)))((void(*)(void*))(base+0x331ec0))(owner);
}
static void clear_skill(void *owner,unsigned slot,int preview){
    int had=readable(owner,0x1b8)&&eq_has_any_ii(owner);
    ((SkillClearFn)(base+0x466750))(owner,slot);
    if(had)remove_unsupported_weapons(owner,preview);
    if(had)((void(*)(void*))(base+0x331ec0))(owner);
}
static void skill_set_hook(void *owner,unsigned slot,uint16_t skill){change_skill(owner,slot,skill,0);}
static void skill_clear_hook(void *owner,unsigned slot){clear_skill(owner,slot,0);}
static void preview_set_hook(void *owner,unsigned slot,uint16_t skill){change_skill(owner,slot,skill,1);}
static void preview_clear_hook(void *owner,unsigned slot){clear_skill(owner,slot,1);}
static void abs_jump(unsigned char *p,void *to){p[0]=0xff;p[1]=0x25;memset(p+2,0,4);memcpy(p+6,&to,8);}
static int protect_write(void *p,const void *data,size_t n){DWORD old;if(!VirtualProtect(p,n,PAGE_EXECUTE_READWRITE,&old))return 0;memcpy(p,data,n);FlushInstructionCache(GetCurrentProcess(),p,n);DWORD unused;return VirtualProtect(p,n,old,&unused)!=0;}
static void *trampoline(unsigned rva,unsigned n){unsigned char *p=VirtualAlloc(0,n+14,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(!p)return 0;memcpy(p,base+rva,n);abs_jump(p+n,base+rva+n);return p;}
static void *near_page(void){SYSTEM_INFO si;GetSystemInfo(&si);uintptr_t origin=(uintptr_t)base,gran=si.dwAllocationGranularity;for(uintptr_t d=gran;d<0x70000000;d+=gran){void *p=VirtualAlloc((void*)((origin+d)&~(gran-1)),4096,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(p)return p;if(origin>d){p=VirtualAlloc((void*)((origin-d)&~(gran-1)),4096,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(p)return p;}}return 0;}
DWORD WINAPI eq_initialize(void *module){
    (void)module;base=(unsigned char*)GetModuleHandleW(0);GetModuleFileNameW((HMODULE)module,log_path,32768);wchar_t *slash=wcsrchr(log_path,L'\\');if(!slash)return 0;wcscpy(slash+1,L"equip-skill.log");
    /* The shared initializer already checked the executable path. */
    IMAGE_NT_HEADERS64 *nt=(void*)(base+((IMAGE_DOS_HEADER*)base)->e_lfanew);
    if(nt->FileHeader.TimeDateStamp!=EQUIP_TIMESTAMP||nt->OptionalHeader.SizeOfImage!=EQUIP_IMAGE_SIZE){log_text("Disabled: executable version mismatch.\r\n");return 0;}
    unsigned call_sites[]={0x51ab5f,0x46305b,0x51b1bd,0x519379,0x51ba2d,0x51b9ec,0x43dcd3,0x43e10a,0x43e77a,0x330fec};
    const unsigned char *call_bytes[]={fp_menu,fp_filter,fp_skill_set,fp_skill_clear,fp_preview_set,fp_preview_clear,fp_initialize_a,fp_initialize_b,fp_initialize_c,fp_weapon_skill};
    const unsigned call_count=sizeof(call_sites)/sizeof(call_sites[0]);
    if(memcmp(base+0x333110,fp_allow,sizeof(fp_allow))||memcmp(base+0x441370,fp_select,sizeof(fp_select))||memcmp(base+0x39f060,fp_clean,sizeof(fp_clean))||memcmp(base+0x444ea0,fp_rank,sizeof(fp_rank))||memcmp(base+0x445330,fp_slot,sizeof(fp_slot))){log_text("Disabled: native fingerprint mismatch.\r\n");return 0;}
    if(memcmp(base+0x443f50,fp_unlock,sizeof(fp_unlock))){log_text("Disabled: unlock fingerprint mismatch.\r\n");return 0;}
    for(unsigned i=0;i<call_count;i++)if(memcmp(base+call_sites[i],call_bytes[i],5)){log_text("Disabled: call-site fingerprint mismatch.\r\n");return 0;}
    initialize_rank_original=(InitializeRankFn)(base+0x43bf10);
    allow_original=(AllowFn)(base+0x333110);select_original=(SelectFn)trampoline(0x441370,sizeof(fp_select));clean_original=(CleanFn)trampoline(0x39f060,sizeof(fp_clean));unsigned char *relay=near_page();
    rank_original=(RankLookupFn)trampoline(0x444ea0,sizeof(fp_rank));slot_original=(SkillSlotFn)trampoline(0x445330,sizeof(fp_slot));
    unlock_original=(UnlockFn)trampoline(0x443f50,sizeof(fp_unlock));
    if(!select_original||!clean_original||!rank_original||!slot_original||!unlock_original||!relay){log_text("Disabled: allocation failed.\r\n");return 0;}
    void *destinations[]={(void*)menu_bridge,(void*)filter_bridge,(void*)skill_set_hook,(void*)skill_clear_hook,(void*)preview_set_hook,(void*)preview_clear_hook,(void*)initialize_rank_hook,(void*)initialize_rank_hook,(void*)initialize_rank_hook,(void*)weapon_skill_hook};
    for(unsigned i=0;i<call_count;i++)abs_jump(relay+32*i,destinations[i]);
    unsigned char select_patch[sizeof(fp_select)],clean_patch[sizeof(fp_clean)],call[5];memset(select_patch,0x90,sizeof(select_patch));memset(clean_patch,0x90,sizeof(clean_patch));abs_jump(select_patch,(void*)select_hook);abs_jump(clean_patch,(void*)clean_hook);
    unsigned char rank_patch[sizeof(fp_rank)],slot_patch[sizeof(fp_slot)];memset(rank_patch,0x90,sizeof(rank_patch));memset(slot_patch,0x90,sizeof(slot_patch));abs_jump(rank_patch,(void*)rank_hook);abs_jump(slot_patch,(void*)slot_hook);
    unsigned char unlock_patch[sizeof(fp_unlock)];memset(unlock_patch,0x90,sizeof(unlock_patch));abs_jump(unlock_patch,(void*)unlock_hook);
    call[0]=0xe8;
    int ok=protect_write(base+0x441370,select_patch,sizeof(select_patch))&&protect_write(base+0x39f060,clean_patch,sizeof(clean_patch))&&protect_write(base+0x444ea0,rank_patch,sizeof(rank_patch))&&protect_write(base+0x445330,slot_patch,sizeof(slot_patch));
    ok=ok&&protect_write(base+0x443f50,unlock_patch,sizeof(unlock_patch));
    for(unsigned i=0;i<call_count&&ok;i++){int32_t delta=(int32_t)((relay+32*i)-(base+call_sites[i]+5));memcpy(call+1,&delta,4);ok=protect_write(base+call_sites[i],call,5);}
    if(!ok){protect_write(base+0x441370,fp_select,sizeof(fp_select));protect_write(base+0x39f060,fp_clean,sizeof(fp_clean));protect_write(base+0x444ea0,fp_rank,sizeof(fp_rank));protect_write(base+0x445330,fp_slot,sizeof(fp_slot));protect_write(base+0x443f50,fp_unlock,sizeof(fp_unlock));for(unsigned i=0;i<call_count;i++)protect_write(base+call_sites[i],call_bytes[i],5);log_text("Disabled: installation failed; patches rolled back.\r\n");return 0;}
    log_text("Equip Skill prototype 006 active: 17 proficiency II variants; shared ranks/XP; alias-aware finisher unlocks and learning. Gameplay validation pending.\r\n");return 0;
}

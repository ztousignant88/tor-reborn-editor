#include "shared_combat.h"
static void *volatile rogue_combat;
static const CombatHooks *throw_rogue_combat(void){
    return InterlockedCompareExchangePointer(&rogue_combat,NULL,NULL);
}

typedef unsigned char (*AmmoActionFn)(void*,void*,void*,unsigned char);
typedef void (*AmmoBuildFn)(void*);
typedef void *(*AmmoDestroyFn)(void*,unsigned);
typedef int (*AmmoCheckFn)(const void*,void*,void*,void*,unsigned char,unsigned char);
static AmmoActionFn ammo_action_original;
static AmmoBuildFn ammo_build_original;
static AmmoDestroyFn ammo_destroy_original;
static AmmoCheckFn ammo_check_original;
static unsigned char *ammo_base;
static wchar_t ammo_log_path[32768];
static SRWLOCK ammo_lock=SRWLOCK_INIT;
static volatile LONG ammo_empty_logs,ammo_action_logs;
static _Thread_local void *ammo_job,*ammo_selected_actor;
struct AmmoPayment {void *job,*actor,*battle;uint16_t item;};
static struct AmmoPayment ammo_paid[64];
static void ammo_visual_clear(void *job);
static uint16_t ammo_word(const void *p,unsigned off){uint16_t v;memcpy(&v,(const unsigned char*)p+off,2);return v;}
static void *ammo_pointer(const void *p,unsigned off){void *v;memcpy(&v,(const unsigned char*)p+off,8);return v;}
static int ammo_readable(const void *p,size_t n){
    uintptr_t at=(uintptr_t)p,end=at+n;if(!p||end<at)return 0;
    while(at<end){MEMORY_BASIC_INFORMATION m;if(!VirtualQuery((void*)at,&m,sizeof(m))||m.State!=MEM_COMMIT||(m.Protect&(PAGE_NOACCESS|PAGE_GUARD)))return 0;uintptr_t next=(uintptr_t)m.BaseAddress+m.RegionSize;if(next<=at)return 0;at=next;}return 1;
}
static void ammo_log(const char *s){
    if(!ammo_log_path[0])return;HANDLE f=CreateFileW(ammo_log_path,FILE_APPEND_DATA,FILE_SHARE_READ|FILE_SHARE_WRITE,0,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,0);
    if(f!=INVALID_HANDLE_VALUE){DWORD n;WriteFile(f,s,(DWORD)strlen(s),&n,0);CloseHandle(f);}
}
typedef const unsigned char *(*AmmoRowFn)(uint16_t);
typedef void (*AmmoConsumeFn)(void*,uint16_t);
static AmmoRowFn ammo_row;
static AmmoConsumeFn ammo_consume;
typedef unsigned char (*AmmoUnequipFn)(void*,unsigned,unsigned char);
static AmmoUnequipFn ammo_unequip;
static const unsigned char *ammo_native_row(uint16_t id){
    void *manager=((void*(*)(void))(ammo_base+0x2e6f20))();
    return ((const unsigned char*(*)(void*,uint16_t))(ammo_base+0x2e6ab0))(manager,id);
}
static uint16_t ammo_item(const void *command){
    if(!ammo_readable(command,8)||((const unsigned char*)command)[0]!=2)return 0;
    uint16_t id=ammo_word(command,2);if(!id||id>=761)return 0;
    const unsigned char *row=ammo_row(id);return ammo_readable(row,152)&&row[2]==21?id:0;
}
static void *ammo_inventory(void *battle){
    if(!ammo_readable(battle,0x1b70))return 0;
    void *m=ammo_pointer(battle,0x1b68);
    return ammo_readable(m,0x64+0xe60)?(unsigned char*)m+0x64:0;
}
static unsigned ammo_finisher(const void *cmd){
    if(!ammo_readable(cmd,8)||((const unsigned char*)cmd)[0]!=3)return 0;
    unsigned id=ammo_word(cmd,2);return id>=416&&id<=419?id:0;
}
static uint16_t ammo_command_item(const void *cmd,void *actor){
    uint16_t item=ammo_item(cmd);if(item)return item;
    if(!ammo_finisher(cmd)||!ammo_readable(actor,0x1f6))return 0;
    for(unsigned hand=0;hand<2;hand++){
        item=ammo_word(actor,0x18c+hand*2);if(!item||item>=761)continue;
        const unsigned char *row=ammo_row(item);if(ammo_readable(row,152)&&row[2]==21)return item;
    }
    return 0;
}
static unsigned ammo_committed_cost(const void *cmd){
    unsigned finisher=ammo_finisher(cmd);
    if(finisher==418||finisher==419){
        if(!ammo_readable(cmd,0x5579))return 0;
        return ((const unsigned char*)cmd)[0x5578];
    }
    return 1;
}
static int ammo_seen(void *job,uint16_t item){for(unsigned i=0;i<64;i++)if(ammo_paid[i].job==job&&ammo_paid[i].item==item)return 1;return 0;}
static int ammo_charge(void *job,void *inventory,uint16_t item,unsigned amount){
    AcquireSRWLockExclusive(&ammo_lock);
    if(ammo_seen(job,item)){ReleaseSRWLockExclusive(&ammo_lock);return 1;}
    unsigned slot=64;for(unsigned i=0;i<64;i++)if(!ammo_paid[i].job){slot=i;break;}
    uint16_t before=ammo_word(inventory,item*2u);
    if(!job||!amount||before<amount||slot==64){ReleaseSRWLockExclusive(&ammo_lock);return 0;}
    for(unsigned n=0;n<amount;n++)ammo_consume(inventory,item);
    uint16_t after=ammo_word(inventory,item*2u);
    if(after!=before-amount){ReleaseSRWLockExclusive(&ammo_lock);return 0;}
    ammo_paid[slot].job=job;ammo_paid[slot].item=item;
    ReleaseSRWLockExclusive(&ammo_lock);
    char line[160];snprintf(line,sizeof(line),"Thrown ammunition: item %u stock %u -> %u; committed action charged once.\r\n",item,before,after);ammo_log(line);return 1;
}
static int ammo_check_hook(const void *command,void *actor,void *cost,void *battle,unsigned char a,unsigned char b){
    int result=ammo_check_original(command,actor,cost,battle,a,b);if(result)return result;
    uint16_t item=ammo_command_item(command,actor);if(!item)return result;
    void *inventory=ammo_inventory(battle);
    if(!inventory||!ammo_word(inventory,item*2u)){if(InterlockedIncrement(&ammo_empty_logs)<=24)ammo_log("Thrown ammunition: empty stock; command unavailable (native weapon-menu rejection 13).\r\n");return 13;}
    return 0;
}
static void ammo_build_hook(void *job){
    /* +98 is the same native battle context passed to ActionIterator. +C8
     * owns its iterator at +410 and the prepared command at +420. */
    if(ammo_readable(job,0xe6)){
        void *owner=ammo_pointer(job,0xc8);
        if(ammo_readable(owner,0x428)){
            uint16_t item=ammo_item((unsigned char*)owner+0x420);
            if(item){void *inventory=ammo_inventory(ammo_pointer(job,0x98));
                if(!inventory||(!ammo_word(inventory,item*2u)&&!ammo_seen(job,item))){
                    *((unsigned char*)job+0xe5)=1;ammo_log("Thrown ammunition: empty committed action stopped before queue construction.\r\n");return;
                }
            }
        }
    }
    void *previous=ammo_job;ammo_job=job;
    const CombatHooks *chain=throw_rogue_combat();
    (chain?chain->build:ammo_build_original)(job);
    ammo_job=previous;
}
static unsigned char ammo_action_hook(void *iterator,void *context,void *extra,unsigned char initial){
    void *previous_actor=ammo_selected_actor;ammo_selected_actor=0;
    const CombatHooks *chain=throw_rogue_combat();
    unsigned char result=(chain?chain->action:ammo_action_original)(iterator,context,extra,initial);
    void *actor=ammo_selected_actor;ammo_selected_actor=previous_actor;
    if(ammo_readable(iterator,0x18)&&InterlockedIncrement(&ammo_action_logs)<=48){
        const unsigned char *cmd=(const unsigned char*)iterator+0x10;
        char line[192];snprintf(line,sizeof(line),"Ammo diagnostic: prepared kind=%u item=%u effect=%u result=%u active-job=%u initial=%u.\r\n",cmd[0],ammo_word(cmd,2),ammo_word(cmd,6),result,ammo_job!=0,initial);ammo_log(line);
    }
    if(!result||!ammo_job||!ammo_readable(iterator,0x18)||!ammo_readable(context,8))return result;
    const void *command=(unsigned char*)iterator+0x10;
    uint16_t item=ammo_command_item(command,actor);if(!item)return result;
    unsigned amount=ammo_committed_cost(command);if(!amount)return result;
    void *inventory=ammo_inventory(ammo_pointer(context,0));
    if(!inventory||!ammo_charge(ammo_job,inventory,item,amount)){
        ammo_log("Thrown ammunition: commit refused because ammunition could not be charged.\r\n");
        if(ammo_readable(ammo_job,0xe6))*((unsigned char*)ammo_job+0xe5)=1;
        return 0;
    }
    if(actor){
        AcquireSRWLockExclusive(&ammo_lock);
        for(unsigned i=0;i<64;i++)if(ammo_paid[i].job==ammo_job&&ammo_paid[i].item==item){ammo_paid[i].actor=actor;ammo_paid[i].battle=ammo_pointer(context,0);break;}
        ReleaseSRWLockExclusive(&ammo_lock);
    }
    return result;
}
static void ammo_remove_exhausted(const struct AmmoPayment *paid){
    void *actor=paid->actor,*inventory=ammo_inventory(paid->battle);
    if(!actor||!inventory||!ammo_readable(actor,0x730)||ammo_pointer(actor,0x728)!=paid->battle||ammo_word(inventory,paid->item*2u))return;
    void *unit=(unsigned char*)actor+0x138;
    /* Preview=true is the native no-inventory-return mode. The thrown last
     * item has already been consumed; unequipping must not award another. */
    for(unsigned removed=0;removed<2;removed++){
        unsigned slot=0;while(slot<2&&ammo_word(unit,0x54+slot*2)!=paid->item)slot++;
        if(slot==2)return;
        if(!ammo_unequip(unit,slot,1)){ammo_log("Exhausted throw: native unequip reported no change.\r\n");return;}
        char line[160];snprintf(line,sizeof(line),"Exhausted throw: removed item %u from hand %u after action cleanup; no inventory refund.\r\n",paid->item,slot);ammo_log(line);
    }
}
static void *ammo_destroy_hook(void *job,unsigned flags){
    ammo_visual_clear(job);
    struct AmmoPayment pending[64];unsigned count=0;
    AcquireSRWLockExclusive(&ammo_lock);
    for(unsigned i=0;i<64;i++)if(ammo_paid[i].job==job){pending[count++]=ammo_paid[i];memset(&ammo_paid[i],0,sizeof(ammo_paid[i]));}
    ReleaseSRWLockExclusive(&ammo_lock);
    for(unsigned i=0;i<count;i++)ammo_remove_exhausted(&pending[i]);
    const CombatHooks *chain=throw_rogue_combat();
    return (chain?chain->destroy:ammo_destroy_original)(job,flags);
}
static void ammo_abs_jump(unsigned char *p,void *to){p[0]=0xff;p[1]=0x25;memset(p+2,0,4);memcpy(p+6,&to,8);}
/* The native initial-action caller ignores AL. Route a refused preparation
 * to its existing no-action exit before any effect or projectile job is queued. */
static void ammo_initial_gate(unsigned char *p,void *action,void *denied,void *with_mask,void *without_mask){
    p[0]=0x48;p[1]=0xb8;memcpy(p+2,&action,8);p[10]=0xff;p[11]=0xd0;
    p[12]=0x84;p[13]=0xc0;p[14]=0x75;p[15]=14;ammo_abs_jump(p+16,denied);
    const unsigned char cmp[]={0x48,0x83,0xbf,0xd8,0,0,0,0};memcpy(p+30,cmp,8);
    p[38]=0x75;p[39]=14;ammo_abs_jump(p+40,without_mask);ammo_abs_jump(p+54,with_mask);
}
static int ammo_selection_denied(void *iterator,void *context,const void *selected){
    (void)iterator;
    if(!ammo_job)return 0;
    void *actor=ammo_readable(selected,0x18)?ammo_pointer(selected,0x10):0;
    uint16_t item=ammo_command_item(selected,actor);if(!item)return 0;
    if(ammo_readable(actor,0x730)&&ammo_readable(context,8)&&ammo_pointer(actor,0x728)==ammo_pointer(context,0))ammo_selected_actor=actor;
    void *inventory=ammo_readable(context,8)?ammo_inventory(ammo_pointer(context,0)):0;
    if(inventory&&(ammo_word(inventory,item*2u)||ammo_seen(ammo_job,item)))return 0;
    ammo_log("Thrown ammunition: empty selection rejected BEFORE result preparation.\r\n");
    return 1;
}
static void ammo_selection_gate(unsigned char *p,void *check,void *denied,void *selected,void *next){
    const unsigned char args[]={0x48,0x89,0xc3,0x48,0x89,0xf9,0x4c,0x89,0xf2,0x49,0x89,0xc0,0x48,0xb8};
    memcpy(p,args,sizeof(args));memcpy(p+14,&check,8);p[22]=0xff;p[23]=0xd0;
    p[24]=0x84;p[25]=0xc0;p[26]=0x74;p[27]=14;ammo_abs_jump(p+28,denied);
    p[42]=0x48;p[43]=0x85;p[44]=0xdb;p[45]=0x74;p[46]=14;
    ammo_abs_jump(p+47,selected);ammo_abs_jump(p+61,next);
}
typedef const char *(*AmmoNameFn)(uint16_t,unsigned char,unsigned char);
typedef void *(*AmmoBattleFn)(void);
static AmmoNameFn ammo_name_original;
static AmmoBattleFn ammo_current_battle;
static SRWLOCK ammo_label_lock=SRWLOCK_INIT;
static volatile LONG ammo_label_logs;
/* Native menu descriptors store a borrowed char pointer, not a copy. Retain
 * immutable labels for the DLL lifetime so old menu rows never dangle. */
struct AmmoLabel {struct AmmoLabel *next;char source[201];char label[224];};
static struct AmmoLabel *ammo_labels[16][1000];
static int ammo_name_caller(uintptr_t caller){
    static const unsigned sites[]={0x421b12,0x421bf8,0x422062,0x422112,0x422202,0x422281,0x422b09,0x422c3a,0x4231a2,0x423288};
    for(unsigned i=0;i<sizeof(sites)/sizeof(sites[0]);i++)if(caller==(uintptr_t)ammo_base+sites[i])return 1;
    return 0;
}
static const char *ammo_name_for_call(const char *name,uint16_t item,uintptr_t caller){
    if(!name||item<591||item>606||!ammo_name_caller(caller))return name;
    const unsigned char *row=ammo_row(item);if(!ammo_readable(row,152)||row[2]!=21)return name;
    void *inventory=ammo_inventory(ammo_current_battle());if(!inventory)return name;
    unsigned stock=ammo_word(inventory,item*2u);if(stock>999)return name;
    size_t n=strnlen(name,201);if(n>200)return name;
    AcquireSRWLockExclusive(&ammo_label_lock);
    struct AmmoLabel **head=&ammo_labels[item-591][stock],*entry=*head;
    while(entry&&strcmp(entry->source,name))entry=entry->next;
    if(!entry){
        entry=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*entry));
        if(entry){memcpy(entry->source,name,n+1);snprintf(entry->label,sizeof(entry->label),"%s x%u",name,stock);entry->next=*head;*head=entry;}
    }
    const char *result=entry?entry->label:name;
    ReleaseSRWLockExclusive(&ammo_label_lock);
    if(entry&&InterlockedIncrement(&ammo_label_logs)<=16){char line[160];snprintf(line,sizeof(line),"Ammunition label: item %u stock %u; battle weapon menu.\r\n",item,stock);ammo_log(line);}
    return result;
}
__attribute__((noinline)) static const char *ammo_name_hook(uint16_t item,unsigned char a,unsigned char b){
    uintptr_t caller=(uintptr_t)__builtin_return_address(0);
    const char *name=ammo_name_original(item,a,b);
    return ammo_name_for_call(name,item,caller);
}
typedef void *(*AmmoResultFn)(void*,void*,const void*,void*,unsigned,unsigned,void*);
static AmmoResultFn ammo_result_original;
static volatile LONG ammo_finisher_result_logs;
static void ammo_limit_triple(void *result,void *actor,void *context){
    if(ammo_finisher(result)!=418||!ammo_readable(result,0x5579))return;
    unsigned count=((unsigned char*)result)[0x5578];
    unsigned limit=3;
    uint16_t item=ammo_command_item(result,actor);
    void *inventory=ammo_readable(context,8)?ammo_inventory(ammo_pointer(context,0)):0;
    if(item&&inventory){
        unsigned stock=ammo_word(inventory,item*2u);
        if(stock<limit)limit=stock;
    }
    if(count>limit&&count<=30){
        memset((unsigned char*)result+0x28+limit*0x2d8,0,(count-limit)*0x2d8);
        ((unsigned char*)result)[0x5578]=(unsigned char)limit;
    }
}
static unsigned ammo_limit_rain(void *result,void *actor,void *context){
    if(ammo_finisher(result)!=419||!ammo_readable(result,0x5579)||!ammo_readable(context,8))return 0;
    uint16_t item=ammo_command_item(result,actor);if(!item)return 0;
    void *inventory=ammo_inventory(ammo_pointer(context,0));if(!inventory)return 0;
    unsigned available=ammo_word(inventory,item*2u),count=((unsigned char*)result)[0x5578];
    if(count>30)return 0;
    unsigned kept=0;uint32_t seen=0;
    for(unsigned i=0;i<count;i++){
        unsigned char *row=(unsigned char*)result+0x28+i*0x2d8;
        int16_t target;memcpy(&target,row+2,2);
        if(target<0||target>=30||(seen&(1u<<target))||kept>=available)continue;
        seen|=1u<<target;
        if(kept!=i)memmove((unsigned char*)result+0x28+kept*0x2d8,row,0x2d8);
        kept++;
    }
    if(kept<count)memset((unsigned char*)result+0x28+kept*0x2d8,0,(count-kept)*0x2d8);
    ((unsigned char*)result)[0x5578]=(unsigned char)kept;
    return kept;
}
static void *ammo_result_hook(void *result,void *actor,const void *tiles,void *context,unsigned a,unsigned b,void *extra){
    void *answer=ammo_result_original(result,actor,tiles,context,a,b,extra);
    unsigned finisher=ammo_finisher(result);
    unsigned before=finisher&&ammo_readable(result,0x5579)?((unsigned char*)result)[0x5578]:0;
    ammo_limit_triple(result,actor,context);
    ammo_limit_rain(result,actor,context);
    if(finisher&&ammo_readable(result,0x5579)&&InterlockedIncrement(&ammo_finisher_result_logs)<=96){
        unsigned after=((unsigned char*)result)[0x5578];
        char line[640];int used=snprintf(line,sizeof(line),"Finisher result: effect=%u tiles=%u records=%u->%u active-job=%u targets=",finisher,ammo_readable(tiles,4)?*(const unsigned*)tiles:0,before,after,ammo_job!=0);
        for(unsigned i=0;i<after&&i<30&&used>0&&(unsigned)used<sizeof(line)-24;i++)used+=snprintf(line+used,sizeof(line)-(unsigned)used,"%s%u",i?",":"",ammo_word(result,0x28+i*0x2d8+2));
        if(used>0&&(unsigned)used<sizeof(line)-4)snprintf(line+used,sizeof(line)-(unsigned)used,".\r\n");
        ammo_log(line);
    }
    return answer;
}
#include "finisher_projectiles.c"
static int ammo_install(unsigned char *base){
    ammo_base=base;
    if(memcmp(base+0x39d7b0,fp_consume_body,sizeof(fp_consume_body))||memcmp(base+0x4698c0,fp_unequip_body,sizeof(fp_unequip_body)))return 0;
    /* The stock Thrown header entry has an unused finisher-family key.
     * Link family 38 so the detail panel displays the weapon and title. */
    unsigned char *header_family=base+THROW_HEADER_FAMILY_SITE;
    const uint16_t thrown_family=38;
    if(memcmp(header_family,fp_throw_header_family,sizeof(fp_throw_header_family)))return 0;
    void *original_tick=base+0x4cde80;
    unsigned sites[]={0x3c0900,0x4568a0,0x3b45a0,0x3af090,0x336a00,0x449570,0x3c10e0,0x3a71c0,0x4cdd50,0x343660,0x336140,0x311200,0x3a7280,0x5011f0,0x473e70,0x3a4860,0x3b460a,0x457857,THROW_PERFORM_TICK_SLOT};
    const unsigned char *fingerprints[]={fp_ammo_check,fp_ammo_action,fp_ammo_build,fp_ammo_destroy,fp_ammo_name,fp_ammo_result,fp_throw_preview,fp_throw_ballistics,fp_throw_perform,fp_throw_mode,fp_throw_impact,fp_throw_descriptor,fp_throw_path_update,fp_throw_fx_point,fp_throw_launch,fp_throw_draw,fp_ammo_initial,fp_ammo_selection,(const unsigned char*)&original_tick};
    unsigned lengths[]={sizeof(fp_ammo_check),sizeof(fp_ammo_action),sizeof(fp_ammo_build),sizeof(fp_ammo_destroy),sizeof(fp_ammo_name),sizeof(fp_ammo_result),sizeof(fp_throw_preview),sizeof(fp_throw_ballistics),sizeof(fp_throw_perform),sizeof(fp_throw_mode),sizeof(fp_throw_impact),sizeof(fp_throw_descriptor),sizeof(fp_throw_path_update),sizeof(fp_throw_fx_point),sizeof(fp_throw_launch),sizeof(fp_throw_draw),sizeof(fp_ammo_initial),sizeof(fp_ammo_selection),8};
    unsigned char *gate=VirtualAlloc(0,68,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(!gate)return 0;
    ammo_initial_gate(gate,(void*)ammo_action_hook,base+0x3b475e,base+0x3b4619,base+0x3b466d);
    FlushInstructionCache(GetCurrentProcess(),gate,68);
    unsigned char *selection=VirtualAlloc(0,75,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(!selection)return 0;
    ammo_selection_gate(selection,(void*)ammo_selection_denied,base+0x4579f0,base+0x4579be,base+0x457867);
    FlushInstructionCache(GetCurrentProcess(),selection,75);
    void *hooks[]={(void*)ammo_check_hook,(void*)ammo_action_hook,(void*)ammo_build_hook,(void*)ammo_destroy_hook,(void*)ammo_name_hook,(void*)ammo_result_hook,(void*)throw_preview_hook,(void*)throw_ballistics_hook,(void*)throw_perform_hook,(void*)throw_mode_hook,(void*)throw_impact_hook,(void*)throw_descriptor_hook,(void*)throw_path_update_hook,(void*)throw_fx_point_hook,(void*)throw_launch_hook,(void*)throw_draw_hook,(void*)gate,(void*)selection,(void*)throw_tick_hook};
    void *trampolines[16];
    for(unsigned i=0;i<19;i++)if(memcmp(base+sites[i],fingerprints[i],lengths[i]))return 0;
    for(unsigned i=0;i<16;i++){
        unsigned char *p=VirtualAlloc(0,lengths[i]+14,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(!p)return 0;
        memcpy(p,fingerprints[i],lengths[i]);ammo_abs_jump(p+lengths[i],base+sites[i]+lengths[i]);trampolines[i]=p;
        FlushInstructionCache(GetCurrentProcess(),p,lengths[i]+14);
    }
    ammo_check_original=(AmmoCheckFn)trampolines[0];ammo_action_original=(AmmoActionFn)trampolines[1];
    ammo_build_original=(AmmoBuildFn)trampolines[2];ammo_destroy_original=(AmmoDestroyFn)trampolines[3];
    ammo_result_original=(AmmoResultFn)trampolines[5];
    ammo_name_original=(AmmoNameFn)trampolines[4];ammo_current_battle=(AmmoBattleFn)(base+0x345180);
    throw_preview_original=(ThrowPreviewFn)trampolines[6];throw_ballistics_original=(ThrowBallisticsFn)trampolines[7];throw_perform_original=(ThrowPerformFn)trampolines[8];
    throw_mode_original=(ThrowModeFn)trampolines[9];throw_impact_original=(ThrowImpactFn)trampolines[10];throw_descriptor_original=(ThrowDescriptorFn)trampolines[11];
    throw_path_update_original=(int(*)(void*,unsigned char))trampolines[12];
    throw_fx_point_original=(ThrowFxPointFn)trampolines[13];
    throw_launch_original=(void(*)(void*,void*,unsigned,void*,const void*,const void*))trampolines[14];
    throw_draw_original=(void(*)(void*,const void*))trampolines[15];
    throw_fx_current=(void**)(base+0xf2f130);
    throw_fx_create_meta=(int(*)(int))(base+0x4134c0);
    throw_fx_context=(void(*)(int,void*))(base+0x412e60);
    throw_fx_battle_context=(void*(*)(void*))(base+0x2ed200);
    throw_fx_page=(unsigned char(*)(int,unsigned))(base+0x414490);
    throw_fx_create=(int(*)(int,unsigned char))(base+0x3124d0);
    throw_fx_params=(void(*)(void*,int,int))(base+0x311690);
    throw_fx_start=(void(*)(void*))(base+0x312540);
    throw_fx_position=(void(*)(int,const void*))(base+0x312a30);
    throw_fx_release=(void(*)(int))(base+0x311780);
    throw_tile_position=(void*(*)(void*,int,int))(base+0x2dc4a0);
    throw_target_unit=(void*(*)(int,void*))(base+0x452660);
    throw_fx_done=(ThrowFxDoneFn)(base+0x312330);throw_direction=(ThrowDirectionFn)(base+0x2d2ee0);
    throw_tick_original=(ThrowTickFn)original_tick;throw_trace=(ThrowTraceFn)(base+0x473b40);
    ammo_unequip=(AmmoUnequipFn)(base+0x4698c0);
    ammo_row=ammo_native_row;ammo_consume=(AmmoConsumeFn)(base+0x39d7b0);
    for(unsigned i=0;i<19;i++){
        unsigned char patch[32];memset(patch,0x90,lengths[i]);if(i==18)memcpy(patch,&hooks[i],8);else ammo_abs_jump(patch,hooks[i]);
        if(!throw_write(base+sites[i],patch,lengths[i])){
            for(unsigned j=0;j<=i;j++)throw_write(base+sites[j],fingerprints[j],lengths[j]);return 0;
        }
    }
    if(!throw_write(header_family,&thrown_family,sizeof(thrown_family))){
        for(unsigned i=0;i<19;i++)throw_write(base+sites[i],fingerprints[i],lengths[i]);
        throw_write(header_family,fp_throw_header_family,sizeof(fp_throw_header_family));
        return 0;
    }
    return 1;
}

int throw_attach_rogues(void *module){
    if(throw_rogue_combat())return 1;
    if(!ammo_action_original||!ammo_build_original||!ammo_destroy_original)return 0;
    const CombatHooks native={ammo_action_original,ammo_build_original,ammo_destroy_original};
    const CombatHooks *chain=rr_attach_combat(module,&native);
    if(!chain)return 0;
    InterlockedExchangePointer(&rogue_combat,(void*)chain);
    ammo_log("Throw Reborn and Rouges Reborn share action, queue and cleanup hooks.\r\n");
    return 1;
}

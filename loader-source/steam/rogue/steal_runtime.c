/* Experimental adapter for the single fingerprinted PC 1.0.2.0 executable.
 * Loaded by our launcher into the isolated copy; never writes the executable.
 * Native action execution pays MP and supplies range/height/animation handling.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include "steal_balance.h"
#include "shared_combat.h"
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <wchar.h>
#include "steal_state.h"
#include "steal_registry.h"
#include "fingerprints.h"

typedef unsigned char byte;
typedef uintptr_t (*SaveFn)(void *,uint32_t,void *);
typedef uintptr_t (*UnitReadFn)(void *,uint32_t,void *,int);
typedef void (*CaptureFn)(void *,void *,void *);
typedef void (*RestoreFn)(void *,void *,void *,byte);
typedef void (*HistoryFn)(void *,void *,void *);
typedef byte (*ActionFn)(void *,void *,void *,byte);
typedef void *(*AddFn)(void *,void *,uint16_t);
typedef int (*TargetFn)(void *);
typedef byte (*HistoryNodeFn)(void *,uint16_t,void *,void *);
typedef void *(*SnapshotByIndexFn)(int);
typedef byte (*EffectFn)(void *,void *,void *,void *,void *,void *,uint16_t);
typedef void *(*ObjectByIdFn)(void *,int);
static SaveFn original_write,original_read,original_unit_write;
static UnitReadFn original_unit_read;
static CaptureFn original_capture;
static RestoreFn original_restore;
static HistoryFn original_history;
static ActionFn original_action;
static AddFn add_item;
static TargetFn target_index;
static HistoryNodeFn original_history_node;
static SnapshotByIndexFn snapshot_by_index;
static EffectFn original_effect;
static ObjectByIdFn object_by_id;
static byte *base;
static StealState state;
static CRITICAL_SECTION lock;
static wchar_t log_path[32768];
static int award_enabled;
static int chariot_test_enabled;
static int traps_enabled;
typedef struct { int active; unsigned actor; uint32_t mask,rng; byte tags[30]; } SerialContext;
static _Thread_local SerialContext serial_write,serial_read;
static _Thread_local unsigned forecast_log_count;
static _Thread_local unsigned preview_restore_log_count;

static void log_line(const char *format,...) {
    char line[2048]; va_list args;
    va_start(args,format); int n=vsnprintf(line,sizeof(line)-3,format,args); va_end(args);
    if(n<0)return;
    if(n>(int)sizeof(line)-3)n=sizeof(line)-3;
    line[n++]='\r';line[n++]='\n';
    HANDLE f=CreateFileW(log_path,FILE_APPEND_DATA,FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,NULL);
    if(f!=INVALID_HANDLE_VALUE){DWORD done;WriteFile(f,line,n,&done,NULL);CloseHandle(f);}
}
static uint16_t word(const void *p,size_t off){uint16_t v;memcpy(&v,(byte*)p+off,2);return v;}
static void *pointer(const void *p,size_t off){void *v;memcpy(&v,(byte*)p+off,sizeof(v));return v;}
#include "steal_equipment.h"
#include "steal_rewards.h"
#include "steal_notification.h"
#include "steal_testing.h"
static void *unit_by_id(void *battle,uint16_t id);
#include "trap_runtime.h"
static void reset_state(void) {EnterCriticalSection(&lock);steal_reset(&state);memset(equipment_actions,0,sizeof(equipment_actions));LeaveCriticalSection(&lock);}
static int is_steal_effect(void *sub,void *effect_context) {
    return sub && effect_context && *((byte*)sub)==44 &&
           theft_role(word(effect_context,0x12),word(effect_context,0x16))>=0;
}
static int theft_chance_for(void *battle,void *source,void *target,int role) {
    if(!battle || !source || !target)return 0;
    if(*((byte*)source+0x188)!=1 || *((byte*)target+0x188)!=2 || word(target,0x148)==0)return 0;
    int index=(signed char)*((byte*)target+0x2fc);
    if(index<0 || index>=30)return 0;
    void *manager=pointer(battle,0x1b68);
    if(equipment_theft_enabled){
        EnterCriticalSection(&lock);
        int available=manager && theft_reward_available(target,manager,(unsigned)index,role);
        LeaveCriticalSection(&lock);
        return available?steal_hit_percent(role,word(source,0x26e),word(target,0x26e)):0;
    }
    /* Item 1000 is commodity zero: native 0x39A986 adds 0x300 to the
     * u16 counter index for commodities. Inventory begins at manager+0x64. */
    if(!manager || word(manager,0x64+0x600)>=999)return 0;
    EnterCriticalSection(&lock);
    int available=(state.mask&(1u<<index))==0;
    LeaveCriticalSection(&lock);
    return available?100:0;
}
static inline int theft_chance(void *battle,void *source,void *target) {
    return theft_chance_for(battle,source,target,THEFT_GENERAL);
}
static void *unit_by_id(void *battle,uint16_t id) {
    if(!battle || id>=0x8000u)return NULL;
    void *object=object_by_id(battle,(int)id);
    if(!object)return NULL;
    typedef byte (*IsUnitFn)(void *);
    void *vtable=pointer(object,0);
    if(!vtable || !((IsUnitFn)pointer(vtable,0x20))(object))return NULL;
    return object;
}
static byte hook_effect(void *out,void *sub,void *effect_context,void *battle_context,
                        void *values,void *work,uint16_t delay) {
    int detect=traps_enabled && sub && effect_context && *((byte*)sub)==40 &&
        word(effect_context,0x12)==DETECT_SKILL && word(effect_context,0x16)==554;
    if(!detect && !is_steal_effect(sub,effect_context))
        return original_effect(out,sub,effect_context,battle_context,values,work,delay);
    /* Own the removed operation rather than asking the incomplete legacy
     * dispatcher to accept it. The game already built/validated the command
     * and target list outside this subeffect callback. Native record layout is
     * established by 0x44B921..0x44B970 and the guaranteed hit at 0x450003. */
    void *battle=battle_context?pointer(battle_context,0):NULL;
    unsigned before=*((byte*)out+0x1e);
    if(before>=4)return 0;
    uint16_t source_id=word(out,0),target_id=word(out,2);
    void *source=unit_by_id(battle,source_id),*target=unit_by_id(battle,target_id);
    if(!source || !target)return 0;
    int role=theft_role(word(effect_context,0x12),word(effect_context,0x16));
    /* Detect is a completed search even when there are no hidden traps. This
     * success record replaces the removed native type-40 handler's MISS.
     * Revelation remains exclusively in committed ActionProcJob; repeated
     * forecasts never reveal traps, consume RNG, or change saved state. */
    int chance=detect?100:role==THEFT_GENERAL?theft_chance(battle,source,target):theft_chance_for(battle,source,target,role);
    byte *part=(byte*)out+0x20+before*0x88;
    memset(part,0,0x88);
    part[0]=1;part[1]=chance>0;
    uint16_t percent=(uint16_t)chance;memcpy(part+2,&percent,2);
    memcpy(part+4,&delay,2);memcpy(part+0x18,&source_id,2);memcpy(part+0x50,&target_id,2);
    part[0x22]=part[0x5a]=*((byte*)out+4);
    /* Native result dispatch is keyed by this operation byte, separately from
     * the hit flag/percentage. Zero means no target operation, so the game
     * discards it even when the numeric percentage is 100. */
    part[0x59]=(byte)(detect?40:44);
    part[0x58]=chance>0?0:1;
    *((byte*)out+0x1e)=(byte)(before+1);
    if(!detect && forecast_log_count<24){
        log_line("Steal handler v2/type44: source-id=%u target-id=%u target=%d source-team=%u target-team=%u hp=%u chance=%d",
                 (unsigned)source_id,(unsigned)target_id,(int)(signed char)*((byte*)target+0x2fc),
                 (unsigned)*((byte*)source+0x188),(unsigned)*((byte*)target+0x188),(unsigned)word(target,0x148),chance);
        ++forecast_log_count;
    }
    return chance>0;
}
static void hook_history(void *history,void *meta,void *extra) {
    /* Native flag +0x20 is false before the first history capture of a battle. */
    if(!*((byte*)history+0x20)){reset_state();EnterCriticalSection(&lock);
        (void)BCryptGenRandom(NULL,(PUCHAR)&state.rng,sizeof(state.rng),BCRYPT_USE_SYSTEM_PREFERRED_RNG);
        LeaveCriticalSection(&lock);trap_runtime_reset();log_line("New native history: Rouges Reborn state reset");}
    original_history(history,meta,extra);
}
static void hook_capture(void *battle,void *snapshot,void *extra) {
    original_capture(battle,snapshot,extra);
    if(traps_enabled && battle==trap_native_battle() && trap_ensure_world(battle))trap_save_snapshot(snapshot);
    EnterCriticalSection(&lock);steal_store(&state,(uintptr_t)snapshot,state.mask);LeaveCriticalSection(&lock);
}
static void hook_restore(void *battle,void *snapshot,void *extra,byte native_live_restore) {
    /* The native method takes FOUR arguments. Preserve its R9B flag exactly:
     * 0x363A76 passes zero when restoring a simulation/preview clone; the real
     * restore wrappers at 0x361ED6 / 0x362B6A / 0x36AB23 pass one. */
    original_restore(battle,snapshot,extra,native_live_restore);
    if(!native_live_restore){
        if(preview_restore_log_count<6){
            EnterCriticalSection(&lock);uint32_t mask=state.mask;LeaveCriticalSection(&lock);
            log_line("Preview snapshot restore: live theft mask preserved=%08lx",(unsigned long)mask);
            ++preview_restore_log_count;
        }
        return;
    }
    trap_restore_snapshot(battle,snapshot);
    EnterCriticalSection(&lock);
    uint32_t restored=0;
    int known=steal_find_snapshot(&state,(uintptr_t)snapshot,&restored);
    if(known){
        StealSnapshot progress=steal_progress(&state,(uintptr_t)snapshot);
        steal_restore_progress(&state,&progress);
        memset(equipment_actions,0,sizeof(equipment_actions));
    }
    uint32_t mask=state.mask;
    LeaveCriticalSection(&lock);
    /* A temporary native snapshot not captured/read by this adapter must not
     * silently mean "nobody robbed". Known zero history snapshots still reset
     * correctly when Chariot actually goes back before the theft. */
    log_line("Live snapshot restore: metadata=%s theft mask=%08lx",known?"known":"unknown-preserved",(unsigned long)mask);
}
static byte hook_history_node(void *node,uint16_t sequence,void *meta,void *provided_snapshot) {
    /* Native 0x476550 sometimes memcpy-copies an existing raw snapshot instead
     * of calling the capture function. Propagate external metadata with it. */
    byte result=original_history_node(node,sequence,meta,provided_snapshot);
    if(result && provided_snapshot){
        void *info=pointer(node,0x30);
        unsigned index=info?word(info,8):0;
        if(index>=1 && index<=50){
            void *destination=snapshot_by_index((int)index);
            trap_copy_snapshot(destination,provided_snapshot);
            EnterCriticalSection(&lock);
            StealSnapshot progress=steal_progress(&state,(uintptr_t)provided_snapshot);
            steal_store_progress(&state,(uintptr_t)destination,&progress);
            LeaveCriticalSection(&lock);
        }
    }
    return result;
}
static uintptr_t hook_write(void *snapshot,uint32_t version,void *writer) {
    SerialContext previous=serial_write;
    TrapSerial trap_previous=trap_serial_write;trap_serial_begin_write(snapshot,version);
    memset(&serial_write,0,sizeof(serial_write));
    serial_write.active=(version==0x81000102u);
    EnterCriticalSection(&lock);
    serial_write.mask=steal_snapshot_mask(&state,(uintptr_t)snapshot);
    serial_write.rng=steal_snapshot_rng(&state,(uintptr_t)snapshot);
    if(equipment_theft_enabled){StealSnapshot progress=steal_progress(&state,(uintptr_t)snapshot);steal_progress_tags(serial_write.tags,&progress);}
    LeaveCriticalSection(&lock);
    uintptr_t result=original_write(snapshot,version,writer);
    trap_serial_write=trap_previous;
    if(serial_write.active && serial_write.actor!=30)log_line("ERROR: native serializer actor count=%u",serial_write.actor);
    serial_write=previous;return result;
}
static uintptr_t hook_unit_write(void *unit,uint32_t version,void *writer) {
    byte *start=pointer(writer,8);
    uintptr_t result=original_unit_write(unit,version,writer);
    trap_serial_unit_write(start,pointer(writer,8));
    if(serial_write.active && serial_write.actor<30 && (byte*)pointer(writer,8)>start+0x57) {
        /* Eight header bytes, then character serializer padding at +0x4f.
         * Native 0x32D48E writes zero; native 0x32CFFD skips this byte. */
        if(start[0x57]!=0)log_line("ERROR: reserved byte was not zero; marker omitted");
        else start[0x57]=equipment_theft_enabled?serial_write.tags[serial_write.actor]:steal_tag(serial_write.actor,serial_write.mask);
        ++serial_write.actor;
    }
    return result;
}
static uintptr_t hook_read(void *snapshot,uint32_t version,void *reader) {
    SerialContext previous=serial_read;
    TrapSerial trap_previous=trap_serial_read;trap_serial_begin_read(version);
    memset(&serial_read,0,sizeof(serial_read));serial_read.active=(version==0x81000102u);
    uintptr_t result=original_read(snapshot,version,reader);
    trap_serial_end_read(snapshot);trap_serial_read=trap_previous;
    if(serial_read.active){
        StealSnapshot progress={0};progress.rng=0x73544541u;
        int valid=serial_read.actor==30 && steal_progress_decode(serial_read.tags,&progress);
        if(!valid)valid=serial_read.actor==30 && steal_equipment_decode(serial_read.tags,&progress.mask,&progress.rng);
        if(!valid)valid=serial_read.actor==30 && steal_decode_tags(serial_read.tags,&progress.mask);
        uint32_t mask=progress.mask;
        EnterCriticalSection(&lock);steal_store_progress(&state,(uintptr_t)snapshot,&progress);LeaveCriticalSection(&lock);
        log_line("Native snapshot read: metadata=%s mask=%08lx",valid?"present":"absent",(unsigned long)mask);
    }
    serial_read=previous;return result;
}
static uintptr_t hook_unit_read(void *unit,uint32_t version,void *reader,int index) {
    byte *start=pointer(reader,8);
    uintptr_t result=original_unit_read(unit,version,reader,index);
    trap_serial_unit_read(start,pointer(reader,8));
    if(serial_read.active && serial_read.actor<30 && (byte*)pointer(reader,8)>start+0x57)
        serial_read.tags[serial_read.actor++]=start[0x57];
    return result;
}
static int native_award(void *inventory) {
    byte result[2]={0};
    add_item(inventory,result,1000); /* one Mend Leaf */
    return result[0]!=0;
}
static int committed_steal_target(void *iterator,void *battle) {
    int index=target_index(iterator);
    if(index>=0 && index<30)return index;
    /* Removed operations have no native per-target execution object. Resolve
     * the single successful Steal result retained in the committed action's
     * calculation instead. This is reached only from ActionProcJob, never from
     * the common preview calculator. Reject ambiguous multi-target results. */
    byte *calculation=(byte*)iterator+0x10;
    int count=(signed char)calculation[0x5578];
    if(count<1 || count>30)return 30;
    byte *units=pointer(battle,0x1b48);
    if(!units)return 30;
    int selected=30;
    for(int i=0;i<count;++i){
        byte *result=calculation+0x28+i*0x2d8;
        int parts=(signed char)result[0x1e];
        if(parts<1 || parts>4)continue;
        int valid=0;
        for(int j=0;j<parts;++j){
            byte *part=result+0x20+j*0x88;
            if(part[0] && part[1] && word(part,2)>0 && !part[0x58] && part[0x59]==44)valid=1;
        }
        if(!valid)continue;
        uint16_t id=word(result,2);
        for(int j=0;j<30;++j){
            byte *unit=units+j*0x7d0;
            if(word(unit,0x12)!=id || unit[0x188]!=2 || word(unit,0x148)==0)continue;
            if(selected!=30 && selected!=j)return 30;
            selected=j;
        }
    }
    return selected;
}
static byte hook_action(void *iterator,void *context,void *extra,byte initial) {
    byte result=original_action(iterator,context,extra,initial);
    if(!result){
        if(traps_enabled && iterator){unsigned s=word((byte*)iterator+0x10,2);
            if(s==327 || s==346 || s==274 || s==275)log_line("Rouges Reborn: native action not ready skill=%u initial=%u",s,initial);}
        return result;
    }
    byte *command=(byte*)iterator+0x10;
    if(traps_enabled)trap_commit_action(iterator,pointer(context,0),notice_context.job);
    /* Both identity references are required. Forecast calculation never calls
     * this method: the only two callers belong to ActionProcJob::BuildQueue. */
    int role=theft_role(word(command,2),word(command,6));
    if(command[0]!=4 || role<0 || (equipment_theft_enabled && !theft_role_enabled(role)))return result;
    void *battle=pointer(context,0);
    int index=battle?committed_steal_target(iterator,battle):30;
    if(!battle || index<0 || index>=30){log_line("Steal: no live target index (%d)",index);return result;}
    void *actor=pointer(battle,0x48);
    byte *units=pointer(battle,0x1b48);
    byte *target=units?units+index*0x7d0:NULL;
    if(!actor || !target){log_line("Steal: missing actor");return result;}
    unsigned source_team=*((byte*)actor+0x188),target_team=target[0x188];
    log_line("Steal executed: type=%u target=%d source-team=%u target-team=%u target-hp=%u",
             command[0],index,source_team,target_team,word(target,0x148));
    if(source_team!=1 || target_team!=2 || word(target,0x148)==0){log_line("Steal: target validation rejected");return result;}
    void *manager=pointer(battle,0x1b68);
    if(!manager){log_line("Steal: missing inventory manager");return result;}
    if(equipment_theft_enabled){
        if(!award_enabled){log_line("Equipment theft diagnostic only: no transfer");return result;}
        uint16_t stolen=0;unsigned slot=0,quantity=1,goth=0;
        EnterCriticalSection(&lock);
        void *job=notice_context.job;
        if(!job || equipment_action_seen(job) || !theft_reward_available(target,manager,(unsigned)index,role)){
            LeaveCriticalSection(&lock);return result;
        }
        const int chance=steal_hit_percent(role,word(actor,0x26e),word(target,0x26e));
        uint32_t next_rng=state.rng;
        const unsigned roll=equipment_draw(&next_rng,100);
        if(roll>=(unsigned)chance){
            const int recorded=equipment_action_mark(job);
            if(recorded)state.rng=next_rng;
            LeaveCriticalSection(&lock);
            if(recorded){log_line("Steal missed: role=%d chance=%d roll=%u",role,chance,roll);
                request_trap_notice("Steal missed.");}
            return result;
        }
        const uint32_t old_rng=state.rng;
        state.rng=next_rng;
        int outcome;
        if(role==THEFT_LOOT)outcome=loot_commit(notice_context.job,target,(byte*)manager+0x64,(unsigned)index,&stolen,&quantity,&slot);
        else if(role==THEFT_GOLD)outcome=gold_commit(notice_context.job,target,manager,(unsigned)index,&goth);
        else{
            outcome=role==THEFT_GENERAL?equipment_commit(notice_context.job,target,(byte*)manager+0x64,&stolen,&slot):
                equipment_commit_for(notice_context.job,target,(byte*)manager+0x64,&stolen,&slot,role);
            if(outcome==EQUIPMENT_ADDED)state.mask|=1u<<(unsigned)index;
        }
        if(outcome!=EQUIPMENT_ADDED){state.rng=old_rng;(void)equipment_action_mark(job);}
        LeaveCriticalSection(&lock);
        log_line("Steal hit: role=%d chance=%d roll=%u",role,chance,roll);
        log_line("Steal 008: role=%d target=%d outcome=%d item=%u quantity=%u slot=%u Goth=%u",role,index,outcome,(unsigned)stolen,quantity,slot,goth);
        if(outcome==EQUIPMENT_ADDED){
            if(role==THEFT_GOLD)request_steal_gold_notice(goth);
            else request_steal_quantity_notice(stolen,(uint16_t)quantity);
        }
        return result;
    }
    if(!award_enabled){log_line("DIAGNOSTIC ONLY: would award one Mend Leaf; no inventory change");return result;}
    EnterCriticalSection(&lock);
    unsigned before_quantity=word(manager,0x64+0x600);
    int outcome=steal_commit(&state,(unsigned)index,native_award,(byte*)manager+0x64);
    unsigned after_quantity=word(manager,0x64+0x600);
    uint32_t mask=state.mask;
    LeaveCriticalSection(&lock);
    log_line("Steal outcome=%d mask=%08lx Mend-Leaf-native-count=%u->%u (1=added,0=already robbed,2=full)",outcome,(unsigned long)mask,before_quantity,after_quantity);
    if(outcome==STEAL_ADDED)request_steal_notice();
    return result;
}

typedef struct { DWORD rva; unsigned length; const byte *expected; void *replacement; void **original; byte *trampoline; } Hook;
/* The build script checks instruction boundaries and rejects RIP-relative,
 * relative control-flow and branches within every copied prologue. */
static Hook hooks[]={
 {0x36e5a0,15,fp_history,hook_history,(void**)&original_history,0},
 {0x364f10,15,fp_capture,hook_capture,(void**)&original_capture,0},
 {0x3631a0,15,fp_restore,hook_restore,(void**)&original_restore,0},
 {0x472350,15,fp_write,hook_write,(void**)&original_write,0},
 {0x471dd0,16,fp_read,hook_read,(void**)&original_read,0},
 {0x4f3300,14,fp_unit_write,hook_unit_write,(void**)&original_unit_write,0},
 {0x4f3250,15,fp_unit_read,hook_unit_read,(void**)&original_unit_read,0},
 {0x4568a0,16,fp_action,hook_action,(void**)&original_action,0},
 {0x479710,15,fp_history_node,hook_history_node,(void**)&original_history_node,0},
 {0x44e9f0,21,fp_effect,hook_effect,(void**)&original_effect,0},
 {0x3b45a0,16,fp_action_build,hook_build_queue,(void**)&original_build_queue,0},
 {0x3af090,15,fp_action_destroy,hook_action_destroy,(void**)&original_action_destroy,0},
 {0x39fa80,18,fp_drop_gear,hook_drop_gear,(void**)&original_drop_gear,0},
 {0x333730,19,fp_skill_rank,hook_skill_rank,(void**)&original_skill_rank,0},
 {TRAP_STEP_RVA,TRAP_STEP_LENGTH,fp_trap_step,hook_trap_step,(void**)&original_trap_step,0},
 {TRAP_PROGRESS_RVA,TRAP_PROGRESS_LENGTH,fp_trap_progress,hook_trap_progress,(void**)&original_trap_progress,0},
 {TRAP_IDLE_RVA,TRAP_IDLE_LENGTH,fp_trap_idle,hook_trap_idle,(void**)&original_trap_idle,0},
 {TRAP_EDGES_RVA,TRAP_EDGES_LENGTH,fp_trap_edges,hook_trap_edges,(void**)&original_trap_edges,0},
 {TRAP_HEIGHT_LIMITS_RVA,TRAP_HEIGHT_LIMITS_LENGTH,fp_trap_height_limits,hook_trap_height_limits,(void**)&original_trap_height_limits,0},
 {TRAP_FLOOR_PASS_RVA,TRAP_FLOOR_PASS_LENGTH,fp_trap_floor_pass,hook_trap_floor_pass,(void**)&original_trap_floor_pass,0},
};
static void jump(byte *p,void *target) {p[0]=0xff;p[1]=0x25;memset(p+2,0,4);memcpy(p+6,&target,8);}
static int install_chariot_override(void) {
    if(!chariot_test_enabled)return 1;
    byte *target=base+STEAL_CHARIOT_RVA;
    if(memcmp(target,fp_chariot_unlock,sizeof(fp_chariot_unlock))){
        log_line("Unsupported Chariot availability predicate; override refused");return 0;
    }
    /* Dedicated bool getter: read story setting 0x494, return nonzero. Only
     * replace that getter's return value. No story flag/table, history limit,
     * snapshot or inventory data is changed by this optional test switch. */
    DWORD old,unused;
    if(!VirtualProtect(target,sizeof(patch_chariot_unlock),PAGE_EXECUTE_READWRITE,&old))return 0;
    memcpy(target,patch_chariot_unlock,sizeof(patch_chariot_unlock));
    if(!VirtualProtect(target,sizeof(patch_chariot_unlock),old,&unused)){
        memcpy(target,fp_chariot_unlock,sizeof(patch_chariot_unlock));
        VirtualProtect(target,sizeof(patch_chariot_unlock),old,&unused);
        FlushInstructionCache(GetCurrentProcess(),target,sizeof(patch_chariot_unlock));
        return 0;
    }
    FlushInstructionCache(GetCurrentProcess(),target,sizeof(patch_chariot_unlock));
    log_line("Chariot test override: availability enabled in memory; saved story settings unchanged");
    return 1;
}
static int combat_is_shared(DWORD rva){
    return rva==0x4568a0 || rva==0x3b45a0 || rva==0x3af090;
}
static int install_hooks(const CombatHooks *native) {
    if(native){original_action=native->action;original_build_queue=native->build;original_action_destroy=native->destroy;}
    unsigned count=sizeof(hooks)/sizeof(hooks[0]),installed=0;
    for(unsigned i=0;i<sizeof(trap_binding_checks)/sizeof(trap_binding_checks[0]);++i){
        if(memcmp(base+trap_binding_checks[i].rva,trap_binding_checks[i].bytes,24)){
            log_line("Unsupported trap native binding at %lx",(unsigned long)trap_binding_checks[i].rva);return 0;
        }
    }
    if(memcmp(base+0x334ed0,fp_set_gear,sizeof(fp_set_gear)) ||
       memcmp(base+0x330650,fp_refresh_gear,sizeof(fp_refresh_gear)) ||
       memcmp(base+0x2e6f20,fp_arms_manager,sizeof(fp_arms_manager)) ||
       memcmp(base+0x2e6ab0,fp_arms_row,sizeof(fp_arms_row)) ||
       memcmp(base+0x39d910,fp_add_item,sizeof(fp_add_item)) ||
       memcmp(base+0x333c00,fp_encounter_row,sizeof(fp_encounter_row)) ||
       memcmp(base+0x333c20,fp_effective_level,sizeof(fp_effective_level)) ||
       memcmp(base+0x2fc6d0,fp_toast_open,sizeof(fp_toast_open)) ||
       memcmp(base+0x2fc6b0,fp_toast_status,sizeof(fp_toast_status))){
        log_line("Unsupported equipment/inventory binding; installation refused");return 0;
    }
    /* Prepare every allocation and validate every fingerprint before writing. */
    if(chariot_test_enabled && memcmp(base+STEAL_CHARIOT_RVA,fp_chariot_unlock,sizeof(fp_chariot_unlock))){
        log_line("Unsupported Chariot availability predicate; runtime installation refused");return 0;
    }
    if(denam_test_enabled && (memcmp(base+0x3bfb20,fp_test_skill_list,sizeof(fp_test_skill_list)) ||
                              memcmp(base+0x423373,fp_test_skill_call,5))){
        log_line("Unsupported Denam battle skill collector; runtime installation refused");return 0;
    }
    for(unsigned i=0;i<count;++i){
        Hook *h=&hooks[i];
        if(native && combat_is_shared(h->rva))continue;
        if(memcmp(base+h->rva,h->expected,h->length)){log_line("Unsupported code at RVA %lx",(unsigned long)h->rva);return 0;}
        h->trampoline=VirtualAlloc(NULL,h->length+14,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
        if(!h->trampoline)return 0;
        memcpy(h->trampoline,base+h->rva,h->length);jump(h->trampoline+h->length,base+h->rva+h->length);
        DWORD old;
        if(!VirtualProtect(h->trampoline,h->length+14,PAGE_EXECUTE_READ,&old))return 0;
        FlushInstructionCache(GetCurrentProcess(),h->trampoline,h->length+14);
        *h->original=h->trampoline;
    }
    for(unsigned i=0;i<count;++i){
        Hook *h=&hooks[i];DWORD old;
        if(native && combat_is_shared(h->rva))continue;
        if(!VirtualProtect(base+h->rva,h->length,PAGE_EXECUTE_READWRITE,&old))goto rollback;
        jump(base+h->rva,h->replacement);memset(base+h->rva+14,0x90,h->length-14);
        VirtualProtect(base+h->rva,h->length,old,&old);FlushInstructionCache(GetCurrentProcess(),base+h->rva,h->length);
        installed=i+1;
    }
    if(!install_test_skill_call() || !install_chariot_override())goto rollback;
    return 1;
rollback:
    rollback_test_skill_call();
    while(installed){Hook *h=&hooks[--installed];DWORD old;
        if(native && combat_is_shared(h->rva))continue;
        if(VirtualProtect(base+h->rva,h->length,PAGE_EXECUTE_READWRITE,&old)){
        memcpy(base+h->rva,h->expected,h->length);VirtualProtect(base+h->rva,h->length,old,&old);FlushInstructionCache(GetCurrentProcess(),base+h->rva,h->length);}}
    log_line("Hook installation rolled back");return 0;
}
static int rr_start(void *module, const CombatHooks *native) {
    wchar_t path[32768],event_name[100];
    DWORD length=GetModuleFileNameW((HMODULE)module,log_path,32768);
    if(!length||length>=32768-40)return 0;
    wchar_t *slash=wcsrchr(log_path,L'\\');if(!slash)return 0;
    wcscpy(slash+1,L"RougesReborn\\steal-runtime.log");
    base=(byte*)GetModuleHandleW(NULL);
    IMAGE_DOS_HEADER *dos=(void*)base;
    IMAGE_NT_HEADERS64 *nt=(void*)(base+dos->e_lfanew);
    if(nt->Signature!=IMAGE_NT_SIGNATURE || nt->FileHeader.TimeDateStamp!=STEAL_PE_TIMESTAMP || nt->OptionalHeader.SizeOfImage!=STEAL_IMAGE_SIZE){log_line("Refused unsupported executable headers");return 0;}
    InitializeCriticalSection(&lock);reset_state();
    trap_bind_native();
    add_item=(AddFn)(base+0x39d910);target_index=(TargetFn)(base+0x456cb0);
    arms_manager=(ArmsManagerFn)(base+0x2e6f20);
    arms_row=(ArmsRowFn)(base+0x2e6ab0);
    set_gear=(SetGearFn)(base+0x334ed0);
    refresh_gear=(RefreshGearFn)(base+0x330650);
    encounter_row=(EncounterRowFn)(base+0x333c00);
    effective_level=(EffectiveLevelFn)(base+0x333c20);
    commodity_row=native_commodity_row;
    native_test_skill_list=(TestSkillListFn)(base+0x3bfb20);
    snapshot_by_index=(SnapshotByIndexFn)(base+0x36e140);
    object_by_id=(ObjectByIdFn)(base+0x361c30);
    popup_open=(PopupOpenFn)(base+0x2ebc40);
    popup_status=(PopupStatusFn)(base+0x2ebb30);
    queue_append=(QueueAppendFn)(base+0x3ab5f0);
    toast_open=(ToastOpenFn)(base+0x2fc6d0);toast_status=(ToastStatusFn)(base+0x2fc6b0);
    wcscpy(path,log_path);slash=wcsrchr(path,L'\\');slash[1]=0;wcscat(path,L"enable-awards.flag");
    award_enabled=GetFileAttributesW(path)!=INVALID_FILE_ATTRIBUTES;
    wcscpy(path,log_path);slash=wcsrchr(path,L'\\');slash[1]=0;wcscat(path,L"enable-equipment-theft.flag");
    equipment_theft_enabled=GetFileAttributesW(path)!=INVALID_FILE_ATTRIBUTES;
    wcscpy(path,log_path);slash=wcsrchr(path,L'\\');slash[1]=0;wcscat(path,L"steal-config.ini");
    steal_mode=(int)GetPrivateProfileIntW(L"Steal",L"EquipmentMode",STEAL_MODE_COMBINED,path);
    if(steal_mode<STEAL_MODE_RANDOM || steal_mode>STEAL_MODE_COMBINED){log_line("Invalid Steal equipment mode; runtime refused");return 0;}
    denam_test_enabled=GetPrivateProfileIntW(L"Testing",L"DenamAllStealSkills",0,path)==1;
    traps_enabled=GetPrivateProfileIntW(L"Trap",L"Enabled",0,path)==1;
    trap_payload=GetPrivateProfileIntW(L"Trap",L"TestDamage",50,path);
    trap_scaled_damage=GetPrivateProfileIntW(L"Trap",L"UseFixedTestDamage",0,path)!=1;
    wcscpy(trap_visual_path,log_path);slash=wcsrchr(trap_visual_path,L'\\');slash[1]=0;wcscat(trap_visual_path,L"trap-theme.txt");
    if(!trap_payload || trap_payload>9999){
        log_line("Invalid trap configuration; runtime refused");return 0;
    }
    chariot_test_enabled=0; /* The menu module owns Chariot. */
    log_line("Rouges Reborn 009 starting; inventory awards %s; Chariot test override %s",
             award_enabled?"ENABLED":"diagnostic only",chariot_test_enabled?"ENABLED":"disabled");
    if(!install_hooks(native))return 0;
    trap_ai_ready=traps_enabled;
    log_line("READY: Rouges Reborn 019; twenty native hooks; equipment enabled=%d mode=%d; Denam test skills=%d; traps=%d capacity=24; marker origin correction; blind tile Disarm; loot entries once; Gold=100 x level once",equipment_theft_enabled,steal_mode,denam_test_enabled,traps_enabled);
    swprintf(event_name,100,L"Local\\TOR-Steal-ready-%lu",GetCurrentProcessId());
    HANDLE ready=OpenEventW(EVENT_MODIFY_STATE,FALSE,event_name);
    if(ready){SetEvent(ready);CloseHandle(ready);}
    return 1;
}

DWORD WINAPI rr_initialize(void *module){return (DWORD)rr_start(module,NULL);}

const CombatHooks *rr_attach_combat(void *module,const CombatHooks *native){
    static const CombatHooks chain={hook_action,hook_build_queue,hook_action_destroy};
    return native && rr_start(module,native)?&chain:NULL;
}

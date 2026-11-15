#ifndef ROUGES_TRAP_RUNTIME_H
#define ROUGES_TRAP_RUNTIME_H
/* Experimental flat-ground binding, PC 1.0.2 only. The native game owns
 * movement, HP/status/death bookkeeping, effects, inventory and save buffers. */
#include "trap_set_padding.h"
#include "trap_visual_presets.h"
#include "trap_damage.h"
#define TRAP_SKILL 327u
#define DISARM_SKILL 346u
#define DETECT_SKILL 274u
#define ENEMY_TRAP_TEST_SKILL 275u
typedef void (*TrapStepFn)(void *,void *);
typedef byte (*TrapProgressFn)(void *,byte,void *);
typedef void (*TrapIdleFn)(void *,void *);
typedef void *(*TrapHeightLimitsFn)(void *,void *,void *);
typedef int (*TrapEdgesFn)(void *,uint32_t,int,int);
typedef void *(*TrapBattleFn)(void);
typedef int (*TrapDimensionFn)(void);
typedef int (*TrapHeightFn)(int,int);
typedef void *(*TrapObjectFn)(void *,uint32_t);
typedef void *(*TrapDamageFn)(void *,void *,int,void *);
typedef void *(*TrapDamageNoticeFn)(void *,int);
typedef int (*TrapFxCreateFn)(int,byte);
typedef void (*TrapFxParamsFn)(void *,int,int);
typedef void (*TrapFxStartFn)(void *);
typedef void (*TrapFxPositionFn)(int,const void *);
typedef byte (*TrapFxStateFn)(int);
typedef void (*TrapFxReleaseFn)(int);
typedef byte (*TrapFxSignalFn)(int,int);
typedef void *(*TrapPositionFn)(void *,int,int);
static TrapStepFn original_trap_step;
static TrapProgressFn original_trap_progress;
static TrapIdleFn original_trap_idle;
static TrapHeightLimitsFn original_trap_height_limits;
#define TRAP_HEIGHT_LIMIT 3
static int trap_ground_action(const void *command){
    if(!command || *((const byte*)command)!=4)return 0;
    unsigned skill=word(command,2),effect=word(command,6);
    return (skill==327 && effect==607) || (skill==275 && effect==555) || (skill==346 && effect==626);
}
/* Used by both native range-grid construction (3CCD23/3CCE73) and cursor
 * acceptance (3CD5D6). Exact command pairs only; previews remain read-only. */
static void *hook_trap_height_limits(void *actor,void *out,void *command){
    void *result=original_trap_height_limits(actor,out,command);
    if(traps_enabled && out && trap_ground_action(command)){
        ((byte*)out)[0]=TRAP_HEIGHT_LIMIT;((byte*)out)[1]=TRAP_HEIGHT_LIMIT;
    }
    return result;
}
static int trap_height_allowed(int from,int to){
    return from>=0 && from<=255 && to>=0 && to<=255 && to-from<=TRAP_HEIGHT_LIMIT && from-to<=TRAP_HEIGHT_LIMIT;
}
static TrapEdgesFn original_trap_edges;
static TrapBattleFn trap_native_battle;
static byte *trap_native_manager;
static TrapDimensionFn trap_native_width,trap_native_height;
static TrapHeightFn trap_native_floor;
static TrapObjectFn trap_native_object;
static TrapDamageFn trap_native_damage;
static TrapDamageNoticeFn trap_native_damage_notice;
static TrapFxCreateFn trap_fx_create;
static TrapFxParamsFn trap_fx_params;
static TrapFxStartFn trap_fx_start;
static TrapFxPositionFn trap_fx_position;
static TrapFxStateFn trap_fx_done;
static TrapFxReleaseFn trap_fx_release;
static TrapFxSignalFn trap_fx_signal;
static TrapPositionFn trap_native_position;
static unsigned trap_payload=50,trap_visual_preset;
static int trap_scaled_damage=1;
static wchar_t trap_visual_path[32768];
static ULONGLONG trap_visual_next_poll;
static int trap_visual_bad_read;
static TrapSet trap_world;
static int trap_ai_ready;
static uint64_t trap_event=1;
typedef struct { int handle,activated;uint32_t generation; } TrapVisual;
static TrapVisual trap_markers[TRAP_CAPACITY];
typedef struct { int handle,activated;ULONGLONG expires; } TrapBurst;
static TrapBurst trap_bursts[48];
static unsigned trap_burst_next;
static int trap_event_effects_enabled=1,trap_floor_enabled=1;
typedef struct { uintptr_t key;TrapSet world; } TrapSaved;
static TrapSaved trap_saved[128];
static unsigned trap_saved_next;
typedef struct { int active;unsigned count;byte wire[TRAP_SET_WIRE_SIZE]; } TrapSerial;
static _Thread_local TrapSerial trap_serial_write,trap_serial_read;
typedef struct { int valid;byte index;uintptr_t path;TrapMove move; } TrapPending;
static TrapPending trap_pending[30];
/* Manager +0x1B0 owns three native worlds, stride 0xDD580. World zero is
 * live; 0x2EB300 explicitly returns world one for AI. 0x2EB310 is a member
 * getter requiring RCX=manager and selects +0x1B8. Never call it as a free
 * function or treat whichever preview is selected as the live world. */
static void *trap_active_battle(void){
    return trap_native_manager && trap_native_manager[0]?pointer(trap_native_manager,0x1b0):NULL;
}
static int trap_live_actor(void *battle,void *unit){
    if(!battle || !unit || battle!=trap_native_battle())return -1;
    byte *units=pointer(battle,0x1b48);
    uintptr_t offset=(uintptr_t)unit-(uintptr_t)units;
    if(!units || offset>=30u*0x7d0u || offset%0x7d0u || pointer(unit,0x728)!=battle)return -1;
    unsigned index=(unsigned)(offset/0x7d0u);
    return ((byte*)unit)[0x2fc]==index?(int)index:-1;
}
int rr_trap_ai_ready(void){return trap_ai_ready;}

/* Read-only evaluation against the native AI battle copy. Committed placement
 * still passes through trap_commit_action on the live battle. */
int rr_trap_ai_tile(const void *unit,uint32_t origin,uint32_t target){
    const byte *actor=unit;
    const unsigned side=actor[0x188];
    void *battle=pointer(actor,0x728);
    const byte *units=battle?pointer(battle,0x1b48):NULL;
    const int width=trap_native_width(),height=trap_native_height();
    const int x=(int16_t)target,y=(int16_t)(target>>16);
    const int ax=(int16_t)origin,ay=(int16_t)(origin>>16);
    if(!units || !trap_side_bit(side) || width<1 || height<1 || width>32 || height>32 ||
       x<0 || x>=width || y<0 || y>=height || ax<0 || ax>=width || ay<0 || ay>=height ||
       abs(x-ax)+abs(y-ay)!=1 || trap_native_object(battle,target))return 0;
    const int floor=trap_native_floor(x,y);
    if(!trap_height_allowed(trap_native_floor(ax,ay),floor))return 0;
    const TrapTile tile={(int16_t)x,(int16_t)y,(int16_t)floor,0};
    if(trap_world.battle_key && (traps_count(&trap_world)>=TRAP_CAPACITY || traps_avoid(&trap_world,side,tile)))return 0;
    int nearest=6;
    for(unsigned i=0;i<30;++i){
        const byte *other=units+i*0x7d0;
        if(other==actor || !word(other,0x148) || !trap_side_bit(other[0x188]))continue;
        int distance=abs(x-(int16_t)word(other,0x14))+abs(y-(int16_t)word(other,0x16));
        if(!distance)return 0;
        if(other[0x188]!=side && distance<nearest)nearest=distance;
    }
    /* No useful target nearby. Let the original action priorities win. */
    return nearest<6?120000+30000*(6-nearest):0;
}
/* Stable geometry checksum supplements the native snapshot association. It
 * is not claimed to be a unique scenario/encounter identifier. */
static uint64_t trap_geometry_key(unsigned width,unsigned height){
    uint64_t h=1469598103934665603ull;
    h=(h^width)*1099511628211ull;h=(h^height)*1099511628211ull;
    for(unsigned y=0;y<height;++y)for(unsigned x=0;x<width;++x){
        h=(h^(uint16_t)trap_native_floor((int)x,(int)y))*1099511628211ull;
    }
    return h?h:1;
}
static void trap_hide_marker(void){
    for(unsigned i=0;i<TRAP_CAPACITY;++i){
        if(trap_markers[i].handle && trap_fx_release)trap_fx_release(trap_markers[i].handle);
        memset(trap_markers+i,0,sizeof(trap_markers[i]));
    }
}
static void trap_clear_bursts(void){
    for(unsigned i=0;i<48;++i){
        if(trap_bursts[i].handle && trap_fx_release)trap_fx_release(trap_bursts[i].handle);
        memset(trap_bursts+i,0,sizeof(trap_bursts[i]));
    }
    trap_burst_next=0;
}
static void trap_refresh_bursts(void){
    ULONGLONG now=GetTickCount64();
    for(unsigned i=0;i<48;++i){TrapBurst *b=trap_bursts+i;if(!b->handle)continue;
        if(now>=b->expires || trap_fx_done(b->handle)){trap_fx_release(b->handle);memset(b,0,sizeof(*b));continue;}
    }
}
/* Native update 40E1C1..40E1D2 starts the default effect sequence itself.
 * No extra event-1 dispatch/retry. Release the handle instead of resetting it:
 * 310160/40F5F0 resets status to 2 and replays; 30EF30 unlinks/releases. */
static void trap_play_burst(TrapTile tile,unsigned selector,unsigned variant){
    if(!trap_event_effects_enabled)return;
    trap_refresh_bursts();unsigned slot=48;
    for(unsigned i=0;i<48;++i)if(!trap_bursts[i].handle){slot=i;break;}
    if(slot==48){slot=trap_burst_next++%48;trap_fx_release(trap_bursts[slot].handle);}
    int handle=trap_fx_create((int)selector,(byte)variant);if(!handle){memset(trap_bursts+slot,0,sizeof(trap_bursts[slot]));return;}
    float point[4];byte params[0x50];trap_native_position(point,tile.x,tile.y);
    trap_fx_params(params,handle,4);memcpy(params+0x20,point,sizeof(point));trap_fx_start(params);trap_fx_position(handle,point);
    unsigned duration=selector==113?900u:600u;
    trap_bursts[slot]=(TrapBurst){handle,1,GetTickCount64()+duration};
    log_line("Rouges Reborn: one-shot visual selector=%u variant=%u tile=%d,%d limit-ms=%u",selector,variant,tile.x,tile.y,duration);
}
/* Called only by the game-thread marker refresh. Presets are bounded and
 * only visual handles change; no trap/history/HP/RNG state is touched. */
static int trap_visual_select(int preset){
    if(preset<0 || (unsigned)preset>=TRAP_VISUAL_PRESET_COUNT)return 0;
    if(trap_visual_preset==(unsigned)preset)return 1;
    trap_hide_marker();trap_visual_preset=(unsigned)preset;
    if(trap_floor_enabled){log_line("Trap colour theme: %s",preset==1?"purple + Rampart":"cyan + Sanctuary");return 1;}
    const TrapVisualPreset *p=trap_visual_presets+preset;
    log_line("Trap visual preview: %d %s selector=%u variant=%u resolved-root=%u",preset,p->name,p->selector,p->variant,p->raw_root);
    return 1;
}
static void trap_visual_poll(void){
    if(trap_floor_enabled)return; /* owner colours replace the global theme */
    if(!trap_visual_path[0])return;
    ULONGLONG now=GetTickCount64();if(now<trap_visual_next_poll)return;
    trap_visual_next_poll=now+500;
    HANDLE file=CreateFileW(trap_visual_path,GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file==INVALID_HANDLE_VALUE)return;
    char buffer[17];DWORD got=0;
    int read=ReadFile(file,buffer,sizeof(buffer),&got,NULL)!=0;CloseHandle(file);
    int preset=read?trap_visual_parse(buffer,got):-1;
    if(trap_floor_enabled && preset>1)preset=-1;
    if(preset<0){if(!trap_visual_bad_read)log_line("Trap visual preview: invalid selection ignored");trap_visual_bad_read=1;return;}
    trap_visual_bad_read=0;trap_visual_select(preset);
}
static void trap_runtime_reset(void){
    trap_hide_marker();trap_clear_bursts();memset(&trap_world,0,sizeof(trap_world));
    memset(trap_saved,0,sizeof(trap_saved));memset(trap_pending,0,sizeof(trap_pending));
    trap_saved_next=0;trap_event=1;
}
static int trap_ensure_world(void *battle){
    if(!traps_enabled || !battle || battle!=trap_native_battle())return 0;
    if(trap_world.battle_key)return 1;
    int width=trap_native_width(),height=trap_native_height();
    if(width<1 || height<1 || width>32 || height>32)return 0;
    return traps_begin(&trap_world,trap_geometry_key((unsigned)width,(unsigned)height),(unsigned)width,(unsigned)height,0);
}
static void trap_refresh_marker(void){
    trap_refresh_bursts();
    trap_visual_poll();
    if(!traps_enabled || !trap_native_battle()){
        trap_hide_marker();trap_clear_bursts();return;
    }
    if(trap_floor_enabled){trap_hide_marker();return;}
    const TrapVisualPreset *preset=trap_visual_presets+trap_visual_preset;
    if(!preset->selector){trap_hide_marker();return;}
    for(unsigned i=0;i<TRAP_CAPACITY;++i){
        TrapMarker marker;TrapVisual *v=trap_markers+i;
        int visible=trap_marker_for(trap_world.slots+i,1,&marker);
        if(v->handle && (!visible || v->generation!=marker.generation || trap_fx_done(v->handle))){
            trap_fx_release(v->handle);memset(v,0,sizeof(*v));
        }
        if(!visible)continue;
        if(!v->handle){
            int handle=trap_fx_create((int)preset->selector,(byte)preset->variant);if(!handle)continue;
            byte params[0x50];float point[4];
            trap_native_position(point,marker.tile.x,marker.tile.y);
            trap_fx_params(params,handle,4);
            /* Native 30ED50 supplies this vector at params+20. Start copies
             * it to effect+420. 3101A0 changes +680, a different transform. */
            memcpy(params+0x20,point,sizeof(point));trap_fx_start(params);
            v->handle=handle;v->generation=marker.generation;
        }
        float point[4];trap_native_position(point,marker.tile.x,marker.tile.y);
        trap_fx_position(v->handle,point); /* 3101E0: actual effect+420 origin */
        /* Selector != raw EFX root: native indices[selector]+variant resolves
         * the resource. Event acceptance/appearance are audition results. */
        if(!v->activated && trap_fx_signal(v->handle,(int)preset->event)){
            v->activated=1;
            log_line("Rouges Reborn: marker activated slot=%u tile=%d,%d world=%.2f,%.2f,%.2f handle=%x",i,marker.tile.x,marker.tile.y,point[0],point[1],point[2],(unsigned)v->handle);
        }
    }
}
static void trap_store_snapshot(void *snapshot,const TrapSet *world){
    if(!traps_enabled || !snapshot || !world || !world->battle_key || world->busy)return;
    EnterCriticalSection(&lock);
    unsigned slot=128;
    for(unsigned i=0;i<128;++i)if(trap_saved[i].key==(uintptr_t)snapshot){slot=i;break;}
    if(slot==128)slot=trap_saved_next++%128;
    trap_saved[slot].key=(uintptr_t)snapshot;trap_saved[slot].world=*world;
    LeaveCriticalSection(&lock);
}
static void trap_save_snapshot(void *snapshot){trap_store_snapshot(snapshot,&trap_world);}
static int trap_get_snapshot(void *snapshot,TrapSet *out){
    int found=0;EnterCriticalSection(&lock);
    for(unsigned i=0;i<128;++i)if(trap_saved[i].key==(uintptr_t)snapshot && snapshot){*out=trap_saved[i].world;found=1;break;}
    LeaveCriticalSection(&lock);return found;
}
static void trap_forget_snapshot(void *snapshot){
    EnterCriticalSection(&lock);
    for(unsigned i=0;i<128;++i)if(trap_saved[i].key==(uintptr_t)snapshot && snapshot)memset(trap_saved+i,0,sizeof(trap_saved[i]));
    LeaveCriticalSection(&lock);
}
static void trap_restore_snapshot(void *battle,void *snapshot){
    if(!traps_enabled)return;
    trap_hide_marker();trap_clear_bursts();memset(trap_pending,0,sizeof(trap_pending));
    TrapSet saved;
    if(trap_get_snapshot(snapshot,&saved) && battle==trap_native_battle() && saved.width==trap_native_width() && saved.height==trap_native_height() &&
       saved.battle_key==trap_geometry_key(saved.width,saved.height)){
        trap_world=saved;
        if(trap_event<saved.placement_action)trap_event=saved.placement_action;
        if(trap_event<saved.last_move)trap_event=saved.last_move;
    }
    else memset(&trap_world,0,sizeof(trap_world));
    trap_refresh_marker();
}
static void trap_copy_snapshot(void *destination,void *source){
    if(!traps_enabled)return;
    TrapSet saved;if(trap_get_snapshot(source,&saved))trap_store_snapshot(destination,&saved);
    else trap_forget_snapshot(destination);
}
static void trap_serial_begin_write(void *snapshot,uint32_t version){
    memset(&trap_serial_write,0,sizeof(trap_serial_write));
    TrapSet saved;
    trap_serial_write.active=traps_enabled && version==0x81000102u && trap_get_snapshot(snapshot,&saved) && traps_encode(&saved,trap_serial_write.wire);
}
static void trap_serial_unit_write(byte *start,byte *end){
    if(!trap_serial_write.active)return;
    unsigned i=trap_serial_write.count++;
    if(i>=30 || end<start || (size_t)(end-start)<0x116 || start[0x114] || start[0x115]){
        trap_serial_write.active=0;log_line("Trap serializer rejected incompatible padding");return;
    }
    traps_pad_write(start,trap_serial_write.wire+7*i);
}
static void trap_serial_begin_read(uint32_t version){
    memset(&trap_serial_read,0,sizeof(trap_serial_read));trap_serial_read.active=traps_enabled && version==0x81000102u;
}
static void trap_serial_unit_read(byte *start,byte *end){
    if(!trap_serial_read.active)return;
    unsigned i=trap_serial_read.count++;
    if(i>=30 || end<start || (size_t)(end-start)<0x116){trap_serial_read.active=0;return;}
    traps_pad_read(start,trap_serial_read.wire+7*i);
}
static void trap_serial_end_read(void *snapshot){
    TrapSet decoded;
    byte *w=trap_serial_read.wire;
    /* Native snapshot buffers are reused. A load without valid mod metadata
     * must not inherit an older battle's cached traps at that address. */
    trap_forget_snapshot(snapshot);
    if(trap_serial_read.active && trap_serial_read.count==30 &&
       traps_decode_without_payment(&decoded,w)){
        trap_store_snapshot(snapshot,&decoded);
    }
}
/* No mutation in the forecast dispatcher. The removed operations have no
 * native result part; committed ActionProcJob is the sole placement gate. */
static void trap_commit_action(void *iterator,void *battle,void *job){
    byte *command=(byte*)iterator+0x10;
    uint16_t skill=word(command,2),effect=word(command,6);
    if(command[0]!=4 || !((skill==327 && effect==607) || (skill==346 && effect==626) ||
       (skill==274 && effect==554) || (skill==275 && effect==555)))return;
    byte *actor=battle?pointer(battle,0x48):NULL;
    int actor_index=trap_live_actor(battle,actor);
    if(!job || actor_index<0 || !word(actor,0x148) || !trap_ensure_world(battle) || equipment_action_seen(job)){
        log_line("Rouges Reborn: trap action rejected skill=%u job=%p actor-index=%d battle=%p live=%p",skill,job,actor_index,battle,trap_native_battle());return;
    }
    unsigned side=actor[0x188];if(!trap_side_bit(side))return;
    TrapTile tile={(int16_t)word(actor,0x3b0),(int16_t)word(actor,0x3b2),0,0};
    if(skill==DETECT_SKILL){
        if(!equipment_action_mark(job))return;
        TrapTile center={(int16_t)word(actor,0x14),(int16_t)word(actor,0x16),0,0};
        unsigned found=traps_detect(&trap_world,side,center,128),revealed=0;
        for(unsigned i=0;i<TRAP_CAPACITY;++i)if(trap_world.slots[i].owner_team!=side && trap_known(trap_world.slots+i,side))++revealed;
        char message[80];
        if(found)snprintf(message,sizeof(message),"Detected %u hidden trap%s.",found,found==1?"":"s");
        else if(revealed)snprintf(message,sizeof(message),"No hidden traps remain. %u revealed trap%s still armed.",revealed,revealed==1?" is":"s are");
        else snprintf(message,sizeof(message),"No hidden traps detected.");
        request_trap_notice(message);
        log_line("Rouges Reborn: Detect side=%u newly-revealed=%u armed-revealed=%u",side,found,revealed);trap_refresh_marker();return;
    }
    if(!trap_inside(trap_world.slots,tile))return;
    int height=trap_native_floor(tile.x,tile.y);if(height<0 || height>255)return;
    tile.height=(int16_t)height;
    if(skill==DISARM_SKILL){
        if(!equipment_action_mark(job))return;
        int slot=traps_find(&trap_world,tile);
        int visible=side==1 || (slot>=0 && trap_known(trap_world.slots+slot,1));
        int removed=traps_disarm(&trap_world,side,tile);
        if(removed && visible)trap_play_burst(tile,114,1);
        request_trap_notice(removed?"Trap disarmed.":"No trap on that tile.");
        log_line("Rouges Reborn: Disarm side=%u tile=%d,%d removed=%d",side,tile.x,tile.y,removed);
        trap_refresh_marker();return;
    }
    int ax=(int16_t)word(actor,0x14),ay=(int16_t)word(actor,0x16);
    int distance=(ax>tile.x?ax-tile.x:tile.x-ax)+(ay>tile.y?ay-tile.y:tile.y-ay);
    uint32_t packed=(uint16_t)tile.x|((uint32_t)(uint16_t)tile.y<<16);
    if(distance!=1 || !trap_height_allowed(trap_native_floor(ax,ay),height) || trap_native_object(battle,packed)){
        request_trap_notice("Choose adjacent empty ground within 3 height levels.");
        log_line("Rouges Reborn: placement terrain/range rejected at %d,%d",tile.x,tile.y);return;
    }
    uint16_t owner=word(actor,0x12);
    if(skill==ENEMY_TRAP_TEST_SKILL){
        byte *units=pointer(battle,0x1b48);int found=0;
        for(unsigned i=0;i<30;++i){byte *u=units+i*0x7d0;if(u[0x188]==2 && word(u,0x148)){
            owner=word(u,0x12);side=2;found=1;break;}}
        if(!found)return;
    }
    unsigned payload=trap_payload,level=0,dex=0;
    if(trap_scaled_damage){
        byte *setter=skill==ENEMY_TRAP_TEST_SKILL?unit_by_id(battle,owner):actor;
        if(trap_live_actor(battle,setter)<0 || !effective_level)return;
        level=effective_level(setter+0x138);
        /* Native 32D99E/34FF80 build ten u16 derived values at char+12E:
         * HP,MP,STR,VIT,DEX,... . DEX is +136, hence live unit +26E.
         * This is the derived cache, not a raw permanent/base contribution. */
        dex=word(setter,0x26e);payload=trap_scaled_payload(level,dex);
        if(!payload){request_trap_notice("Trap power could not be calculated.");return;}
    }
    TrapPlace p={.battle_key=trap_world.battle_key,.action=++trap_event,.actor=owner,.damage=(uint16_t)payload,
        .team=(byte)side,.alive=1,.surface_flags=31,.tile=tile};
    int ready=traps_can_place(&trap_world,&p);
    if(ready!=TRAP_OK){
        request_trap_notice(ready==TRAP_FULL?"The battle limit of 24 armed traps has been reached.":
            "A trap could not be placed on that square.");return;
    }
    if(!equipment_action_mark(job))return;
    int result=traps_place_paid(&trap_world,&p,NULL,NULL);
    if(result==TRAP_OK && side==1)trap_play_burst(tile,114,0);
    if(result!=TRAP_OK)equipment_forget_action(job);
    if(result==TRAP_OK && side==1){char message[80];snprintf(message,sizeof(message),"Trap placed: %u damage.",payload);request_trap_notice(message);}
    else request_trap_notice(result==TRAP_OK?"Enemy test trap placed. Use Detect to reveal it.":"Trap placement failed.");
    log_line("Rouges Reborn: trap placement side=%u tile=%d,%d height=%d result=%d armed-total=%u",side,tile.x,tile.y,height,result,traps_count(&trap_world));
    if(result==TRAP_OK)log_line("Rouges Reborn: trap power=%u effective-level=%u derived-DEX=%u scaled=%d",payload,level,dex,trap_scaled_damage);
    trap_refresh_marker();
}
static int trap_apply_damage(void *context,const TrapHit *hit){
    byte *target=context;void *battle=pointer(target,0x728);
    if(trap_live_actor(battle,target)<0 || !word(target,0x148))return 0;
    void *source=unit_by_id(battle,hit->armed.owner);byte result[16]={0};
    trap_native_damage(target,result,hit->armed.damage,source);
    trap_native_damage_notice(result,1);
    trap_play_burst(hit->armed.tile,113,hit->armed.owner_team==2?2:1);
    log_line("Rouges Reborn: trap triggered actor=%u damage=%u HP=%u",hit->move.actor,hit->armed.damage,word(target,0x148));return 1;
}
static void hook_trap_step(void *perform,void *unit){
    void *battle=trap_native_battle();int index=trap_live_actor(battle,unit);
    TrapTile from={(int16_t)word(unit,0x14),(int16_t)word(unit,0x16),0,0};
    original_trap_step(perform,unit);
    if(index<0 || !trap_ensure_world(battle))return;
    TrapPending *p=trap_pending+index;memset(p,0,sizeof(*p));
    byte *u=unit,*path=pointer(unit,0x310);unsigned step=u[0x319];
    if(!path || step>=u[0x318] || u[0x37c]!=1 || path[6*step+4] || path[6*step+5])return;
    TrapTile to={(int16_t)word(path,6*step),(int16_t)word(path,6*step+2),0,0};
    if(from.x<0 || from.y<0 || from.x>=trap_world.width || from.y>=trap_world.height ||
       to.x<0 || to.y<0 || to.x>=trap_world.width || to.y>=trap_world.height)return;
    int from_height=trap_native_floor(from.x,from.y),to_height=trap_native_floor(to.x,to.y);
    if(from_height<0 || from_height>255 || to_height<0 || to_height>255)return;
    from.height=(int16_t)from_height;to.height=(int16_t)to_height;
    p->valid=1;p->path=(uintptr_t)path;p->index=(byte)step;
    p->move=(TrapMove){.battle_key=trap_world.battle_key,.event=++trap_event,.actor=word(unit,0x12),.team=u[0x188],
        .alive=word(unit,0x148)>0,.committed=1,.mode=TRAP_MOVE_WALK,.from=from,.to=to};
}
static byte hook_trap_progress(void *perform,byte substate,void *unit){
    byte result=original_trap_progress(perform,substate,unit);
    if(!result || !traps_enabled)return result;
    int index=trap_live_actor(trap_native_battle(),unit);if(index<0)return result;
    TrapPending *p=trap_pending+index;byte *u=unit;
    if(p->valid && p->path==(uintptr_t)pointer(unit,0x310) && p->index==u[0x319]){
        p->valid=0;p->move.alive=word(unit,0x148)>0;p->move.team=u[0x188];TrapSetHit hit;
        if(traps_query_hit(&trap_world,&p->move,&hit) && traps_commit_hit(&trap_world,&hit,trap_apply_damage,unit)){
            /* Preserve a living unit's original route. A lethal hit must
             * complete this step without walking the rest of the path. */
            if(!word(unit,0x148))u[0x318]=(byte)(u[0x319]+1);
            trap_refresh_marker();
        }
    }
    return result;
}
static void hook_trap_idle(void *perform,void *unit){
    original_trap_idle(perform,unit);
    if(traps_enabled && trap_live_actor(trap_native_battle(),unit)>=0)trap_refresh_marker();
}
/* Native cardinal ground-edge mask: bits 0..3 = east,south,west,north.
 * Restrict enemy knowledge only. A hidden player trap returns native bits
 * byte-for-byte. This covers route edges rather than only final destinations. */
static int hook_trap_edges(void *context,uint32_t xy,int height,int destination){
    int result=original_trap_edges(context,xy,height,destination);
    byte *actor=context?pointer(context,0x18):NULL;
    if(!traps_enabled || !actor || actor[0x188]!=2 || !traps_known_count(&trap_world,2))return result;
    void *battle=trap_native_battle();
    if(!battle || !pointer(context,0) || actor[0x2fc]>=30)return result;
    byte *live=pointer(battle,0x1b48);if(!live || word(live+actor[0x2fc]*0x7d0,0x12)!=word(actor,0x12))return result;
    int x=(int16_t)xy,y=(int16_t)(xy>>16);
    static const int dx[4]={1,0,-1,0},dy[4]={0,1,0,-1};
    for(unsigned d=0;d<4;++d){
        int tx=x+dx[d],ty=y+dy[d];
        if(tx<0 || ty<0 || tx>=trap_world.width || ty>=trap_world.height)continue;
        TrapTile to={(int16_t)tx,(int16_t)ty,(int16_t)trap_native_floor(tx,ty),0};
        if(traps_avoid(&trap_world,2,to))result&=~(1<<d);
    }
    return result;
}
#include "trap_floor_marker.h"
static void trap_bind_native(void){
    trap_floor_bind();
    trap_native_manager=base+0xd6ab80;trap_native_battle=trap_active_battle;
    trap_native_width=(TrapDimensionFn)(base+0x2dc3a0);trap_native_height=(TrapDimensionFn)(base+0x2dc3b0);
    trap_native_floor=(TrapHeightFn)(base+0x2dc3e0);trap_native_object=(TrapObjectFn)(base+0x361c40);
    trap_native_damage=(TrapDamageFn)(base+0x341eb0);trap_native_damage_notice=(TrapDamageNoticeFn)(base+0x33d770);
    trap_fx_create=(TrapFxCreateFn)(base+0x3124d0);trap_fx_params=(TrapFxParamsFn)(base+0x311690);
    trap_fx_start=(TrapFxStartFn)(base+0x312540);trap_fx_position=(TrapFxPositionFn)(base+0x312a30);
    trap_fx_done=(TrapFxStateFn)(base+0x312330);trap_fx_release=(TrapFxReleaseFn)(base+0x311780);
    trap_fx_signal=(TrapFxSignalFn)(base+0x312ae0);
    trap_native_position=(TrapPositionFn)(base+0x2dc4a0);
}
#endif


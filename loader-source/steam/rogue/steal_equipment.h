#ifndef STEAL_EQUIPMENT_H
#define STEAL_EQUIPMENT_H

/* Native bindings are fingerprinted by the builder and again before hooking.
 * Unit +138 embeds 1B8 bytes of character data. Character +54 is seven u16
 * equipment IDs, followed by seven per-slot bytes and seven flag bytes.
 * This complete character block already belongs to native history/suspend. */
#define STEAL_CHARACTER_SIZE 0x1b8u
#define STEAL_GEAR_OFFSET 0x18cu
#include "equipment_bank.h"
#define STEAL_ARMAMENT_COUNT (EQUIPMENT_FIRST + EQUIPMENT_COUNT)
static int added_armament(uint16_t item) {
    return item >= EQUIPMENT_FIRST && item < STEAL_ARMAMENT_COUNT;
}
typedef void *(*ArmsManagerFn)(void);
typedef const byte *(*ArmsRowFn)(void *,uint16_t);
typedef void (*SetGearFn)(void *,unsigned,uint16_t);
typedef void (*RefreshGearFn)(void *);
typedef int (*DropGearFn)(void *,const void *,void *,uint32_t *);
typedef void *(*ActionDestroyFn)(void *,unsigned);
typedef const void *(*EncounterRowFn)(void *);
typedef uint16_t (*EffectiveLevelFn)(void *);
typedef const byte *(*CommodityRowFn)(uint16_t);
static ArmsManagerFn arms_manager;
static ArmsRowFn arms_row;
static SetGearFn set_gear;
static RefreshGearFn refresh_gear;
static DropGearFn original_drop_gear;
static ActionDestroyFn original_action_destroy;
static EncounterRowFn encounter_row;
static EffectiveLevelFn effective_level;
static CommodityRowFn commodity_row;
static int equipment_theft_enabled;
static void *equipment_actions[64];

static void equipment_forget_action(void *job) {
    for(unsigned i=0;i<64;++i)if(equipment_actions[i]==job)equipment_actions[i]=NULL;
}
static void *hook_action_destroy(void *job,unsigned flags) {
    EnterCriticalSection(&lock);equipment_forget_action(job);LeaveCriticalSection(&lock);
    return original_action_destroy(job,flags);
}
static int equipment_action_seen(void *job) {
    for(unsigned i=0;i<64;++i)if(equipment_actions[i]==job)return 1;
    return 0;
}
static int equipment_action_mark(void *job) {
    if(!job)return 0;
    for(unsigned i=0;i<64;++i)if(!equipment_actions[i]){equipment_actions[i]=job;return 1;}
    return 0; /* Never evict an active action and accidentally award it twice. */
}
static const byte *equipment_definition(uint16_t item) {
    if(!item || item>=STEAL_ARMAMENT_COUNT || !arms_manager || !arms_row)return NULL;
    return arms_row(arms_manager(),item);
}
static int equipment_tier(uint16_t item) {
    const byte *row=equipment_definition(item);
    if(!row || row[0x51])return 0; /* Key items and non-equipment are not a reward. */
    if(row[2]>=22 && row[2]<=29)return 1; /* Shields, armor, jewellery. */
    if(row[2]>=1 && row[2]<=21)return 2; /* Weapons; excludes innate attacks. */
    return 0;
}
static int equipment_matches(uint16_t item,int role) {
    const byte *row=equipment_definition(item);
    if(!equipment_tier(item) || !row)return 0;
    if(role==THEFT_GENERAL)return 1;
    if(role==THEFT_WEAPON)return row[2]>=1 && row[2]<=21;
    static const byte category[]={0,0,24,22,23,25,27,29};
    return role>=THEFT_ARMOR && role<=THEFT_ACCESSORY && row[2]==category[role];
}
static int equipment_room(void *inventory,uint16_t item) {
    const byte *row=equipment_definition(item);
    if (!row) return 0;
    int count = added_armament(item) ? equipment_inventory_count(inventory,item)
                                     : word(inventory,item*2u);
    return count >= 0 && count < (row[0x50] ? 1 : 999);
}
static unsigned equipment_candidates_for(const void *target,void *inventory,unsigned slots[7],int role) {
    unsigned tier=0,count=0;
    if(!theft_role_enabled(role))return 0;
    if(role!=THEFT_GENERAL || steal_mode!=STEAL_MODE_WEAPON_LAST){
        for(unsigned slot=0;slot<7;++slot){uint16_t item=word(target,STEAL_GEAR_OFFSET+slot*2u);
            if(equipment_matches(item,role) && equipment_room(inventory,item))slots[count++]=slot;
        }
        return count;
    }
    for(unsigned slot=0;slot<7;++slot){
        int candidate=equipment_tier(word(target,STEAL_GEAR_OFFSET+slot*2u));
        if(candidate && (!tier || (unsigned)candidate<tier))tier=(unsigned)candidate;
    }
    /* Capacity does not promote a weapon while stealable armor remains. */
    for(unsigned slot=0;slot<7 && tier;++slot){
        uint16_t item=word(target,STEAL_GEAR_OFFSET+slot*2u);
        if((unsigned)equipment_tier(item)==tier && equipment_room(inventory,item))slots[count++]=slot;
    }
    return count;
}
static inline unsigned equipment_candidates(const void *target,void *inventory,unsigned slots[7]) {
    return equipment_candidates_for(target,inventory,slots,THEFT_GENERAL);
}
static uint32_t equipment_random(uint32_t *rng) {
    *rng=*rng*1664525u+1013904223u;return *rng;
}
static unsigned equipment_draw(uint32_t *rng,unsigned count) {
    /* Rejection sampling avoids modulo bias. State advances only on a commit. */
    uint32_t threshold=(uint32_t)(0u-count)%count,value;
    do value=equipment_random(rng);while(value<threshold);
    return value%count;
}
enum { EQUIPMENT_NOTHING=0,EQUIPMENT_ADDED=1,EQUIPMENT_REJECTED=2,EQUIPMENT_DUPLICATE=3 };
static int equipment_commit_for(void *job,void *target,void *inventory,uint16_t *stolen,unsigned *selected,int role) {
    unsigned slots[7],count;
    if(!job || !set_gear || !refresh_gear || !add_item)return EQUIPMENT_REJECTED;
    if(equipment_action_seen(job))return EQUIPMENT_DUPLICATE;
    count=equipment_candidates_for(target,inventory,slots,role);
    if(!count)return EQUIPMENT_NOTHING;
    uint32_t next_rng=state.rng;
    unsigned slot=slots[equipment_draw(&next_rng,count)];
    uint16_t item=word(target,STEAL_GEAR_OFFSET+slot*2u);
    byte prepared[STEAL_CHARACTER_SIZE];
    memcpy(prepared,(byte*)target+0x138,sizeof(prepared));
    set_gear(prepared,slot,0);
    refresh_gear(prepared);
    if(word(prepared,0x54+slot*2u)!=0)return EQUIPMENT_REJECTED;
    if(!equipment_action_mark(job))return EQUIPMENT_REJECTED;
    if (added_armament(item)) {
        if (!equipment_try_award_added(inventory,item,1)) {
            equipment_forget_action(job);return EQUIPMENT_REJECTED;
        }
    } else {
        uint16_t before=word(inventory,item*2u);
        byte result[2]={0};add_item(inventory,result,item);
        uint16_t after=word(inventory,item*2u);
        if(!result[0] || after!=(unsigned)before+1u){
            /* The fingerprinted award routine only changes this item's counter. */
            memcpy((byte*)inventory+item*2u,&before,2);
            equipment_forget_action(job);return EQUIPMENT_REJECTED;
        }
    }
    /* No native callbacks or fallible operations between award and removal. */
    memcpy((byte*)target+0x138,prepared,sizeof(prepared));
    state.rng=next_rng;
    *stolen=item;*selected=slot;
    return EQUIPMENT_ADDED;
}
static int equipment_commit(void *job,void *target,void *inventory,uint16_t *stolen,unsigned *selected) {
    return equipment_commit_for(job,target,inventory,stolen,selected,THEFT_GENERAL);
}
static int hook_drop_gear(void *manager,const void *entry,void *unit,uint32_t *rng) {
    if(!equipment_theft_enabled || !entry || !unit)return original_drop_gear(manager,entry,unit,rng);
    int actor=(signed char)*((byte*)unit+0x2fc);
    EnterCriticalSection(&lock);
    int robbed=actor>=0 && actor<30 && (state.mask&(1u<<(unsigned)actor));
    unsigned looted=actor>=0 && actor<30?state.loot[actor]:0;
    LeaveCriticalSection(&lock);
    if(!robbed && !looted)return original_drop_gear(manager,entry,unit,rng);
    byte copy[196];memcpy(copy,entry,sizeof(copy));
    unsigned removed=0;
    for(unsigned slot=0;slot<7;++slot){
        unsigned offset=0x4a+slot*4u;
        if(robbed && word(copy,offset) && !word(unit,STEAL_GEAR_OFFSET+slot*2u)){
            copy[offset+2]=0; /* Explicit gear ID remains nonzero: no auto fallback. */
            ++removed;
        }
    }
    for(unsigned slot=0;slot<4;++slot)if(looted&(1u<<slot)){
        copy[0x76+slot*4u+2]=0;copy[0x76+slot*4u+3]=0;
    }
    if(removed)log_line("Equipment theft: suppressing %u empty-slot equipment death-drop chances for actor %d",removed,actor);
    return original_drop_gear(manager,copy,unit,rng);
}
#endif

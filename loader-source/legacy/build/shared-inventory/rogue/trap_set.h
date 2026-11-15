#ifndef ROUGES_TRAP_SET_H
#define ROUGES_TRAP_SET_H
#include "trap_core.h"
#define TRAP_CAPACITY 24u
#define TRAP_SET_WIRE_SIZE 210u
enum { TRAP_FULL=5 };
typedef struct {
    TrapWorld slots[TRAP_CAPACITY];
    uint64_t battle_key,placement_action,last_move;
    uint32_t generation;
    uint16_t last_actor;
    uint8_t width,height,require_tarot,busy;
} TrapSet;
typedef struct { unsigned slot;TrapHit hit; } TrapSetHit;
static inline int traps_begin(TrapSet *s,uint64_t key,unsigned width,unsigned height,unsigned tarot){
    if(!s || width>32 || height>32 || tarot>1)return 0;
    TrapWorld w;if(!trap_begin(&w,key,width,height) || !trap_set_tarot_rule(&w,tarot))return 0;
    memset(s,0,sizeof(*s));s->battle_key=key;s->width=(uint8_t)width;s->height=(uint8_t)height;s->require_tarot=(uint8_t)tarot;
    for(unsigned i=0;i<TRAP_CAPACITY;++i)s->slots[i]=w;
    return 1;
}
static inline unsigned traps_count(const TrapSet *s){
    unsigned n=0;for(unsigned i=0;i<TRAP_CAPACITY;++i)n+=s->slots[i].active!=0;return n;
}
static inline unsigned traps_known_count(const TrapSet *s,unsigned side){
    unsigned n=0;for(unsigned i=0;i<TRAP_CAPACITY;++i)n+=trap_known(s->slots+i,side)!=0;return n;
}
static inline int traps_find(const TrapSet *s,TrapTile tile){
    for(unsigned i=0;i<TRAP_CAPACITY;++i)if(s->slots[i].active && trap_tile_equal(s->slots[i].tile,tile))return (int)i;
    return -1;
}
static inline int traps_can_place(const TrapSet *s,const TrapPlace *p){
    if(!s || !p || s->generation>=UINT32_MAX-2*TRAP_CAPACITY || p->tile.surface || p->tile.height<0 || p->tile.height>255)return TRAP_INVALID;
    if(s->busy)return TRAP_BUSY;
    if(p->action==s->placement_action)return TRAP_DUPLICATE;
    if(traps_find(s,p->tile)>=0)return TRAP_OCCUPIED;
    unsigned free_slot=TRAP_CAPACITY;
    for(unsigned i=0;i<TRAP_CAPACITY;++i)if(!s->slots[i].active){free_slot=i;break;}
    if(free_slot==TRAP_CAPACITY)return TRAP_FULL;
    TrapWorld candidate=s->slots[free_slot];candidate.placement_action=s->placement_action;candidate.generation=s->generation;
    return trap_can_place(&candidate,p);
}
static inline int traps_place_paid(TrapSet *s,const TrapPlace *p,TrapPayment pay,void *context){
    int result=traps_can_place(s,p);if(result!=TRAP_OK)return result;
    unsigned i=0;while(s->slots[i].active)++i;
    s->busy=1;
    TrapWorld candidate=s->slots[i];candidate.placement_action=s->placement_action;candidate.generation=s->generation;
    result=trap_place_paid(&candidate,p,pay,context);
    if(result==TRAP_OK){s->slots[i]=candidate;s->generation=candidate.generation;s->placement_action=p->action;}
    s->busy=0;return result;
}
static inline int traps_query_hit(const TrapSet *s,const TrapMove *move,TrapSetHit *out){
    if(!s || !move || s->busy || (move->event==s->last_move && move->actor==s->last_actor))return 0;
    for(unsigned i=0;i<TRAP_CAPACITY;++i){TrapHit hit;if(trap_query_hit(s->slots+i,move,&hit)){
        if(out){out->slot=i;out->hit=hit;}return 1;
    }}return 0;
}
static inline int traps_commit_hit(TrapSet *s,const TrapSetHit *hit,TrapDamage apply,void *context){
    if(!s || !hit || hit->slot>=TRAP_CAPACITY || s->busy ||
       (hit->hit.move.event==s->last_move && hit->hit.move.actor==s->last_actor))return 0;
    s->busy=1;int ok=trap_commit_hit(s->slots+hit->slot,&hit->hit,apply,context);s->busy=0;
    if(ok){s->last_move=hit->hit.move.event;s->last_actor=hit->hit.move.actor;}return ok;
}
static inline unsigned traps_detect(TrapSet *s,unsigned side,TrapTile center,unsigned radius){
    if(!s || s->busy)return 0;
    unsigned count=0;for(unsigned i=0;i<TRAP_CAPACITY;++i)count+=(unsigned)trap_detect(s->slots+i,side,center,radius);return count;
}
static inline int traps_disarm(TrapSet *s,unsigned side,TrapTile tile){
    if(!s || s->busy)return 0;int i=traps_find(s,tile);
    /* A committed, explicitly selected square can disarm an unknown trap.
     * Knowledge still controls markers/AI; guessing does not reveal other tiles. */
    return trap_side_bit(side) && i>=0 && trap_remove(s->slots+i,s->slots[i].generation);
}
static inline int traps_avoid(const TrapSet *s,unsigned side,TrapTile tile){
    int i=traps_find(s,tile);return i>=0 && trap_known(s->slots+i,side);
}
/* The channel is seven proven reader-ignored bytes per native actor, 30
 * actors. Each active record packs a ground tile, ownership, discovery,
 * payload and optional card. No native character field is repurposed. */
static inline int traps_encode(const TrapSet *s,uint8_t out[TRAP_SET_WIRE_SIZE]){
    if(!s || !out || s->busy || !s->battle_key || !s->width || !s->height || s->width>32 || s->height>32 || s->require_tarot>1 ||
       s->generation>UINT32_MAX-2*TRAP_CAPACITY || s->last_actor>=0x8000 || (!s->last_move && s->last_actor))return 0;
    uint8_t wire[TRAP_SET_WIRE_SIZE]={0};memcpy(wire,"TRPS",4);wire[4]=1;wire[5]=s->require_tarot;wire[6]=s->width;wire[7]=s->height;
    trap_put(wire+8,s->battle_key,8);trap_put(wire+16,s->generation,4);trap_put(wire+20,s->placement_action,8);
    trap_put(wire+28,s->last_move,8);trap_put(wire+36,s->last_actor,2);
    for(unsigned i=0;i<TRAP_CAPACITY;++i){const TrapWorld *w=s->slots+i;if(w->busy)return 0;if(!w->active)continue;
        if(w->battle_key!=s->battle_key || w->width!=s->width || w->height!=s->height || w->require_tarot!=s->require_tarot ||
           !trap_inside(w,w->tile) || w->tile.height<0 || w->tile.height>255 || w->tile.surface || w->owner>=0x8000 ||
           !trap_side_bit(w->owner_team) || w->known>3 || !(w->known&trap_side_bit(w->owner_team)) || !w->damage || w->damage>9999 ||
           !w->generation || w->generation>s->generation || !w->placement_action || !s->placement_action ||
           (s->require_tarot?!trap_card_valid(w->card):w->card!=0))return 0;
        for(unsigned j=0;j<i;++j)if(s->slots[j].active && trap_tile_equal(w->tile,s->slots[j].tile))return 0;
        uint64_t v=(uint64_t)(uint16_t)w->tile.x | (uint64_t)(uint16_t)w->tile.y<<5 | (uint64_t)(uint16_t)w->tile.height<<10 |
            (uint64_t)w->owner<<18 | (uint64_t)(w->owner_team-1u)<<33 | (uint64_t)w->known<<34 | UINT64_C(1)<<36 |
            (uint64_t)(w->card?w->card-1100u:0u)<<37 | (uint64_t)w->damage<<42;
        trap_put(wire+38+7*i,v,7);
    }
    trap_put(wire+206,trap_crc(wire,206),4);memcpy(out,wire,sizeof(wire));return 1;
}
static inline int traps_decode(TrapSet *out,const uint8_t data[TRAP_SET_WIRE_SIZE],uint64_t key,unsigned width,unsigned height,unsigned tarot){
    if(!out || !data || memcmp(data,"TRPS",4) || data[4]!=1 || data[5]!=tarot || data[6]!=width || data[7]!=height ||
       trap_get(data+8,8)!=key || trap_get(data+206,4)!=trap_crc(data,206))return 0;
    TrapSet s;if(!traps_begin(&s,key,width,height,tarot))return 0;
    s.generation=(uint32_t)trap_get(data+16,4);s.placement_action=trap_get(data+20,8);
    s.last_move=trap_get(data+28,8);s.last_actor=(uint16_t)trap_get(data+36,2);
    if(s.generation>UINT32_MAX-2*TRAP_CAPACITY || s.last_actor>=0x8000 || (!s.last_move && s.last_actor))return 0;
    /* Fresh generations invalidate pre-load hit plans; snapshots keep full
     * in-memory generations and pending native steps are cleared on restore. */
    uint32_t generation=s.generation;
    for(unsigned i=0;i<TRAP_CAPACITY;++i){uint64_t v=trap_get(data+38+7*i,7);TrapWorld *w=s.slots+i;
        if(!(v&(UINT64_C(1)<<36))){if(v)return 0;continue;}
        w->active=1;w->tile=(TrapTile){(int16_t)(v&31),(int16_t)((v>>5)&31),(int16_t)((v>>10)&255),0};
        w->owner=(uint16_t)((v>>18)&32767);w->owner_team=(uint8_t)(1+((v>>33)&1));w->known=(uint8_t)((v>>34)&3);
        unsigned card=(unsigned)((v>>37)&31);w->card=(uint16_t)(card?1100+card:0);w->damage=(uint16_t)(v>>42);
        w->placement_action=s.placement_action;w->generation=++generation;
        if(!s.generation || !s.placement_action || !trap_inside(w,w->tile) || !(w->known&trap_side_bit(w->owner_team)) ||
           !w->damage || w->damage>9999 || card>22 || (tarot?!card:card!=0))return 0;
        for(unsigned j=0;j<i;++j)if(s.slots[j].active && trap_tile_equal(w->tile,s.slots[j].tile))return 0;
    }
    s.generation=generation;*out=s;return 1;
}
/* 009/010 used only the final two ignored bytes of each native actor. */
static inline int traps_decode_transport(TrapSet *out,const uint8_t wire[TRAP_SET_WIRE_SIZE],unsigned tarot){
    if(!out || !wire)return 0;
    if(!memcmp(wire,"TRPS",4))return traps_decode(out,wire,trap_get(wire+8,8),wire[6],wire[7],tarot);
    uint8_t old[TRAP_WIRE_SIZE];for(unsigned i=0;i<30;++i)memcpy(old+2*i,wire+7*i+5,2);
    TrapWorld w;if(!trap_decode(&w,old,trap_get(old+8,8),old[50],old[51],tarot))return 0;
    TrapSet s;if(!traps_begin(&s,w.battle_key,w.width,w.height,tarot) || w.generation>UINT32_MAX-2*TRAP_CAPACITY)return 0;
    s.generation=w.generation+1;s.placement_action=w.placement_action;s.last_move=w.last_move;s.last_actor=w.last_actor;
    if(w.active){if(w.tile.surface || w.tile.height<0 || w.tile.height>255)return 0;w.generation=s.generation;s.slots[0]=w;}
    *out=s;return 1;
}
/* Preserve traps from battles saved with the retired payment setting. */
static inline int traps_decode_without_payment(TrapSet *out,const uint8_t wire[TRAP_SET_WIRE_SIZE]){
    if(traps_decode_transport(out,wire,0))return 1;
    if(!traps_decode_transport(out,wire,1))return 0;
    out->require_tarot=0;
    for(unsigned i=0;i<TRAP_CAPACITY;++i){
        out->slots[i].require_tarot=0;
        out->slots[i].card=0;
    }
    return 1;
}
#endif

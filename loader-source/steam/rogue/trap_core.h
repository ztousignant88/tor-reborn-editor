#ifndef TRAP_CORE_H
#define TRAP_CORE_H
/* First proof: one persistent, enemy-triggered, single-use ground trap.
 * No game addresses, file writes or rendering. Host validates actual terrain
 * and commits native damage; this module owns only trap lifecycle and state. */
#include <stdint.h>
#include <string.h>
#define TRAP_WIRE_SIZE 60u
enum { TRAP_INVALID=0,TRAP_OK=1,TRAP_BUSY=2,TRAP_OCCUPIED=3,TRAP_DUPLICATE=4 };
enum { TRAP_SURFACE_VALID=1,TRAP_SURFACE_FLAT=2,TRAP_SURFACE_WALKABLE=4,
       TRAP_SURFACE_EMPTY=8,TRAP_SURFACE_IN_RANGE=16,TRAP_PLACE_REQUIRED=31 };
enum { TRAP_MOVE_WALK=1,TRAP_MOVE_FLY=2,TRAP_MOVE_TELEPORT=3 };
typedef struct { int16_t x,y,height;uint16_t surface; } TrapTile;
typedef struct {
    uint64_t battle_key,placement_action,last_move;
    uint32_t generation;
    uint16_t owner,damage,last_actor,card;
    uint8_t active,owner_team,width,height,busy,require_tarot,known;
    TrapTile tile;
} TrapWorld;
typedef struct {
    uint64_t battle_key,action;
    uint16_t actor,damage,card,card_count;
    uint8_t team,alive,surface_flags;
    TrapTile tile;
} TrapPlace;
typedef struct {
    uint64_t battle_key,event;
    uint16_t actor;
    uint8_t team,alive,committed,mode;
    TrapTile from,to;
} TrapMove;
typedef struct { TrapWorld armed;TrapMove move; } TrapHit;
typedef int (*TrapDamage)(void *,const TrapHit *);
typedef int (*TrapPayment)(void *,uint16_t,unsigned);
typedef struct { TrapTile tile;uint32_t generation;uint16_t owner; } TrapMarker;
static inline int trap_card_valid(uint16_t card){return card>=1101 && card<=1122;}
static inline int trap_tile_equal(TrapTile a,TrapTile b){
    return a.x==b.x && a.y==b.y && a.height==b.height && a.surface==b.surface;
}
static inline int trap_inside(const TrapWorld *w,TrapTile p){
    return p.x>=0 && p.y>=0 && p.x<w->width && p.y<w->height;
}
static inline int trap_begin(TrapWorld *w,uint64_t battle,unsigned width,unsigned height){
    if(!w || !battle || !width || !height || width>64 || height>64)return 0;
    memset(w,0,sizeof(*w));w->battle_key=battle;w->width=(uint8_t)width;w->height=(uint8_t)height;return 1;
}
/* Config is fixed at the battle boundary, never changed in a live transaction. */
static inline int trap_set_tarot_rule(TrapWorld *w,unsigned required){
    if(!w || w->busy || w->active || w->generation || required>1)return 0;
    w->require_tarot=(uint8_t)required;return 1;
}
static inline unsigned trap_side_bit(unsigned team){return team==1?1u:team==2?2u:0u;}
/* Only the owning side knows initially. Detect shares discovery with its side.
 * UI and AI must use this same gate; hidden traps never alter path scores. */
static inline int trap_known(const TrapWorld *w,unsigned team){
    return w && w->active && (w->known&trap_side_bit(team))!=0;
}
static inline int trap_marker_for(const TrapWorld *w,unsigned viewer_team,TrapMarker *out){
    if(!trap_known(w,viewer_team))return 0;
    if(out){out->tile=w->tile;out->generation=w->generation;out->owner=w->owner;}
    return 1;
}
static inline int trap_can_place(const TrapWorld *w,const TrapPlace *p){
    if(!w || !p || !p->battle_key || p->battle_key!=w->battle_key || !p->action ||
       !p->alive || !trap_side_bit(p->team) || p->actor>=0x8000 || !p->damage || p->damage>9999 ||
       !trap_inside(w,p->tile) || (p->surface_flags&TRAP_PLACE_REQUIRED)!=TRAP_PLACE_REQUIRED ||
       w->generation==UINT32_MAX ||
       (w->require_tarot && (!trap_card_valid(p->card) || !p->card_count)))return TRAP_INVALID;
    if(w->busy)return TRAP_BUSY;
    if(p->action==w->placement_action)return TRAP_DUPLICATE;
    return w->active?TRAP_OCCUPIED:TRAP_OK;
}
static inline int trap_place_paid(TrapWorld *w,const TrapPlace *p,TrapPayment pay,void *context){
    int result=trap_can_place(w,p);if(result!=TRAP_OK)return result;
    if(w->require_tarot){
        if(!pay)return TRAP_INVALID;
        w->busy=1;int paid=pay(context,p->card,1);w->busy=0;
        if(!paid)return TRAP_INVALID;
    }
    w->active=1;w->owner=p->actor;w->owner_team=p->team;w->damage=p->damage;
    w->known=(uint8_t)trap_side_bit(p->team);
    w->card=w->require_tarot?p->card:0;
    w->tile=p->tile;w->placement_action=p->action;++w->generation;return TRAP_OK;
}
static inline int trap_place(TrapWorld *w,const TrapPlace *p){
    return trap_place_paid(w,p,0,0);
}
/* A forecast never places, consumes, damages or advances any state. */
static inline int trap_query_hit(const TrapWorld *w,const TrapMove *m,TrapHit *out){
    if(!w || !m || !w->active || w->busy || !trap_side_bit(m->team) || m->team==w->owner_team ||
       !m->battle_key || m->battle_key!=w->battle_key || !m->event || !m->alive ||
       m->actor>=0x8000 || m->actor==w->owner || !m->committed || m->mode!=TRAP_MOVE_WALK ||
       trap_tile_equal(m->from,m->to) || !trap_tile_equal(w->tile,m->to) ||
       (m->event==w->last_move && m->actor==w->last_actor))return 0;
    if(out){out->armed=*w;out->move=*m;}return 1;
}
static inline void trap_clear_slot(TrapWorld *w){
    w->active=0;w->owner=0;w->owner_team=0;w->damage=0;w->card=0;w->known=0;memset(&w->tile,0,sizeof(w->tile));
}
/* Host callback must be atomic: false means native target state is unchanged.
 * Host must serialize calls. 'busy' rejects reentrant commits/captures. */
static inline int trap_commit_hit(TrapWorld *w,const TrapHit *hit,TrapDamage apply,void *context){
    TrapHit current;
    if(!hit || !apply || !trap_query_hit(w,&hit->move,&current) ||
       current.armed.generation!=hit->armed.generation ||
       current.armed.placement_action!=hit->armed.placement_action ||
       current.armed.damage!=hit->armed.damage || current.armed.owner!=hit->armed.owner)return 0;
    w->busy=1;int committed=apply(context,&current);w->busy=0;
    if(!committed)return 0;
    trap_clear_slot(w);w->last_move=hit->move.event;w->last_actor=hit->move.actor;return 1;
}
static inline int trap_remove(TrapWorld *w,uint32_t generation){
    if(!w || !w->active || w->busy || w->generation!=generation)return 0;
    trap_clear_slot(w);return 1;
}
static inline int trap_detect(TrapWorld *w,unsigned side,TrapTile center,unsigned radius){
    if(!w || !w->active || w->busy || !trap_side_bit(side) || radius>128)return 0;
    int dx=w->tile.x-center.x,dy=w->tile.y-center.y;
    unsigned distance=(unsigned)(dx<0?-dx:dx)+(unsigned)(dy<0?-dy:dy);
    if(distance>radius || trap_known(w,side))return 0;
    w->known|=(uint8_t)trap_side_bit(side);return 1;
}
static inline int trap_disarm(TrapWorld *w,unsigned side,TrapTile tile,uint32_t generation){
    return trap_known(w,side) && trap_tile_equal(w->tile,tile) && trap_remove(w,generation);
}
static inline int trap_avoid(const TrapWorld *w,unsigned side,TrapTile tile){
    return trap_known(w,side) && trap_tile_equal(w->tile,tile);
}
static inline int trap_snapshot(const TrapWorld *w,TrapWorld *snapshot){
    if(!w || !snapshot || w->busy)return 0;
    *snapshot=*w;return 1;
}
static inline int trap_restore(TrapWorld *w,const TrapWorld *snapshot){
    if(!w || !snapshot || w->busy || snapshot->busy || w->battle_key!=snapshot->battle_key ||
       w->width!=snapshot->width || w->height!=snapshot->height || w->require_tarot!=snapshot->require_tarot)return 0;
    *w=*snapshot;return 1;
}
static inline void trap_put(uint8_t *p,uint64_t v,unsigned n){for(unsigned i=0;i<n;++i)p[i]=(uint8_t)(v>>(8*i));}
static inline uint64_t trap_get(const uint8_t *p,unsigned n){uint64_t v=0;for(unsigned i=0;i<n;++i)v|=(uint64_t)p[i]<<(8*i);return v;}
static inline uint32_t trap_crc(const uint8_t *data,unsigned n){
    uint32_t crc=UINT32_MAX;
    for(unsigned i=0;i<n;++i){crc^=data[i];for(unsigned b=0;b<8;++b)crc=(crc>>1)^((0u-(crc&1u))&0xedb88320u);}
    return ~crc;
}
static inline int trap_encode(const TrapWorld *w,uint8_t out[TRAP_WIRE_SIZE]){
    if(!w || !out || w->busy || !w->battle_key || !w->width || !w->height || w->width>64 || w->height>64)return 0;
    memset(out,0,TRAP_WIRE_SIZE);memcpy(out,"TRP1",4);out[4]=2;out[5]=w->active;
    out[6]=w->owner_team;out[7]=w->require_tarot;trap_put(out+8,w->battle_key,8);trap_put(out+16,w->generation,4);
    trap_put(out+20,w->placement_action,8);trap_put(out+28,w->owner,2);trap_put(out+30,w->damage,2);
    trap_put(out+32,(uint16_t)w->tile.x,2);trap_put(out+34,(uint16_t)w->tile.y,2);
    trap_put(out+36,(uint16_t)w->tile.height,2);trap_put(out+38,w->tile.surface,2);
    trap_put(out+40,w->last_move,8);trap_put(out+48,w->last_actor,2);out[50]=w->width;out[51]=w->height;
    trap_put(out+52,w->card,2);
    out[54]=w->known;
    trap_put(out+56,trap_crc(out,56),4);return 1;
}
static inline int trap_decode(TrapWorld *out,const uint8_t data[TRAP_WIRE_SIZE],uint64_t battle,unsigned width,unsigned height,unsigned require_tarot){
    if(!out || !data || memcmp(data,"TRP1",4) || data[4]!=2 || data[5]>1 || data[7]!=require_tarot ||
       require_tarot>1 || data[54]>3 || data[55] || trap_get(data+56,4)!=trap_crc(data,56))return 0;
    TrapWorld w;
    if(!trap_begin(&w,battle,width,height) || trap_get(data+8,8)!=battle || data[50]!=width || data[51]!=height)return 0;
    w.active=data[5];w.owner_team=data[6];w.require_tarot=data[7];w.card=(uint16_t)trap_get(data+52,2);w.generation=(uint32_t)trap_get(data+16,4);
    w.placement_action=trap_get(data+20,8);w.owner=(uint16_t)trap_get(data+28,2);w.damage=(uint16_t)trap_get(data+30,2);
    w.tile.x=(int16_t)(uint16_t)trap_get(data+32,2);w.tile.y=(int16_t)(uint16_t)trap_get(data+34,2);
    w.tile.height=(int16_t)(uint16_t)trap_get(data+36,2);w.tile.surface=(uint16_t)trap_get(data+38,2);
    w.last_move=trap_get(data+40,8);w.last_actor=(uint16_t)trap_get(data+48,2);
    w.known=data[54];
    if(w.last_actor>=0x8000 || (w.last_move==0 && w.last_actor!=0))return 0;
    if(w.active){
        if(!trap_side_bit(w.owner_team) || !(w.known&trap_side_bit(w.owner_team)) || w.owner>=0x8000 || !w.damage || w.damage>9999 ||
           !w.generation || !w.placement_action || !trap_inside(&w,w.tile) ||
           (w.require_tarot?!trap_card_valid(w.card):w.card!=0))return 0;
    }else if(w.owner_team || w.owner || w.damage || w.card || w.known || w.tile.x || w.tile.y || w.tile.height || w.tile.surface)return 0;
    *out=w;return 1;
}
#endif

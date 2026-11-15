#ifndef STEAL_STATE_H
#define STEAL_STATE_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>

/* Private state lives outside native actor objects. The native inventory is
 * captured/restored by the game. Each snapshot carries its matching mask here. */
#define STEAL_ACTORS 30
#define STEAL_SNAPSHOTS 128
typedef struct { uintptr_t key; uint32_t mask, rng, gold; uint8_t loot[30]; } StealSnapshot;
typedef struct {
    uint32_t mask;
    StealSnapshot snapshots[STEAL_SNAPSHOTS];
    unsigned next;
    uint32_t rng;
    uint32_t gold;
    uint8_t loot[30];
} StealState;

static void steal_reset(StealState *s) { memset(s, 0, sizeof(*s)); s->rng=0x73544541u; }
static inline uint32_t steal_snapshot_rng(const StealState *s, uintptr_t key) {
    for(unsigned i=0;i<STEAL_SNAPSHOTS;++i)
        if(key && s->snapshots[i].key==key)return s->snapshots[i].rng;
    return 0x73544541u;
}
static int steal_find_snapshot(const StealState *s, uintptr_t key, uint32_t *mask) {
    if (!key) return 0;
    for (unsigned i=0; i<STEAL_SNAPSHOTS; ++i)
        if (s->snapshots[i].key==key) { *mask=s->snapshots[i].mask; return 1; }
    return 0;
}
static uint32_t steal_snapshot_mask(const StealState *s, uintptr_t key) {
    uint32_t mask=0;
    steal_find_snapshot(s,key,&mask);
    return mask;
}
static void steal_store(StealState *s, uintptr_t key, uint32_t mask) {
    unsigned slot=STEAL_SNAPSHOTS;
    if (!key) return;
    for (unsigned i=0; i<STEAL_SNAPSHOTS; ++i) {
        if (s->snapshots[i].key==key) { slot=i; break; }
    }
    if (slot==STEAL_SNAPSHOTS) slot=s->next++ % STEAL_SNAPSHOTS;
    s->snapshots[slot].key=key;
    s->snapshots[slot].mask=mask & 0x3fffffffu;
    s->snapshots[slot].rng=s->rng;
    s->snapshots[slot].gold=s->gold;
    memcpy(s->snapshots[slot].loot,s->loot,30);
}
static inline void steal_store_full(StealState *s,uintptr_t key,uint32_t mask,uint32_t rng) {
    steal_store(s,key,mask);
    for(unsigned i=0;i<STEAL_SNAPSHOTS;++i)
        if(key && s->snapshots[i].key==key){s->snapshots[i].rng=rng;break;}
}
static inline StealSnapshot steal_progress(const StealState *s,uintptr_t key) {
    for(unsigned i=0;i<STEAL_SNAPSHOTS;++i)if(key && s->snapshots[i].key==key)return s->snapshots[i];
    StealSnapshot empty={0};empty.rng=0x73544541u;return empty;
}
static inline void steal_store_progress(StealState *s,uintptr_t key,const StealSnapshot *value) {
    steal_store_full(s,key,value->mask,value->rng);
    for(unsigned i=0;i<STEAL_SNAPSHOTS;++i)if(key && s->snapshots[i].key==key){
        s->snapshots[i].gold=value->gold;memcpy(s->snapshots[i].loot,value->loot,30);break;
    }
}
static inline void steal_restore_progress(StealState *s,const StealSnapshot *value) {
    s->mask=value->mask;s->rng=value->rng;s->gold=value->gold;memcpy(s->loot,value->loot,30);
}
typedef int (*StealAward)(void *context);
enum { STEAL_INVALID=-1, STEAL_ALREADY=0, STEAL_ADDED=1, STEAL_FULL=2 };
static int steal_commit(StealState *s, unsigned target, StealAward award, void *context) {
    if (target>=STEAL_ACTORS) return STEAL_INVALID;
    uint32_t bit=1u<<target;
    if (s->mask & bit) return STEAL_ALREADY;
    if (!award(context)) return STEAL_FULL;
    s->mask |= bit;
    return STEAL_ADDED;
}
/* One tagged bit in each of 30 independently skipped character padding bytes.
 * A partial/mixed/corrupted set is rejected instead of importing partial state.
 * Only the exact supported save version is eligible in the runtime adapter. */
static uint8_t steal_tag(unsigned actor, uint32_t mask) {
    return (uint8_t)(0xa0u | ((mask>>actor)&1u));
}
static int steal_decode_tags(const uint8_t tags[STEAL_ACTORS], uint32_t *mask) {
    uint32_t out=0;
    for (unsigned i=0;i<STEAL_ACTORS;++i) {
        if ((tags[i]&0xfeu)!=0xa0u) { *mask=0; return 0; }
        out |= (uint32_t)(tags[i]&1u)<<i;
    }
    *mask=out;
    return 1;
}
/* Equipment mode adds a rewindable mod-owned lottery state. Thirty verified
 * native padding bytes hold 180 payload bits (six per byte) plus a 0xC0 tag.
 * Payload: version magic, target mask, PRNG state, checksum, zero padding.
 * Legacy A0/A1 tags remain readable; the native game ignores these bytes. */
static inline void steal_equipment_tags(uint8_t tags[STEAL_ACTORS], uint32_t mask, uint32_t rng) {
    uint32_t words[4]={0x31514553u,mask&0x3fffffffu,rng,0};
    words[3]=words[0]^words[1]^words[2]^0x9e3779b9u;
    for(unsigned i=0;i<30;++i){
        uint8_t value=0;
        for(unsigned b=0;b<6;++b){unsigned bit=i*6+b;
            if(bit<128)value|=(uint8_t)(((words[bit/32]>>(bit%32))&1u)<<b);
        }
        tags[i]=(uint8_t)(0xc0u|value);
    }
}
static inline int steal_equipment_decode(const uint8_t tags[STEAL_ACTORS],uint32_t *mask,uint32_t *rng) {
    uint32_t words[4]={0};
    for(unsigned i=0;i<30;++i){
        if((tags[i]&0xc0u)!=0xc0u)return 0;
        for(unsigned b=0;b<6;++b){unsigned bit=i*6+b;unsigned v=(tags[i]>>b)&1u;
            if(bit<128)words[bit/32]|=v<<(bit%32);else if(v)return 0;
        }
    }
    if(words[0]!=0x31514553u || (words[1]&0xc0000000u) ||
       words[3]!=(words[0]^words[1]^words[2]^0x9e3779b9u))return 0;
    *mask=words[1];*rng=words[2];return 1;
}
/* Full 008 state fits the same thirty native padding bytes, without extending
 * native saves: magic16, 30 six-bit actor records, version4, PRNG32, CRC8. */
static inline uint8_t steal_crc8(const uint8_t *b,unsigned n) {
    uint8_t crc=0;
    for(unsigned i=0;i<n;++i){crc^=b[i];for(unsigned k=0;k<8;++k)crc=(uint8_t)((crc<<1)^((crc&0x80)?7:0));}
    return crc;
}
static inline void steal_progress_tags(uint8_t tags[30],const StealSnapshot *p) {
    memset(tags,0,30);tags[0]='S';tags[1]='T';
    for(unsigned a=0;a<30;++a){
        unsigned bits=(p->loot[a]&15u)|(((p->gold>>a)&1u)<<4)|(((p->mask>>a)&1u)<<5);
        for(unsigned k=0;k<6;++k){unsigned bit=a*6+k;tags[2+bit/8]|=(uint8_t)(((bits>>k)&1u)<<(bit%8));}
    }
    tags[24]|=0x10;memcpy(tags+25,&p->rng,4);tags[29]=steal_crc8(tags,29);
}
static inline int steal_progress_decode(const uint8_t tags[30],StealSnapshot *p) {
    memset(p,0,sizeof(*p));p->rng=0x73544541u;
    if(tags[0]!='S' || tags[1]!='T' || (tags[24]&0xf0)!=0x10 || steal_crc8(tags,29)!=tags[29])return 0;
    for(unsigned a=0;a<30;++a){
        unsigned bits=0;for(unsigned k=0;k<6;++k){unsigned bit=a*6+k;bits|=((tags[2+bit/8]>>(bit%8))&1u)<<k;}
        p->loot[a]=(uint8_t)(bits&15u);p->gold|=((bits>>4)&1u)<<a;p->mask|=((bits>>5)&1u)<<a;
    }
    memcpy(&p->rng,tags+25,4);return 1;
}
#endif

#ifndef EQUIP_RULES_H
#define EQUIP_RULES_H
#include <stdint.h>
#include <string.h>
#include "equip_aliases.h"
static uint16_t eq_word(const void *p,unsigned off){uint16_t v;memcpy(&v,(const char*)p+off,2);return v;}
static uint16_t eq_canonical_skill(uint16_t id){
    for(unsigned i=0;i<EQ_FAMILY_COUNT;i++)if(eq_aliases[i][1]==id)return eq_aliases[i][0];
    return id;
}
static uint16_t eq_variant_skill(uint16_t id){
    uint16_t base=eq_canonical_skill(id);
    for(unsigned i=0;i<EQ_FAMILY_COUNT;i++)if(eq_aliases[i][0]==base)return eq_aliases[i][1];
    return 0;
}
static int eq_is_family(uint16_t id){return eq_variant_skill(id)!=0;}
static int eq_same_family(uint16_t a,uint16_t b){return eq_is_family(a)&&eq_canonical_skill(a)==eq_canonical_skill(b);}
static int eq_has_any_ii(const void *character){
    for(unsigned i=0;i<4;i++){uint16_t id=eq_word(character,0xc0+6*i);if(eq_canonical_skill(id)!=id)return 1;}
    return 0;
}
static int eq_family_active(const void *character,uint16_t family){
    uint16_t variant=eq_variant_skill(family);if(!variant)return 0;
    for(unsigned i=0;i<4;i++)if(eq_word(character,0xc0+6*i)==variant)return 1;
    return 0;
}
static uint16_t eq_resolve_skill(const void *skills,uint16_t query){
    uint16_t variant=eq_variant_skill(query),base=eq_canonical_skill(query);if(!variant)return query;
    int ordinary=0;
    for(unsigned i=0;i<4;i++){uint16_t id=eq_word(skills,2+6*i);if(id==variant)return variant;if(id==base)ordinary=1;}
    return ordinary?base:query;
}
static int eq_preserve_initialized_progress(const void *bank,uint16_t skill){
    return bank&&eq_is_family(skill)&&((const uint8_t*)bank)[eq_canonical_skill(skill)*8]!=0;
}
static int eq_bonus(const void *character,const void *weapon){
    return character&&weapon&&eq_family_active(character,((const uint8_t*)weapon)[2]);
}
static int eq_requires_removal(const void *character,const void *weapon,int native_allowed){
    return character&&weapon&&eq_is_family(((const uint8_t*)weapon)[2])&&!native_allowed&&!eq_bonus(character,weapon);
}
#endif

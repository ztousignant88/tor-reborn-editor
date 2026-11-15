/* Bounded counterpart to the PC 1.0.2 finisher unlock scan at 0x443F50.
 * Both native callers provide four uint16_t entries, even though the
 * original scan has no write bound. Retain ascending native effect order. */
#include <stdint.h>
#include <string.h>

static uint16_t u16(const unsigned char *p){
    uint16_t value;
    memcpy(&value,p,sizeof(value));
    return value;
}

static uint32_t u32(const unsigned char *p){
    uint32_t value;
    memcpy(&value,p,sizeof(value));
    return value;
}

__declspec(dllexport) int effect_rank_unlocks(
    uint16_t *out,const unsigned char *skills,const unsigned char *effects,
    uint16_t proficiency,uint16_t weapon,int old_rank,int new_rank
){
    const uint32_t count=u32(effects+4),stride=u32(effects+12);
    const uint32_t skill_stride=u32(skills+12);
    if(!proficiency||proficiency>21||proficiency>=u32(skills+4)||
       stride!=180||(skill_stride!=102&&skill_stride!=166)||(count!=902&&count!=1030))return 0;
    unsigned type=skills[u32(skills+8)+proficiency*skill_stride+6];
    const unsigned char *rows=effects+u32(effects+8);
    int written=0;
    for(uint32_t id=1;id<count&&written<4;id++){
        const unsigned char *row=rows+id*stride;
        if(row[2]!=type)continue;
        const unsigned required_weapon=u16(row+0x7c);
        if(required_weapon&&required_weapon!=weapon)continue;
        const int rank=row[0x82];
        if(old_rank<rank&&rank<=new_rank)out[written++]=(uint16_t)id;
    }
    return written;
}

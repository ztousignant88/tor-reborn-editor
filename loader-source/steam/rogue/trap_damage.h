#ifndef TRAP_DAMAGE_H
#define TRAP_DAMAGE_H
#include <stdint.h>
/* New mod balance rule, not a reconstruction of PSP/native attack damage.
 * DEX is the derived character total, effective level includes native sync.
 * Integer arithmetic truncates the half DEX point. Store the final payload
 * at placement so gear changes/death/rewind never reroll an armed trap. */
static inline unsigned trap_scaled_payload(unsigned level,unsigned dex){
    if(!level || level>255 || dex>65535)return 0;
    uint32_t damage=4u*level+(3u*dex)/2u;
    return damage>9999u?9999u:(unsigned)damage;
}
#endif

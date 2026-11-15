#ifndef TRAP_SET_PADDING_H
#define TRAP_SET_PADDING_H
#include "trap_padding.h"
#include "trap_set.h"
/* PC 1.0.2 / native stream version 0x81000102 only:
 * character writer 32D521 skips four bytes via 19D6B0, 32D537 emits
 * one zero; reader 32D0A4 skips all five. Eight-byte world header gives
 * offsets 10D..111. Native char+118 is the actual word at 112..113;
 * never touch it. The existing trap channel remains 114..115.
 * Steal owns the entirely separate 57 byte. */
#define TRAP_SET_PAD 0x10du
static inline void traps_pad_write(uint8_t *start,const uint8_t *wire){
    memcpy(start+TRAP_SET_PAD,wire,5);memcpy(start+TRAP_UNIT_PAD,wire+5,2);
}
static inline void traps_pad_read(const uint8_t *start,uint8_t *wire){
    memcpy(wire,start+TRAP_SET_PAD,5);memcpy(wire+5,start+TRAP_UNIT_PAD,2);
}
static inline int traps_padding_store(const TrapUnitSpan *spans,unsigned count,uint32_t version,const uint8_t wire[TRAP_SET_WIRE_SIZE]){
    if(!wire || !trap_spans_valid(spans,count,version))return 0;
    for(unsigned i=0;i<count;++i)traps_pad_write(spans[i].data,wire+7*i);
    return 1;
}
static inline int traps_padding_load(const TrapUnitSpan *spans,unsigned count,uint32_t version,uint8_t wire[TRAP_SET_WIRE_SIZE]){
    if(!wire || !trap_spans_valid(spans,count,version))return 0;
    for(unsigned i=0;i<count;++i)traps_pad_read(spans[i].data,wire+7*i);
    return 1;
}
#endif

#ifndef TRAP_PADDING_H
#define TRAP_PADDING_H
/* Candidate native serializer transport. OFFLINE FIXTURES ONLY in proof 001.
 * 0x32D557 writes zero, 0x32D0C6 skips it. Fixed prefix, before variable ring.
 * Character-stream +0x10C plus eight-byte world-unit header = +0x114.
 * Never reuse Steal's separate unit-stream +0x57 byte. */
#include <stddef.h>
#include <stdint.h>
#define TRAP_NATIVE_VERSION 0x81000102u
#define TRAP_UNIT_PAD 0x114u
#define TRAP_NATIVE_UNITS 30u
typedef struct { uint8_t *data;size_t size; } TrapUnitSpan;
static inline int trap_spans_valid(const TrapUnitSpan *spans,unsigned count,uint32_t version){
    if(!spans || count!=TRAP_NATIVE_UNITS || version!=TRAP_NATIVE_VERSION)return 0;
    for(unsigned i=0;i<count;++i){
        uintptr_t start=(uintptr_t)spans[i].data;
        if(!start || spans[i].size<TRAP_UNIT_PAD+2u || spans[i].size>UINTPTR_MAX-start)return 0;
        uintptr_t end=start+spans[i].size;
        for(unsigned j=0;j<i;++j){
            uintptr_t a=(uintptr_t)spans[j].data,b=a+spans[j].size;
            if(start<b && a<end)return 0;
        }
    }
    return 1;
}
/* Validate every destination before emitting anything. Caller must supply
 * stable, complete native buffers; their lifetime has not been bound live. */
static inline int trap_padding_store(const TrapUnitSpan *spans,unsigned count,uint32_t version,const uint8_t wire[60]){
    if(!wire || !trap_spans_valid(spans,count,version))return 0;
    for(unsigned i=0;i<count;++i)if(spans[i].data[TRAP_UNIT_PAD] || spans[i].data[TRAP_UNIT_PAD+1])return 0;
    for(unsigned i=0;i<count;++i){spans[i].data[TRAP_UNIT_PAD]=wire[2*i];spans[i].data[TRAP_UNIT_PAD+1]=wire[2*i+1];}
    return 1;
}
static inline int trap_padding_load(const TrapUnitSpan *spans,unsigned count,uint32_t version,uint8_t wire[60]){
    if(!wire || !trap_spans_valid(spans,count,version))return 0;
    for(unsigned i=0;i<count;++i){wire[2*i]=spans[i].data[TRAP_UNIT_PAD];wire[2*i+1]=spans[i].data[TRAP_UNIT_PAD+1];}
    return 1;
}
#endif

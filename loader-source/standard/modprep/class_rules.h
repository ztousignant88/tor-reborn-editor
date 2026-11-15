#ifndef TOR_MODPREP_CLASS_RULES_H
#define TOR_MODPREP_CLASS_RULES_H
#include <stdint.h>

/* Equivalent to 2C60E0 after template/class lookup, for the native class menu.
   Keep the original unit restrictions, mark/unlock flags and race/sex icon
   selection. `permitted` alone comes from the supplemental matrix.
   This does not widen class IDs or the native menu's 80-entry availability
   cache. Those remain separate consumers to implement and test. */
static int mp_class_icon(unsigned class_id,unsigned class_count,const uint8_t *klass,
                                const uint8_t *templ,uint8_t unit_flags,
                                uint64_t availability,int permitted){
    if(unit_flags&0x40)return 0;
    if(class_id>=class_count||!klass[0x55]||!permitted)return -1;
    uint64_t flags=availability;
    if(klass[0x58]||(flags&(UINT64_C(1)<<36)))flags&=UINT64_C(0xffffffffffff0000);
    else flags&=UINT64_C(0xffff);
    if(!flags)return -1;
    unsigned offset=0x98;
    if(!(flags&UINT64_C(0xffffffffffff0000))){
        unsigned race=templ[0x39];
        if(!race)return -1;
        if(race==1){if(templ[3]==1)offset=0x99;}
        else offset+=race;
    }
    return klass[offset]==0xff?0:klass[offset];
}
static int mp_native_class_icon(unsigned class_id,const uint8_t *klass,const uint8_t *templ,uint8_t unit_flags,uint64_t availability,int permitted){
    return mp_class_icon(class_id,80,klass,templ,unit_flags,availability,permitted);
}
#endif

#ifndef TRAP_VISUAL_PRESETS_H
#define TRAP_VISUAL_PRESETS_H
#include <stddef.h>
typedef struct { unsigned selector,variant,event,raw_root;const char *name; } TrapVisualPreset;
static const TrapVisualPreset trap_visual_presets[]={
    {104,0,1,470,"Current marker"},
    {105,4,1,475,"Luminous Resonance"},
    {105,3,1,474,"Charged Resonance"},
    {105,7,1,478,"Shadow Resonance"},
    {113,1,1,526,"Sanctuary Shadow casting"},
    {113,2,1,527,"Rampart Shadow casting"},
    {114,0,1,532,"Booby Trap placement"},
    {114,1,1,533,"Disarm"},
    {0,0,0,0,"Hide markers"}
};
#define TRAP_VISUAL_PRESET_COUNT (sizeof(trap_visual_presets)/sizeof(trap_visual_presets[0]))
static inline int trap_visual_parse(const char *text,size_t n){
    if(!text || !n || n>16)return -1;
    size_t i=0;while(i<n && (text[i]==' ' || text[i]=='\r' || text[i]=='\n' || text[i]=='\t'))++i;
    if(i==n || text[i]<'0' || text[i]>'8')return -1;
    int result=text[i++]-'0';
    while(i<n && (text[i]==' ' || text[i]=='\r' || text[i]=='\n' || text[i]=='\t'))++i;
    return i==n?result:-1;
}
#endif

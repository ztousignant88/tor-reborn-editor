/* Experimental native Auto Battle choices. Included after runtime helpers.
 * Data companion: menu_data rows 614/615, command text IDs 7599/7600.
 * The native selection pipeline passes descriptor +0x6c directly to
 * 0x340d30; do not convert these AI IDs into menu indexes.
 */
#define ABC_METADATA_GLOBAL 0xce49a8u
#define ABC_AI_GLOBAL 0xd682c0u
typedef void (*AbcBuild)(void*,void*,unsigned short,unsigned,unsigned char);
typedef unsigned char (*AbcDisplay)(void*,void*);
typedef void (*AbcAppend)(void*,void*,const void*);
typedef const char *(*AbcIcon)(int);
static AbcDisplay abc_display[2];
static AbcBuild abc_build;
static AbcAppend abc_append;
static AbcIcon abc_icon;

static uint16_t abc_u16(const void *p){uint16_t v;memcpy(&v,p,2);return v;}
static uint32_t abc_u32(const void *p){uint32_t v;memcpy(&v,p,4);return v;}
static void abc_put16(void *p,uint16_t v){memcpy(p,&v,2);}
static unsigned char *abc_table(unsigned rva,unsigned minimum,unsigned stride){
    unsigned char *p=*(unsigned char**)(mm_base+rva);
    if(!mm_readable(p,16)||memcmp(p,"xlce",4)||abc_u32(p+4)<minimum||abc_u32(p+12)!=stride)return 0;
    unsigned offset=abc_u32(p+8);
    if(offset<16||offset>4096||!mm_readable(p+offset,(size_t)minimum*stride))return 0;
    return p+offset;
}
static unsigned char *abc_metadata(void){
    unsigned char *p=abc_table(ABC_METADATA_GLOBAL,616,24);
    /* Fail closed if another mod occupies our companion rows. */
    if(!p||abc_u16(p+614*24)!=7599||abc_u16(p+615*24)!=7600)return 0;
    return p;
}
static int abc_ready(void){return abc_metadata()!=0&&abc_table(ABC_AI_GLOBAL,115,98)!=0;}
static int abc_added(unsigned ai){return ai==113?0:ai==114?1:-1;}

static void abc_build_hook(void *popup,void *vector,unsigned short mode,unsigned count,unsigned char group){
    abc_build(popup,vector,mode,count,group);
    if(mode!=14||count!=5||group!=0||!abc_ready())return;
    unsigned char **v=(unsigned char**)vector;
    if(!mm_readable(v,24)||(uintptr_t)v[1]<(uintptr_t)v[0]||
       (uintptr_t)v[1]-(uintptr_t)v[0]!=5*128||!mm_readable(v[0],5*128))return;
    /* Copy before append: the game's vector may reallocate. */
    unsigned char rows[2][128];
    memcpy(rows[0],v[0]+3*128,128);memcpy(rows[1],v[0]+4*128,128);
    for(unsigned i=0;i<2;i++){
        abc_put16(rows[i]+0x50,(uint16_t)(614+i));
        abc_put16(rows[i]+0x6c,(uint16_t)(113+i));
        abc_append(vector,v[1],rows[i]);
    }
}
static void abc_update_icon(unsigned char *descriptor,unsigned id){
    unsigned char *meta=abc_metadata();if(!meta)return;
    const char *name=abc_icon(abc_u16(meta+id*24+2));
    if(!mm_readable(name,80))return;
    size_t n=0;while(n<79&&name[n])n++;
    memcpy(descriptor,name,n);descriptor[n]=0;
}
static unsigned char abc_display_common(void *widget,void *descriptor,unsigned which){
    unsigned char result=abc_display[which](widget,descriptor);
    if(!result||!abc_ready())return result;
    unsigned offset=which?0x468:0x4c0;
    if(!mm_readable((unsigned char*)widget+offset,8)||!mm_readable(descriptor,128))return result;
    unsigned char *unit=*(unsigned char**)((unsigned char*)widget+offset);
    if(!mm_readable(unit,0x1d9))return result;
    int index=abc_added(unit[0x1d8]);if(index<0)return result;
    /* Compact menu uses metadata; alternate menu uses direct text IDs. */
    abc_put16((unsigned char*)descriptor+0x50,(uint16_t)((which?7599:614)+index));
    abc_update_icon(descriptor,614+(unsigned)index);
    return result;
}
static unsigned char abc_display0(void *w,void *d){return abc_display_common(w,d,0);}
static unsigned char abc_display1(void *w,void *d){return abc_display_common(w,d,1);}

#ifndef ABC_UNIT_TEST
static int mm_install_ai_choices(void){
    const unsigned sites[]={0x517625,0x4db820,0x4ddf90};
    unsigned char expected[3][5]={{0xe8,0x96,0xea,0xff,0xff},
        {0x48,0x89,0x5c,0x24,0x08},
        {0x48,0x89,0x5c,0x24,0x08}};
    for(unsigned i=0;i<3;i++)if(memcmp(mm_base+sites[i],expected[i],5)){
        mm_log("AI choices: disabled; menu fingerprint mismatch.\r\n");return 0;}
    unsigned char *page=mm_near_page();if(!page){mm_log("AI choices: allocation failed.\r\n");return 0;}
    abc_build=(void*)(mm_base+0x5160c0);abc_append=(void*)(mm_base+0x3d9c20);abc_icon=(void*)(mm_base+0x2bde10);
    void *hooks[]={(void*)abc_build_hook,(void*)abc_display0,(void*)abc_display1};
    for(unsigned i=0;i<3;i++){
        mm_abs_jump(page+i*32,hooks[i]);
        if(i){unsigned char *tramp=page+128+i*32;memcpy(tramp,expected[i],5);
            mm_abs_jump(tramp+5,mm_base+sites[i]+5);abc_display[i-1]=(void*)tramp;}
    }
    FlushInstructionCache(GetCurrentProcess(),page,256);
    for(unsigned i=0;i<3;i++){
        unsigned char patch[5];patch[0]=i?0xe9:0xe8;
        int32_t delta=(int32_t)((page+i*32)-(mm_base+sites[i]+5));memcpy(patch+1,&delta,4);
        if(!mm_write(mm_base+sites[i],patch,5)){
            for(unsigned j=0;j<=i;j++)mm_write(mm_base+sites[j],expected[j],5);
            mm_log("AI choices: installation failed; all menu hooks rolled back.\r\n");return 0;
        }
    }
    mm_log("AI choices: Buff (113) / Debuff (114); companion data and AI rows required.\r\n");return 1;
}
#endif

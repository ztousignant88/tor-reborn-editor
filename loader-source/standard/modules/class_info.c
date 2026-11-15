/* Item/skill information class pages. The native 79-row scratch buffer is
   retained; a bounded 255-class catalogue is sliced into that buffer per page. */
#include "../modprep/info_pages_core.h"
#include "../modprep/info_native.h"
typedef void (*MpiPages)(void*);
static MpiPages mpi_original_pages;
static unsigned char *mpi_relay;
static int mpi_installed;

static unsigned mpi_build_stock(void *object){
    void (*native_build)(void*)=(void*)(mm_base+0x3f0290);
    native_build(object);
    if(!mm_readable(object,0xc78))return 0;
    unsigned char *p=object;
    uint16_t count=mpg_u16(p+0xa9e);
    if(count>MPI_NATIVE_ROWS)return 0;
    for(unsigned i=0;i<count;i++){
        unsigned char *row=p+0x790+i*8;
        if(row[2]!=MP_RETIRED_GIANT_CLASS)continue;
        count--;
        memmove(row,row+8,(count-i)*8);
        memset(p+0x790+count*8,0,8);
        memcpy(p+0xa9e,&count,2);
        if(i<p[0xaa1]&&p[0xaa1]!=255)p[0xaa1]--;
        break;
    }
    return count;
}
static unsigned mpi_unit_counts(const unsigned char *templates,unsigned char counts[256][2]){
    unsigned total=0;memset(counts,0,512);
    /* These are the exact army presence/record addresses and stride read by
       native3F04D0 and3EE090. No temporary battle unit/save fields are changed. */
    for(unsigned i=0;i<105;i++){
        const unsigned char *present=mm_base+0xeff078+(size_t)i*0x7e0,*unit=present+0x40;
        if(!mm_readable(present,0x90)||!*present||(unit[0x4e]&0x40))continue;
        unsigned t=mpg_u16(unit);if(t>=mpg_view.templates)continue;
        unsigned c=unit[0x49],sex=templates[(size_t)t*84+3]==1;counts[c][sex]++;total++;
    }
    return total;
}
static unsigned mpi_collect(void *object,unsigned char rows[255][8]){
    const unsigned char *classes,*templates;
    if(!mm_readable(object,0xc78)||!mpg_live_tables(&classes,&templates))return 0;
    ((unsigned char*)object)[0xaa1]=255;
    unsigned native_count=mpi_build_stock(object);
    if(mpg_u16((unsigned char*)object+0xa9e)>MPI_NATIVE_ROWS)return 0;
    unsigned char found[256]={0},counts[256][2];mpi_unit_counts(templates,counts);
    int has_templar=0;
    for(unsigned c=MP_TEMPLAR_FIRST;c<=MP_TEMPLAR_LAST;c++)
        if(mpg_templar_class(c)&&(counts[c][0]||counts[c][1])){has_templar=1;break;}
    memcpy(rows,(unsigned char*)object+0x790,(size_t)native_count*8);unsigned n=native_count;
    for(unsigned i=0;i<n;i++)found[rows[i][2]]=1;
    unsigned short (*quantity)(const void*,unsigned)=(void*)(mm_base+0x31b700);
    for(unsigned c=1;c<256;c++){
        if(found[c]||c==MP_RETIRED_GIANT_CLASS||!classes[(size_t)c*208+0x55])continue;
        /* Shared human marks reveal Templar choices once the army has a
           Templar. Ordinary starter marks alone must not fill extra pages. */
        unsigned mark=mpg_mark_only(c)&&(!mpg_templar_class(c)||has_templar)?mpg_mark(c):0;
        if(!counts[c][0]&&!counts[c][1]&&(!mark||!quantity(mm_base+0xee4380,mark)))continue;
        if(n>=255)return 0;
        unsigned char *r=rows[n++];memset(r,0,8);r[2]=(unsigned char)c;r[4]=classes[(size_t)c*208+0xa8];
        r[5]=classes[(size_t)c*208+0xc4]==1;
    }
    /* Stable version of the stock comparison: ascending class+A8 sort key. */
    for(unsigned i=1;i<n;i++){unsigned char r[8];memcpy(r,rows[i],8);unsigned j=i;while(j&&rows[j-1][4]>r[4]){memcpy(rows[j],rows[j-1],8);j--;}memcpy(rows[j],r,8);}
    return n;
}
static unsigned mpi_native_types(void *object,unsigned char out[21],unsigned count){
    unsigned char *p=object;unsigned mode=p[0xaa4],layout=mpg_u32(p+0x230)==2;
    if(!mode||mode>6||!count||count>21)return 0;
    unsigned per=layout?8:7,base=layout?0x696410:0x696250,n=0;
    int divisor=(int)mpg_u32(p+0xc74),units=(int)mpg_u32(p+0xc6c);if(divisor<=0||units<0)return 0;
    for(unsigned i=1;i<per&&n<count;i++){
        int type=(int)mpg_u32(mm_base+base+((size_t)mode*per+i)*8);if(type==-1)continue;
        if(type<0||type>6)return 0;
        if(type==4&&mpg_u16(p+0xa9e)<=mpg_u16(p+0xa9c))continue;
        out[n++]=(unsigned char)type;
        if(type==5){unsigned more=(unsigned)(units/divisor);while(more--&&n<count)out[n++]=5;}
    }
    return n==count?n:0;
}
static int mpi_blueprint(void *object,MP_InfoPlan *plan,unsigned char rows[255][8],unsigned *total){
    if(!mm_readable(object,0xc78)||!((unsigned char*)object)[0xaa4]||((unsigned char*)object)[0xaa4]>6)return 0;
    unsigned n=mpi_collect(object,rows);if(!n)return 0;
    int (*native_count)(void*)=(void*)(mm_base+0x3edf80);int old=native_count(object);unsigned char types[21];
    if(old<1||old>21||!mpi_native_types(object,types,(unsigned)old))return 0;
    unsigned capacity=mpg_u16((unsigned char*)object+0xa9c);if(capacity>79)capacity=79;
    if(!mpi_plan(plan,types,(unsigned)old,n,capacity))return 0;*total=n;return 1;
}
static int mpi_page_count(void *object){
    MP_InfoPlan plan;unsigned char rows[255][8];unsigned total;
    if(!mm_readable(object,0xc78)){int(*native)(void*)=(void*)(mm_base+0x3edf80);return native(object);}
    unsigned char *p=object,saved[79*8];memcpy(saved,p+0x790,sizeof(saved));uint16_t count=mpg_u16(p+0xa9e);unsigned char split=p[0xaa1];
    int result;if(mpi_blueprint(object,&plan,rows,&total))result=(int)plan.count;
    else{int(*native)(void*)=(void*)(mm_base+0x3edf80);result=native(object);}
    /* The same getter is also used by navigation/header rendering. It must
       not replace the currently displayed chunk while merely counting pages. */
    memcpy(p+0x790,saved,sizeof(saved));memcpy(p+0xa9e,&count,2);p[0xaa1]=split;return result;
}
static void mpi_pages(void *object){
    mpi_original_pages(object);MP_InfoPlan plan;unsigned char rows[255][8];unsigned total;
    if(!mpi_blueprint(object,&plan,rows,&total))return;
    unsigned char *p=object;memset(p+0xaa7,0,21);memcpy(p+0xaa7,plan.type,plan.count);p[0xaa6]=(unsigned char)plan.count;
    if(p[0xaa5]>=plan.count)p[0xaa5]=(unsigned char)(plan.count-1);
    if(plan.item_page>=0){int index=plan.item_page;memcpy(p+0xc70,&index,4);}
}
static void mpi_rows(void *object){
    MP_InfoPlan plan;unsigned char rows[255][8];unsigned total,start,count;
    if(!mpi_blueprint(object,&plan,rows,&total)){mpi_build_stock(object);return;}
    unsigned char *p=object;
    if(!mpi_slice(&plan,p[0xaa5],total,&start,&count))return;
    /* No original field/list offset changes, and never more than79 scratch rows. */
    memset(p+0x790,0,79*8);memcpy(p+0x790,rows+start,(size_t)count*8);uint16_t short_count=(uint16_t)count;memcpy(p+0xa9e,&short_count,2);
    p[0xaa1]=255;for(unsigned i=0;i<count;i++){
        const unsigned char *classes=*(unsigned char**)(mm_base+0xd78e78);unsigned offset=mpg_u32(classes+8);
        if(classes[offset+(size_t)rows[start+i][2]*208+0x55]==2){p[0xaa1]=(unsigned char)i;break;}
    }
}
static int mpi_style(unsigned short c){
    if(c<80&&!mpg_mark_only(c)){int(*original)(unsigned short)=(void*)(mm_base+0x48f160);return original(c);}
    const unsigned char *classes,*templates;if(c>=256||!mpg_live_tables(&classes,&templates))return 0;
    unsigned sex=classes[(size_t)c*208+0xc4];if(sex==1)return 1;if(sex==2)return 0;
    unsigned char counts[256][2];mpi_unit_counts(templates,counts);return counts[c][0]==0&&counts[c][1]!=0;
}
static int mpi_render_count(void *widget,const void *object){
    int (*native_count)(void*)=(void*)(mm_base+0x264090);
    int slots=native_count(widget);
    const unsigned char *p=object,*list;
    if(slots<=0||!mm_readable(p,0x790))return slots;
    memcpy(&list,p+0x788,sizeof(list));
    if(!mm_readable(list,0x82))return slots;
    /* The game allocates a complete last row. Draw only the cells that
       27E220 marked visible, even when the page ends partway through it. */
    int visible=mpg_u16(list+0x80);
    return slots<visible?slots:visible;
}
static int mpi_face_name(char *out,const char *format,unsigned native_icon,unsigned state){
    int (*native_format)(char*,const char*,...)=(void*)(mm_base+0x5bfc0);
    unsigned c=state&255,female=(state>>8)&1;
    if(c<80&&!mpg_mark_only(c))return native_format(out,format,native_icon,0u);
    unsigned icon=c<mpg_menu.count?mpc_u16(mpg_menu.rows+(size_t)c*8+2):65535;
    if(icon!=65535)return native_format(out,format,icon,female&&mp_has_female_pose(c));
    const unsigned char *classes,*templates;
    if(mpg_live_tables(&classes,&templates)){
        const unsigned char *row=classes+(size_t)c*208;
        icon=row[0x98+female];
        for(unsigned i=0;icon==255&&i<13;i++)icon=row[0x98+i];
        if(icon!=255)return native_format(out,format,icon,0u);
        /* The stock Templar forms are obtainable as army units on edited
           saves, but their class rows have no native menu texture IDs. */
        unsigned palette=row[0x94];
        if(c>=81&&c<=96&&mpg_u16(row+0x90)==33&&mpg_u16(row+0x92)==33&&
           ((palette>=1&&palette<=5)||palette==7))
            return native_format(out,"mp_class_face_templar%u",palette);
    }
    /* An unregistered, externally edited class can still appear in the grid. */
    return native_format(out,"%s","mp_class_face_blank");
}
static int mm_install_class_info(void){
    if(mpi_installed)return 1;if(!mpg_installed||!mpg_extended_menu)return 0;
    for(unsigned i=0;i<MP_INFO_PATCH_COUNT;i++)if(memcmp(mm_base+mp_info_sites[i].rva,mp_info_sites[i].before,mp_info_sites[i].length)){
        mm_log("Class info: native fingerprint mismatch; original pages retained.\r\n");return 0;
    }
    unsigned char *relay=mm_near_page();if(!relay)return 0;
    memcpy(relay,mp_info_sites[MP_INFO_PATCH_COUNT-1].before,8);mm_abs_jump(relay+8,mm_base+0x3f09d8);mpi_original_pages=(MpiPages)(void*)relay;
    void *targets[]={(void*)mpi_page_count,(void*)mpi_rows,(void*)mpi_render_count,(void*)mpi_style,
        (void*)mpi_face_name,(void*)mpi_page_count,(void*)mpi_pages};
    unsigned char patches[MP_INFO_PATCH_COUNT][8];
    for(unsigned i=0;i<MP_INFO_PATCH_COUNT;i++){
        unsigned char *bridge=relay+64+i*32,*code=bridge;
        if(i==MP_INFO_COUNT_PATCH){
            const unsigned char object_arg[]={0x48,0x89,0xda}; /* mov rdx,rbx */
            memcpy(code,object_arg,sizeof(object_arg));code+=sizeof(object_arg);
        }else if(i==MP_INFO_FORMAT_PATCH){
            /* Pass the class and sex state already computed by the renderer. */
            const unsigned char state_arg[]={0x45,0x89,0xf1}; /* mov r9d,r14d */
            memcpy(code,state_arg,sizeof(state_arg));code+=sizeof(state_arg);
        }
        mm_abs_jump(code,targets[i]);memset(patches[i],0x90,8);patches[i][0]=i==MP_INFO_PATCH_COUNT-1?0xe9:0xe8;
        intptr_t distance=bridge-(mm_base+mp_info_sites[i].rva+5);if(distance<INT32_MIN||distance>INT32_MAX){VirtualFree(relay,0,MEM_RELEASE);return 0;}
        int32_t relative=(int32_t)distance;memcpy(patches[i]+1,&relative,4);
    }
    FlushInstructionCache(GetCurrentProcess(),relay,64+MP_INFO_PATCH_COUNT*32);
    unsigned changed=0;for(;changed<MP_INFO_PATCH_COUNT;changed++)if(!mm_write(mm_base+mp_info_sites[changed].rva,patches[changed],mp_info_sites[changed].length))break;
    if(changed!=MP_INFO_PATCH_COUNT){
        int restored=1;for(unsigned i=0;i<MP_INFO_PATCH_COUNT;i++)if(!mm_write(mm_base+mp_info_sites[i].rva,mp_info_sites[i].before,mp_info_sites[i].length))restored=0;
        if(restored)VirtualFree(relay,0,MEM_RELEASE);else{mpi_relay=relay;mpi_installed=1;}
        mm_log(restored?"Class info: failed write restored; original pages retained.\r\n":"Class info: rollback incomplete; relay retained.\r\n");return 0;
    }
    mpi_relay=relay;mpi_installed=1;mm_log("Class info: known/marked classes1..255 use capacity-based pages; native skill/equipment checks and79-row scratch retained.\r\n");return 1;
}

/* Coordinated widget-tail relocation; native byte class IDs 1..255 only.
 * The new buffer reserves 512 rows, but this does NOT widen native class IDs.
 * All ten readers, allocation, zeroing and sized deletion change together.
 */
#include "../modprep/menu_patches.h"
#include "../modprep/icon_bridge.h"
#include "../modprep/class_art.h"
#include "../modprep/class_preview.h"
static int mpm_installed;
static uint16_t mpm_icons[256];
static unsigned char *mpm_relay;
static const unsigned char mpm_original_format[]={0xe8,0x1b,0xd7,0xb3,0xff};
static int mpm_unit_name(char *out,const char *format,unsigned icon,const void *unit){
    int (*native_format)(char*,const char*,...)=(void*)(mm_base+0x5bfc0);
    unsigned (*native_sex)(const void*)=(void*)(mm_base+0x3305e0);
    if(icon!=65535&&(icon==mpm_icons[97]||icon==mpm_icons[126])&&native_sex(unit)==1)
        format="com_class00_unit%04d_01";
    return native_format(out,format,icon);
}
static void mpm_rel32(unsigned char *at,void *target){
    intptr_t delta=(unsigned char*)target-(at+4);int32_t value=(int32_t)delta;memcpy(at,&value,4);
}
static const unsigned char mpm_original_preview[]={0xe8,0x4d,0xfc,0xff,0xff};

static void mpm_preview(unsigned char *widget)
{
    unsigned char *list;
    memcpy(&list,widget+0x238,sizeof(list));
    MP_PreviewLabels *labels=(void *)(widget+0x268);
    if (labels->first!=labels->end) {
        uint16_t count;
        if (!mm_readable(list,0x82)) return;
        memcpy(&count,list+0x80,sizeof(count));
        MP_NewPreviewLabel create=(MP_NewPreviewLabel)(mm_base+0x483f90);
        MP_InsertPreviewLabel insert=(MP_InsertPreviewLabel)(mm_base+0x26a9c0);
        if (!mp_extend_preview_labels(labels,count,create,insert)) {
            mm_log("Class menu: could not extend the preview labels.\r\n");
            return;
        }
    }
    ((void (*)(void *))(mm_base+0x51e990))(widget);
}

static int mm_install_class_menu(const uint16_t icons[256]){
    if(mpm_installed)return 1;
    const unsigned count=(unsigned)(sizeof(mp_menu_patches)/sizeof(mp_menu_patches[0]));
    for(unsigned i=0;i<count;i++)if(memcmp(mm_base+mp_menu_patches[i].rva,mp_menu_patches[i].before,mp_menu_patches[i].length)){
        mm_log("Class menu: widget/list fingerprint mismatch; no menu expansion installed.\r\n");return 0;
    }
    if(memcmp(mm_base+0x51e709,mp_menu_loop_before,sizeof(mp_menu_loop_before))){mm_log("Class menu: loop fingerprint mismatch; no menu expansion installed.\r\n");return 0;}
    const unsigned char original_icon[]={0x44,0x0f,0xb6,0x43,0xff};
    if(!icons||memcmp(mm_base+0x51e88f,original_icon,5)||memcmp(mm_base+0x51e8a0,mpm_original_format,5)||memcmp(mm_base+0x51ed3e,mpm_original_preview,5)){
        mm_log("Class menu: icon fingerprint/data mismatch; no menu expansion installed.\r\n");return 0;
    }
    unsigned char *relay=mm_near_page();if(!relay)return 0;
    /* cmp esi,256; jl original loop; jmp original exit. No registers change. */
    const unsigned char code[]={0x81,0xfe,0,1,0,0,0x0f,0x8c,0,0,0,0,0xe9,0,0,0,0};
    memcpy(relay,code,sizeof(code));mpm_rel32(relay+8,mm_base+0x51e680);mpm_rel32(relay+13,mm_base+0x51e712);
    memcpy(mpm_icons,icons,sizeof(mpm_icons));memcpy(relay+64,mp_icon_template,sizeof(mp_icon_template));
    void *table=mpm_icons,*resume=mm_base+0x51e894;
    memcpy(relay+64+MP_ICON_TABLE_OPERAND,&table,8);memcpy(relay+64+MP_ICON_RESUME_OPERAND,&resume,8);
    /* Fourth formatter argument is the same unit used to build this list. */
    const unsigned char unit_arg[]={0x4c,0x8d,0x8f,0x40,0x05,0,0}; /* lea r9,[rdi+540h] */
    memcpy(relay+128,unit_arg,sizeof(unit_arg));mm_abs_jump(relay+128+sizeof(unit_arg),(void*)mpm_unit_name);
    intptr_t distance=relay-(mm_base+0x51e70e);
    if(distance<INT32_MIN||distance>INT32_MAX){VirtualFree(relay,0,MEM_RELEASE);return 0;}
    unsigned char patch[sizeof(mp_menu_loop_before)];memset(patch,0x90,sizeof(patch));patch[0]=0xe9;
    int32_t relative=(int32_t)distance;memcpy(patch+1,&relative,4);
    unsigned char icon_patch[5]={0xe9};int32_t icon_delta=(int32_t)((relay+64)-(mm_base+0x51e894));memcpy(icon_patch+1,&icon_delta,4);
    unsigned char format_patch[5]={0xe8};int32_t format_delta=(int32_t)((relay+128)-(mm_base+0x51e8a5));memcpy(format_patch+1,&format_delta,4);
    mm_abs_jump(relay+160,(void *)mpm_preview);
    unsigned char preview_patch[5]={0xe8};
    int32_t preview_delta=(int32_t)((relay+160)-(mm_base+0x51ed43));
    memcpy(preview_patch+1,&preview_delta,4);
    FlushInstructionCache(GetCurrentProcess(),relay,174);unsigned changed=0;
    for(;changed<count;changed++)if(!mm_write(mm_base+mp_menu_patches[changed].rva,mp_menu_patches[changed].after,mp_menu_patches[changed].length))break;
    int loop_ok=changed==count&&mm_write(mm_base+0x51e709,patch,sizeof(patch))&&mm_write(mm_base+0x51e88f,icon_patch,5)&&mm_write(mm_base+0x51e8a0,format_patch,5)&&mm_write(mm_base+0x51ed3e,preview_patch,5);
    if(!loop_ok){
        int restored=mm_write(mm_base+0x51e709,mp_menu_loop_before,sizeof(mp_menu_loop_before));
        if(!mm_write(mm_base+0x51e88f,original_icon,5))restored=0;
        if(!mm_write(mm_base+0x51e8a0,mpm_original_format,5))restored=0;
        if(!mm_write(mm_base+0x51ed3e,mpm_original_preview,5))restored=0;
        for(unsigned i=0;i<count;i++)if(!mm_write(mm_base+mp_menu_patches[i].rva,mp_menu_patches[i].before,mp_menu_patches[i].length))restored=0;
        if(restored)VirtualFree(relay,0,MEM_RELEASE);
        mm_log(restored?"Class menu: failed write; all menu edits restored.\r\n":"Class menu: rollback incomplete; relay retained.\r\n");return 0;
    }
    mpm_relay=relay;mpm_installed=1;mm_log("Class menu: list moved to owned widget tail; 512-row storage; candidates 1..255. Class identity remains native byte width.\r\n");return 1;
}
static int mm_restore_class_menu(void){
    if(!mpm_installed)return 1;int okay=1;
    const unsigned char original_icon[]={0x44,0x0f,0xb6,0x43,0xff};
    if(!mm_write(mm_base+0x51e709,mp_menu_loop_before,sizeof(mp_menu_loop_before)))okay=0;
    if(!mm_write(mm_base+0x51e88f,original_icon,5))okay=0;
    if(!mm_write(mm_base+0x51e8a0,mpm_original_format,5))okay=0;
    if(!mm_write(mm_base+0x51ed3e,mpm_original_preview,5))okay=0;
    for(unsigned i=0;i<sizeof(mp_menu_patches)/sizeof(mp_menu_patches[0]);i++)if(!mm_write(mm_base+mp_menu_patches[i].rva,mp_menu_patches[i].before,mp_menu_patches[i].length))okay=0;
    if(okay){if(mpm_relay)VirtualFree(mpm_relay,0,MEM_RELEASE);mpm_relay=0;mpm_installed=0;}return okay;
}

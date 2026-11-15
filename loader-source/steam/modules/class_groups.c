/* Native class IDs1..255 with supplemental template groups and explicit marks.
 * Included in the shared Menu Mods runtime, preserving its other modules.
 * No save/unit/template fields are rewritten. Native groups/classes without
 * explicit descriptors retain the original function. IDs above255 and saved
 * allocation-generation migration remain separate, gated capabilities.
 */
#include <bcrypt.h>
#include "../modprep/permissions.c"
#include "../modprep/class_rules.h"
#include "../modprep/native_original.h"
#include "../modprep/class_menu_data.h"
#include "../modprep/entry_gate.h"
#include "class_menu.c"

#define MP_RETIRED_GIANT_CLASS 77u

typedef int (*MpgEligibility)(const void*,int,const void*);
static MpgEligibility mpg_original;
static MP_Permissions mpg_view;
static unsigned char *mpg_storage;
static const unsigned char *mpg_checked_classes,*mpg_checked_templates;
static int mpg_checked_valid,mpg_logged_bad,mpg_logged_queries;
static int mpg_installed;
typedef unsigned (*MpgMark)(unsigned);
typedef void (*MpgCache)(void*,const void*);
typedef int (*MpgEntryGate)(const void*);
static MpgMark mpg_native_mark;
static MpgCache mpg_native_cache;
static MpgEntryGate mpg_native_entry_gate;
static MP_ClassMenuData mpg_menu;
static unsigned char *mpg_menu_storage;
static int mpg_extended_menu;

static uint16_t mpg_u16(const void *p){uint16_t value;memcpy(&value,p,2);return value;}
static uint32_t mpg_u32(const void *p){uint32_t value;memcpy(&value,p,4);return value;}
static uint64_t mpg_u64(const void *p){uint64_t value;memcpy(&value,p,8);return value;}
static int mpg_mark_only(unsigned class_id){return mpg_extended_menu&&class_id<mpg_menu.count&&mpc_u32(mpg_menu.rows+(size_t)class_id*8+4)!=0;}
static int mpg_templar_class(unsigned class_id){
    return mpg_extended_menu&&class_id>=MP_TEMPLAR_FIRST&&class_id<=MP_TEMPLAR_LAST&&class_id<mpg_menu.count&&
        mpc_u32(mpg_menu.rows+(size_t)class_id*8+4)==MP_MENU_TEMPLAR_ALIAS;
}
static unsigned mpg_mark(unsigned class_id){
    /* The restored Rogue mark is for Rogue; it must not expose the
       inactive Templar Rogue alias in the shared-mark class lists. */
    if(class_id==92 && mpg_templar_class(class_id))return 0;
    if(mpg_extended_menu&&class_id==MP_RETIRED_GIANT_CLASS)return 0;
    if(!mpg_mark_only(class_id))return mpg_native_mark(class_id);
    unsigned mark=mpc_u16(mpg_menu.rows+(size_t)class_id*8);
    unsigned short (*type)(unsigned)=(void*)(mm_base+0x3364f0);
    return type(mark)==35?mark:0;
}
static void mpg_cache(void *cache,const void *unit){
    if(mm_readable(unit,0x4a)&&cache==mm_base+0xce5b00&&mpg_mark_only(((const unsigned char*)unit)[0x49]))return;
    mpg_native_cache(cache,unit);
}
static void mpg_log_query(unsigned template_id,unsigned group,unsigned class_id,int result){
    if(mpg_logged_queries>=24)return;
    char line[192];snprintf(line,sizeof(line),"Class groups: template %u -> logical group %u, class %u -> icon/result %d.\r\n",template_id,group,class_id,result);
    mm_log(line);mpg_logged_queries++;
}
static int mpg_hex(const wchar_t *text,unsigned char out[32]){
    if(wcslen(text)!=64)return 0;
    for(unsigned i=0;i<32;i++){
        unsigned value=0;
        for(unsigned j=0;j<2;j++){
            wchar_t c=text[i*2+j];unsigned nibble;
            if(c>=L'0'&&c<=L'9')nibble=(unsigned)(c-L'0');
            else if(c>=L'a'&&c<=L'f')nibble=(unsigned)(c-L'a'+10);
            else if(c>=L'A'&&c<=L'F')nibble=(unsigned)(c-L'A'+10);
            else return 0;
            value=value*16+nibble;
        }
        out[i]=(unsigned char)value;
    }
    return 1;
}
static int mpg_sha256(const unsigned char *data,ULONG size,unsigned char out[32]){
    BCRYPT_ALG_HANDLE provider=0;BCRYPT_HASH_HANDLE hash=0;int okay=0;
    if(BCryptOpenAlgorithmProvider(&provider,BCRYPT_SHA256_ALGORITHM,0,0)<0)return 0;
    if(BCryptCreateHash(provider,&hash,0,0,0,0,0)>=0&&BCryptHashData(hash,(PUCHAR)data,size,0)>=0&&BCryptFinishHash(hash,out,32,0)>=0)okay=1;
    if(hash)BCryptDestroyHash(hash);BCryptCloseAlgorithmProvider(provider,0);return okay;
}
static unsigned char *mpg_read_file(const wchar_t *path,DWORD *size){
    HANDLE file=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,0,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,0);
    if(file==INVALID_HANDLE_VALUE)return 0;
    LARGE_INTEGER length;unsigned char *data=0;DWORD read=0;
    if(GetFileSizeEx(file,&length)&&length.QuadPart>=112&&length.QuadPart<=64*1024*1024){
        data=HeapAlloc(GetProcessHeap(),0,(SIZE_T)length.QuadPart);
        if(data&&(!ReadFile(file,data,(DWORD)length.QuadPart,&read,0)||read!=(DWORD)length.QuadPart)){HeapFree(GetProcessHeap(),0,data);data=0;}
    }
    CloseHandle(file);if(data)*size=read;return data;
}
static const unsigned char *mpg_table(unsigned rva,unsigned stride,unsigned expected){
    const unsigned char *table=*(unsigned char**)(mm_base+rva);
    if(!mm_readable(table,16)||memcmp(table,"xlce",4)||mpg_u32(table+4)!=expected||mpg_u32(table+12)!=stride)return 0;
    unsigned offset=mpg_u32(table+8);
    if(offset<16||offset>4096||!mm_readable(table+offset,(size_t)expected*stride))return 0;
    return table;
}
static int mpg_live_tables(const unsigned char **class_rows,const unsigned char **template_rows){
    const unsigned char *classes=mpg_table(0xd68338,208,mpg_view.classes);
    const unsigned char *templates=mpg_table(0xd68340,84,mpg_view.templates);
    if(!classes||!templates)return 0;
    const unsigned char *cr=classes+mpg_u32(classes+8),*tr=templates+mpg_u32(templates+8);
    if(classes!=mpg_checked_classes||templates!=mpg_checked_templates){
        mpg_checked_classes=classes;mpg_checked_templates=templates;mpg_checked_valid=1;
        for(unsigned c=0;c<mpg_view.classes;c++){
            uint64_t native=mpg_u64(cr+(size_t)c*208+0x88);
            if(native!=mpg_u64(mpg_view.data+mpg_view.matrix+(size_t)c*mpg_view.stride)){mpg_checked_valid=0;break;}
        }
        for(unsigned t=0;t<mpg_view.templates&&mpg_checked_valid;t++){
            uint32_t group;
            if(!mp_permissions_group(&mpg_view,t,&group)||(group<64&&group!=tr[(size_t)t*84+0x38]))mpg_checked_valid=0;
        }
        if(!mpg_checked_valid&&!mpg_logged_bad){mm_log("Class groups: loaded native permissions differ from sidecar; original lookup retained.\r\n");mpg_logged_bad=1;}
    }
    if(!mpg_checked_valid)return 0;
    *class_rows=cr;*template_rows=tr;return 1;
}
static int mpg_entry_gate(const void *unit){
    int result=mpg_native_entry_gate(unit);
    if((result!=0&&result!=0x13d7)||!mm_readable(unit,0x50))return result;
    const unsigned char *classes,*templates;uint32_t group;
    if(!mpg_live_tables(&classes,&templates)||!mp_permissions_group(&mpg_view,mpg_u16(unit),&group))return result;
    unsigned current=((const unsigned char*)unit)[0x49];
    if(mpg_templar_class(current)){
        if(!((const unsigned char*)unit)[0x0b])return 0x13d2;
        for(unsigned c=MP_TEMPLAR_FIRST;c<=MP_TEMPLAR_LAST;c++){
            if(c!=current&&mpg_templar_class(c)&&classes[(size_t)c*208+0x55]&&mpg_mark(c))return 0;
        }
        return 0x13d7;
    }
    if(group<64)return result;
    /* Native460FE0 rejects template+38==0 before checking unit+0B. An owned
       supplemental group replaces ONLY that missing-group condition. Keep
       the following native unit check and its original warning unchanged. */
    if(!((const unsigned char*)unit)[0x0b])return 0x13d2;
    /* A group with no alternative class must keep the normal cannot-change
       message. Count permitted/selectable classes, independent of owned marks
       or temporary story unlocks; mark requirements stay in the class window. */
    unsigned choices=0;
    for(unsigned c=1;c<mpg_view.classes&&c<256;c++){
        int allowed;
        if(!classes[(size_t)c*208+0x55]||!mp_permissions_allows(&mpg_view,mpg_u16(unit),c,&allowed)||!allowed)continue;
        if(c>=80&&!mpg_mark_only(c))continue;
        if(++choices>1)return 0;
    }
    return 0x13d7;
}
static int mpg_racial_icon(const unsigned char *classes,const unsigned char *klass,const unsigned char *templ,unsigned flags,int result){
    unsigned race=templ[0x39];
    if(result<0||(flags&0x40)||race<2||race>10)return result;
    unsigned icon=klass[0x98+race];
    if(icon!=255)return(int)icon;
    /* Missing native race artwork is FF, which the original routine maps to
       icon0 (Cloud Dragon). Reuse the race's actual native body picture. */
    static const unsigned fallback_class[11]={0,0,1,1,1,1,1,3,22,22,22};
    icon=classes[(size_t)fallback_class[race]*208+0x98+race];
    return icon==255?-1:(int)icon;
}
static int mpg_eligibility(const void *availability,int class_id,const void *unit){
    if(mpg_extended_menu&&class_id==MP_RETIRED_GIANT_CLASS)return -1;
    const unsigned char *classes,*templates;
    if(!mm_readable(unit,0x50)||class_id<0||class_id>=256||!mpg_live_tables(&classes,&templates))return class_id>=80?-1:mpg_original(availability,class_id,unit);
    unsigned template_id=mpg_u16(unit);uint32_t group;int allowed;
    int is_templar=mpg_templar_class(((const unsigned char*)unit)[0x49]);
    int templar_target=mpg_templar_class((unsigned)class_id);
    if(is_templar!=templar_target)return -1;
    if(mpg_mark_only((unsigned)class_id)){
        if(template_id>=mpg_view.templates||!mpg_mark((unsigned)class_id))return -1;
        allowed=templar_target;
        if(!templar_target&&(!mp_permissions_allows(&mpg_view,template_id,(unsigned)class_id,&allowed)||!allowed))return -1;
        int result=mp_class_icon((unsigned)class_id,256,classes+(size_t)class_id*208,templates+(size_t)template_id*84,((const unsigned char*)unit)[0x4e],UINT64_C(1)<<36,allowed);
        if(result>=0)result=mpc_u16(mpg_menu.rows+(size_t)class_id*8+2);
        mpg_log_query(template_id,0xffffffffu,(unsigned)class_id,result);return result;
    }
    if(class_id>=80)return -1;
    if(!mp_permissions_group(&mpg_view,template_id,&group)||group<64)return mpg_original(availability,class_id,unit);
    if(!mp_permissions_allows(&mpg_view,template_id,(uint32_t)class_id,&allowed)||!mm_readable((const unsigned char*)availability+(size_t)class_id*16,8))return -1;
    const unsigned char *templ=templates+(size_t)template_id*84,*klass=classes+(size_t)class_id*208;
    unsigned char menu_template[84];const unsigned char *look=templ;
    if(mpg_extended_menu&&template_id<mpg_menu.templates&&mpg_menu.races[template_id]!=255){
        memcpy(menu_template,templ,84);menu_template[0x39]=mpg_menu.races[template_id];look=menu_template;
    }
    int result=mp_native_class_icon((unsigned)class_id,klass,look,((const unsigned char*)unit)[0x4e],mpg_u64((const unsigned char*)availability+(size_t)class_id*16),allowed);
    result=mpg_racial_icon(classes,klass,look,((const unsigned char*)unit)[0x4e],result);
    mpg_log_query(template_id,group,(unsigned)class_id,result);return result;
}
static int mm_install_class_groups(const wchar_t *config){
    if(mpg_installed)return 1;
    wchar_t path[32768],text[128];unsigned char project[32],allocation[32],baseline[32],actual[32];
    const wchar_t *section=L"ModPreparationClassGroups";
    mpg_extended_menu=GetPrivateProfileIntW(section,L"ExtendedMenu",0,config)!=0;
    GetPrivateProfileStringW(section,L"ProjectDigest",L"",text,128,config);if(!mpg_hex(text,project))goto configuration_failed;
    GetPrivateProfileStringW(section,L"AllocationDigest",L"",text,128,config);if(!mpg_hex(text,allocation))goto configuration_failed;
    GetPrivateProfileStringW(section,L"BattleDataSHA256",L"",text,128,config);if(!mpg_hex(text,baseline))goto configuration_failed;
    wcscpy(path,config);wchar_t *slash=wcsrchr(path,L'\\');if(!slash)goto configuration_failed;
    wcscpy(slash+1,L"Data\\battle\\battle_data_release.dat");DWORD size=0;unsigned char *archive=mpg_read_file(path,&size);
    if(!archive){mm_log("Class groups: native archive unreadable; no hook installed.\r\n");return 0;}
    int okay=mpg_sha256(archive,size,actual)&&!memcmp(actual,baseline,32);HeapFree(GetProcessHeap(),0,archive);
    if(!okay){mm_log("Class groups: battle archive changed since build; no hook installed.\r\n");return 0;}
    if(mpg_extended_menu){
        GetPrivateProfileStringW(section,L"MenuDataSHA256",L"",text,128,config);if(!mpg_hex(text,baseline))goto configuration_failed;
        wcscpy(path,config);slash=wcsrchr(path,L'\\');wcscpy(slash+1,L"Data\\menu\\menu_data.dat");archive=mpg_read_file(path,&size);
        if(!archive){mm_log("Class groups: menu archive unreadable; no hook installed.\r\n");return 0;}
        okay=mpg_sha256(archive,size,actual)&&!memcmp(actual,baseline,32);HeapFree(GetProcessHeap(),0,archive);
        if(!okay){mm_log("Class groups: menu archive changed since build; no hook installed.\r\n");return 0;}
    }
    wcscpy(path,config);slash=wcsrchr(path,L'\\');wcscpy(slash+1,L"modprep-classgroups.bin");
    mpg_storage=mpg_read_file(path,&size);
    if(!mpg_storage||!mp_permissions_open(&mpg_view,mpg_storage,size)||memcmp(mpg_storage+48,project,32)||memcmp(mpg_storage+80,allocation,32)||mpg_view.groups<64||mpg_view.classes<80)goto data_failed;
    if(mpg_extended_menu){
        if(mpg_view.classes!=256)goto data_failed;
        wcscpy(path,config);slash=wcsrchr(path,L'\\');wcscpy(slash+1,L"modprep-classmenu.bin");
        mpg_menu_storage=mpg_read_file(path,&size);
        if(!mpg_menu_storage||!mpc_open(&mpg_menu,mpg_menu_storage,size,project,allocation)||mpg_menu.count!=256||mpg_menu.templates!=mpg_view.templates)goto data_failed;
    }
    const unsigned char expected[]={0xe8,0xef,0x66,0xda,0xff};
    if(memcmp(mm_base+0x521a4c,expected,5)||memcmp(mm_base+0x2c8140,mp_original,sizeof(mp_original))||
       (mpg_extended_menu&&memcmp(mm_base+0x464330,mp_gate_original,sizeof(mp_gate_original)))){mm_log("Class groups: eligibility/entry gate fingerprint mismatch; no hook installed.\r\n");goto data_failed;}
    unsigned char *relay=mm_near_page();if(!relay)goto data_failed;
    intptr_t difference=relay-(mm_base+0x521a51);if(difference<INT32_MIN||difference>INT32_MAX){VirtualFree(relay,0,MEM_RELEASE);goto data_failed;}
    mpg_original=(MpgEligibility)(void*)(mm_base+0x2c8140);mm_abs_jump(relay,(void*)mpg_eligibility);
    unsigned char mark_before[6],cache_before[5],gate_before[6];
    if(mpg_extended_menu){
        const unsigned char mark_expected[]={0x40,0x53,0x48,0x83,0xec,0x20};
        const unsigned char cache_expected[]={0x48,0x89,0x5c,0x24,0x08};
        const unsigned char gate_expected[]={0x40,0x53,0x48,0x83,0xec,0x20};
        if(memcmp(mm_base+0x4662a0,mark_expected,6)||memcmp(mm_base+0x2c4250,cache_expected,5)||memcmp(mm_base+0x464330,gate_expected,6)){VirtualFree(relay,0,MEM_RELEASE);goto data_failed;}
        memcpy(mark_before,mark_expected,6);memcpy(cache_before,cache_expected,5);memcpy(gate_before,gate_expected,6);
        memcpy(relay+128,mark_expected,6);mm_abs_jump(relay+134,mm_base+0x4662a6);mpg_native_mark=(MpgMark)(void*)(relay+128);
        memcpy(relay+192,cache_expected,5);mm_abs_jump(relay+197,mm_base+0x2c4255);mpg_native_cache=(MpgCache)(void*)(relay+192);
        mm_abs_jump(relay+256,(void*)mpg_mark);mm_abs_jump(relay+288,(void*)mpg_cache);
        memcpy(relay+384,gate_expected,6);mm_abs_jump(relay+390,mm_base+0x464336);mpg_native_entry_gate=(MpgEntryGate)(void*)(relay+384);
        mm_abs_jump(relay+448,(void*)mpg_entry_gate);
        uint16_t icons[256];for(unsigned i=0;i<256;i++)icons[i]=mpc_u16(mpg_menu.rows+(size_t)i*8+2);
        FlushInstructionCache(GetCurrentProcess(),relay,462);
        if(!mm_install_class_menu(icons)){VirtualFree(relay,0,MEM_RELEASE);goto data_failed;}
        unsigned char mark_patch[6]={0xe9,0,0,0,0,0x90},cache_patch[5]={0xe9},gate_patch[6]={0xe9,0,0,0,0,0x90};
        int32_t mark_delta=(int32_t)((relay+256)-(mm_base+0x4662a5)),cache_delta=(int32_t)((relay+288)-(mm_base+0x2c4255)),gate_delta=(int32_t)((relay+448)-(mm_base+0x464335));
        memcpy(mark_patch+1,&mark_delta,4);memcpy(cache_patch+1,&cache_delta,4);memcpy(gate_patch+1,&gate_delta,4);
        if(!mm_write(mm_base+0x4662a0,mark_patch,6)||!mm_write(mm_base+0x2c4250,cache_patch,5)||!mm_write(mm_base+0x464330,gate_patch,6)){
            int restored=1;
            if(!mm_write(mm_base+0x4662a0,mark_before,6))restored=0;
            if(!mm_write(mm_base+0x2c4250,cache_before,5))restored=0;
            if(!mm_write(mm_base+0x464330,gate_before,6))restored=0;
            if(!mm_restore_class_menu())restored=0;
            if(!restored){mpg_installed=1;mm_log("Class menu: partial rollback; storage retained.\r\n");return 0;}
            VirtualFree(relay,0,MEM_RELEASE);goto data_failed;
        }
    }
    FlushInstructionCache(GetCurrentProcess(),relay,14);
    unsigned char patch[5]={0xe8};int32_t delta=(int32_t)difference;memcpy(patch+1,&delta,4);
    if(!mm_write(mm_base+0x521a4c,patch,5)){
        int restored=mm_write(mm_base+0x521a4c,expected,5);
        if(mpg_extended_menu){
            if(!mm_write(mm_base+0x4662a0,mark_before,6))restored=0;
            if(!mm_write(mm_base+0x2c4250,cache_before,5))restored=0;
            if(!mm_write(mm_base+0x464330,gate_before,6))restored=0;
            if(!mm_restore_class_menu())restored=0;
        }
        if(!restored){mpg_installed=1;mm_log("Class groups: write/rollback failed; hook storage retained.\r\n");return 0;}
        VirtualFree(relay,0,MEM_RELEASE);goto data_failed;
    }
    mpg_installed=1;mm_log("Class groups: extended template selectors, owned-group entry gate and validated class-mark descriptors enabled; class IDs remain 1..255.\r\n");return 1;
data_failed:
    if(mpg_menu_storage)HeapFree(GetProcessHeap(),0,mpg_menu_storage);mpg_menu_storage=0;memset(&mpg_menu,0,sizeof(mpg_menu));mpg_extended_menu=0;
    if(mpg_storage)HeapFree(GetProcessHeap(),0,mpg_storage);mpg_storage=0;memset(&mpg_view,0,sizeof(mpg_view));
    mm_log("Class groups: sidecar or native validation failed; original class screen retained.\r\n");return 0;
configuration_failed:
    mm_log("Class groups: missing/invalid project, allocation or archive identity; no hook installed.\r\n");return 0;
}

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include "fingerprints.h"
static int throw_write(void *p,const void *data,size_t n){
    DWORD old,unused;if(!VirtualProtect(p,n,PAGE_EXECUTE_READWRITE,&old))return 0;
    memcpy(p,data,n);FlushInstructionCache(GetCurrentProcess(),p,n);
    return VirtualProtect(p,n,old,&unused)!=0;
}
static int throw_install(unsigned char *base){
    if(memcmp(base+0x3374a0,fp_weapon,sizeof(fp_weapon))||memcmp(base+0x3374b0,fp_mask,sizeof(fp_mask)))return 0;
    const unsigned char max_minus_one=20,max_type=21;
    if(throw_write(base+0x3374a5,&max_minus_one,1)&&throw_write(base+0x33751d,&max_type,1))return 1;
    throw_write(base+0x3374a0,fp_weapon,sizeof(fp_weapon));throw_write(base+0x3374b0,fp_mask,sizeof(fp_mask));return 0;
}
#include "ammunition.c"

/* Call once from the editor loader worker when the Throw Reborn toggle is on.
 * Keep this module loaded for the process lifetime after successful install. */
__declspec(dllexport) BOOL WINAPI ThrowRebornInstall(void){
    wchar_t path[32768];
    DWORD length=GetModuleFileNameW(NULL,path,32768);
    if(!length || length>=32768)return FALSE;
    wchar_t *slash=wcsrchr(path,L'\\');
    if(!slash || _wcsicmp(slash+1,L"Tactics Ogre Reborn.exe"))return FALSE;
    wcscpy(slash+1,L"throw-reborn.log");
    wcscpy(ammo_log_path,path);
    unsigned char *base=(unsigned char*)GetModuleHandleW(NULL);
    IMAGE_NT_HEADERS64 *nt=(void*)(base+((IMAGE_DOS_HEADER*)base)->e_lfanew);
    if(nt->FileHeader.TimeDateStamp!=THROW_TIMESTAMP ||
       nt->OptionalHeader.SizeOfImage!=THROW_IMAGE_SIZE)return FALSE;
    if(!throw_install(base))return FALSE;
    if(!ammo_install(base)){
        throw_write(base+0x3374a0,fp_weapon,sizeof(fp_weapon));
        throw_write(base+0x3374b0,fp_mask,sizeof(fp_mask));
        ammo_log("Throw Reborn: native hooks rejected.\r\n");
        return FALSE;
    }
    ammo_log("Throw Reborn: editor runtime ready.\r\n");
    return TRUE;
}

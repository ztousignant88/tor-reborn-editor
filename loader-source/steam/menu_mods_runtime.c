#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmsystem.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include "speed_rules.h"
#include "fingerprints.h"

static unsigned char *mm_base;
static wchar_t mm_log_path[32768];
static volatile LONG mm_caption_dirty=1,mm_clock_ready,mm_rate_milli=1000;
static CRITICAL_SECTION mm_clock_lock;
static MMClock mm_qpc_clock;
static MMTickClock mm_gtc_clock,mm_tgt_clock;
typedef BOOL (WINAPI *MMQpcFn)(LARGE_INTEGER*);
typedef DWORD (WINAPI *MMTickFn)(void);
static MMQpcFn mm_real_qpc;
static MMTickFn mm_real_gtc,mm_real_tgt;
static HWND mm_window;
static wchar_t mm_original_title[512];
static int mm_last_suspended=-1;
typedef unsigned char (*MMUIFn)(unsigned char);
static MMUIFn mm_original_ui;
typedef LRESULT (WINAPI *MMDispatchFn)(const MSG *);
static MMDispatchFn mm_original_dispatch;

static void mm_log(const char *text){
    if(!mm_log_path[0])return;
    HANDLE f=CreateFileW(mm_log_path,FILE_APPEND_DATA,FILE_SHARE_READ|FILE_SHARE_WRITE,0,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,0);
    if(f!=INVALID_HANDLE_VALUE){DWORD n;WriteFile(f,text,(DWORD)strlen(text),&n,0);CloseHandle(f);}
}
static int mm_readable(const void *p,size_t n){
    uintptr_t at=(uintptr_t)p,end=at+n;if(!p||end<at)return 0;
    while(at<end){MEMORY_BASIC_INFORMATION m;if(!VirtualQuery((void*)at,&m,sizeof(m))||m.State!=MEM_COMMIT||(m.Protect&(PAGE_NOACCESS|PAGE_GUARD)))return 0;
        uintptr_t next=(uintptr_t)m.BaseAddress+m.RegionSize;if(next<=at)return 0;at=next;}
    return 1;
}
static BOOL WINAPI mm_scaled_qpc(LARGE_INTEGER *out){
    if(!InterlockedCompareExchange(&mm_clock_ready,0,0))return mm_real_qpc(out);
    EnterCriticalSection(&mm_clock_lock);LARGE_INTEGER now;BOOL ok=mm_real_qpc(&now);
    if(ok)out->QuadPart=mm_clock_read(&mm_qpc_clock,now.QuadPart);LeaveCriticalSection(&mm_clock_lock);return ok;
}
static DWORD WINAPI mm_scaled_gtc(void){
    EnterCriticalSection(&mm_clock_lock);DWORD result=(DWORD)mm_tick_read(&mm_gtc_clock,mm_real_gtc());LeaveCriticalSection(&mm_clock_lock);return result;
}
static DWORD WINAPI mm_scaled_tgt(void){
    EnterCriticalSection(&mm_clock_lock);DWORD result=(DWORD)mm_tick_read(&mm_tgt_clock,mm_real_tgt());LeaveCriticalSection(&mm_clock_lock);return result;
}
static void mm_set_rate(double rate){
    LONG code=(LONG)(rate*1000.0);
    if(!InterlockedCompareExchange(&mm_clock_ready,0,0)||InterlockedCompareExchange(&mm_rate_milli,0,0)==code)return;
    EnterCriticalSection(&mm_clock_lock);LARGE_INTEGER now;
    if(mm_real_qpc(&now)){
        mm_clock_change(&mm_qpc_clock,now.QuadPart,rate);
        mm_tick_change(&mm_gtc_clock,mm_real_gtc(),rate);mm_tick_change(&mm_tgt_clock,mm_real_tgt(),rate);
        InterlockedExchange(&mm_rate_milli,code);
    }
    LeaveCriticalSection(&mm_clock_lock);
}
static void mm_update_caption(const wchar_t *label,int suspended);
#include "modules/fast_forward.c"

static unsigned char mm_ui_hook(unsigned char on){
    // Automatic scene/UI updates must not advance the speed cycle. They can
    // temporarily remove the extra timing, which the next active battle tick
    // reapplies from the selected state.
    if (!on) {
        ff_battle_active = 0;
        InterlockedExchange(&mm_caption_dirty, 1);
        ff_refresh();
    }
    unsigned char result=mm_original_ui(on);
    return result;
}

static BOOL CALLBACK mm_find_window(HWND window,LPARAM unused){
    (void)unused;DWORD pid=0;GetWindowThreadProcessId(window,&pid);
    if(pid==GetCurrentProcessId()&&IsWindowVisible(window)&&!GetWindow(window,GW_OWNER)){
        mm_window=window;GetWindowTextW(window,mm_original_title,512);return FALSE;
    }return TRUE;
}
static void mm_update_caption(const wchar_t *label,int suspended){
    if(!mm_window||!IsWindow(mm_window)){mm_window=0;EnumWindows(mm_find_window,0);InterlockedExchange(&mm_caption_dirty,1);}
    if(!mm_window)return;
    if(suspended!=mm_last_suspended){mm_last_suspended=suspended;InterlockedExchange(&mm_caption_dirty,1);}
    if(!InterlockedExchange(&mm_caption_dirty,0))return;
    wchar_t title[768];
    if (ff_global) {
        swprintf(title, 768, L"%ls | Global Fast Forward (5x)", mm_original_title);
    } else {
        swprintf(title, 768, L"%ls | Battle Speed %u/%u: %ls%ls", mm_original_title,
                 ff_current_step()+1, MM_SPEED_STEPS, label, suspended ? L" [temporarily normal]" : L"");
    }
    SetWindowTextW(mm_window,title);
}
static void mm_abs_jump(unsigned char *p,void *to){p[0]=0xff;p[1]=0x25;memset(p+2,0,4);memcpy(p+6,&to,8);}
static int mm_write(void *p,const void *data,size_t n){
    DWORD old;if(!VirtualProtect(p,n,PAGE_EXECUTE_READWRITE,&old))return 0;memcpy(p,data,n);FlushInstructionCache(GetCurrentProcess(),p,n);
    DWORD unused;return VirtualProtect(p,n,old,&unused)!=0;
}
static void *mm_near_page(void){
    SYSTEM_INFO si;GetSystemInfo(&si);uintptr_t base=(uintptr_t)mm_base,gran=si.dwAllocationGranularity;
    for(uintptr_t d=gran;d<0x70000000;d+=gran){void *p=VirtualAlloc((void*)((base+d)&~(gran-1)),4096,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(p)return p;
        if(base>d){p=VirtualAlloc((void*)((base-d)&~(gran-1)),4096,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);if(p)return p;}}
    return 0;
}
static int mm_prepare_clocks(void){
    HMODULE kernel=GetModuleHandleW(L"kernel32.dll");HMODULE winmm=LoadLibraryExW(L"winmm.dll",0,LOAD_LIBRARY_SEARCH_SYSTEM32);
    if(!kernel||!winmm)return 0;
    mm_real_qpc=(MMQpcFn)(void*)GetProcAddress(kernel,"QueryPerformanceCounter");mm_real_gtc=(MMTickFn)(void*)GetProcAddress(kernel,"GetTickCount");mm_real_tgt=(MMTickFn)(void*)GetProcAddress(winmm,"timeGetTime");
    if(!mm_real_qpc||!mm_real_gtc||!mm_real_tgt)return 0;
    if(*(void**)(mm_base+MM_IAT_QPC)!=(void*)mm_real_qpc||*(void**)(mm_base+MM_IAT_GTC)!=(void*)mm_real_gtc||*(void**)(mm_base+MM_IAT_TGT)!=(void*)mm_real_tgt){mm_log("Disabled: timer imports already redirected.\r\n");return 0;}
    InitializeCriticalSection(&mm_clock_lock);LARGE_INTEGER now;if(!mm_real_qpc(&now))return 0;
    mm_qpc_clock=(MMClock){now.QuadPart,now.QuadPart,1.0};DWORD g=mm_real_gtc(),t=mm_real_tgt();
    mm_gtc_clock=(MMTickClock){g,g,1.0};mm_tgt_clock=(MMTickClock){t,t,1.0};InterlockedExchange(&mm_clock_ready,1);return 1;
}
static int mm_install_fast_forward(void){
    unsigned sites[]={0x2edf12,0x2ee109,0x2ee148};unsigned lengths[]={sizeof(fp_mouse),sizeof(fp_input),sizeof(fp_active)};
    const unsigned char *original[]={fp_mouse,fp_input,fp_active};
    for(unsigned i=0;i<3;i++)if(memcmp(mm_base+sites[i],original[i],lengths[i])){mm_log("Disabled: native input fingerprint mismatch.\r\n");return 0;}
    if(memcmp(mm_base+0x2f9590,fp_ui,sizeof(fp_ui))){mm_log("Disabled: speed UI fingerprint mismatch.\r\n");return 0;}
    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    mm_original_dispatch = user32 ? (MMDispatchFn)GetProcAddress(user32, "DispatchMessageW") : NULL;
    if (!mm_original_dispatch || *(MMDispatchFn *)(mm_base + MM_IAT_DISPATCH) != mm_original_dispatch) {
        mm_log("Disabled: keyboard dispatch import mismatch.\r\n");
        return 0;
    }
    unsigned char *relay=mm_near_page();if(!relay||!mm_prepare_clocks()){mm_log("Disabled: runtime initialization failed.\r\n");return 0;}
    unsigned char *ui_trampoline=VirtualAlloc(0,sizeof(fp_ui)+14,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);
    if(!ui_trampoline){mm_log("Disabled: UI trampoline allocation failed.\r\n");return 0;}
    memcpy(ui_trampoline,fp_ui,sizeof(fp_ui));mm_abs_jump(ui_trampoline+sizeof(fp_ui),mm_base+0x2f9590+sizeof(fp_ui));mm_original_ui=(MMUIFn)ui_trampoline;
    mm_abs_jump(relay,(void*)mm_cycle_bridge);mm_abs_jump(relay+32,(void*)mm_tick_bridge);mm_abs_jump(relay+64,(void*)mm_ui_hook);
    FlushInstructionCache(GetCurrentProcess(),relay,96);FlushInstructionCache(GetCurrentProcess(),ui_trampoline,sizeof(fp_ui)+14);
    void *q=(void*)mm_scaled_qpc,*g=(void*)mm_scaled_gtc,*t=(void*)mm_scaled_tgt;int ok=mm_write(mm_base+MM_IAT_QPC,&q,8)&&mm_write(mm_base+MM_IAT_GTC,&g,8)&&mm_write(mm_base+MM_IAT_TGT,&t,8);
    for(unsigned i=0;i<3&&ok;i++){
        unsigned char patch[16];memset(patch,0x90,lengths[i]);patch[0]=0xe8;
        int32_t delta=(int32_t)((relay+(i==2?32:0))-(mm_base+sites[i]+5));memcpy(patch+1,&delta,4);
        ok=mm_write(mm_base+sites[i],patch,lengths[i]);
    }
    if(ok){unsigned char patch[sizeof(fp_ui)];memset(patch,0x90,sizeof(patch));patch[0]=0xe9;int32_t delta=(int32_t)((relay+64)-(mm_base+0x2f9590+5));memcpy(patch+1,&delta,4);ok=mm_write(mm_base+0x2f9590,patch,sizeof(patch));}
    void *dispatch = (void *)ff_dispatch;
    if (ok) ok = mm_write(mm_base + MM_IAT_DISPATCH, &dispatch, sizeof(dispatch));
    if(!ok){
        dispatch = (void *)mm_original_dispatch;
        mm_write(mm_base + MM_IAT_DISPATCH, &dispatch, sizeof(dispatch));
        for(unsigned i=0;i<3;i++)mm_write(mm_base+sites[i],original[i],lengths[i]);
        mm_write(mm_base+0x2f9590,fp_ui,sizeof(fp_ui));
        q=(void*)mm_real_qpc;g=(void*)mm_real_gtc;t=(void*)mm_real_tgt;mm_write(mm_base+MM_IAT_QPC,&q,8);mm_write(mm_base+MM_IAT_GTC,&g,8);mm_write(mm_base+MM_IAT_TGT,&t,8);
        InterlockedExchange(&mm_clock_ready,0);mm_log("Disabled: installation failed; hooks rolled back.\r\n");return 0;
    }
    mm_log("Menu Mods 008 ready. Fast Forward: Normal -> stock Fast -> Fast+ (2x imported clocks) -> Faster (3x imported clocks) -> Turbo (5x imported clocks) -> Normal. F3 resets speed. F4 toggles global 5x timing. No save changes.\r\n");return 1;
}

#ifndef MM_FAST_FORWARD_ONLY
#include "modules/union_level.c"
#include "modules/battle_level_sync.c"
#include "modules/formation_limit.c"
#include "modules/early_unlocks.c"
#include "modules/chapter_videos.c"
#include <stdarg.h>
#include "modules/ai_status.c"
#include "modules/ai_mp_recovery.c"
#include "modules/offhand_damage_fix.c"
#include "modules/armor_resistance_fix.c"
#define MM_XL_STEAM
#include "../dorgalua_xl.h"
#include "modules/ai_choices.c"
#include "battle_capacity/battle_capacity.h"
#include "modules/archer_range.c"
#include "modules/buff_card_spawns.c"
#include "modules/starting_status.c"
#include "modules/versus_pilot.c"
#define GUEST_CONTROL_STEAM
#include "../guest_control.h"
#include "modules/enemy_starting_cards.c"
#include "modules/enemy_levels.c"
#include "modules/enemy_finishers.c"
#include "modules/enemy_skills.c"
static int mfx_spellbook_capacity_active;
#include "modules/enemy_spells.c"
#include "modules/enemy_items.c"
#include "modules/enemy_proficiency.c"
#include "modules/enemy_equipment.c"
#include "modules/trap_ai.c"
#include "modules/class_groups.c"
#include "modules/class_info.c"
#include "modules/equipment_sets.c"
#include "modules/skill_slots.c"
#include "modules/effect_runtime.c"
#include "modules/custom_icon_lookup.c"
#include "modules/item_text_runtime.c"

#include "shared_combat.h"
BOOL WINAPI ThrowRebornInstall(void);
DWORD WINAPI rr_initialize(void *module);
DWORD WINAPI eq_initialize(void *module,const wchar_t *config);

int equipment_install_all_routes(unsigned char *image,unsigned char *relay,
                                 int (*patch)(void *,const void *,size_t));
int equipment_read_save_namespace(const wchar_t *config);

int psp_install_status(unsigned char *base, void (*logger)(const char *));

static DWORD WINAPI mm_initialize(void *module){
    wchar_t exe[32768],config[32768];GetModuleFileNameW((HMODULE)module,mm_log_path,32768);
    wchar_t *slash=wcsrchr(mm_log_path,L'\\');if(!slash)return 0;wcscpy(slash+1,L"menu-mods.log");
    GetModuleFileNameW(0,exe,32768);wcscpy(config,mm_log_path);slash=wcsrchr(config,L'\\');wcscpy(slash+1,L"Tactics Ogre Reborn.exe");if(_wcsicmp(exe,config)){mm_log("Disabled: runtime must be beside Tactics Ogre Reborn.exe.\r\n");return 0;}
    mm_base=(unsigned char*)GetModuleHandleW(0);IMAGE_NT_HEADERS64 *nt=(void*)(mm_base+((IMAGE_DOS_HEADER*)mm_base)->e_lfanew);
    if(nt->FileHeader.TimeDateStamp!=MM_TIMESTAMP||nt->OptionalHeader.SizeOfImage!=MM_IMAGE_SIZE){mm_log("Disabled: unsupported game version.\r\n");return 0;}
    wcscpy(config,mm_log_path);slash=wcsrchr(config,L'\\');wcscpy(slash+1,L"menu-mods.ini");
    mm_install_guest_control(config);
    const int equipment_expanded = GetPrivateProfileIntW(L"ModPreparationEquipment", L"Enabled", 0, config) != 0;
    if (GetPrivateProfileIntW(L"BattleCapacity", L"Enabled", 0, config)) {
        if (battle_capacity_install(mm_base, nt->OptionalHeader.SizeOfImage, equipment_expanded) != 1) {
            mm_log("Expanded battle capacity could not start. Closing the game.\r\n");
            MessageBoxW(NULL, L"Expanded battle capacity could not start. Check menu-mods.log.",
                        L"Tactics Ogre Reborn", MB_OK | MB_ICONERROR);
            ExitProcess(ERROR_BAD_FORMAT);
        }
        mm_log("Expanded battle capacity enabled (62 units).\r\n");
    }
    if (GetPrivateProfileIntW(L"OffhandDamageFix", L"Enabled", 0, config))
        mm_install_offhand_damage_fix();
    if (GetPrivateProfileIntW(L"ArmorResistanceFix", L"Enabled", 0, config))
        mm_install_armor_resistance_fix();
    if (GetPrivateProfileIntW(L"DorgaluaXLFix", L"Enabled", 0, config))
        mm_install_dorgalua_xl();
    if(GetPrivateProfileIntW(L"ModPreparationClassGroups",L"Enabled",0,config)){if(mm_install_class_groups(config))mm_install_class_info();}
    if(GetPrivateProfileIntW(L"ChapterVideos",L"Disabled",0,config))mm_install_chapter_videos();
    else mm_log("Chapter videos: normal playback.\r\n");
    mm_install_early_unlocks(GetPrivateProfileIntW(L"EarlyUnlocks",L"AutoBattle",0,config),GetPrivateProfileIntW(L"EarlyUnlocks",L"Chariot",0,config));
    if(GetPrivateProfileIntW(L"UnionLevel",L"Enabled",0,config))mm_install_union_level();
    else mm_log("Union Level module disabled by config.\r\n");
    mm_install_ai_status(
        GetPrivateProfileIntW(L"AIStatus",L"Enabled",0,config)!=0,
        GetPrivateProfileIntW(L"AIStatus",L"AllProfiles",0,config)!=0,
        GetPrivateProfileIntW(L"AIStatus",L"BuffDefaults",0,config)!=0,
        GetPrivateProfileIntW(L"AIStatus",L"HealingDefaults",0,config)!=0);
    if(GetPrivateProfileIntW(L"AIChoices",L"Enabled",0,config))mm_install_ai_choices();
    if (GetPrivateProfileIntW(L"AIMPRecovery", L"Enabled", 0, config)) mm_install_ai_mp_recovery();
    BOOL throw_ready=FALSE;
    if(GetPrivateProfileIntW(L"ThrowReborn",L"Enabled",0,config)){
        throw_ready=ThrowRebornInstall();
        if(!throw_ready)mm_log("Throw Reborn refused its native hooks.\r\n");
    }
    if(GetPrivateProfileIntW(L"RougesReborn",L"Enabled",0,config)){
        if(!throw_ready)rr_initialize(module);
        else if(!throw_attach_rogues(module))mm_log("Rouges Reborn refused its native hooks.\r\n");
    }
    if(GetPrivateProfileIntW(L"PSPSpellRestoration",L"Enabled",0,config))
        mm_log(psp_install_status(mm_base,mm_log) ?
            "PSP spell status hooks installed.\r\n" :
            "PSP spell status hooks could not be installed.\r\n");
    eq_initialize(module,config);
    if(GetPrivateProfileIntW(L"HardMode",L"EnemyArcherRange",0,config))mm_install_archer_range();
    if(GetPrivateProfileIntW(L"BuffCardSpawns",L"Disabled",0,config))mm_disable_buff_card_spawns();
    mm_install_starting_status(config);
    mm_install_enemy_starting_cards(config);
    mm_install_enemy_levels(config);
    if (!mm_install_versus_pilot(config)) {
        mm_log("Versus: the spectator hooks could not start.\r\n");
        MessageBoxW(NULL, L"Versus could not start. Restore your regular project or check menu-mods.log.",
                    L"Tactics Ogre Reborn", MB_OK | MB_ICONERROR);
        ExitProcess(ERROR_BAD_FORMAT);
    }
    mm_install_enemy_loadouts(config);
    mm_install_enemy_equipment(config);
    mm_install_formation_limit(GetPrivateProfileIntW(L"FormationLimit",L"Units",0,config));
    if(GetPrivateProfileIntW(L"BattleLevelSync",L"Disabled",0,config))mm_disable_battle_sync();
    mm_install_trap_ai(GetPrivateProfileIntW(L"TrapAI",L"Profile",0,config));
    mm_install_equipment_sets(config);
    mm_install_skill_slots(config);
    mm_install_effect_slots(config);
    mm_install_custom_icons(config);
    mm_install_item_text(config);
    if(equipment_expanded){
        unsigned char *equipment_relay = NULL;
        int equipment_ready = equipment_read_save_namespace(config);
        if(equipment_ready)equipment_relay=mm_near_page();
        if(!equipment_relay || equipment_install_all_routes(mm_base,equipment_relay,mm_write)!=1){
            mm_log("Mod Preparation equipment could not start. Closing the game.\r\n");
            MessageBoxW(NULL,L"Mod Preparation equipment could not start. Check menu-mods.log.",
                        L"Tactics Ogre Reborn",MB_OK|MB_ICONERROR);
            ExitProcess(ERROR_BAD_FORMAT);
        }
        mm_log("Mod Preparation equipment routes installed.\r\n");
    }
    if(!GetPrivateProfileIntW(L"FastForward",L"Enabled",0,config)){mm_log("Fast Forward module disabled by config.\r\n");return 0;}
    (void)mm_install_fast_forward();
    return 0;
}
static HINSTANCE steam_runtime_module;
static INIT_ONCE steam_runtime_once=INIT_ONCE_STATIC_INIT;
static BOOL CALLBACK steam_initialize(PINIT_ONCE once, PVOID unused, PVOID *context){
    (void)once; (void)unused; (void)context;
    mm_initialize(steam_runtime_module);
    return TRUE;
}
BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID reserved){
    (void)reserved;
    if(reason==DLL_PROCESS_ATTACH){
        DisableThreadLibraryCalls(module);
        steam_runtime_module=module;
    }
    return TRUE;
}
#endif

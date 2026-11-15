/* Local mod entry point for the isolated game only. Forward genuine DirectInput
 * requests to the Windows system library using its absolute, system-only path.
 * No external process access, custom game launcher or executable patch needed.
 * The executable's import table requests DirectInput8Create from DINPUT8.dll. */
#include "steal_runtime.c"

static INIT_ONCE real_once=INIT_ONCE_STATIC_INIT;
static HMODULE real_dinput;
static BOOL CALLBACK load_real_dinput(PINIT_ONCE once,PVOID parameter,PVOID *context) {
    (void)once;(void)parameter;(void)context;
    wchar_t system_path[MAX_PATH+32];
    UINT length=GetSystemDirectoryW(system_path,MAX_PATH);
    if(!length || length>=MAX_PATH)return FALSE;
    wcscat(system_path,L"\\dinput8.dll");
    real_dinput=LoadLibraryExW(system_path,NULL,LOAD_LIBRARY_SEARCH_SYSTEM32);
    return real_dinput!=NULL;
}
static void *genuine(const char *name) {
    if(!InitOnceExecuteOnce(&real_once,load_real_dinput,NULL,NULL))return NULL;
    return (void*)GetProcAddress(real_dinput,name);
}
__declspec(dllexport) HRESULT WINAPI DirectInput8Create(HINSTANCE instance,DWORD version,const GUID *iid,void **output,void *outer) {
    typedef HRESULT (WINAPI *Fn)(HINSTANCE,DWORD,const GUID *,void **,void *);
    Fn fn=(Fn)genuine("DirectInput8Create");
    if(!fn){if(output)*output=NULL;return E_FAIL;}
    return fn(instance,version,iid,output,outer);
}
__declspec(dllexport) HRESULT WINAPI DllCanUnloadNow(void) {
    typedef HRESULT (WINAPI *Fn)(void);Fn fn=(Fn)genuine("DllCanUnloadNow");return fn?fn():S_FALSE;
}
__declspec(dllexport) HRESULT WINAPI DllGetClassObject(const GUID *cls,const GUID *iid,void **output) {
    typedef HRESULT (WINAPI *Fn)(const GUID *,const GUID *,void **);
    Fn fn=(Fn)genuine("DllGetClassObject");if(!fn){if(output)*output=NULL;return E_FAIL;}return fn(cls,iid,output);
}
__declspec(dllexport) HRESULT WINAPI DllRegisterServer(void) {
    typedef HRESULT (WINAPI *Fn)(void);Fn fn=(Fn)genuine("DllRegisterServer");return fn?fn():E_FAIL;
}
__declspec(dllexport) HRESULT WINAPI DllUnregisterServer(void) {
    typedef HRESULT (WINAPI *Fn)(void);Fn fn=(Fn)genuine("DllUnregisterServer");return fn?fn():E_FAIL;
}
__declspec(dllexport) const void *WINAPI GetdfDIJoystick(void) {
    typedef const void *(WINAPI *Fn)(void);Fn fn=(Fn)genuine("GetdfDIJoystick");return fn?fn():NULL;
}

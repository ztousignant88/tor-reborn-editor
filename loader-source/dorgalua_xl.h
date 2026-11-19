/* Included by the shared menu loaders after their patch helpers. */
#define XL_PACK_SIZE 18189968u

#ifdef MM_XL_STEAM
enum { XL_WAIT_SITE = 0x31efb1, XL_WAIT = 0x295370, XL_ALLOC = 0x37650,
       XL_FREE = 0x37770, XL_PRELOAD = 0x31eeb0, XL_ROSTER_LOAD = 0x31ee7a,
       XL_ROSTER_RELOAD = 0x31f6da };
static const uint8_t xl_wait_call[] = {0xe8,0xba,0x63,0xf7,0xff,0x33,0xf6,0x4c,0x8b,0x4d,0x97,0x41,0x8b,0x41,0x04};
#else
enum { XL_WAIT_SITE = 0x31c761, XL_WAIT = 0x293270, XL_ALLOC = 0x37560,
       XL_FREE = 0x37680, XL_PRELOAD = 0x31c660, XL_ROSTER_LOAD = 0x31c62a,
       XL_ROSTER_RELOAD = 0x31ce8a };
static const uint8_t xl_wait_call[] = {0xe8,0x0a,0x6b,0xf7,0xff,0x33,0xf6,0x4c,0x8b,0x4d,0x97,0x41,0x8b,0x41,0x04};
#endif

static const uint8_t xl_load_call[] = {0xe8,0x31,0x00,0x00,0x00,0x48,0x81,0xc7,0xe0,0x07,0x00,0x00};
static const uint8_t xl_reload_call[] = {0xe8,0xd1,0xf7,0xff,0xff,0x48,0x81,0xc7,0xe0,0x07,0x00,0x00};
static wchar_t xl_pack_path[32768];
static const uint8_t xl_header[] = {
    'p','a','k','d', 2,0,0,0, 0x20,0,0,0, 0xa0,0x69,0x13,1,
    0x90,0x8e,0x15,1, 35,0,0,0, 155,0,1,0, 0,0,0,0
};

static void xl_wait_archive(void *request, void **archive, unsigned sprite, unsigned actor) {
    typedef void (*Wait)(void *);
    typedef void *(*Allocate)(size_t);
    typedef void (*Release)(void *);
    ((Wait)(mm_base + XL_WAIT))(request);
    if (*archive || sprite != 155 || actor != 35)
        return;
    HANDLE file = CreateFileW(xl_pack_path, GENERIC_READ, FILE_SHARE_READ, NULL,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        mm_log("Dorgalua XL: roster archive sidecar is missing.\r\n");
        return;
    }
    LARGE_INTEGER size;
    uint8_t *buffer = NULL;
    if (GetFileSizeEx(file, &size) && size.QuadPart == XL_PACK_SIZE)
        buffer = ((Allocate)(mm_base + XL_ALLOC))(XL_PACK_SIZE);
    DWORD read = 0;
    BOOL loaded = buffer && ReadFile(file, buffer, XL_PACK_SIZE, &read, NULL);
    CloseHandle(file);
    if (!loaded || read != XL_PACK_SIZE || memcmp(buffer, xl_header, sizeof xl_header)) {
        if (buffer)
            ((Release)(mm_base + XL_FREE))(buffer);
        mm_log("Dorgalua XL: could not read or validate the roster archive.\r\n");
        return;
    }
    /* Native roster code owns this allocation and releases it with XL_FREE. */
    *archive = buffer;
    mm_log("Dorgalua XL: supplied the roster sprite archive.\r\n");
}

static void xl_preload_roster(uint8_t *character, uint8_t mode) {
    typedef void (*Preload)(uint8_t *, uint8_t);
    uint16_t template_id;
    memcpy(&template_id, character, sizeof template_id);
    if (template_id == 139 && character[0x49] == 77) {
        /* The loader receives roster slot + 0x40. The native learning scan
         * writes its bitmap to slot + 0x1fc. Preserve all other learned bits. */
        uint8_t *learned = character + (0x1fc - 0x40);
        static const unsigned skills[] = {179, 411, 419};
        for (size_t i = 0; i < ARRAYSIZE(skills); ++i)
            learned[skills[i] / 8] |= (uint8_t)(1u << (skills[i] % 8));
    }
    ((Preload)(mm_base + XL_PRELOAD))(character, mode);
}

static int xl_patch_call(uint8_t *site, const uint8_t *relay) {
    uint8_t call[5] = {0xe8};
    int32_t displacement = (int32_t)((intptr_t)relay - (intptr_t)(site + sizeof call));
    memcpy(call + 1, &displacement, sizeof displacement);
    return mm_write(site, call, sizeof call);
}

static void mm_install_dorgalua_xl(void) {
    const struct {
        unsigned rva;
        const uint8_t *expected;
        size_t length;
        unsigned relay_offset;
    } sites[] = {
        {XL_WAIT_SITE, xl_wait_call, sizeof xl_wait_call, 0},
        {XL_ROSTER_LOAD, xl_load_call, sizeof xl_load_call, 32},
        {XL_ROSTER_RELOAD, xl_reload_call, sizeof xl_reload_call, 32},
    };
    for (size_t i = 0; i < ARRAYSIZE(sites); ++i) {
        if (memcmp(mm_base + sites[i].rva, sites[i].expected, sites[i].length)) {
            mm_log("Dorgalua XL: roster call sites differ.\r\n");
            return;
        }
    }
    static const wchar_t sidecar[] = L"DorgaluaXL00.roster.pak";
    const wchar_t *slash = wcsrchr(mm_log_path, L'\\');
    if (!slash || (size_t)(slash + 1 - mm_log_path) + ARRAYSIZE(sidecar) > ARRAYSIZE(xl_pack_path))
        return;
    wmemcpy(xl_pack_path, mm_log_path, slash + 1 - mm_log_path);
    wcscpy(xl_pack_path + (slash + 1 - mm_log_path), sidecar);

    uint8_t *relay = mm_near_page();
    if (!relay) {
        mm_log("Dorgalua XL: could not allocate the roster call relay.\r\n");
        return;
    }
    /* The wait call retains RCX. RBP holds the archive output slot, R15D
     * holds the sprite ID and EDI holds the actor ID on both builds. */
    static const uint8_t args[] = {0x48,0x8d,0x55,0x97, 0x45,0x89,0xf8, 0x41,0x89,0xf9};
    memcpy(relay, args, sizeof args);
    mm_abs_jump(relay + sizeof args, (void *)xl_wait_archive);
    mm_abs_jump(relay + 32, (void *)xl_preload_roster);
    DWORD old;
    if (!VirtualProtect(relay, 4096, PAGE_EXECUTE_READ, &old) ||
        !FlushInstructionCache(GetCurrentProcess(), relay, 48)) {
        VirtualFree(relay, 0, MEM_RELEASE);
        mm_log("Dorgalua XL: could not prepare the roster relay.\r\n");
        return;
    }
    for (size_t i = 0; i < ARRAYSIZE(sites); ++i) {
        if (!xl_patch_call(mm_base + sites[i].rva, relay + sites[i].relay_offset)) {
            int restored = 1;
            for (size_t j = 0; j <= i; ++j)
                restored &= mm_write(mm_base + sites[j].rva, sites[j].expected, 5);
            if (restored)
                VirtualFree(relay, 0, MEM_RELEASE);
            mm_log("Dorgalua XL: could not install the roster fixes.\r\n");
            return;
        }
    }
    mm_log("Dorgalua XL: roster loading and skill learning fixes installed.\r\n");
}

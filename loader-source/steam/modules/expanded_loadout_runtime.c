#include "expanded_loadout_menu_hooks.c"

static int loadout_archive_matches(const wchar_t *config, const wchar_t *entry, const wchar_t *file) {
    wchar_t path[32768], text[66];
    uint8_t expected[32], actual[32];
    if (GetPrivateProfileStringW(L"ExpandedLoadout", entry, L"", text, 66, config) != 64 ||
        !mpg_hex(text, expected)) return 0;
    const wchar_t *slash = wcsrchr(config, L'\\');
    if (!slash || (size_t)(slash - config) + wcslen(file) + 1 > sizeof(path) / sizeof(*path)) return 0;
    wmemcpy(path, config, (size_t)(slash - config));
    wcscpy(path + (slash - config), file);
    DWORD size = 0;
    uint8_t *data = mpg_read_file(path, &size);
    if (!data) return 0;
    const int matched = mpg_sha256(data, size, actual) && !memcmp(expected, actual, sizeof(actual));
    HeapFree(GetProcessHeap(), 0, data);
    return matched;
}

static int mm_install_expanded_loadout(const wchar_t *config) {
    if (!GetPrivateProfileIntW(L"ExpandedLoadout", L"Enabled", 0, config)) return 1;
    if (!loadout_archive_matches(config, L"LayoutSHA256", L"\\Data\\menu\\menu_layout.dat") ||
        !loadout_archive_matches(config, L"PartsSHA256", L"\\Data\\menu\\menu_parts.dat")) {
        mm_log("Expanded Loadout: the layout and controls do not match the installed runtime configuration.\r\n");
        return 0;
    }
    if (!loadout_install_menu_hooks(eqs_free_skill_installed)) {
        mm_log("Expanded Loadout: the Steam native hooks failed their verification or could not be written.\r\n");
        return 0;
    }
    if (eqs_free_skill_installed) eqs_collect_equipped_skills = loadout_collect_active_skills;
    enemy_loadouts_expanded = 1;
    mm_log("Expanded Loadout: eight spell slots and eight skill slots enabled.\r\n");
    return 1;
}

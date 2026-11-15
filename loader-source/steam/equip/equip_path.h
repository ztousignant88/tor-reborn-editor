#ifndef EQUIP_PATH_H
#define EQUIP_PATH_H
#include <wchar.h>
static int eq_path_matches(const wchar_t *actual,const wchar_t *expected) {
    return actual && expected && _wcsicmp(actual,expected)==0;
}
#endif

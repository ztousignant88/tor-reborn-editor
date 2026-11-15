/* Exercise the shared reader without installing the equipment rule hooks. */
#include "equip_runtime.c"

EQUIPMENT_API int equipment_fixture_read_permissions(void *image, const wchar_t *config)
{
    base = image;
    expanded_permissions = read_permissions(config);
    return expanded_permissions;
}

EQUIPMENT_API int equipment_fixture_expanded_rule(uint16_t item, unsigned klass)
{
    return expanded_rule(item, klass);
}

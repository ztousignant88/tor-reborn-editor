/* Apply the equipment hook set as one transaction in a disposable image. */
#include <stdint.h>
#include <string.h>
#include "equipment_bank.h"

typedef int (*PatchFn)(void *, const void *, size_t);
int equipment_install_inventory_routes(unsigned char *, PatchFn);
int equipment_install_autoequip_routes(unsigned char *, unsigned char *, PatchFn);
int equipment_install_manual_routes(unsigned char *, unsigned char *, PatchFn);
int equipment_install_shop_routes(unsigned char *, unsigned char *, PatchFn);
int equipment_install_slot_routes(unsigned char *, unsigned char *, PatchFn);
int equipment_install_save_guards(unsigned char *, unsigned char *, PatchFn);
int equipment_install_ownership_routes(unsigned char *, unsigned char *, PatchFn);

enum { PATCH_LIMIT = 640, MAX_PATCH_BYTES = 32 };

typedef struct {
    void *address;
    size_t size;
    unsigned char original[MAX_PATCH_BYTES];
} Undo;

typedef struct {
    PatchFn patch;
    unsigned count;
    Undo edits[PATCH_LIMIT];
} Install;

static _Thread_local Install *current_install;
static int attempted;

static int record_patch(void *address, const void *data, size_t size)
{
    Install *install = current_install;
    if (size > MAX_PATCH_BYTES)
        return 0;
    /* Sub-installers can restore a site on failure. Keep its preimage from
     * the first write so an outer rollback can restore every module. */
    for (unsigned i = 0; i < install->count; i++)
        if (install->edits[i].address == address)
            return install->edits[i].size == size && install->patch(address, data, size);
    if (install->count == PATCH_LIMIT)
        return 0;
    Undo *undo = &install->edits[install->count++];
    undo->address = address;
    undo->size = size;
    memcpy(undo->original, address, size);
    return install->patch(address, data, size);
}

EQUIPMENT_API int equipment_install_all_routes(unsigned char *image, unsigned char *relay, PatchFn patch)
{
    /* A restart is required after any attempt because sub-installers
     * retain their native addresses for the process lifetime. */
    if (attempted || !image || !relay || !patch)
        return 0;
    attempted = 1;
    Install install;
    install.count = 0;
    install.patch = patch;
    current_install = &install;
    int installed =
        equipment_install_inventory_routes(image, record_patch) == 1 &&
        equipment_install_save_guards(image, relay, record_patch) == 1 &&
        equipment_install_autoequip_routes(image, relay+0x100, record_patch) == 1 &&
        equipment_install_manual_routes(image, relay+0x200, record_patch) == 1 &&
        equipment_install_shop_routes(image, relay+0x300, record_patch) == 1 &&
        equipment_install_ownership_routes(image, relay+0x400, record_patch) == 1 &&
        equipment_install_slot_routes(image, relay+0x500, record_patch) == 1;
    current_install = NULL;
    if (installed)
        return 1;
    int restored = 1;
    while (install.count) {
        const Undo *undo = &install.edits[--install.count];
        if (!patch(undo->address, undo->original, undo->size))
            restored = 0;
    }
    return restored ? 0 : -1;
}

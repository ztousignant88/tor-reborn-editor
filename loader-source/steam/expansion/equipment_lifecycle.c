/* Isolated adapters for stock inventory copies and native Chariot slots. */
#include <stddef.h>
#include <string.h>
#include "equipment_bank.h"

#define API EQUIPMENT_API

typedef void *(*NativeInventoryCopy)(void *destination, const void *source);
typedef void (*NativeCapture)(const void *manager, void *snapshot, void *extra);
typedef void (*NativeRestore)(void *manager, const void *snapshot, const void *extra);

static uint64_t slot_bit(unsigned slot)
{
    return slot >= 1 && slot <= HISTORY_SLOTS ? (uint64_t)1 << (slot - 1) : 0;
}

API void *equipment_copy_inventory(NativeInventoryCopy native,
                                   void *destination, const void *source,
                                   EquipmentBank *dst_bank, const EquipmentBank *src_bank)
{
    void *result = native(destination, source);
    *dst_bank = *src_bank;
    return result;
}

API void equipment_reset_history(EquipmentHistory *history)
{
    memset(history, 0, sizeof(*history));
}

API int equipment_capture_inventory(NativeCapture native, EquipmentHistory *history,
                                    unsigned slot, const void *manager, void *snapshot,
                                    void *extra, const EquipmentBank *bank)
{
    uint64_t bit = slot_bit(slot);
    if (!bit)
        return 0;
    native(manager, snapshot, extra);
    history->snapshots[slot - 1] = *bank;
    history->occupied |= bit;
    return 1;
}

/* Some history nodes copy an already-captured native record byte-for-byte. */
API int equipment_copy_history(EquipmentHistory *history, unsigned destination, unsigned source)
{
    uint64_t dst = slot_bit(destination);
    uint64_t src = slot_bit(source);
    if (!dst || !src)
        return 0;
    if (!(history->occupied & src)) {
        history->occupied &= ~dst;
        return 0;
    }
    history->snapshots[destination - 1] = history->snapshots[source - 1];
    history->occupied |= dst;
    return 1;
}

/* The caller supplies the actual target bank, including for preview clones. */
API int equipment_restore_inventory(NativeRestore native, const EquipmentHistory *history,
                                    unsigned slot, void *manager, const void *snapshot,
                                    const void *extra, EquipmentBank *bank)
{
    uint64_t bit = slot_bit(slot);
    if (!(history->occupied & bit))
        return 0;
    native(manager, snapshot, extra);
    *bank = history->snapshots[slot - 1];
    return 1;
}

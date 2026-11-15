#ifndef MODPREP_EQUIPMENT_BANK_H
#define MODPREP_EQUIPMENT_BANK_H

#include <stddef.h>
#include <stdint.h>

#ifdef MODPREP_EQUIPMENT_FIXTURE
#define EQUIPMENT_API __declspec(dllexport)
#else
#define EQUIPMENT_API
#endif

enum {
    EQUIPMENT_FIRST = 761,
    EQUIPMENT_COUNT = 128,
    EQUIPMENT_CAP = 999,
    HISTORY_SLOTS = 50
};

typedef struct EquipmentBank {
    uint16_t quantities[EQUIPMENT_COUNT];
} EquipmentBank;

typedef struct EquipmentHistory {
    uint64_t occupied;
    EquipmentBank snapshots[HISTORY_SLOTS];
} EquipmentHistory;

EQUIPMENT_API int equipment_count(const EquipmentBank *bank, uint16_t id);
EQUIPMENT_API int equipment_award(EquipmentBank *bank, uint16_t id, int unique);
EQUIPMENT_API int equipment_set(EquipmentBank *bank, uint16_t id, uint16_t quantity, int unique);
EQUIPMENT_API int equipment_remove(EquipmentBank *bank, uint16_t id);
EQUIPMENT_API int equipment_bind_inventory(const void *inventory, EquipmentBank *bank);
EQUIPMENT_API void equipment_unbind_inventory(const void *inventory);
EQUIPMENT_API int equipment_inventory_count(const void *inventory, uint16_t id);
EQUIPMENT_API int equipment_try_award_added(const void *inventory, uint16_t id, unsigned quantity);
int equipment_transfer_inventory(const void *destination, const void *source);
int equipment_capture_bank(const void *inventory, EquipmentBank *out);
int equipment_has_added_definition(uint16_t id);
int equipment_restore_bank(const void *inventory, const EquipmentBank *bank);
EQUIPMENT_API int equipment_copy_history(EquipmentHistory *history, unsigned destination, unsigned source);
EQUIPMENT_API size_t equipment_append(const EquipmentBank *bank, const uint8_t owner[16],
                                      uint8_t *save, size_t size, size_t capacity);
EQUIPMENT_API size_t equipment_append_suspend(const EquipmentBank *party, const EquipmentBank *battle,
                                              const EquipmentHistory *history, const uint8_t owner[16],
                                              uint8_t *save, size_t size, size_t capacity);
EQUIPMENT_API int equipment_load(EquipmentBank *bank, const uint8_t owner[16],
                                 const uint8_t *save, size_t size);
EQUIPMENT_API int equipment_load_suspend(EquipmentBank *party, EquipmentBank *battle,
                                         EquipmentHistory *history, const uint8_t owner[16],
                                         const uint8_t *save, size_t size);
int equipment_payload_mode(const uint8_t *save, size_t size);
EQUIPMENT_API int equipment_read_save_namespace(const wchar_t *config);

#endif

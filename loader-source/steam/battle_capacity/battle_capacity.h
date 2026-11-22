#ifndef TOR_STEAM_BATTLE_CAPACITY_H
#define TOR_STEAM_BATTLE_CAPACITY_H

#include <stddef.h>
#include <stdint.h>

int battle_capacity_install(uint8_t *image, size_t image_size, int equipment_owns_history);
unsigned battle_capacity_unit_count(void);
void *battle_capacity_copy_history(void *destination, const void *source, size_t size,
                                   void *(*native_copy)(void *, const void *, size_t));

#endif

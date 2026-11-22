#ifndef TRAP_FLOOR_MARKER_H
#define TRAP_FLOOR_MARKER_H
#include "../floor_marker.h"

static void (*original_trap_floor_pass)(void *, void *);

static void hook_trap_floor_pass(void *unit, void *draw) {
    original_trap_floor_pass(unit, draw);
    if (!traps_enabled || !trap_floor_enabled || !draw || !trap_world.battle_key) return;
    void *battle = trap_native_battle();
    const int index = trap_live_actor(battle, unit);
    if (index < 0) return;
    /* The native pass runs per unit. Draw the field's traps once. */
    byte *units = pointer(battle, 0x1b48);
    for (int i = 0; i < index; ++i)
        if (units[i * 0x7d0 + 0x10]) return;
    if (!((byte *)unit)[0x10]) return;
    for (unsigned i = 0; i < TRAP_CAPACITY; ++i) {
        TrapMarker marker;
        if (trap_marker_for(trap_world.slots + i, 1, &marker)) {
            const uint32_t color = trap_world.slots[i].owner_team == 2 ? 0xa0ff50c0u : 0xa0ffff40u;
            tor_draw_floor_marker(base, draw, marker.tile.x, marker.tile.y, 0.475f, color);
        }
    }
}
#endif

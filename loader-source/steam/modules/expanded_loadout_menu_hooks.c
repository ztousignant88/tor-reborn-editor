/* Steam 1.0.8. Install together with menu_layout.dat and menu_parts.dat from
 * the eight-slot compiler. Leave disabled while validating battle readers. */
#include "expanded_loadout_commands.c"
#include "expanded_loadout_edit.c"
#include "expanded_loadout_menu.c"
#include "expanded_loadout_battle.c"
#include "expanded_loadout_entry.c"

typedef struct {
    uint32_t site, native, resume;
    void *target;
    uint8_t expected[12], enter[20], leave[20];
    uint8_t size, enter_size, leave_size;
} LoadoutJump;

#define LOADOUT_CALL(site, original, handler) {site, original, 0, (void *)(handler), {0}, {0}, {0}, 5, 0, 0}
#define LOADOUT_WORD_CHANGE(site, before, after) {site, 4, {before & 0xff, before >> 8}, {after & 0xff, after >> 8}}
#define LOADOUT_BYTE_CHANGE(site, before, after) {site, 1, {before}, {after}}
#define LOADOUT_ROUTE_ROW(first, a, b, c, d) \
    LOADOUT_BYTE_CHANGE(first, a, a + LOADOUT_STOCK), \
    LOADOUT_BYTE_CHANGE(first + 0x14, b, b + LOADOUT_STOCK), \
    LOADOUT_BYTE_CHANGE(first + 0x28, c, c + LOADOUT_STOCK), \
    LOADOUT_BYTE_CHANGE(first + 0x3c, d, d + LOADOUT_STOCK)

static const LoadoutJump loadout_menu_jumps[] = {
    LOADOUT_CALL(0x525571, 0x266360, loadout_resolve_grid),
    LOADOUT_CALL(0x525f11, 0x266360, loadout_resolve_grid),
    /* R9 carries the selected unit for the added bank. The stock path has
     * already placed the icon buffer, output entry and index in RCX/RDX/R8. */
    {0x525720, 0x43f830, 0, (void *)loadout_spell_icon, {0}, {0x49, 0x89, 0xe9}, {0}, 5, 3, 0},
    {0x52613b, 0x43f830, 0, (void *)loadout_skill_icon, {0}, {0x4d, 0x89, 0xf1}, {0}, 5, 3, 0},

    /* Spell/skill confirm branches share a dialog in R14 and new ID in R15. */
    {0x51e3f0, 0, 0x51e7ce, (void *)loadout_picker_equip,
     {0x49,0x8b,0x9e,0xd0,0x07,0,0}, {0x4c,0x89,0xf1,0x44,0x89,0xfa}, {0}, 7, 6, 0},
    {0x51e46f, 0, 0x51e7ce, (void *)loadout_picker_equip,
     {0x48,0x8d,0x55,0x07,0x49,0x8b,0x8e,0xd0,0x07,0,0}, {0x4c,0x89,0xf1,0x44,0x89,0xfa}, {0}, 11, 6, 0},

    /* Picker focus: look up a scalar ID, then reuse the stock button state. */
    {0x51e15c, 0, 0x51e1e7, (void *)loadout_picker_current,
     {0x48,0x8b,0x8b,0xd0,0x07,0,0}, {0x48,0x89,0xd9}, {0x0f,0xb7,0xf8}, 7, 3, 3},
    {0x51e1b0, 0, 0x51e1e7, (void *)loadout_picker_current,
     {0x48,0x8b,0x8b,0xd0,0x07,0,0}, {0x48,0x89,0xd9}, {0x0f,0xb7,0xf8}, 7, 3, 3},
    {0x51f870, 0, 0x51f88b, (void *)loadout_picker_knows_skill,
     {0x48,0x8d,0x55,0xf8,0x48,0x8b,0x8e,0xd0,0x07,0,0}, {0x48,0x89,0xf1,0x89,0xda}, {0}, 11, 5, 0},

    LOADOUT_CALL(0x51c645, 0x51be60, loadout_picker_matches),
    LOADOUT_CALL(0x51ed76, 0x51be60, loadout_picker_matches),
    LOADOUT_CALL(0x51f78c, 0x43f980, loadout_knows_spell),
    LOADOUT_CALL(0x52021e, 0x43f980, loadout_knows_spell),
    LOADOUT_CALL(0x31e85e, 0x43f980, loadout_knows_spell),
    LOADOUT_CALL(0x463f9c, 0x43f980, loadout_knows_spell),

    LOADOUT_CALL(0x525a0f, 0x4eb1a0, loadout_menu_changes),
    LOADOUT_CALL(0x525b97, 0x4eb1a0, loadout_menu_changes),
    LOADOUT_CALL(0x5264e0, 0x4eb1a0, loadout_menu_changes),
    LOADOUT_CALL(0x526612, 0x4eb1a0, loadout_menu_changes),
    LOADOUT_CALL(0x525a1c, 0x354120, loadout_clear_spells),
    LOADOUT_CALL(0x525ba6, 0x43f660, loadout_clear_spell),
    LOADOUT_CALL(0x51c6b4, 0x43f660, loadout_clear_spell),
    LOADOUT_CALL(0x4697d4, 0x447d10, loadout_clear_skills),
    LOADOUT_CALL(0x52661d, 0x469aa0, loadout_remove_skill),
    LOADOUT_CALL(0x51c6c9, 0x469aa0, loadout_remove_skill),
    LOADOUT_CALL(0x51edac, 0x469aa0, loadout_remove_skill),
    LOADOUT_CALL(0x51eded, 0x46a4b0, loadout_equip_skill),
    /* Battle command paths with space for at least eight output IDs. */
    LOADOUT_CALL(0x422dff, 0x43f910, loadout_collect_spells),
    LOADOUT_CALL(0x423373, 0x3bfb20, loadout_collect_active_skills),
    LOADOUT_CALL(0x422326, 0x3c0880, loadout_collect_special_skills),
    LOADOUT_CALL(0x423619, 0x3c0880, loadout_collect_special_skills),
    LOADOUT_CALL(0x3c23a6, 0x3c0880, loadout_collect_special_skills),
    LOADOUT_CALL(0x3c20d7, 0x3c24a0, loadout_ai_spells),
    LOADOUT_CALL(0x44c404, 0x44c790, loadout_collect_automatic),
    LOADOUT_CALL(0x3c8eae, 0x43f980, loadout_knows_spell),
    LOADOUT_CALL(0x3c8ec3, 0x43f980, loadout_knows_spell),
    LOADOUT_CALL(0x4452f9, 0x43f9f0, loadout_has_book),
    LOADOUT_CALL(0x445358, 0x43f9f0, loadout_has_book),
    LOADOUT_CALL(0x445569, 0x43f9f0, loadout_has_book),
    LOADOUT_CALL(0x33176c, 0x4488e0, loadout_has_skill_family),
    LOADOUT_CALL(0x340ae5, 0x4488e0, loadout_has_skill_family),
    LOADOUT_CALL(0x36c2cb, 0x448890, loadout_has_active_skill),
    LOADOUT_CALL(0x332413, 0x448200, loadout_skill_details),
    LOADOUT_CALL(0x333785, 0x448200, loadout_skill_details),
    LOADOUT_CALL(0x333ce9, 0x448200, loadout_skill_details),
    LOADOUT_CALL(0x333ea3, 0x448200, loadout_skill_details),
    LOADOUT_CALL(0x334636, 0x448200, loadout_skill_details),
    LOADOUT_CALL(0x330774, 0x448b30, loadout_recheck_weapon_skills),
    LOADOUT_CALL(0x3348bd, 0x447750, loadout_weapon_skill_rewards),
    LOADOUT_CALL(0x330605, 0x447bb0, loadout_swap_skill_records),
    /* The class-change loop reads one raw record per iteration. */
    LOADOUT_CALL(0x4411f3, 0x43fb50, loadout_restrict_spellbooks),
    LOADOUT_CALL(0x441219, 0x448460, loadout_raw_skill),
    LOADOUT_CALL(0x4412ab, 0x447d40, loadout_clear_skill_record),
    LOADOUT_CALL(0x4414e9, 0x448460, loadout_raw_skill),
    LOADOUT_CALL(0x441535, 0x447d40, loadout_clear_skill_record),
    LOADOUT_CALL(0x469a59, 0x448460, loadout_raw_skill),
    LOADOUT_CALL(0x469a77, 0x469aa0, loadout_remove_skill),
    LOADOUT_CALL(0x446ac8, 0x333690, loadout_skill_id_at),
    LOADOUT_CALL(0x3ccc3c, 0x333690, loadout_skill_id_at),
    LOADOUT_CALL(0x335e3d, 0x448cc0, loadout_entry),
    /* The stock stat calculators sum four passive contributions from fixed
     * locals. Add the extra bank's total to one local before the native sum. */
    {0x389b5d, 0, 0x389b66, (void *)loadout_extra_passive_bonus,
     {0x48,0x8b,0x45,0x77,0x4c,0x8b,0x7c,0x24,0x30},
     {0x4c,0x89,0xe9,0x48,0x8d,0x56,0x7c,0x41,0xb8,16,0,0,0},
     {0x01,0x45,0xc7,0x48,0x8b,0x45,0x77,0x4c,0x8b,0x7c,0x24,0x30}, 9, 13, 12},
    {0x38ad27, 0, 0x38ad31, (void *)loadout_extra_passive_bonus,
     {0x33,0xc0,0x48,0x89,0x84,0x24,0x98,0,0,0},
     {0x4c,0x89,0xf9,0x48,0x8b,0x54,0x24,0x20,0x48,0x83,0xc2,0x5a,0x41,0xb8,5,0,0,0},
     {0x01,0x84,0x24,0xc0,0,0,0,0x33,0xc0,0x48,0x89,0x84,0x24,0x98,0,0,0}, 10, 18, 17},
    {0x38ba1e, 0, 0x38ba23, (void *)loadout_extra_passive_bonus,
     {0x48,0x8b,0x5c,0x24,0x30},
     {0x4c,0x89,0xe9,0x48,0x8b,0x54,0x24,0x20,0x48,0x83,0xc2,0x56,0x41,0xb8,9,0,0,0},
     {0x01,0x45,0xff,0x48,0x8b,0x5c,0x24,0x30}, 5, 18, 8},
};

static const struct {
    uint32_t site;
    uint8_t size, before[4], after[4];
} loadout_menu_changeset[] = {
    /* Object allocation, allocator registration, zeroing and sized release. */
    LOADOUT_WORD_CHANGE(0x525414, 0x310, 0x318),
    LOADOUT_WORD_CHANGE(0x525429, 0x310, 0x318),
    LOADOUT_WORD_CHANGE(0x525443, 0x310, 0x318),
    LOADOUT_WORD_CHANGE(0x524827, 0x310, 0x318),
    LOADOUT_WORD_CHANGE(0x525ca4, 0x320, 0x328),
    LOADOUT_WORD_CHANGE(0x525cb9, 0x320, 0x328),
    LOADOUT_WORD_CHANGE(0x525cd3, 0x320, 0x328),
    LOADOUT_WORD_CHANGE(0x525c57, 0x320, 0x328),
    LOADOUT_BYTE_CHANGE(0x52579e, 4, 8),
    LOADOUT_BYTE_CHANGE(0x526261, 4, 8),
    LOADOUT_BYTE_CHANGE(0x4412b4, 4, 8),
    LOADOUT_BYTE_CHANGE(0x44155c, 4, 8),
    LOADOUT_BYTE_CHANGE(0x469a80, 4, 8),
    LOADOUT_BYTE_CHANGE(0x446ae7, 4, 8),
    LOADOUT_BYTE_CHANGE(0x3ccd2a, 4, 8),
    /* Unit Details' section dispatcher uses 20-byte routes separate from
     * each grid's row navigation. Keep the stock direction and column, and
     * put each link on the bottom row of the expanded section. */
    LOADOUT_ROUTE_ROW(0xca37a4, 0, 1, 2, 3), /* Down from Spells: source slot. */
    LOADOUT_ROUTE_ROW(0xca3858, 0, 1, 2, 3), /* Down from Skills: source slot. */
    LOADOUT_ROUTE_ROW(0xca3814, 0, 1, 2, 3), /* Up from Skills: destination spell slot. */
    LOADOUT_ROUTE_ROW(0xca38dc, 0, 1, 2, 3), /* Up from Finishers: destination skill slot. */
};

#undef LOADOUT_CALL
#undef LOADOUT_WORD_CHANGE
#undef LOADOUT_BYTE_CHANGE
#undef LOADOUT_ROUTE_ROW

static void loadout_native_branch(uint8_t out[5], uint8_t opcode, const void *at, const void *target) {
    const int32_t delta = (int32_t)((intptr_t)target - ((intptr_t)at + 5));
    out[0] = opcode;
    memcpy(out + 1, &delta, sizeof(delta));
}

static int loadout_install_menu_hooks(int equipment_sets_controls_commands) {
    enum {
        JUMPS = sizeof(loadout_menu_jumps) / sizeof(*loadout_menu_jumps),
        BYTES = sizeof(loadout_menu_changeset) / sizeof(*loadout_menu_changeset),
        RELAY_SIZE = 64,
    };
    _Static_assert(JUMPS * RELAY_SIZE <= 4096, "Expanded loadout relays exceed one page");
    uint8_t before[JUMPS][12];
    for (unsigned i = 0; i < JUMPS; ++i) {
        const LoadoutJump *jump = &loadout_menu_jumps[i];
        if (equipment_sets_controls_commands && jump->site == 0x423373) continue;
        const uint8_t *site = mm_base + jump->site;
        if (jump->native) loadout_native_branch(before[i], 0xe8, site, mm_base + jump->native);
        else memcpy(before[i], jump->expected, jump->size);
        if (memcmp(site, before[i], jump->size)) return 0;
    }
    for (unsigned i = 0; i < BYTES; ++i) {
        if (memcmp(mm_base + loadout_menu_changeset[i].site, loadout_menu_changeset[i].before,
                   loadout_menu_changeset[i].size)) return 0;
    }
    uint8_t *relays = mm_near_page();
    if (!relays) return 0;
    for (unsigned i = 0; i < JUMPS; ++i) {
        const LoadoutJump *jump = &loadout_menu_jumps[i];
        uint8_t *code = relays + i * RELAY_SIZE;
        memcpy(code, jump->enter, jump->enter_size);
        code += jump->enter_size;
        if (!jump->resume) {
            mm_abs_jump(code, jump->target);
            continue;
        }
        /* Frame relays run in the native function's existing call frame.
         * Call through an indirect slot, then jump to a known continuation. */
        static const uint8_t indirect_call[] = {0xff, 0x15, 0, 0, 0, 0};
        memcpy(code, indirect_call, sizeof(indirect_call));
        const int32_t offset = RELAY_SIZE - sizeof(jump->target) - jump->enter_size - sizeof(indirect_call);
        memcpy(code + 2, &offset, sizeof(offset));
        memcpy(relays + (i + 1) * RELAY_SIZE - sizeof(jump->target), &jump->target, sizeof(jump->target));
        code += sizeof(indirect_call);
        memcpy(code, jump->leave, jump->leave_size);
        mm_abs_jump(code + jump->leave_size, mm_base + jump->resume);
    }
    FlushInstructionCache(GetCurrentProcess(), relays, JUMPS * RELAY_SIZE);
    unsigned j = 0, b = 0;
    int rollback = 1;
    while (j < JUMPS) {
        const LoadoutJump *jump = &loadout_menu_jumps[j];
        uint8_t *site = mm_base + jump->site;
        if (equipment_sets_controls_commands && jump->site == 0x423373) {
            ++j;
            continue;
        }
        uint8_t patch[12];
        memset(patch, 0x90, sizeof(patch));
        loadout_native_branch(patch, jump->resume ? 0xe9 : 0xe8, site, relays + j * RELAY_SIZE);
        ++j;
        if (!mm_write(site, patch, jump->size)) goto restore;
    }
    while (b < BYTES) {
        const unsigned i = b++;
        if (!mm_write(mm_base + loadout_menu_changeset[i].site, loadout_menu_changeset[i].after,
                      loadout_menu_changeset[i].size)) goto restore;
    }
    return 1;

restore:
    while (b) {
        --b;
        if (!mm_write(mm_base + loadout_menu_changeset[b].site, loadout_menu_changeset[b].before,
                      loadout_menu_changeset[b].size)) rollback = 0;
    }
    while (j) {
        --j;
        if (equipment_sets_controls_commands && loadout_menu_jumps[j].site == 0x423373) continue;
        if (!mm_write(mm_base + loadout_menu_jumps[j].site, before[j], loadout_menu_jumps[j].size)) rollback = 0;
    }
    if (rollback) VirtualFree(relays, 0, MEM_RELEASE);
    return 0;
}

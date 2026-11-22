/* The native army serial survives the copy into the deployment slot.
 * The intervening index changes when the unit moves between those tables. */
static unsigned vs_spectator_template, vs_spectator_serial;
static int vs_have_spectator_identity;

static int vs_same_spectator(const uint8_t *character) {
    return vs_have_spectator_identity && mm_readable(character, 8) &&
           vs_u16(character) == vs_spectator_template &&
           vs_u32(character + 4) == vs_spectator_serial;
}

static uint8_t *vs_formation_spectator(const uint8_t *ui, unsigned *selected) {
    const unsigned count = ui[0x9dc];
    uint8_t *found = NULL, *first = NULL, *picked = NULL;
    *selected = 0;
    if (!count || count > 100) return NULL;
    for (unsigned i = 0; i < count; ++i) {
        uint8_t *row, *character;
        memcpy(&row, ui + 0x250 + i * 8, sizeof row);
        if (!mm_readable(row, 0xf4)) return NULL;
        const unsigned flags = vs_u16(row + 0xf2);
        *selected += (flags & 2) != 0;
        memcpy(&character, row + 0xe0, sizeof character);
        const int same = vs_same_spectator(character);
        if (same && found) return NULL;
        if (!mm_readable(character, 8) || (flags & 0xa0)) continue;
        if (!first) first = row;
        if (flags & 2) picked = row;
        if (same) found = row;
    }
    if (vs_auto_deploy == VS_DEPLOY_OPENING)
        return *selected ? picked : found ? found : first;
    return found;
}

static int vs_place_spectator(uint8_t *picker, uint8_t *row) {
    uint8_t (*place)(uint8_t *, uint8_t *, const int16_t *) = (void *)(mm_base + 0x4fb7b0);
    const uint8_t *starts = mm_base + 0xca2988;
    for (unsigned i = 0; i < 12; ++i) {
        uint8_t *cell, *occupant;
        memcpy(&cell, picker + 0x258 + i * 8, sizeof cell);
        if (!mm_readable(cell, 0x34a)) return 0;
        memcpy(&occupant, cell + 0x230, sizeof occupant);
        if (occupant) continue;
        const int16_t tile[] = {(int8_t)cell[0x348], (int8_t)cell[0x349]};
        if (tile[0] < 0 || tile[1] < 0) continue;
        for (unsigned j = 0; j < 12; ++j)
            if (!memcmp(starts + 4 * j, tile, sizeof tile))
                return place(picker, row, tile);
    }
    return 0;
}

static void vs_try_deploy(uint8_t *ui) {
    uint8_t *active, *dialog;
    memcpy(&active, mm_base + 0xf335d0, sizeof active);
    if (ui != active || !mm_readable(ui, 0x9ed) || !vs_is_training() ||
        !vs_auto_deploy || !vs_match_bytes || !vs_stage_row())
        return;
    memcpy(&dialog, mm_base + 0xecada8, sizeof dialog);
    if (vs_deployment_dialog) {
        if (!mm_readable(dialog, 0x400) || dialog != vs_deployment_dialog || ui[0x9d9] != 2) {
            vs_deployment_dialog = NULL;
            vs_auto_deploy = 0;
            vs_set_round_card(0, 0);
            return;
        }
        /* The message box copies the native choice value in state 5,
         * then closes normally. Zero means Yes, 0xffff means pending. */
        if (vs_u32(dialog + 0x330) == 5) {
            uint8_t *choice;
            memcpy(&choice, dialog + 0x3f8, sizeof choice);
            if (mm_readable(choice, 16) && vs_u32(choice + 0x0c) == 2 &&
                vs_u32(choice) == 0xffff) {
                const uint32_t yes = 0;
                memcpy(choice, &yes, sizeof yes);
                mm_log(vs_auto_deploy == VS_DEPLOY_OPENING ?
                       "Versus: confirmed the opening spectator automatically.\r\n" :
                       "Versus: confirmed the same spectator for the next round.\r\n");
            } else
                vs_set_round_card(0, 0);
            vs_deployment_dialog = NULL;
            vs_auto_deploy = 0;
        }
        return;
    }
    uint8_t *picker;
    memcpy(&picker, ui + 0x5c0, sizeof picker);
    if (dialog && ui[0x9d8] == 1)
        vs_set_round_card(0, 0);
    if (dialog || ui[0x9d8] != 1 || ui[0x9d9] != 0x0b || !mm_readable(picker, 0x2f6) ||
        (picker[0x2f0] != 2 && picker[0x2f0] != 3))
        return;

    unsigned selected;
    uint8_t *row = vs_formation_spectator(ui, &selected);
    const int selected_spectator = row && (row[0xf2] & 2);
    if (!row || selected > (unsigned)selected_spectator ||
        (!selected_spectator && !vs_place_spectator(picker, row))) {
        vs_auto_deploy = 0;
        vs_set_round_card(0, 0);
        mm_log("Versus: choose a spectator manually to continue.\r\n");
        return;
    }
    /* Formation's Battle command checks the picked units and commits their
     * coordinates through the same path as a manual deployment. */
    const uint32_t command = 0x74;
    ((int (*)(uint8_t *, const uint32_t *))(mm_base + 0x491ff0))(ui, &command);
    memcpy(&dialog, mm_base + 0xecada8, sizeof dialog);
    if (ui[0x9d9] == 2 && dialog)
        vs_deployment_dialog = dialog;
    else {
        vs_auto_deploy = 0;
        vs_set_round_card(0, 0);
    }
}

static void vs_formation_tick(uint8_t *ui, int index, unsigned mode) {
    ((void (*)(uint8_t *, int, unsigned))(mm_base + 0x495bc0))(ui, index, mode);
    vs_try_deploy(ui);
}

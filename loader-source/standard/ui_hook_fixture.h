static unsigned char mm_ui_hook(unsigned char on){
    // Automatic scene/UI updates must not advance the speed cycle. They can
    // temporarily remove the extra timing, which the next active battle tick
    // reapplies from the selected state.
    if (!on) {
        ff_battle_active = 0;
        InterlockedExchange(&mm_caption_dirty, 1);
        ff_refresh();
    }
    unsigned char result=mm_original_ui(on);
    return result;
}
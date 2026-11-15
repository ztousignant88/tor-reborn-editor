#ifndef SHARED_STEAL_BALANCE_H
#define SHARED_STEAL_BALANCE_H

/* Indexed by theft role. Later directed steals are harder. Both the preview
 * and the committed action use the battle units' derived Dexterity. */
static int steal_hit_percent(int role, unsigned source_dex, unsigned target_dex) {
    static const unsigned char base[] = {43, 30, 35, 37, 39, 41, 42, 33, 44, 45};
    if (role < 0 || (unsigned)role >= sizeof(base)) return 0;
    int adjustment = ((int)source_dex - (int)target_dex) / 8;
    if (adjustment < -15) adjustment = -15;
    if (adjustment > 15) adjustment = 15;
    return base[role] + adjustment;
}

#endif

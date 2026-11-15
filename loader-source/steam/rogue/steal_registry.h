#ifndef STEAL_REGISTRY_H
#define STEAL_REGISTRY_H
enum { THEFT_NONE=-1,THEFT_GENERAL=0,THEFT_WEAPON=1,THEFT_ARMOR=2,THEFT_SHIELD=3,
       THEFT_HELMET=4,THEFT_GAUNTLET=5,THEFT_BOOTS=6,THEFT_ACCESSORY=7,THEFT_LOOT=8,THEFT_GOLD=9 };
enum { STEAL_MODE_RANDOM=1,STEAL_MODE_WEAPON_LAST=2,STEAL_MODE_CATEGORIES=3,STEAL_MODE_COMBINED=4 };
typedef struct { uint16_t skill,effect;int role;const char *name,*asset; } TheftSkill;
/* Zeroed removed-action records; the data compiler checks every destination.
 * Preserve original Steal and all seven prior Rogue restoration identities. */
static const TheftSkill theft_skills[]={
 {228,508,THEFT_GENERAL,"Steal","steal_equipment"},
 {243,523,THEFT_WEAPON,"Steal Weapon","steal_weapon"},
 {244,524,THEFT_ARMOR,"Steal Armor","steal_armor"},
 {245,525,THEFT_SHIELD,"Steal Shield","steal_shield"},
 {246,526,THEFT_HELMET,"Steal Helmet","steal_helmet"},
 {247,527,THEFT_GAUNTLET,"Steal Gauntlet","steal_gauntlet"},
 {248,528,THEFT_BOOTS,"Steal Boots","steal_boots"},
 {249,529,THEFT_ACCESSORY,"Steal Accessory","steal_accessory"},
 {250,530,THEFT_LOOT,"Steal Loot","steal_loot"},
 {272,552,THEFT_GOLD,"Steal Gold","steal_gold"}
};
static int steal_mode=STEAL_MODE_COMBINED;
static int theft_role(uint16_t skill,uint16_t effect) {
    for(unsigned i=0;i<sizeof(theft_skills)/sizeof(theft_skills[0]);++i)
        if(theft_skills[i].skill==skill && theft_skills[i].effect==effect)return theft_skills[i].role;
    return THEFT_NONE;
}
static int theft_role_enabled(int role) {
    if(role<0)return 0;
    if(steal_mode==STEAL_MODE_COMBINED)return role<=THEFT_GOLD;
    if(role==THEFT_LOOT || role==THEFT_GOLD)return 1;
    return role==THEFT_GENERAL?steal_mode!=STEAL_MODE_CATEGORIES:steal_mode==STEAL_MODE_CATEGORIES;
}
#endif

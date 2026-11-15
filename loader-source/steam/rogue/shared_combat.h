#ifndef SHARED_COMBAT_H
#define SHARED_COMBAT_H

typedef struct {
    unsigned char (*action)(void *, void *, void *, unsigned char);
    void (*build)(void *);
    void *(*destroy)(void *, unsigned);
} CombatHooks;

const CombatHooks *rr_attach_combat(void *module, const CombatHooks *native);
int throw_attach_rogues(void *module);

#endif

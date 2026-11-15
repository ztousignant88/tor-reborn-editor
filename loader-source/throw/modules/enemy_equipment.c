#define EE_DEPLOY 0x340ba0
#define EE_UNIT_LEVEL 0x330dc0
#define EE_ELIGIBLE 0x441370
#define EE_REFRESH 0x32d7f0
#define EE_CLASS_TABLE 0xd78e78
#define EE_GENERATE 0x441180
#define EE_LEVEL_POOL 0x3993a0
#define EE_EQUIPMENT_TABLE 0xd78e48
/* Keep the native battle generator and replace only its equipment scores. */
#include "equipment_bank.h"

enum { EE_POOL_CAP = 0x736, EE_SCORE_STRIDE = EQUIPMENT_CAP + 1 };
typedef struct {
    uint16_t ids[EE_POOL_CAP];
    uint32_t count;
} EePool;
_Static_assert(offsetof(EePool, count) == 0xe6c, "Native pool layout");

typedef struct {
    uint16_t priority[EQUIPMENT_CAP];
} EeRoll;
static _Thread_local const EeRoll *ee_active;
#include "enemy_equipment_pool_rules.c"

static void ee_roll_priorities(EeRoll *roll, uint32_t seed) {
    if (!seed)
        seed = 1;
    for (unsigned id = 0; id < EQUIPMENT_CAP; ++id)
        roll->priority[id] = (uint16_t)(id + 1);
    for (unsigned i = EQUIPMENT_CAP - 1; i > 0; --i) {
        unsigned j = es_choose(&seed, i + 1);
        uint16_t swap = roll->priority[i];
        roll->priority[i] = roll->priority[j];
        roll->priority[j] = swap;
    }
}

__attribute__((used, noinline)) static int ee_score(const uint8_t *row, int native_score, unsigned id) {
    const EeRoll *roll = ee_active;
    if (!roll || !(ee_options & EE_RANDOM) || id >= EQUIPMENT_CAP)
        return native_score;
    return ee_minimum(row, id) * EE_SCORE_STRIDE + roll->priority[id];
}

__attribute__((used, noinline)) static uintptr_t ee_generate(uint8_t *unit, const uint8_t *entry,
                                                               const uint32_t *battle_seed) {
    typedef uintptr_t (*Generate)(uint8_t *, const uint8_t *);
    Generate native = (Generate)(mm_base + EE_GENERATE);
    const EeRoll *parent = ee_active;
    EeRoll roll;
    ee_active = NULL;
    if (unit[0x50] == 2) {
        // Use the game's battle RNG state without advancing it. A recreated
        // unit gets the same roll when the game reuses the same seed.
        uint32_t seed = *battle_seed ^ ((uint32_t)es_word(entry + 2) << 16)
                      ^ es_word(entry + 0xa) ^ ((uint32_t)entry[6] << 24);
        ee_roll_priorities(&roll, seed);
        ee_active = &roll;
    }
    uintptr_t result = native(unit, entry);
    if (ee_active)
        ee_fill_accessory(unit, entry, &roll);
    ee_active = parent;
    return result;
}

static EePool *ee_level_pool(EePool *pool, int level) {
    typedef EePool *(*LevelPool)(EePool *, int);
    EePool *result = ((LevelPool)(mm_base + EE_LEVEL_POOL))(pool, level);
    if (!ee_active)
        return result;
    const EsTable table = es_table(EE_EQUIPMENT_TABLE, 152);
    if (!table.rows || table.stride != 152)
        return result;
    result->count = 0;
    for (unsigned id = 1; id < table.count && id < EQUIPMENT_FIRST + EQUIPMENT_COUNT; ++id) {
        const uint8_t *row = table.rows + id * table.stride;
        if (!ee_in_pool(row, id, level) ||
            (id >= EQUIPMENT_FIRST && !equipment_has_added_definition((uint16_t)id)))
            continue;
        if (result->count >= EE_POOL_CAP)
            break;
        result->ids[result->count++] = (uint16_t)id;
    }
    return result;
}

__attribute__((naked, used)) static void ee_generate_bridge(void) {
    __asm__("mov %r15,%r8\n\tjmp ee_generate");
}

// These sites are inside native loops. Preserve volatile registers and the
// original comparison, including outside the scoped enemy generation call.
#define EE_CALL_SCORE(row, id) \
    "push %rcx\n\tpush %rdx\n\tpush %r8\n\tpush %r9\n\tpush %r10\n\tpush %r11\n\t" \
    "sub $0x88,%rsp\n\t" \
    "movdqu %xmm0,0x20(%rsp)\n\tmovdqu %xmm1,0x30(%rsp)\n\tmovdqu %xmm2,0x40(%rsp)\n\t" \
    "movdqu %xmm3,0x50(%rsp)\n\tmovdqu %xmm4,0x60(%rsp)\n\tmovdqu %xmm5,0x70(%rsp)\n\t" \
    "mov " row ",%rcx\n\tmov %eax,%edx\n\tmovzwl " id ",%r8d\n\tcall ee_score\n\t" \
    "movdqu 0x20(%rsp),%xmm0\n\tmovdqu 0x30(%rsp),%xmm1\n\tmovdqu 0x40(%rsp),%xmm2\n\t" \
    "movdqu 0x50(%rsp),%xmm3\n\tmovdqu 0x60(%rsp),%xmm4\n\tmovdqu 0x70(%rsp),%xmm5\n\t" \
    "add $0x88,%rsp\n\tpop %r11\n\tpop %r10\n\tpop %r9\n\tpop %r8\n\tpop %rdx\n\tpop %rcx\n\t"

__attribute__((naked, used)) static void ee_armor_bridge(void) {
    __asm__("movzbl 0x1a(%rbp),%eax\n\t" EE_CALL_SCORE("%rbp", "%di") "cmp %eax,%r14d\n\tret");
}
__attribute__((naked, used)) static void ee_shield_bridge(void) {
    __asm__("movzbl 0x1a(%rsi),%eax\n\t" EE_CALL_SCORE("%rsi", "%di") "cmp %eax,%r15d\n\tret");
}
__attribute__((naked, used)) static void ee_weapon_bridge(void) {
    __asm__(EE_CALL_SCORE("%rbp", "%bx")
            "cmp %eax,%r12d\n\tjge 1f\n\tmov %eax,%r12d\n\tmovzwl %bx,%r13d\n\t1: ret");
}
#undef EE_CALL_SCORE
#include "enemy_force_crest.c"
#include "enemy_equipment_sites.h"

static void mm_install_enemy_equipment(const wchar_t *config) {
    unsigned options = 0;
    if (GetPrivateProfileIntW(L"EnemyEquipment", L"Randomize", 0, config)) options |= EE_RANDOM;
    if (GetPrivateProfileIntW(L"EnemyEquipment", L"Gear", 0, config)) options |= EE_GEAR;
    if (GetPrivateProfileIntW(L"EnemyEquipment", L"RareGear", 0, config)) options |= EE_RARE;
    if (GetPrivateProfileIntW(L"EnemyEquipment", L"Accessories", 0, config)) options |= EE_ACCESSORIES;
    if (GetPrivateProfileIntW(L"EnemyEquipment", L"MovementGear", 0, config)) options |= EE_MOVEMENT;
    if (GetPrivateProfileIntW(L"EnemyEquipment", L"ForceCrest", 0, config)) options |= EE_FORCE_CREST;
    if (GetPrivateProfileIntW(L"EnemyEquipment", L"HeavenlyWeapons", 0, config)) options |= EE_HEAVENLY;
    options |= ee_read_overrides(config);
    if (!options)
        return;
    const unsigned first = options & ~EE_FORCE_CREST ? 0 : EE_DEPLOY_FIRST;
    const unsigned end = options & EE_FORCE_CREST ? sizeof(ee_sites) / sizeof(ee_sites[0]) : EE_DEPLOY_FIRST;
    for (unsigned i = first; i < end; ++i) {
        if (memcmp(mm_base + ee_sites[i].rva, ee_sites[i].before, ee_sites[i].length)) {
            mm_log("Enemy equipment: native auto-loadout code differs.\r\n");
            return;
        }
    }
    uint8_t *relay = mm_near_page();
    if (!relay) {
        mm_log("Enemy equipment: relay allocation failed.\r\n");
        return;
    }
    for (unsigned i = first; i < end; ++i)
        mm_abs_jump(relay + i * 16, ee_sites[i].callback);
    FlushInstructionCache(GetCurrentProcess(), relay + first * 16, (end - first) * 16);
    for (unsigned i = first; i < end; ++i) {
        const unsigned length = ee_sites[i].length;
        uint8_t *site = mm_base + ee_sites[i].rva;
        uint8_t patch[sizeof(ee_sites[0].before)];
        memset(patch, 0x90, length);
        patch[0] = 0xe8;
        int32_t displacement = (int32_t)((intptr_t)(relay + i * 16) - (intptr_t)(site + 5));
        memcpy(patch + 1, &displacement, sizeof displacement);
        if (!mm_write(site, patch, length)) {
            for (unsigned j = first; j <= i; ++j)
                mm_write(mm_base + ee_sites[j].rva, ee_sites[j].before, ee_sites[j].length);
            mm_log("Enemy equipment: patch failed.\r\n");
            return;
        }
    }
    ee_options = options;
    mm_log("Enemy equipment: custom auto-loadout options installed.\r\n");
}

/* Isolated prototype. Callers own one bank per inventory or snapshot. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "equipment_bank.h"

#define API EQUIPMENT_API

enum {
    OWNER_SIZE = 16,
    HEADER_SIZE = 8 + OWNER_SIZE,
    BANK_SIZE = 2 * EQUIPMENT_COUNT,
    SECTION_SIZE = HEADER_SIZE + BANK_SIZE,
    SUSPEND_HEADER_SIZE = HEADER_SIZE + 8,
    SUSPEND_MAX_SIZE = SUSPEND_HEADER_SIZE + (2 + HISTORY_SLOTS) * BANK_SIZE,
    SAVE_HEADER_SIZE = 0x40,
    CHUNK_HEADER_SIZE = 16
};

static const uint8_t header[8] = {'E', 'Q', 'X', '1', 1, 0, EQUIPMENT_COUNT, 0};
static const uint8_t suspend_header[8] = {'E', 'Q', 'X', '1', 2, 0, HISTORY_SLOTS, 0};
static const uint32_t equipment_tag = 0x31585145;
static const uint64_t history_mask = ((uint64_t)1 << HISTORY_SLOTS) - 1;

static uint32_t read_word(const uint8_t *in)
{
    return (uint32_t)in[0] | ((uint32_t)in[1] << 8) |
           ((uint32_t)in[2] << 16) | ((uint32_t)in[3] << 24);
}

static void write_word(uint8_t *out, uint32_t value)
{
    for (unsigned i = 0; i < 4; i++)
        out[i] = (uint8_t)(value >> (8 * i));
}

static int bank_index(uint16_t id)
{
    return id >= EQUIPMENT_FIRST && id < EQUIPMENT_FIRST + EQUIPMENT_COUNT
        ? id - EQUIPMENT_FIRST : -1;
}

API int equipment_count(const EquipmentBank *bank, uint16_t id)
{
    int index = bank_index(id);
    return index < 0 ? -1 : bank->quantities[index];
}

/* The award result uses the native changed and first-acquisition bytes. */
API int equipment_award(EquipmentBank *bank, uint16_t id, int unique)
{
    int index = bank_index(id);
    if (index < 0)
        return -1;
    uint16_t before = bank->quantities[index];
    if (before >= (unique ? 1 : EQUIPMENT_CAP))
        return 0;
    bank->quantities[index] = before + 1;
    return before == 0 ? 0x0101 : 0x0001;
}

/* Return the overflow, matching the stock inventory setter. */
API int equipment_set(EquipmentBank *bank, uint16_t id, uint16_t quantity, int unique)
{
    int index = bank_index(id);
    if (index < 0)
        return -1;
    uint16_t cap = unique ? 1 : EQUIPMENT_CAP;
    uint16_t stored = quantity > cap ? cap : quantity;
    bank->quantities[index] = stored;
    return quantity - stored;
}

API int equipment_remove(EquipmentBank *bank, uint16_t id)
{
    int index = bank_index(id);
    if (index < 0)
        return -1;
    if (bank->quantities[index] == 0)
        return 0;
    bank->quantities[index]--;
    return 1;
}

API size_t equipment_section_size(void)
{
    return SECTION_SIZE;
}

static int write_quantities(const EquipmentBank *bank, uint8_t *out)
{
    for (int i = 0; i < EQUIPMENT_COUNT; i++) {
        uint16_t quantity = bank->quantities[i];
        if (quantity > EQUIPMENT_CAP)
            return 0;
        out[2 * i] = (uint8_t)quantity;
        out[2 * i + 1] = (uint8_t)(quantity >> 8);
    }
    return 1;
}

static int read_quantities(EquipmentBank *bank, const uint8_t *in)
{
    for (int i = 0; i < EQUIPMENT_COUNT; i++) {
        uint16_t quantity = in[2 * i] | ((uint16_t)in[2 * i + 1] << 8);
        if (quantity > EQUIPMENT_CAP)
            return 0;
        bank->quantities[i] = quantity;
    }
    return 1;
}

API int equipment_write(const EquipmentBank *bank, const uint8_t owner[OWNER_SIZE],
                        uint8_t *out, size_t size)
{
    uint8_t quantities[BANK_SIZE];
    if (size != SECTION_SIZE || !write_quantities(bank, quantities))
        return -1;
    memcpy(out, header, sizeof(header));
    memcpy(out + sizeof(header), owner, OWNER_SIZE);
    memcpy(out + HEADER_SIZE, quantities, BANK_SIZE);
    return 1;
}

/* A missing section is an older save. A failed read keeps the current bank. */
API int equipment_read(EquipmentBank *bank, const uint8_t owner[OWNER_SIZE],
                       const uint8_t *in, size_t size)
{
    EquipmentBank decoded = {0};
    if (size == 0) {
        *bank = decoded;
        return 0;
    }
    if (size != SECTION_SIZE || memcmp(in, header, sizeof(header)) != 0 ||
        memcmp(in + sizeof(header), owner, OWNER_SIZE) != 0 ||
        !read_quantities(&decoded, in + HEADER_SIZE))
        return -1;
    *bank = decoded;
    return 1;
}

/* Native sections carry a length that includes their four-byte closing token. */
static int find_section(const uint8_t *save, size_t size, size_t *end,
                        size_t *equipment, size_t *equipment_size, int *mode)
{
    *equipment = 0;
    *equipment_size = 0;
    if (size < SAVE_HEADER_SIZE + CHUNK_HEADER_SIZE || size % 4 != 0)
        return 0;
    size_t at = SAVE_HEADER_SIZE;
    int party = 0, battle = 0;
    while (at <= size - CHUNK_HEADER_SIZE) {
        uint32_t tag = read_word(save + at);
        uint32_t length = read_word(save + at + 4);
        uint32_t token = read_word(save + at + 8);
        if (read_word(save + at + 12) != 0)
            return 0;
        if (tag == 0xffff) {
            *end = at;
            if (mode)
                *mode = party ? battle : -1;
            return length == 0 && token == 0xdeadbeef && at + CHUNK_HEADER_SIZE == size;
        }
        if (tag == 0)
            party = 1;
        if (tag == 3)
            battle = 1;
        size_t body = at + CHUNK_HEADER_SIZE;
        if (length < 4 || length > size - body ||
            read_word(save + body + length - 4) != token)
            return 0;
        if (tag == equipment_tag) {
            if (*equipment)
                return 0;
            *equipment = body;
            *equipment_size = length - 4;
        }
        at = body + length;
        at += (4 - at % 4) % 4;
    }
    return 0;
}

int equipment_payload_mode(const uint8_t *save, size_t size)
{
    size_t end, equipment, equipment_size;
    int mode = -1;
    return find_section(save, size, &end, &equipment, &equipment_size, &mode) ? mode : -1;
}

/* Called after the native writer closes a fresh payload. Zero means no write. */
static size_t append_payload(const uint8_t *payload, size_t length,
                             uint8_t *save, size_t size, size_t capacity)
{
    size_t end, existing, existing_size;
    size_t section_size = CHUNK_HEADER_SIZE + length + 4;
    const uint32_t token = 0x4551424b;
    if (size > capacity || capacity - size < section_size ||
        !find_section(save, size, &end, &existing, &existing_size, NULL) || existing)
        return 0;
    memmove(save + end + section_size, save + end, CHUNK_HEADER_SIZE);
    uint8_t *section = save + end;
    write_word(section, equipment_tag);
    write_word(section + 4, (uint32_t)length + 4);
    write_word(section + 8, token);
    write_word(section + 12, 0);
    memcpy(section + CHUNK_HEADER_SIZE, payload, length);
    write_word(section + section_size - 4, token);
    return size + section_size;
}

API size_t equipment_append(const EquipmentBank *bank, const uint8_t owner[OWNER_SIZE],
                            uint8_t *save, size_t size, size_t capacity)
{
    uint8_t payload[SECTION_SIZE];
    if (equipment_write(bank, owner, payload, sizeof(payload)) != 1)
        return 0;
    return append_payload(payload, sizeof(payload), save, size, capacity);
}

API int equipment_load(EquipmentBank *bank, const uint8_t owner[OWNER_SIZE],
                       const uint8_t *save, size_t size)
{
    size_t end, equipment, length;
    if (!find_section(save, size, &end, &equipment, &length, NULL))
        return -1;
    if (!equipment)
        return equipment_read(bank, owner, NULL, 0);
    if (length != SECTION_SIZE)
        return -1;
    return equipment_read(bank, owner, save + equipment, length);
}

/* Suspend also carries the live battle inventory and the occupied native turns. */
API size_t equipment_append_suspend(const EquipmentBank *party, const EquipmentBank *battle,
                                    const EquipmentHistory *history, const uint8_t owner[OWNER_SIZE],
                                    uint8_t *save, size_t size, size_t capacity)
{
    uint8_t payload[SUSPEND_MAX_SIZE];
    size_t at = SUSPEND_HEADER_SIZE;
    if ((history->occupied & ~history_mask) || !write_quantities(party, payload + at) ||
        !write_quantities(battle, payload + at + BANK_SIZE))
        return 0;
    memcpy(payload, suspend_header, sizeof(suspend_header));
    memcpy(payload + sizeof(suspend_header), owner, OWNER_SIZE);
    write_word(payload + HEADER_SIZE, (uint32_t)history->occupied);
    write_word(payload + HEADER_SIZE + 4, (uint32_t)(history->occupied >> 32));
    at += 2 * BANK_SIZE;
    for (unsigned i = 0; i < HISTORY_SLOTS; i++) {
        if (!(history->occupied & ((uint64_t)1 << i)))
            continue;
        if (!write_quantities(&history->snapshots[i], payload + at))
            return 0;
        at += BANK_SIZE;
    }
    return append_payload(payload, at, save, size, capacity);
}

API int equipment_load_suspend(EquipmentBank *party, EquipmentBank *battle,
                               EquipmentHistory *history, const uint8_t owner[OWNER_SIZE],
                               const uint8_t *save, size_t size)
{
    size_t end, equipment, length;
    if (!find_section(save, size, &end, &equipment, &length, NULL))
        return -1;
    EquipmentBank decoded_party = {0}, decoded_battle = {0};
    EquipmentHistory decoded_history = {0};
    if (equipment) {
        const uint8_t *payload = save + equipment;
        size_t at = SUSPEND_HEADER_SIZE;
        if (length < at + 2 * BANK_SIZE ||
            memcmp(payload, suspend_header, sizeof(suspend_header)) ||
            memcmp(payload + sizeof(suspend_header), owner, OWNER_SIZE))
            return -1;
        decoded_history.occupied = read_word(payload + HEADER_SIZE) |
                                   ((uint64_t)read_word(payload + HEADER_SIZE + 4) << 32);
        if ((decoded_history.occupied & ~history_mask) ||
            !read_quantities(&decoded_party, payload + at) ||
            !read_quantities(&decoded_battle, payload + at + BANK_SIZE))
            return -1;
        at += 2 * BANK_SIZE;
        for (unsigned i = 0; i < HISTORY_SLOTS; i++) {
            if (!(decoded_history.occupied & ((uint64_t)1 << i)))
                continue;
            if (length - at < BANK_SIZE ||
                !read_quantities(&decoded_history.snapshots[i], payload + at))
                return -1;
            at += BANK_SIZE;
        }
        if (at != length)
            return -1;
    }
    *party = decoded_party;
    *battle = decoded_battle;
    *history = decoded_history;
    return equipment != 0;
}

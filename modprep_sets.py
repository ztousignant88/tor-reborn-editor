"""Project-owned equipment bonuses for the shared runtime."""
import struct

FIRST = 7
COUNT = 32
LIMIT = FIRST + COUNT
EQUIPMENT_LIMIT = 761
SKILL_LIMIT = 800
FILE = 'modprep-equipment-sets.bin'


def settings(rows=None):
    if rows is None:
        return []
    if not isinstance(rows, list) or len(rows) > COUNT:
        raise ValueError('Invalid community equipment sets')
    clean, used_ids, used_equipment = [], set(), set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'id', 'name', 'skill', 'members'}:
            raise ValueError('Invalid equipment set record')
        ident, name, skill, members = (row[key] for key in ('id', 'name', 'skill', 'members'))
        if type(ident) is not int or not FIRST <= ident < LIMIT or ident in used_ids:
            raise ValueError('Invalid or duplicate equipment set ID')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ValueError('Equipment set names must be 1–80 characters')
        if type(skill) is not int or not 0 <= skill < SKILL_LIMIT:
            raise ValueError(f'Invalid bonus skill for equipment set {ident}')
        if not isinstance(members, list) or any(type(i) is not int or not 0 < i < EQUIPMENT_LIMIT for i in members):
            raise ValueError(f'Invalid member of equipment set {ident}')
        unique = set(members)
        if len(unique) != len(members) or used_equipment.intersection(unique):
            raise ValueError('Equipment can belong to only one community set')
        if members and not skill:
            raise ValueError('Choose a bonus skill before assigning equipment')
        used_ids.add(ident)
        used_equipment.update(unique)
        clean.append({'id': ident, 'name': name.strip(), 'skill': skill, 'members': sorted(members)})
    return sorted(clean, key=lambda row: row['id'])


def runtime(project, enabled, slot_free=False):
    if not enabled:
        return b''
    rows = [row for row in settings(project.get('editor', {}).get('communityEquipmentSets')) if row['members']]
    if not rows and not slot_free:
        return b''
    skills = [0] * COUNT
    owners = bytearray(EQUIPMENT_LIMIT)
    for row in rows:
        ident = row['id']
        skills[ident-FIRST] = row['skill']
        for member in row['members']:
            owners[member] = ident
    return b'TORSET01' + struct.pack(f'<{COUNT}H', *skills) + owners


def ini(data, slot_free=False):
    if not data:
        return b''
    section = b'\r\n[ModPreparationEquipmentSets]\r\nEnabled=1\r\n'
    return section + (b'SlotFreeSkills=1\r\n' if slot_free else b'')

"""Validate project equipment overrides and serialize them for the game loader."""

KEY = 'enemyEquipmentOverrides'
LIMIT = 889  # 761 native rows and 128 Mod Preparation rows.


def settings(value):
    if not isinstance(value, dict) or len(value) >= LIMIT:
        raise ValueError('Invalid enemy equipment overrides')
    result = {}
    for key, row in value.items():
        if (not isinstance(key, str) or not key.isascii() or not key.isdecimal()
                or len(key) > 3 or key.startswith('0') or not 0 < int(key) < LIMIT):
            raise ValueError('Invalid enemy equipment ID')
        if not isinstance(row, dict) or not row or set(row) - {'allowed', 'level'}:
            raise ValueError(f'Invalid enemy equipment override for #{key}')
        if 'allowed' in row and type(row['allowed']) is not bool:
            raise ValueError(f'Invalid enemy equipment availability for #{key}')
        if 'level' in row and (type(row['level']) is not int or not 0 <= row['level'] <= 255):
            raise ValueError(f'Enemy equipment #{key} needs a minimum level between 0 and 255')
        result[key] = {field: row[field] for field in ('allowed', 'level') if field in row}
    return dict(sorted(result.items(), key=lambda pair: int(pair[0])))


def ini(value):
    if not value:
        return ''
    data = [0] * (max(map(int, value)) + 1)
    for key, row in value.items():
        level = (0x100 | row['level']) if 'level' in row else 0
        availability = (0x200 | (0x400 if row['allowed'] else 0)) if 'allowed' in row else 0
        data[int(key)] = level | availability
    return 'Overrides=' + ''.join(f'{entry:03x}' for entry in data) + '\r\n'

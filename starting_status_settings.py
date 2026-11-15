"""Validate and compile the two battle-opening status loadouts."""
import json
from pathlib import Path

LOADOUTS = {
    'playerStartingStatus': ('PlayerStartingStatus', 'Player starting statuses'),
    'enemyStartingStatus': ('EnemyStartingStatus', 'Enemy starting statuses'),
}
ALLOW_CURE = 'startingStatusAllowCure'
CATALOG = json.loads(Path(__file__).with_name('starting_status_catalog.json').read_text(encoding='utf-8'))
CONDITIONS = {row['id']: row for row in CATALOG}


def defaults():
    return {**{key: {'conditions': [], 'persistent': False} for key in LOADOUTS}, ALLOW_CURE: True}


def settings(value):
    result = {ALLOW_CURE: value[ALLOW_CURE]}
    if type(result[ALLOW_CURE]) is not bool:
        raise ValueError('Allow cures must be on or off')
    for key, (_, label) in LOADOUTS.items():
        row = value[key]
        if not isinstance(row, dict) or set(row) != {'conditions', 'persistent'} or type(row['persistent']) is not bool:
            raise ValueError(f'Invalid {label.lower()}')
        ids = row['conditions']
        if not isinstance(ids, list) or any(type(i) is not int or i not in CONDITIONS for i in ids):
            raise ValueError(f'{label} require a list of supported conditions')
        if len(ids) != len(set(ids)):
            raise ValueError(f'{label} cannot repeat conditions')
        for ident in ids:
            conflict = next((other for other in ids if other in CONDITIONS[ident]['conflicts']), None)
            if conflict is not None:
                raise ValueError(f'{label} cannot combine {CONDITIONS[ident]["name"]} and {CONDITIONS[conflict]["name"]}')
        result[key] = {'conditions': sorted(ids), 'persistent': row['persistent']}
    return result


def active(value):
    return any(value[key]['conditions'] for key in LOADOUTS)


def ini(value):
    if not active(value):
        return ''
    text = f'\r\n[StartingStatus]\r\nAllowCure={int(value[ALLOW_CURE])}\r\n'
    for key, (section, _) in LOADOUTS.items():
        row = value[key]
        if not row['conditions']:
            continue
        text += f'\r\n[{section}]\r\nPersistent={int(row["persistent"])}\r\n'
        for index, ident in enumerate(row['conditions'], 1):
            suffix = '' if index == 1 else index
            text += f'Condition{suffix}={ident}\r\n'
    return text

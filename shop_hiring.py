"""Project-defined offers for the game's ten shop-hiring slots."""

from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd, Xlce, u16

KEY = 'customShopHiring'
ROSTER = 'shopHiringRoster'
PLAN = 'shopHiringPlan'
ROTATE = 'shopHiringRotation'
REOPEN = 'shopHiringReopen'
MONSTERS = 'shopHiringLargeMonsters'
SLOTS = 10
POOL = 4
MAX_CHOICES = 64
NAME_BYTES = 56
BATTLE = 'battle/battle_data_release.dat'

# Stock recruitable classes and the first templates of their four-sheet families.
LARGE_FAMILIES = ((range(27, 35), 211), ((35,), 215), (range(36, 40), 235),
                  ((40,), 219), ((41,), 223), ((42,), 227), ((43,), 231))


def large_monsters():
    return [{'class': klass, 'templates': list(range(first, first + POOL)), 'bank': 3}
            for family, first in LARGE_FAMILIES for klass in family]


def stock():
    result = []
    for index in range(SLOTS):
        first = 159 if index < 5 else 163
        result.append({'class': index % 5 + 1, 'templates': list(range(first, first + POOL))})
    return result


def stock_pool():
    return [{**row, 'bank': 1 + i // 5} for i, row in enumerate(stock())]


def settings(value, *, pool=False):
    if value is None:
        return stock_pool() if pool else stock()
    minimum = 0 if pool else SLOTS
    if not isinstance(value, list) or not minimum <= len(value) <= MAX_CHOICES:
        raise ValueError(f'Shop hiring supports up to {MAX_CHOICES} choices and needs {SLOTS} slots for a fixed roster.')
    result = []
    for i, row in enumerate(value, 1):
        needs_bank = pool or i > SLOTS
        keys = {'class', 'templates', 'bank'} if needs_bank else {'class', 'templates'}
        if not isinstance(row, dict) or row.keys() - {'identity'} != keys:
            raise ValueError(f'Invalid shop hiring choice {i}.')
        klass, templates = row['class'], row['templates']
        if type(klass) is not int or not 1 <= klass <= 255:
            raise ValueError(f'Shop hiring choice {i} needs a class between 1 and 255.')
        if (not isinstance(templates, list) or len(templates) != POOL or
                any(type(ident) is not int or not 1 <= ident <= 65535 for ident in templates)):
            raise ValueError(f'Shop hiring choice {i} needs four character template IDs.')
        choice = {'class': klass, 'templates': list(templates)}
        if needs_bank:
            if type(row['bank']) is not int or row['bank'] not in (1, 2):
                raise ValueError(f'Shop hiring choice {i} needs a male or female name bank.')
            choice['bank'] = row['bank']
        if 'identity' in row:
            identity = row['identity']
            if (len(set(templates)) != 1 or not isinstance(identity, dict) or
                    identity.keys() not in ({'name', 'clan'}, {'nameId', 'clan'})):
                raise ValueError(f'Shop hiring choice {i} needs a single sheet for a fixed name and clan.')
            clan = identity['clan']
            if type(clan) is not int or not 0 <= clan <= 7:
                raise ValueError(f'Shop hiring choice {i} has an invalid clan.')
            if 'nameId' in identity:
                name_id = identity['nameId']
                if type(name_id) is not int or not 1 <= name_id <= 65535:
                    raise ValueError(f'Shop hiring choice {i} has an invalid character name ID.')
                choice['identity'] = {'nameId': name_id, 'clan': clan}
            else:
                name = identity['name']
                if (not isinstance(name, str) or not name.strip() or not name.isprintable() or
                        len(name.encode('utf8')) > NAME_BYTES):
                    raise ValueError(f'Shop hiring choice {i} needs a printable name up to {NAME_BYTES} UTF-8 bytes.')
                choice['identity'] = {'name': name.strip(), 'clan': clan}
        result.append(choice)
    return result


def plan(value):
    keys = {'mode', 'pool', 'includeCustom', 'includeMonsters', 'afterBattle', 'onOpen'}
    if (not isinstance(value, dict) or value.keys() != keys or
            value['mode'] not in ('stock', 'fixed', 'random') or
            any(type(value[key]) is not bool for key in ('includeCustom', 'includeMonsters', 'afterBattle', 'onOpen'))):
        raise ValueError('Invalid shop hiring mode or random pool settings.')
    return {**value, 'pool': settings(value['pool'], pool=True)}


def configuration(editor, value):
    if PLAN in editor:
        return plan(editor[PLAN])
    custom, monsters = (bool(value.get(key)) for key in (KEY, MONSTERS))
    after, reopen = (editor.get(key) is True for key in (ROTATE, REOPEN))
    random = monsters or (custom and (after or reopen))
    existing = settings(editor.get(ROSTER))
    if random and custom:
        pool = [{**row, 'bank': row.get('bank', 1 if i < 5 else 2)} for i, row in enumerate(existing)]
    else:
        pool = existing[SLOTS:] or stock_pool()
    return {'mode': 'random' if random else 'fixed' if custom else 'stock',
            'pool': pool, 'includeCustom': custom or not monsters, 'includeMonsters': monsters,
            'afterBattle': after, 'onOpen': reopen}


def flags(value):
    mode = value['mode']
    return {KEY: mode == 'fixed' or (mode == 'random' and value['includeCustom']),
            MONSTERS: mode == 'random' and value['includeMonsters']}


def validate(data, roster):
    pack = Pakd(DatArchive.read(data).pack)
    classes, templates = (Xlce(pack.entry(index)) for index in (14, 23))
    for i, row in enumerate(roster, 1):
        klass = row['class']
        if klass >= classes.count or not any(classes.row(klass)):
            raise ValueError(f'Shop hiring choice {i} references unavailable class #{klass}.')
        for ident in set(row['templates']):
            if ident >= templates.count or not u16(templates.row(ident), 0x18):
                raise ValueError(f'Shop hiring choice {i} references unavailable character sheet #{ident}.')


def ini(roster, rotate=False, reopen=False, random=False):
    lines = ['', '[ShopHiring]', 'Enabled=1']
    if rotate:
        lines.append('RotateAfterBattle=1')
    if reopen:
        lines.append('RotateOnOpen=1')
    if random:
        lines.extend(('UsePool=1', 'WholePool=1'))
    choices = roster if random else roster[:SLOTS]
    lines.append(f'ChoiceCount={len(choices)}')
    for i, row in enumerate(choices, 1):
        lines.append(f"Class{i}={row['class']}")
        lines.extend(f'Template{i}_{j}={ident}' for j, ident in enumerate(row['templates'], 1))
        if 'bank' in row:
            lines.append(f"Bank{i}={row['bank']}")
        if identity := row.get('identity'):
            if 'nameId' in identity:
                lines.append(f"NameId{i}={identity['nameId']}")
            else:
                lines.append(f"Name{i}={identity['name'].encode('utf8').hex()}")
            lines.append(f"Clan{i}={identity['clan']}")
    return ('\r\n'.join(lines) + '\r\n').encode('ascii')

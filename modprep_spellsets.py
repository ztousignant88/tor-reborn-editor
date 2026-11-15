"""Build extended spell and skill permissions from project data at apply time."""
import struct

from class_change import BATTLE, DatArchive, Pakd, Xlce, rebuild_pakd
from modprep_groups import PLAN

FIRST = 64
LIMIT = FIRST + PLAN['headroomAfterActiveAllocations']['Spell permission groups']
SKILL_LIMIT = FIRST + PLAN['headroomAfterActiveAllocations']['Skill permission groups']
MAX_ROWS = {'spell':1024,'skill':1152}


def settings(rows=None, kind='spell'):
    if rows is None:
        return []
    limit = LIMIT if kind=='spell' else SKILL_LIMIT
    if not isinstance(rows, list) or len(rows) > limit-FIRST:
        raise ValueError(f'Invalid expanded {kind} sets')
    clean, ids, assigned = [], set(), set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'id','name','classes','levels'}:
            raise ValueError(f'Invalid expanded {kind} set record')
        ident, name, classes, levels = (row[key] for key in ('id','name','classes','levels'))
        if type(ident) is not int or not FIRST <= ident < limit or ident in ids:
            raise ValueError(f'Invalid or duplicate expanded {kind} set ID')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ValueError(f'Expanded {kind} set names must be 1–80 characters')
        if not isinstance(classes, list) or any(type(c) is not int or not 0 < c < 256 for c in classes):
            raise ValueError(f'Invalid class in expanded {kind} set {ident}')
        if len(set(classes)) != len(classes) or assigned.intersection(classes):
            raise ValueError(f'A class can use only one expanded {kind} set')
        if not isinstance(levels, list) or not 1 <= len(levels) <= MAX_ROWS[kind] or any(type(n) is not int or not 0 <= n <= 255 for n in levels):
            raise ValueError(f'Invalid learning levels for expanded {kind} set {ident}')
        ids.add(ident)
        assigned.update(classes)
        clean.append({'id':ident,'name':name.strip(),'classes':sorted(classes),'levels':levels})
    return sorted(clean,key=lambda row:row['id'])


def expand_table(levels, classes, replacements, rows, *, stride, base, selector, limit, kind):
    if levels.row_size!=stride:
        raise ValueError(f'Expanded {kind} sets require the original permission layout')
    width=stride+limit-FIRST
    matrix=bytearray(b'\xff'*(levels.count*width))
    for i in range(levels.count):
        matrix[i*width:i*width+stride]=levels.row(i)
    for row in rows:
        ident=row['id']
        if len(row['levels'])>levels.count:
            raise ValueError(f'{kind.title()} set {ident} refers to missing rows')
        column=stride+ident-FIRST
        for index,level in enumerate(row['levels']):
            matrix[index*width+column]=level
        for c in row['classes']:
            original=classes.row(c)
            if original[selector]>=FIRST:
                raise ValueError(f'Class {c} already uses a nonstandard {kind} selector')
            updated=replacements.setdefault(c,bytearray(original))
            updated[selector]=column-base
    end=levels.header+levels.count*levels.row_size
    expanded=bytearray(levels.data[:levels.header]+matrix+levels.data[end:])
    struct.pack_into('<I',expanded,12,width)
    return bytes(expanded)


def build(data, rows, skills=()):
    spells=[row for row in rows if row['classes']]
    skills=[row for row in skills if row['classes']]
    if not spells and not skills:
        return {}
    archive=DatArchive.read(data)
    pack=Pakd(archive.pack)
    classes=Xlce(pack.entry(14))
    if classes.row_size!=208:
        raise ValueError('Expanded permission sets require the original class layout')
    tables, replacements={}, {}
    if spells:
        tables[51]=expand_table(Xlce(pack.entry(51)),classes,replacements,spells,
                               stride=64,base=0,selector=0x51,limit=LIMIT,kind='spell')
    if skills:
        # Native access is skill row + 0x10 + selector. Append after the whole
        # 102-byte record so selectors 86–149 skip the existing skill metadata.
        tables[25]=expand_table(Xlce(pack.entry(25)),classes,replacements,skills,
                               stride=102,base=0x10,selector=0x53,limit=SKILL_LIMIT,kind='skill')
    tables[14]=classes.replace(replacements)
    return {BATTLE:archive.rebuild(rebuild_pakd(pack,tables))}

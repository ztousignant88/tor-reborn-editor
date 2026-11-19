"""Merge known DAT structures while keeping unresolved binary data together."""
from functools import lru_cache
import json
from pathlib import Path
import re
import struct

from ai_choices_data import rebuild_pakd
from tools.menu_mods.compiler.class_text import Txte, display
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd, Xlce

BATTLE = 'battle/battle_data_release.dat'
MENU = 'menu/menu_data.dat'
TABLES = {11: ('Equipment', 'armament'), 13: ('Items', 'commodity'),
          14: ('Classes', 'class'), 16: ('Spells & abilities', 'effect'),
          17: ('Battle stages', None), 18: ('Accuracy formulas', 'formula_hit_rate'),
          19: ('HP damage formulas', 'formula_hp_damage'), 20: ('HP healing formulas', 'formula_hp_restore'),
          23: ('Character sheets', 'template'),
          25: ('Skill permissions', None), 26: ('Statuses', None), 27: ('AI profiles', None)}
INDEXED = {11, 13, 14, 16, 23, 25, 26, 27}
SCHEMAS = Path(__file__).resolve().parent/'web/data/schemas'


def recognized(path):
    return (path in (BATTLE, MENU) or re.fullmatch(r'localize/LocalizeText_[\w-]+\.dat', path)
            or re.fullmatch(r'battle/entry/entry_unit_\w+\.dat', path, re.I))


def scalar(base, current, incoming):
    if current == incoming or incoming == base:
        return True, current
    if current == base:
        return True, incoming
    return False, None


def table_tail(table):
    return table.data[table.header + table.count*table.row_size:]


def shape(table):
    return table.data[:4] + table.data[8:table.header]


def pack_shape(pack):
    return (len(pack), pack.data[:8], pack.data[12+4*len(pack):pack.offsets[0]], pack.data[pack.total_size:])


def pure_rows(table):
    tail = table_tail(table)
    return len(tail) <= 16 and not any(tail)


@lru_cache(maxsize=None)
def fields(schema, row_size):
    if not schema:
        return []
    spec = json.loads((SCHEMAS/(schema+'.json')).read_bytes())
    if spec['rowSize'] != row_size:
        return []
    result = sorted(((field['offset'], field['offset']+field['size'], field)
                     for group in spec['groups'] for field in group['fields']), key=lambda span: span[:2])
    if any(start < 0 or end > row_size or start >= end for start, end, _ in result):
        return []
    spans=[]
    for start,end,field in result:
        if spans and spans[-1][1]>start:
            old_start,old_end,old_field=spans.pop()
            label=old_field['label'].split(' / ')[0]
            spans.append((old_start,max(old_end,end),{'type':'bytes','label':label+' / shared bytes'}))
        else:
            spans.append((start,end,field))
    return spans


def pretty_field(field, data):
    if field['type'] == 'bytes':
        return data.hex(' ')
    number = int.from_bytes(data, 'little', signed=field['type']=='int')
    label = next((label for value,label in field.get('options',[]) if value==number), None)
    return f'{label} ({number})' if label else str(number)


def merge_row(choose, location, base, current, incoming, schema):
    resolved, value = scalar(base, current, incoming)
    if resolved:
        return value
    spans = fields(schema,len(base))
    if not spans:
        return choose(location, base, current, incoming, reason='Both projects edit this record.')
    result = bytearray(base)
    cursor = 0
    for start,end,field in [*spans,(len(base),len(base),None)]:
        if start > cursor:
            result[cursor:start] = choose((*location, f'Bytes {cursor:X}–{start-1:X}'),
                                         base[cursor:start], current[cursor:start], incoming[cursor:start])
        if field:
            result[start:end] = choose((*location, f"{field['label']} (0x{start:X})"), base[start:end], current[start:end],
                                       incoming[start:end], show=lambda data: pretty_field(field,data))
        cursor = end
    return bytes(result)


def merge_table(choose, location, entries, schema, appendable):
    base,current,incoming = map(Xlce,entries)
    if len({shape(t) for t in (base,current,incoming)})!=1:
        return choose(location,*entries,reason='The table layouts differ.')
    resized = len({t.count for t in (base,current,incoming)})!=1
    if resized and (not appendable or min(current.count,incoming.count)<base.count
                    or not all(map(pure_rows,(base,current,incoming)))):
        return choose(location,*entries,reason='The record layout or count changed.')
    count=max(current.count,incoming.count)
    rows=[]
    for ident in range(count):
        label=(*location,f'ID {ident}')
        if ident<base.count:
            rows.append(merge_row(choose,label,base.row(ident),current.row(ident),incoming.row(ident),schema))
        elif ident<min(current.count,incoming.count):
            rows.append(choose(label,None,current.row(ident),incoming.row(ident),reason='Both projects add a record with this ID.'))
        else:
            rows.append((current if ident<current.count else incoming).row(ident))
    if not resized:
        tail=choose((*location,'Table data'),table_tail(base),table_tail(current),table_tail(incoming))
        return base.data[:base.header]+b''.join(rows)+tail
    header=bytearray(base.data[:base.header])
    struct.pack_into('<I',header,4,count)
    data=bytes(header)+b''.join(rows)
    return data+b'\0'*(16-len(data)%16)


def merge_text(choose, location, entries):
    tables=list(map(Txte,entries))
    if len({t.header[:4]+t.header[8:] for t in tables})!=1:
        return choose(location,*entries,reason='The text table layouts differ.')
    records=[{r[0]: r for r in t.rows} for t in tables]
    if any(len(r)!=len(t.rows) for r,t in zip(records,tables)):
        return choose(location,*entries,reason='This table has repeated text keys.')
    keys=dict.fromkeys(key for mapping in records for key in mapping)
    rows=[]
    for key in keys:
        row=choose((*location,key.decode('utf-8')),*(r.get(key) for r in records),
                   show=lambda value: display(value[1]) if value else 'Absent')
        if row is not None:
            rows.append(row)
    header=tables[0].header
    result=bytearray(header+b'\0'*(32*len(rows)))
    struct.pack_into('<I',result,4,len(rows))
    for i,row in enumerate(rows):
        for column,value in enumerate(row):
            struct.pack_into('<Q',result,len(header)+32*i+8*column,len(result))
            result.extend(value+b'\0')
    result.extend(b'\0'*(16-len(result)%16))
    assert Txte(result).rows==rows
    return bytes(result)


def merge_archive(choose, path, values):
    archives=list(map(DatArchive.read,values))
    packs=[Pakd(archive.pack) for archive in archives]
    if not len(packs[0]) or len({pack_shape(p) for p in packs})!=1:
        return choose((path,),*values,reason='The archive structure differs.')
    replacements={}
    for index in range(len(packs[0])):
        entries=[p.entry(index) for p in packs]
        resolved,data=scalar(*entries)
        if not resolved:
            title,schema=TABLES.get(index,(f'Table {index}',None)) if path==BATTLE else (f'Table {index}',None)
            if path==MENU and index==26:
                title,schema='Shops','shop'
            location=(path,title)
            if all(entry.startswith(b'xlce') for entry in entries) and (path==BATTLE or path==MENU and index==26 or path.lower().startswith('battle/entry/')):
                data=merge_table(choose,location,entries,schema,path==BATTLE and index in INDEXED)
            elif all(entry.startswith(b'txte') for entry in entries):
                data=merge_text(choose,location,entries)
            else:
                data=choose(location,*entries,reason='Both projects change this part of the archive.')
        if data != entries[0]:
            replacements[index]=data
    packed=rebuild_pakd(packs[0],replacements) if replacements else archives[0].pack
    return next((archive.original for archive in archives if archive.pack==packed),None) or archives[0].rebuild(packed)


def identity_collision(base, current, incoming, named_classes, settled=()):
    """Find overlapping allocations before any linked files are combined."""
    packs=[Pakd(DatArchive.read(data).pack) for data in (base,current,incoming)]
    for index in sorted(INDEXED):
        tables=[Xlce(p.entry(index)) for p in packs]
        old,left,right=tables
        if len({shape(t) for t in tables})!=1 or min(left.count,right.count)<old.count:
            if left.data!=right.data and left.data!=old.data and right.data!=old.data:
                return TABLES[index][0]+' uses different record layouts'
            continue
        for ident in range(1,min(left.count,right.count)):
            a,b=left.row(ident),right.row(ident)
            if (index,ident) in settled and a==b:
                continue
            if ident>=old.count:
                # Two branches can add equal rows and then give them different names.
                if a!=b or index in (13,16,23):
                    return f'{TABLES[index][0]} ID {ident} was added in both projects'
                continue
            original=old.row(ident)
            if a==original or b==original or a==b:
                continue
            unused=(index==11 and original[0x86:0x88]==b'\0\0'
                    or index==13 and original[2]==0
                    or index==14 and int.from_bytes(original[0xb2:0xb4],'little') not in named_classes)
            if unused:
                return f'{TABLES[index][0]} ID {ident} uses the same free slot in both projects'
    return None

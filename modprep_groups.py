"""Project-owned class-change groups backed by the existing wide runtime reader."""
import hashlib
import json
from pathlib import Path
import struct
import zlib

PLAN = json.loads((Path(__file__).resolve().parent/'tools/mod_preparation/capacity.json').read_bytes())
GROUP_START = PLAN['classChangeGroupStart']
GROUP_COUNT = PLAN['headroomAfterActiveAllocations']['Class-change groups']
GROUP_LIMIT = GROUP_START + GROUP_COUNT
NATIVE_TEMPLATES = PLAN['nativeCharacterTemplateCount']
TEMPLATE_LIMIT = PLAN['characterTemplateLimit']
HEADER = struct.Struct('<8s10I32s32s')


def settings(groups):
    if groups is None:
        return []
    if not isinstance(groups,list) or len(groups)>GROUP_COUNT:
        raise ValueError('Invalid Mod Preparation class-change groups')
    ids, assigned, clean = set(), set(), []
    for group in groups:
        if not isinstance(group,dict) or set(group)!={'id','name','templates','classes'}:
            raise ValueError('Invalid class-change group record')
        ident, name = group['id'], group['name']
        if type(ident) is not int or not GROUP_START<=ident<GROUP_LIMIT or ident in ids:
            raise ValueError('Invalid or duplicate community class-change group ID')
        if not isinstance(name,str) or not 1<=len(name.strip())<=80:
            raise ValueError('Class-change group names must be 1–80 characters')
        ids.add(ident)
        record={'id':ident,'name':name.strip()}
        for field, maximum in (('templates',65535),('classes',255)):
            values=group[field]
            if not isinstance(values,list) or any(type(n) is not int or not 1<=n<=maximum for n in values):
                raise ValueError(f'Invalid {field} in class-change group {ident}')
            if len(set(values))!=len(values):
                raise ValueError(f'Duplicate {field} in class-change group {ident}')
            record[field]=sorted(values)
        if assigned.intersection(record['templates']):
            raise ValueError('A character template can belong to only one community class-change group')
        assigned.update(record['templates'])
        clean.append(record)
    return sorted(clean,key=lambda group:group['id'])


OVERRIDES = 'builtinClassGroupOverrides'


def override_settings(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError('Invalid built-in class-change group overrides')
    result = {}
    for group, classes in value.items():
        if not isinstance(group, str) or not group.isascii() or not group.isdecimal() or group != str(int(group)) or not 64 <= int(group) < GROUP_START:
            raise ValueError('Invalid built-in class-change group ID')
        if not isinstance(classes, dict) or any(
            not isinstance(klass, str) or not klass.isascii() or not klass.isdecimal() or klass != str(int(klass))
            or not 1 <= int(klass) <= 255 or type(allowed) is not bool for klass, allowed in classes.items()
        ):
            raise ValueError(f'Invalid class choices for built-in group {group}')
        if classes:
            result[group] = dict(classes)
    return result


def extend(data, group_settings, class_rows, template_rows, menu, overrides=None):
    """Combine edited native permissions, built-in overrides and community assignments."""
    overrides = overrides or {}
    magic, version, size, count, classes, templates, stride, matrix, assignments, _, _, project, allocation = HEADER.unpack_from(data)
    if (magic,version,size,matrix)!=(b'TORPERM1',1,HEADER.size,HEADER.size) or count>GROUP_START:
        raise ValueError('Unsupported base class-change permissions')
    width = (GROUP_LIMIT+7)//8
    updated = bytearray(classes*width)
    for klass in range(classes):
        start=matrix+klass*stride
        updated[klass*width:klass*width+stride]=data[start:start+stride]
        updated[klass*width:klass*width+8]=class_rows.row(klass)[0x88:0x90]
    selectors=bytearray(data[assignments:])
    native=bytes(template_rows.row(i)[0x38] for i in range(template_rows.count))
    if any(group>=64 for group in native):
        raise ValueError('Character sheets need a native class group from 0 to 63. Assign wider groups in the class-change editor.')
    for template in range(templates):
        if struct.unpack_from('<I',selectors,template*4)[0]<64:
            struct.pack_into('<I',selectors,template*4,native[template])
    new_selectors=native[templates:]
    for group in new_selectors:
        selectors.extend(struct.pack('<I',group))
    builtin = set(struct.unpack(f'<{template_rows.count}I', selectors))
    active_overrides = {group: choices for group, choices in overrides.items() if int(group) in builtin}
    for group, choices in active_overrides.items():
        ident = int(group)
        for klass, allowed in choices.items():
            klass = int(klass)
            if allowed and not selectable(klass,class_rows,menu):
                raise ValueError(f'Class {klass} is unavailable in the class-change menu')
            offset = klass*width+ident//8
            bit = 1 << (ident%8)
            updated[offset] = updated[offset] | bit if allowed else updated[offset] & ~bit
    for group in group_settings:
        ident=group['id']
        for template in group['templates']:
            if template>=template_rows.count:
                raise ValueError(f'Class-change group {ident} refers to missing character template {template}')
            struct.pack_into('<I',selectors,template*4,ident)
        for klass in group['classes']:
            # The extended class screen supports native choices and the
            # additional class choices with an explicit mark descriptor.
            if not selectable(klass,class_rows,menu):
                raise ValueError(f'Class {klass} is unavailable in the class-change menu')
            updated[klass*width+ident//8]|=1<<(ident%8)
    payload=updated+selectors
    definition=json.dumps(group_settings,sort_keys=True,separators=(',',':')).encode()
    if active_overrides:
        definition+=json.dumps(active_overrides,sort_keys=True,separators=(',',':')).encode()
    identity=hashlib.sha256(allocation+definition+struct.pack('<I',GROUP_LIMIT)+new_selectors).digest()
    return HEADER.pack(magic,version,size,GROUP_LIMIT,classes,template_rows.count,width,matrix,matrix+len(updated),
                       size+len(payload),zlib.crc32(payload),project,identity)+payload


def extend_menu(menu, template_count, allocation):
    races_at=96+struct.unpack_from('<I',menu,12)[0]*8
    original=struct.unpack_from('<I',menu,races_at)[0]
    tail=struct.pack('<I',template_count)+menu[races_at+4:]+b'\xff'*(template_count-original)
    out=bytearray(menu[:64]+allocation+menu[96:races_at]+tail)
    struct.pack_into('<2I',out,24,len(out),zlib.crc32(out[96:]))
    return bytes(out)


def selectable(klass, class_rows, menu):
    if not 0<klass<class_rows.count or klass==77 or not class_rows.row(klass)[0x55]:
        return False
    if klass<80:
        return True
    return class_mode(klass,menu) in (1,2)


def class_mode(klass,menu):
    rows_at=struct.unpack_from('<I',menu,20)[0]
    return struct.unpack_from('<I',menu,rows_at+klass*8+4)[0]

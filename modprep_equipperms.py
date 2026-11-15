"""Independent class equipment groups for Mod Preparation."""
from modprep_groups import PLAN

FIRST = 64
COUNT = PLAN['headroomAfterActiveAllocations']['Equipment permission groups']
LIMIT = FIRST + COUNT
EQUIPMENT_LIMIT = 761
CLASS_COUNT = 256
STRIDE = (EQUIPMENT_LIMIT+7)//8
FILE = 'modprep-equipment-permissions.bin'


def settings(rows=None):
    if rows is None:
        return []
    if not isinstance(rows, list) or len(rows)>COUNT:
        raise ValueError('Invalid expanded equipment permission groups')
    clean, ids, assigned = [], set(), set()
    for row in rows:
        if not isinstance(row, dict) or set(row)!={'id','name','classes','equipment'}:
            raise ValueError('Invalid equipment permission group record')
        ident,name,classes,equipment=(row[key] for key in ('id','name','classes','equipment'))
        if type(ident) is not int or not FIRST<=ident<LIMIT or ident in ids:
            raise ValueError('Invalid or duplicate equipment permission group ID')
        if not isinstance(name,str) or not 1<=len(name.strip())<=80:
            raise ValueError('Equipment permission group names must be 1–80 characters')
        if not isinstance(classes,list) or any(type(c) is not int or not 0<c<CLASS_COUNT for c in classes):
            raise ValueError(f'Invalid class in equipment group {ident}')
        if len(set(classes))!=len(classes) or assigned.intersection(classes):
            raise ValueError('A class can use only one expanded equipment permission group')
        if not isinstance(equipment,list) or any(type(i) is not int or not 0<i<EQUIPMENT_LIMIT for i in equipment):
            raise ValueError(f'Invalid equipment in permission group {ident}')
        if len(set(equipment))!=len(equipment):
            raise ValueError(f'Duplicate equipment in permission group {ident}')
        ids.add(ident)
        assigned.update(classes)
        clean.append({'id':ident,'name':name.strip(),'classes':sorted(classes),'equipment':sorted(equipment)})
    return sorted(clean,key=lambda row:row['id'])


def runtime(project, enabled):
    if not enabled:
        return b''
    groups=settings(project.get('editor',{}).get('communityEquipmentPermissions'))
    groups=[group for group in groups if group['classes']]
    if not groups:
        return b''
    selectors=bytearray(b'\xff'*CLASS_COUNT)
    matrix=bytearray(COUNT*STRIDE)
    for group in groups:
        index=group['id']-FIRST
        for c in group['classes']:
            selectors[c]=index
        for i in group['equipment']:
            matrix[index*STRIDE+i//8]|=1<<(i%8)
    return b'TOREQP01'+selectors+matrix


def ini(data):
    return b'\r\n[ModPreparationEquipmentPermissions]\r\nEnabled=1\r\n' if data else b''

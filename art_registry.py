"""Read/write Reborn file tables, following Gibbed's published layout.

This prototype preserves original directory metadata and explicit numeric IDs.
It does not install or mutate any game files.
"""
from dataclasses import dataclass,field
import struct
import re

@dataclass
class Entry:
 id:int
 path:str
 size:int
 name_hash:int|None=None

@dataclass
class Directory:
 id:int
 raw:bytes
 entries:list[Entry]=field(default_factory=list)

@dataclass
class FileTable:
 header:bytes
 directories:list[Directory]

def parse(data:bytes)->FileTable:
 magic,names,dirs,version,offset,total=struct.unpack_from('<4H2I',data)
 assert magic==0x1ef1 and version==4 and 68<=offset<=total<len(data)
 name_records=[struct.unpack_from('<IHH',data,68+i*8)for i in range(names)]
 directory_at=68+names*8;batch_at=directory_at+dirs*24
 result=[];batches=0
 for i in range(dirs):
  raw=data[directory_at+i*24:directory_at+(i+1)*24];ident,_,_,_,unknown,_,count,name_count,name_index,batch_off,_=struct.unpack('<HBBIBBHHHII',raw)
  assert unknown==0 and batch_off%8==0
  directory=Directory(ident,raw);lookup={(d,f):h for h,d,f in name_records[name_index:name_index+name_count]}if name_count else {};ids=set()
  for j in range(count):
   first,length,flags=struct.unpack_from('<HHI',data,batch_at+batch_off+j*8);assert flags>>29==0
   for k in range(length):
    file_id=first+k;assert file_id not in ids;ids.add(file_id)
    external=total+struct.unpack_from('<I',data,offset+flags+k*4)[0]*8;end=data.index(0,external);path=data[external:end].decode('ascii');size=struct.unpack_from('<I',data,end+1)[0]
    directory.entries.append(Entry(file_id,path,size,lookup.get((ident,file_id))))
  batches+=count;result.append(directory)
 assert batch_at+batches*8==offset
 return FileTable(data[:68],result)

def serialize(table:FileTable)->bytes:
 names=bytearray();directories=bytearray();batches=bytearray();pointers=bytearray();external=bytearray()
 for directory in table.directories:
  entries=sorted(directory.entries,key=lambda e:e.id);assert len({e.id for e in entries})==len(entries);groups=[]
  for e in entries:
   assert 0<=e.id<=65535 and 0<=e.size<=0xffffffff and '\0'not in e.path
   if groups and e.id==groups[-1][-1].id+1:groups[-1].append(e)
   else:groups.append([e])
  name_index=len(names)//8;batch_offset=len(batches);name_count=0
  for group in groups:
   batches.extend(struct.pack('<HHI',group[0].id,len(group),len(pointers)))
   for e in group:
    if e.name_hash is not None:names.extend(struct.pack('<IHH',e.name_hash,directory.id,e.id));name_count+=1
    assert len(external)%8==0;pointers.extend(struct.pack('<I',len(external)//8));external.extend(e.path.encode('ascii')+b'\0'+struct.pack('<I',e.size));external.extend(bytes((-len(external))%8))
  raw=bytearray(directory.raw);struct.pack_into('<HHHI',raw,10,len(groups),name_count,name_index if name_count else 65535,batch_offset);directories.extend(raw)
 header=bytearray(table.header);offset=68+len(names)+len(directories)+len(batches);struct.pack_into('<HH',header,2,len(names)//8,len(table.directories));struct.pack_into('<II',header,8,offset,offset+len(pointers));return bytes(header+names+directories+batches+pointers+external)


SCENE_DIRECTORY_PREFIXES = {
    901: 'C1', 902: 'C2a', 903: 'C2b', 904: 'C3a', 905: 'C3b',
    906: 'C3c', 907: 'C4', 908: 'EP', 909: 'DLC',
}
MAP_NAME_LANGUAGES = ('ja-jp', 'en-us', 'fr-fr', 'de-de', 'es-es', 'zh-cn', 'zh-tw', 'ko-kr')
WORLD_EVENT_CAPACITY = 39
# The east and west legacy sites can be occupied by the two built-in fights.
WORLD_EVENT_SITE_COUNT = WORLD_EVENT_CAPACITY + 2


def registrations(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 2048:
        raise ValueError('Invalid character art registrations')
    result, ids, paths = [], set(), set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError('Invalid game file registration')
        directory, ident, path = item.get('directory'), item.get('id'), item.get('path')
        if type(directory) is not int or type(ident) is not int or not 1 <= ident <= 65535:
            raise ValueError('Invalid game file ID')
        if directory in (20, 30):
            if not isinstance(path, str) or not re.fullmatch(r'object/[A-Za-z][A-Za-z0-9_]{0,47}\.dat', path):
                raise ValueError('New character art must be an object .dat file')
        elif directory in SCENE_DIRECTORY_PREFIXES:
            prefix = SCENE_DIRECTORY_PREFIXES[directory]
            if path != f'event/scene/{prefix}_ST_{ident:03d}.dat':
                raise ValueError('Scene archive path must match its chapter directory and stage ID')
        elif directory == 1001:
            if not isinstance(path, str) or not re.fullmatch(r'battle/entry/entry_unit_\d{3,5}\.dat', path):
                raise ValueError('Battle roster must be an entry_unit archive')
        elif directory == 100:
            if not 1394 <= ident < 1394 + WORLD_EVENT_SITE_COUNT or path != f'bg/bg990_{ident - 1393:02d}_c0_t00.dat':
                raise ValueError('Invalid overworld battlefield file registration')
        elif directory == 500 and ident >= 50000:
            location, language = divmod(ident - 50000, len(MAP_NAME_LANGUAGES))
            if path != f'menu/mapname/{MAP_NAME_LANGUAGES[language]}/STRONGHOLD_{location:03d}.dat':
                raise ValueError('Map-name archive path must match its location and language ID')
        else:
            raise ValueError('Invalid game file directory')
        if (directory, ident) in ids or path.casefold() in paths:
            raise ValueError('Duplicate character art registration')
        ids.add((directory, ident)); paths.add(path.casefold())
        result.append({'directory': directory, 'id': ident, 'path': path})
    return result


def characters(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 1024:
        raise ValueError('Invalid project characters')
    result, templates = [], set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError('Invalid project character')
        name, stem = item.get('name'), item.get('stem')
        if not isinstance(name, str) or not name.strip() or len(name) > 80 or not isinstance(stem, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,19}', stem):
            raise ValueError('Invalid project character name')
        fields = {'template': (1, 65534), 'actor': (1, 65535), 'appearance': (1, 65535), 'baseTemplate': (0, 65534), 'classId': (1, 255), 'palette': (0, 64)}
        if any(type(item.get(k)) is not int or not lo <= item[k] <= hi for k, (lo, hi) in fields.items()):
            raise ValueError('Invalid project character settings')
        if item['template'] in templates:
            raise ValueError('Duplicate project character template')
        templates.add(item['template'])
        record = {'name': name.strip(), 'stem': stem, **{key: item[key] for key in fields}}
        origin = item.get('copiedFrom')
        if origin is not None:
            # copied from another project with new IDs: what it was called there, so a merge can match it
            if (not isinstance(origin, dict) or not isinstance(origin.get('project'), str) or not 0 < len(origin['project']) <= 60
                    or not isinstance(origin.get('stem'), str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,19}', origin['stem'])
                    or any(type(origin.get(k)) is not int or not 0 < origin[k] <= 65535 for k in ('template', 'actor', 'appearance'))):
                raise ValueError('Invalid copied project character')
            record['copiedFrom'] = {k: origin[k] for k in ('project', 'stem', 'template', 'actor', 'appearance')}
        result.append(record)
    return result


def reconcile(data, additions=(), sizes=None, removals=()):
    """Update explicit IDs. Never derive IDs from filename order or renumber stock."""
    table = parse(data)
    by_id = {d.id: d for d in table.directories}
    for item in registrations(list(removals)):
        directory = by_id[item['directory']]
        found = next((e for e in directory.entries if e.id == item['id']), None)
        if found is None:
            continue
        if found.path != item['path']:
            raise ValueError('An installed art ID changed; refusing to remove another mod’s entry')
        directory.entries.remove(found)
    paths = {e.path.casefold(): (d.id, e.id) for d in table.directories for e in d.entries}
    for item in registrations(list(additions)):
        directory = by_id[item['directory']]
        found = next((e for e in directory.entries if e.id == item['id']), None)
        owner = paths.get(item['path'].casefold())
        if (found and found.path != item['path']) or (owner and owner != (directory.id, item['id'])):
            raise ValueError('Character art ID/path conflicts with installed data; rebuild the import preview')
        if found is None:
            if not sizes or item['path'] not in sizes:
                raise ValueError('New art registration has no project file: ' + item['path'])
            name_hash = None
            if directory.id == 100:
                # The battlefield directory indexes paths with FNV-1.
                name_hash = 2166136261
                for char in item['path'].encode('ascii'):
                    name_hash = ((name_hash * 16777619) & 0xffffffff) ^ char
                if any(entry.name_hash == name_hash for entry in directory.entries):
                    raise ValueError('The overworld battlefield path conflicts with another map name')
            directory.entries.append(Entry(item['id'], item['path'], sizes[item['path']], name_hash))
            paths[item['path'].casefold()] = (directory.id, item['id'])
    available = {e.path for d in table.directories for e in d.entries}
    for path, size in (sizes or {}).items():
        if path not in available:
            raise ValueError('FileTable has no registered entry for ' + path)
        for directory in table.directories:
            for entry in directory.entries:
                if entry.path == path:
                    entry.size = size
    return serialize(table)

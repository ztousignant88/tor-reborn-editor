"""Bounded TXTE relocation adapter; preserve all four strings of old records.

Speed (2026-11-12): /api/info builds the open project's class-change text for
all eight languages, which parsed every table several times and found each
string with its own scan (about 45 s at startup). A table is now parsed once,
with every string read in one pass, and its mapping is kept; patch_archive
reuses the tables it parsed instead of decrypting and reading the original
archive again. Every check is kept: the rebuilt table and archive are still
read back and compared."""
import struct
from collections import OrderedDict
from itertools import accumulate
from .tor_formats import DatArchive,Pakd
from ai_choices_data import rebuild_pakd as _rebuild_pakd

OP_SIZES=(1,3,5,6,5,3,1,2,2,2,2,3,2,3,3,3,3,1,1,1,1,4,1,1,3,3,2,1,3,2,1,1,1,1,1,1,1,1,1,1,1,1,2,3,3,1,3,3,1,1,4,4,3,3)
MARK=b'\xef\xa3\xbf'

def display(raw):
    out=bytearray();i=0
    while i<len(raw):
        if raw[i:i+3]==MARK and i+3<len(raw):
            op=raw[i+3]-128
            if op in (0,6):out.extend(b' ')
            i+=3+(OP_SIZES[op]if 0<=op<len(OP_SIZES)else 1)
        else:out.append(raw[i]);i+=1
    return out.decode('utf8').strip()

def encode(text,donor=b''):
    if not isinstance(text,str)or '\0'in text:raise ValueError('Invalid game text')
    raw=text.encode('utf8')
    if MARK+b'\x81'in donor:raw=raw.replace(b' ',b' '+MARK+b'\x81\x01\x01')
    return (MARK+b'\xa9'if donor.startswith(MARK+b'\xa9')else b'')+raw

class Txte:
    def __init__(self,data):
        if len(data)<16 or data[:4]!=b'txte':raise ValueError('Not TXTE')
        n,head,stride=struct.unpack_from('<III',data,4)
        if head<16 or stride!=32 or n>1000000 or head+n*stride>len(data):raise ValueError('Bad TXTE dimensions')
        self.original=data;self.header=data[:head];self._mapping=None
        data=bytes(data)
        pointers=struct.unpack_from(f'<{4*n}Q',data,head)
        size=len(data)
        # strings sit one after another past the table: split that region at its
        # terminators once; a pointer into the middle of a string falls back to a scan
        start=min(pointers,default=size)
        strings={}
        if start<size:
            pieces=data[start:].split(b'\0')[:-1] # the part after the last terminator is not a string
            strings=dict(zip(accumulate((len(p)+1 for p in pieces),initial=start),pieces))
        values=[strings.get(at)for at in pointers]
        if None in values:
            for k,at in enumerate(pointers):
                if values[k]is not None:continue
                if at>=size:raise ValueError('TXTE pointer outside resource')
                end=data.find(b'\0',at)
                if end<0:raise ValueError('Unterminated TXTE string')
                values[k]=data[at:end]
        it=iter(values);self.rows=list(zip(it,it,it,it))
        for r in self.rows:r[0].decode('utf8') # keys must be text
    def mapping(self):
        if self._mapping is None:self._mapping={r[0].decode('utf8'):r[1]for r in self.rows}
        return dict(self._mapping)
    def rebuild(self,changes,removals=()):
        current=self.mapping();removed=set(removals)
        if removed.intersection(changes):raise ValueError('Text cannot be changed and removed together')
        counts={}
        for r in self.rows:counts[r[0]]=counts.get(r[0],0)+1
        for key,value in changes.items():
            if not isinstance(key,str)or '\0'in key or type(value)is not bytes or b'\0'in value:raise ValueError('Invalid TXTE edit')
            raw=key.encode('utf8')
            if counts.get(raw,0)>1 and len({r for r in self.rows if r[0]==raw})>1:raise ValueError('Ambiguous duplicate text key: '+key)
        if not removed.intersection(current)and all(current.get(k)==v for k,v in changes.items()):return self.original
        rows=[(r[0],changes.get(r[0].decode('utf8'),r[1]),r[2],r[3])for r in self.rows if r[0].decode('utf8')not in removed]
        rows += [(k.encode('utf8'),v,b'',b'')for k,v in sorted(changes.items())if k not in current]
        out=bytearray(self.header+b'\0'*(len(rows)*32));struct.pack_into('<I',out,4,len(rows))
        for i,row in enumerate(rows):
            for j,value in enumerate(row):
                struct.pack_into('<Q',out,len(self.header)+i*32+j*8,len(out));out.extend(value+b'\0')
        out.extend(b'\0'*((-(len(out)+1))%16+1));result=bytes(out)
        checked=Txte(result);expected={k:v for k,v in current.items()if k not in removed};expected.update(changes)
        if checked.mapping()!=expected:raise ValueError('TXTE round trip failed')
        retained=[r for r in self.rows if r[0].decode('utf8')not in removed]
        if any(a[0]!=b[0]or a[2:]!=b[2:]for a,b in zip(retained,checked.rows)):raise ValueError('TXTE extra strings changed')
        return result

# Parsed tables by their bytes: the same localize tables are read many times while
# a project's content is built (all eight languages, then each check). Txte objects
# are not changed after parsing, and mapping() hands out copies.
_PARSED=OrderedDict()
def _parsed(d):
    key=bytes(d);t=_PARSED.get(key)
    if t is None:
        t=Txte(key);_PARSED[key]=t
        if len(_PARSED)>1200:_PARSED.popitem(last=False)
    else:_PARSED.move_to_end(key)
    return t

def _tables(pack):
    return {i:_parsed(d)for i in range(len(pack))for d in (pack.entry(i),)if d[:4]==b'txte'}

def _merged(tables):
    result={}
    for i in sorted(tables):result.update(tables[i].mapping())
    return result

def read_archive(data):
    return _merged(_tables(Pakd(DatArchive.read(data).pack)))

def patch_archive(data,changes,prefix,removals=()):
    archive=DatArchive.read(data);pack=Pakd(archive.pack);tables=_tables(pack)
    maps={i:t.mapping()for i,t in tables.items()}
    owners={k:i for i,m in maps.items()for k in m};siblings=[i for i,m in maps.items()if any(k.startswith(prefix)for k in m)]
    if not siblings:raise ValueError('Text category is absent')
    additions={i:{}for i in tables};deletions={i:[]for i in tables}
    for k,v in changes.items():additions[owners.get(k,siblings[0])][k]=v
    for k in removals:
        if k in owners:deletions[owners[k]].append(k)
    replacements={}
    for i,t in tables.items():
        changed=t.rebuild(additions[i],deletions[i])
        if changed!=t.original:replacements[i]=changed
    if not replacements:return data
    result=archive.rebuild(_rebuild_pakd(pack,replacements));actual=read_archive(result);expected=_merged(tables)
    for k in removals:expected.pop(k,None)
    expected.update(changes)
    if actual!=expected:raise ValueError('Localization rebuild changed unrelated values')
    return result

from pathlib import Path
from functools import lru_cache
import struct,hashlib
from art_pixels import over, read_overlay
from local_game_art import decode_texture, rebuild_texture, texture_bank
from tools.menu_mods.compiler.tor_formats import DatArchive,Pakd,Xlce
from tools.menu_mods.compiler.spell_icons import TextureArc

LEGACY_BUTTONS = ('ccb07e7026d403e756b5ff6e0d73f6fd75dade64243411cadfe92ac7bd7e640f', 'f50fb7ae9174e37a99e60eda04c0185c25e69c1b93ea16308c08225d8e6210a8')
ARDENT_MENDER_COMMAND = 613
BATTLE = 'battle/battle_data_release.dat'
AI_PROFILES = 27
STOCK_AI_ROWS = 113
# Match the two presets in web/js/game/aiprofiles.js.
PROFILES = (
 (53, {0x0a: -2000, 0x12: 300}),
 (63, {0x02: 30, 0x06: 30, 0x0a: -2000, 0x14: 1500}),
)

DESCRIPTIONS={
 'BUFF':('Buff','Stay in the rear and choose the most effective strengthening and support actions possible.'),
 'DEBUFF':('Debuff','Stay in the rear and choose the most effective weakening and status-inflicting actions possible.'),
}
def key(role,kind):return f'COMMAND_LC_COMMAND_NAME_AIPLUS_{role}_{kind}'
def cstr(data,offset):
 end=data.find(b'\0',offset)
 if offset<0 or end<offset:raise ValueError('Invalid string offset')
 return data[offset:end]
def rebuild_pakd(p,replacements):
 out=bytearray(p.data[:p.offsets[0]])
 for i in range(len(p)):
  struct.pack_into('<I',out,8+i*4,len(out));out.extend(replacements.get(i,p.entry(i)))
 struct.pack_into('<I',out,8+len(p)*4,len(out));out.extend(p.data[p.total_size:])
 check=Pakd(bytes(out))
 assert all(check.entry(i)==replacements.get(i,p.entry(i))for i in range(len(p)))
 return bytes(out)
def append_xlce_strings(data,rows,pointer_fields):
 x=Xlce(data);extra=len(rows)*x.row_size;end=x.header+x.count*x.row_size
 out=bytearray(data[:end]+b'\0'*extra+data[end:]);struct.pack_into('<I',out,4,x.count+len(rows))
 for i in range(x.count):
  for f in pointer_fields:
   at=x.header+i*x.row_size+f;old=struct.unpack_from('<Q',data,at)[0]
   if old<end or old>=len(data):raise ValueError('Unexpected native string pointer')
   struct.pack_into('<Q',out,at,old+extra)
 for j,values in enumerate(rows):
  at=end+j*x.row_size
  for f,value in values.items():
   if isinstance(value,bytes):
    struct.pack_into('<Q',out,at+f,len(out));out.extend(value+b'\0')
   else:struct.pack_into('<H',out,at+f,value)
 while len(out)%16:out.append(0)
 check=Xlce(bytes(out));assert check.count==x.count+len(rows)
 for i in range(x.count):
  old=bytearray(x.row(i));new=bytearray(check.row(i))
  for f in pointer_fields:
   a=struct.unpack_from('<Q',old,f)[0];b=struct.unpack_from('<Q',new,f)[0]
   assert cstr(data,a)==cstr(out,b)
   old[f:f+8]=new[f:f+8]=b'\0'*8
  assert old==new
 return bytes(out)
def append_txte(data,values):
 magic,n,h,s=struct.unpack_from('<4I',data)
 assert magic==int.from_bytes(b'txte','little') and s==32
 existing={cstr(data,struct.unpack_from('<Q',data,h+i*s)[0])for i in range(n)}
 assert not existing.intersection(k for k,v in values)
 end=h+n*s;extra=len(values)*s
 out=bytearray(data[:end]+b'\0'*extra+data[end:]);struct.pack_into('<I',out,4,n+len(values))
 for i in range(n):
  for f in [0,8,16,24]:
   at=h+i*s+f;old=struct.unpack_from('<Q',data,at)[0];assert end<=old<len(data)
   struct.pack_into('<Q',out,at,old+extra)
 for i,(k,v)in enumerate(values):
  for f,b in [(0,k),(8,v),(16,b''),(24,b'')]:
   struct.pack_into('<Q',out,end+i*s+f,len(out));out.extend(b+b'\0')
 while len(out)%16:out.append(0)
 for i in range(n):
  for f in [0,8,16,24]:assert cstr(data,struct.unpack_from('<Q',data,h+i*s+f)[0])==cstr(out,struct.unpack_from('<Q',out,h+i*s+f)[0])
 return bytes(out)

def _texts(data):
 magic,n,h,s=struct.unpack_from('<4I',data)
 if magic!=int.from_bytes(b'txte','little')or s!=32:raise ValueError('Unsupported command text layout')
 return {cstr(data,struct.unpack_from('<Q',data,h+i*s)[0]) for i in range(n)}

def _menu(data):
 a=DatArchive.read(data);p=Pakd(a.pack);t=Xlce(p.entry(7));m=Xlce(p.entry(20));icons=Xlce(p.entry(89))
 if icons.row_size!=4:raise ValueError('Unsupported command icon table')
 mender_text,mender_icon=struct.unpack_from('<HH',m.row(ARDENT_MENDER_COMMAND))
 if cstr(t.data,struct.unpack_from('<Q',t.row(mender_text-7000))[0])!=b'COMMAND_LC_COMMAND_NAME_TCSAI_BK_DEF_NOICON_NAME':
  raise ValueError('Ardent Mender command could not be identified')
 icons.row(mender_icon)
 iconrows=[struct.pack('<HBB',9000+i,1,0)for i in range(2)]
 ids=[];new=[]
 for r in iconrows:
  matches=[i for i in range(icons.count)if icons.row(i)==r]
  if len(matches)>1:raise ValueError('Duplicate AI Plus icon registration')
  ids.append(matches[0]if matches else icons.count+len(new))
  if not matches:new.append(r)
 edits={}
 if new:
  end=icons.header+icons.count*4;d=bytearray(icons.data[:end]+b''.join(new)+icons.data[end:]);struct.pack_into('<I',d,4,icons.count+len(new));edits[89]=bytes(d)
 if t.count==599 and m.count==614:
  edits[7]=append_xlce_strings(t.data,[{0:key(r,'NAME').encode(),8:key(r,'TEXT').encode()}for r in DESCRIPTIONS],[0,8])
  edits[20]=append_xlce_strings(m.data,[{0:7599+i,2:ids[i],8:b'',16:b''}for i in range(2)],[8,16])
 elif t.count>=601 and m.count>=616:
  command_edits={}
  for i,role in enumerate(DESCRIPTIONS):
   expected=[key(role,k).encode()for k in ['NAME','TEXT']]
   actual=[cstr(t.data,n)for n in struct.unpack('<QQ',t.row(599+i))]
   command=m.row(614+i)
   text,icon=struct.unpack_from('<HH',command)
   allowed=icon==mender_icon or icon<icons.count and icons.row(icon)==iconrows[i]
   if actual!=expected or text!=7599+i or not allowed:raise ValueError('AI Plus menu IDs conflict with another edit; game files were preserved')
   if icon!=ids[i]:
    command_edits[614+i]=command[:2]+struct.pack('<H',ids[i])+command[4:]
  if command_edits:edits[20]=m.replace(command_edits)
 else:raise ValueError('AI Plus menu IDs are occupied by another edit; game files were preserved')
 return a.rebuild(rebuild_pakd(p,edits)) if edits else data

def build(read):
 """Add only our rows/resources to the effective project files."""
 out={'menu/menu_data.dat':_menu(read('menu/menu_data.dat'))}
 art=Path(__file__).resolve().parent/'tools/menu_mods/art'
 donor=texture_bank(read('menu/texture_x4/en-us/com_icon.dat'))['com_icon_0018_00_sqr']
 textures=button_textures(donor,art)
 for lang in ['en-us','ja-jp','fr-fr','de-de','es-es','ko-kr','zh-cn','zh-tw']:
  rel=f'localize/LocalizeText_{lang}.dat';data=read(rel);a=DatArchive.read(data);p=Pakd(a.pack);keys=_texts(p.entry(40))
  values=[(key(r,k).encode(),text.encode())for r,pair in DESCRIPTIONS.items()for k,text in zip(['NAME','TEXT'],pair)if key(r,k).encode()not in keys]
  out[rel]=a.rebuild(rebuild_pakd(p,{40:append_txte(p.entry(40),values)}))if values else data
  rel=f'menu/texture_x4/{lang}/com_icon.dat';data=read(rel);a=DatArchive.read(data);p=Pakd(a.pack);arc=TextureArc(p.entry(0));existing={r.name:r for r in arc.resources}
  missing={}
  for name,btx in textures.items():
   if name not in existing:missing[name]=btx;continue
   r=existing[name];size=struct.unpack_from('<I',r.body)[0]
   if r.body[32:32+size]!=btx and hashlib.sha256(r.body[32:32+size]).hexdigest() not in LEGACY_BUTTONS:
    raise ValueError('AI Plus icon name is occupied by different art: '+name)
  out[rel]=a.rebuild(rebuild_pakd(p,{0:arc.append(missing)}))if missing else data
 return out

@lru_cache(maxsize=4)
def button_textures(donor, art):
 native=decode_texture(donor)
 base=native.copy()
 # Trace the orb and sparkles around the AI badge and the crystal on the wand.
 # Paint in the dark panel gradient before compositing the new chevrons.
 spans=([(8,28)]*3+[(7,28)]*5+[(6,28)]*4+[(5,28)]*7+
        [(5,30), (5,32), (5,33), (5,35), (5,10,16,35),
         (6,9,18,35), (6,8,19,35), (6,7,21,35), (6,7,21,35),
         (6,7,21,35), (21,36), (21,36), (6,7,21,37),
         (6,7,22,37), (6,8,24,37), (6,8,25,37), (27,30)])
 for y,ranges in enumerate(spans,5):
  panel=(round(9+0.79*y),round(6+0.63*y),round(5+0.58*y),252)
  for start,stop in zip(ranges[::2],ranges[1::2]):
   for x in range(start,stop):
    base[x,y]=panel
 textures={}
 for i,role in enumerate(('buff','debuff')):
  name=f'com_icon_{9000+i}_00_sqr'
  overlay=read_overlay((art/f'ai_{role}-transparent-chevrons.png').read_bytes(),native.size)
  textures[name]=rebuild_texture(donor,name,over(base,overlay),native)
 return textures

def project(read):
    """Supply missing AI rows for the buttons, retaining profiles already saved."""
    archive = DatArchive.read(read(BATTLE))
    pack = Pakd(archive.pack)
    table = Xlce(pack.entry(AI_PROFILES))
    if table.row_size != 98 or not STOCK_AI_ROWS <= table.count <= 256:
        raise ValueError('Buff and Debuff need the standard AI profile table')
    out = build(read)
    missing = PROFILES[table.count - STOCK_AI_ROWS:]
    if missing:
        end = table.header + table.count * table.row_size
        if len(table.data) - end > 16 or any(table.data[end:]):
            raise ValueError('The AI profile table has extra data after its rows')
        data = bytearray(table.data[:end])
        for base, weights in missing:
            row = bytearray(table.row(base))
            for offset, weight in weights.items():
                struct.pack_into('<h', row, offset, weight)
            data.extend(row)
        struct.pack_into('<I', data, 4, table.count + len(missing))
        data.extend(bytes(16 - len(data) % 16))
        out[BATTLE] = archive.rebuild(rebuild_pakd(pack, {AI_PROFILES: bytes(data)}))
    return out

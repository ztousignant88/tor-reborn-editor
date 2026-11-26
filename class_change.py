"""Apply the playtested class-group recipe to a project's effective data."""
from pathlib import Path
import hashlib
import json
import struct

from ai_choices_data import rebuild_pakd
import modprep_groups
from class_art import build_textures
from tools.menu_mods.compiler.spell_icons import TextureArc
from tools.menu_mods.compiler.class_text import patch_archive,read_archive
from tools.menu_mods.compiler.save_archive import SaveArchive,MAIN_TAG
from tools.menu_mods.compiler.tor_formats import DatArchive,Pakd,Xlce

ROOT=Path(__file__).resolve().parent/'tools/class_change'
BATTLE='battle/battle_data_release.dat'
MENU='menu/menu_data.dat'
ART='menu/texture_x4/com_class.dat'
SIDECARS=('modprep-classgroups.bin','modprep-classmenu.bin','modprep-classgroups-project.json')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def recipe():
    return json.loads((ROOT/'recipe.json').read_text(encoding='utf8'))

def item_pool(r):
    return {'markStart':r['itemStart'],'markCount':len(r['itemRows']),
            'limit':modprep_groups.PLAN['itemTableLimit']}


def append_art(data,rows):
    archive=DatArchive.read(data)
    pack=Pakd(archive.pack)
    return archive.rebuild(rebuild_pakd(pack,{0:TextureArc(pack.entry(0)).append(rows)}))


def build(read):
    r=recipe()
    battle=DatArchive.read(read(BATTLE))
    pack=Pakd(battle.pack)
    items,classes,templates=(Xlce(pack.entry(i)) for i in (13,14,23))
    pool=item_pool(r)
    start=pool['markStart']
    mark_end=start+pool['markCount']
    if items.row_size!=56 or not start<=items.count<=pool['limit']:
        raise ValueError('Special Class Change needs the stock item layout and at most 1,000 item rows')
    for index in range(start,min(mark_end,items.count)):
        if any(items.row(index)):
            raise ValueError(f'Class-mark item slot {index} is already used by this project. Move the conflicting item before applying Special Class Change.')
    native=modprep_groups.NATIVE_TEMPLATES
    if (classes.row_size,classes.count,templates.row_size)!=(208,r['classCount'],84) or not native<=templates.count<=modprep_groups.TEMPLATE_LIMIT:
        raise ValueError('Special Class Change needs the stock class layout and character template IDs below 1,000')
    if any(templates.row(i)[0x38]>=64 for i in range(templates.count)):
        raise ValueError('Character sheets need a native class group from 0 to 63. Assign wider groups in the class-change editor.')
    count=max(items.count,mark_end)
    rows=b''.join(bytes.fromhex(row) for row in r['itemRows'])
    offset=items.header+start*items.row_size
    after=items.header+min(mark_end,items.count)*items.row_size
    out=bytearray(items.data[:offset]+rows+items.data[after:])
    struct.pack_into('<I',out,4,count)
    generated={BATTLE:battle.rebuild(rebuild_pakd(pack,{13:bytes(out)}))}
    art=read(ART)
    generated[ART]=append_art(art,build_textures(read,battle,art))
    for file,edits in r['text'].items():
        rel='localize/'+file
        data=read(rel)
        before=read_archive(data)
        changes={k:bytes.fromhex(v) for k,v in edits.items()}
        for k in changes:
            if k.startswith('COMMODITYTEXT_') and before.get(k) not in (None,b'',changes[k]):
                raise ValueError('Class mark text is already in use: '+k)
        data=patch_archive(data,{k:v for k,v in changes.items() if k.startswith('COMMODITYTEXT_')},'COMMODITYTEXT_')
        generated[rel]=patch_archive(data,{k:v for k,v in changes.items() if k.startswith('CLASS_TEXT_')},'CLASS_TEXT_DATA_CLASS')
    return generated


def is_generic_enemy(unit):
    return unit[0x10]==2 and not any(unit[:2]) and not (unit[0x12] or unit[0x13])


def entry_units(data):
    def visit(raw):
        pack=Pakd(raw)
        if len(pack)==2 and pack.entry(0).startswith(b'xlce'):
            units=Xlce(pack.entry(0))
            if units.row_size==196:
                yield from (units.row(i) for i in range(units.count))
                return
        for i in range(len(pack)):
            part=pack.entry(i)
            if part.startswith(b'pakd'):
                yield from visit(part)

    yield from visit(DatArchive.read(data).pack)


def generic_recruitment(data, entries, names, marks, custom_templates=()):
    """Enable all three recruitment gates for eligible generic special enemies."""
    archive=DatArchive.read(data)
    pack=Pakd(archive.pack)
    classes,templates=(Xlce(pack.entry(i)) for i in (14,23))
    # Templars share human marks, so they do not appear in the new-mark list.
    specials=set(marks)|set(range(81,97))
    named_templates=set(custom_templates)
    named_templates.update(
        i for i in range(templates.count)
        if templates.row(i)[0x15]!=1 and names.get(f'UNITNAME0_LC_UNITNAME_{i:04d}_TEXT',b'').strip()
    )
    candidates=set()
    protected_enemies=set()
    protected_templates=set(named_templates)
    for entry in entries:
        for unit in entry_units(entry):
            klass=unit[6]
            template=struct.unpack_from('<H',unit,2)[0]
            if template>=templates.count:
                continue
            if not is_generic_enemy(unit) or template in named_templates:
                if any(unit[:2]) or unit[0x12] or unit[0x13] or template in named_templates:
                    protected_templates.add(template)
                    if unit[0x10]==2 and unit[0x9a]==0:
                        protected_enemies.add((klass,template))
            elif klass in specials:
                candidates.add((klass,template))

    # Shared class flags may only change where existing named enemies already
    # have a template or encounter restriction of their own.
    protected_classes={klass for klass,template in protected_enemies
                       if templates.row(template)[0x14]!=0}
    allowed={(klass,template) for klass,template in candidates
             if (classes.row(klass)[0x5d]==1 or klass not in protected_classes)
             and (templates.row(template)[0x14]==1 or template not in protected_templates)}
    class_edits={}
    template_edits={}
    for klass,template in sorted(allowed):
        row=classes.row(klass)
        if row[0x5d]!=1:
            class_edits[klass]=row[:0x5d]+b'\x01'+row[0x5e:]
        row=templates.row(template)
        if row[0x14]!=1:
            template_edits[template]=row[:0x14]+b'\x01'+row[0x15:]
    changes={}
    if class_edits:
        changes[14]=classes.replace(class_edits)
    if template_edits:
        changes[23]=templates.replace(template_edits)
    return (archive.rebuild(rebuild_pakd(pack,changes)) if changes else archive.original),allowed


def mark_drops(data,marks,recruitment=()):
    archive=DatArchive.read(data)

    def visit(raw):
        pack=Pakd(raw)
        if len(pack)==2 and pack.entry(0)[:4]==b'xlce':
            units=Xlce(pack.entry(0))
            if units.row_size==196:
                edits={}
                for i in range(units.count):
                    unit=bytearray(units.row(i))
                    if unit[0x9a] and is_generic_enemy(unit):
                        template=struct.unpack_from('<H',unit,2)[0]
                        if (unit[6],template) in recruitment:
                            unit[0x9a]=0
                            edits[i]=bytes(unit)
                    mark=marks.get(unit[6])
                    if unit[0x10]!=2 or not mark:
                        continue
                    slots=[struct.unpack_from('<H',unit,at)[0] for at in range(0x76,0x86,4)]
                    if mark not in slots and 0 in slots:
                        struct.pack_into('<HBB',unit,0x76+4*slots.index(0),mark,1,100)
                        edits[i]=bytes(unit)
                return rebuild_pakd(pack,{0:units.replace(edits)}) if edits else raw
        edits={}
        for i in range(len(pack)):
            part=pack.entry(i)
            if part[:4]==b'pakd':
                changed=visit(part)
                if changed!=part:
                    edits[i]=changed
        return rebuild_pakd(pack,edits) if edits else raw

    return archive.rebuild(visit(archive.pack))


def variant_data(mode):
    payload={n:(ROOT/mode/n).read_bytes() for n in SIDECARS}
    expected=recipe()['variants'][mode]
    metadata='modprep-classgroups-project.json'
    # Git's Windows checkout can convert this JSON file to CRLF. Accept
    # that conversion only when the LF bytes match the original checksum.
    if sha(payload[metadata])!=expected.get(metadata):
        payload[metadata]=payload[metadata].replace(b'\r\n',b'\n')
    if {n:sha(b) for n,b in payload.items()}!=expected:
        raise ValueError('The bundled class group data changed')
    return payload


def group_catalog(linked):
    mode='linked' if linked else 'separate'
    payload=variant_data(f'{mode}-{modprep_groups.NATIVE_TEMPLATES}')
    permissions=payload['modprep-classgroups.bin']
    _,_,_,_,classes,_,stride,matrix,assignments,*_=modprep_groups.HEADER.unpack_from(permissions)
    metadata=json.loads(payload['modprep-classgroups-project.json'])
    groups=[]
    for group in metadata['groups']:
        templates=group['templates']
        ident=struct.unpack_from('<I',permissions,assignments+4*templates[0])[0]
        allowed=[klass for klass in range(1,classes) if permissions[matrix+klass*stride+ident//8] & (1<<(ident%8))]
        groups.append({'id':ident,'label':group['label'],'templates':templates,'classes':allowed,
                       'menuRace':group.get('menuRace'),'actor':group.get('actor')})
    return groups


def menu_class_icons(menu):
    count,_,rows_at=struct.unpack_from('<III',menu,12)
    icons={}
    for klass in range(count):
        _, icon, mode=struct.unpack_from('<HHI',menu,rows_at+8*klass)
        if mode in (1,2):
            icons[str(klass)]=icon
    return icons


def menu_class_marks(menu):
    count,_,rows_at=struct.unpack_from('<III',menu,12)
    return {str(klass): (0 if klass==92 else mark)
            for klass,(mark,_,mode) in enumerate(struct.iter_unpack('<HHI', menu[rows_at:rows_at+8*count]))
            if mode and klass!=77}


def runtime(value,battle,menu,community_groups=(),overrides=None):
    r=recipe()
    mode='linked' if value['advancedBeastFamilies'] else 'separate'
    pack=Pakd(DatArchive.read(battle).pack)
    templates=Xlce(pack.entry(23))
    native=modprep_groups.NATIVE_TEMPLATES
    # Use the playtested one-sheet variant when its copied class group matches.
    base=native+1 if templates.count>native and templates.row(native)[0x38]==r['selectors'][native] else native
    mode=f'{mode}-{base}'
    payload=variant_data(mode)
    identity=payload['modprep-classgroups.bin']
    if value['modPreparation']:
        menu_data=payload['modprep-classmenu.bin']
        identity=modprep_groups.extend(identity,community_groups,Xlce(pack.entry(14)),templates,menu_data,overrides)
        payload['modprep-classgroups.bin']=identity
        payload['modprep-classmenu.bin']=modprep_groups.extend_menu(menu_data,templates.count,identity[80:112])
        metadata=json.loads(payload['modprep-classgroups-project.json'])
        metadata['communityClassGroups']=list(community_groups)
        if overrides:
            metadata[modprep_groups.OVERRIDES]=overrides
        metadata['classGroupCapacity']=modprep_groups.GROUP_LIMIT
        metadata['permissionAllocationDigest']=identity[80:112].hex()
        payload['modprep-classgroups-project.json']=json.dumps(metadata,indent=2).encode('utf-8')
    ini=(
        '[ModPreparationClassGroups]\r\nEnabled=1\r\nExtendedMenu=1\r\n'
        f'ProjectDigest={identity[48:80].hex()}\r\nAllocationDigest={identity[80:112].hex()}\r\n'
        f'BattleDataSHA256={sha(battle)}\r\nMenuDataSHA256={sha(menu)}\r\n'
    ).encode('ascii')
    return ini,payload


def assert_can_remove():
    """Keep an installed item provider while a normal PC save holds its marks."""
    r=recipe()
    start=r['itemStart']
    end=start+len(r['itemRows'])
    saves=Path.home()/'Documents/My Games/Tactics Ogre Reborn/Steam'
    for path in saves.glob('*/GAME-*.SAV'):
        try:
            main=SaveArchive(path.read_bytes()).blocks[MAIN_TAG].payload
            if len(main)!=383896:
                raise ValueError('unsupported save layout')
        except (OSError,ValueError,KeyError) as exc:
            raise ValueError(f'Could not verify whether {path.name} holds Special Class Change marks') from exc
        at=0xc6+0x7b5*105+5*128+0x5f2
        if any(struct.unpack_from(f'<{end-start}H',main,at+2*start)):
            raise ValueError(f'{path.name} still holds Special Class Change marks. Keep the mod active for that save.')

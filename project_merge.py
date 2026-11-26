"""Preview and save merges of two saved editor projects."""
from collections import defaultdict
from hashlib import sha1, sha256
import json
import os
from pathlib import Path
import re
import shutil
import struct
from uuid import uuid4

import art_registry
import icon_import
import modprep_equipperms
import modprep_groups
import modprep_sets
import modprep_spellsets
import starting_status_settings
from tools.menu_mods.compiler.class_text import read_archive
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd, Xlce
import project_merge_formats as formats
import project_merge_renumber

GROUPS = {
    'communityClassGroups': ('Class-change groups', modprep_groups.settings, modprep_groups.GROUP_START, modprep_groups.GROUP_LIMIT, 'templates'),
    'communityEquipmentSets': ('Equipment sets', modprep_sets.settings, modprep_sets.FIRST, modprep_sets.LIMIT, 'members'),
    'communitySpellSets': ('Spell permission groups', modprep_spellsets.settings, modprep_spellsets.FIRST, modprep_spellsets.LIMIT, 'classes'),
    'communitySkillSets': ('Skill permission groups', lambda rows: modprep_spellsets.settings(rows,'skill'), modprep_spellsets.FIRST, modprep_spellsets.SKILL_LIMIT, 'classes'),
    'communityEquipmentPermissions': ('Equipment permission groups', modprep_equipperms.settings, modprep_equipperms.FIRST, modprep_equipperms.LIMIT, 'classes'),
}
LINKED_SETTINGS = {'aiChoices', 'trapAiProfile', 'specialClassChange', 'advancedBeastFamilies',
                   'genericSpecialRecruitment', 'equipmentSetBonuses', 'equipmentSetFreeSkills',
                   'modPreparation', 'rougesReborn', 'throwReborn', 'proficiencyII', 'pspSpellRuntime'}
ENGLISH = 'localize/LocalizeText_en-us.dat'
HASH = re.compile(r'[0-9a-f]{40}')
ABSENT = object()


def digest(data):
    return sha1(data).hexdigest()


def stable(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()


def describe(value):
    if value is ABSENT or value is None:
        return 'Absent'
    if isinstance(value, bytes):
        return value.hex(' ') if len(value)<=24 else f'{len(value):,} bytes · {digest(value)[:10]}'
    if isinstance(value, bool):
        return 'On' if value else 'Off'
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def remember_base(config, data, atomic):
    root=config.project_root/'.merge-bases'
    path=root/digest(data)
    if not path.is_file():
        root.mkdir(parents=True,exist_ok=True)
        atomic(path,data)


class Choices:
    def __init__(self, values):
        if not isinstance(values,dict) or any(not isinstance(key,str) or not re.fullmatch(r'[0-9a-f]{24}',key)
                                             or side not in ('current','incoming','both') for key,side in values.items()):
            raise ValueError('Invalid merge choices')
        self.values=values
        self.conflicts=[]

    def __call__(self, location, base, current, incoming, *, reason='Both projects changed this value.', show=describe,
                 both=ABSENT, captions=None):
        settled,value=formats.scalar(base,current,incoming)
        if settled:
            return value
        ident=sha256(stable(location)).hexdigest()[:24]
        options={'current':current,'incoming':incoming}
        if both is not ABSENT:
            options['both']=both
        picked=self.values.get(ident)
        if picked not in options:
            picked=None
        details={key:show(val)[:360] for key,val in options.items()} if captions is None else captions
        self.conflicts.append({'id':ident,'location':location,'reason':reason,
                               'original':show(base)[:360] if base is not ABSENT else None,
                               'options':details,'choice':picked})
        return options[picked or 'current']


def load_project(config, name):
    root=config.project_dir(name).resolve()
    if root.parent!=config.project_root.resolve():
        raise ValueError('Project folder escapes the projects directory')
    meta=config.project(name)
    files={}
    paths=set()
    for rel,entry in meta.get('files',{}).items():
        path=config.resolve(rel)
        if (config.rel(path)!=rel or rel.casefold() in paths or rel.casefold()=='filetable.bin'
                or path.suffix.lower() not in {'.dat','.bin'}):
            raise ValueError(f'Invalid project file path in {name}: {rel}')
        source=(root/'files'/rel).resolve()
        if (root/'files').resolve() not in source.parents or root not in source.parents:
            raise ValueError(f'Project file escapes its folder: {rel}')
        data=source.read_bytes()
        if len(data)!=entry['size'] or digest(data)!=entry['sha1']:
            raise ValueError(f'Project file changed in {name}: {rel}')
        if entry['base'] is not None and not HASH.fullmatch(entry['base']):
            raise ValueError(f'Invalid starting file hash: {rel}')
        paths.add(rel.casefold())
        files[rel]=(entry['base'],data)
    return meta,files


def find_base(config, rel, original):
    if original is None:
        return None
    for path in (config.project_root/'.merge-bases'/original, config.backup_root/rel, config.resolve(rel)):
        if path.is_file():
            data=path.read_bytes()
            if digest(data)==original:
                return data
    return None


def class_names(config, left, right):
    originals={file[0] for files in (left,right) if (file:=files.get(ENGLISH))}
    if len(originals)>1:
        return set()
    if originals:
        data=find_base(config,ENGLISH,next(iter(originals)))
    else:
        backup=config.backup_root/ENGLISH
        path=backup if backup.is_file() else config.resolve(ENGLISH)
        data=path.read_bytes() if path.is_file() else None
    if not data:
        return set()
    return {int(match[1]) for key in read_archive(data)
            if (match:=re.fullmatch(r'CLASS_TEXT_DATA_CLASS(\d+)_(?:MALE|FEMALE|HELP)',key))}


def linked_collision(config, current, incoming, left, right, settled=()):
    for key,normalizer,identities in (
        ('customCharacters',art_registry.characters,('template','actor','appearance','stem')),
        ('artEntries',art_registry.registrations,('path',('directory','id'))),
    ):
        records=normalizer(current.get(key))
        for identity in identities:
            attrs=(identity,) if isinstance(identity,str) else identity
            def key_of(record):
                return tuple(record[k].casefold() if isinstance(record[k],str) else record[k] for k in attrs)
            seen={key_of(record):record for record in records}
            for record in normalizer(incoming.get(key)):
                owner=seen.get(key_of(record))
                if owner is not None and owner!=record:
                    name=record.get('name',record.get('path'))
                    return f'{name} shares a character or art ID with the other project.'
    icon_slots={icon_import.identity(row):row for row in icon_import.catalog(current.get('customIcons'))}
    for row in icon_import.catalog(incoming.get('customIcons')):
        other=icon_slots.get(icon_import.identity(row))
        if other is not None and (row != other or icon_import.fingerprint(left, other) != icon_import.fingerprint(right, row)):
            return f"Custom icon {row['label']} shares slot #{row['id']} with a different icon in the other project."
    path=formats.BATTLE
    if path not in left or path not in right or left[path][1]==right[path][1]:
        return None
    (a,l),(b,r)=left[path],right[path]
    if a==digest(r) or b==digest(l):
        return None
    if a!=b:
        return 'The battle archives started from different game data. Their record IDs may refer to different entries.'
    base=find_base(config,path,a)
    if base is None:
        return 'The matching original battle archive is unavailable, so its linked record IDs cannot be checked.'
    try:
        return formats.identity_collision(base,l,r,class_names(config,left,right),settled)
    except (ValueError,IndexError,struct.error,UnicodeError):
        return 'The battle archives use a layout whose linked record IDs cannot be compared.'


def merge_file(config, choose, path, left, right):
    if left is None or right is None:
        return left or right
    original,a=left
    other,b=right
    if a==b:
        return left
    if other==digest(a):
        return original,b
    if original==digest(b):
        return other,a
    base=find_base(config,path,original) if original==other else None
    if base is not None:
        resolved,value=formats.scalar(base,a,b)
        if resolved:
            return original,value
        if path in {icon_import.archive_path(bank) for bank in icon_import.BANKS}:
            checkpoint=len(choose.conflicts)
            try:
                def resolve(name, base_body, left_body, right_body):
                    return choose((path, name),base_body,left_body,right_body,
                                  reason='Both projects change this icon.')
                return original,icon_import.merge_archive(resolve,(base,a,b))
            except (ValueError, IndexError, struct.error, UnicodeError):
                del choose.conflicts[checkpoint:]
        if formats.recognized(path):
            checkpoint=len(choose.conflicts)
            try:
                return original,formats.merge_archive(choose,path,(base,a,b))
            except (ValueError,IndexError,struct.error,UnicodeError):
                del choose.conflicts[checkpoint:]
    reason=('The projects started from different versions of this file.' if original!=other else
            'The matching original file is unavailable.' if original and base is None else
            'Choose the complete file to use.')
    selected=choose((path,),ABSENT,a,b,reason=reason)
    return left if selected==a else right


def unique_records(a,b):
    return list({stable(row):row for row in [*a,*b]}.values())


def group_summary(rows):
    descriptions=[]
    for row in rows:
        details={key:value for key,value in row.items() if key not in ('id','name','levels')}
        if 'levels' in row:
            details['Learning levels']=', '.join(f'{ident}={level}' for ident,level in enumerate(row['levels']) if level!=255) or 'None'
        text='\n'.join(f'{key.capitalize()}: {describe(value)}' for key,value in details.items())
        descriptions.append(f"{row['name']} (#{row['id']})\n{text}")
    return '\n'.join(descriptions)


def merge_groups(choose, a, b, spec):
    title,validate,first,limit,exclusive=spec
    left={row['id']:row for row in validate(a)}
    right={row['id']:row for row in validate(b)}
    occupied=set(left)|set(right)
    result={}
    right_ids={}
    for ident in sorted(occupied):
        l,r=left.get(ident),right.get(ident)
        if l is None or r is None or l==r:
            result[ident]=dict(l or r)
            continue
        free=next((i for i in range(first,limit) if i not in occupied and i not in result),None)
        both=[l,{**r,'id':free}] if free is not None else ABSENT
        picked=choose((title,f'Group {ident}'),ABSENT,[l],[r],both=both,
                      reason=('The groups use the same ID. Keep both assigns the incoming group a free ID.'
                              if free is not None else 'The groups use the same ID and all group IDs are occupied.'),
                      show=group_summary)
        for row in picked:
            result[row['id']]=dict(row)
        if len(picked)==2:
            right_ids[ident]=free
    assignments=defaultdict(list)
    for ident,row in result.items():
        for member in row[exclusive]:
            assignments[member].append(ident)
    l_owner={member:ident for ident,row in left.items() for member in row[exclusive]}
    r_owner={member:right_ids.get(ident,ident) for ident,row in right.items() for member in row[exclusive]}
    for member, owners in assignments.items():
        if len(owners)>1:
            keep=choose((title,f'{exclusive.capitalize()} ID {member}'),ABSENT,l_owner[member],r_owner[member],
                        reason='This entry can belong to only one group.',show=lambda ident: result[ident]['name'])
            for ident in owners:
                if ident!=keep:
                    result[ident][exclusive]=[item for item in result[ident][exclusive] if item!=member]
    return validate(list(result.values()))


def merge_editor(choose, runtime, left_meta, right_meta, left, right, linked):
    merged={}
    safe=(left if linked=='current' else right) if linked else None
    for key in sorted(set(left)|set(right)):
        if key=='menuMods':
            continue
        a,b=left.get(key,ABSENT),right.get(key,ABSENT)
        if safe is not None:
            value=safe.get(key,ABSENT)
        elif key == modprep_groups.OVERRIDES:
            l=modprep_groups.override_settings(left.get(key))
            r=modprep_groups.override_settings(right.get(key))
            value={}
            for group in sorted(set(l)|set(r),key=int):
                first,second=l.get(group,{}),r.get(group,{})
                choices={}
                for klass in sorted(set(first)|set(second),key=int):
                    choice=choose(('Built-in class-change groups',f'Group {group}',f'Class {klass}'),ABSENT,
                                  first.get(klass,ABSENT),second.get(klass,ABSENT))
                    if choice is not ABSENT:
                        choices[klass]=choice
                if choices:
                    value[group]=choices
        elif key == 'integratedContentEdits':
            value={}
            for path in sorted(set((left.get(key) or {})) | set((right.get(key) or {}))):
                tables={}
                l=(left.get(key) or {}).get(path, {})
                r=(right.get(key) or {}).get(path, {})
                for entry in sorted(set(l) | set(r)):
                    records={}
                    for record in sorted(set(l.get(entry, {})) | set(r.get(entry, {}))):
                        edit=choose(('Integrated mod content',path,f'Table {entry}',record),ABSENT,
                                    l.get(entry, {}).get(record, ABSENT),r.get(entry, {}).get(record, ABSENT))
                        if edit is not ABSENT:
                            records[record]=edit
                    if records:
                        tables[entry]=records
                if tables:
                    value[path]=tables
        elif key in GROUPS:
            value=merge_groups(choose,None if a is ABSENT else a,None if b is ABSENT else b,GROUPS[key])
        elif key in ('artEntries','customCharacters','artImports','customIcons'):
            value=unique_records(left.get(key) or [],right.get(key) or [])
        elif key=='restrictionGroups':
            l=(left.get(key) or {}).get('groups',{})
            r=(right.get(key) or {}).get('groups',{})
            value={'version':1,'groups':{ident:choose(('Restriction group names',f'Group {ident}'),ABSENT,
                         l.get(ident,ABSENT),r.get(ident,ABSENT)) for ident in sorted(set(l)|set(r))}}
        elif key == 'mapBackdrops':
            l, r = left.get(key) or {}, right.get(key) or {}
            value = {}
            for name in sorted(l.keys() | r.keys()):
                ident = choose(('Map backdrops', name), ABSENT, l.get(name, ABSENT), r.get(name, ABSENT))
                if ident is not ABSENT:
                    value[name] = ident
        else:
            value=choose(('Project settings',key),ABSENT,a,b)
        if value is not ABSENT:
            merged[key]=value

    defaults=runtime.settings()
    a,b=runtime.project_settings(left_meta),runtime.project_settings(right_meta)
    level_keys=('enemyLevelScaling','enemyLevelOffset')
    settings={}
    values=[{key:source[key] for key in level_keys} for source in (defaults,a,b)]
    settings.update(choose(('Integrated mods','Enemy levels'),*values,
                           show=lambda value: ('Enabled' if value['enemyLevelScaling'] else 'Disabled')+
                           f" · +{value['enemyLevelOffset']} levels"))
    rank_keys=('enemyProficiency40','enemyProficiencyLevel')
    ranks=[{key:source[key] for key in rank_keys} for source in (defaults,a,b)]
    settings.update(choose(('Integrated mods','Enemy weapon proficiency'),*ranks,
                           show=lambda value: 'Match enemy level (max 40)' if value['enemyProficiencyLevel']
                           else 'Always rank 40' if value['enemyProficiency40'] else 'Game default'))
    ai_keys=()
    if any('aiPlusProfiles' in source for source in (a,b)):
        ai_keys=('aiPlusProfiles','aiPlusReplacements','aiChoices','aiStatus','aiStatusAll')
        choices=[{key:source[key] for key in ai_keys if key in source} for source in (defaults,a,b)]
        settings.update(choose(('Integrated mods','AI Plus profiles and status scoring'),*choices))
    labels={**runtime.LABELS,'formationLimit':'Formation limit','trapAiProfile':'Trap AI profile',
            'enemyStartingCards':'Enemy starting cards','playerStartingCards':'Player starting cards',
            'enemyStartingStatus':'Enemy starting statuses','playerStartingStatus':'Player starting statuses',
            'startingStatusAllowCure':'Allow cures for persistent starting statuses'}
    for key,base in defaults.items():
        if key in (*level_keys,*rank_keys,*ai_keys):
            continue
        if linked and key in LINKED_SETTINGS:
            settings[key]=(a if linked=='current' else b)[key]
            continue
        both=ABSENT
        if key in starting_status_settings.LOADOUTS and a[key]['persistent']==b[key]['persistent']:
            combined={'conditions':sorted(set(a[key]['conditions'])|set(b[key]['conditions'])), 'persistent':a[key]['persistent']}
            try:
                starting_status_settings.settings({**starting_status_settings.defaults(),key:combined})
                both=combined
            except ValueError:
                pass
        if key=='enemyEquipmentOverrides':
            selected={}
            for ident in sorted(set(a[key])|set(b[key]),key=int):
                first,second=a[key].get(ident,{}),b[key].get(ident,{})
                entry={}
                for field in ('allowed','level'):
                    result=choose(('Enemy equipment pool',f'Equipment ID {ident}',field),ABSENT,
                                  first.get(field,ABSENT),second.get(field,ABSENT))
                    if result is not ABSENT:
                        entry[field]=result
                if entry:
                    selected[ident]=entry
            settings[key]=selected
        elif key=='enemyItemPool':
            settings[key]=choose(('Integrated mods',labels[key]),base,a[key],b[key],both=a[key]|b[key],
                                 show=runtime.enemy_item_pool_label)
        else:
            settings[key]=choose(('Integrated mods',labels.get(key,key)),base,a[key],b[key],both=both)
    merged['menuMods']=runtime.settings(settings)
    return merged


def preview(config, runtime, current, incoming, decisions):
    left_meta,left=load_project(config,current)
    right_meta,right=load_project(config,incoming)
    a={**left_meta.get('editor',{})}
    b={**right_meta.get('editor',{})}
    for meta,editor in ((left_meta,a),(right_meta,b)):
        if 'customCharacters' not in editor and meta.get('customCharacters'):
            editor['customCharacters']=meta['customCharacters']
    choose=Choices(decisions)
    # characters already copied into the current project (with new IDs) leave the incoming side
    copied={}
    for character in art_registry.characters(a.get('customCharacters')):
        origin=character.get('copiedFrom')
        if origin and origin['project']==incoming:
            copied[(origin['stem'].casefold(),origin['template'],origin['actor'],origin['appearance'])]=character['template']
    known={}
    if copied:
        kept,dropped=[],set()
        for character in art_registry.characters(b.get('customCharacters')):
            key=(character['stem'].casefold(),character['template'],character['actor'],character['appearance'])
            if key in copied:
                known[character['template']]=copied[key]
                dropped|={f"object/{character['stem']}.dat".casefold(),f"object/{character['stem']}00.dat".casefold()}
            else:
                kept.append(character)
        b['customCharacters']=kept
        b['artEntries']=[entry for entry in art_registry.registrations(b.get('artEntries')) if entry['path'].casefold() not in dropped]
        right={path:value for path,value in right.items() if path.casefold() not in dropped}
    renumbered,unsafe,settled=[],None,set()
    try:
        moved=project_merge_renumber.renumber(config,a,b,left,right,class_names(config,left,right),find_base,ENGLISH,
                                              known={23:known} if known else None)
    except project_merge_renumber.Unsafe as error:
        moved,unsafe=None,str(error)
    except (ValueError,IndexError,KeyError,struct.error,UnicodeError) as error:
        moved,unsafe=None,f'New IDs could not be given out ({error}).'
    if moved:
        right,b,renumbered,settled=moved
    collision=linked_collision(config,a,b,left,right,settled)
    if collision and unsafe:
        collision=f'{collision} {unsafe}'
    if collision:
        linked=choose(('Linked project changes',),ABSENT,'current','incoming',reason=collision,
                      captions={'current':f'Use the game files and linked definitions from {current}',
                                'incoming':f'Use the game files and linked definitions from {incoming}'})
        files=left if linked=='current' else right
    else:
        linked=None
        files={path:merge_file(config,choose,path,left.get(path),right.get(path))
               for path in sorted(set(left)|set(right))}
    if len({path.casefold() for path in files})!=len(files):
        raise ValueError('The projects contain different spellings of the same file path')
    editor=merge_editor(choose,runtime,left_meta,right_meta,a,b,linked)
    entries={path:{'base':base,'sha1':digest(data),'size':len(data)} for path,(base,data) in files.items()}
    token=sha256(stable((current,incoming,left_meta,right_meta,entries,editor,choose.conflicts,
                         str(config.data_root),config.state().get('applied')))).hexdigest()
    pending=sum(conflict['choice'] is None for conflict in choose.conflicts)
    meta={'files':entries,'editor':editor,'merge':{'sources':[current,incoming],
          'choices':{conflict['id']:conflict['choice'] for conflict in choose.conflicts}}}
    return meta,files,{'token':token,'conflicts':choose.conflicts,'pending':pending,'files':list(entries),
                       'mods':runtime.enabled_labels(editor['menuMods']), 'linked':bool(linked),
                                       'renumbered':renumbered}


def validate_assets(meta, files):
    editor=meta['editor']
    registrations=art_registry.registrations(editor.get('artEntries'))
    available={(row['directory'],row['id'],row['path']) for row in registrations}
    for row in registrations:
        if row['path'] not in files:
            raise ValueError(f"Merged art is missing its project file: {row['path']}")
    for row in icon_import.catalog(editor.get('customIcons')):
        if icon_import.fingerprint(files, row) is None:
            raise ValueError(f"Merged project is missing the texture for {row['label']}")
    characters=art_registry.characters(editor.get('customCharacters'))
    if characters:
        if formats.BATTLE not in files:
            raise ValueError('Merged characters need the project’s character sheets')
        table=Xlce(Pakd(DatArchive.read(files[formats.BATTLE][1]).pack).entry(23))
        for row in characters:
            required={(20,row['actor'],'object/'+row['stem']+'.dat'),(30,row['appearance'],'object/'+row['stem']+'00.dat')}
            sheet=table.row(row['template'])
            if not required<=available or int.from_bytes(sheet[0x3a:0x3c],'little')!=row['actor']:
                raise ValueError(f"Merged character {row['name']} is missing a matching sheet or art registration")


def handle(handler, body, runtime, now, atomic):
    config=handler.config
    if (not isinstance(body,dict) or type(body.get('commit',False)) is not bool
            or any(not isinstance(body.get(key),str) for key in ('current','incoming','name'))):
        raise ValueError('Choose two saved projects and a name for the result')
    current,incoming,name=(body[key].strip() for key in ('current','incoming','name'))
    with config.write_lock:
        if current!=config.open_project() or current.casefold()==incoming.casefold():
            raise ValueError('Open the starting project and choose a different project to merge')
        target=config.project_dir(name)
        if target.exists() or target.is_symlink():
            raise FileExistsError('Choose a new name for the merged project')
        meta,files,result=preview(config,runtime,current,incoming,body.get('choices',{}))
        if result['pending']:
            if body.get('commit'):
                raise ValueError('Resolve every merge conflict before creating the project')
            return result
        if body.get('commit') and body.get('token')!=result['token']:
            raise ValueError('The projects changed since the preview. Review the merge again')
        validate_assets(meta,files)
        meta.update(name=name,created=now(),saved=now())
        config.project_root.mkdir(parents=True,exist_ok=True)
        stage=config.project_root/('.merge-stage-'+uuid4().hex)
        stage.mkdir()
        try:
            draft=stage/name
            (draft/'files').mkdir(parents=True)
            for path,(_,data) in files.items():
                copy=draft/'files'/path
                copy.parent.mkdir(parents=True,exist_ok=True)
                copy.write_bytes(data)
            (draft/'project.json').write_bytes(stable(meta))
            # Run the same preview used by Apply, with the unpublished project as its source.
            validation=object.__new__(type(handler))
            validation.config=type(config)(config.data_root,config.backup_root,stage,True)
            validation.config.state=config.state
            validation._body=lambda:{'name':name,'dryRun':True,'revertOthers':True}
            apply={}
            validation._json=apply.update
            try:
                state=config.state().get('applied') or {}
                registrations=meta['editor'].get('artEntries') or []
                changed_paths={row['path'] for row in registrations}
                removed=[row for row in state.get('artEntries',[]) if row['path'] not in changed_paths]
                art_registry.reconcile(config.resolve('FileTable.bin').read_bytes(),registrations,
                                       {path:entry['size'] for path,entry in meta['files'].items()},removed)
                validation._project_apply()
                result['apply']=apply
            except (OSError,ValueError,AssertionError,struct.error) as error:
                result['applyIssue']=str(error)
            if not body.get('commit'):
                return result
            for path,(base,_) in files.items():
                original=find_base(config,path,base)
                if original is not None:
                    remember_base(config,original,atomic)
            os.rename(draft,target)
        finally:
            if stage.resolve().parent==config.project_root.resolve():
                shutil.rmtree(stage)
        return {**result,'ok':True,'project':name}

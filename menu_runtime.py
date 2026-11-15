"""Project settings and owned, reversible deployment of the bundled menu runtime."""
from pathlib import Path
import hashlib,json,os,subprocess,datetime,uuid
import class_change
import weapon_mods
import modprep_groups
import modprep_sets
import starting_status_settings as statuses
import modprep_spellsets
import modprep_equipperms
import enemy_equipment_overrides as equipment_overrides

BUG_FIX_SECTIONS={'offhandDamageFix': 'OffhandDamageFix', 'armorResistanceFix': 'ArmorResistanceFix'}

FIELDS=('fastForward','chariot','autoBattle','unionLevel','skipChapterVideos','aiStatus','aiStatusAll','aiChoices','aiEnemyMpRecovery','aiDefaultBuffWeight','aiDefaultHealingWeights',*BUG_FIX_SECTIONS,'modPreparation','equipmentSetBonuses','equipmentSetFreeSkills','specialClassChange','advancedBeastFamilies','genericSpecialRecruitment',*weapon_mods.KEYS,'enemyArcherRange','battleLevelSync','disableBuffCardSpawns','enemyLevelScaling','levelCap99','pspSpellRuntime','enemyFinishers','enemyProficiency40','enemyProficiencyLevel','enemyRandomSkills','enemyRandomSpells','enemyRandomEquipment','enemyAutoGear','enemyAutoRareGear','enemyAutoAccessories','enemyAutoMovement','enemyForceCrestOfFire','enemyAutoHeavenlyWeapons')
# switches added after settings were first saved: missing ones read as off
LATER_FIELDS=('aiStatus','aiStatusAll','aiChoices','aiEnemyMpRecovery','aiDefaultBuffWeight','aiDefaultHealingWeights',*BUG_FIX_SECTIONS,'modPreparation','equipmentSetBonuses','equipmentSetFreeSkills','specialClassChange','advancedBeastFamilies','genericSpecialRecruitment',*weapon_mods.KEYS,'enemyArcherRange','battleLevelSync','disableBuffCardSpawns','enemyLevelScaling','levelCap99','pspSpellRuntime','enemyFinishers','enemyProficiency40','enemyProficiencyLevel','enemyRandomSkills','enemyRandomSpells','enemyRandomEquipment','enemyAutoGear','enemyAutoRareGear','enemyAutoAccessories','enemyAutoMovement','enemyForceCrestOfFire','enemyAutoHeavenlyWeapons')
FILES=('dinput8.dll','menu-mods.ini',*class_change.SIDECARS,*weapon_mods.ROGUE_FILES,modprep_sets.FILE,modprep_equipperms.FILE)
CARD_SETTINGS={'enemyStartingCards':'EnemyStartingCards','playerStartingCards':'PlayerStartingCards'}
CARD_IDS={0,1,2,3,13,15}
LABELS={'fastForward':'Five-speed fast-forward','chariot':'Early Chariot','autoBattle':'Early Auto Battle','unionLevel':'Remove story level cap','skipChapterVideos':'Skip chapter videos','aiStatus':'AI status scoring: new AI behaviours (113 and up)','aiStatusAll':'AI status scoring: every AI, original included','aiChoices':'Buff / Debuff Auto Battle buttons'}
LABELS['aiEnemyMpRecovery']='Enemy MP recovery fallback'
LABELS['aiDefaultBuffWeight']='Default buff weight'
LABELS['aiDefaultHealingWeights']='Default HP healing weights'
LABELS['offhandDamageFix']='Two-handed weapon and empty offhand fix'
LABELS['armorResistanceFix']='Armor physical resistance fix'
LABELS.update(modPreparation='Mod Preparation',specialClassChange='Special Characters Can Change Class',advancedBeastFamilies='Advanced beast families')
LABELS.update(equipmentSetBonuses='Equipment Set Bonuses',equipmentSetFreeSkills='Slot-free equipment set skills')
LABELS['genericSpecialRecruitment']='Recruit generic special units'
LABELS.update(proficiencyII='Proficiency II',throwReborn='Throw Reborn')
LABELS['rougesReborn']='Rouges Reborn'
LABELS['pspSpellRuntime']='PSP spell status fixes'
LABELS.update({'enemyFinishers': 'Automatic enemy finishers', 'enemyProficiency40': 'Enemy weapon proficiency rank 40', 'enemyProficiencyLevel': 'Enemy weapon proficiency follows level', 'enemyRandomSkills': 'Fill empty enemy skill slots', 'enemyRandomSpells': 'Fill empty enemy spell slots'})
ENEMY_LOADOUT_FIELDS=('enemyFinishers','enemyProficiency40','enemyProficiencyLevel','enemyRandomSkills','enemyRandomSpells','enemyRandomEquipment','enemyAutoGear','enemyAutoRareGear','enemyAutoAccessories','enemyAutoMovement','enemyForceCrestOfFire','enemyAutoHeavenlyWeapons','enemyEquipmentOverrides','enemyItemPool')
ENEMY_ITEM_CATEGORIES=('HP recovery', 'MP recovery', 'Buffs', 'Debuffs', 'Orbs', 'Status removal')
LABELS['enemyRandomEquipment']='Randomize enemy auto equipment'
LABELS.update({'enemyAutoGear': 'Broaden the weapon and armor pool', 'enemyAutoRareGear': 'Broaden pool with uniques', 'enemyAutoAccessories': 'Add accessories to enemy loadouts', 'enemyAutoMovement': 'Allow flying and blink gear and the Crest of Fire'})
LABELS['enemyAutoHeavenlyWeapons']='Add Heavenly General weapons'
LABELS['enemyForceCrestOfFire']='Equip every enemy with the Crest of Fire'
LABELS['enemyEquipmentOverrides']='Enemy equipment pool overrides'
LABELS['enemyItemPool']='Fill empty enemy item slots'
LABELS['levelCap99']='Raise player level cap to 99'
LABELS['enemyLevelScaling']='Scale enemy levels to your party'
LABELS['enemyArcherRange']='Enemy archers use downhill range'
LABELS['disableBuffCardSpawns']='Disable battlefield card spawns'
LABELS['battleLevelSync']='Disable battle level sync'
def settings(value=None):
 if isinstance(value,dict) and value.get('equipmentSetFreeSkills') is True and 'equipmentSetBonuses' not in value:
  value={**value,'equipmentSetBonuses':True}
 if value is None:value={'version':1,**{k:False for k in FIELDS}}
 if isinstance(value,dict):value={**{k:False for k in LATER_FIELDS if k not in value},**value}
 if isinstance(value,dict):value={'formationLimit':0,'trapAiProfile':0,'enemyLevelOffset':1,'enemyItemPool':0,'enemyEquipmentOverrides':{},**statuses.defaults(),**value}
 if isinstance(value,dict):value={**{k:[0,0,0,0] for k in CARD_SETTINGS if k not in value},**value}
 if isinstance(value,dict):
  # Retired settings in older projects and installed runtime receipts.
  value.pop('rogueTarotCost',None)
  value.pop('revealEnemyNames',None)
 if not isinstance(value,dict)or set(value)!={'version',*FIELDS,*CARD_SETTINGS,*statuses.defaults(),'formationLimit','trapAiProfile','enemyLevelOffset','enemyItemPool','enemyEquipmentOverrides'}or type(value['version'])is not int or value['version']!=1 or any(type(value[k])is not bool for k in FIELDS):raise ValueError('Invalid menu mod settings')
 if type(value['formationLimit'])is not int or not 0<=value['formationLimit']<=12:raise ValueError('Formation limit must be between 0 and 12')
 if type(value['trapAiProfile'])is not int or (value['trapAiProfile'] and not 115<=value['trapAiProfile']<=255):raise ValueError('Trap AI needs an added profile between 115 and 255')
 if type(value['enemyLevelOffset'])is not int or not 0<=value['enemyLevelOffset']<=49:raise ValueError('Extra enemy levels must be an integer between 0 and 49')
 if type(value['enemyItemPool'])is not int or not 0<=value['enemyItemPool']<(1<<len(ENEMY_ITEM_CATEGORIES)):
  raise ValueError('Invalid enemy item categories')
 for key in CARD_SETTINGS:
  cards=value[key]
  if not isinstance(cards,list) or len(cards)!=4 or any(type(card)is not int or card not in CARD_IDS for card in cards):
   raise ValueError('Each starting card loadout needs four valid card choices')
 if value['enemyProficiencyLevel'] and value['enemyProficiency40']:raise ValueError('Choose one enemy weapon proficiency mode')
 if value['equipmentSetFreeSkills'] and not value['equipmentSetBonuses']:raise ValueError('Enable Equipment Set Bonuses to use slot-free skills')
 if value['specialClassChange'] and not value['modPreparation']:raise ValueError('Special Class Change requires Mod Preparation')
 if value['advancedBeastFamilies'] and not value['specialClassChange']:raise ValueError('Advanced beast families require Special Class Change')
 if value['genericSpecialRecruitment'] and not value['specialClassChange']:raise ValueError('Generic special recruitment requires Special Class Change')
 return {'version':1,**{k:value[k]for k in FIELDS},**{k:list(value[k])for k in CARD_SETTINGS},'formationLimit':value['formationLimit'],'trapAiProfile':value['trapAiProfile'],'enemyLevelOffset':value['enemyLevelOffset'],'enemyEquipmentOverrides':equipment_overrides.settings(value['enemyEquipmentOverrides']),'enemyItemPool':value['enemyItemPool'],**statuses.settings(value)}

def cards_active(value):
 return any(any(value[key]) for key in CARD_SETTINGS)

def enemy_item_pool_label(mask):
 return ', '.join(label for bit,label in enumerate(ENEMY_ITEM_CATEGORIES) if mask & (1<<bit)) or 'Off'

def enabled_labels(value):
 return [f"Enemy levels (highest deployed +{value['enemyLevelOffset']})" if k=='enemyLevelScaling' else LABELS[k] for k in FIELDS if value[k]] + [label for key,(_,label) in statuses.LOADOUTS.items() if value[key]['conditions']] + ([f"Formation limit ({value['formationLimit']})"] if value['formationLimit'] else []) + ([f"Trap AI (profile {value['trapAiProfile']})"] if value['rougesReborn'] and value['trapAiProfile'] else []) + [
  label for key,label in [('enemyEquipmentOverrides',LABELS['enemyEquipmentOverrides']),('enemyStartingCards','Enemy starting cards'),('playerStartingCards','Player starting cards')]
  if any(value[key])] + ([f"Enemy items ({enemy_item_pool_label(value['enemyItemPool'])})"] if value['enemyItemPool'] else [])

def starting_card_ini(value):
 return ''.join('\r\n['+section+']\r\n'+''.join(f'Card{i}={card}\r\n' for i,card in enumerate(value[key],1))
                for key,section in CARD_SETTINGS.items() if any(value[key]))
def project_settings(meta):
 editor=meta.get('editor',{})
 value=editor.get('menuMods')
 if (isinstance(value,dict) and 'equipmentSetBonuses' not in value
     and value.get('modPreparation') is True and editor.get('communityEquipmentSets')):
  value={**value,'equipmentSetBonuses':True}
 return settings(value)
def selected(config,name=None):
 if name:return project_settings(config.project(name))
 return settings((config.state().get('menuRuntime')or{}).get('settings'))
def sha(data):return hashlib.sha256(data).hexdigest()
def bundle():
 root=Path(__file__).resolve().parent/'tools/menu_mods'
 manifest=json.loads((root/'manifest.json').read_bytes())
 if manifest.get('format')!='tor-editor-menu-runtime' or manifest.get('version')!=1:
  raise ValueError('The bundled menu mod is missing or changed; reinstall the editor update')
 return manifest
def ini(value):
 v=settings(value)
 return ('; Managed by TO:R Editor. Configure Integrated mods > Menu controls.\r\n'
  '[FastForward]\r\nEnabled='+str(int(v['fastForward']))+'\r\n\r\n'
  '[UnionLevel]\r\nEnabled='+str(int(v['unionLevel'] or v['levelCap99']))+'\r\n\r\n'
  '[FormationLimit]\r\nUnits='+str(v['formationLimit'])+'\r\n\r\n'
  '[BattleLevelSync]\r\nDisabled='+str(int(v['battleLevelSync']))+'\r\n\r\n'
  '[EarlyUnlocks]\r\nAutoBattle='+str(int(v['autoBattle']))+'\r\nChariot='+str(int(v['chariot']))+'\r\n\r\n'
  '[AIStatus]\r\nEnabled='+str(int(v['aiStatus']or v['aiStatusAll']))+'\r\nAllProfiles='+str(int(v['aiStatusAll']))+'\r\n'
  'BuffDefaults='+str(int(v['aiDefaultBuffWeight']))+'\r\nHealingDefaults='+str(int(v['aiDefaultHealingWeights']))+'\r\n\r\n'
  '[AIChoices]\r\nEnabled='+str(int(v['aiChoices']))+'\r\n\r\n'
  '[ChapterVideos]\r\nDisabled='+str(int(v['skipChapterVideos']))+'\r\n'
  + ('\r\n[Proficiencies]\r\nEnabled=1\r\n' if v['proficiencyII'] else '')
  + ('\r\n[ThrowReborn]\r\nEnabled=1\r\n' if v['throwReborn'] else '')
  + ('\r\n[RougesReborn]\r\nEnabled=1\r\n' if v['rougesReborn'] else '')
  + (f"\r\n[TrapAI]\r\nProfile={v['trapAiProfile']}\r\n" if v['rougesReborn'] and v['trapAiProfile'] else '')
  + ('\r\n[HardMode]\r\nEnemyArcherRange=1\r\n' if v['enemyArcherRange'] else '')
  + (f"\r\n[EnemyLevels]\r\nEnabled=1\r\nOffset={v['enemyLevelOffset']}\r\n" if v['enemyLevelScaling'] else '')
  + f"\r\n[BuffCardSpawns]\r\nDisabled={int(v['disableBuffCardSpawns'])}\r\n"
  + ('\r\n[PSPSpellRestoration]\r\nEnabled=1\r\n' if v['pspSpellRuntime'] else '')
  + ('\r\n[EnemyFinishers]\r\nEnabled=1\r\n' if v['enemyFinishers'] else '')
  + ('\r\n[EnemyProficiency]\r\nEnabled=1\r\n' if v['enemyProficiency40'] else '')
  + ('\r\n[EnemyProficiency]\r\nScaleToLevel=1\r\n' if v['enemyProficiencyLevel'] else '')
  + ('\r\n[EnemyEquipment]\r\n'
     'Randomize='+str(int(v['enemyRandomEquipment']))+'\r\n'
     'Gear='+str(int(v['enemyAutoGear']))+'\r\n'
     'RareGear='+str(int(v['enemyAutoRareGear']))+'\r\n'
     'HeavenlyWeapons='+str(int(v['enemyAutoHeavenlyWeapons']))+'\r\n'
     'Accessories='+str(int(v['enemyAutoAccessories']))+'\r\n'
     'MovementGear='+str(int(v['enemyAutoMovement']))+'\r\n'
     'ForceCrest='+str(int(v['enemyForceCrestOfFire']))+'\r\n'
     +equipment_overrides.ini(v['enemyEquipmentOverrides'])
     if any(v[k] for k in ('enemyEquipmentOverrides', 'enemyRandomEquipment', 'enemyAutoGear', 'enemyAutoRareGear', 'enemyAutoHeavenlyWeapons', 'enemyAutoAccessories', 'enemyAutoMovement', 'enemyForceCrestOfFire')) else '')
  + ('\r\n[EnemySkills]\r\nEnabled=1\r\n' if v['enemyRandomSkills'] else '')
  + ('\r\n[EnemySpells]\r\nEnabled=1\r\n' if v['enemyRandomSpells'] else '')
  + (f"\r\n[EnemyItems]\r\nPool={v['enemyItemPool']}\r\n" if v['enemyItemPool'] else '')
  + ('\r\n[AIMPRecovery]\r\nEnabled=1\r\n' if v['aiEnemyMpRecovery'] else '')
  + "".join(f"\r\n[{section}]\r\nEnabled={int(v[key])}\r\n" for key,section in BUG_FIX_SECTIONS.items())
  + starting_card_ini(v)+statuses.ini(v)).encode('ascii')

def select_loader(value,executable_hash,sets=False):
 root=Path(__file__).resolve().parent/'tools/menu_mods'
 manifest=bundle()
 if executable_hash!=manifest['executableSHA256']:
  profile=manifest.get('compatibleExecutables',{}).get(executable_hash)
  if profile is None:
   raise ValueError('This menu mod does not support the selected game executable version')
  requested={key:LABELS[key] for key in FIELDS if value[key] and key!='modPreparation'}
  if value['enemyItemPool']:requested['enemyItemPool']=LABELS['enemyItemPool']
  if value['enemyEquipmentOverrides']:requested['enemyEquipmentOverrides']=LABELS['enemyEquipmentOverrides']
  if value['formationLimit']:requested['formationLimit']='Formation limit'
  if cards_active(value):requested['startingCards']='Starting cards'
  if statuses.active(value):requested['startingStatuses']='Starting statuses'
  if sets:requested['expandedRuntime']='Equipment sets or Mod Preparation runtime'
  missing=[label for key,label in requested.items() if key not in profile['settings']]
  if missing:
   raise ValueError(f"These options are unavailable on {profile['label']}: "+', '.join(missing))
 else:
  variant='throw' if value['throwReborn'] else 'standard'
  profile=manifest['pspLegacyLoaders'][variant]
 data=(root/profile['loader']).read_bytes()
 if sha(data)!=profile['dllSHA256']:
  raise ValueError('The bundled game runtime is missing or changed. Reinstall the editor update.')
 return data
def game_root(config):return config.data_root.resolve().parent
def runtime_path(config,name):
 if name not in FILES:raise ValueError('Invalid menu runtime file')
 root=game_root(config);p=root/name
 if p.resolve()!=p or p.is_symlink() or (p.parent.exists() and not p.parent.is_dir()):
  raise ValueError('Menu runtime target must be a regular file inside the game folder')
 if p.exists()and not p.is_file():raise ValueError('Menu runtime target is not a file')
 return p
def assert_game_closed(config):
 if os.name!='nt':return
 command="Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -match 'Tactics.*Ogre' } | Select-Object Id,Path | ConvertTo-Json -Compress"
 try:r=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],capture_output=True,text=True,check=True,timeout=15,creationflags=subprocess.CREATE_NO_WINDOW)
 except(subprocess.SubprocessError,OSError)as e:raise ValueError('Could not check whether the game is closed; game files were preserved')from e
 rows=json.loads(r.stdout)if r.stdout.strip()else[]
 if isinstance(rows,dict):rows=[rows]
 target=(game_root(config)/'Tactics Ogre Reborn.exe').resolve()
 if any(not row.get('Path')or Path(row['Path']).resolve()==target for row in rows):raise ValueError('Close Tactics Ogre Reborn before applying or removing game files. Project settings can be saved while it is running.')
def custom_icon_ini(enabled):
 return b'\r\n[CustomIcons]\r\nEnabled=1\r\n' if enabled else b''

def prepare(config,value,project=None,class_payload=None,custom_icons=False):
 v=settings(value)
 if v['pspSpellRuntime'] and not project:raise ValueError('Open a project to use the PSP spell status fixes')
 if not project and any(v[k] for k in ENEMY_LOADOUT_FIELDS):raise ValueError('Open a project to use the enemy loadout options')
 if v['aiChoices'] and not project:raise ValueError('Open a project to add Buff / Debuff Auto Battle buttons')
 if v['aiChoices'] and not(v['aiStatus']or v['aiStatusAll']):raise ValueError('Enable AI status scoring with the Buff / Debuff buttons')
 if v['equipmentSetBonuses'] and not project:raise ValueError('Open a project to use Equipment Set Bonuses')
 if v['modPreparation'] and not project:raise ValueError('Open a project to use Mod Preparation')
 if weapon_mods.active(v) and not project:raise ValueError('Open a project to use Proficiency II, Throw Reborn or Rouges Reborn')
 if v['enemyArcherRange'] and not project:raise ValueError('Open a project to use Hard Mode')
 if v['levelCap99'] and not project:raise ValueError('Open a project to raise the player level cap')
 if v['enemyLevelScaling'] and not project:raise ValueError('Open a project to scale enemy levels')
 if statuses.active(v) and not project:raise ValueError('Open a project to configure starting statuses')
 if cards_active(v) and not project:raise ValueError('Open a project to configure starting cards')
 if v['specialClassChange'] and not class_payload:raise ValueError('Special Class Change is built when you preview Apply project or export')
 meta=config.project(project) if project else {}
 sets=modprep_sets.runtime(meta,v['equipmentSetBonuses'],v['equipmentSetFreeSkills'])
 permissions=modprep_equipperms.runtime(meta,v['modPreparation'])
 advanced=bool(sets or permissions)
 sections=modprep_sets.ini(sets,v['equipmentSetFreeSkills'])+modprep_equipperms.ini(permissions)
 sections+=custom_icon_ini(custom_icons)
 active=custom_icons or advanced or any(v[k]for k in FIELDS if k not in ('modPreparation','equipmentSetBonuses','advancedBeastFamilies')) or cards_active(v) or statuses.active(v) or v['formationLimit']>0 or bool(v['enemyItemPool'] or v['enemyEquipmentOverrides']);owned=config.state().get('menuRuntime')or{};recorded=owned.get('files',{})
 if not isinstance(recorded,dict)or any(k not in FILES for k in recorded):raise ValueError('Invalid installed menu runtime receipt')
 manifest=bundle();current={n:runtime_path(config,n).read_bytes()if runtime_path(config,n).exists()else None for n in FILES}
 # an earlier bundled build the editor installed itself may be replaced by this one
 compatible_hashes=tuple(profile['dllSHA256'] for profile in (*manifest.get('compatibleExecutables',{}).values(),*manifest.get('pspLegacyLoaders',{}).values()))
 if recorded and recorded.get('dinput8.dll') not in (manifest['dllSHA256'],*compatible_hashes,class_change.recipe()['dllSHA256'],*weapon_mods.loader_hashes(),*manifest.get('replaces',[])):raise ValueError('The installed menu loader belongs to another version/mod; it has been preserved')
 for name,expected in recorded.items():
  if current[name]is not None and sha(current[name])!=expected:raise ValueError(name+' was changed outside the editor. It has been preserved.')
 desired={n:None for n in FILES}
 if active or class_payload:
  exe=game_root(config)/'Tactics Ogre Reborn.exe'
  if not exe.is_file():raise ValueError('The selected game folder is missing Tactics Ogre Reborn.exe')
  executable_hash=sha(exe.read_bytes())
 if active and not class_payload:
  desired.update({'dinput8.dll':select_loader(v,executable_hash,advanced),'menu-mods.ini':ini(v)+sections})
 if class_payload:
  section,sidecars=class_payload
  desired.update(sidecars)
  desired.update({'dinput8.dll':select_loader(v,executable_hash,advanced),'menu-mods.ini':ini(v)+b'\r\n'+section+sections})
 if sets:desired[modprep_sets.FILE]=sets
 if permissions:desired[modprep_equipperms.FILE]=permissions
 desired.update(weapon_mods.rogue_files(v))
 for name,data in desired.items():
  if data is not None and current[name] is not None and name not in recorded:
   raise ValueError(name+' belongs to another mod. The editor will not overwrite its loader or configuration.')
 entries=[]
 for name in FILES:
  # Disabling an unowned runtime never deletes somebody else's files.
  if desired[name] is None and name not in recorded:continue
  if current[name]!=desired[name]:entries.append({'name':name,'before':current[name],'after':desired[name]})
 receipt={'version':1,'project':project,'settings':v,'files':{n:sha(d)for n,d in desired.items()if d is not None}}if active else None
 return {'entries':entries,'receipt':receipt,'settings':v,'public':{'changed':[e['name']for e in entries],'enabled':enabled_labels(v),'requiresRestart':bool(entries)}}
def snapshot_restore(config,plan,atomic):
 for e in plan['entries']:
  p=runtime_path(config,e['name'])
  if e['before']is None:
   if p.exists():p.unlink()
  else:atomic(p,e['before'])
def deploy(config,plan,atomic):
 entries=plan['entries']
 if not entries:return plan['receipt'],[]
 assert_game_closed(config)
 for e in entries:
  p=runtime_path(config,e['name']);current=p.read_bytes()if p.exists()else None
  if current!=e['before']:raise ValueError('Menu runtime changed during preview; reload before applying')
 backup=config.backup_root.parent/('menu-runtime-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]);backup.mkdir(parents=True)
 for e in entries:
  if e['before']is not None:
   path=backup/e['name'];path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(e['before'])
 (backup/'manifest.json').write_text(json.dumps({'files':[{'name':e['name'],'before':sha(e['before'])if e['before']is not None else None,'after':sha(e['after'])if e['after']is not None else None}for e in entries],'settings':plan['settings']},indent=2))
 try:
  for e in entries:
   p=runtime_path(config,e['name'])
   if e['after']is None:
    if p.exists():p.unlink()
   else:
    p.parent.mkdir(parents=True,exist_ok=True)
    atomic(p,e['after'])
   if(p.read_bytes()if p.exists()else None)!=e['after']:raise OSError('Menu runtime installation did not verify')
 except Exception:
  snapshot_restore(config,plan,atomic);raise
 return plan['receipt'],[e['name']for e in entries]
def info(config):
 name=config.open_project();value=selected(config,name);owned=config.state().get('menuRuntime')or{};available=True;error=None
 try:
  public={'changed':[],'enabled':enabled_labels(value),'requiresRestart':False} if value['specialClassChange'] else prepare(config,value,name)['public']
 except(ValueError,OSError)as e:available=False;error=str(e);public={'changed':[],'enabled':enabled_labels(value),'requiresRestart':False}
 editor=config.project(name).get('editor',{}) if name else {}
 groups=modprep_groups.settings(editor.get('communityClassGroups'))
 builtin=modprep_groups.override_settings(editor.get(modprep_groups.OVERRIDES))
 sets=modprep_sets.settings(editor.get('communityEquipmentSets'))
 spell_sets=modprep_spellsets.settings(editor.get('communitySpellSets'))
 skill_sets=modprep_spellsets.settings(editor.get('communitySkillSets'),'skill')
 permissions=modprep_equipperms.settings(editor.get('communityEquipmentPermissions'))
 menu=(class_change.ROOT/'linked-512/modprep-classmenu.bin').read_bytes()
 icons=class_change.menu_class_icons(menu)
 class_ids=[int(klass) for klass in icons if int(klass)>=80]
 return {'version':1,'project':name,'settings':value,'installed':bool(owned),'installedSettings':settings(owned.get('settings')),'available':available,'error':error,'plan':public,
         'capacityPlan':modprep_groups.PLAN,'itemPool':class_change.item_pool(class_change.recipe()),
         'communityClassGroups':groups,'additionalClassChoices':class_ids,'communityEquipmentSets':sets,
         'builtinClassGroups':class_change.group_catalog(value['advancedBeastFamilies']) if value['specialClassChange'] else [],
         modprep_groups.OVERRIDES:builtin,'specialClassMenuIcons':icons if value['specialClassChange'] else {},
         'specialClassMarks':class_change.menu_class_marks(menu) if value['specialClassChange'] else {},
         'equipmentSetSlots':{'first':modprep_sets.FIRST,'limit':modprep_sets.LIMIT},
         'communitySpellSets':spell_sets,'spellSetSlots':{'first':modprep_spellsets.FIRST,'limit':modprep_spellsets.LIMIT},
         'communitySkillSets':skill_sets,'skillSetSlots':{'first':modprep_spellsets.FIRST,'limit':modprep_spellsets.SKILL_LIMIT},
         'communityEquipmentPermissions':permissions,'equipmentPermissionSlots':{'first':modprep_equipperms.FIRST,'limit':modprep_equipperms.LIMIT}}
def save(config,body,atomic):
 if not isinstance(body,dict)or 'settings'not in body or body.get('project')!=config.open_project()or body.get('dataRoot')!=str(config.data_root):raise ValueError('Game/project changed or settings are missing; reload before saving menu settings')
 value=settings(body.get('settings'));name=config.open_project()
 if value['pspSpellRuntime'] and not name:raise ValueError('Open a project to use the PSP spell status fixes')
 if not name and any(value[k] for k in ENEMY_LOADOUT_FIELDS):raise ValueError('Open a project to use the enemy loadout options')
 if value['aiChoices']and not name:raise ValueError('Open a project to add Buff / Debuff Auto Battle buttons')
 if value['aiChoices']and not(value['aiStatus']or value['aiStatusAll']):raise ValueError('Enable AI status scoring with the Buff / Debuff buttons')
 if value['levelCap99']and not name:raise ValueError('Open a project to raise the player level cap')
 if value['enemyLevelScaling']and not name:raise ValueError('Open a project to scale enemy levels')
 if value['equipmentSetBonuses']and not name:raise ValueError('Open a project to use Equipment Set Bonuses')
 if value['modPreparation']and not name:raise ValueError('Open a project to use Mod Preparation')
 if name:
  meta=config.project(name);editor=meta.setdefault('editor',{})
  editor['menuMods']=value
  if 'communityClassGroups' in body:editor['communityClassGroups']=modprep_groups.settings(body['communityClassGroups'])
  if modprep_groups.OVERRIDES in body:editor[modprep_groups.OVERRIDES]=modprep_groups.override_settings(body[modprep_groups.OVERRIDES])
  if 'communityEquipmentSets' in body:editor['communityEquipmentSets']=modprep_sets.settings(body['communityEquipmentSets'])
  if 'communitySpellSets' in body:editor['communitySpellSets']=modprep_spellsets.settings(body['communitySpellSets'])
  if 'communitySkillSets' in body:editor['communitySkillSets']=modprep_spellsets.settings(body['communitySkillSets'],'skill')
  if 'communityEquipmentPermissions' in body:editor['communityEquipmentPermissions']=modprep_equipperms.settings(body['communityEquipmentPermissions'])
  config.save_project(name,meta);return {'saved':True,'project':name,'gameChanged':False}
 if any(k in body for k in (modprep_groups.OVERRIDES,'communityClassGroups','communityEquipmentSets','communitySpellSets','communitySkillSets','communityEquipmentPermissions')):raise ValueError('Open a project to save class groups and sets')
 installed=settings((config.state().get('menuRuntime')or{}).get('settings'))
 runtime_files=(config.state().get('menuRuntime')or{}).get('files',{})
 if any(installed[k] for k in ENEMY_LOADOUT_FIELDS) or installed['pspSpellRuntime'] or installed['specialClassChange'] or weapon_mods.active(installed) or installed['enemyArcherRange'] or installed['enemyLevelScaling'] or installed['levelCap99'] or cards_active(installed) or statuses.active(installed) or any(name in runtime_files for name in (modprep_sets.FILE,modprep_equipperms.FILE)):
  raise ValueError('Open the applied project to change its runtime options')
 plan=prepare(config,value);state=config.state();receipt,changed=deploy(config,plan,atomic)
 try:
  next_state=json.loads(json.dumps(state));next_state['menuRuntime']=receipt;config.save_state(next_state)
 except Exception:
  snapshot_restore(config,plan,atomic);config.save_state(state);raise
 return {'saved':True,'project':None,'gameChanged':bool(changed),'runtimeFiles':changed}

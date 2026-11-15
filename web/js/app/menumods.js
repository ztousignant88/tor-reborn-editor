import {source}from '../game/source.js';
import {createPicker} from '../ui/picker.js';
import {renderEnemyLevels} from './enemylevels.js';
import {startingCardArt} from '../game/cardart.js';
import {renderStartingStatuses, startingStatusDefaults, startingStatusesEnabled, startingStatusesChanged} from './startingstatus.js';
const startingCards=[
 [0,'None'],[1,'Physical Attack'],[2,'Magic Attack'],[3,'Critical Rate'],[13,'MP Recovery'],[15,'Auto Skill'],
].map(([id,name])=>({id,name,art:id?()=>startingCardArt(id):undefined}));
const emptyCards=()=>[0,0,0,0];
const options=[
 ['disableBuffCardSpawns','Disable battlefield card spawns','Stops recurring battlefield card spawns and cards from destroyed objects. Scripted cards and starting cards still apply. Restart and enter a fresh battle.'],
 ['aiChoices','Buff / Debuff Auto Battle buttons','Adds a cyan Buff button (AI 113) and a purple Debuff button (AI 114) to Auto Battle. Adds either profile if it is missing and keeps existing profile edits.'],
 ['chariot','Chariot from the start','Makes Chariot available before its normal story unlock. Normal turn history and battle restrictions still apply.'],
 ['fastForward','Five-speed fast-forward','Uses the existing speed button: Normal → Fast → Fast+ → Faster → Turbo. Press F3 to return to Normal. Press F4 to toggle 5× timing throughout the game, including the title screen and menus. The extra timing steps are 2×, 3× and 5× on top of native Fast.'],
 ['autoBattle','Auto Battle from the start','Makes the native AI control menu available early. It does not change AI profiles or automatically enable AI.'],
 ['unionLevel','Remove the story level cap','Uses the native overall maximum, normally level 50, and hides the world-map Union Level badge. Battle level sync is separate.'],
 ['battleLevelSync','Disable battle level sync','Keeps unit levels and equipment stats at their normal values and hides the Level Sync control on the formation screen. Start the battle fresh after changing this option.'],
 ['skipChapterVideos','Skip chapter videos','Automatically skips chapter transition movies. Prologue, title movies and gallery replays remain. This option still needs an in-game chapter transition check.'],
 ['aiStatus','AI status scoring: new AI behaviours','Lets the AI value status spells. The game scores every status effect as zero in its look-ahead, so status weights have no effect; this fixes that for AI numbers 113 and up only: the AI Plus behaviours and any profile duplicated in the AI editor. The original AI plays exactly as before. Records the AI’s scores in menu-mods.log next to the game.'],
 ['aiStatusAll','AI status scoring: every AI','Applies the same fix to every AI number, the original profiles included, so stock enemies and AI allies weigh buffs and ailments by their existing weights. Covers the new behaviours too.'],
 ['aiEnemyMpRecovery','Enemy MP recovery fallback','If an enemy would pass its action and lacks MP for an equipped spell or skill, it can use an MP-restoring item it carries. Useful on opening turns and later when low on MP.'],
 ['aiDefaultBuffWeight','Default buff weight','Uses 25 for zero beneficial-status weights across all AI profiles. Lets the AI score eligible buffs on its own side.'],
 ['aiDefaultHealingWeights','Default HP healing weights','Uses 25 for zero HP healing weights across all AI profiles. The game still checks how much healing the target needs.'],
 ["offhandDamageFix", "Two-handed weapon and empty offhand fix", "Uses the main-hand weapon for affected spells and special attacks when the game selects an empty offhand."],
 ["armorResistanceFix", "Armor physical resistance fix", "Uses the incoming attack’s crushing, slashing or piercing type to choose the defender’s physical resistance."],
];
const aiKeys=new Set(['aiStatus','aiStatusAll','aiChoices','aiEnemyMpRecovery','aiDefaultBuffWeight','aiDefaultHealingWeights']);
const bugFixKeys=new Set(['offhandDamageFix','armorResistanceFix']);
const scopedOptions=scope=>options.filter(([key])=>(aiKeys.has(key)?'ai':bugFixKeys.has(key)?'bug-fixes':'menu')===scope);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enemyEquipmentOptions=[
 ['enemyRandomEquipment', 'Randomize enemy auto equipment', 'Rolls among eligible pieces at the highest available tier for each empty auto-equipment slot. Set matching minimum levels under Auto Loadouts → Equipment pool to give enemies more choices.', 5],
 ["enemyAutoGear", "Broaden the weapon and armor pool", "Adds weapons, shields and armor that allow multiple copies. The Heavenly General weapons and special movement gear have their own toggles.", 6],
 ["enemyAutoHeavenlyWeapons", "Add Heavenly General weapons", "Adds the 12 obtainable Heavenly General weapons at their equipment levels.", 9],
 ["enemyAutoRareGear", "Broaden pool with uniques", "Opens the wider weapon and armor pool and also adds gear marked Unique, such as the Ogre and Reeking sets.", 6],
 ["enemyAutoAccessories", "Add accessories to enemy loadouts", "Rolls for an empty accessory slot. Basic rings and necklaces unlock at 7, upgraded stat rings at 19, chokers and advanced rings at 34, and earrings at 45.", 6],
 ["enemyAutoMovement", "Allow flying and blink gear and the Crest of Fire", "Adds Cloud Shoes, Winged Boots, Sidhe Shoes, Ring of Clouds, Winged Ring, Sidhe Ring and the Crest of Fire. Movement rings unlock at 33 and the Crest of Fire at 50.", 6],
 ["enemyForceCrestOfFire", "Equip every enemy with the Crest of Fire", "From level 1, gives every enemy the Crest of Fire in its accessory slot, replacing any fixed accessory. Works with auto equipment off.", 7],
];
const enemyLoadoutOptions=[
 [
  "enemyFinishers",
  "Automatic enemy finishers",
  "Fills vacant finisher slots with moves the enemy can use with its weapon and proficiency. Existing finishers stay in place."
 ],
 [
  "enemyRandomSkills",
  "Fill empty enemy skill slots",
  "Fills vacant slots with random skills the enemy can learn, excluding weapon proficiencies, recruitment skills and duplicate skill families. With Enemy Levels enabled, picks use the scaled level when combat starts."
 ],
 ["enemyRandomSpells", "Fill empty enemy spell slots", "Fills vacant slots with random scroll-backed spells from the enemy’s class spell set. A spell becomes eligible at the level listed for its spell-set group. Existing spells stay in place. With Enemy Levels enabled, picks use the scaled level when combat starts."]
];
const proficiencyModes=[
 ['', 'Game default'],
 ['enemyProficiencyLevel', 'Match enemy level (max 40)'],
 ['enemyProficiency40', 'Always rank 40'],
];
const proficiencyMode=value=>proficiencyModes.find(([key])=>value[key])?.[0]??'';
const enemyItemCategories = [
 ['HP recovery', 'Mend Leaf and Mending Salve'],
 ['MP recovery', 'Magic Leaf and Magic Essence'],
 ['Buff items', 'Items that grant beneficial effects'],
 ['Debuff items', 'Items that inflict ailments or strip buffs'],
 ['Orbs', 'Elemental and Void Orbs'],
 ['Status removal', 'Cures such as Maca Antidote'],
];
const empty=()=>({version:1,disableBuffCardSpawns:false,fastForward:false,chariot:false,autoBattle:false,unionLevel:false,battleLevelSync:false,formationLimit:0,trapAiProfile:0,skipChapterVideos:false,aiStatus:false,aiStatusAll:false,aiChoices:false,aiEnemyMpRecovery:false,aiDefaultBuffWeight:false,aiDefaultHealingWeights:false,offhandDamageFix:false,armorResistanceFix:false,modPreparation:false,equipmentSetBonuses:false,equipmentSetFreeSkills:false,specialClassChange:false,advancedBeastFamilies:false,genericSpecialRecruitment:false,proficiencyII:false,throwReborn:false,rougesReborn:false,pspSpellRuntime:false,enemyArcherRange:false,enemyLevelScaling:false,enemyFinishers:false,enemyProficiency40:false,enemyProficiencyLevel:false,enemyRandomSkills:false,enemyRandomSpells:false,enemyRandomEquipment:false,enemyAutoGear:false,enemyAutoRareGear:false,enemyAutoHeavenlyWeapons:false,enemyAutoAccessories:false,enemyAutoMovement:false,enemyForceCrestOfFire:false,enemyEquipmentOverrides:{},enemyItemPool:0,enemyLevelOffset:1,levelCap99:false});
export class MenuMods{
 constructor(info,saved){
  this.info=info;this.saved=saved;this.value={...empty(),...startingStatusDefaults(),...saved?.settings};this.original=JSON.stringify(this.value);
  this.communityGroups=structuredClone(saved?.communityClassGroups??[]);
  this.originalGroups=JSON.stringify(this.communityGroups);
  this.builtinClassGroupOverrides=structuredClone(saved?.builtinClassGroupOverrides??{});
  this.savedBuiltinClassGroupOverrides=structuredClone(this.builtinClassGroupOverrides);
  this.equipmentSets=structuredClone(saved?.communityEquipmentSets??[]);
  this.originalSets=JSON.stringify(this.equipmentSets);
  this.savedSpellSets=saved?.communitySpellSets??[];
  this.spellSets=structuredClone(this.savedSpellSets);
  this.savedSkillSets=saved?.communitySkillSets??[];
  this.skillSets=structuredClone(this.savedSkillSets);
  this.savedEquipmentPermissions=saved?.communityEquipmentPermissions??[];
  this.equipmentPermissions=structuredClone(this.savedEquipmentPermissions);
 }
 static async load(info){try{return new MenuMods(info,info.menuModsVersion?await source.menuMods():null);}catch(e){return new MenuMods(info,{error:e.message});}}
 setScope(info){this.info=info;}
 get supported(){return !!this.info.menuModsVersion;}
 get groupsDirty(){return JSON.stringify(this.communityGroups)!==this.originalGroups;}
 get builtinGroupsDirty(){return JSON.stringify(this.builtinClassGroupOverrides)!==JSON.stringify(this.savedBuiltinClassGroupOverrides);}
 get setsDirty(){return JSON.stringify(this.equipmentSets)!==this.originalSets;}
 get spellSetsDirty(){return JSON.stringify(this.spellSets)!==JSON.stringify(this.savedSpellSets);}
 get skillSetsDirty(){return JSON.stringify(this.skillSets)!==JSON.stringify(this.savedSkillSets);}
 get equipmentPermissionsDirty(){return JSON.stringify(this.equipmentPermissions)!==JSON.stringify(this.savedEquipmentPermissions);}
 get dirty(){return JSON.stringify(this.value)!==this.original||this.groupsDirty||this.builtinGroupsDirty||this.setsDirty||this.spellSetsDirty||this.skillSetsDirty||this.equipmentPermissionsDirty;}
 get contentChanged(){
  const saved=JSON.parse(this.original);
  return ['rougesReborn','throwReborn','proficiencyII','specialClassChange','advancedBeastFamilies','genericSpecialRecruitment','aiChoices','pspSpellRuntime']
   .some(key=>!!this.value[key]!==!!saved[key]);
 }
 get enabled(){return !!this.value.formationLimit||options.some(([k])=>this.value[k]);}
 recommendPreparation(){
  if(!this.info.project||!this.saved?.capacityPlan||this.value.modPreparation)return;
  if(confirm('Enable Mod Preparation too? It keeps new items clear of the class-mark slots and shows the project’s capacity plan.\n\nOK: enable both. Cancel: enable this mod by itself.')){
   this.value.modPreparation=true;
  }
 }
 enabledIn(scope){return scopedOptions(scope).some(([k])=>this.value[k]);}
 dirtyIn(scope){const saved=JSON.parse(this.original);return scopedOptions(scope).some(([k])=>!!this.value[k]!==!!saved[k]);}
 statusEnabled(hardMode){return startingStatusesEnabled(this.value,hardMode);}
 statusChanged(hardMode){return startingStatusesChanged(this.value,JSON.parse(this.original),hardMode);}
 get enemyLevelsChanged(){const saved=JSON.parse(this.original);return !!this.value.enemyLevelScaling!==!!saved.enemyLevelScaling||this.value.enemyLevelOffset!==saved.enemyLevelOffset;}
 get enemyLoadoutsEnabled(){return !!this.value.enemyItemPool||!!proficiencyMode(this.value)||Object.keys(this.value.enemyEquipmentOverrides).length>0||[...enemyLoadoutOptions,...enemyEquipmentOptions].some(([key])=>this.value[key]);}
 get enemyLoadoutsChanged(){
  const saved=JSON.parse(this.original);
  return this.value.enemyItemPool!==saved.enemyItemPool||proficiencyMode(this.value)!==proficiencyMode(saved)||JSON.stringify(this.value.enemyEquipmentOverrides)!==JSON.stringify(saved.enemyEquipmentOverrides)||[...enemyLoadoutOptions,...enemyEquipmentOptions].some(([key])=>this.value[key]!==saved[key]);
 }
 get cheatsEnabled(){return this.value.levelCap99||!!this.value.formationLimit||this.startingCardsEnabled('playerStartingCards')||this.statusEnabled(false);}
 get cheatsChanged(){return this.value.levelCap99!==JSON.parse(this.original).levelCap99||(this.value.formationLimit??0)!==(JSON.parse(this.original).formationLimit??0)||this.startingCardsChanged('playerStartingCards')||this.statusChanged(false);}
 async save(){
  if(!this.dirty)return false;
  const value=JSON.stringify(this.value),groups=JSON.stringify(this.communityGroups),sets=JSON.stringify(this.equipmentSets);
  const spellSets=structuredClone(this.spellSets);
  const skillSets=structuredClone(this.skillSets);
  const equipmentPermissions=structuredClone(this.equipmentPermissions);
  const builtinOverrides=structuredClone(this.builtinClassGroupOverrides);
  const settings=JSON.parse(value);
  if ((this.info.hardModeVersion??0)<3) delete settings.enemyItemPool;
  if ((this.info.hardModeVersion??0)<4) delete settings.enemyProficiencyLevel;
  if ((this.info.hardModeVersion??0)<5) delete settings.enemyRandomEquipment;
  if ((this.info.hardModeVersion??0)<6) for (const key of ["enemyAutoGear", "enemyAutoRareGear", "enemyAutoAccessories", "enemyAutoMovement"]) delete settings[key];
  if ((this.info.hardModeVersion??0)<7) delete settings.enemyForceCrestOfFire;
  if ((this.info.hardModeVersion??0)<8) delete settings.enemyEquipmentOverrides;
  if ((this.info.hardModeVersion??0)<9) delete settings.enemyAutoHeavenlyWeapons;
  await source.saveMenuMods(this.info,settings,{
   communityClassGroups:this.groupsDirty?JSON.parse(groups):undefined,
   builtinClassGroupOverrides:this.builtinGroupsDirty?builtinOverrides:undefined,
   communityEquipmentSets:this.setsDirty?JSON.parse(sets):undefined,
   communitySpellSets:this.spellSetsDirty?spellSets:undefined,
   communitySkillSets:this.skillSetsDirty?skillSets:undefined,
   communityEquipmentPermissions:this.equipmentPermissionsDirty?equipmentPermissions:undefined,
  });
  this.original=value;this.originalGroups=groups;this.originalSets=sets;
  this.savedBuiltinClassGroupOverrides=builtinOverrides;
  this.savedSpellSets=spellSets;this.savedSkillSets=skillSets;this.savedEquipmentPermissions=equipmentPermissions;return true;
 }
 startingCardsEnabled(key){return (this.value[key]??emptyCards()).some(Boolean);}
 startingCardsChanged(key){
  const saved=JSON.parse(this.original)[key]??emptyCards();
  return (this.value[key]??emptyCards()).some((id,index)=>id!==saved[index]);
 }
 renderStartingCards(section,onChange,ed,team){
  const enemy=team==='Enemy';
  const key=enemy?'enemyStartingCards':'playerStartingCards';
  const supported=!!this.info.startingCardsVersion&&!!this.info.project;
  section.innerHTML=`<h2>${team} starting cards</h2>
   <p class="hint">${supported?(enemy?'Replaces the starting buff cards for enemies, including bosses.':'Replaces the starting buff cards for your side, including friendly guests.'):'Open a project in the updated editor to configure starting cards.'} Choose None in all four slots to keep the game’s starting cards. You can choose the same card more than once.</p>`;
  const values=this.value[key]??emptyCards();
  for(const [index,value] of values.entries()){
   const row=document.createElement('div');
   row.className='menu-mod-option';
   const label=document.createElement('b');
   label.textContent=`Card ${index+1}`;
   const picker=createPicker({options:startingCards,value,allowRaw:false,onChange:id=>{
    const next=[...(this.value[key]??emptyCards())];
    next[index]=id;
    this.value[key]=next;
    onChange();
   }});
   picker.setAttribute('aria-label',`${team} starting card ${index+1}`);
   picker.disabled=!supported||ed.ctx.readOnly?.();
   row.append(label,picker);
   section.append(row);
  }
 }
 renderCheats(detail,onChange,ed){
  const disabled=!this.supported||!Object.hasOwn(this.value,'formationLimit')||this.saved?.error||ed.ctx.readOnly?.();
  const capDisabled=disabled||!this.info.project||!this.info.levelCap99Version;
  const limit=this.value.formationLimit??0;
  detail.innerHTML=`<div class="data-head"><div><h1>Cheats</h1><p class="muted">Integrated mods · ${this.info.project?'Project settings':'Game settings'}</p></div></div>
   <label class="menu-mod-option"><input type="checkbox" data-level-cap-99 ${this.value.levelCap99?'checked':''} ${capDisabled?'disabled':''}>
    <span><b>Raise player level cap to 99</b><small>Bypasses the story level cap and extends the XP curve beyond level 51. ${this.info.project?'Level 99 starts at 194,040 total XP on the standard curve.':'Open a project to enable this cheat.'}</small></span></label>
   <label class="menu-mod-option">
    <select data-formation-limit aria-label="Formation limit" ${disabled?'disabled':''}>
     ${Array.from({length:13},(_,n)=>`<option value="${n}" ${limit===n?'selected':''}>${n||'Map default'}</option>`).join('')}
    </select>
    <span><b>Formation limit</b><small>Sets the maximum number of units you can select for deployment in each battle. Map default uses each battle’s normal limit.</small></span>
   </label>
   <section data-starting-cards></section>
   <section data-starting-status></section>
   <p class="hint">${this.info.project?'Save the project, then use Apply Project.':'Close the game before saving changes here. Open a project to configure starting cards.'} Start a new battle after launching the game.</p>`;
  detail.querySelector('[data-level-cap-99]').onchange=event=>{
   if(capDisabled)return;
   this.value.levelCap99=event.target.checked;
   onChange();
  };
  const formation=detail.querySelector('[data-formation-limit]');
  formation.onchange=()=>{
   if(disabled)return;
   this.value.formationLimit=Number(formation.value);
   onChange();
  };
  this.renderStartingCards(detail.querySelector('[data-starting-cards]'),onChange,ed,'Player');
  renderStartingStatuses(detail.querySelector('[data-starting-status]'),this.value,
   !!this.info.startingStatusVersion&&!!this.info.project,ed.ctx.readOnly?.(),false,onChange);
 }
 renderHardMode(detail,onChange,ed){
  const supported=!!this.info.hardModeVersion&&!!this.info.project;
  const disabled=!supported||ed.ctx.readOnly?.();
  const loadoutControls=options=>options.filter(([, , , version=2])=>this.info.hardModeVersion>=version).map(([key,title,help])=>`<label class="menu-mod-option"><input type="checkbox" data-enemy-loadout="${key}" ${this.value[key]?'checked':''} ${disabled?'disabled':''}><span><b>${title}</b><small>${help}</small></span></label>`).join('');
  detail.innerHTML=`<div class="data-head"><div><h1>Hard Mode</h1><p class="muted">Integrated mods · Project settings</p></div></div>
   ${supported?'':'<p class="hint">Open a project in the updated editor to configure Hard Mode.</p>'}
   <label class="menu-mod-option"><input type="checkbox" data-archer-range ${this.value.enemyArcherRange?'checked':''} ${disabled?'disabled':''}><span><b>Enemy archers use downhill range</b><small>Enemy AI can consider ordinary bow shots beyond effective range when the target is downhill and the projectile can reach its tile. The AI scores these shots alongside its other options.</small></span></label>
   <section data-enemy-levels></section>
   ${this.info.hardModeVersion>=2?`<section><h2>Enemy loadouts</h2>
   ${loadoutControls(enemyLoadoutOptions)}
   <label class="menu-mod-option">
    <select data-enemy-proficiency aria-label="Enemy weapon proficiency" ${disabled?'disabled':''}>
     ${proficiencyModes.filter(([key])=>key!=='enemyProficiencyLevel'||this.info.hardModeVersion>=4).map(([key,label])=>`<option value="${key}" ${proficiencyMode(this.value)===key?'selected':''}>${label}</option>`).join('')}
    </select>
    <span><b>Enemy weapon proficiency</b><small>Sets the base rank of equipped enemy weapon proficiencies. With Match enemy level, a level 13 enemy has rank 13 and a level 50 enemy has rank 40.</small></span>
   </label>
   ${this.info.hardModeVersion>=3?`<fieldset class="enemy-item-pool" ${disabled?'disabled':''}>
    <legend>Fill empty enemy item slots</legend>
    <p class="hint">Choose the categories to draw from. Each empty slot rolls separately, so enemies can carry a mix or repeats. Clear all categories to turn this off. The game’s AI and item-use rules still apply.</p>
    <div class="enemy-item-categories">
      ${enemyItemCategories.map(([label,example],index)=>`<label>
        <input type="checkbox" data-enemy-item-category="${1<<index}" ${this.value.enemyItemPool&(1<<index)?'checked':''}>
        <span><b>${label}</b><small>${example}</small></span>
      </label>`).join('')}
    </div>
   </fieldset>`:''}
   ${this.info.hardModeVersion>=5?`<h3>Equipment</h3>
   ${loadoutControls(enemyEquipmentOptions)}
   ${this.info.hardModeVersion>=8?`<button type="button" class="ghost" data-equipment-pool ${disabled?'disabled':''}>View or edit enemy equipment pool</button>`:''}`:''}
   </section>`:''}
   <section data-starting-cards></section>
   <section data-starting-status></section>
   <p class="hint">Save the project, then use Apply Project. The settings take effect the next time the game launches. Start a fresh battle to see new cards and loadouts.</p>`;
  detail.querySelector('[data-archer-range]').onchange=event=>{
   if(disabled)return;
   this.value.enemyArcherRange=event.target.checked;
   onChange();
  };
  const poolEditor=detail.querySelector('[data-equipment-pool]');
  if(poolEditor)poolEditor.onclick=()=>ed.openAutoLoadout(1, 'enemy');
  for(const control of detail.querySelectorAll('[data-enemy-loadout]'))control.onchange=()=>{
   if(disabled)return;
   this.value[control.dataset.enemyLoadout]=control.checked;
   onChange();
  };
  const proficiency=detail.querySelector('[data-enemy-proficiency]');
  if(proficiency)proficiency.onchange=()=>{
   if(disabled)return;
   this.value.enemyProficiencyLevel=proficiency.value==='enemyProficiencyLevel';
   this.value.enemyProficiency40=proficiency.value==='enemyProficiency40';
   onChange();
  };
  for(const control of detail.querySelectorAll('[data-enemy-item-category]'))control.onchange=()=>{
   if(disabled)return;
   const bit=Number(control.dataset.enemyItemCategory);
   const pool=this.value.enemyItemPool;
   this.value.enemyItemPool=control.checked?pool|bit:pool&~bit;
   onChange();
   detail.querySelector(`[data-enemy-item-category="${bit}"]`)?.focus({preventScroll:true});
  };
  renderEnemyLevels(detail.querySelector('[data-enemy-levels]'),this.value,
   !!this.info.enemyLevelsVersion&&!!this.info.project,ed.ctx.readOnly?.()||!!this.saved?.error,onChange);
  this.renderStartingCards(detail.querySelector('[data-starting-cards]'),onChange,ed,'Enemy');
  renderStartingStatuses(detail.querySelector('[data-starting-status]'),this.value,
   !!this.info.startingStatusVersion&&!!this.info.project,ed.ctx.readOnly?.(),true,onChange);
 }
 renderWeaponMod(detail,onChange,ed,key,title){
  const rogue=key==='rougesReborn';
  const supported=this.info.weaponModsVersion>=(rogue?2:1)&&!!this.info.project;
  const disabled=!supported||ed.ctx.readOnly?.();
  const proficiency=key==='proficiencyII';
  const about=rogue
    ?'Restores the playable Rogue and its Bandit’s Mark. Rogues learn Gold, Loot, random Steal and directed equipment theft as they level, with Booby Trap, Detect and Disarm.'
    :proficiency
    ?'Adds 17 weapon proficiency variants. Each shares rank, XP and finisher unlocks with the original proficiency, and grants weapon access while equipped. Use Skill sets to choose which classes learn these skills, including Thrown II when enabled.'
    :'Adds thrown weapons, ammunition, Thrown proficiency and four finishers.';
  const thrownII=proficiency
    ?(this.value.throwReborn?'Throw Reborn is enabled, so Thrown II is included.':'Enable Throw Reborn in this project to include Thrown II.')
    :(this.value.proficiencyII?'Proficiency II is enabled, so Thrown II is included.':'Enable Proficiency II in this project to include Thrown II.');
  detail.innerHTML=`<div class="data-head"><div><h1>${title}</h1><p class="muted">Integrated mods · Project settings</p></div></div>
   ${!supported?'<p class="hint">Open a project in the updated editor to configure this mod.</p>':''}
   <label class="menu-mod-option"><input type="checkbox" data-weapon-mod ${this.value[key]?'checked':''} ${disabled?'disabled':''}><span><b>Enable ${title}</b><small>${about}</small></span></label>
   ${rogue?'':`<p class="hint">${thrownII}</p>`}
   <p class="hint">Use Save to keep this choice with the project, then Apply Project to build the game files.</p>`;
  detail.querySelector('[data-weapon-mod]').onchange=event=>{
   if(disabled)return;
   this.value[key]=event.target.checked;
   if(event.target.checked)this.recommendPreparation();
   onChange();
  };
 }
 renderClassChange(detail,onChange,ed,key,title){
  const prep=key==='modPreparation';
  const supported=!!this.info.specialClassChangeVersion;
  const readOnly=!!ed.ctx.readOnly?.();
  const needsProject=!this.info.project;
  const disabled=!supported||needsProject||readOnly;
  const unavailable=!supported?'Restart the editor using Start Editor.bat from this download.':
   readOnly?'Restart the editor in editing mode to change these settings.':
   needsProject?'Create or load a project to configure this mod.':'';
  const toggle=(field,label,about,locked=false)=>`<label class="menu-mod-option"><input type="checkbox" data-class-option="${field}" ${this.value[field]?'checked':''} ${disabled||locked?'disabled':''}><span><b>${label}</b><small>${about}</small></span></label>`;
  const applied=JSON.parse(this.original).specialClassChange;
  detail.innerHTML=`<div class="data-head"><div><h1>${title}</h1><p class="muted">Integrated mods · Project settings</p></div></div>
   ${unavailable?`<p class="hint" role="status">${unavailable}</p>`:''}
   ${supported&&needsProject&&!readOnly?'<button data-class-new-project>Create project…</button>':''}
   ${prep?toggle(key,'Enable Mod Preparation',this.value.specialClassChange?'Required while Special Class Change is enabled.':'Enables the preparation layer for this project.',this.value.specialClassChange)+
    '<section data-prep-capacity></section><section data-community-groups></section>':
    toggle(key,'Enable Special Class Change','Enables Mod Preparation for this project. Adds individual special-character class lists, marks and Templar variants.')+
    toggle('advancedBeastFamilies','Link ordinary and advanced beast families','Allows class changes between forms within the same beast family.',!this.value.specialClassChange)+
    (this.info.specialClassChangeVersion>=2?toggle('genericSpecialRecruitment','Recruit generic special units','Allows battle recruitment of generic advanced classes, Templars and large monster variants. Named units keep their existing rules.',!this.value.specialClassChange):'')+
    '<p class="hint">Save to see the special-character and advanced family groups in Races. Select a group there to edit its available classes. Marks drop from matching enemies with an available drop slot. Templars use the normal class marks.</p>'+
    `<button data-export-class ${disabled||!applied||this.dirty?'disabled':''}>Export class-change build</button><p data-export-status role="status"></p>`}
   <p class="hint">Use Save to keep these settings with the project. Apply project builds and installs the selected settings.</p>`;
  for(const input of detail.querySelectorAll('[data-class-option]')) input.onchange=()=>{
   if(disabled)return;
   const field=input.dataset.classOption;
   this.value[field]=input.checked;
   if(field==='specialClassChange'){
    if(input.checked)this.value.modPreparation=true;
    else {
     this.value.advancedBeastFamilies=false;
     if(this.info.specialClassChangeVersion>=2)this.value.genericSpecialRecruitment=false;
    }
   }
   onChange();
  };
  const create=detail.querySelector('[data-class-new-project]');
  if(create)create.onclick=async()=>{
   create.disabled=true;
   try{
    await ed.ctx.createModProject();
    if(this.info.project)onChange();
   }catch(e){ed.ctx.toast(e.message,true);}
   finally{create.disabled=false;}
  };
  if(prep){
   this.renderPreparationCapacity(detail.querySelector('[data-prep-capacity]'),ed);
   this.renderCommunityGroups(detail.querySelector('[data-community-groups]'),onChange,ed);
  }
  const button=detail.querySelector('[data-export-class]');
  if(button)button.onclick=async()=>{
   button.disabled=true;
   const status=detail.querySelector('[data-export-status]');
   status.textContent='Building the project package…';
   try{
    const url=URL.createObjectURL(await source.exportClassChange(this.info.project));
    const link=document.createElement('a');
    link.href=url;link.download='Special-Class-Change.zip';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    status.textContent='Exported the class-change build.';
   }catch(e){status.textContent=e.message;}
   finally{button.disabled=false;}
  };
 }
 renderPreparationCapacity(section,ed){
  const plan=this.saved?.capacityPlan;
  if(!plan){section.textContent='Restart the editor server to load the capacity plan.';return;}
  const pool=this.saved.itemPool;
  const itemSlots=pool&&ed.communityItemSlots?[...ed.communityItemSlots()].length:null;
  const spellSlots=ed.panels?.others?.autoloadouts?.freeSpellPresets;
  const templateSlots=plan.characterTemplateLimit&&ed.tables?.template?
   Math.max(0,plan.characterTemplateLimit-ed.tables.template.count):null;
  const states={
   Items:itemSlots===null?'Planned':`${itemSlots} free in this project. Enable Mod Preparation to add items beyond the class marks. Expanded item IDs need in-game testing.`,
   Equipment:'Pending inventory expansion',
   'Spell permission groups':this.saved.spellSetSlots?
    `${this.saved.spellSetSlots.limit-this.saved.spellSetSlots.first-this.spellSets.length} free. Create expanded groups under Spell sets. In-game testing is pending.`:'Planned',
   'Skill permission groups':this.saved.skillSetSlots?
    `${this.saved.skillSetSlots.limit-this.saved.skillSetSlots.first-this.skillSets.length} free. Create expanded groups under Skill sets. In-game testing is pending.`:'Planned',
   'Equipment permission groups':this.saved.equipmentPermissionSlots?
    `${this.saved.equipmentPermissionSlots.limit-this.saved.equipmentPermissionSlots.first-this.equipmentPermissions.length} free. Create expanded groups under Others → Equipment permissions. In-game testing is pending.`:'Planned',
   'Automatic spell loadouts':spellSlots===undefined?'Planned':`${spellSlots} free in this project. Create profiles under Stats & Values → Auto Loadouts. Expanded rows need in-game testing.`,
   'Character templates':templateSlots===null?'Planned':`${templateSlots} remaining within the Class Change build limit. Add sheets through the character art importer. More than one added sheet needs in-game testing.`,
   'Class-change groups':'Available with Special Class Change',
  };
  section.innerHTML=`<h2>Community capacity</h2>
   <p class="hint">These targets count free slots after active integrated mods.${pool?` Item IDs ${pool.markStart}–${pool.markStart+pool.markCount-1} stay available for Special Class Change. Create community items from the Items tab.`:''}</p>
   <details><summary>View the capacity plan</summary><table><thead><tr><th>Category</th><th>Free slot target</th><th>Expansion status</th></tr></thead><tbody>
   ${Object.entries(plan.headroomAfterActiveAllocations).map(([label,amount])=>`<tr><td>${esc(label)}</td><td>${amount??'As needed'}</td><td>${states[label]??'Planned'}</td></tr>`).join('')}
   </tbody></table></details>`;
 }
 renderCommunityGroups(section,onChange,ed){
  const plan=this.saved?.capacityPlan;
  if(!plan)return;
  const count=plan.headroomAfterActiveAllocations['Class-change groups'];
  const start=plan.classChangeGroupStart;
  const enabled=!!this.info.project&&this.value.specialClassChange;
  const locked=!enabled||ed.ctx.readOnly?.();
  const groups=this.communityGroups;
  const current=groups.find(g=>g.id===this.selectedGroup)??groups[0];
  section.innerHTML=`<h2>Community class-change groups</h2>
   <p class="hint">${count-groups.length} free of ${count}. Assign character templates and choose the classes they can change to. Normal class-mark and story rules still apply. Removing a template from a group restores its previous class rules.</p>
   ${enabled?'':'<p class="hint">Enable Special Class Change to edit or apply these groups.</p>'}
   <div class="data-actions"><button data-add-group ${locked||groups.length>=count?'disabled':''}>Create class-change group</button>
   ${current?`<select aria-label="Community class-change group" data-select-group>${groups.map(g=>`<option value="${g.id}" ${g.id===current.id?'selected':''}>${esc(g.name)} (#${g.id})</option>`).join('')}</select>`:''}</div>
   ${current?`<label class="field"><span>Group name</span><input data-group-name aria-label="Group name" maxlength="80" value="${esc(current.name)}" ${locked?'disabled':''}></label>
   <div data-templates></div><div data-classes></div><button data-remove-group class="ghost" ${locked?'disabled':''}>Remove this group</button>`:''}`;
  section.querySelector('[data-add-group]').onclick=()=>{
   if(locked||groups.length>=count)return;
   const used=new Set(groups.map(g=>g.id));
   let id=start;while(used.has(id))id++;
   groups.push({id,name:`Group ${id}`,templates:[],classes:[]});
   groups.sort((a,b)=>a.id-b.id);
   this.selectedGroup=id;
   onChange();
  };
  if(!current)return;
  section.querySelector('[data-select-group]').onchange=e=>{
   this.selectedGroup=Number(e.target.value);this.renderCommunityGroups(section,onChange,ed);
  };
  section.querySelector('[data-group-name]').onchange=e=>{
   if(locked)return;
   const name=e.target.value.trim();
   if(!name){e.target.value=current.name;return;}
   current.name=name;onChange();
  };
  section.querySelector('[data-remove-group]').onclick=()=>{
   if(locked)return;
   this.communityGroups=groups.filter(g=>g!==current);onChange();
  };
  const lists=ed.ctx.tables?.()?.lists;
  const additional=new Set(this.saved.additionalClassChoices??[]);
  const allowed=(lists?.class??[]).filter(({id})=>id>0&&id!==77&&(id<80||additional.has(id))&&ed.tables.class.row(id)[0x55]);
  const assigned=new Set(groups.flatMap(g=>g.templates));
  const templates=(lists?.template??[]).filter(({id})=>id>0);
  this.renderGroupChoices(section.querySelector('[data-templates]'),'Character templates',current.templates,templates,assigned,locked,onChange);
  this.renderGroupChoices(section.querySelector('[data-classes]'),'Allowed classes',current.classes,allowed,new Set(current.classes),locked,onChange);
 }
 renderGroupChoices(section,label,selected,options,taken,locked,onChange){
  const heading=document.createElement('h3');heading.textContent=label;section.append(heading);
  const available=options.filter(({id})=>!taken.has(id));
  const picker=createPicker({options:available,value:0,allowRaw:false,emptyLabel:`Add ${label.toLowerCase()}…`,onChange:id=>{
   if(locked||taken.has(id))return;
   selected.push(id);selected.sort((a,b)=>a-b);onChange();
  }});
  picker.disabled=locked||!available.length;picker.setAttribute('aria-label',`Add ${label.toLowerCase()}`);section.append(picker);
  const names=new Map(options.map(o=>[o.id,o.name]));
  const list=document.createElement('ul');
  for(const id of selected){
   const row=document.createElement('li');row.textContent=`${names.get(id)??`#${id}`} `;
   const remove=document.createElement('button');remove.type='button';remove.className='ghost';remove.textContent='Remove';remove.disabled=locked;
   remove.onclick=()=>{if(!locked){selected.splice(selected.indexOf(id),1);onChange();}};
   row.append(remove);list.append(row);
  }
  section.append(list);
 }
 render(detail,onChange,ed){
  detail.innerHTML=`<div class="data-head"><div><h1>Menu controls</h1><div class="meta">Integrated mods · ${this.info.project?'saved with this project':'game settings'}</div><p class="mod-summary">Choose the menu conveniences to include in this mod. AI settings are under AI Plus.</p><p class="hint">${this.info.project?'Use Save to store these choices in the project. Apply project installs them for the next game launch.':'Use Save to install these settings for the next launch. Close the game before saving changes here.'}</p></div></div><div class="mod-details"></div>`;
  this.renderOptions(detail.querySelector('.mod-details'),onChange,ed,'menu');
 }
 renderBugFixes(detail,onChange,ed){
  detail.innerHTML=`<div class="data-head"><div><h1>Bug Fixes</h1><div class="meta">Integrated mods · ${this.info.project?'saved with this project':'game settings'}</div></div></div><div class="mod-details"></div>`;
  this.renderOptions(detail.querySelector('.mod-details'),onChange,ed,'bug-fixes');
 }
 renderOptions(detail,onChange,ed,scope){
  const resetLabel={menu:'Use normal menu behaviour',ai:'Disable AI Plus runtime options','bug-fixes':'Disable both fixes'}[scope];
  const applyHint=scope==='menu'?'AI Plus options are saved separately in the same project.':this.info.project?'Save these choices with the project, then apply it for the next game launch.':'Save these choices with the game closed, then restart it.';
  const readOnly=!this.supported||ed.ctx.readOnly?.();
  const option=([key,label,about])=>`<label class="menu-mod-option"><input type="checkbox" data-menu-mod="${key}" ${this.value[key]?'checked':''} ${readOnly?'disabled':''}><span><b>${label}</b><small>${about}</small></span></label>`;
  detail.innerHTML=`${!this.supported?'<p class="hint warn">Restart the editor server to enable runtime options.</p>':''}${this.saved?.error?`<p class="hint warn">${esc(this.saved.error)}</p>`:''}${scopedOptions(scope).map(option).join('')}<div class="data-actions"><button data-native ${!this.enabledIn(scope)||readOnly?'disabled':''}>${resetLabel}</button></div><p class="hint">${this.dirtyIn(scope)?'Unsaved choices. Use the main Save button.':'Choices are saved.'} ${applyHint}</p>`;
  for(const input of detail.querySelectorAll('[data-menu-mod]'))input.onchange=()=>{if(ed.ctx.readOnly?.())return;this.value[input.dataset.menuMod]=input.checked;if(input.dataset.menuMod==='aiChoices'&&input.checked&&!this.value.aiStatusAll)this.value.aiStatus=true;onChange();};
  detail.querySelector('[data-native]').onclick=()=>{if(ed.ctx.readOnly?.())return;for(const [key]of scopedOptions(scope))this.value[key]=false;onChange();};
 }
}

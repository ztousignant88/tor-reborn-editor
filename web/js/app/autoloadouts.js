import {renderEquipmentPool} from './equipment_pool_panel.js';
import{autoTables,readAutoPreset,autoPresetRow,applyAutoPreset,applyAutoFamily}from'../game/autoloadouts.js';
import{view}from'../lib/pakd.js';import{createPicker}from'../ui/picker.js';import{touchBattleData}from'../game/battledata.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ELEMENTS=['None','Air','Earth','Lightning','Water','Fire','Ice','Light','Dark'];
export class AutoLoadoutsEditor{
 constructor(ed){this.ed=ed;}
 get spellPresetLimit(){
  const plan=this.ed.menuMods?.saved?.capacityPlan;
  return plan?.nativeSpellPresetCount ? plan.nativeSpellPresetCount+plan.headroomAfterActiveAllocations['Automatic spell loadouts'] : 0;
 }
 get freeSpellPresets(){
  const {presets}=autoTables(this.ed.dat);
  let free=Math.max(0,this.spellPresetLimit-presets.count);
  for(let n=1;n<presets.count;n++)if(!presets.row(n).some(Boolean))free++;
  return free;
 }
 canAppend(presets){
  return !!this.ed.menuMods?.value.modPreparation&&presets.count<this.spellPresetLimit;
 }
 nextSpellPreset(presets){
  for(let n=1;n<presets.count;n++){
   if(!presets.row(n).some(Boolean))return n;
  }
  return this.canAppend(presets)?presets.count:null;
 }
 familyName(id){const{families}=autoTables(this.ed.dat),r=families.row(id),effect=view(r).getUint16(4,true);return `Elemental family ${view(r).getUint16(0,true)} — ${this.ed.ctx.tables().effectName(effect)||'spell family'}`;}
 first(){return 0;}
 renderList(list, selected, filter, onSelect) {
  const ed = this.ed, { presets, families } = autoTables(ed.dat);
  const query = filter.trim().toLowerCase();
  list.replaceChildren();
  const entry = (id, name, subtitle, classId) => {
   if (query && !`${name} ${subtitle} ${id}`.toLowerCase().includes(query)) return;
   const button = document.createElement('button');
   button.className = `data-item others-entry${selected === id ? ' active' : ''}`;
   button.dataset.index = String(id);
   button.innerHTML = `<span class="thumb"></span><span class="data-name">${esc(name)}<br><small class="muted">${esc(subtitle)}</small></span>`;
   button.onclick = () => onSelect(id);
   list.append(button);
   if (classId) ed.picture('class', classId, false).then(art => {
    if (art && button.isConnected) button.querySelector('.thumb').append(art);
   }).catch(() => {});
  };
  entry(0, 'Auto Loadouts', 'How automatic generation works');
  entry(1, 'Equipment pool', 'Availability and minimum levels');
  for (let n = 1; n < presets.count; n++) {
   const row = presets.row(n), unused = !row.some(Boolean);
   entry(100 + n, unused ? `Unused spell preset #${n}` : `${ed.name('class', row[0]) || `Class ${row[0]}`} #${row[1]}`,
    unused ? 'Available for a new class/profile' : `Spell profile ${row[1]} · preset #${n}`, row[0]);
  }
  for (let n = 0; n < families.count; n++) entry(1000 + n, this.familyName(n), 'Element-dependent spell selection');
 }
 spellOptions(includeFamilies=true){
  const ed=this.ed,{families}=autoTables(ed.dat);
  const symbols=Array.from({length:families.count},(_,n)=>({id:view(families.row(n)).getUint16(0,true),name:this.familyName(n),group:'Elemental families'}));
  const reserved=new Set(includeFamilies?symbols.map(o=>o.id):[]);
  const spells=ed.ctx.tables().lists.autoSpell.filter(o=>o.id&&!reserved.has(o.id))
   .map(o=>({...o,group:'Spellbooks',art:()=>ed.picture('effect',o.id,false)}));
  return [{id:0,name:'None'},...spells,...(includeFamilies?symbols:[])];
 }
 renderDetail(detail,id,onChange){const ed=this.ed,guard=()=>!ed.ctx.readOnly?.(),finish=(changed)=>{if(changed){touchBattleData();onChange();ed.ctx.toast('Automatic loadout updated. Use Save to write it.');}else ed.ctx.toast('Automatic loadout is unchanged.');};
 if(id===0){detail.innerHTML='<h1>Auto Loadouts</h1><p><button type="button" data-create-spell-profile>Create spell profile</button></p><p>Choose Equipment pool, a class spell profile, or an elemental family on the left.</p><h3>Equipment</h3><p>The battle record enables automatic equipment with its equipment flag. The game fills empty slots from eligible equipment at the unit’s level. Explicit equipment stays separate; equipment ID 999 blocks filling that slot. Class permissions, gender, weapon proficiency and other equipment checks apply. This panel edits the shared equipment pool and minimum levels.</p><h3>Spells</h3><p>The battle record’s magic byte selects a spell profile for its class. Zero disables this generation path. The profile contains four preferred spell/family entries, three fallback entries and four fill categories. The game resolves elemental families, rank/level availability and class permissions before filling up to four spell slots.</p><h3>Skills</h3><p>The inspected battle loader copies four explicit skill slots and ranks. It then runs separate automatic equipment and spell routines. No equivalent skill-preset table was identified in this path. Edit battle skill assignments in Battles and learning permissions in Skill sets.</p><p class="muted">These are shared game rules. Edits affect all units using them. Fixed battle assignments and already-saved characters can behave differently. The selection algorithms remain native; this is not an exact final-loadout simulator.</p>';
  const create=detail.querySelector('[data-create-spell-profile]');
  const {presets}=autoTables(ed.dat);
  create.disabled=!guard()||this.nextSpellPreset(presets)===null;
  create.onclick=()=>{
   const next=this.nextSpellPreset(autoTables(ed.dat).presets);
   if(guard()&&next!==null)ed.openAutoLoadout(100+next);
  };
  return;
 }
 if(id===1){renderEquipmentPool(detail,ed,onChange,this.poolView,view=>this.poolView=view);return;}
 if(id>=1000){const n=id-1000,{families}=autoTables(ed.dat);if(n>=families.count){detail.textContent='Select an elemental family.';return;}const r=families.row(n),draft=Array.from({length:9},(_,i)=>view(r).getUint16(2+i*2,true));detail.innerHTML=`<h1>${esc(this.familyName(n))}</h1><p class="hint">A spell profile can request this family instead of a fixed spell. The unit’s element selects the entry below. The native generator can then choose an eligible rank from that spell’s family. Changes affect every profile using this symbol.</p><fieldset class="others-settings" ${guard()?'':'disabled'}><div data-elements></div><p data-error class="error" role="alert"></p><button data-apply type="button">Apply elemental family</button></fieldset>`;const options=this.spellOptions(false);ELEMENTS.forEach((name,i)=>{const label=document.createElement('div');label.className='auto-spell-row';label.innerHTML=`<span>${name}</span>`;const picker=createPicker({options,value:draft[i],allowRaw:false,onChange:v=>draft[i]=Number(v)});picker.setAttribute('aria-label',`Spell for ${name}`);label.append(picker);detail.querySelector('[data-elements]').append(label);});detail.querySelector('[data-apply]').onclick=()=>{if(!guard())return;try{finish(applyAutoFamily(ed.dat,n,draft));}catch(e){detail.querySelector('[data-error]').textContent=e.message;}};return;}
 const n=id-100,{presets}=autoTables(ed.dat);
 const append=n===presets.count&&this.canAppend(presets);
 if(n<1||(!append&&n>=presets.count)){detail.textContent='Select a spell preset.';return;}
 const draft=append?{classId:1,profile:1,spells:Array(7).fill(0),categories:Array(4).fill(0)}:readAutoPreset(ed.dat,n),unused=append||!presets.row(n).some(Boolean),options=this.spellOptions(),classes=[];if(unused){draft.classId=1;draft.profile=1;}for(let c=1;c<ed.tables.class.count;c++){const name=ed.name('class',c);if(name)classes.push({id:c,name:`${name} #${c}`,art:()=>ed.picture('class',c,false)});}const categories=new Map([[0,'None']]);for(const {id:f,name}of ed.ctx.tables().lists.autoSpell){if(!f)continue;const cat=view(ed.tables.effect.row(f)).getUint16(164,true);if(cat)categories.set(cat,(categories.get(cat)?categories.get(cat)+', ':'')+name);}for(const cat of draft.categories)if(!categories.has(cat))categories.set(cat,'Stored category');detail.innerHTML=`<h1>${unused?`New spell preset #${n}`:`${esc(ed.name('class',draft.classId)||`Class ${draft.classId}`)} — spell profile ${draft.profile}`}</h1>${unused?'<p class="hint">This unused row can hold a new class/profile. Choose its class, profile number and spells, then Apply to create it.</p>':''}<p class="muted">Preset #${n}. The battle unit’s magic byte selects this profile for its current class. It is a profile number, not a level.</p><p class="hint">Preferred entries are attempted first, then fallbacks. Fill categories provide candidates for remaining slots. Availability still depends on class permissions, level, element and available spell resources; this does not force an unusable spell onto a unit.</p><button data-spell-set type="button" class="ghost">Open class spell permissions and levels</button><fieldset class="others-settings" ${guard()?'':'disabled'}><div data-class></div><label class="field">Profile number <input type="number" min="1" max="255" data-profile aria-label="Automatic spell profile" value="${draft.profile}"></label><h3>Preferred spells</h3><div data-preferred></div><h3>Fallback spells</h3><div data-fallback></div><h3>Fill categories</h3><div data-categories></div><p data-error class="error" role="alert"></p><button data-apply type="button">Apply spell profile</button><button data-reset class="ghost" type="button">Reset pending changes</button></fieldset>`;const cls=createPicker({options:classes,value:draft.classId,allowRaw:false,onChange:v=>draft.classId=Number(v)});cls.setAttribute('aria-label','Automatic spell class');detail.querySelector('[data-class]').append(cls);draft.spells.forEach((value,i)=>{const row=document.createElement('div');row.className='auto-spell-row';row.innerHTML=`<span>${i<4?'Preferred '+(i+1):'Fallback '+(i-3)}</span>`;const picker=createPicker({options,value,allowRaw:false,onChange:v=>draft.spells[i]=Number(v)});picker.setAttribute('aria-label',`Automatic ${i<4?'preferred spell '+(i+1):'fallback spell '+(i-3)}`);row.append(picker);detail.querySelector(i<4?'[data-preferred]':'[data-fallback]').append(row);});draft.categories.forEach((value,i)=>{const row=document.createElement('label');row.className='auto-spell-row';row.innerHTML=`<span>Fill category ${i+1}</span><select aria-label="Automatic fill category ${i+1}">${[...categories].map(([cat,names])=>`<option value="${cat}" ${cat===value?'selected':''}>${cat?`#${cat} — `:''}${esc(names.length>140?names.slice(0,137)+'…':names)}</option>`).join('')}</select>`;row.querySelector('select').onchange=e=>draft.categories[i]=Number(e.target.value);detail.querySelector('[data-categories]').append(row);});detail.querySelector('[data-spell-set]').onclick=()=>ed.openSpellSet(ed.panels.spellset.groupFor(draft.classId));detail.querySelector('[data-profile]').oninput=e=>draft.profile=Number(e.target.value);detail.querySelector('[data-reset]').onclick=()=>this.renderDetail(detail,id,onChange);detail.querySelector('[data-apply]').onclick=()=>{if(!guard())return;try{
   if(append){
    const current=autoTables(ed.dat).presets;
    if(n!==current.count||!this.canAppend(current))throw new Error('Spell profiles changed. Reopen the form and try again.');
    const row=autoPresetRow(ed.dat,n,draft);
    ed.appendEntryRow(72,row);
    finish(true);
   }else finish(applyAutoPreset(ed.dat,n,draft));
  }catch(e){detail.querySelector('[data-error]').textContent=e.message;}
 };
 }
}

import {EQUIPMENT_SET_SKILLS,applyEquipmentSet,equipmentSetMembers,equipmentTable} from '../game/equipmentsets.js';
import {createPicker} from '../ui/picker.js';
import {touchBattleData} from '../game/battledata.js';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nativeIds=EQUIPMENT_SET_SKILLS.map((_,id)=>id).slice(1);

export class EquipmentSetsEditor {
 constructor(ed){this.ed=ed;}
 get mods(){return this.ed.menuMods;}
 get definitions(){return this.mods?.equipmentSets??[];}
 get enabled(){return !!(this.mods?.info.project&&this.mods.value.equipmentSetBonuses&&this.mods.saved?.equipmentSetSlots);}
 get count(){return nativeIds.length+this.definitions.length;}
 definition(id){return this.definitions.find(set=>set.id===id);}
 name(id){
  const custom=this.definition(id);
  const skill=EQUIPMENT_SET_SKILLS[id];
  return custom?.name||(skill?(this.ed.ctx.tables().skillName(skill)||`Skill ${skill}`):`Set ${id}`);
 }
 get owners(){
  return new Map(this.definitions.flatMap(set=>set.members.map(member=>[member,set.id])));
 }
 members(id,owners=this.owners){
  const custom=this.definition(id);
  if(custom)return custom.members;
  const base=equipmentSetMembers(this.ed.dat,id);
  return this.enabled?base.filter(member=>!owners.has(member)):base;
 }
 create(){
  if(!this.enabled||this.ed.ctx.readOnly?.())return;
  const {first,limit}=this.mods.saved.equipmentSetSlots;
  let id=first;
  while(this.definition(id))id++;
  if(id>=limit)return;
  this.definitions.push({id,name:`Equipment set ${id}`,skill:0,members:[]});
  this.definitions.sort((a,b)=>a.id-b.id);
  this.ed.ctx.onChange();
  this.ed.openOtherCategory(1000+id);
 }
 renderList(list,selected,filter,onSelect){
  const q=filter.trim().toLowerCase(),owners=this.owners;
  if(this.enabled){
   const add=document.createElement('button');
   add.className='others-back ghost';
   add.textContent='Create equipment set';
   const {first,limit}=this.mods.saved.equipmentSetSlots;
   add.disabled=!!this.ed.ctx.readOnly?.()||this.definitions.length>=limit-first;
   add.onclick=()=>this.create();
   list.append(add);
  }
  for(const id of [...nativeIds,...this.definitions.map(set=>set.id)]){
   const members=this.members(id,owners),name=this.name(id),custom=this.definition(id);
   if(q&&!name.toLowerCase().includes(q)&&q!==String(id)&&q!==`#${id}`)continue;
   const button=document.createElement('button');
   button.className=`data-item others-entry${selected===id?' active':''}`;
   button.dataset.index=String(1000+id);
   const status=custom&&!this.enabled?' · disabled':'';
   button.innerHTML=`<span class="thumb"></span><span class="data-name">${esc(name)}<br><small class="muted">${members.length} equipment entries${status}</small></span><span class="picker-id">#${id}</span>`;
   button.onclick=()=>onSelect(id);
   list.append(button);
   if(members.length)this.ed.picture('armament',members[0],false).then(c=>{
    if(c&&button.isConnected)button.querySelector('.thumb').append(c);
   }).catch(()=>{});
  }
 }
 renderDetail(detail,set){
  const ed=this.ed,custom=this.definition(set);
  if(!custom&&!nativeIds.includes(set)){
   detail.innerHTML='<p class="muted">Choose an equipment set.</p>';
   return;
  }
  const table=equipmentTable(ed.dat);
  const skill=custom?.skill??EQUIPMENT_SET_SKILLS[set];
  const locked=!!ed.ctx.readOnly?.()||!!custom&&!this.enabled;
  detail.innerHTML=`<div class="data-head"><div><h1 data-set-title>${esc(this.name(set))}</h1><p class="muted">Equipment set #${set}<span data-skill-id>${skill?` · grants skill #${skill}`:''}</span></p></div></div>
   <div class="equipment-set-detail">
   <p class="hint">A set grants its bonus at three matching equipped pieces. When more than one set qualifies, the higher set number wins.</p>
   ${custom&&!this.enabled?'<p class="hint">Enable Equipment Set Bonuses to edit and use this set.</p>':''}
   ${!custom&&!this.enabled?'<p class="hint">Enable Equipment Set Bonuses to create additional equipment sets with their own bonus skills.</p>':''}
   <fieldset class="others-settings" ${locked?'disabled':''}>
   ${custom?`<label class="field"><span>Set name</span><input data-name maxlength="80" value="${esc(custom.name)}"></label><h3>Bonus skill</h3><div data-skill></div>`:''}
   <h3>Equipment in this set <span data-count></span></h3><div data-members></div>
   <h3>Add equipment</h3><div data-picker></div><button data-add type="button">Add to set</button>
   ${custom?'<p data-skill-needed class="muted" hidden>Choose a bonus skill before adding equipment.</p>':''}
   <p class="muted">${custom?'This set takes precedence over a piece’s original set. Removing the piece or disabling Equipment Set Bonuses restores its original membership.':'Each piece has one active set. Gear used in a community set can be moved back from that set.'}</p>
   <p data-error class="error" role="alert"></p>
   ${custom?'<button data-delete type="button" class="ghost">Remove this set</button>':''}
   <p class="muted">Use the main Save button to keep your changes. Apply Project installs the saved settings for the next launch.</p>
   </fieldset></div>`;
  const $=q=>detail.querySelector(q);
  const changed=()=>{
   ed.ctx.onChange();
   ed.renderList();
  };
  const setMembers=members=>{
   try{
    if(custom){
     if(members.size&&!custom.skill)throw new Error('Choose a bonus skill before adding equipment.');
     for(const row of this.definitions){
      if(row!==custom)row.members=row.members.filter(id=>!members.has(id));
     }
     custom.members=[...members].sort((a,b)=>a-b);
    }else{
     const owners=this.owners;
     const kept=this.enabled?equipmentSetMembers(ed.dat,set).filter(id=>owners.has(id)):[];
     if(applyEquipmentSet(ed.dat,set,[...members,...kept]))touchBattleData();
    }
    changed();
    draw();
    $('[data-error]').textContent='';
   }catch(error){$('[data-error]').textContent=error.message;}
  };
  let chosen=null;
  const updateAdd=()=>{
   const needsSkill=!!custom&&!custom.skill;
   $('[data-add]').disabled=locked||chosen===null||needsSkill;
   if(custom)$('[data-skill-needed]').hidden=!needsSkill;
  };
  if(custom){
   const choices=[];
   for(const {id,name} of ed.ctx.tables()?.lists.skill??[]){
    if(id>0&&id<800)choices.push({id,name,art:()=>ed.picture('skill',id,false)});
   }
   const picker=createPicker({options:choices,value:skill,allowRaw:false,emptyLabel:'Choose a bonus skill',onChange:id=>{
    if(locked||!id||id===custom.skill)return;
    custom.skill=id;
    $('[data-skill-id]').textContent=` · grants skill #${id}`;
    changed();
    updateAdd();
   }});
   picker.setAttribute('aria-label','Equipment set bonus skill');
   $('[data-skill]').append(picker);
   const nameInput=$('[data-name]');
   nameInput.oninput=()=>{
    const name=nameInput.value.trim();
    if(locked||!name||name===custom.name)return;
    custom.name=name;
    $('[data-set-title]').textContent=name;
    changed();
   };
   nameInput.onblur=()=>{nameInput.value=custom.name;};
   $('[data-delete]').onclick=()=>{
    if(locked||!confirm(`Remove ${custom.name}? Its equipment returns to its original sets.`))return;
    this.mods.equipmentSets=this.definitions.filter(row=>row!==custom);
    ed.ctx.onChange();
    ed.openOtherCategory(1001);
   };
  }
  const draw=()=>{
   const owners=this.owners;
   const members=new Set(this.members(set,owners));
   $('[data-count]').textContent=`(${members.size})`;
   const host=$('[data-members]');
   host.replaceChildren();
   if(!members.size)host.textContent='No equipment assigned.';
   for(const id of [...members].sort((a,b)=>a-b)){
    const row=document.createElement('div');
    row.className='equipment-set-member';
    row.innerHTML=`<span class="thumb"></span><span>${esc(ed.name('armament',id)||`Equipment ${id}`)} <small class="muted">#${id}</small></span><button type="button" class="ghost" aria-label="Remove equipment ${id}">Remove</button>`;
    row.querySelector('button').onclick=()=>{if(!locked){members.delete(id);setMembers(members);}};
    host.append(row);
    ed.picture('armament',id,false).then(c=>{if(c&&row.isConnected)row.querySelector('.thumb').append(c);}).catch(()=>{});
   }
   const options=[];
   for(let id=1;id<(custom?Math.min(761,table.count):table.count);id++){
    const override=this.enabled?owners.get(id):null;
    if(members.has(id)||(!custom&&override))continue;
    const name=ed.name('armament',id);
    if(!name)continue;
    const old=override??table.row(id)[0x77];
    options.push({id,name,group:old?`Currently set ${old}: ${this.name(old)}`:'Unassigned',sort:old,art:()=>ed.picture('armament',id,false)});
   }
   options.sort((a,b)=>a.sort-b.sort||a.name.localeCompare(b.name));
   chosen=options[0]?.id??null;
   const pickerHost=$('[data-picker]');
   pickerHost.replaceChildren();
   if(options.length){
    const picker=createPicker({options,value:chosen,allowRaw:false,onChange:id=>chosen=Number(id)});
    picker.setAttribute('aria-label','Equipment to add to set');
    pickerHost.append(picker);
   }else pickerHost.textContent='No more equipment to add.';
   updateAdd();
  };
  draw();
  $('[data-add]').onclick=()=>{
   if(locked||chosen===null||(custom&&!custom.skill))return;
   setMembers(new Set([...this.members(set),chosen]));
  };
 }
}

import {permissionTables,permissionGroup,hasEquipmentPermission,applyEquipmentPermissions} from '../game/equipmentpermissions.js';
import {touchBattleData} from '../game/battledata.js';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TYPES={1:'Fists',2:'Daggers',3:'One-handed swords',4:'Two-handed swords',5:'Axes',7:'Spears',8:'Hammers',10:'One-handed katanas',11:'Two-handed katanas',12:'Cudgels',14:'Whips',15:'Spellbooks',16:'Instruments',17:'Blowguns',18:'Bows',19:'Crossbows',20:'Fusils (guns)',22:'Shields',23:'Helmets',24:'Body armor',25:'Armguards',27:'Legguards',29:'Accessories'};

export class EquipmentPermissionsEditor {
 constructor(ed){this.ed=ed;}
 get mods(){return this.ed.menuMods;}
 get groups(){return this.mods?.equipmentPermissions??[];}
 get slots(){return this.mods?.saved?.equipmentPermissionSlots;}
 get expandedEnabled(){return !!(this.slots&&this.mods.info.project&&this.mods.value.modPreparation);}
 customFor(id){return this.expandedEnabled?this.groups.find(row=>row.classes.includes(id)):undefined;}
 nextGroup(){
  if(!this.expandedEnabled)return null;
  const used=new Set(this.groups.map(row=>row.id));
  for(let id=this.slots.first;id<this.slots.limit;id++)if(!used.has(id))return id;
  return null;
 }
 assign(classId,groupId){
  if(!this.expandedEnabled||this.ed.ctx.readOnly?.()||classId<=0)return false;
  const target=this.groups.find(row=>row.id===groupId);
  if(groupId&&!target)return false;
  for(const row of this.groups)row.classes=row.classes.filter(id=>id!==classId);
  if(target){target.classes.push(classId);target.classes.sort((a,b)=>a-b);}
  return true;
 }
 copyGroup(classId){
  const id=this.nextGroup();
  if(id===null||this.ed.ctx.readOnly?.()||classId<=0)return null;
  const custom=this.customFor(classId),native=permissionGroup(this.ed.dat,classId);
  if(!custom&&native>=64)return null;
  const {equipment}=permissionTables(this.ed.dat);
  const members=custom?[...custom.equipment]:[];
  if(!custom)for(let n=1;n<Math.min(761,equipment.count);n++){
   if(hasEquipmentPermission(equipment.row(n),native))members.push(n);
  }
  this.groups.push({id,name:`Equipment group ${id}`,classes:[],equipment:members});
  this.groups.sort((a,b)=>a.id-b.id);
  this.assign(classId,id);
  return id;
 }
 renderList(list,selected,filter,onSelect){
  const ed=this.ed,{classes}=permissionTables(ed.dat),q=filter.trim().toLowerCase();
  for(let id=0;id<classes.count;id++){
   const name=ed.name('class',id);
   if(!name||q&&!name.toLowerCase().includes(q)&&q!==String(id)&&q!==`#${id}`)continue;
   const button=document.createElement('button');
   button.className=`data-item others-entry${id===selected?' active':''}`;
   button.innerHTML=`<span class="thumb"></span><span class="data-name">${esc(name)}</span><span class="picker-id">#${id}</span>`;
   button.onclick=()=>onSelect(id);
   list.append(button);
   ed.picture('class',id,false).then(c=>{if(c&&button.isConnected)button.querySelector('.thumb').append(c);}).catch(()=>{});
  }
 }
 renderDetail(detail,id,onChange){
  const ed=this.ed,{equipment,classes}=permissionTables(ed.dat);
  const custom=this.customFor(id),native=permissionGroup(ed.dat,id);
  const group=custom?.id??native;
  const guard=()=>!ed.ctx.readOnly?.();
  const shared=[];
  for(let n=0;n<classes.count;n++){
   if((this.customFor(n)?.id??classes.row(n)[0x60])===group)shared.push(ed.name('class',n)||`Class ${n}`);
  }
  detail.innerHTML=`<div class="data-head"><div><h1>${esc(ed.name('class',id)||`Class ${id}`)}</h1>
    <p>Equipment permissions · ${custom?`${esc(custom.name)} (#${group})`:`group ${group}`}</p></div></div>
   <p class="hint">Check a type to change all its listed equipment, or expand it to select individual pieces.</p>
   <p class="muted">Shared by: ${esc(shared.join(', '))}. Proficiency II can grant weapon access where its normal rule applies.</p>
   ${this.expandedEnabled&&id>0?`<fieldset class="others-settings" ${guard()?'':'disabled'}>
     <label class="field">Equipment group <select data-group>
       <option value="0" ${custom?'':'selected'}>Original group ${native}</option>
       ${this.groups.map(row=>`<option value="${row.id}" ${custom?.id===row.id?'selected':''}>${esc(row.name)} (#${row.id})</option>`).join('')}
     </select></label>
     <button data-copy class="ghost" type="button" ${this.nextGroup()===null||(!custom&&native>=64)?'disabled':''}>New expanded group from this one</button>
     ${custom?`<label class="field">Group name <input data-group-name value="${esc(custom.name)}" maxlength="80"></label>
       <button data-remove class="ghost" type="button">Remove this expanded group</button>`:''}
   </fieldset>`:''}`;
  const picker=detail.querySelector('[data-group]');
  if(picker){
   picker.onchange=()=>{if(this.assign(id,Number(picker.value)))onChange();};
   detail.querySelector('[data-copy]').onclick=()=>{if(this.copyGroup(id)!==null)onChange();};
   if(custom){
    detail.querySelector('[data-group-name]').onchange=e=>{
     if(!guard())return;
     const name=e.target.value.trim();
     if(!name){e.target.value=custom.name;return;}
     custom.name=name;
     onChange();
    };
    detail.querySelector('[data-remove]').onclick=()=>{
     if(!guard()||!confirm(`Remove ${custom.name}? Assigned classes will return to their original equipment groups.`))return;
     this.mods.equipmentPermissions=this.groups.filter(row=>row!==custom);
     onChange();
    };
   }
  }
  if(!custom&&native>=64){
   detail.insertAdjacentHTML('beforeend','<p class="error">This class references an unsupported native equipment group.</p>');
   return;
  }
  const allowed=new Set(custom?.equipment??[]);
  const status=new Map(),types=new Map();
  for(let n=1;n<(custom?Math.min(761,equipment.count):equipment.count);n++){
   const row=equipment.row(n),type=row[2],name=ed.name('armament',n);
   if(!TYPES[type]||!name)continue;
   if(!types.has(type))types.set(type,[]);
   types.get(type).push({id:n,name});
   status.set(n,custom?allowed.has(n):hasEquipmentPermission(row,native));
  }
  const field=document.createElement('fieldset');
  field.className='others-settings permission-settings';
  field.disabled=!guard();
  field.innerHTML='<label class="field">Find equipment <input data-search-equipment placeholder="Search types or items" aria-label="Find equipment"></label><div data-types></div><p data-error class="error" role="alert"></p><p class="muted">Use the main Save button to keep these changes.</p>';
  detail.append(field);
  const host=field.querySelector('[data-types]');
  const commit=changes=>{
   if(!guard())return;
   const updates=changes.filter(([member,permit])=>status.get(member)!==permit);
   if(!updates.length)return;
   try{
    if(custom){
     for(const [member,permit] of updates){
      if(permit)allowed.add(member);else allowed.delete(member);
     }
     custom.equipment=[...allowed].sort((a,b)=>a-b);
    }else if(applyEquipmentPermissions(ed.dat,native,updates))touchBattleData();
    for(const [member,permit] of updates)status.set(member,permit);
    field.querySelector('[data-error]').textContent='';
    ed.ctx.onChange();
   }catch(error){field.querySelector('[data-error]').textContent=error.message;}
  };
  const draw=()=>{
   host.replaceChildren();
   const q=field.querySelector('[data-search-equipment]').value.trim().toLowerCase();
   for(const [type,items] of [...types].sort((a,b)=>a[0]-b[0])){
    const allMatch=TYPES[type].toLowerCase().includes(q);
    const visible=items.filter(x=>allMatch||x.name.toLowerCase().includes(q));
    if(!visible.length)continue;
    const section=document.createElement('details');
    section.open=!!q;
    section.className='permission-type';
    section.innerHTML=`<summary><label><input type="checkbox" data-type aria-label="Allow ${esc(TYPES[type])}"> ${esc(TYPES[type])} <span class="muted" data-count></span></label></summary><div data-items></div>`;
    const check=section.querySelector('[data-type]'),count=section.querySelector('[data-count]');
    const visibleChecks=new Map();
    const update=()=>{
     const n=items.filter(x=>status.get(x.id)).length;
     check.checked=n===items.length;
     check.indeterminate=n>0&&n<items.length;
     count.textContent=`${n}/${items.length} allowed`;
     for(const [id,input] of visibleChecks)input.checked=status.get(id);
    };
    check.onclick=e=>e.stopPropagation();
    check.onchange=()=>{commit(items.map(x=>[x.id,check.checked]));update();};
    for(const x of visible){
     const label=document.createElement('label');
     label.className='permission-item';
     label.innerHTML=`<input type="checkbox" aria-label="Allow ${esc(x.name)}"><span>${esc(x.name)} <small class="muted">#${x.id}</small></span>`;
     const input=label.querySelector('input');
     visibleChecks.set(x.id,input);
     input.onchange=()=>{commit([[x.id,input.checked]]);update();};
     section.querySelector('[data-items]').append(label);
    }
    update();
    host.append(section);
   }
  };
  draw();
  field.querySelector('[data-search-equipment]').oninput=draw;
 }
}

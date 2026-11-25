import{view}from'../lib/pakd.js';
import {templateFamilies} from '../game/genericroster.js';
import {FIELD,readField} from '../game/entryunit.js';
import {CLANS} from '../game/tables.js';
import {createPicker} from '../ui/picker.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const HIRING_TEMPLATES=[159,160,161,162,163,164,165,166];

export function specialHiringChoices(tables, sheetIds){
 const forms=new Map();
 for(const unit of tables.previewUnits??[]){
  const template=readField(unit.row,FIELD.template), klass=readField(unit.row,FIELD.class);
  const nameId=readField(unit.row,FIELD.name), clan=readField(unit.row,FIELD.clan);
  if(!nameId||!sheetIds.has(template)||!klass||klass>=tables.tables.class.count||clan>=CLANS.length)continue;
  const name=tables.unitName(nameId)?.trim();
  if(!name||/^<|^not used$/i.test(name))continue;
  const id=`special:${template}:${klass}:${nameId}`;
  if(!forms.has(id))forms.set(id,{template,klass,nameId,name,clans:new Map()});
  const clans=forms.get(id).clans;
  const prior=clans.get(clan);
  clans.set(clan,{count:(prior?.count??0)+1,unit:prior?.unit??unit});
 }
 const options=[...forms].map(([id,form])=>{
  const [clan,{unit}]=[...form.clans].sort(([a,x],[b,y])=>Number(Boolean(b))-Number(Boolean(a))||y.count-x.count||a-b)[0];
  const label=tables.templateName(form.template);
  const name=label && !/^Character sheet \d+$/.test(label) ? label : form.name;
  const role=tables.className(form.klass,tables.isFemale(form.template));
  return {id,name:[name,role].filter(Boolean).join(' · '),group:'Special characters',
   template:form.template,klass:form.klass,identity:{nameId:form.nameId,clan},
   look:()=>({actor:unit.sprite[0],palette:tables.unitPalette(unit.row)})};
 });
 const labels=new Map();
 for(const {name} of options)labels.set(name,(labels.get(name)??0)+1);
 for(const option of options){
  if(labels.get(option.name)>1)option.name+=` (sheet #${option.template}, class #${option.klass})`;
 }
 return options.sort((a,b)=>a.name.localeCompare(b.name)||a.template-b.template);
}

export class ShopHiringEditor{
 constructor(ed){this.ed=ed;}
 templateLabel(id){return `${id<=162?'Male':'Female'} template ${id<=162?id-158:id-162}`;}
 uses(id){return (this.ed.ctx.tables().previewUnits??[]).filter(u=>view(u.row).getUint16(2,true)===id).length;}
 renderList(list,selected,filter,onSelect){
  const q=filter.trim().toLowerCase(),entry=(id,name,sub,lookId)=>{if(q&&!`${name} ${sub} ${id}`.toLowerCase().includes(q.replace('#','')))return;const b=document.createElement('button');b.className=`data-item others-entry${id===selected?' active':''}`;b.dataset.index=String(2000+id);b.innerHTML=`<span class="thumb"></span><span class="data-name">${esc(name)}${sub?`<br><small class="muted">${esc(sub)}</small>`:''}</span>`;b.onclick=()=>onSelect(id);list.append(b);if(lookId)this.ed.picture('template',lookId,false).then(c=>{if(c&&b.isConnected)b.querySelector('.thumb').append(c);}).catch(()=>{});};
  entry(0,'Hiring roster','Fixed slots and random pool');for(const id of HIRING_TEMPLATES)entry(id,this.templateLabel(id),`Shared character sheet #${id}`,id);
 }
 renderRoster(detail,onChange){
  const ed=this.ed, tables=ed.ctx.tables(), mods=ed.menuMods;
  const stock=mods.stockShopHiringRoster;
  const plan=mods.shopHiringPlan;
  const editable=!!(mods.info.project && plan && stock.length && !ed.ctx.readOnly?.());
  const mode=plan?.mode??'stock';
  const random=mode==='random';
  const custom=mode==='fixed'||(random&&plan.includeCustom);
  const roster=random?plan.pool:mods.shopHiringRoster;
  const monsterCount=mods.saved?.shopHiringMonsterChoices??0;
  const eligible=random?(plan.includeCustom?roster.length:0)+(plan.includeMonsters?monsterCount:0):0;
  const poolStatus=random&&!plan.includeCustom&&!plan.includeMonsters?'Choose what to include in the pool.':
   eligible<10?`${eligible} eligible choices. Add ${10-eligible} more or include large monsters.`:
   `Draws ten offers from ${eligible} eligible choices.`;
  const modeOptions=[['stock','Game default'],['fixed','Fixed roster'],['random','Random pool']];
  detail.innerHTML=`<div class="data-head"><div><h1>Shop hiring</h1><p class="muted">Ten offers at a time · Level 1 · 2,000 Goth</p></div></div>
   <div class="hiring-detail">
    <fieldset class="hiring-modes"><legend>Lineup</legend>
     ${modeOptions.map(([id,label])=>`<label><input type="radio" name="hire-mode" value="${id}" ${mode===id?'checked':''} ${editable?'':'disabled'}> ${label}</label>`).join('')}
    </fieldset>
    ${!mods.info.project?'<p class="hint">Open a project to edit shop hiring.</p>':!plan?'<p class="hint">Restart the editor to load the updated hiring settings.</p>':''}
    ${mode==='fixed'?'<p class="hint">Set the ten offers that appear each time you open Hire.</p>':''}
    ${random?`
     <div class="hiring-pool-options">
     <fieldset><legend>Pool contents</legend>
      <label class="menu-mod-option"><input type="checkbox" data-hire-option="includeCustom" ${plan.includeCustom?'checked':''} ${editable?'':'disabled'}> <span>Custom choices</span></label>
      <label class="menu-mod-option"><input type="checkbox" data-hire-option="includeMonsters" ${plan.includeMonsters?'checked':''} ${editable?'':'disabled'}> <span>Large monsters (${monsterCount})</span></label>
     </fieldset>
     <fieldset><legend>Reroll lineup</legend>
      <label class="menu-mod-option"><input type="checkbox" data-hire-option="afterBattle" ${plan.afterBattle?'checked':''} ${editable?'':'disabled'}> <span>After each battle</span></label>
      <label class="menu-mod-option"><input type="checkbox" data-hire-option="onOpen" ${plan.onOpen?'checked':''} ${editable?'':'disabled'}> <span>When reopening Hire</span></label>
     </fieldset>
     </div>
     <p class="${eligible<10?'error':'hint'}" aria-live="polite">${poolStatus}</p>`:''}
    ${custom?`
     <div class="hiring-actions">
      ${random?`<button type="button" data-hire-add ${editable&&roster.length<64?'':'disabled'}>Add pool choice</button>`:''}
      <button type="button" data-hire-reset ${editable?'':'disabled'}>${random?'Reset custom pool':'Restore stock slots'}</button>
     </div>
     <table class="hiring-table"><thead><tr><th scope="col">${random?'Choice':'Slot'}</th><th scope="col">Class</th><th scope="col">Character or pool</th><th scope="col">Name bank</th><th scope="col">Identity</th>${random?'<th scope="col"></th>':''}</tr></thead>
      <tbody data-hire-rows></tbody></table>`:''}
   </div>`;
  const changed=()=>{onChange?.();};
  const refresh=()=>{
   mods.value.customShopHiring=plan.mode==='fixed'||(plan.mode==='random'&&plan.includeCustom);
   mods.value.shopHiringLargeMonsters=plan.mode==='random'&&plan.includeMonsters;
   changed();
   this.renderRoster(detail,onChange);
  };
  for(const input of detail.querySelectorAll('[name="hire-mode"]'))input.onchange=()=>{
   plan.mode=input.value;
   refresh();
   detail.querySelector('[name="hire-mode"]:checked')?.focus();
  };
  for(const input of detail.querySelectorAll('[data-hire-option]'))input.onchange=()=>{
   const key=input.dataset.hireOption;
   plan[key]=input.checked;
   refresh();
   detail.querySelector(`[data-hire-option="${key}"]`)?.focus();
  };
  if(!custom)return;
  detail.querySelector('[data-hire-reset]').onclick=()=>{
   const restored=structuredClone(stock);
   if(random)plan.pool=restored.map((row,index)=>({...row,bank:index<5?1:2}));
   else mods.shopHiringRoster=restored;
   changed();
   this.renderRoster(detail,onChange);
  };
  if(random)detail.querySelector('[data-hire-add]').onclick=()=>{
   roster.push({...structuredClone(stock[0]),bank:1});
   changed();
   this.renderRoster(detail,onChange);
   detail.querySelector('[data-hire-rows] tr:last-child .picker')?.focus();
  };
  const templateTable=tables.tables.unitTemplate;
  const sheets=tables.lists.template.filter(({id})=>id>0 && id<=65535 && view(templateTable.row(id)).getUint16(0x18,true));
  const sheetIds=new Set(sheets.map(({id})=>id));
  const pools=new Map();
  for(const family of new Set(templateFamilies(tables.templateLabels,templateTable).values())){
   if(family.ids.length===4 && family.ids.every(id=>sheetIds.has(id))){
    pools.set(family.ids.join(','),{id:family.ids.join(','),name:family.name,group:'Random pools',look:()=>tables.templateLook(family.ids[0])});
   }
  }
  for(const [name,index] of [['Stock male pool',0],['Stock female pool',5]]){
   const ids=stock[index]?.templates;
   if(ids) pools.set(ids.join(','),{id:ids.join(','),name,group:'Random pools',look:()=>tables.templateLook(ids[0])});
  }
  const specials=specialHiringChoices(tables,sheetIds);
  const specialById=new Map(specials.map(option=>[option.id,option]));
  const options=[...specials,...pools.values(),...sheets.map(sheet=>({...sheet,group:sheet.group??'Character sheets'}))];
  const rows=detail.querySelector('[data-hire-rows]');
  for(const [index,entry] of roster.entries()){
   const row=document.createElement('tr');
   const number=document.createElement('th');
   number.scope='row';
   number.textContent=String(index+1);
   const klassCell=document.createElement('td'), templateCell=document.createElement('td');
   const bankCell=document.createElement('td'), identityCell=document.createElement('td'), actionCell=document.createElement('td');
   row.append(number,klassCell,templateCell,bankCell,identityCell);
   if(random)row.append(actionCell);
   rows.append(row);
   const rebuildClass=()=>{
    const sheet=entry.templates[0];
    const female=tables.isFemale(sheet);
    const classes=tables.classOptionsFor(sheet,entry.class)
     .filter(({id})=>id>0 && id<=255 && tables.tables.class.row(id).some(Boolean))
     .map(option=>({...option,look:()=>tables.classLook(option.id,female)}));
    const picker=createPicker({options:classes,value:entry.class,allowRaw:false,onChange:value=>{
     entry.class=Number(value);
     changed();
    }});
    picker.setAttribute('aria-label',`Hiring slot ${index+1} class`);
    picker.disabled=!editable||!custom;
    klassCell.replaceChildren(picker);
   };
   rebuildClass();
   const rebuildIdentity=()=>{
    identityCell.replaceChildren();
    if(!custom||!entry.templates.every(id=>id===entry.templates[0]))return;
    if(entry.identity?.nameId){
     identityCell.textContent=`${tables.unitName(entry.identity.nameId)||'Name #'+entry.identity.nameId} · ${CLANS[entry.identity.clan]}`;
     return;
    }
    const details=document.createElement('details'), summary=document.createElement('summary');
    const name=document.createElement('input'), clan=document.createElement('select');
    summary.textContent=entry.identity?.name??'Name and clan';
    name.type='text';
    name.placeholder='Random name';
    name.maxLength=56;
    name.value=entry.identity?.name??'';
    name.setAttribute('aria-label',`Name for offer ${index+1}`);
    clan.setAttribute('aria-label',`Clan for offer ${index+1}`);
    clan.append(...CLANS.map((label,id)=>new Option(label,id)));
    clan.value=entry.identity?.clan??0;
    const updateIdentity=()=>{
     const text=name.value.trim();
     if(new TextEncoder().encode(text).length>56){
      name.setCustomValidity('Use a name of up to 56 UTF-8 bytes.');
      name.reportValidity();
      return;
     }
     name.setCustomValidity('');
     if(text)entry.identity={name:text,clan:Number(clan.value)};
     else delete entry.identity;
     summary.textContent=text||'Name and clan';
     clan.disabled=!editable||!text;
     changed();
    };
    name.disabled=!editable;
    clan.disabled=!editable||!name.value;
    name.onchange=updateIdentity;
    clan.onchange=updateIdentity;
    details.append(summary,name,clan);
    identityCell.append(details);
   };
   rebuildIdentity();
   const isSingle=entry.templates.every(id=>id===entry.templates[0]);
   const linked=entry.identity?.nameId&&specials.find(o=>o.template===entry.templates[0]&&o.klass===entry.class&&o.identity.nameId===entry.identity.nameId);
   const selection=linked?.id??(isSingle?entry.templates[0]:entry.templates.join(','));
   const available=options.some(o=>String(o.id)===String(selection))?options:
    [{id:selection,name:`Sheets ${[...new Set(entry.templates)].map(id=>'#'+id).join(', ')}`},...options];
   const picker=createPicker({options:available,value:selection,allowRaw:false,onChange:value=>{
    const special=specialById.get(value);
    if(special){
     entry.templates=Array(4).fill(special.template);
     entry.class=special.klass;
     entry.identity={...special.identity};
     if(random)entry.bank=tables.isFemale(special.template)?2:1;
    }else{
     const templates=String(value).split(',').map(Number);
     entry.templates=templates.length===1?Array(4).fill(templates[0]):templates;
     const known=templates.length===1&&specials.find(o=>o.template===templates[0]&&o.klass===entry.class);
     if(known){entry.identity={...known.identity};picker.setValue(known.id);}
     else delete entry.identity;
    }
    rebuildClass();
    rebuildIdentity();
    const bank=bankCell.querySelector('select');
    if(bank)bank.value=entry.bank;
    changed();
   }});
   picker.setAttribute('aria-label',`Hiring slot ${index+1} character, sheet or pool`);
   picker.disabled=!editable||!custom;
   templateCell.append(picker);
   if(random){
    const bank=document.createElement('select');
    bank.setAttribute('aria-label',`Name bank for pool choice ${index+1}`);
    bank.append(new Option('Male',1),new Option('Female',2));
    bank.value=entry.bank;
    bank.disabled=!editable;
    bank.onchange=()=>{entry.bank=Number(bank.value);changed();};
    bankCell.append(bank);
    const remove=document.createElement('button');
    remove.type='button';
    remove.textContent='Remove';
    remove.disabled=!editable;
    remove.setAttribute('aria-label',`Remove pool choice ${index+1}`);
    remove.onclick=()=>{roster.splice(index,1);changed();this.renderRoster(detail,onChange);};
    actionCell.append(remove);
   }else{
    bankCell.textContent=index<5?'Male':'Female';
   }
  }
 }
 renderDetail(detail,id,onChange){
  const ed=this.ed;
  if(id===0){this.renderRoster(detail,onChange);return;}
  if(!HIRING_TEMPLATES.includes(id)){detail.innerHTML='<p class="muted">Select a hiring template.</p>';return;}
  const row=ed.tables.template.row(id),v=view(row),fields=[['Base HP',v.getUint16(0x18,true)],['Base MP',v.getUint16(0x1a,true)],['STR',row[0x1e]],['VIT',row[0x20]],['DEX',row[0x22]],['AGI',row[0x24]],['AVD',row[0x26]],['INT',row[0x28]],['MND',row[0x2a]],['RES',row[0x2c]]];
  detail.innerHTML=`<div class="data-head"><div><h1>${this.templateLabel(id)}</h1><p class="muted">Shared character sheet #${id}</p></div></div><div class="hiring-detail"><p class="hint">Editing this sheet changes hired units generated from it and other units using the same template. It is referenced by ${this.uses(id)} loaded battle-unit presets.</p><p>These are template values, not the final calculated hired-unit stats.</p><dl class="set-limits">${fields.map(([name,value])=>`<dt>${name}</dt><dd>${value}</dd>`).join('')}</dl><button data-edit-template type="button">Edit shared character template</button><p class="muted">Opens Characters at sheet #${id}. Opening it does not change any data. Use the main Save button after making edits there.</p></div>`;
  detail.querySelector('[data-edit-template]').onclick=()=>ed.openCharacterTemplate(id);
 }
}


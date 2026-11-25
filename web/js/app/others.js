import{AIEditor,AI_CATEGORY}from'./aieditor.js';
import{WarrenReportEditor}from'./warrenreport.js';

import{SkillRestrictionsEditor}from'./skillrestrictions.js';
import{EquipmentPermissionsEditor}from'./equipmentpermissions.js';
import{ShopHiringEditor}from'./shophiring.js';
import{EquipmentSetsEditor}from'./equipmentsets.js';
import { FormulaEditor, FORMULA_CATEGORY } from './formulas.js';
// Small shared settings collected under Others. Per-unit finishers remain in Battles.
import{ConditionsData}from'../game/battleconditions.js';
import{duplicateBonusReward,encodeBonusReward,readBonusReward,rewardRow}from'../game/bonusrewards.js';
import{parseXlce,view}from'../lib/pakd.js';
import{createPicker}from'../ui/picker.js';
import{touchBattleData}from'../game/battledata.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class OthersEditor{
 constructor(ed){this.ed=ed;this.equipmentSets=new EquipmentSetsEditor(ed);this.hiring=new ShopHiringEditor(ed);this.permissions=new EquipmentPermissionsEditor(ed);this.restrictions=new SkillRestrictionsEditor(ed);this.warren=new WarrenReportEditor(ed);this.ai=new AIEditor(ed);this.formulas=new FormulaEditor(ed);}
 first(){return 0;}
 model(){return new ConditionsData(this.ed.dat);}
 renderList(list,selected,filter,onSelect){
  const data=this.model(),q=filter.trim().toLowerCase();list.replaceChildren();
  const navigate=id=>{this.ed.filter='';const search=this.ed.root.querySelector('#data-search');if(search)search.value='';this.ed.selected=id;this.ed.renderList();this.ed.select(id);};
  if(selected<=0){
    const heading=document.createElement('p');heading.className='muted';heading.textContent='Other categories';list.append(heading);
    const categories = [
      ['Bonus award presets', 1, data.tables[70].count - 1],
      ['Equipment sets', 1001, this.equipmentSets.count],
      ['Shop hiring', 2000, 10],
      ['Equipment permissions', 3001],
      ['Skill restrictions', 4001],
      ['Warren Report', 8000],
      ['AI editor', AI_CATEGORY],
      ['Formulas', FORMULA_CATEGORY],
      ['World Map', this.ed.ctx.openWorldMap],
    ];
    for (const [name, id, count] of categories) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'data-item others-category';
      button.innerHTML = `<span class="data-name">${name}</span>${count === undefined ? '' : `<span class="picker-id">${count}</span>`}`;
      if (typeof id === 'function') {
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', 'world-map');
        button.onclick = id;
      } else {
        button.onclick = () => navigate(id);
      }
      list.append(button);
    }
    return;
  }
  const back=document.createElement('button');back.className='others-back ghost';back.textContent='← Back to categories';back.onclick=()=>navigate(0);list.append(back);
  if(selected>=FORMULA_CATEGORY){this.formulas.renderList(list,selected-FORMULA_CATEGORY,filter,id=>onSelect(FORMULA_CATEGORY+id));return;}
  const title=document.createElement('p');title.className='muted';title.textContent=selected>=AI_CATEGORY?'AI editor':selected>=8000?'Warren Report':selected>=4000?'Skill restrictions':selected>=3000?'Equipment permissions':selected>=2000?'Shop hiring':selected>1000?'Equipment sets':'Bonus award presets';list.append(title);if(selected>=AI_CATEGORY){this.ai.renderList(list,selected-AI_CATEGORY,filter,id=>onSelect(AI_CATEGORY+id));return;}if(selected>=8000){this.warren.renderList(list,selected-8000,filter,id=>onSelect(8000+id));return;}if(selected>=4000){this.restrictions.renderList(list,selected-4000,filter,id=>onSelect(4000+id));return;}if(selected>=3000){this.permissions.renderList(list,selected-3000,filter,id=>onSelect(3000+id));return;}if(selected>=2000){this.hiring.renderList(list,selected-2000,filter,id=>onSelect(2000+id));return;}if(selected>1000){this.equipmentSets.renderList(list,selected-1000,filter,id=>onSelect(1000+id));return;}
  for(let id=1;id<data.tables[70].count;id++){const name=data.rewardText(id,this.ed.ctx.tables());if(q&&!name.toLowerCase().includes(q)&&q!==`#${id}`&&q!==String(id))continue;const b=document.createElement('button');b.className=`data-item others-entry${id===selected?' active':''}`;b.innerHTML=`<span class="thumb"></span><span class="data-name">${esc(name)}</span><span class="picker-id">#${id}</span>`;b.dataset.index=String(id);b.onclick=()=>onSelect(id);list.append(b);const r=data.tables[70].row(id);if(r[1]===1){const item=view(r).getUint16(2,true);this.ed.picture(item>=1000?'commodity':'armament',item>=1000?item-1000:item,false).then(c=>{if(c&&b.isConnected)b.querySelector('.thumb').append(c);}).catch(()=>{});}}
 }
 renderDetail(detail,id,onChange){
  if(id>=FORMULA_CATEGORY){this.formulas.renderDetail(detail,id-FORMULA_CATEGORY);return;}
  const ed=this.ed,data=this.model();if(id<=0){detail.innerHTML='<div class="data-head"><div><h1>Others</h1><p class="muted">Choose a category from the list on the left.</p></div></div>';return;}if(id>=AI_CATEGORY){this.ai.renderDetail(detail,id-AI_CATEGORY);return;}if(id>=8000){this.warren.renderDetail(detail,id-8000);return;}if(id>=4000){this.restrictions.renderDetail(detail,id-4000,onChange);return;}if(id>=3000){this.permissions.renderDetail(detail,id-3000,onChange);return;}if(id>=2000){this.hiring.renderDetail(detail,id-2000,onChange);return;}if(id>1000){this.equipmentSets.renderDetail(detail,id-1000,onChange);return;}if(id>=data.tables[70].count){detail.innerHTML='<p class="muted">Select a bonus reward preset.</p>';return;}
  const row=rewardRow(ed.dat,id),draft=readBonusReward(row);let refs=0;for(let n=1;n<data.tables[68].count;n++)if(data.tables[68].row(n)[1]===id)refs++;
  const modeOptions=['Always give the primary reward','Primary item if not already owned; otherwise alternate','First completion of the bonus; otherwise alternate'];
  detail.innerHTML=`<div class="data-head"><div><h1>Bonus reward #${id}</h1><p>${esc(data.rewardText(id,ed.ctx.tables()))}</p><p class="muted">Others · used by ${refs} bonus-task definitions</p></div></div><p class="hint">Presets are shared: editing one changes every bonus that uses it. Duplicate a preset to create a separate reward, then select its new number in the battle’s Pre-battle conditions panel. Unit finishers are assigned in Battles → Spells &amp; finishers.</p><fieldset class="others-settings" ${ed.ctx.readOnly?.()?'disabled':''}><label class="field"><span class="field-label">Reward rule</span><select data-rule aria-label="Bonus reward rule">${modeOptions.map((name,n)=>`<option value="${n}" ${n===draft.mode?'selected':''}>${name}</option>`).join('')}</select></label><div data-primary></div><div data-alternate></div><p data-error class="error" role="alert"></p><div class="data-actions"><button data-apply type="button">Apply reward preset</button><button data-duplicate type="button">Duplicate preset</button></div><p class="muted">Apply updates the open editor. Use Save to write it.</p></fieldset>`;
  const items=ed.itemOptions().filter(o=>o.id);
  const renderPart=(key,label)=>{const host=detail.querySelector(`[data-${key}]`),part=draft[key];host.innerHTML=`<h3>${label}</h3><label class="field"><span class="field-label">Reward type</span><select data-type aria-label="${label} type"><option value="0" ${part.type===0?'selected':''}>None</option><option value="1" ${part.type===1?'selected':''}>Item or equipment</option><option value="2" ${part.type===2?'selected':''}>Goth</option></select></label><div data-fields></div>`;
   const fields=host.querySelector('[data-fields]');if(part.type===1){const picker=createPicker({options:items,value:part.item,allowRaw:false,onChange:v=>part.item=Number(v)});picker.setAttribute('aria-label',`${label} item`);fields.append(picker);const label=document.createElement('label');label.className='field';label.innerHTML=`<span class="field-label">Quantity</span><input type="number" min="1" max="65535" value="${part.quantity||1}" aria-label="${key==='primary'?'Primary':'Alternate'} reward quantity">`;part.quantity||=1;label.querySelector('input').oninput=e=>part.quantity=Number(e.target.value);fields.append(label);}else if(part.type===2){fields.innerHTML=`<label class="field"><span class="field-label">Goth</span><input type="number" min="0" max="65535" value="${part.amount}" aria-label="${key==='primary'?'Primary':'Alternate'} reward Goth"></label>`;fields.querySelector('input').oninput=e=>part.amount=Number(e.target.value);}
   host.querySelector('[data-type]').onchange=e=>{part.type=Number(e.target.value);if(part.type===1&&!items.some(x=>x.id===part.item))part.item=items[0]?.id??1001;renderPart(key,label);};
  };
  renderPart('primary','Primary reward');renderPart('alternate','Alternate reward');
  const guard=()=>!ed.ctx.readOnly?.(),error=msg=>detail.querySelector('[data-error]').textContent=msg;
  detail.querySelector('[data-rule]').onchange=e=>draft.mode=Number(e.target.value);
  detail.querySelector('[data-apply]').onclick=()=>{if(!guard())return;try{if(draft.mode===1&&draft.primary.type!==1)throw new Error('The ownership rule requires an item as the primary reward');const bytes=encodeBonusReward(rewardRow(ed.dat,id),draft);rewardRow(ed.dat,id).set(bytes);touchBattleData();onChange();ed.ctx.toast('Bonus reward preset updated. Use Save to write it.');}catch(e){error(e.message);}};
  detail.querySelector('[data-duplicate]').onclick=()=>{if(!guard())return;try{const copy=duplicateBonusReward(ed.dat,id);ed.rebuildPack(70,copy.data);touchBattleData();ed.ctx.onChange();ed.renderList();ed.select(copy.id);ed.ctx.toast(`Created reward preset #${copy.id}. It is available in battle bonus rewards.`);}catch(e){error(e.message);}};
 }
}

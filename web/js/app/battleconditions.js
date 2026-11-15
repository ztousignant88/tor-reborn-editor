import {BattleRulesPanel} from './battlerules.js';
import {battleRosterOptions} from '../game/battlerules.js';
import {loadConditions} from '../game/battleconditions.js';
import {createPicker} from '../ui/picker.js';
import {itemIcon} from '../game/icons.js';
import {textureCanvas} from '../ui/texcanvas.js';
import {parseXlce,view} from '../lib/pakd.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chapters=['Chapter 1','Chapter 2','Chapter 3','Chapter 4','CODA'];
export class BattleConditionsPanel{
  constructor(ctx){this.ctx=ctx;this.rules=new BattleRulesPanel(ctx);}
  async open(){
    const ctx=this.ctx,doc=ctx.doc();if(!doc)return;
    try{
      this.data=await loadConditions();this.doc=doc;
      const contexts=ctx.catalog.battleContexts(doc),stages=[...new Set([...contexts.map(c=>c.stage),...ctx.catalog.stagesFor(doc).map(s=>s.stage)])].filter(n=>n>0&&n<this.data.tables[17].count);
      if(!stages.length){ctx.toast('This unit file has no recorded battle stage. Choose a linked battle to edit its conditions.',true);return;}
      this.dialog?.remove();const d=document.createElement('dialog');d.className='battle-conditions-dialog';d.setAttribute('aria-label','Pre-battle conditions');
      d.innerHTML=`<div class="conditions-head"><h2>Pre-battle conditions</h2><button data-close type="button">Close</button></div><label>Battle stage <select data-stage>${stages.map(n=>`<option value="${n}">Stage ${n}${contexts.find(c=>c.stage===n)?.scene?` · ${esc(contexts.find(c=>c.stage===n).scene)}`:''}</option>`).join('')}</select></label><p class="muted">Edits apply to this battle stage, including other formations that use it.</p><div data-body></div>`;
      document.body.append(d);this.dialog=d;const selected=ctx.catalog.activeContext(doc)?.stage;d.querySelector('[data-stage]').value=String(stages.includes(selected)?selected:stages[0]);
      d.querySelector('[data-stage]').onchange=()=>this.render();d.querySelector('[data-close]').onclick=()=>d.close();d.addEventListener('close',()=>d.remove(),{once:true});this.render();d.showModal();
    }catch(e){ctx.toast(`Pre-battle conditions: ${e.message}`,true);}
  }
  render(){
    const ctx=this.ctx,data=this.data,tables=ctx.tables(),texts=tables.texts,d=this.dialog,host=d.querySelector('[data-body]'),stage=Number(d.querySelector('[data-stage]').value),brief=data.read(stage),draft=new Map();
    const options=(prefix,width,count)=>Array.from({length:count},(_,id)=>({id,name:texts.get(`${prefix}${String(id).padStart(width,'0')}_NAME`)||`Message ${id}`}));
    const victories=options('VICTORYCONDITION_LC_VICTORY_CONDITION_',2,12),defeats=options('GAMEOVERCONDITION_LC_GAMEOVER_CONDITION_',3,9);victories[0].name=defeats[0].name='None';victories[3].name='Vanquish [named target]!';
    for(const list of[victories,defeats]){const id=list===victories?brief.victory:null;if(id!==null&&!list.some(x=>x.id===id))list.push({id,name:`Unmapped message ${id}`});}
    for(const id of brief.defeat)if(!defeats.some(x=>x.id===id))defeats.push({id,name:`Unmapped message ${id}`});
    const select=(attr,list,value)=>`<select ${attr}>${list.map(o=>`<option value="${o.id}" ${o.id===value?'selected':''}>${esc(o.name)}</option>`).join('')}</select>`;
    host.innerHTML=`<fieldset ${ctx.readOnly()?'disabled':''}><h3>Objectives and terms of defeat</h3><p class="conditions-note">These fields select the briefing messages; they do not rewrite the chapter rules above. Chapter tasks may override the messages during battle. Keep the objective enabled when using the game’s built-in battle-end checks.</p><label>Objective ${select('data-victory aria-label="Objective message"',victories,brief.victory)}</label><label data-target-label>Named objective target <span data-target></span></label><div class="conditions-defeats">${brief.defeat.map((v,i)=>`<label>Defeat line ${i+1} ${select(`data-defeat="${i}" aria-label="Defeat line ${i+1}"`,defeats,v)}</label>`).join('')}</div><h3>Bonus objectives</h3><p class="muted">These change the working bonus objectives and their rewards. The game selects up to three from the candidate pool when preparing the battle. Definitions are copied when needed so other battles keep their settings.</p><label>When ${select('data-variant aria-label="Bonus chapter variant"',[{id:-1,name:'All chapters (use the same pool)'},...chapters.map((name,id)=>({id,name}))],brief.pools.every(x=>x===brief.pools[0])?-1:0)}</label><label>Objectives shown <input data-draw aria-label="Objectives shown" type="number" min="0" max="3" step="1"></label><div data-bonuses></div><button type="button" data-add>Add bonus candidate</button><p class="muted">Choose 0 objectives shown to disable bonuses. Reward presets retain the game’s conditional reward behavior.</p><p data-error role="alert" class="error"></p><button type="button" data-apply>Apply conditions</button><p class="muted">Apply updates the open editor. Use the main Save button to write the changes.</p></fieldset>`;
    const $=q=>host.querySelector(q);let target=brief.target;
    const targets=battleRosterOptions(this.doc,tables,255);
    const picker=createPicker({options:targets,value:target,allowRaw:false,onChange:v=>target=Number(v)});picker.setAttribute('aria-label','Objective target');$('[data-target]').append(picker);if(!targets.some(o=>o.id===target)){picker.querySelector('.picker-name').textContent=tables.unitName(target)||`Stored target ${target}`;picker.title='The stored target is outside this battle roster. Only this battle’s characters are offered as replacements.';}
    const rulesHost=document.createElement('div');rulesHost.className='chapter-rules';host.prepend(rulesHost);this.rules.render(rulesHost,this.doc,stage);
    const targetVisibility=()=>$('[data-target-label]').hidden=Number($('[data-victory]').value)!==3;targetVisibility();$('[data-victory]').onchange=targetVisibility;
    const conditions=Array.from({length:data.tables[69].count-1},(_,i)=>({id:i+1,name:data.conditionText(i+1,texts)})).filter(o=>![12,15,16,70].includes(o.id));
    const rewards=Array.from({length:data.tables[70].count-1},(_,i)=>({id:i+1,name:data.rewardText(i+1,tables),art:async()=>{const r=data.tables[70].row(i+1);if(r[1]!==1)return null;const id=view(r).getUint16(2,true),t=data.dat.pakd.entries[id>=1000?13:11]?.data,n=id>=1000?id-1000:id;if(!t)return null;const table=parseXlce(t);if(n>=table.count)return null;const row=table.row(n),a=await itemIcon(view(row).getUint16(id>=1000?0x16:0x70,true),row[id>=1000?0x18:0x73]);return a.texture?textureCanvas(a.texture,.5):null;}}));
    const fromPool=id=>{const p=data.pool(id);return {draw:p.draw,entries:p.pairs.map(n=>({...data.pair(n)}))};};
    let variant=Number($('[data-variant]').value),pool=fromPool(brief.pools[Math.max(0,variant)]);draft.set(variant,pool);
    const renderBonuses=()=>{
      $('[data-draw]').value=pool.draw;const box=$('[data-bonuses]');box.replaceChildren();
      pool.entries.forEach((entry,i)=>{const row=document.createElement('div');row.className='condition-bonus-row';row.innerHTML=`<label>Objective ${i+1}<span data-condition></span></label><label>Reward<span data-reward></span></label><button type="button" class="ghost" aria-label="Remove bonus ${i+1}">Remove</button>`;
        const condition=createPicker({options:conditions,value:entry.condition,allowRaw:false,onChange:v=>entry.condition=Number(v)});condition.setAttribute('aria-label',`Bonus objective ${i+1}`);row.querySelector('[data-condition]').append(condition);
        const reward=createPicker({options:rewards,value:entry.reward,allowRaw:false,onChange:v=>entry.reward=Number(v)});reward.setAttribute('aria-label',`Bonus reward ${i+1}`);row.querySelector('[data-reward]').append(reward);
        row.querySelector('button.ghost').onclick=()=>{pool.entries.splice(i,1);pool.draw=Math.min(pool.draw,pool.entries.length);renderBonuses();};box.append(row);
      });$('[data-add]').disabled=pool.entries.length>=10;
    };renderBonuses();
    $('[data-draw]').oninput=e=>pool.draw=Number(e.target.value);
    $('[data-variant]').onchange=()=>{variant=Number($('[data-variant]').value);if(!draft.has(variant))draft.set(variant,fromPool(brief.pools[Math.max(0,variant)]));pool=draft.get(variant);renderBonuses();};
    $('[data-add]').onclick=()=>{pool.entries.push({condition:2,reward:1});pool.draw=Math.min(3,pool.entries.length);renderBonuses();};
    $('[data-apply]').onclick=async()=>{
      if(ctx.readOnly())return;const b=$('[data-apply]');b.disabled=true;$('[data-error]').textContent='';
      try{
        // Only apply the selected scope; chapter-specific drafts remain local until applied.
        const edits=(variant===-1?[0,1,2,3,4]:[variant]).map(v=>({variant:v,draw:pool.draw,entries:pool.entries.map(x=>({...x}))}));
        const changed=await data.apply(stage,{victory:Number($('[data-victory]').value),target,defeat:[...host.querySelectorAll('[data-defeat]')].map(e=>Number(e.value))},edits);
        if(changed){ctx.onChange();this.data=await loadConditions();ctx.toast('Pre-battle conditions updated. Use Save to write them.');}else ctx.toast('Conditions are unchanged.');this.render();
      }catch(e){$('[data-error]').textContent=e.message;b.disabled=false;}
    };
  }
}

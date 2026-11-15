import {afterScope,endingEvents,addEndingEvent,removeEndingEvent,noticeRecords,updateEndingRecruitment} from '../game/afterevents.js';
import {needsRecruitmentRepair,recruitmentCopy,recruitmentRow,recruitmentTarget,recruitNameId} from '../game/recruitment.js';
import {loadChapter,unitCopy,setUnitCopy} from '../game/cutscene.js';
import {noteCopy} from '../game/unitcopies.js';
import {createPicker} from '../ui/picker.js';
import {itemOptionArt} from '../ui/iconart.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names=(...values)=>[...new Set(values.filter(Boolean))].join(' / ');
export class AfterEventsPanel{
  constructor(owner){this.owner=owner;this.mode='battle';this.token=0;this.notices=[];}
  roster(){
    const sync=this.owner.ctx.sync,out=[];if(!sync)return out;
    for(const [id,d]of sync.characters())out.push({...d,key:String(id),label:sync.name(id)});
    for(const [id,d]of sync.specialForms())out.push({...d,key:id});
    return out.filter(d=>Number.isInteger(d.doc.number)).map(d=>({
      ...d,label:names(d.label,this.owner.characterName(recruitNameId(d.unit.row))),
    })).sort((a,b)=>a.label.localeCompare(b.label));
  }
  items(tables){
    return (tables?.lists.item ?? []).filter(o=>o.id).map(o=>({...o, art:()=>itemOptionArt(tables,o.id,this.owner.ctx.lang?.())}));
  }
  async render(host){
    const token=++this.token,o=this.owner,scene=o.scene;host.replaceChildren();if(!scene)return;
    try{
      const chapter=await loadChapter(scene.chapter);if(token!==this.token||o.scene!==scene)return;
      const record=o.storyRecord(),battle=afterScope(chapter,record,'battle');
      const mode=this.mode==='battle'&&battle.ends.length?'battle':'scene',scope=mode==='battle'?battle:afterScope(chapter,record,'scene');
      const roster=this.roster(),events=endingEvents(chapter,scope),tables=o.ctx.tables(),itemOptions=this.items(tables);
      const levelLimit=tables?.levelLimit??50;
      if(token!==this.token||o.scene!==scene)return;
      const groups=new Map();
      for(const e of events){const key=e.kind==='join'?`join:${e.type}:${e.file}:${e.character}`:`${e.kind}:${e.record[e.field]}:${e.field}:${e.kind==='item'?e.item:e.indices[0]}`;(groups.get(key)??groups.set(key,[]).get(key)).push(e);}
      const eventGroups=[...groups.values()];
      const targets=new Map(eventGroups.map(([event])=>[event,event.kind==='join'
        ?recruitmentTarget(unitCopy(scene,event.file),event.type,event.character):null]));
      const whoName=event=>{
        const row=targets.get(event)?.row;
        if(row){const name=recruitNameId(row);return names(tables?.unitName(name),o.characterName(name))||tables?.className(row[6])||`Unit row ${event.character}`;}
        return (event.type!==3&&o.characterName(event.character))||`Unit ${event.character}`;
      };
      const summary=e=>e.kind==='join'?`${whoName(e)} — ${e.type===4?'leaves (guest removed from the party)':e.type===1||e.type===13?'joins as a guest':'joins the army'}`:e.kind==='gold'?`${e.amount.toLocaleString()} Goth`:`${tables?.itemName(e.item)||`Item ${e.item}`} × ${e.quantity}`;
      const repairHint=e=>{
        const target=targets.get(e);
        if(!target)return '';
        if(target.param!==e.character||target.type!==e.type)return 'Recruit references the wrong unit template.';
        return needsRecruitmentRepair(target.row)?'Recruit needs an allied row and a fixed level.':'';
      };
      host.innerHTML=`<div class="cast-add after-events"><b>After events</b>
        <label>When <select data-timing aria-label="After-event timing"><option value="scene" ${mode==='scene'?'selected':''}>After this cutscene finishes</option>${battle.ends.length?`<option value="battle" ${mode==='battle'?'selected':''}>After battle — return to map</option>`:''}</select></label>
        <p class="muted">${mode==='battle'?'Runs on this battle’s recorded return to the world map or dungeon map, after its closing scene and existing recruitment decisions.':'Runs after every linked part of this cutscene, including its branches, before the next map transition.'} ${scope.ends.length>1?`${scope.ends.length} alternative ending routes are covered.`:''}</p>
        ${scope.reason?`<p class="hint warn">${esc(scope.reason)}</p>`:''}
        <b>Events on the ending path</b>${events.length?`<ul>${eventGroups.map((g,i)=>`<li>${esc(summary(g[0]))}${g.length>1?` <span class="muted">(${g.length} ending steps)</span>`:''} ${repairHint(g[0])?`<span class="hint warn">${repairHint(g[0])}</span> <button data-repair-recruit="${i}">Repair recruit…</button> `:''}<button class="ghost" data-remove-event="${i}" aria-label="Remove ${esc(summary(g[0]))}">Remove</button></li>`).join('')}</ul>`:'<p class="muted">No character joins, Goth or item rewards recorded on this path.</p>'}
        <hr><label>Event <select data-kind aria-label="After-event type"><option value="join">Character joins</option><option value="leave">Guest leaves the party</option><option value="gold">Give Goth</option><option value="item">Give item or equipment</option></select></label>
        <div data-fields="join"><label>Find character <input type="search" data-search-character placeholder="Name or class"></label><label>Character <select data-character aria-label="Joining character">${roster.map(d=>`<option value="${esc(d.key)}">${esc(d.label)}</option>`).join('')}</select></label>
        <label>How <select data-how aria-label="Recruitment type"><option value="army">Joins the army</option><option value="guest">Joins as a guest</option></select></label>
        <label>Level <input data-level aria-label="Joining level" type="number" min="1" max="${levelLimit}" value="1"></label>
        <p class="muted">The recruit joins your side at level 1 by default, with the selected class and equipment. To make someone appear during the scene, use the Cast tab.</p></div>
        <div data-fields="leave" hidden><label>Guest <select data-leaver aria-label="Leaving guest">${[...new Map(roster.filter(d=>/^\d+$/.test(d.key)).map(d=>[d.key,d])).values()].map(d=>`<option value="${esc(d.key)}">${esc(d.label)}</option>`).join('')}</select></label>
        <p class="muted">Takes this guest out of the party, the way the game's own guests leave (Lanselot's company after Almorica). It does nothing if they are not a guest at that point.</p></div>
        <div data-fields="gold" hidden><label>Goth <input data-gold aria-label="Goth reward" type="number" min="1" max="2147483647" step="1" value="1000"></label></div>
        <div data-fields="item" hidden><label>Find item <input type="search" data-search-item placeholder="Item or equipment name"></label><label>Item <select data-item aria-label="Reward item">${[false,true].map(consumable=>`<optgroup label="${consumable?'Items':'Equipment'}">${itemOptions.filter(x=>(x.id>=1000)===consumable).map(x=>`<option value="${x.id}">${esc(x.name)} (${x.id})</option>`).join('')}</optgroup>`).join('')}</select></label><label>Quantity <input data-quantity aria-label="Reward quantity" type="number" min="1" max="999" step="1" value="1"></label></div>
        <div data-fields-notice hidden><label title="The game shows these boxes from the scene itself, just before the scene part closes. Leave the text empty for the usual wording. Untick for a silent reward."><input type="checkbox" data-notice-on checked> Show a "You received" box</label>
        <label>Box text <input data-notice-text aria-label="Notice box text" placeholder="Automatic: You received ..."></label>
        <p class="muted">${noticeRecords(scope).some(r=>scene.parts.some(p=>p.entryId===r.scene))?'The box is added as the last step of the closing scene part; you can move, edit or delete it there like any step.':'This ending has no scene part to show the box in, so the reward will be silent.'}</p></div>
        <button data-add-event ${scope.ends.length?'':'disabled'}>Add after event</button><p class="muted">Use Save to write these changes with your cutscene edits.</p></div>`;
      const $=q=>host.querySelector(q);
      const nativeItem=$('[data-item]');nativeItem.classList.add('character-native-select');
      const rewardPicker=createPicker({options:itemOptions,value:Number(nativeItem.value),allowRaw:false,onChange:id=>{nativeItem.value=String(id);}});
      rewardPicker.setAttribute('aria-label','Reward item');nativeItem.after(rewardPicker);
      $('[data-search-item]').closest('label').remove();
      $('[data-timing]').onchange=e=>{this.mode=e.target.value;this.render(host);};
      $('[data-kind]').onchange=e=>{for(const n of host.querySelectorAll('[data-fields]'))n.hidden=n.dataset.fields!==e.target.value;$('[data-fields-notice]').hidden=!['gold','item'].includes(e.target.value);};
      for(const [search,select]of [['character','character']])$(`[data-search-${search}]`).oninput=e=>{
        const q=e.target.value.toLowerCase(),s=$(`[data-${select}]`);for(const opt of s.options)opt.hidden=!opt.text.toLowerCase().includes(q);
        if(s.selectedOptions[0]?.hidden)s.value=[...s.options].find(x=>!x.hidden)?.value??'';
      };
      for(const button of host.querySelectorAll('[data-repair-recruit]'))button.onclick=()=>{
        if(!o.guardEdit())return;
        const group=eventGroups[Number(button.dataset.repairRecruit)],event=group[0];
        const defaultLevel=targets.get(event).row[8]||1;
        const level=prompt(`Joining level for ${whoName(event)} (1–${levelLimit})`,String(defaultLevel));
        if(level===null)return;
        try{
          const table=unitCopy(scene,event.file).slice(),target=recruitmentTarget(table,event.type,event.character);
          target.row.set(recruitmentRow(target.row,{guest:target.type===1||target.type===13,level:Number(level),levelLimit}));
          if(target.param!==event.character||target.type!==event.type){
            updateEndingRecruitment(chapter,group,target.type,target.param);
            this.changed(chapter);
          }
          setUnitCopy(scene,event.file,table);
          o.edited.set(scene.fileName,scene);
          o.ctx.onChange();
          o.ctx.setStatus(`Repaired ${whoName(event)}’s recruitment. Save to keep the change.`);
          this.render(host);
        }catch(e){o.ctx.toast(e.message,true);}
      };
      for(const b of host.querySelectorAll('[data-remove-event]'))b.onclick=()=>{
        if(!o.guardEdit())return;try{
          // stock steps first (found by position), then steps added in this session (their removal shifts positions)
          for(const e of [...eventGroups[Number(b.dataset.removeEvent)]].sort((x,y)=>chapter.addedScenes.has(x.record.scene)-chapter.addedScenes.has(y.record.scene))){
            const task=e.kind==='join'?0:e.record[e.field];
            removeEndingEvent(chapter,e);
            // the notice boxes added with this reward in this session go with it
            for(const n of this.notices.filter(n=>task&&n.task===task&&n.chapter===chapter)){o.removeRewardNotice(n.part,n.msg);this.notices.splice(this.notices.indexOf(n),1);}
          }
          this.changed(chapter);this.render(host);}catch(e){o.ctx.toast(e.message,true);}
      };
      $('[data-add-event]').onclick=async()=>{
        if(!o.guardEdit())return;const button=$('[data-add-event]');button.disabled=true;
        try{
          const kind=$('[data-kind]').value;let event,shown=0;
          if(kind==='join'){
            const donor=roster.find(d=>d.key===$('[data-character]').value);if(!donor)throw new Error('Choose a character');
            const file=donor.doc.number,old=unitCopy(scene,file),table=old??donor.doc.dat.pakd.entries[0].data;
            const lv=$('[data-level]').value,result=recruitmentCopy(table,donor.unit.row,{guest:$('[data-how]').value==='guest',level:lv===''?undefined:Number(lv),levelLimit});
            event={kind,type:result.type,file,character:result.param};
            // Validate/link the ending first; copying the unit afterward cannot
            // leave a recruitment record pointing at an absent scene copy.
            addEndingEvent(chapter,scope,event);setUnitCopy(scene,file,result.table);noteCopy(file,scene.fileName);o.edited.set(scene.fileName,scene);
          }else if(kind==='leave'){
            const character=Number($('[data-leaver]').value);if(!character)throw new Error('Choose a guest');
            event={kind:'join',type:4,file:1,character};addEndingEvent(chapter,scope,event);
          }else{
            event=kind==='gold'?{kind,amount:Number($('[data-gold]').value)}:{kind,item:Number($('[data-item]').value),quantity:Number($('[data-quantity]').value)};
            const added=addEndingEvent(chapter,scope,event);
            if($('[data-notice-on]').checked){
              const text=$('[data-notice-text]').value.trim()||(kind==='gold'?`You received ${event.amount.toLocaleString('en-US')} goth.`:`You received ${tables?.itemName(event.item)||`item ${event.item}`}${event.quantity>1?` x${event.quantity}`:''}.`);
              const task=chapter.allRecords().find(r=>r.scene===added[0])?.task;
              const parts=[...new Set(noticeRecords(scope).map(r=>scene.parts.find(p=>p.entryId===r.scene)).filter(Boolean))];
              for(const part of parts){const msg=await o.addRewardNotice(part,text);this.notices.push({task,chapter,part,msg});}
              shown=parts.length;
            }
          }
          this.changed(chapter);o.ctx.setStatus(`Added ${kind==='join'?'recruitment':kind==='leave'?'guest departure':kind==='gold'?'Goth reward':'item reward'} ${mode==='battle'?'after battle':'at the end of the cutscene'}${kind==='gold'||kind==='item'?(shown?`, with a notice box at the end of ${shown===1?'the closing scene part':`${shown} closing scene parts`}`:' (silent: no notice box)'):''}`);this.render(host);
        }catch(e){o.ctx.toast(e.message,true);button.disabled=false;}
      };
    }catch(e){host.textContent=`After events: ${e.message}`;}
  }
  changed(chapter){this.owner.chapterFiles.add(chapter);this.owner.ctx.onChange();}
}

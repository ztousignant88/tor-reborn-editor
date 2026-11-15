import {loadDat,encodeDat}from '../game/datfile.js';
import {parsePakd,parseXlce,view}from '../lib/pakd.js';
import {planPspSpells,planPspReagents,pspReagentMode,restoredSpellCount,PSP_ICON_PATH,sameBytes}from '../game/pspspells.js';
import {pspSpellArtwork} from '../game/pspspellart.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BATTLE='battle/battle_data_release.dat',MENU='menu/menu_data.dat';
export class PspSpells{
 constructor(ed,recipe){this.ed=ed;this.recipe=recipe;this.pendingIcon=null;this.iconDat=null;this.busy=false;}
 static async load(ed){const r=await fetch('data/mods/psp-spells.json');if(!r.ok)throw new Error('PSP spell restoration data could not be loaded');return new PspSpells(ed,await r.json());}
 get count(){return restoredSpellCount(this.recipe,this.ed.dat);}
 get enabled(){const t=parseXlce(parsePakd(this.ed.dat.pack).entries[16].data);return this.count===this.recipe.spells.length&&this.recipe.spells.every(s=>view(t.row(s.id)).getUint16(8,true)>0)&&view(t.row(169)).getUint16(8,true)===this.recipe.petriburst.mp&&this.aiReady&&!!this.ed.menuMods?.value.pspSpellRuntime;}
 get aiReady(){const t=parseXlce(parsePakd(this.ed.dat.pack).entries[16].data);return (this.recipe.aiEligibility?.spellIds??[]).every(id=>t.row(id)[0x24]===0);}
 get dirty(){return !!this.pendingIcon;}
 saveFiles(){return this.pendingIcon?[this.pendingIcon]:[];}
 saved(){this.pendingIcon=null;this.iconDat=null;this.iconBaseline=null;}
 async setEnabled(enable){
  const ed=this.ed;
  if(!ed.menuMods?.info.project||ed.menuMods.saved?.error)throw new Error('Open a writable project to configure PSP spell restoration.');
  const paths=[...new Set(this.recipe.patches.map(p=>p.path))],dats=new Map(await Promise.all(paths.map(async path=>[path,path===BATTLE?ed.dat:path===MENU?ed.menu:ed.entryEdits.get(path)?.dat??await loadDat(path)])));
  this.iconDat??=await loadDat(PSP_ICON_PATH);this.iconBaseline??=this.iconDat.pack.slice();dats.set(PSP_ICON_PATH,this.iconDat);
  const waive = this.count === this.recipe.spells.length && pspReagentMode(this.recipe, ed.dat) === 'waived';
  const recipe = await pspSpellArtwork(this.recipe,this.iconDat.pack,async path=>{
    const response=await fetch(path);
    if(!response.ok)throw new Error('Missing spell illustration: '+path);
    return new Uint8Array(await response.arrayBuffer());
  });
  const states=planPspSpells(recipe,dats,enable,waive),icon=states.find(s=>s.path===PSP_ICON_PATH);let pending=this.pendingIcon;
  if(icon)pending=sameBytes(icon.after,this.iconBaseline)?null:{path:PSP_ICON_PATH,bytes:await encodeDat(icon.after,this.iconDat.entryName),originalSize:this.iconDat.originalSize,dat:this.iconDat};
  for(const s of states)if(!sameBytes(s.dat.pack,s.before))throw new Error('Game data changed while preparing the restoration. Try again.');
  for(const s of states){
   if(s.path===PSP_ICON_PATH){s.dat.pack=s.after;continue;}
   if(s.path!==BATTLE&&s.path!==MENU&&!ed.entryEdits.has(s.path))ed.entryEdits.set(s.path,{dat:s.dat,original:s.before});
   s.dat.pack.set(s.after);
   if(s.path!==BATTLE&&s.path!==MENU&&sameBytes(s.dat.pack,ed.entryEdits.get(s.path).original))ed.entryEdits.delete(s.path);
  }
  ed.menuMods.value.pspSpellRuntime=enable;
  this.pendingIcon=pending;return states.length;
 }
 render(detail,onChange){
  const ed=this.ed,count=this.count,early=this.recipe.spells.filter(s=>s.firstShop),disabled=this.busy||ed.ctx.readOnly?.()||!ed.menuMods?.info.project||!!ed.menuMods.saved?.error;
  const ready = count === this.recipe.spells.length;
  const reagentMode = ready ? pspReagentMode(this.recipe, ed.dat) : 'original';
  detail.innerHTML=`<div class="data-head"><div><h1>PSP spell restoration</h1><div class="meta">Integrated mod · ${count} / 58 restored spells present</div><p>Reintroduces the supported cut PSP spells into normal progression with their original caster classes, learning levels, MP and reagent costs, spellbook prices and town-specific shop tiers. Warriors keep their normal class permissions. No inventory, character stats or save files are changed.</p><p class="hint">Enable, then use the main Save button. Changes are saved with the open project; Apply project installs them for the next launch. The spell lists and artwork refresh on save. Recognised old zero-MP / Warrior spell-test data is migrated back to normal costs and caster permissions when enabled. Disable restores only the entries owned by this mod and refuses to discard conflicting custom edits.</p><div class="data-actions"><button data-enable ${disabled?'disabled':''}>${count===this.recipe.spells.length?'Update PSP spells':'Enable PSP spells'}</button><button data-disable ${disabled||!count?'disabled':''}>Disable PSP spells</button></div><p><label><input type="checkbox" data-waive-reagents ${reagentMode==='waived'?'checked':''} ${disabled||!ready?'disabled':''}> Cast restored spells without reagents</label></p><p class="hint">${ready?'MP costs still apply. Original spell descriptions may still mention reagents.':'Enable PSP spell restoration to change reagent costs.'}</p><p data-psp-status role="status"></p></div></div><div class="mod-details"><h3>Available at the first shop tier</h3><p>These ${early.length} original PSP spellbooks appear from shop tier 1, including Almorica. Buying a book still requires a caster with the listed class access and learning level to equip it.</p><table><thead><tr><th>Spell</th><th>MP</th><th>Goth</th><th>Example caster access</th></tr></thead><tbody>${early.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.mp}</td><td>${s.gold}</td><td>${s.classes.filter(c=>[3,4,5,15,16,17,53,55].includes(c.id)).map(c=>`${esc(c.name)} ${c.level}`).join(', ')||'Original special caster permissions'}</td></tr>`).join('')}</tbody></table><h3>Known limits</h3><p class="hint warn">Battle behavior is still experimental. Brimstone, Drain Power and Detect are excluded because their native TP / detection operations are missing. This mod adds no TP system. Dominate stays on its original carrier using a native carried-item drop slot, preserving all four existing ordinary drops. Phantom Pain returns to its original matched Lich carrier with Reborn's encounter scaling. These two adapted drops still need an in-game check; no replacement shop source is added. AI Plus handles the separate native status-spell AI problem.</p><details><summary>All restored spells and PSP costs</summary><table><thead><tr><th>Spell</th><th>MP</th><th>Goth</th><th>Acquisition</th></tr></thead><tbody>${this.recipe.spells.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.mp}</td><td>${s.gold??'—'}</td><td>${s.enemyOnly?'Enemy-only':s.shops?'Original town / shop tiers':'Original drops; see limits above'}</td></tr>`).join('')}</tbody></table></details></div>`;
  const reagents = detail.querySelector('[data-waive-reagents]');
  reagents.indeterminate = reagentMode === 'mixed';
  reagents.onchange = () => {
   if (this.busy || ed.ctx.readOnly?.() || !ready) return;
   const waive = reagents.checked;
   try {
    const staged = planPspReagents(this.recipe, ed.dat, waive);
    ed.dat.pack.set(staged);
    onChange();
    ed.ctx.setStatus(waive ? 'PSP reagent costs waived. Use Save.' : 'Original PSP reagent costs restored. Use Save.');
   } catch (error) {
    reagents.checked = reagentMode === 'waived';
    reagents.indeterminate = reagentMode === 'mixed';
    detail.querySelector('[data-psp-status]').textContent = error.message;
   }
  };
  for(const [selector,enable]of [['[data-enable]',true],['[data-disable]',false]])detail.querySelector(selector).onclick=async()=>{
   if(this.busy||ed.ctx.readOnly?.())return;
   this.busy=true;
   for(const b of detail.querySelectorAll('button'))b.disabled=true;
   try{
    const files=await this.setEnabled(enable);
    if(enable)ed.menuMods?.recommendPreparation();
    this.busy=false;
    onChange();
    ed.ctx.setStatus(`${enable?'Enabled':'Disabled'} PSP spell restoration in ${files} files. Use Save.`);
   }catch(e){
    detail.querySelector('[data-psp-status]').textContent=e.message;
    for(const b of detail.querySelectorAll('button'))b.disabled=false;
   }finally{this.busy=false;}
  };
 }
}

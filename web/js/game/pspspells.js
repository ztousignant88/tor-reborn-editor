// Compose a restoration with the current project; validate every target before
// committing anything. Unrelated tables, icon records and drop slots survive.
import {parsePakd,parseXlce,view}from '../lib/pakd.js';
import {parseArc,buildArc}from './artregistry.js';
import {isCustomIconId}from './customicons.js';
import {rebuildPakd}from '../lib/artrebuild.js';
export const PSP_ICON_PATH='menu/texture_x4/spell_icon.dat';
export const sameBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const hex=s=>Uint8Array.from(s.match(/../g)??[],n=>parseInt(n,16)),base64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function restoredSpellCount(recipe,dat){const table=parseXlce(parsePakd(dat.pack).entries[16].data);return recipe.spells.filter(s=>{const row=table.row(s.id);return (view(row).getUint16(0xaa,true)===s.id||isCustomIconId(view(row).getUint16(0xaa,true)))&&row[0xac]===1&&row[2]!==0;}).length;}
const BATTLE = 'battle/battle_data_release.dat';
const EFFECTS = 16;
const REAGENT = 0x0a;
const REAGENT_END = 0x0d;
const NO_REAGENT = new Uint8Array(REAGENT_END - REAGENT);

function reagentSpells(recipe) {
  const spells = new Set(recipe.spells.map(spell => spell.id));
  return recipe.patches.filter(patch =>
    patch.path === BATTLE && patch.entry === EFFECTS && patch.offset === 0 &&
    spells.has(patch.row) && hex(patch.after).subarray(REAGENT, REAGENT_END).some(Boolean));
}

function effectRows(pack) {
  return parseXlce(parsePakd(pack).entries[EFFECTS].data);
}

export function pspReagentMode(recipe, dat) {
  const effects = effectRows(dat.pack);
  const spells = reagentSpells(recipe);
  const waived = spells.filter(patch =>
    sameBytes(effects.row(patch.row).subarray(REAGENT, REAGENT_END), NO_REAGENT)).length;
  if (waived === 0) return 'original';
  return waived === spells.length ? 'waived' : 'mixed';
}

export function planPspReagents(recipe, dat, waive) {
  if (restoredSpellCount(recipe, dat) !== recipe.spells.length) {
    throw new Error('Enable PSP spell restoration before changing reagent costs.');
  }
  const staged = dat.pack.slice();
  const effects = effectRows(staged);
  for (const patch of reagentSpells(recipe)) {
    const original = hex(patch.after).subarray(REAGENT, REAGENT_END);
    const current = effects.row(patch.row).subarray(REAGENT, REAGENT_END);
    if (!sameBytes(current, original) && !sameBytes(current, NO_REAGENT)) {
      throw new Error(`${patch.label} has a custom reagent cost. Reagent costs were left unchanged.`);
    }
    current.set(waive ? NO_REAGENT : original);
  }
  return staged;
}

export function planPspSpells(recipe,dats,enable,waiveReagents=false){
 if(recipe.version!==1||recipe.spells.length!==58)throw new Error('Unsupported PSP restoration recipe');const staged=new Map(),effects=parseXlce(parsePakd(dats.get('battle/battle_data_release.dat').pack).entries[16].data),legacyTest=recipe.legacySignature?.every(s=>s.rows.some(row=>sameBytes(effects.row(s.id),hex(row))));
 const reagentIds = new Set(reagentSpells(recipe).map(patch => patch.row));
 for(const p of recipe.patches){
  const dat=dats.get(p.path);if(!dat)throw new Error('Missing restoration source: '+p.path);let state=staged.get(p.path);if(!state){state={path:p.path,dat,before:dat.pack.slice(),after:dat.pack.slice()};staged.set(p.path,state);}
  const entry=parsePakd(state.after).entries[p.entry];if(!entry)throw new Error('Missing PSP restoration table: '+p.path);const table=parseXlce(entry.data),before=hex(p.before),after=hex(p.after);if(p.row<0||p.row>=table.count||p.offset+before.length>table.rowSize||before.length!==after.length)throw new Error('PSP restoration layout changed: '+p.label);
  const row=table.row(p.row),current=row.subarray(p.offset,p.offset+before.length);
  let waived = after;
  if (p.path === BATTLE && p.entry === EFFECTS && p.offset === 0 && reagentIds.has(p.row)) {
    waived = after.slice();
    waived.set(NO_REAGENT, REAGENT);
  }
  let target = enable ? (waiveReagents ? waived : after) : before;
  let comparable = current;
  if (p.path === BATTLE && p.entry === EFFECTS && p.offset === 0 && row[0xac] === 1 &&
      isCustomIconId(view(row).getUint16(0xaa,true)) && after[0xac] === 1) {
    if (!enable) throw new Error(`${p.label} uses a custom icon. Restore its original icon before disabling PSP spell restoration.`);
    comparable = current.slice();
    comparable.set(after.subarray(0xaa,0xad),0xaa);
    target = target.slice();
    target.set(current.subarray(0xaa,0xad),0xaa);
  }
  if(!sameBytes(comparable,before)&&!sameBytes(comparable,after)&&!sameBytes(comparable,waived)&&!((!p.legacyOnly||legacyTest)&&(p.legacy??[]).some(s=>sameBytes(comparable,hex(s)))))throw new Error(`${p.label} has custom or conflicting edits in ${p.path}. The restoration was left unchanged. Keep those edits or use an unmodified entry before changing this mod.`);
  current.set(target);
 }
 const dat=dats.get(PSP_ICON_PATH);if(!dat)throw new Error('Missing spell icon archive');const pack=parsePakd(dat.pack),arc=parseArc(pack.entries[0].data),byName=new Map(arc.records.map(r=>[r.name,r])),owned=new Set(recipe.icons.map(r=>r.name));
 const updated = new Map();
 for (const icon of recipe.icons) {
  const current = byName.get(icon.name);
  const payload = base64(icon.payload);
  if (!current || sameBytes(current.payload, payload)) continue;
  if (!(icon.legacyPayloads ?? []).some(prior => sameBytes(current.payload, base64(prior))) &&
      !(icon.legacySHA256 ?? []).includes(icon.previousDigest)) {
   throw new Error(`Spell icon ${icon.name} has different custom art. No restoration changes were made.`);
  }
  updated.set(icon.name, {...current, payload});
 }
 const nextIdentifier = arc.records.reduce((next, record) => {
  const header = view(record.header), id = record.header[13] ? header.getUint32(16,true) : header.getUint16(4,true);
  return Math.max(next,id+1);
 },0);
 const records = enable
  ? [...arc.records.map(record => updated.get(record.name) ?? record),
     ...recipe.icons.filter(icon => !byName.has(icon.name)).map((icon,index) => {
      const header = base64(icon.header);
      view(header).setUint16(4,0,true);
      header[13]=1;
      view(header).setUint32(16,nextIdentifier+index,true);
      return {name: icon.name, header, payload: base64(icon.payload)};
     })]
  : arc.records.filter(record => !owned.has(record.name));
 if (records.length !== arc.records.length || (enable && updated.size)) {const after=rebuildPakd(dat.pack,new Map([[0,buildArc({...arc,records})]])),check=parseArc(parsePakd(after).entries[0].data);for(const r of arc.records)if(!owned.has(r.name)&&!sameBytes(check.records.find(c=>c.name===r.name)?.payload??[],r.payload))throw new Error('An unrelated spell icon changed');staged.set(PSP_ICON_PATH,{path:PSP_ICON_PATH,dat,before:dat.pack.slice(),after});}
 return [...staged.values()].filter(s=>!sameBytes(s.before,s.after));
}

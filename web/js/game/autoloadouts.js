import{parseXlce,view}from'../lib/pakd.js';
export function autoTables(dat){const table=(id,size)=>{const t=parseXlce(dat.pakd.entries[id].data);if(t.rowSize!==size)throw new Error('Unsupported automatic loadout table');return t;};return{equipment:table(11,152),presets:table(72,24),families:table(73,20)};}
const u16=(r,o)=>view(r).getUint16(o,true),valid=(n,max)=>Number.isInteger(n)&&n>=0&&n<=max;
export function readAutoPreset(dat,id){const t=autoTables(dat).presets;if(!valid(id,t.count-1))throw new Error('Invalid preset');const r=t.row(id);return{classId:r[0],profile:r[1],spells:Array.from({length:7},(_,i)=>u16(r,2+i*2)),categories:Array.from({length:4},(_,i)=>u16(r,16+i*2))};}
export function autoPresetRow(dat, id, draft) {
 const {presets,families}=autoTables(dat);
 const effects=parseXlce(dat.pakd.entries[16].data), classes=parseXlce(dat.pakd.entries[14].data);
 if(!valid(id,presets.count)||!id||!valid(draft.classId,Math.min(255,classes.count-1))||!draft.classId||!valid(draft.profile,255)||!draft.profile) {
  throw new Error('Choose a valid class and profile 1–255');
 }
 const symbols=new Set(Array.from({length:families.count},(_,n)=>u16(families.row(n),0)));
 if(!Array.isArray(draft.spells)||draft.spells.length!==7||draft.spells.some(n=>!valid(n,65535)||(n>=effects.count&&!symbols.has(n)))) {
  throw new Error('Choose valid spells or elemental families');
 }
 const categories=new Set([0]);
 for(let n=0;n<effects.count;n++)categories.add(u16(effects.row(n),164));
 if(!Array.isArray(draft.categories)||draft.categories.length!==4||draft.categories.some(n=>!categories.has(n))) {
  throw new Error('Choose valid fill categories');
 }
 for(let n=1;n<presets.count;n++){
  const row=presets.row(n);
  if(n!==id&&row[0]===draft.classId&&row[1]===draft.profile)throw new Error('That class and profile already has a preset');
 }
 const next=new Uint8Array(presets.rowSize);
 const data=view(next);
 next[0]=draft.classId;
 next[1]=draft.profile;
 draft.spells.forEach((n,i)=>data.setUint16(2+i*2,n,true));
 draft.categories.forEach((n,i)=>data.setUint16(16+i*2,n,true));
 return next;
}
export function applyAutoPreset(dat,id,draft){
 const {presets}=autoTables(dat);
 if(!valid(id,presets.count-1)||!id)throw new Error('Invalid preset');
 const row=presets.row(id);
 if(row.every(n=>n===0)&&draft.classId===0&&draft.profile===0&&draft.spells?.length===7&&draft.spells.every(n=>n===0)&&draft.categories?.length===4&&draft.categories.every(n=>n===0))return false;
 const next=autoPresetRow(dat,id,draft);
 const changed=next.some((n,i)=>n!==row[i]);
 row.set(next);
 return changed;
}
export function applyAutoEquipment(dat,changes){const t=autoTables(dat).equipment,entries=[...changes];for(const[id,d]of entries)if(!valid(id,t.count-1)||id===0||typeof d.allowed!=='boolean'||!valid(d.level,255))throw new Error('Equipment levels must be 0–255');let changed=0;for(const[id,d]of entries){const r=t.row(id);const flag=d.allowed?0:(r[14]||1);if(r[14]!==flag||r[96]!==d.level){r[14]=flag;r[96]=d.level;changed++;}}return changed;}
export function applyAutoFamily(dat,id,effects){const{families}=autoTables(dat),t=parseXlce(dat.pakd.entries[16].data);if(!valid(id,families.count-1)||!Array.isArray(effects)||effects.length!==9||effects.some(n=>!valid(n,t.count-1)))throw new Error('Choose valid spell effects for all nine elements');const r=families.row(id),next=r.slice();effects.forEach((n,i)=>view(next).setUint16(2+i*2,n,true));const changed=next.some((n,i)=>n!==r[i]);r.set(next);return changed;}

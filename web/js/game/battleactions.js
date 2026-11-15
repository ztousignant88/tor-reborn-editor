// Shared battle-body actions. Weapon overlays and Blade spell particles use
// separate renderers and are not substituted with invented artwork here.
import {parsePakd,parseXlce} from '../lib/pakd.js';
import {decompressAshg,isAshg} from '../lib/ashg.js';
import {loadDat} from './datfile.js';
import {battleData} from './battledata.js';
import {actorNames,readIndexSheet,readImagePalette} from './unitsprites.js';
import {parseBtx} from './bgscene.js';
import {poseGroup} from './actorposes.js';
import {parseActionSequence} from './sceneanimations.js';

let bankPromise;
const actorSheets=new Map(),resources=new Map();
const expand=b=>isAshg(b)?decompressAshg(b):b;
export const BODY_ACTION_NAMES={0:'Walk',8:'Winged flight',10:'Ready / idle loop',11:'Hurt',12:'Down',13:'Prone loop',14:'Stand up',15:'Fall down',16:'Incapacitated loop',20:'Neutral loop',21:'Slow walk',23:'Spell casting (Exorcism)',25:'Short casting motion',47:'Fist attack',51:'Dagger attack',54:'Sword attack',57:'Heavy swing',60:'Spear attack',69:'Katana attack',72:'Bow attack',75:'Crossbow attack',79:'Blowgun attack',80:'Sidearm attack',81:'Throwing attack',84:'Shield action',96:'Special movement',97:'Fast movement',98:'Slow movement',113:'Special idle loop',114:'Action 114',115:'Turn sequence',116:'Action 116'};

async function banks(){
  return bankPromise??=battleData().then(({dat})=>({
    sequences:parsePakd(dat.pakd.entries[0].data).entries,
    classes:parseXlce(dat.pakd.entries[14].data),misc:parsePakd(dat.pakd.entries[2].data).entries,
    weaponSprites:parsePakd(dat.pakd.entries[1].data).entries,
    weapons:parseXlce(dat.pakd.entries[11].data),motion:parseXlce(dat.pakd.entries[12].data),effects:parseXlce(dat.pakd.entries[16].data),
  }));
}

export async function loadBattleWeaponAction(weapon,variant=0){
  const b=await banks(),action=await weaponBodyAction(weapon,variant);
  if(action==null)return null;
  const row=b.weapons.row(weapon),sprite=new DataView(row.buffer,row.byteOffset,row.byteLength).getUint16(0x6c,true);
  const key=`weapon:${weapon}:${variant}:${action}:${sprite}:${row[0x72]}`;
  if(!resources.has(key))resources.set(key,(async()=>{
    if(!sprite||!b.weaponSprites[sprite])return null;
    const image=parsePakd(expand(b.weaponSprites[sprite].data)).entries[0].data;
    const palette=readImagePalette(b.weaponSprites[0].data,row[0x72]);
    if(!palette)throw new Error('missing equipment palette');
    const all=parseActionSequence(b.sequences[10].data,{battle:true}),slots=all.slots.slice(action*4,action*4+4);
    if(slots.length!==4||!slots.some(Boolean))return null;
    return {key,id:action,label:`Weapon ${weapon}`,image,palette,definition:{...all,slots,duration:Math.max(...slots.map(s=>s?.length??0))}};
  })());
  return resources.get(key);
}

export async function weaponBodyAction(weapon,variant=0){
  const b=await banks();
  if(!(weapon>0&&weapon<b.weapons.count))return null;
  const group=b.weapons.row(weapon)[0x66];
  return group<b.motion.count?b.motion.row(group)[variant]:null;
}

export async function bodyActionDurations(){
  const b=await banks(),all=parseActionSequence(b.sequences[0].data,{battle:true});
  return Array.from({length:Math.floor(all.slots.length/4)},(_,i)=>Math.max(0,...all.slots.slice(i*4,i*4+4).map(s=>s?.length??0)));
}

export async function weaponActionDurations(){
  const b=await banks(),body=parseActionSequence(b.sequences[0].data,{battle:true}),weapon=parseActionSequence(b.sequences[10].data,{battle:true});
  return Array.from({length:b.weapons.count},(_,i)=>{
    const group=b.weapons.row(i)[0x66],action=group<b.motion.count?b.motion.row(group)[0]:null;
    return action==null?0:Math.max(0,...[body,weapon].flatMap(d=>d.slots.slice(action*4,action*4+4).map(s=>s?.length??0)));
  });
}

export async function effectBodyActions(){
  const b=await banks();return Array.from({length:b.effects.count},(_,i)=>b.effects.row(i)[0x83]);
}

export async function effectBodyAction(effect){
  const b=await banks();return effect>=0&&effect<b.effects.count?b.effects.row(effect)[0x83]:null;
}

async function sheets(actor){
  if(!actorSheets.has(actor))actorSheets.set(actor,(async()=>{
    const name=(await actorNames())[actor-1];if(!name)return null;
    const {pakd}=await loadDat(`object/${name}.dat`);
    const images=pakd.entries.slice(0,2).map(e=>{
      const es=parsePakd(expand(e.data)).entries;
      return es.find(e=>readIndexSheet(e.data))?.data;
    });
    return {name,images};
  })());
  return actorSheets.get(actor);
}

export async function loadBattleBodyAction(actor,action){
  const key=`${actor}:${action}`;
  if(!resources.has(key))resources.set(key,(async()=>{
    const a=await sheets(actor);if(!a)return null;
    const b=await banks(),family=poseGroup(a.name),raw=b.sequences[family]?.data;
    if(!raw)return null;
    const all=parseActionSequence(raw,{battle:true}),slots=all.slots.slice(action*4,action*4+4);
    if(slots.length!==4||!slots.some(Boolean))return null;
    return {key:`body:${key}`,id:action,label:BODY_ACTION_NAMES[action]??`Body action ${action}`,
      images:a.images,definition:{...all,slots,duration:Math.max(0,...slots.map(s=>s?.length??0))}};
  })().catch(error=>{console.warn(`body action ${key}:`,error);return null;}));
  return resources.get(key);
}

// Innate attacks belong to classes, not to the weapon overlay bank. Prefer the
// native monster family when humanoid classes share its attack assignment.
export async function equipmentPreviewActor(weapon,fallback){
 const b=await banks(),r=b.weapons.row(weapon);if(r[2]!==30&&r[2]!==31)return fallback;
 const names=await actorNames(),candidates=[];
 for(let i=1;i<b.classes.count;i++){
  const c=b.classes.row(i),v=new DataView(c.buffer,c.byteOffset,c.byteLength);
  if(v.getUint16(0x4a,true)!==weapon&&v.getUint16(0x4c,true)!==weapon)continue;
  const actor=v.getUint16(0x90,true)||v.getUint16(0x92,true);
  if(actor&&names[actor-1])candidates.push({actor,monster:poseGroup(names[actor-1])>0});
 }
 return candidates.find(c=>c.monster)?.actor??candidates[0]?.actor??fallback;
}
export async function equipmentProjectile(row){
 const id=new DataView(row.buffer,row.byteOffset,row.byteLength).getUint16(0x6e,true);
 if(row[2]<17||row[2]>20||!id)return null;
 const b=await banks(),raw=b.misc[id]?.data;if(!raw)return null;
 return{id,texture:parseBtx(expand(raw),0),speed:Math.max(.1,row[0x68]/10),tracer:id===22};
}

// Preview-only battle state. Never insert these positions into scene scripts.
import { FIELD, readField } from './entryunit.js';
export function sceneBattleUses(scene, record, battles, catalog) {
  if (!record?.battleStage) return [];
  const id=scene.fileName.replace(/\.dat$/i,'');
  return battles.flatMap(doc=>catalog.battleContexts(doc).filter(c=>
    c.scene===id && c.stage===record.battleStage && c.mapNumber===record.map && c.storyStage===record.stage
  ).map(context=>({doc,context})));
}
export function battleStartActors(doc, lookFor, includeConditional = false) {
  const actors=new Map();
  for(const slot of doc?.unitSlots()??[]) {
    const row=doc.row(slot);
    const mode=readField(row,FIELD.appears);
    if(mode!==1&&!(includeConditional&&mode===2))continue; // never seed story-only additions
    // Script actor IDs are unit/template IDs (+2), not localized name IDs (+0).
    const actor=readField(row,FIELD.template);
    const key=actor&&!actors.has(actor)?actor:-(slot+1);
    actors.set(key,{x:readField(row,FIELD.x),y:readField(row,FIELD.z),dir:readField(row,FIELD.facing),
      visible:true,look:lookFor(doc,slot),battleSlot:slot,eventId:readField(row,FIELD.event),battleStart:true,conditional:mode===2});
  }
  return actors;
}
export function playerStartTiles(doc) {
  const out=[],seen=new Set();
  for(const slot of doc?.unitSlots()??[]) {
    const row=doc.row(slot);
    if(readField(row,FIELD.appears)!==1||readField(row,FIELD.team)!==1)continue;
    const x=readField(row,FIELD.x),y=readField(row,FIELD.z),key=`${x},${y}`;
    if(x<0||y<0||seen.has(key))continue;
    seen.add(key);out.push({x,y,guest:!!readField(row,FIELD.guest)});
  }
  return out;
}

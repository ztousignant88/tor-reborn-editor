import{view}from'../lib/pakd.js';
import{encodeInvocation}from'./scenetriggers.js';
export const EDITABLE_BATTLE_CHECKS=new Set([0x34,0x35,0x36,0x37,0x38,0x3c,0x3d]);
export function battleRosterOptions(doc,tables,maxId=65535){
 const units=new Map();for(const slot of doc?.unitSlots()??[]){const u=doc.units[slot],id=view(u.row).getUint16(0,true);if(!id||id===255||id>maxId||units.has(id))continue;units.set(id,{id,name:tables.unitName(id)||`Character ${id}`,look:()=>({actor:u.sprite[0],palette:tables.unitPalette(u.row)})});}return [...units.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function battleScriptScope(chapter,context){return chapter.allRecords().filter(r=>r.stage===context.storyStage&&(r.battleStage===context.stage||r.battleStage===0));}
export function outcomeOf(chapter,scope,root){
 const byScene=new Map();for(const r of scope){if(!byScene.has(r.scene))byScene.set(r.scene,[]);byScene.get(r.scene).push(r);}
 const walk=(r,seen)=>{
  if(r.nextOther)return new Set([r.nextOther===3?'defeat':[1,2,5].includes(r.nextOther)?'victory':'other']);
  if(seen.has(r.i))return new Set(['loop']);const set=new Set(seen);set.add(r.i);
  if(chapter.records[r.i][0x19]===4)return new Set(['guarded']);
  const next=byScene.get(r.nextScene);if(!r.nextScene||!next?.length)return new Set(['event']);
  return new Set(next.flatMap(n=>n.invk&&n.invk!==root.invk?['guarded']:[...walk(n,set)]));
 };
 const outcomes=walk(root,new Set());return outcomes.size===1&&outcomes.has('victory')?'victory':outcomes.size===1&&outcomes.has('defeat')?'defeat':'event';
}
export function battleScriptRules(chapter,context){
 const scope=battleScriptScope(chapter,context),out=[],seen=new Set();
 for(const r of scope){for(const trigger of chapter.triggers.entries.get(r.invk)??[]){
  if(![0,1,2,5,14].includes(trigger.group))continue;
  const key=`${r.invk}:${JSON.stringify([trigger.expression,...trigger.conditions])}`;if(seen.has(key))continue;seen.add(key);
  const checks=trigger.conditions.map((c,i)=>({...c,index:i})).filter(c=>EDITABLE_BATTLE_CHECKS.has(c.op)),outcome=outcomeOf(chapter,scope,r);
  if(!checks.length&&outcome==='event')continue;
  const groups=(chapter.triggers.entries.get(r.invk)??[]).filter(t=>JSON.stringify([t.expression,...t.conditions])===JSON.stringify([trigger.expression,...trigger.conditions])).map(t=>t.when);
  out.push({record:r,trigger,checks,outcome,groups:[...new Set(groups)]});
 }}return out.sort((a,b)=>({victory:0,defeat:1,event:2}[a.outcome]-{victory:0,defeat:1,event:2}[b.outcome])||a.record.scene-b.record.scene);
}
export function editBattleRule(chapter,context,rule,checks){
 const scope=battleScriptScope(chapter,context),record=scope.find(r=>r.i===rule.record.i&&r.invk===rule.record.invk);
 if(!record)throw new Error('This battle rule changed; reopen the panel');
 const commands=[rule.trigger.expression,...rule.trigger.conditions].map(c=>({op:c.op,args:[...c.args]}));
 if(checks.length!==rule.checks.length)throw new Error('Keep the same number of checks so the original AND/OR expression stays intact');
 checks.forEach((c,i)=>{if(!EDITABLE_BATTLE_CHECKS.has(c.op))throw new Error('Unsupported battle check');commands[rule.checks[i].index+1]={op:c.op,args:[...c.args]};});
 encodeInvocation(1,commands);if(JSON.stringify(commands)===JSON.stringify([rule.trigger.expression,...rule.trigger.conditions]))return false;
 const indices=new Set(scope.map(r=>r.i));
 const outside=chapter.allRecords().some(r=>!indices.has(r.i)&&(r.invk===record.invk||(chapter.records[r.i][0x19]===4&&view(chapter.records[r.i]).getUint16(0x1a,true)===record.invk)));
 if(outside)throw new Error('This check is shared with another recorded battle. Editing only this use is not supported.');
 chapter.invocationBank().replaceMirrors(record.invk,rule.trigger,commands);
 chapter.edited=true;chapter.refreshTriggers();return true;
}
export function addDefeatRule(chapter,context,character){
 if(!Number.isInteger(character)||character<1||character>65534||character===255)throw new Error('Choose a named unit from this battle');
 const scope=battleScriptScope(chapter,context);if(!scope.length)throw new Error('No chapter battle records for this selection');
 const source=battleScriptRules(chapter,context).find(r=>r.outcome==='victory')??battleScriptRules(chapter,context)[0];
 const guards=(source?.trigger.conditions??[]).filter(c=>c.op===0x30).map(c=>({op:c.op,args:[...c.args]}));
 const commands=[{op:0x60,args:[guards.length+1]},...guards,{op:0x37,args:[0,character]}];
 const bank=chapter.invocationBank(),scene=Math.max(bank.nextId()-1,...chapter.allRecords().flatMap(r=>[r.scene,r.nextScene]))+1,invk=scene;
 if(scene>=65535||invk>=65535)throw new Error('Chapter rule IDs are exhausted');encodeInvocation(invk,commands);
 const row=chapter.records[(source?.record??scope[0]).i].slice(),v=view(row);v.setUint16(4,scene,true);v.setUint16(6,invk,true);v.setUint16(8,0,true);v.setUint16(10,0,true);v.setUint16(12,0,true);v.setUint16(14,0,true);v.setUint16(0x10,context.stage,true);row[0x12]=0;row[0x13]=0;row.fill(0,0x16,0x1c);row[0x1e]=0;row[0x1f]=0;v.setUint16(0x20,0,true);v.setUint16(0x22,0,true);row[0x24]=3;
 bank.add(invk,2,commands);chapter.records.push(row);chapter.edited=true;chapter.refreshTriggers();return scene;
}

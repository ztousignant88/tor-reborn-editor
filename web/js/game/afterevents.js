// End-of-sequence events follow actual PGRS links, including conditional
// branches and later scripted parts. They never insert into scene bytecode.
import {view} from '../lib/pakd.js';
import {encodeTask,rewardTask} from './scenetasks.js';
export function afterScope(chapter,record,mode='scene'){
  if(!record)return {records:[],ends:[],reason:'This selection has no chapter story record.'};
  const all=chapter.allRecords(),same=all.filter(r=>r.stage===record.stage),seen=new Set(),records=[],ends=[];
  const walk=r=>{
    if(seen.has(r.i))return;seen.add(r.i);records.push(r);
    const next=!r.nextOther&&r.nextScene?same.filter(n=>n.scene===r.nextScene):[];
    if(!next.length){ends.push(r);return;}for(const n of next)walk(n);
  };
  if(mode==='battle'){
    const exits=same.filter(r=>r.battleStage===record.battleStage&&[1,2].includes(r.nextOther));
    if(!record.battleStage||!exits.length)return {records:[],ends:[],reason:'No recorded battle return to the world map or dungeon map was found for this selection.'};
    // Show the existing closing tasks/joins, without treating opening guests
    // and turn-triggered dialogue as post-battle recruitment.
    const back=r=>{if(seen.has(r.i))return;seen.add(r.i);records.push(r);if(r.flags&128)return;for(const p of same.filter(p=>p.nextScene===r.scene&&!p.nextOther))back(p);};
    for(const r of exits){ends.push(r);back(r);}
  }else for(const r of same.filter(r=>r.scene===record.scene))walk(r);
  const unique=[...new Map(ends.map(r=>[r.i,r])).values()];
  return {records,ends:unique,reason:unique.length?'':'The linked sequence has no terminal step (a loop or unsupported link).'};
}
export function endingEvents(chapter,scope){
  const out=[];
  for(const r of scope.records){
    if([1,2,3,4,13].includes(r.menuType))out.push({kind:'join',record:r,type:r.menuType,file:r.menuP1,character:r.menuP2});
    for(const field of ['task','extraTask']){
      let commands;try{commands=chapter.taskBank.commands(r[field]);}catch{continue;}
      const grouped=new Map();
      commands.forEach((c,i)=>{
        if(!c.kind)return;const key=c.kind==='item'?`item:${c.item}`:`gold:${i}`;
        if(!grouped.has(key))grouped.set(key,{...c,record:r,field,indices:[],quantity:0});
        const q=grouped.get(key);q.indices.push(i);q.quantity++;
      });out.push(...grouped.values());
    }
  }
  return out;
}
/**
 * The scripted parts a reward's notice box belongs in: the last scripted step
 * of each ending route (the game shows "You received ..." from the scene
 * script, native 268, just before the part closes).
 */
export function noticeRecords(scope){
  const byScene=new Map();for(const r of scope.records)(byScene.get(r.scene)??byScene.set(r.scene,[]).get(r.scene)).push(r);
  const later=(r,seen=new Set())=>{
    if(seen.has(r.i))return false;seen.add(r.i);
    return (r.nextScene&&!r.nextOther?byScene.get(r.nextScene)??[]:[]).some(n=>(n.flags&128)||later(n,seen));
  };
  return scope.records.filter(r=>(r.flags&128)&&!later(r));
}
export function addEndingEvent(chapter,scope,event){
  if(!scope.ends.length)throw new Error(scope.reason||'No ending was found');
  const refs=scope.ends.map(r=>chapter.records[r.i]);
  if(refs.some(r=>!r))throw new Error('The story changed; select the ending again');
  const ids=chapter.allRecords().flatMap(r=>[r.scene,r.nextScene]),first=Math.max(0,...ids)+1;
  if(first+refs.length-1>65535)throw new Error('Chapter scene ID space is full');
  let task=0;
  if(event.kind!=='join')task=chapter.taskBank.add(rewardTask(event));
  const added=[];
  refs.forEach((original,k)=>{
    const rec=original.slice(),v=view(rec),prev=view(original),id=first+k;
    v.setUint16(4,id,true);v.setUint16(6,0,true);v.setUint16(8,task,true);
    v.setUint16(12,0,true);v.setUint16(14,0,true);
    // A branch is decided by its original predecessor, once. The appended
    // step is unconditional and retains the outgoing link and map transition.
    rec.fill(0,0x16,0x1c);rec[0x1e]=0;rec[0x1f]=0;
    v.setUint16(0x20,0,true);v.setUint16(0x22,0,true);
    if(event.kind==='join'){rec[0x1f]=event.type;v.setUint16(0x20,event.file,true);v.setUint16(0x22,event.character,true);}
    original[0x24]=0;prev.setUint16(10,id,true);
    chapter.records.push(rec);chapter.addedScenes.add(id);added.push(id);
  });
  chapter.edited=true;return added;
}

/** Retarget a saved recruitment step, keeping its branch and ending links. */
export function updateEndingRecruitment(chapter,events,type,param){
  const rows=events.map(event=>chapter.records[event.record.i]);
  if(rows.some((row,i)=>!row||row[0x1f]!==events[i].type||view(row).getUint16(0x22,true)!==events[i].character)){
    throw new Error('The recruitment event changed. Select it again.');
  }
  for(const row of rows){row[0x1f]=type;view(row).setUint16(0x22,param,true);}
  chapter.edited=true;
}

export function removeEndingEvent(chapter,event){
  // A step added in this session goes entirely: the chain closes around it and its reward task is dropped.
  if(chapter.addedScenes.has(event.record.scene)){
    const task=event.kind==='join'?0:event.record[event.field];
    chapter.removeAddedStep(event.record.scene);if(task)chapter.taskBank.remove(task);
    chapter.edited=true;return;
  }
  const row=chapter.records[event.record.i];if(!row)throw new Error('The story changed; select the ending again');
  const v=view(row);
  if(event.kind==='join'){row[0x1f]=0;v.setUint16(0x20,0,true);v.setUint16(0x22,0,true);}
  else{
    const commands=chapter.taskBank.commands(event.record[event.field]),keep=commands.filter((_,i)=>!event.indices.includes(i));
    v.setUint16(event.field==='task'?8:12,keep.length?chapter.taskBank.add(encodeTask(keep.map(c=>c.raw))):0,true);
  }
  chapter.edited=true;
}

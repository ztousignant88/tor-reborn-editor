// Native briefing and bonus tables, verified against PC 1.0.2 readers.
// Briefing text is separate from chapter INVK/TASK victory/defeat logic.
import {parseXlce,view} from '../lib/pakd.js';
import {battleData,replaceBattleTables} from './battledata.js';
export const CONDITION_TABLES={stage:17,pool:67,pair:68,condition:69,reward:70};
const sizes={17:230,67:22,68:2,69:8,70:12};
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const int=(n,lo,hi,label)=>{if(!Number.isInteger(n)||n<lo||n>hi)throw new Error(`${label} must be between ${lo} and ${hi}.`);return n;};
export class ConditionsData{
  constructor(dat){this.dat=dat;this.tables={};for(const [i,size]of Object.entries(sizes)){const t=parseXlce(dat.pakd.entries[i].data);if(t.rowSize!==size)throw new Error(`Unsupported conditions table ${i}`);this.tables[i]=t;}}
  stage(id){int(id,1,this.tables[17].count-1,'Battle stage');return this.tables[17].row(id);}
  read(id){const r=this.stage(id),v=view(r);return {victory:r[4],target:r[5],defeat:[0x4e,0x50,0x52].map(at=>r[at]),pools:Array.from({length:5},(_,i)=>v.getUint16(0x30+i*2,true))};}
  pool(id){int(id,0,this.tables[67].count-1,'Bonus pool');if(id===0)return {id,draw:0,pairs:[]};const r=this.tables[67].row(id),v=view(r);return {id,draw:r[0],pairs:Array.from({length:10},(_,i)=>v.getUint16(2+i*2,true)).filter(Boolean)};}
  pair(id){int(id,0,this.tables[68].count-1,'Bonus pairing');const r=this.tables[68].row(id);if(r[0]>=this.tables[69].count||r[1]>=this.tables[70].count)throw new Error(`Invalid bonus pairing ${id}`);return {condition:r[0],reward:r[1]};}
  conditionText(id,texts){const r=this.tables[69].row(id),n=view(r).getUint16(6,true);let text=texts.get(`BATTLETASK_LC_BTL_TSK${String(n*10).padStart(4,'0')}_NAME`)||`Unmapped condition ${id}`;if(n===59)text=`Deal ${view(r).getUint16(2,true).toLocaleString()} or more damage with a single action.`;if(id>=62&&id<=69)text+=` (door ${view(r).getUint16(2,true)})`;return text;}
  rewardText(id,tables){const r=this.tables[70].row(id),v=view(r),one=(at,item,qty)=>r[at]===1?`${tables.itemName(v.getUint16(item,true))||`Item ${v.getUint16(item,true)}`} × ${v.getUint16(qty,true)}`:r[at]===2?`${v.getUint16(item,true).toLocaleString()} Goth`:'No reward';return one(1,2,4)+(r[0]&&r[6]?` (alternate: ${one(6,8,10)})`:'');}
  // Copy shared definitions on change. Never overwrite another battle's pool.
  async apply(stage,briefing,edits){
    const oldStage=this.stage(stage),r=oldStage.slice(),v=view(r),replacements=new Map();
    r[4]=int(briefing.victory,0,255,'Objective');r[5]=int(briefing.target,0,255,'Objective target');
    [0x4e,0x50,0x52].forEach((at,i)=>{r[at]=int(briefing.defeat[i],0,255,'Defeat message');});
    const work=new Map();
    const rows=n=>{if(!work.has(n))work.set(n,Array.from({length:this.tables[n].count},(_,i)=>this.tables[n].row(i).slice()));return work.get(n);};
    const intern=(n,row,limit)=>{const list=rows(n),found=list.findIndex(x=>equal(x,row));if(found>=0)return found;if(list.length>limit)throw new Error('The bonus definition ID space is full.');list.push(row);return list.length-1;};
    // Bonus completion flags use the pairing ID as a bit index in saved state.
    // Keep IDs inside the original 640-slot range; never grow that table.
    const usedPairs=new Set();for(let n=1;n<this.tables[17].count;n++)for(const id of this.read(n).pools)if(id)for(const pair of this.pool(id).pairs)usedPairs.add(pair);
    const freePairs=Array.from({length:Math.min(640,this.tables[68].count)-1},(_,i)=>i+1).filter(i=>!usedPairs.has(i)),allocated=new Map();
    const changedRows=(n,list)=>list.length!==this.tables[n].count||list.some((row,i)=>!equal(row,this.tables[n].row(i)));
    for(const edit of edits){
      int(edit.variant,0,4,'Chapter variant');int(edit.entries.length,0,10,'Bonus candidate count');int(edit.draw,0,3,'Bonus draw count');
      if(edit.draw>3)throw new Error('Use at most three displayed bonus objectives.');
      const current=this.pool(view(oldStage).getUint16(0x30+edit.variant*2,true));
      const sameEntry=(id,x)=>{const p=this.pair(id);return p.condition===x.condition&&p.reward===x.reward;};
      if(edit.draw===current.draw&&edit.entries.length===current.pairs.length&&edit.entries.every((x,i)=>sameEntry(current.pairs[i],x)))continue;
      const pool=new Uint8Array(22),pv=view(pool);pool[0]=edit.draw;
      edit.entries.forEach((x,i)=>{int(x.condition,1,Math.min(255,this.tables[69].count-1),'Condition');int(x.reward,1,Math.min(255,this.tables[70].count-1),'Reward');const key=`${x.condition}:${x.reward}`;let pair=current.pairs.find(id=>sameEntry(id,x))??allocated.get(key);
        if(pair===undefined){pair=freePairs.shift();if(pair===undefined)throw new Error('No unused bonus pairing slots remain. Existing battles and the save’s completion-flag limit are preserved.');rows(68)[pair]=Uint8Array.of(x.condition,x.reward);allocated.set(key,pair);}
        pv.setUint16(2+i*2,pair,true);});
      v.setUint16(0x30+edit.variant*2,(edit.draw===0&&!edit.entries.length?0:intern(67,pool,65535)),true);
    }
    if(equal(r,oldStage)&&![...work].some(([n,rs])=>changedRows(n,rs)))return false;
    const stageBytes=this.dat.pakd.entries[17].data.slice(),head=view(stageBytes).getUint32(8,true);stageBytes.set(r,head+stage*230);replacements.set(17,stageBytes);
    for(const [n,list]of work){if(!changedRows(n,list))continue;const old=this.dat.pakd.entries[n].data,h=view(old).getUint32(8,true),out=new Uint8Array((h+list.length*sizes[n]+15)&~15);out.set(old.subarray(0,h));view(out).setUint32(4,list.length,true);list.forEach((row,i)=>out.set(row,h+i*sizes[n]));replacements.set(n,out);}
    await replaceBattleTables(replacements);return true;
  }
}
export async function loadConditions(){return new ConditionsData((await battleData()).dat);}

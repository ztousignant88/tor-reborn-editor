// Reborn chapter TASK bytecode. Operand widths follow the local Asvel and
// Gibbed screenplay descriptions. Existing task payloads are kept verbatim.
import {view} from '../lib/pakd.js';
const align4=n=>(n+3)&~3;
const sizes=[0,3,3,2,1,4,1,1,1,1,1,1,1,1,1,3,2,3,2,1,2,4,2,1,0,1,1,3,1,2,0,3,2,1,1,2,2,1,1,3,3];
export function taskCommands(bytes){
  const out=[],v=view(bytes);let at=0;
  while(at+2<=bytes.length){
    const start=at,op=v.getUint16(at,true);at+=2;if(op===0xffff)return out;
    const size=op>=0x29&&op<=0x2f?0:sizes[op];
    if(size===undefined||at+size>bytes.length)throw new Error(`Unsupported chapter task opcode ${op}`);
    const args=bytes.slice(at,at+size);at+=size;
    out.push({op,args,raw:bytes.slice(start,at),...(op===5?{kind:'gold',amount:view(args).getInt32(0,true)}:op===0x14?{kind:'item',item:view(args).getUint16(0,true)}:{})});
  }
  throw new Error('Chapter task has no terminator');
}
export const encodeTask=commands=>{
  const out=new Uint8Array(commands.reduce((n,c)=>n+c.length,2));let at=0;
  for(const c of commands){out.set(c,at);at+=c.length;}view(out).setUint16(at,0xffff,true);return out;
};
export function rewardTask({kind,amount,item,quantity=1}){
  if(kind==='gold'){
    if(!Number.isInteger(amount)||amount<1||amount>0x7fffffff)throw new Error('Enter a whole Goth amount between 1 and 2147483647.');
    const raw=new Uint8Array(6),v=view(raw);v.setUint16(0,5,true);v.setInt32(2,amount,true);return encodeTask([raw]);
  }
  if(kind==='item'){
    if(!Number.isInteger(item)||item<1||item>65535||!Number.isInteger(quantity)||quantity<1||quantity>999)throw new Error('Choose an item and a quantity between 1 and 999.');
    const raw=new Uint8Array(4),v=view(raw);v.setUint16(0,0x14,true);v.setUint16(2,item,true);return encodeTask(Array.from({length:quantity},()=>raw));
  }
  throw new Error('Unknown reward type');
}
export class SceneTasks{
  constructor(bytes){
    this.original=bytes;this.entries=new Map();this.dirty=false;
    const v=view(bytes);if(v.getUint32(0,true)!==0x4b534154)throw new Error('Missing chapter TASK bank');
    const count=v.getUint16(4,true),offsetTable=align4(8+count*2);
    if(offsetTable+count*4>bytes.length)throw new Error('Truncated chapter TASK index');
    const offsets=Array.from({length:count},(_,i)=>v.getUint32(offsetTable+i*4,true));
    for(let i=0;i<count;i++){
      const id=v.getUint16(8+i*2,true),start=offsets[i],end=Math.min(bytes.length,...offsets.filter(n=>n>start));
      if(start<offsetTable+count*4||start>=bytes.length||this.entries.has(id))throw new Error('Invalid chapter TASK offset or ID');
      this.entries.set(id,bytes.slice(start,end));
    }
  }
  add(bytes){
    taskCommands(bytes);const id=Math.max(0,...this.entries.keys())+1;if(id>65535)throw new Error('Chapter task ID space is full');
    this.entries.set(id,bytes.slice());this.dirty=true;return id;
  }
  /** Take back a task added with add() (undo). */
  remove(id){this.entries.delete(id);}
  commands(id){return id?taskCommands(this.entries.get(id)??new Uint8Array()):[];}
  build(){
    if(!this.dirty)return this.original;
    const rows=[...this.entries].sort((a,b)=>a[0]-b[0]),offsetTable=align4(8+rows.length*2),head=offsetTable+rows.length*4;
    const out=new Uint8Array(align4(head+rows.reduce((n,[,b])=>n+align4(b.length),0))),v=view(out);
    out.set(this.original.subarray(0,8));v.setUint16(4,rows.length,true);let at=head;
    rows.forEach(([id,b],i)=>{v.setUint16(8+i*2,id,true);v.setUint32(offsetTable+i*4,at,true);out.set(b,at);at+=align4(b.length);});return out;
  }
}

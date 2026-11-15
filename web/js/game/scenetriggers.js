// Chapter INVK records. Read-only: layouts follow Asvel's ExtractScreenplay.
// Keep expression and predicates separate: OR expressions must not become ANDs.
import { view } from '../lib/pakd.js';
const FORMATS = {
  0:'',1:'HB',2:'HB',3:'Bb',4:'B',5:'HH',6:'B',7:'b',8:'b',9:'b',10:'b',11:'b',12:'b',13:'B',14:'B',15:'HB',16:'Bb',17:'HB',18:'H',19:'B',20:'H',21:'HH',22:'H',23:'B',24:'',25:'B',26:'B',27:'HB',28:'B',29:'BB',30:'',31:'BBB',32:'H',33:'B',34:'B',35:'H',36:'H',37:'B',38:'B',39:'HB',40:'HB',
  0x30:'HBB',0x31:'HBB',0x32:'BB',0x33:'BH',0x34:'BB',0x35:'BBH',0x36:'BBH',0x37:'HH',0x38:'BBH',0x39:'BBH',0x3a:'BBH',0x3b:'BBBH',0x3c:'HH',0x3d:'BBH',0x3e:'BH',0x3f:'BB',0x40:'BB',0x41:'BB',0x42:'BBH',0x43:'BBH',0x44:'HBB',0x45:'HBB',0x46:'BB',0x47:'BBB',0x48:'BBB',0x49:'BBH',0x4a:'BBH',0x4b:'BH',0x4c:'BH',0x4d:'BB',0x4e:'BH',0x4f:'BB',0x50:'BH',0x51:'BH',0x52:'BB',0x53:'BH',0x54:'BB',0x55:'HBB',0x56:'BB',
};
const GROUPS = ['Story chain','Unit turn start','Action end','Enter location','Leave location','Unit turn end','Leave shop','Leave Warren Report','Event group 8','Event group 9','Event group 10','Event group 11','Event group 12','Event group 13','Unit died','Warren Report call'];
const OPS = ['=','≠','<','≤','>','≥'];
export function parseSceneTriggers(data) {
  const entries = new Map(), errors = [];
  if (!data) return { entries, errors };
  const v = view(data);
  const need = (o,n) => { if (o<0 || o+n>data.length) throw new Error('truncated INVK'); };
  try {
    need(0,8); if (v.getUint32(0,true)!==0x4b564e49) throw new Error('not INVK');
    const groups=v.getUint16(4,true); need(8,groups*4);
    for(let group=0;group<groups;group++) {
      let o=v.getUint32(8+group*4,true);
      try {
        need(o,2); const count=v.getUint16(o,true);o+=2;
        for(let j=0;j<count;j++) {
          need(o,2);const start=o,id=v.getUint16(o,true);o+=2; const commands=[];
          for(;;) {
            need(o,2);const op=v.getInt16(o,true);o+=2;if(op===-1)break;
            const fmt=op>=0x60&&op<=0x71?'B':FORMATS[op];
            if(fmt===undefined)throw new Error(`unknown INVK operation ${op}`);
            const args=[];
            for(const f of fmt) {const n=f==='H'?2:1;need(o,n);args.push(f==='H'?v.getUint16(o,true):f==='b'?v.getInt8(o):data[o]);o+=n;}
            commands.push({op,args});
          }
          if(!entries.has(id))entries.set(id,[]);
          entries.get(id).push({id,offset:start,raw:data.slice(start,o),group,when:GROUPS[group]??`Event group ${group}`,expression:commands[0],conditions:commands.slice(1)});
        }
      }catch(e){errors.push({group,error:e.message});} // don't guess the length of an unknown operation
    }
  }catch(e){errors.push({error:e.message});}
  return {entries,errors};
}
export function triggerSummary(triggers, name=(id)=>`Character ${id}`) {
  return (triggers??[]).map(t=>{
    const actor=t.conditions.find(c=>c.op===0x33&&c.args[0]===0)?.args[1];
    const dead=t.conditions.find(c=>c.op===0x37&&c.args[0]===0)?.args[1];
    return `${t.when}${actor!==undefined?` · ${name(actor)}`:''}${dead!==undefined?` · ${name(dead)} defeated`:''}`;
  }).join(' / ');
}
export function triggerDetails(triggers) {
  return (triggers??[]).map(t=>[t.when,`Condition expression 0x${t.expression?.op.toString(16)} (${t.expression?.args.join(', ')})`,...t.conditions.map(({op,args:a})=>{
    if(op===0x30||op===0x31)return `${op===0x30?'Global':'Local'} flag ${a[0]} ${OPS[a[1]]??`operator ${a[1]}`} ${a[2]}`;
    if(op===0x33)return `Current unit ${OPS[a[0]]??a[0]} character ${a[1]}`;
    return `0x${op.toString(16)} (${a.join(', ')})`;
  })].join('\n')).join('\n\n');
}


/** Mutable INVK bank. Original entries and boolean expressions remain intact. */
export class InvocationBank {
  constructor(bytes){
    this.original=bytes;this.parsed=parseSceneTriggers(bytes);this.dirty=false;
    if(this.parsed.errors.length)throw new Error('Chapter invocation bank contains unsupported data; editing is disabled.');
    this.groups=Array.from({length:view(bytes).getUint16(4,true)},()=>[]);
    for(const entries of this.parsed.entries.values())for(const e of entries)this.groups[e.group].push(e);
    for(const g of this.groups)g.sort((a,b)=>a.offset-b.offset);
  }
  nextId(){return Math.max(0,...this.groups.flat().map(e=>e.id))+1;}
  add(id,group,commands){
    if(!Number.isInteger(id)||id<1||id>=65535||this.groups.flat().some(e=>e.id===id))throw new Error('No free chapter invocation ID.');
    const raw=encodeInvocation(id,commands);if(!this.groups[group])throw new Error('Invalid invocation group');
    this.groups[group].push({id,group,raw,expression:commands[0],conditions:commands.slice(1)});this.dirty=true;
  }
  /** Take back an invocation added with add() (undo). */
  remove(id){for(let i=0;i<this.groups.length;i++)this.groups[i]=this.groups[i].filter(e=>e.id!==id||e.offset!==undefined);}
  replaceMirrors(id,source,commands){
    const sig=JSON.stringify([source.expression,...source.conditions]),raw=encodeInvocation(id,commands),matches=this.groups.flat().filter(e=>e.id===id&&JSON.stringify([e.expression,...e.conditions])===sig);
    if(!matches.length)throw new Error('The rule changed; reopen the conditions panel');
    for(const e of matches){e.raw=raw.slice();e.expression=commands[0];e.conditions=commands.slice(1);}this.dirty=true;
  }

  build(){
    if(!this.dirty)return this.original;
    const align=n=>(n+3)&~3,head=align(8+this.groups.length*4),parts=this.groups.map(g=>{const out=new Uint8Array(2+g.reduce((n,e)=>n+e.raw.length,0));view(out).setUint16(0,g.length,true);let at=2;for(const e of g){out.set(e.raw,at);at+=e.raw.length;}return out;});
    const out=new Uint8Array(head+parts.reduce((n,p)=>n+align(p.length),0)),v=view(out);out.set(this.original.subarray(0,8));let at=head;
    parts.forEach((p,i)=>{v.setUint32(8+i*4,at,true);out.set(p,at);at+=align(p.length);});return out;
  }
}
export function encodeInvocation(id,commands){
  const parts=commands.map(c=>{const fmt=c.op>=0x60&&c.op<=0x71?'B':FORMATS[c.op];if(fmt===undefined||c.args.length!==fmt.length)throw new Error('Invalid condition operands');const out=new Uint8Array(2+[...fmt].reduce((n,f)=>n+(f==='H'?2:1),0)),v=view(out);v.setUint16(0,c.op,true);let at=2;[...fmt].forEach((f,i)=>{const x=c.args[i],lo=f==='b'?-128:0,hi=f==='H'?65535:f==='b'?127:255;if(!Number.isInteger(x)||x<lo||x>hi)throw new Error('Condition operand is out of range');if(f==='H')v.setUint16(at,x,true);else if(f==='b')v.setInt8(at,x);else out[at]=x;at+=f==='H'?2:1;});return out;});
  const out=new Uint8Array(4+parts.reduce((n,p)=>n+p.length,0));view(out).setUint16(0,id,true);let at=2;for(const p of parts){out.set(p,at);at+=p.length;}view(out).setUint16(at,65535,true);return out;
}

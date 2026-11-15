// Visibility: WarrenReport.dat INVK banks 11..19. Read actions: matching TASK
// banks 20..28. Preserve rule IDs/order: native list builders consume rules in
// table order (RVA 488230 / 4884e0), not just by their numeric IDs.
import{InvocationBank,encodeInvocation}from'./scenetriggers.js';
import{SceneTasks,encodeTask,taskCommands}from'./scenetasks.js';
import{parseXlce,view,buildPakd}from'../lib/pakd.js';
import{loadDat,encodeDat}from'./datfile.js';
const BANKS={1:1,2:5,3:4,4:3,5:2,6:7,7:9,8:8};
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export function flagLabel(id){
 if(id>=0x23b&&id<=0x2da)return`People group ${id-0x23a} state`;
 if(id>=0x2db&&id<=0x3ac)return`Current Affairs ${id-0x2da} available`;
 if(id>=0x3ad&&id<=0x46a)return`Talk ${id-0x3ac} available`;
 if(id>=0x49b&&id<=0x549)return`Battle ${id-0x49a} story flag`;
 const names={0x47e:'Chapter 1 progress',0x47f:'Chapter 2 Chaos progress',0x480:'Chapter 2 Law progress',0x481:'Chapter 3 Neutral progress',0x482:'Chapter 3 Chaos progress',0x483:'Chapter 3 Law progress',0x485:'Chapter 4 progress',0x6a3:'Current chapter',0x783:'Phorampa notice read',0x784:'Phorampa opened',0x71b:'Talk 178 read',0x71c:'Talk 179 read'};
 return names[id]??`Global flag ${id}`;
}
export class WarrenRules{
 static async load(report){const event=await loadDat('event/event_data.dat');return new WarrenRules(report,event);}
 constructor(report,event){this.report=report;this.dat=report.files[0];this.flagTable=parseXlce(event.pakd.entries[3].data);this.banks=new Map();for(const bank of Object.values(BANKS))if(!this.banks.has(bank))this.banks.set(bank,{invk:new InvocationBank(this.dat.pakd.entries[10+bank].data),tasks:new SceneTasks(this.dat.pakd.entries[19+bank].data)});this.changedTasks=new Set();}
 flagMax(id){if(!Number.isInteger(id)||id<1||id>=this.flagTable.count)throw new Error('Choose an existing global flag ID.');const type=view(this.flagTable.row(id)).getUint16(0,true)&15;const max={1:1,2:15,3:255,4:65535}[type];if(max===undefined)throw new Error('This flag has no supported storage definition.');return max;}
 rule(section,entry){const bank=BANKS[section];if(!bank)return null;let id=entry.id;if(section===1){const row=parseXlce(this.dat.pakd.entries[3].data).row(entry.id),v=view(row);id=(v.getUint16(2,true)<<4)|v.getUint16(0,true);}const b=this.banks.get(bank),triggers=b.invk.groups.flat().filter(t=>t.id===id);return triggers.length?{bank,id,triggers,readActions:[2,3,4,5,6,7,8].includes(section)}:null;}
 validateCheck(c){if(c.op===0x30){const[id,op,value]=c.args;this.flagMax(id);if(!Number.isInteger(op)||op<0||op>5||!Number.isInteger(value)||value<0||value>255)throw new Error('Flag comparisons require an operator and a value from 0 to 255.');}else if(c.op===0x53){if(![0,1].includes(c.args[0])||!Number.isInteger(c.args[1])||c.args[1]<1||c.args[1]>65534||c.args[1]===255)throw new Error('Choose a character and whether they must be in the army.');}}
 setRule(rule,index,expression,conditions){const b=this.banks.get(rule.bank),source=b.invk.groups.flat().filter(t=>t.id===rule.id)[index];if(!source)throw new Error('Reopen this report entry.');conditions.forEach(c=>this.validateCheck(c));const commands=[expression,...conditions];encodeInvocation(rule.id,commands);if(JSON.stringify(commands)===JSON.stringify([source.expression,...source.conditions]))return false;b.invk.replaceMirrors(rule.id,source,commands);return true;}
 actions(rule){const bank=this.banks.get(rule.bank);return bank.tasks.entries.has(rule.id)?bank.tasks.commands(rule.id):[];}
 setActions(rule,commands){if(!rule.readActions)throw new Error('Read actions are not mapped for this section.');const raw=encodeTask(commands.map(c=>{if(c.op===1||c.op===0x28){const[id,value]=c.args,max=this.flagMax(id);if(!Number.isInteger(value)||value<0||value>Math.min(255,max))throw new Error(`This flag stores values from 0 to ${Math.min(255,max)}.`);const b=new Uint8Array(5),v=view(b);v.setUint16(0,c.op,true);v.setUint16(2,id,true);b[4]=value;return b;}if(!c.raw)throw new Error('Unsupported read action.');return c.raw;}));taskCommands(raw);const bank=this.banks.get(rule.bank),old=bank.tasks.entries.get(rule.id);if(old&&equal(raw,old.slice(0,raw.length))&&old.slice(raw.length).every(x=>!x))return false;if(!old&&!commands.length)return false;bank.tasks.entries.set(rule.id,raw);bank.tasks.dirty=true;this.changedTasks.add(rule.bank);return true;}
 get dirty(){return[...this.banks.values()].some(b=>b.invk.dirty||b.tasks.dirty);}
 async saveFile(){if(!this.dirty)return null;const entries=this.dat.pakd.entries.map(e=>e.data);for(const[n,b]of this.banks){entries[10+n]=b.invk.build();if(b.tasks.dirty)entries[19+n]=b.tasks.build();}const bytes=await encodeDat(buildPakd(entries),this.dat.entryName);return{path:this.dat.path,bytes,originalSize:this.dat.originalSize,dat:this.dat};}
 saved(file){if(!file)return;this.dat.originalSize=file.savedSize??file.bytes.length;for(const b of this.banks.values()){b.invk=new InvocationBank(b.invk.build());b.tasks=new SceneTasks(b.tasks.build());}this.changedTasks.clear();}
}

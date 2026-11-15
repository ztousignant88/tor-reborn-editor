// Original Reborn EFX graphs shared by the ability viewer and cutscenes.
// Native: 4488B0 -> 30FC80 -> 410300/411B80; child event 13 resolves in
// the common bank (310FD0), including children of external magic sequences.
import {source} from './source.js';
import {parseBtx} from './bgscene.js';
import {decompressMlz,parseEfx,readCurve,sampleCurve,readVector,sampleVector,readColor,sampleColor,readShapes,shapeFrame,spriteTrackDuration,readModel,readMaterial,isLightPanel} from '../lib/efx.js';
import {battleData} from './battledata.js';
import {parseXlce} from '../lib/pakd.js';
import {rotate3,add3,mul3,unit3,random01} from '../lib/efxmath.js';
import {sampleAttachment,applyBasis,sampleEffectPoint} from '../lib/efxattachments.js';
import {sequencePages} from '../lib/efxsequence.js';
import {advanceParticle} from '../lib/efxmotion.js';
import {readLightning,lightningStrips,readRibbon,ribbonStrips,readBeam} from '../lib/efxlines.js';
import {particleGeneration,particleAppearance,particleInitialColor} from '../lib/efxinheritance.js';
import {readScreen,screenPieces} from '../lib/efxscreen.js';

const v=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
// Native tiles are one world unit: 26240 initialises D7AC30 to 1.0 and
// 2DA340 converts (x,z) to (x+.5,z+.5). EFX uses that same coordinate space.
const SCALE=1,MAX_TIME=1800,MAX_PARTICLES=12000;
// Native 4488B0: template 139 (DorgaluaXL) selects +87 / +B1 when
// nonnegative. The adjacent +86 / +B0 bytes are the ordinary caster variant.
export function effectCasterVariant(row,{alternate=false,casterTemplate=0}={}){
  const at=alternate?0xb0:0x86,special=row[at+1];
  return casterTemplate===139&&special<128?special:row[at];
}
export function defaultEffectCaster(row,alternate=false){
  const at=alternate?0xb0:0x86;return row[at+1]<128&&row[at+1]!==row[at]?139:0;
}
export const ELEMENT_NAMES={0:'Controller',1:'Point',2:'Sprite',3:'Line',4:'Circle',5:'Model',6:'Column',7:'Sphere',8:'Board',10:'Trail',64:'Light',65:'Fog',66:'Camera shake',102:'Textured lightning',103:'Ribbon trail',107:'Multitexture trail',162:'Screen texture',165:'Screen texture 2',166:'Screen texture 3',208:'Character tint',209:'Camera'};
let promise;
function library(lib,key){return {lib,key,generators:new Map(),elements:new Map(),shapes:new Map(),models:new Map(),textures:new Map()};}
export function loadSpellEffects(){
  return promise??=(async()=>{
    const [packed,index,{dat}]=await Promise.all([source.read('effect/global/common/c_all.efz'),source.read('effect/global/common/indices.bin'),battleData()]);
    const iv=v(index.bytes),count=iv.getUint32(4,true),offset=iv.getUint32(8,true);
    if(offset+count*4>iv.byteLength)throw new Error('Invalid shared effect index');
    return Object.assign(library(parseEfx(decompressMlz(packed.bytes)),'common'),{indices:Array.from({length:count},(_,i)=>iv.getUint32(offset+i*4,true)),effects:parseXlce(dat.pakd.entries[16].data),magic:new Map()});
  })().catch(e=>{promise=null;throw e;});
}
export async function loadEffectPlan(bank,effect,row=bank.effects.row(effect),options={}){
  const animation=v(row).getUint16(options.alternate?0xae:0x84,true),id=animation-609;
  if(id>=0&&id<179){
    if(!bank.magic.has(id)){
      const key=`m${String(id).padStart(4,'0')}`,pending=source.read(`effect/global/magic/${key}.efz`).then(p=>library(parseEfx(decompressMlz(p.bytes)),key)).catch(e=>{bank.magic.delete(id);throw e;});
      bank.magic.set(id,pending);
    }
    const pending=bank.magic.get(id);pending.resolved=await pending;
  }
  return spellPlan(bank,effect,row,options);
}
const value=(curve,t,random=0.5)=>sampleCurve(curve,t,random);
const curves=(def,at,n,integer=false)=>n===3?readVector(def,at):n===4?readColor(def,at):Array.from({length:n},(_,i)=>readCurve(def,at+i*32,integer));
const values=(cs,t,random=0.5)=>Array.isArray(cs)?cs.map(c=>value(c,t,random)):cs.mode!==undefined?sampleVector(cs,t,random):sampleColor(cs,t,random);
const random=n=>{let x=Math.imul(n^0x9e3779b9,0x85ebca6b);x=Math.imul(x^(x>>>13),0xc2b2ae35);return ((x^(x>>>16))>>>0)/4294967296;};
function generator(bank,id){
  if(!bank.generators.has(id)){
    const d=bank.lib.generators.get(id);if(!d)throw new Error(`${bank.key}: missing generator ${id}`);
    const b=d.body,w=v(b),children=[];
    for(let i=0;i<8;i++)if(b[0x460+i])children.push({id:w.getUint16(0x450+i*2,true),mode:b[0x460+i],start:w.getInt16(0x468+i*2,true),element:w.getUint16(0x498+i*2,true)});
    const volume={};
    if(d.kind===2)Object.assign(volume,{inner:readCurve(d,0x4b0),width:readCurve(d,0x4d0),spread:readCurve(d,0x4f0),rotation:curves(d,0x510,3),scale:curves(d,0x578,3)});
    if(d.kind===3)Object.assign(volume,{inner:readCurve(d,0x4b0),width:readCurve(d,0x4d0),spread:curves(d,0x4f0,3),rotation:curves(d,0x558,3),scale:curves(d,0x5c0,3)});
    if(d.kind===7)Object.assign(volume,{radius:readCurve(d,0x4b0),points:readCurve(d,0x4d0,true),rotation:curves(d,0x4f0,3),scale:curves(d,0x558,3),sequential:b[0x48e]===3});
    bank.generators.set(id,{id,kind:d.kind,def:d,volume,order:b[0x479],surface:!!b[0x48e],radialVelocity:!!b[0x495],attachmentMode:b[0x44b],attachment:[2,6,9].includes(b[0x44b])?w.getUint16(0x44e,true):0,
      life:readCurve(d,64,true),count:readCurve(d,0,true),interval:readCurve(d,32,true),capacity:w.getUint16(0x47a,true),position:curves(d,0xe0,3),scale:curves(d,0x350,3),
      speed:readCurve(d,0xc0),direction:curves(d,0x148,3),acceleration:curves(d,0x1b0,3),jerk:curves(d,0x218,3),rotation:curves(d,0x280,3),spin:curves(d,0x2e8,3),
      inertia:readCurve(d,0x60),gravity:readCurve(d,0x80),drag:readCurve(d,0xa0),color:curves(d,0x3b8,4,true),element:w.getUint16(0x44c,true),children,
      parentMotion:!!b[0x490],parentPhysics:!!b[0x491],parentRotation:!!b[0x492],parentScale:!!b[0x493],parentColor:!!b[0x494]});
  }
  return bank.generators.get(id);
}
function element(bank,id){
  if(!bank.elements.has(id)){
    const d=bank.lib.elements.get(id);if(!d)throw new Error(`${bank.key}: missing element ${id}`);
    const b=d.body,e={id,kind:d.kind,body:b,def:d,opacity:readCurve(d,0x60,true),billboard:b[0x90],blend:b[0x8e],rotationOrder:b[0x88],scaleFirst:!!b[0x94]};
    if(d.kind===2)Object.assign(e,{shape:b[0x29c],track:b[0x29d],flipX:b[0x28e],flipY:b[0x28f],scale:curves(d,0x1c8,3),position:curves(d,0x2b0,3),rotation:curves(d,0x160,3),color:curves(d,0xd0,4,true),
      randomFrame:!!b[0x290],advance:!!b[0x291],sequential:!!b[0x292],inheritScale:!!b[0x8b],inheritRotation:!!b[0x8c],inheritColor:!!b[0x8a],trackMode:b[0x28b]||b[0x28a]?b[0x28b]||2:0});
    if(d.kind===208)Object.assign(e,{color:curves(d,0x160,4,true),target:!!b[0x281]});
    if([162,165,166].includes(d.kind))e.screen=readScreen(d);
    if([102,103,107].includes(d.kind))Object.assign(e,{line:d.kind===102?readLightning(d):d.kind===107?readBeam(d):readRibbon(d),inheritScale:!!b[0x8b],inheritRotation:!!b[0x8c]});
    if(d.kind===5)Object.assign(e,{models:Array.from(b.slice(0x958,0x95c)),materials:Array.from({length:4},(_,i)=>readMaterial(d,0x2d8+i*0x1a0)).filter(m=>m.type),morph:readCurve(d,0x298),randomModel:!!b[0x960],modelCount:b[0x964],scale:curves(d,0x1c8,3),rotation:curves(d,0x160,3),position:curves(d,0x230,3),color:curves(d,0xd0,4,true),
      inheritScale:!!b[0x8b],inheritRotation:!!b[0x8c],inheritColor:!!b[0x8a]});
    bank.elements.set(id,e);
  }
  return bank.elements.get(id);
}
function selected(bank,meta,choice){
  const m=bank.lib.metas.get(meta);if(!m)throw new Error(`${bank.key}: missing sequence ${meta}`);
  const page=choice?m.pages[choice]:null;
  return m.schedulers.filter(s=>!choice||s.page===page);
}
function shapes(bank,id){
  if(!bank.shapes.has(id)){
    const raw=bank.lib.resources.get(`80:${id}`);if(!raw)throw new Error(`${bank.key}: missing shape ${id}`);
    bank.shapes.set(id,readShapes(raw));
  }
  return bank.shapes.get(id);
}
export function effectTexture(bank,id){
  if(!bank.textures.has(id)){
    if(id===null){const t={width:1,height:1,format:0,data:new Uint8Array([255,255,255,255])};bank.textures.set(id,t);return t;}
    const raw=bank.lib.resources.get(`82:${id}`);if(!raw)throw new Error(`${bank.key}: missing texture ${id}`);
    let p=-1;for(let i=0;i+52<raw.length;i++)if(raw[i]===98&&raw[i+1]===116&&raw[i+2]===120&&raw[i+3]===0){p=i;break;}
    if(p<0)throw new Error('Missing EFX btx');bank.textures.set(id,parseBtx(raw,p));
  }
  return bank.textures.get(id);
}

// The casting cue is a viewer setting. Result roles and intervals come from
// the native metadata; battle-selected hit counts/targets can be overridden.
export function spellPlan(bank,effect,row=bank.effects.row(effect),{alternate=false,charge=30,release,results,casterTemplate=0}={}){
  const animation=v(row).getUint16(alternate?0xae:0x84,true),variant=effectCasterVariant(row,{alternate,casterTemplate});
  const plan={effect,animation,variant,meta:null,bank:bank.key,stages:[],symbol:[],emitters:[],particles:[],parts:new Map(),textures:new Map(),issues:new Set(),events:[],phases:[],duration:120,limited:false};
  let lib=bank,meta;
  if(animation<609)meta=bank.indices[animation]+variant;
  else if(animation<788){lib=bank.magic.get(animation-609)?.resolved;if(!lib){plan.issues.add('External effect bank is not loaded');return plan;}meta=variant+1;}
  else {plan.issues.add(`Animation family ${animation} has not been decoded`);return plan;}
  plan.meta=meta;plan.bank=lib.key;
  const issue=s=>plan.issues.add(s);
  const inspect=(b,gid,eid,path=new Set())=>{
    const key=`${b.key}:${gid}:${eid}`;if(path.has(key)){issue('Recursive generator link was bounded');return;}
    path=new Set(path).add(key);
    let g,e;try{g=generator(b,gid);e=element(b,eid||g.element);}catch(error){issue(error.message);return;}
    const partKey=`${b.key}:${e.id}`;
    if(!plan.parts.has(partKey)){
      const part={key:partKey,bank:b,id:e.id,kind:e.kind,name:ELEMENT_NAMES[e.kind]??`Type ${e.kind}`,supported:[0,2,5,102,103,107,162,165,166,208].includes(e.kind),whiteFlash:false,textures:new Set()};plan.parts.set(partKey,part);
      if(!part.supported)issue(`${part.name} layers are not yet rendered`);
      try{
        let faces=[];
        if(e.screen){
          issue('Screen layers: original materials, curves and colour grids; viewport fitting and capture timing are approximate');
          for(const m of e.screen.materials){
            if(![2,3,4,5].includes(m.type)||m.blend>4||m.type===4&&m.preset>2){part.supported=false;issue(`Screen material type ${m.type}, preset ${m.preset}, blend ${m.blend} is not yet rendered`);}
            if(m.type===2){const k=`${b.key}:${m.texture}`;part.textures.add(k);plan.textures.set(k,{bank:b,id:m.texture,key:k});}
            if(m.type===4&&m.preset){part.supported=false;issue('Captured-scene screen layer is disabled until native masking and capture timing are reproduced');}
            if(m.type===3)faces.push(...shapes(b,m.shape));
          }
        }
        if([102,103,107].includes(e.kind)){
          const name=e.kind===102?'Lightning':e.kind===107?'Beam':'Ribbon';
          issue(e.kind===107?'Beams: original cubic paths and material passes; reveal timing, asymmetric width and scrolling are approximate':e.kind===102?'Textured lightning: original textures, paths and timing; random strand variation is approximated':'Ribbon trails: original textures and moving history; curve smoothing, twist and random variation are approximated');
          for(const unit of e.line.materials){
            if(!unit.type)continue;
            if(unit.type===2){const k=`${b.key}:${unit.texture}`;part.textures.add(k);plan.textures.set(k,{bank:b,id:unit.texture,key:k});}
            else if(unit.type!==4||unit.preset){part.supported=false;issue(`${name} material type ${unit.type}, preset ${unit.preset} is not yet rendered`);}
            if(unit.blend>4){part.supported=false;issue(`${name} blend mode ${unit.blend} is not yet rendered`);}
          }
          if(e.line.lengthUV||e.line.widthUV)issue(`${name} texture sizing in world units is not yet reproduced`);
          if(e.kind===103&&e.line.noise)issue('Ribbon history turbulence is not yet reproduced');
        }
        if(e.kind===2)faces=shapes(b,e.shape);
        if(e.kind===5)for(const id of e.models.filter(Boolean)){if(!b.models.has(id))b.models.set(id,readModel(b.lib.resources.get(`84:${id}`)));faces.push(...b.models.get(id));}
        if(e.kind===5){
          const m=e.materials;
          // The same flat gradient geometry is also used subtractively.
          // Drawing those shade panels directly over the map produces black
          // polygons (notably Thunderflare), so the panel switch covers both.
          part.whiteFlash=m.length===1&&m[0].type===4&&m[0].preset===0&&isLightPanel(faces);
          if(m.length!==1){part.supported=false;issue('Multitexture model materials are not yet rendered');}
          for(const unit of m){
            if(unit.type===4&&unit.preset){if(unit.preset<=2){part.supported=false;issue('Captured-scene model layer is disabled until native masking and capture timing are reproduced');}else{part.supported=false;issue(`Global renderer texture ${unit.preset} is not yet available; no white placeholder is drawn`);}}
            else if(unit.type===2){const k=`${b.key}:${unit.texture}`;part.textures.add(k);plan.textures.set(k,{bank:b,id:unit.texture,key:k});}
            else if(unit.type!==4){part.supported=false;issue(`Model material type ${unit.type} is not yet rendered`);}
          }
        }
        const blend=e.kind===5?e.materials[0]?.blend:e.blend;
        if(blend>4){part.supported=false;issue(`Special blend mode ${blend} is not yet rendered`);}
        for(const f of faces)if(f.texture!==null&&f.texture!==undefined){const k=`${b.key}:${f.texture}`;part.textures.add(k);plan.textures.set(k,{bank:b,id:f.texture,key:k});}
      }catch(error){part.supported=false;issue(error.message);}
    }
    if(![0,1,2,3,7].includes(g.kind))issue(`Emitter volume ${g.kind} uses an approximate origin`);
    for(const c of g.children)if(c.id){if(c.mode>3)issue(`Child trigger ${c.mode} is not yet rendered`);inspect(b,c.id,c.element,path);}
  };
  const schedule=(b,s,start,where,phase,path,result=-1)=>{
    if(s.type===1){plan.emitters.push({bank:b,generator:s.generator,element:s.element,clockStart:start,start:Math.max(0,start+s.start),stop:Math.max(0,start+(s.end>0?s.end:s.start+1)),where,phase,result});inspect(b,s.generator,s.element);}
    else if(s.type===2)for(const event of s.events??[]){
      if((event.args[3]&255)===1&&result>=0&&result!==plan.results-1)continue;
      const time=start+s.start+event.time;
      plan.events.push({bank:b.key,phase,time,type:event.type,args:event.args,result});
      if(event.type===13)expand(bank,event.args[0],event.args[2],time,where,phase,path,result);
      else if(![0,1,29].includes(event.type))issue(`Sequence event ${event.type} is not yet interpreted`);
    }
  };
  const expand=(b,id,choice,start,where,phase,path=new Set(),result=-1)=>{
    const key=`${b.key}:${id}:${choice}`;if(path.has(key)){issue('Recursive sequence link was bounded');return;}
    path=new Set(path).add(key);
    try{for(const s of selected(b,id,choice))schedule(b,s,start,where,phase,path,result);}catch(error){issue(error.message);}
  };
  let root=[];try{root=selected(lib,meta,0);}catch(error){issue(error.message);return plan;}
  plan.results=Math.max(1,Math.min(32,Math.trunc(results??row[17]??1)||1));
  const sequence=lib.lib.metas.get(meta);
  plan.sequence=sequencePages(sequence,{charge,release,results:plan.results});
  for(const cue of plan.sequence){
    const {id:phase,start,result}=cue;
    if(!plan.phases.some(p=>p.id===phase))plan.phases.push({id:phase,start,role:cue.role});
    for(const s of root.filter(s=>s.page===phase))schedule(lib,s,start,'target',phase,new Set(),result);
  }
  const symbolChoice={1:3,2:5,3:8,4:6,5:4,6:7,7:2,8:1,9:9}[row[2]];
  if(symbolChoice&&row[0x83]===23){try{plan.symbol=selected(bank,bank.indices[512],symbolChoice);expand(bank,bank.indices[512],symbolChoice,0,'symbol','symbol');}catch(error){issue(error.message);}}
  // A zero native particle lifetime is unlimited (500930), not zero frames
  // and not the emitter scheduler's end. Many main spell pictures fade in
  // after the emitter has stopped. Retain them through the preview envelope.
  const curveEnd=def=>{const d=v(def.tail);let end=0;for(let i=0;i+8<=d.byteLength;i+=8){const t=d.getInt32(i,true);if(t>=0&&t<MAX_TIME)end=Math.max(end,t);}return end;};
  let envelope=120;
  for(const em of plan.emitters)envelope=Math.max(envelope,em.stop);
  for(const part of plan.parts.values())envelope=Math.max(envelope,Math.max(0,...plan.phases.map(p=>p.start))+curveEnd(part.bank.lib.elements.get(part.id)));
  envelope=Math.min(MAX_TIME,envelope+60);
  let serial=0;
  const spawn=(em,gid,eid,at,stop,depth=0,parent=null,single=false)=>{
    if(depth>8||plan.particles.length>=MAX_PARTICLES){plan.limited=true;return;}
    let g,e;try{g=generator(em.bank,gid);e=element(em.bank,eid||g.element);}catch{return;}
    const active=[],capacity=Math.min(g.capacity||1,512);let time=at,ordinal=0;
    for(let steps=0;time<Math.min(MAX_TIME,stop)&&steps<MAX_TIME;steps++){
      const born=time-at,count=Math.min(128,Math.max(0,Math.round(value(g.count,born))));
      for(let n=0;n<count;n++){
        if(active.filter(t=>t>=time).length>=capacity)break;
        const seed=++serial,r=random(seed),nativeLife=Math.round(value(g.life,born,r)),life=Math.max(1,Math.min(MAX_TIME,nativeLife||envelope-time));
        const p={...em,g,e,start:time,life,birth:born,seed,ordinal:++ordinal,random:r,parent,part:`${em.bank.key}:${e.id}`,attachment:g.attachment||parent?.attachment||0};
        const attachment=em.bank.lib.attachments.get(p.attachment);if(attachment?.body[0x138]>3)issue(`Attachment route ${attachment.body[0x138]} is not yet rendered`);
        // Visual calibration from the user's in-game Sparksphere comparison.
        // Family 140 is Lightning Bow (all ranks). Shrink only the flying
        // projectile subtree, keeping destination, timing and hit effects.
        if(animation===140&&em.bank.key==='common'){
          for(let owner=p;owner;owner=owner.parent)if(owner.e.id===181){p.previewScale=.25;break;}
        }
        plan.particles.push(p);active.push(time+life);plan.duration=Math.max(plan.duration,time+life);
        if(plan.particles.length>=MAX_PARTICLES){plan.limited=true;return;}
        for(const c of g.children)if(c.id){
          if(c.mode===1)spawn(em,c.id,c.element,time+c.start,time+c.start+1,depth+1,p,true);
          else if(c.mode===2)spawn(em,c.id,c.element,time+c.start,time+life,depth+1,p);
          else if(c.mode===3)spawn(em,c.id,c.element,time+life+c.start,time+life+c.start+1,depth+1,p,true);
        }
      }
      if(single)break;
      time+=Math.max(1,Math.round(value(g.interval,born)));
    }
  };
  for(const em of plan.emitters)spawn(em,em.generator,em.element,em.start,em.stop);
  plan.duration=Math.min(MAX_TIME,Math.ceil(plan.duration+1));
  if(plan.limited)issue('Large or looping graph bounded for interactive playback');
  return plan;
}

function motion(p,age){
  const {g,e,birth,random:r}=p;
  if(!p.motion){
    const pos=values(g.position,birth,r),speed=value(g.speed,birth,r),dir=values(g.direction,birth,r),vol=g.volume;
    let origin=[0,0,0],velocity=rotate3([speed,0,0],dir,g.order);
    if(g.kind===7){
      // 5438D0: a ring with a discrete number of points. Stacking these
      // particles at the origin turns the summon's rim into a white column.
      const points=Math.max(1,Math.trunc(value(vol.points,birth,r))),index=vol.sequential?(p.ordinal-1)%points:Math.floor(random01(p.seed,201)*points);
      const angle=index*2*Math.PI/points,radius=value(vol.radius,birth,r),local=rotate3(rotate3([radius,0,0],[0,angle,0],g.order),values(vol.rotation,birth,r),g.order);
      origin=mul3(local,values(vol.scale,birth,r));
      velocity=rotate3(rotate3([speed,0,0],[0,angle,0],g.order),dir,g.order);
    }
    if(g.kind===2||g.kind===3){
      const radius=value(vol.inner,birth,r)+value(vol.width,birth,r)*(g.surface?1:random01(p.seed,201));
      const spread=g.kind===2?[0,value(vol.spread,birth,r)*(random01(p.seed,202)-0.5),0]:values(vol.spread,birth,r).map((n,i)=>i===0?0:n*(random01(p.seed,202+i)-0.5));
      // 543D50 samples yaw from spread.y and pitch from spread.x.
      if(g.kind===3){const a=values(vol.spread,birth,r);spread[1]=a[1]*(random01(p.seed,202)-0.5);spread[2]=a[0]*(random01(p.seed,203)-0.5);}
      const local=rotate3(rotate3([radius,0,0],spread,g.order),values(vol.rotation,birth,r),g.order);
      const volumeScale=values(vol.scale,birth,r);if(g.kind===2)volumeScale[1]=1;
      origin=mul3(local,volumeScale);
      const direction=rotate3(rotate3([speed,0,0],spread,g.order),dir,g.order);
      velocity=g.radialVelocity?unit3(direction).map(n=>n*speed):direction;
    }
    for(let i=0;i<3;i++)pos[i]+=origin[i];
    const accel=values(g.acceleration,birth,r),jerk=values(g.jerk,birth,r),baseI=value(g.inertia,birth,r),baseG=value(g.gravity,birth,r),baseD=value(g.drag,birth,r);
    const ec=e.kind<160?[0,32,64].map(at=>readCurve(e.def,at)):null,frames=[pos.slice()];
    for(let t=1;t<=Math.min(600,p.life);t++){
      const inertia=ec?value(ec[0],t,r)*baseI:0,drag=ec?value(ec[2],t,r)+baseD:0,gravity=ec?value(ec[1],t,r)+baseG:0;
      advanceParticle(pos,velocity,accel,jerk,inertia,drag,gravity);
      frames.push(pos.slice());
    }
    p.motion=frames;
  }
  return p.motion[Math.min(p.motion.length-1,Math.floor(age))];
}
export function sampleSpell(bank,plan,tick,{end=plan?.duration??0,phase='all',part='all',symbol=true,whiteFlashes=false}={}){
  const particles=[],lines=[],screens=[],tints=[],issues=[];if(!plan||tick<0||tick>=end)return {particles,lines,screens,tints,issues};
  for(const p of plan.particles){
    const age=tick-p.start;if(age<0||age>p.life||phase!=='all'&&String(p.phase)!==String(phase)||part!=='all'&&p.part!==part||!symbol&&p.where==='symbol')continue;
    const {g,e,birth,random:r}=p,b=p.bank;
    if(plan.parts.get(p.part)?.whiteFlash&&!whiteFlashes)continue;
    if(e.kind===208&&e.target)tints.push({where:'target',rgba:values(e.color,age,r)});
    if([102,103,107].includes(e.kind)&&plan.parts.get(p.part)?.supported)lines.push({source:p,tick,age});
    if(e.screen&&plan.parts.get(p.part)?.supported)screens.push({source:p,tick,age});
    if(![2,5].includes(e.kind)||!plan.parts.get(p.part)?.supported)continue;
    try{
      let faces=[];
      if(e.kind===2){
        const list=shapes(b,e.shape).frames,track=e.track?b.lib.resources.get(`81:${e.track}`):null;
        const initial=e.randomFrame?Math.floor(r*(track?spriteTrackDuration(track):list.length)):e.sequential?p.ordinal-1:0;
        const frame=track?shapeFrame(track,initial+(e.advance?age:0),{mode:e.trackMode}):initial+(e.advance?Math.floor(age/2):0);
        if(frame!==null&&list.length){
          const i=e.trackMode===1?frame%list.length:e.trackMode===2&&frame>=list.length?null:Math.min(frame,list.length-1);
          if(i!==null)faces=list[i];
        }
      }else{
        if(!plan.parts.get(p.part)?.supported)continue;
        const m=e.randomModel?Math.floor(r*e.modelCount):Math.max(0,value(e.morph,age,r)),index=Math.floor(m),id=e.models[index]||e.models.find(Boolean);
        if(id){
          if(!b.models.has(id))b.models.set(id,readModel(b.lib.resources.get(`84:${id}`)));faces=b.models.get(id);
          const next=e.models[index+1],fraction=e.randomModel?0:m-index;
          if(next&&fraction){
            if(!b.models.has(next))b.models.set(next,readModel(b.lib.resources.get(`84:${next}`)));const other=b.models.get(next);
            if(other.length===faces.length)faces=faces.map((f,i)=>({...f,points:f.points.map((p,j)=>p.map((x,k)=>x+(other[i].points[j][k]-x)*fraction))}));
          }
        }
      }
      const appearance=particleAppearance(p,age),scale=appearance.scale.map(x=>x*SCALE),rot=appearance.rotation;
      const pos=motion(p,age),off=values(e.position,age,r),rgba=values(e.color,age,r),gc=appearance.generation.color;
      // Native 40CB40 multiplies packed bytes with a >>7 and saturates at 255.
      // Letting colour products exceed that range creates bright planes that
      // are absent from the game, particularly untextured model layers.
      const blend=e.kind===5?e.materials[0].blend:e.blend;
      const opacity=e.blend?Math.max(0,Math.min(100,value(e.opacity,age,r))):100;
      const color=rgba.map((x,i)=>{
        let packed=Math.min(255,Math.max(0,e.inheritColor?Math.floor(Math.floor(x)*Math.floor(gc[i])/128):Math.floor(x)));
        if(i===3)packed=Math.floor(packed*opacity/100); // 501DE0 / 5368E2
        return Math.min(i===3?1:255/128,packed/(i===3&&blend===4?255:128));
      });
      for(let shape of faces)if(shape){
        if(e.kind===5){
          const material=e.materials[0],scroll=sampleVector(material.scroll,age,r),mc=sampleColor(material.color,age,r);
          shape={...shape,texture:material.type===4?null:material.texture,uv:shape.uv.map(uv=>uv.map((n,i)=>n+scroll[i])),colors:shape.colors.map(c=>c.map((n,i)=>Math.min(i===3?1:255/128,Math.floor(n*mc[i])/128)))};
        }
        const flip=(mode,c)=>mode===1?random01(p.seed,c)<0.5:mode===2?!!(p.ordinal%2):false;
        particles.push({where:p.where,attachment:p.attachment,source:p,tick,shape,scale,previewScale:p.previewScale??1,offset:pos.map((x,i)=>(x+off[i])*SCALE),rgba:color,flipX:flip(e.flipX,300),flipY:flip(e.flipY,301),add:blend===1,blend,rotation:rot,rotationOrder:e.rotationOrder,scaleFirst:e.scaleFirst,billboard:e.billboard,model:e.kind===5,capture:e.kind===5&&e.materials[0].type===4?e.materials[0].preset:0,bank:b,part:p.part});
      }
    }catch(error){if(!issues.includes(error.message))issues.push(error.message);}
    if(particles.length>=2048){issues.push('Visible particle limit reached');break;}
  }
  return {particles,lines,screens,tints,issues};
}

function attachmentSpace(p,tick,context,cache){
  const key=`${p.seed}:${tick}`;if(cache.has(key))return cache.get(key);
  const root=()=>({position:p.where==='symbol'?add3(context.caster,[0,context.casterHeight,0]):p.where==='target'?context.target:context.caster,rotation:[0,0,0],scale:[1,1,1],order:0,basis:null});
  let space=root();
  if(p.g.attachment){
    const def=p.bank.lib.attachments.get(p.g.attachment),time=[6,9].includes(p.g.attachmentMode)?p.start:tick;
    if(def)space=sampleAttachment(def,time-(p.clockStart??p.start),{...context,origin:space.position},p.random);
  }else if(p.parent){
    if(p.g.attachmentMode===10){
      const inherited=attachmentSpace(p.parent,tick,context,cache);space=inherited?{...inherited,position:particlePosition(p.parent,tick,context,cache)}:null;
    }else if(p.g.attachmentMode===7)space=attachmentSpace(p.parent,tick,context,cache);
    else{const position=particlePosition(p.parent,p.start,context,cache);space=position?{...space,position}:null;}
  }
  cache.set(key,space);return space;
}
function attachmentVector(point,space){
  let local=rotate3(mul3(point,space.scale),space.rotation,space.order);
  if(space.basis)local=applyBasis(local,space.basis);return local;
}
function particlePosition(p,tick,context,cache){
  const space=attachmentSpace(p,tick,context,cache);if(!space)return null;
  return add3(space.position,attachmentVector(motion(p,Math.max(0,tick-p.start)),space));
}
// Five native elevation steps approximate the head of the calibrated unit
// sprites. Three steps placed head-attached missiles inside their bodies.
// Callers can supply exact unit heights when those are available.
export function spellBillboards(view,cache,sample,{caster=[0,0,0],target=[2,0,0],casterHeight=2.041244805,targetHeight=2.041244805,unitPoint}={}){
  const [right,cameraUp]=view.billboardAxes({upright:false}),forward=[Math.cos(view.pitch)*Math.sin(view.yaw),Math.sin(view.pitch),Math.cos(view.pitch)*Math.cos(view.yaw)];
  const context={caster,target,casterHeight,targetHeight,unitPoint},spaces=new Map();
  const billboards=sample.particles.map(p=>{
    const space=attachmentSpace(p.source,p.tick,context,spaces);if(!space)return null;
    const previewScale=p.previewScale??1,centre=add3(space.position,attachmentVector(p.offset.map(n=>n*previewScale),space));centre[1]+=0.002;
    const corners=p.shape.points.map(point=>{
      point=point.map((n,i)=>n*previewScale*((i===0&&p.flipX||i===1&&p.flipY)?-1:1));
      // Native summon pictures compensate for the game's fixed 35-degree
      // camera with a tilted card and a unit-matrix attachment. In a freely
      // rotated editor view that card must face the preview camera to keep
      // its original picture proportions. Retain its scale and in-plane spin.
      const picture=!p.billboard&&space.unitPicture&&Math.abs(p.rotation[0]+35*Math.PI/180)<1e-5;
      const angles=p.billboard||picture?[0,0,p.rotation[2]]:p.rotation;
      let q=p.scaleFirst?mul3(rotate3(point,angles,p.rotationOrder),p.scale):rotate3(mul3(point,p.scale),angles,p.rotationOrder);
      if(!p.billboard&&!picture)return add3(centre,attachmentVector(q,space));
      q=mul3(q,space.scale);
      return centre.map((n,k)=>n+right[k]*q[0]+cameraUp[k]*q[1]+forward[k]*q[2]);
    });
    const id=`${p.bank.key}:${p.shape.texture}`;if(!cache.has(id))cache.set(id,view.makeTexture(effectTexture(p.bank,p.shape.texture)));
    return {x:centre[0],y:centre[1],z:centre[2],width:1,height:1,pivot:0.5,corners,uv:p.shape.uv,colors:p.shape.colors,particle:true,depthTest:p.where!=='symbol',add:p.add,blend:p.blend,tint:p.rgba,texture:cache.get(id),capture:p.capture,part:p.part};
  }).filter(Boolean);
  for(const item of sample.lines??[]){
    const p=item.source,{e,g}=p,line=e.line,age=item.age,tick=item.tick,space=attachmentSpace(p,tick,context,spaces);if(!space)continue;
    const offset=add3(motion(p,age),sampleVector(line.position,age,p.random)),start=add3(space.position,attachmentVector(offset,space));
    const opacity=e.blend?value(e.opacity,age,p.random):100;
    const generatorColor=particleInitialColor(p);
    let strips;
    if(e.kind===103){
      const frames=new Map(),frame=t=>{
        if(frames.has(t))return frames.get(t);
        const s=attachmentSpace(p,p.start+t,context,spaces);if(!s)return null;
        const {scale,rotation:rot}=particleAppearance(p,t);
        const centre=add3(s.position,attachmentVector(add3(motion(p,t),sampleVector(line.position,t,p.random)),s));
        const vector=q=>attachmentVector(e.scaleFirst?mul3(rotate3(q,rot,e.rotationOrder),scale):rotate3(mul3(q,scale),rot,e.rotationOrder),s);
        const f={centre,vector};frames.set(t,f);return f;
      };
      strips=ribbonStrips(line,age,p.seed,{forward,right,generatorColor,opacity,point:(t,q)=>{const f=frame(t);return f?add3(f.centre,f.vector(q)):start;},vector:(t,q)=>frame(t)?.vector(q)??[0,0,0]});
    }else{
    const endpoint=line.endpoint,frozen=endpoint.frozen&&[1,3].includes(endpoint.mode),time=frozen?p.start:tick,endpointAge=frozen?0:age;
    let end=sampleVector(line.end,endpointAge,p.random);
    if(endpoint.mode===1){
      const first=frozen?attachmentSpace(p,p.start,context,spaces):space;
      const base=frozen?add3(first.position,attachmentVector(add3(motion(p,0),sampleVector(line.position,0,p.random)),first)):start;end=add3(base,end);
    }else if(endpoint.mode===2){
      const def=p.bank.lib.attachments.get(endpoint.attachment);
      if(def){const s=sampleAttachment(def,time-(p.clockStart??p.start),{...context,origin:space.position},p.random);if(s)end=add3(s.position,attachmentVector(end,s));}
    }else if(endpoint.mode===3){
      if(endpoint.kind===15)end=add3(end,sampleEffectPoint(endpoint,endpointAge,{...context,origin:space.position},p.random));
      else{
      const kind=endpoint.kind,height=kind===1?casterHeight:targetHeight,step=0.408248961;
      const y=endpoint.subtype===1?step:endpoint.subtype===2?3*step:endpoint.subtype===3?height:endpoint.subtype===4?Math.max(step/2,height-step):0;
      const origin=context.unitPoint?.(endpoint.reference,kind,endpoint.subtype)??(kind===1?add3(caster,[0,y,0]):[2,8,16].includes(kind)?add3(target,[0,y,0]):space.position);
      end=add3(end,add3(origin,sampleVector(endpoint.offset,endpointAge,p.random)));
      }
    }
    const {scale}=particleAppearance(p,age);
    strips=lightningStrips(line,age,p.seed,start,end,{forward,right,generatorColor,opacity,scale});
    }
    for(const originalStrip of strips){
      const factor=p.previewScale??1,strip=factor===1?originalStrip:{...originalStrip,corners:originalStrip.corners.map(point=>point.map((n,i)=>start[i]+(n-start[i])*factor))};
      const id=`${p.bank.key}:${strip.texture}:repeat`;if(!cache.has(id))cache.set(id,view.makeTexture(effectTexture(p.bank,strip.texture),{repeat:true}));
      // Sort all halves/passes at the same effect anchor, preserving their
      // native order rather than interleaving the two sides by camera depth.
      billboards.push({...strip,x:start[0],y:start[1],z:start[2],width:1,height:1,pivot:0.5,particle:true,depthTest:p.where!=='symbol',add:strip.blend===1,texture:cache.get(id),part:p.part});
      if(billboards.length>=8192){if(!sample.issues.includes('Visible effect strip limit reached'))sample.issues.push('Visible effect strip limit reached');return billboards;}
    }
  }
  for(const item of sample.screens??[]){
    const p=item.source,e=p.e,b=p.bank;
    try{
      const opacity=e.blend?value(e.opacity,item.age,p.random):100;
      const pieces=screenPieces(e.screen,item.age,p.random,{texture:id=>effectTexture(b,id),shape:id=>shapes(b,id),track:(id,t)=>shapeFrame(b.lib.resources.get(`81:${id}`),t),generatorColor:particleInitialColor(p),opacity,scaleFirst:e.scaleFirst});
      for(const q of pieces){
        const id=`${b.key}:${q.texture}:screen`;if(!cache.has(id))cache.set(id,view.makeTexture(effectTexture(b,q.texture),{repeat:true}));
        const priority=e.body[0x92]?(e.body[0x9b]<<24>>24):0;
        billboards.push({...q,texture:cache.get(id),x:0,y:0,z:0,width:1,height:1,pivot:.5,screenSpace:true,screenPriority:priority,particle:true,depthTest:false,tint:[1,1,1,1],part:p.part});
      }
    }catch(error){if(!sample.issues.includes(error.message))sample.issues.push(error.message);}
  }
  return billboards;
}

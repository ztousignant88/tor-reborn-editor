// Native body/weapon tracks, sharing the effect viewer's clock and transport.
import{actorNames,loadActorPoses}from'../game/unitsprites.js';
import{loadBattleBodyAction,loadBattleWeaponAction,weaponBodyAction,equipmentPreviewActor,equipmentProjectile}from'../game/battleactions.js';
import{actionImages,sampleAction}from'../game/sceneanimations.js';
import{composeWeaponAction}from'../game/weaponactions.js';
import{facingPose,movementFacing}from'../game/actorposes.js';
import{previewPalette}from'../game/tables.js';
import{DEFAULT_PALETTE}from'../game/palette.js';
const PIXEL=1/64;
export function actionEvent(resource,event){return(resource?.definition.slots.find(Boolean)?.commands??[]).find(c=>c.op===9&&(c.event??c.frame)===event)?.tick;}
export function nativeActionCue(resource,fallback=30){const ticks=(resource?.definition.slots.find(Boolean)?.commands??[]).filter(c=>c.op===9&&c.frame===5).map(c=>c.tick);return ticks.length?Math.min(...ticks):fallback;}
export function castingTick(tick,nativeCue,cue){return nativeCue>0&&cue>0&&tick<cue?tick*nativeCue/cue:Math.max(0,nativeCue+tick-cue);}
export function projectedAction(state,facing,yaw,pitch){
 if(state.space==='screen')return state;
 // ShowFrame3D uses X across the native view, Y as elevation and Z as
 // floor depth. It is not an actor-facing (forward/sideways/height) vector.
 // Keep the atlas pixel scale: the native divisor also scales frame cells.
 const h=(state.mirror?-1:1)*state.x,x=-h*Math.SQRT1_2-state.z*Math.SQRT2,z=-h*Math.SQRT1_2+state.z*Math.SQRT2;
 return{...state,space:'screen',x:x*Math.cos(yaw)-z*Math.sin(yaw),y:-(state.y*Math.cos(pitch)-(x*Math.sin(yaw)+z*Math.cos(yaw))*Math.sin(pitch)),z:0};
}
export class EffectActors{
 constructor(view){this.view=view;this.textures=new Map();this.actions=[];this.ready=this.load();}
 async load(){const names=await actorNames();this.names=names;this.palette=previewPalette(0)??DEFAULT_PALETTE;this.ids=['pumpkin','skeleton'].map(n=>names.findIndex(s=>s.toLowerCase()===n)+1);this.poses=await Promise.all(this.ids.map(id=>loadActorPoses(id,this.palette)));}
 upload(key,frames){if(!this.textures.has(key))this.textures.set(key,frames.map(f=>f&&({...f,rgba:undefined,texture:this.view.makeTexture({width:f.width,height:f.height,format:0,data:f.rgba},{pixelated:true})})));return this.textures.get(key);}
 clearActions(){for(const[key,frames]of this.textures)if(key.startsWith('action:')){for(const f of frames)if(f)this.view.gl.deleteTexture(f.texture);this.textures.delete(key);}this.actions=[];this.composite=null;}
 async spell(row){await this.ready;const action=row[0x83],body=action>0&&action!==255?await loadBattleBodyAction(this.ids[0],action):null;return{kind:'spell',body,release:nativeActionCue(body),duration:body?.definition.duration??0};}
 async equipment(id,row){
  await this.ready;const actor=await equipmentPreviewActor(id,this.ids[1]),action=await weaponBodyAction(id),body=action==null?null:await loadBattleBodyAction(actor,action);
  if(!body)throw new Error('This equipment has no decoded attack motion.');
  const [weapon,hurt,poses,projectile]=await Promise.all([loadBattleWeaponAction(id),loadBattleBodyAction(this.ids[0],11),actor===this.ids[1]?this.poses[1]:loadActorPoses(actor,this.palette),equipmentProjectile(row)]);
  const ranged=!!projectile,launch=12+(actionEvent(body,2)??nativeActionCue(body,30)),flight=ranged?Math.max(8,Math.round(30/projectile.speed)):0;
  const impact=ranged?launch+flight:12+(actionEvent(body,4)??nativeActionCue(body,Math.round(body.definition.duration*.45)));
  return{kind:'equipment',body,weapon,hurt,actor,poses,projectile,launch,flight,label:this.names[actor-1].replace(/^Dra_(.*)$/,'$1 Dragon').replace(/^Gol_(.*)$/,'$1 Golem').replace(/_/g,' '),shield:row[2]===22,ranged,impact,duration:Math.max(12+body.definition.duration,impact+(hurt?.definition.duration??24))+24};
 }
 use(motion){this.clearActions();this.motion=motion;}
 positions(){return this.motion?.kind==='equipment'?{caster:[2.5,0,2.5],target:this.motion.ranged?[5.5,0,5.5]:this.motion.actor!==this.ids[1]?[4.5,0,4.5]:[3.5,0,3.5]}:{caster:[2.5,0,2.5],target:[4.5,0,4.5]};}
 actionFrames(resource,facing){return this.upload('action:'+resource.key,actionImages(resource,undefined,this.palette));}
 // Keep equipment stand-ins in the front tracks: several native weapon
 // resources have no back-view track. Body and equipment must use the same view.
 billboard(role,tick){const poses=role===1&&this.motion?.kind==='equipment'?this.motion.poses:this.poses?.[role];if(!poses?.frames)return null;const pos=this.positions(),p=role?pos.target:pos.caster,other=role?pos.caster:pos.target,facing=movementFacing([p[0],p[2]],[other[0],other[2]]),pose=this.motion?.kind==='equipment'?{view:'front',flip:(other[0]-p[0])*Math.cos(this.view.yaw)-(other[2]-p[2])*Math.sin(this.view.yaw)<0}:facingPose(facing,this.view.yaw),direction=pose.view==='front'?(pose.flip?1:0):(pose.flip?3:2);
  let resource=null,time=0,m=this.motion;
  if(m?.kind==='spell'&&role===0&&m.body){const at=castingTick(tick,m.release,m.charge??m.release);if(at<m.body.definition.duration){resource=m.body;time=at;}}
  if(m?.kind==='equipment'){
   if(role===1&&tick>=12&&tick<12+m.body.definition.duration){resource=m.body;time=tick-12;if(m.weapon){const key=`${this.view.yaw}:${this.view.pitch}:${facing}`;if(this.composite?.key!==key){for(const[k,frames]of this.textures)if(k.startsWith('action:composite:')){for(const f of frames)if(f)this.view.gl.deleteTexture(f.texture);this.textures.delete(k);}this.composite={key,resource:composeWeaponAction(m.body,m.weapon,this.palette,s=>projectedAction(s,facing,this.view.yaw,this.view.pitch))};this.composite.resource.key='composite:'+key;}resource=this.composite.resource;}}
   if(role===0&&m.hurt&&tick>=m.impact&&tick<m.impact+m.hurt.definition.duration){resource=m.hurt;time=tick-m.impact;}
  }
  let state=resource?sampleAction(resource.definition,direction,time):null;if(state?.hidden)return null;
  let sprite=state?this.actionFrames(resource,facing)?.[state.frame]:null;
  if(!sprite){state=null;const f=poses.frames.get(poses.idle[pose.view]);if(!f)return null;sprite=this.upload(`idle:${role}:${role===1?this.motion?.actor??this.ids[1]:this.ids[0]}:${pose.view}`,[f])[0];}
  const flip=state?state.flip:pose.flip,pivotX=flip?1-(sprite.pivotX??.5):(sprite.pivotX??.5),offset=(.5-pivotX)*sprite.width;
  const shift=state?projectedAction(state,facing,this.view.yaw,this.view.pitch):{x:0,y:0};
  return{texture:sprite.texture,x:p[0]+Math.cos(this.view.yaw)*(offset+shift.x)*PIXEL,y:.015,z:p[2]-Math.sin(this.view.yaw)*(offset+shift.x)*PIXEL,width:sprite.width*PIXEL,height:sprite.height*PIXEL,pivot:(state?.flipY?1-(sprite.pivot??.04):(sprite.pivot??.04))+shift.y/sprite.height,flip,flipY:!!state?.flipY,upright:true,shadow:{x:p[0],y:.003,z:p[2],radius:.22}};
 }
 // Native arrows/bolts are diagonal textures, rotated into the current
 // screen trajectory. Stock bullet artwork has zero alpha: show a small,
 // explicitly labelled preview tracer instead of an opaque texture rectangle.
 projectiles(tick){
  const m=this.motion;if(!m?.projectile||tick<m.launch||tick>=m.impact)return[];
  const {caster:end,target:start}=this.positions(),t=(tick-m.launch)/m.flight;
  const a=[start[0],.65,start[2]],b=[end[0],.65,end[2]],p=a.map((v,i)=>v+(b[i]-v)*t);
  let sprite;
  if(m.projectile.tracer){
   const rgba=new Uint8Array(16*4*4);for(let y=1;y<3;y++)for(let x=0;x<16;x++)rgba.set([255,235,180,Math.round(255*x/15)],(y*16+x)*4);
   sprite=this.upload('projectile:tracer',[{width:16,height:4,rgba}])[0];
  }else{
   const key='projectile:'+m.projectile.id;
   if(!this.textures.has(key))this.textures.set(key,[{texture:this.view.makeTexture(m.projectile.texture)}]);sprite=this.textures.get(key)[0];
  }
  const yaw=this.view.yaw,pitch=this.view.pitch,right=[Math.cos(yaw),0,-Math.sin(yaw)],up=[-Math.sin(pitch)*Math.sin(yaw),Math.cos(pitch),-Math.sin(pitch)*Math.cos(yaw)];
  const d=b.map((v,i)=>v-a[i]),dot=(x,y)=>x.reduce((s,v,i)=>s+v*y[i],0),angle=Math.atan2(dot(d,up),dot(d,right))-(m.projectile.tracer?0:Math.PI*.75),c=Math.cos(angle),s=Math.sin(angle),w=m.projectile.tracer ? .25 : 1,h=m.projectile.tracer ? .0625 : 1;
  const point=(x,y)=>p.map((v,i)=>v+right[i]*(x*c-y*s)+up[i]*(x*s+y*c));
  return[{texture:sprite.texture,x:p[0],y:p[1],z:p[2],width:w,height:h,pivot:.5,corners:[point(-w/2,h/2),point(w/2,h/2),point(-w/2,-h/2),point(w/2,-h/2)]}];
 }
 draw(tick){return[0,1].map(role=>this.billboard(role,tick));}
 dispose(){this.disposed=true;for(const frames of this.textures.values())for(const f of frames)if(f)this.view.gl.deleteTexture(f.texture);this.textures.clear();}
}

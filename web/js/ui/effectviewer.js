import {SceneView} from './scene3d.js';
import {EffectActors} from './effectactors.js';
import {loadSpellEffects,loadEffectPlan,sampleSpell,spellBillboards,effectTexture,defaultEffectCaster} from '../game/spelleffects.js';
import {textureCanvas} from './texcanvas.js';
import {effectFrame} from '../lib/efxframe.js';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const caster=[2.5,0,2.5],target=[4.5,0,4.5];
const DEFAULT_YAW=3*Math.PI/4;

function floor(positions={caster,target}){
  const data=new Uint8Array(7*7*6*36),d=new DataView(data.buffer);let i=0;
  for(let z=0;z<7;z++)for(let x=0;x<7;x++){
    const color=(x===Math.floor(positions.caster[0])&&z===Math.floor(positions.caster[2]))?[48,96,113]:(x===Math.floor(positions.target[0])&&z===Math.floor(positions.target[2]))?[115,66,67]:(x+z)%2?[52,57,68]:[60,66,78];
    for(const [a,b]of[[0,0],[0,1],[1,1],[0,0],[1,1],[1,0]]){
      const o=i++*36;d.setFloat32(o,x+a,true);d.setFloat32(o+8,z+b,true);d.setFloat32(o+16,1,true);data.set([...color,255],o+24);
    }
  }
  return {name:'Effect preview floor',mesh:{vertices:data,count:i},textures:[{name:'floor',width:1,height:1,format:0,data:new Uint8Array([255,255,255,255])}],objectSprites:new Map(),mapAnimations:[]};
}

export class EffectViewer{
  constructor(){
    this.root=document.createElement('aside');this.root.className='effect-viewer';this.root.setAttribute('aria-label','Effect viewer');
    this.root.innerHTML=`<div class="effect-title"><strong>Effect viewer</strong><span class="effect-badge">Preview</span></div>
      <div class="effect-stage"><canvas aria-label="Animated ability effect"></canvas><span class="effect-empty">Loading original effects…</span><div class="effect-anchors"><span>Caster</span><span>Target</span></div></div>
      <div class="effect-transport"><button type="button" data-act="play" aria-label="Pause effect">Pause</button><button type="button" data-act="replay" title="Replay from the beginning">↺</button><button type="button" data-act="step" title="Advance one frame">+1</button>
      <input class="effect-seek" type="range" min="0" max="120" value="0" step="1" aria-label="Effect frame"><output class="effect-time" aria-live="off">0 / 120</output></div>
      <div class="effect-options"><label>Speed <select class="effect-speed" aria-label="Playback speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>
      <label><input class="effect-loop" type="checkbox" checked>Loop</label><button type="button" data-act="rotate" title="Rotate the preview">Rotate</button><button type="button" data-act="frame" title="Frame the visible effect artwork">Frame effect</button><button type="button" data-act="fit">Reset view</button></div>
      <label class="effect-equipment-mode" hidden>Preview <select aria-label="Equipment preview mode"><option value="attack">Weapon attack</option><option value="use">Item use effect</option></select></label>
      <div class="effect-selection"><select class="effect-phase" aria-label="Effect phase"><option value="all">All phases</option></select><select class="effect-part" aria-label="Effect layer"><option value="all">All layers</option></select></div>
      <label class="effect-version" hidden>Effect version <select class="effect-caster" aria-label="Effect version" title="Choose the caster-specific visual sequence for this preview"><option value="139">Dorgalua</option><option value="0">Ordinary caster</option></select></label>
      <div class="effect-status" aria-live="off">Loading…</div>
      <details class="effect-inspect"><summary>Inspect effect</summary><div class="effect-inspector">
        <div class="effect-source"></div><p class="hint">Original curves and missile paths are decoded. Casting cue timing and some attachment modes remain approximate. Each strike uses its own launch and impact sequence. The preview uses one target; actual hit counts and targets can vary in battle. Sound is not played.</p>
        <div class="effect-cues"><label>Casting cue <input class="effect-charge" type="number" min="0" max="600" value="30" aria-label="First phase frame"></label><label>First result <input class="effect-release" type="number" min="0" max="600" placeholder="Auto" aria-label="Next phase frame"></label></div>
        <label class="inline">Preview strikes <select class="effect-results" aria-label="Preview strikes"><option value="">From ability</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select></label>
        <label class="inline"><input class="effect-alt" type="checkbox"> Alternate animation</label>
        <label class="inline"><input class="effect-symbol" type="checkbox" checked> Casting symbol</label>
        <label class="inline"><input class="effect-white-flashes" type="checkbox"> Lighting panels</label>
        <div class="effect-issues"></div><div class="effect-parts"></div>
        <details class="effect-textures"><summary>Original textures</summary><div class="effect-texture-list"></div></details>
      </div></details>`;
    this.$=q=>this.root.querySelector(q);this.tick=0;this.playing=true;this.visible=false;this.textures=new Map();this.actorTextures=[];this.token=0;
    try{this.view=new SceneView(this.$('canvas'));this.view.setScene(floor());this.view.yaw=DEFAULT_YAW;this.view.target=[3.5,1,3.5];}
    catch(error){this.setupError=error;this.fail(error);return;}
    this.root.addEventListener('click',e=>{
      const a=e.target.closest('[data-act]')?.dataset.act;if(!a)return;
      if(a==='play'){if(this.tick>=this.duration)this.tick=0;this.playing=!this.playing;}
      if(a==='replay'){this.tick=0;this.playing=true;}
      if(a==='step'){this.playing=false;this.tick=Math.min(this.duration,Math.floor(this.tick)+1);}
      if(a==='rotate')this.view.yaw+=Math.PI/2;
      if(a==='frame')this.frameEffect([this.tick]);
      if(a==='fit')this.resetView();
      this.last=null;this.draw();this.schedule();
    });
    this.$('.effect-seek').oninput=e=>{this.playing=false;this.tick=Number(e.target.value);this.draw();this.schedule();};
    this.$('.effect-speed').onchange=()=>{this.last=null;};
    this.$('.effect-phase').onchange=()=>{
      const id=this.$('.effect-phase').value;if(id!=='all')this.tick=this.plan?.phases.find(p=>String(p.id)===id)?.start??0;
      this.draw();
    };
    this.$('.effect-part').onchange=()=>{
      const key=this.$('.effect-part').value,p=this.plan?.particles.find(p=>p.part===key);
      if(p)this.tick=Math.min(this.duration,p.start+Math.min(10,p.life/2));this.draw();
    };this.$('.effect-symbol').onchange=()=>this.draw();this.$('.effect-white-flashes').onchange=()=>this.draw();
    this.$('.effect-alt').onchange=()=>this.select(this.effect,this.row,{equipment:this.equipment});
    this.$('.effect-caster').onchange=()=>this.select(this.effect,this.row,{equipment:this.equipment});
    this.$('.effect-results').onchange=()=>this.select(this.effect,this.row,{equipment:this.equipment});
    for(const c of ['.effect-charge','.effect-release'])this.$(c).onchange=e=>{
      if(e.target.value!==''||c==='.effect-charge')e.target.value=String(Math.max(0,Math.min(600,Math.round(Number(e.target.value)||0))));this.select(this.effect,this.row,{equipment:this.equipment});
    };
    this.$('.effect-textures').ontoggle=()=>{if(this.$('.effect-textures').open)this.showTextures();};
    const canvas=this.$('canvas');let drag=null;
    canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,yaw:this.view.yaw,pitch:this.view.pitch};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(drag){this.view.yaw=drag.yaw+(e.clientX-drag.x)*0.01;this.view.pitch=Math.max(0.15,Math.min(1.4,drag.pitch+(e.clientY-drag.y)*0.01));this.draw();}});
    canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.view.zoom=Math.max(0.3,Math.min(8,this.view.zoom*Math.exp(-e.deltaY*0.001)));this.draw();},{passive:false});
    this.visibility=()=>{this.last=null;this.schedule();};document.addEventListener('visibilitychange',this.visibility);
    this.observer=new IntersectionObserver(entries=>{this.visible=entries.at(-1).isIntersecting;this.last=null;this.schedule();});this.observer.observe(this.root);
    this.motion=new EffectActors(this.view);this.motion.ready.then(()=>{if(!this.destroyed)this.draw();}).catch(error=>{this.actorError=error.message;});
    this.$('.effect-equipment-mode select').onchange=()=>{const e=this.equipment;if(!e)return;if(this.$('.effect-equipment-mode select').value==='attack')this.previewEquipment(e);else if(e.effectRow)this.select(e.effect,e.effectRow,{equipment:e});else this.clear('No item use effect',e);};
  }
  attach(host){host.append(this.root);this.visible=true;this.last=null;this.schedule();}
  detach(){this.visible=false;this.token++;this.root.remove();this.schedule();}
  async select(effect,row,{equipment=null}={}){
    const changed=this.effect!==effect||this.previewKind!=='effect';this.previewKind='effect';this.equipment=equipment;this.equipmentMotion=null;this.motion?.use(null);this.$('.effect-equipment-mode').hidden=!equipment;this.$('.effect-inspect').hidden=false;this.$('.effect-phase').disabled=false;this.$('.effect-part').disabled=false;
    if(!row){this.clear();return;}
    this.$('[data-act="frame"]').disabled=false;this.view?.setScene(floor());
    this.effect=effect;this.row=row;const token=++this.token;this.plan=null;this.tick=0;this.last=null;
    this.$('.effect-phase').innerHTML='<option value="all">All phases</option>';this.$('.effect-part').innerHTML='<option value="all">All layers</option>';
    this.clearTextures();this.$('.effect-status').textContent='Loading original effect…';this.$('.effect-empty').hidden=false;this.$('.effect-empty').textContent='Loading…';
    this.$('.effect-texture-list').replaceChildren();this.$('.effect-issues').replaceChildren();this.$('.effect-parts').replaceChildren();this.$('.effect-source').replaceChildren();this.schedule();this.draw();
    if(!this.view){this.fail(this.setupError??new Error('WebGL2 is unavailable'));return;}
    try{
      const [bank,motion]=await Promise.all([loadSpellEffects(),this.motion.spell(row)]);if(token!==this.token)return;
      if(changed&&motion.body)this.$('.effect-charge').value=String(motion.release);
      const release=this.$('.effect-release').value,results=this.$('.effect-results').value;
      const alternate=this.$('.effect-alt').checked,hasVersions=defaultEffectCaster(row,alternate)===139;
      this.$('.effect-version').hidden=!hasVersions;
      const casterTemplate=hasVersions?Number(this.$('.effect-caster').value):0;
      const plan=await loadEffectPlan(bank,effect,row.slice(),{alternate,casterTemplate,charge:Number(this.$('.effect-charge').value),release:release===''?undefined:Number(release),results:results===''?undefined:Number(results)});if(token!==this.token)return;
      motion.charge=Number(this.$('.effect-charge').value);this.motion.use(motion);
      this.bank=bank;this.plan=plan;this.duration=Math.max(plan.duration,motion.duration-motion.release+motion.charge+12);this.$('.effect-seek').max=this.duration;
      this.casterTemplate=casterTemplate;this.resetView();
      this.$('.effect-phase').innerHTML='<option value="all">All phases</option>'+plan.phases.map(p=>`<option value="${p.id}">Phase ${p.id}</option>`).join('');
      this.$('.effect-part').innerHTML='<option value="all">All layers</option>'+[...plan.parts.values()].map(p=>`<option value="${esc(p.key)}">${esc(p.name)} #${p.id}${p.supported?'':' (unavailable)'}</option>`).join('');
      this.$('.effect-source').textContent=`Animation ${plan.animation} · variant ${plan.variant}${casterTemplate===139?' (Dorgalua)':''} · ${plan.bank} · sequence ${plan.meta??'unresolved'} · ${plan.results??1} preview strikes`;
      this.$('.effect-parts').innerHTML=`<p>${plan.parts.size} layers · ${plan.emitters.length} scheduled emitters · ${plan.textures.size} textures</p>`+
        '<ul>'+[...plan.parts.values()].map(p=>`<li>${esc(p.name)} #${p.id}${p.supported?'':' — not yet rendered'}${p.whiteFlash?' — lighting panel (off by default)':''}</li>`).join('')+'</ul>';
      this.$('.effect-issues').innerHTML=plan.issues.size?'<ul>'+[...plan.issues].map(s=>`<li>${esc(s)}</li>`).join('')+'</ul>':'<p>All referenced layer types in this sequence are supported.</p>';
      this.$('.effect-empty').hidden=plan.particles.some(p=>[2,5,102,103,107,162,165,166].includes(p.e.kind)&&plan.parts.get(p.part)?.supported);this.$('.effect-empty').textContent=plan.parts.size?'No supported visual layers':'No visual effect in this entry';
      if(this.$('.effect-textures').open)this.showTextures();
      this.draw();this.schedule();
    }catch(error){if(token===this.token)this.fail(error);}
  }
  selectEquipment(id,row,effect,effectRow){
    const equipment={id,row:row.slice(),effect,effectRow:effectRow?.slice()};this.equipment=equipment;
    this.$('.effect-equipment-mode').hidden=false;const options=this.$('.effect-equipment-mode select');options.value='attack';options.options[0].textContent=row[2]===22?'Shield push':'Weapon attack';this.previewEquipment(equipment);
  }
  async previewEquipment(equipment){
    if(!this.view){this.fail(this.setupError??new Error('WebGL2 is unavailable'));return;}
    const token=++this.token;this.previewKind='equipment';this.equipment=equipment;this.plan=null;this.equipmentMotion=null;this.motion.use(null);this.clearTextures();this.tick=0;this.last=null;this.$('[data-act="frame"]').disabled=true;
    this.$('.effect-version').hidden=true;this.$('.effect-inspect').hidden=true;this.$('.effect-phase').innerHTML='<option value="all">Attack animation</option>';this.$('.effect-part').innerHTML='<option value="all">Body &amp; equipment</option>';this.$('.effect-phase').disabled=true;this.$('.effect-part').disabled=true;
    this.$('.effect-empty').hidden=false;this.$('.effect-empty').textContent='Loading equipment animation…';this.$('.effect-status').textContent='Loading equipment animation…';this.draw();this.schedule();
    try{const motion=await this.motion.equipment(equipment.id,equipment.row);if(token!==this.token)return;this.equipmentMotion=motion;this.motion.use(motion);this.view.setScene(floor(this.motion.positions()));this.actorError=null;this.duration=motion.duration;this.$('.effect-seek').max=this.duration;this.$('.effect-empty').hidden=true;this.resetView();this.draw();this.schedule();}
    catch(error){if(token===this.token)this.fail(error);}
  }
  clear(message='No item use effect',equipment=null){
    this.previewKind=null;this.equipment=equipment;this.equipmentMotion=null;this.motion?.use(null);this.$('.effect-equipment-mode').hidden=!equipment;this.$('.effect-inspect').hidden=false;
    this.token++;this.plan=null;this.effect=null;this.row=null;this.tick=0;this.duration=120;this.clearTextures();this.view?.setScene(floor());this.$('[data-act="frame"]').disabled=true;
    this.$('.effect-version').hidden=true;
    this.$('.effect-status').textContent=message;this.$('.effect-empty').textContent=message;this.$('.effect-empty').hidden=false;
    this.$('.effect-source').textContent='';this.$('.effect-parts').replaceChildren();this.$('.effect-issues').replaceChildren();this.$('.effect-texture-list').replaceChildren();
    this.$('.effect-phase').innerHTML='<option value="all">All phases</option>';this.$('.effect-part').innerHTML='<option value="all">All layers</option>';
    this.draw();this.schedule();
  }
  clearTextures(){if(this.view)for(const t of this.textures.values())this.view.gl.deleteTexture(t);this.textures.clear();}
  resetView(){
    this.view.fit();this.view.yaw=DEFAULT_YAW;this.view.target=[3.5,1,3.5];
    // These native boss sequences use large, stage-positioned artwork. Frame
    // a fixed envelope once, so playback and scrubbing never pump the camera.
    if(this.plan&&this.casterTemplate===139){
      const times=new Set(this.plan.phases.map(p=>Math.min(this.duration,p.start+60)));
      for(let i=1;i<=8;i++)times.add(this.duration*i/10);
      this.frameEffect([...times]);
    }
  }
  frameEffect(times){
    if(!this.plan)return;
    const packets=[];
    for(const tick of times){
      const sample=sampleSpell(this.bank,this.plan,tick,{phase:this.$('.effect-phase').value,part:this.$('.effect-part').value,symbol:false,whiteFlashes:false});
      packets.push(...spellBillboards(this.view,this.textures,sample,{caster,target}));
    }
    const [right,up]=this.view.billboardAxes({upright:false}),forward=[Math.cos(this.view.pitch)*Math.sin(this.view.yaw),Math.sin(this.view.pitch),Math.cos(this.view.pitch)*Math.cos(this.view.yaw)];
    const rect=this.$('canvas').getBoundingClientRect(),fit=effectFrame(packets,{right,up,forward,aspect:rect.width/Math.max(1,rect.height)});
    if(fit){this.view.target=fit.target;this.view.radius=fit.radius;this.view.zoom=1;this.view.unitsPerPx=null;}
  }
  fail(error){this.$('.effect-status').textContent=`Cannot preview: ${error.message}`;this.$('.effect-empty').textContent='Effect unavailable';this.$('.effect-empty').hidden=false;this.playing=false;this.schedule();}
  showTextures(){
    const box=this.$('.effect-texture-list');box.replaceChildren();
    for(const t of this.plan?.textures.values()??[]){
      const figure=document.createElement('figure');
      try{const image=effectTexture(t.bank,t.id),c=textureCanvas(image);c.style.width='';c.style.height='';figure.append(c);}
      catch(error){figure.textContent=error.message;}
      const label=document.createElement('figcaption');label.textContent=t.key;figure.append(label);box.append(figure);
    }
    if(!box.children.length)box.textContent='This sequence has no decoded texture references.';
  }
  draw(){
    if(!this.view||this.destroyed)return;
    const duration=this.duration??120;this.$('.effect-seek').value=Math.floor(this.tick);this.$('.effect-time').textContent=`${Math.floor(this.tick)} / ${duration}`;
    const {caster,target}=this.motion?.positions()??{caster:[2.5,0,2.5],target:[4.5,0,4.5]};
    const casterLeft=(caster[0]-target[0])*Math.cos(this.view.yaw)-(caster[2]-target[2])*Math.sin(this.view.yaw)<0,labels=this.$('.effect-anchors').children;
    const first=this.equipmentMotion?'Target':'Caster',second=this.equipmentMotion?'Attacker':'Target';labels[0].textContent=casterLeft?first:second;labels[1].textContent=casterLeft?second:first;
    this.$('[data-act="play"]').textContent=this.playing?'Pause':'Play';this.$('[data-act="play"]').setAttribute('aria-label',this.playing?'Pause effect':'Play effect');
    let actors;try{actors=this.motion?.draw(this.tick)??[];}catch(error){this.actorError=error.message;actors=[];}
    this.root.dataset.actorAnimation=this.equipmentMotion?(this.equipmentMotion.shield?'shield':'weapon'):this.plan?'cast':'idle';
    if(this.equipmentMotion)this.$('.effect-status').textContent=`${this.equipmentMotion.shield?'Shield push':'Weapon attack'} · ${this.equipmentMotion.label} animation${this.equipmentMotion.projectile?.tracer?' · preview tracer':''}${this.actorError?' · '+this.actorError:''}`;
    let particles=this.equipmentMotion?this.motion.projectiles(this.tick):[];
    if(this.plan){
      const sample=sampleSpell(this.bank,this.plan,this.tick,{phase:this.$('.effect-phase').value,part:this.$('.effect-part').value,symbol:this.$('.effect-symbol').checked,whiteFlashes:this.$('.effect-white-flashes').checked});
      try{particles=spellBillboards(this.view,this.textures,sample,{caster,target});}
      catch(error){sample.issues.push(error.message);}
      for(const tint of sample.tints)if(actors[1])actors[1].flash=Math.min(1,tint.rgba[3]/128);
      const problems=this.plan.issues.size+sample.issues.length,selected=this.plan.parts.get(this.$('.effect-part').value);
      this.$('.effect-status').textContent=selected?.whiteFlash&&!this.$('.effect-white-flashes').checked?'Lighting panel is off · enable it under Inspect effect':selected&&!selected.supported?`${selected.name}: not yet rendered · see Inspect effect`:`${problems?'Partial preview':'Preview'} · ${particles.length} visible pieces${problems?' · see Inspect effect':''}${sample.issues.length?' · '+sample.issues[0]:''}`;
      this.root.dataset.effect=String(this.effect);this.root.dataset.frame=String(Math.floor(this.tick));this.root.dataset.particles=String(particles.length);
    }
    this.view.setBillboards([...actors.filter(Boolean),...particles]);
  }
  schedule(){
    const active=this.visible&&this.root.isConnected&&document.visibilityState!=='hidden'&&this.playing&&(this.plan||this.equipmentMotion)&&!this.destroyed;
    if(!active){if(this.frame)cancelAnimationFrame(this.frame);this.frame=null;this.last=null;return;}
    if(this.frame)return;
    this.frame=requestAnimationFrame(now=>{
      this.frame=null;if(this.last!==null)this.tick+=Math.min(100,now-this.last)*60/1000*Number(this.$('.effect-speed').value);this.last=now;
      if(this.tick>=this.duration){if(this.$('.effect-loop').checked)this.tick%=this.duration;else{this.tick=this.duration;this.playing=false;}}
      this.draw();this.schedule();
    });
  }
  dispose(){
    this.detach();this.destroyed=true;this.observer?.disconnect();document.removeEventListener('visibilitychange',this.visibility);
    this.motion?.dispose();this.clearTextures();for(const t of this.actorTextures)this.view?.gl.deleteTexture(t);this.view?.dispose();
  }
}

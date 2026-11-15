import {terrainLibrary,planTerrain,applyTerrainPlan,brushTiles} from '../game/terrainplanner.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateOf=(map,i)=>{const t=map.tiles[i];return {index:i,surface:t.surface,height:t.height,look:map.looks.get(i)};};
const same=(a,b)=>a.surface===b.surface&&a.height===b.height&&a.look===b.look;

export class MapBrush {
  constructor(editor){this.ed=editor;this.kind=null;this.size=1;this.height=null;this.seed=0;this.enabled=false;this.histories=new WeakMap();this.donorId='';this.donor=null;this.note='Choose terrain, then turn on Paint.';}
  get active(){return this.ed.tab==='brush'&&this.enabled&&!this.ed.ctx.readOnly();}
  history(){let h=this.histories.get(this.ed.map);if(!h){h={done:[],undone:[]};this.histories.set(this.ed.map,h);}return h;}
  render(box){
    if(!this.ed.map)return;
    const library=terrainLibrary(this.ed.map),map=this.ed.map;
    if(this.donor&&this.donor.id===map.id){this.donor=null;this.donorId='';}
    // terrains this map can paint: its own flat samples, plus the donor's where this map has a code for them
    const byKind=new Map(library.byKind);
    if(this.donor)for(const [k,list] of terrainLibrary(this.donor).byKind)if(!byKind.has(k)&&list.some(s=>s.corners)&&map.materials.some(m=>m.kind===k&&m.object===null))byKind.set(k,list);
    const kinds=[...byKind].sort((a,b)=>a[0]-b[0]);
    const donors=this.ed.ctx.catalog.maps.filter(m=>m.id!==map.id).map(m=>{const place=this.ed.ctx.catalog.placeLabel(m.id);return `<option value="${esc(m.id)}" ${m.id===this.donorId?'selected':''}>${esc(m.id)}${place?` · ${esc(place)}`:''}</option>`;}).join('');
    if(!kinds.some(([k])=>k===this.kind))this.kind=kinds[0]?.[0]??null;
    const ro=this.ed.ctx.readOnly(),h=this.history();
    box.innerHTML=`<div class="mp-brush">
      <h2>Terrain brush</h2>
      <p class="hint">Paint ground from this map. The planner updates nearby edges and chooses stable variations. Buildings, stairs, copied art and occupied object tiles are protected.</p>
      <label class="field"><span class="field-label">Terrain</span><select id="mp-brush-kind">${kinds.map(([k,list])=>`<option value="${k}" ${k===this.kind?'selected':''}>${esc(this.ed.kindName(k))} · ${new Set(list.map(s=>s.key)).size} looks</option>`).join('')}</select></label>
      <label class="field" title="When this map has no edge piece for a border you paint, a piece with exactly that border is copied from the chosen map into this map's texture atlas."><span class="field-label">Borrow missing edges from</span><select id="mp-brush-donor"><option value="">Nothing: this map's pieces only</option>${donors}</select></label>
      <label class="field"><span class="field-label">Brush size</span><select id="mp-brush-size">${[1,3,5].map(n=>`<option value="${n}" ${n===this.size?'selected':''}>${n} × ${n} tiles</option>`).join('')}</select></label>
      <label class="check"><input id="mp-brush-set-height" type="checkbox" ${this.height!==null?'checked':''}> Set height while painting</label>
      <label class="field"><span class="field-label">Height (game shows +1)</span><input id="mp-brush-height" type="number" min="0" max="60" value="${this.height??0}" ${this.height===null?'disabled':''}></label>
      <div class="mp-tools"><button id="mp-brush-enable" class="${this.enabled?'on':''}" ${ro||!kinds.length?'disabled':''}>${this.enabled?'Paint on':'Turn on Paint'}</button><button id="mp-brush-selection" ${ro||!kinds.length||!this.ed.selected.size?'disabled':''}>Paint selected</button></div>
      <div class="mp-tools"><button id="mp-brush-undo" ${ro||!h.done.length?'disabled':''}>Undo stroke</button><button id="mp-brush-redo" ${ro||!h.undone.length?'disabled':''}>Redo stroke</button><button id="mp-brush-variation">New variation</button></div>
      <p class="hint">With Paint on: left-drag paints; Shift-drag or right-drag pans. Turn Paint off to select or orbit. A stroke can be undone here.</p>
      <p class="hint" id="mp-brush-note">${esc(this.note)}</p>
      <p class="hint">Edge choices are learned from this map's original pieces. Unmatched borders are reported as approximate. Water is one terrain choice; its animation frames stay grouped.</p>
    </div>`;
    const $=s=>box.querySelector(s);
    $('#mp-brush-kind').onchange=e=>this.kind=Number(e.target.value);
    $('#mp-brush-donor').onchange=async e=>{this.donorId=e.target.value;this.donor=null;if(this.donorId){this.note='Reading that map…';try{this.donor=await this.ed.sourceMap(this.donorId);this.note=`Missing edge pieces now come from ${this.donorId}.`;}catch(err){this.donorId='';this.note=`Can't open that map: ${err.message}`;}}else this.note='Using only the pieces of this map.';if(this.ed.tab==='brush')this.render(box);};
    $('#mp-brush-size').onchange=e=>this.size=Number(e.target.value);
    $('#mp-brush-set-height').onchange=e=>{this.height=e.target.checked?0:null;this.render(box);};
    $('#mp-brush-height').onchange=e=>{this.height=Math.max(0,Math.min(60,Math.round(Number(e.target.value)||0)));e.target.value=this.height;};
    $('#mp-brush-enable').onclick=()=>{this.enabled=!this.enabled;this.render(box);};
    $('#mp-brush-selection').onclick=()=>{this.begin();this.paint([...this.ed.selected]);this.end();};
    $('#mp-brush-undo').onclick=()=>this.undo(false);
    $('#mp-brush-redo').onclick=()=>this.undo(true);
    $('#mp-brush-variation').onclick=()=>{this.seed++;this.note='New variation selected for the next stroke.';this.render(box);};
  }
  begin(tile=null){
    if(this.ed.ctx.readOnly()||this.stroke)return;
    const map=this.ed.map;
    this.stroke={map,before:map.tiles.map((_,i)=>stateOf(map,i)),indices:new Set(),last:tile,approximate:[],skipped:[]};
    if(tile)this.move(tile);
  }
  move(tile){
    if(!this.stroke||!tile||this.stroke.map!==this.ed.map)return;
    const from=this.stroke.last??tile;this.stroke.last=tile;
    this.paint(brushTiles(this.ed.map,from,tile,this.size));
  }
  paint(indices){
    const s=this.stroke;if(!s||this.ed.ctx.readOnly())return;
    if(indices.every(i=>s.indices.has(i)))return;
    for(const i of indices)s.indices.add(i);
    try{
      const plan=planTerrain(s.map,[...s.indices],{kind:this.kind,height:this.height,seed:this.seed,donor:this.donor});
      const before=plan.changes.map(c=>stateOf(s.map,c.index));
      applyTerrainPlan(s.map,plan);
      try{
        if(s.map.rebuilt().model.verts.length/36>65535)throw new Error('This stroke exceeds the map geometry limit. Use a smaller height change.');
      }catch(err){applyTerrainPlan(s.map,{changes:before});s.map.fixMaxHeight();throw err;}
      s.approximate=plan.approximate;s.skipped=plan.skipped;
      if(plan.borrowed)this.ed.refreshAtlas();
      this.ed.files.set(s.map.id,s.map);this.ed.showModel();this.ed.view?.refreshObjects();this.ed.ctx.onChange();
      this.note=`${plan.painted.length} painted tiles · ${plan.approximate.length} approximate borders · ${plan.skipped.length} protected tiles skipped${plan.borrowed?` · ${plan.borrowed} edge pieces from ${this.donorId}`:''}${plan.borrowError?` · could not borrow: ${plan.borrowError}`:''}`;
      const note=this.ed.root.querySelector('#mp-brush-note');if(note)note.textContent=this.note;
    }catch(err){this.ed.ctx.toast(err.message,true);}
  }
  end(){
    const s=this.stroke;if(!s)return;this.stroke=null;
    const before=[],after=[];
    for(const a of s.before){const b=stateOf(s.map,a.index);if(!same(a,b)){before.push(a);after.push(b);}}
    if(before.length){const h=this.history();h.done.push({before,after});if(h.done.length>40)h.done.shift();h.undone=[];}
    if(!s.map.dirty)this.ed.files.delete(s.map.id);
    this.ed.renderList();this.ed.refresh();this.ed.renderSide();
  }
  undo(redo=false){
    if(this.ed.ctx.readOnly()||this.stroke)return;
    const h=this.history(),from=redo?h.undone:h.done,to=redo?h.done:h.undone,op=from.at(-1);if(!op)return;
    const expected=redo?op.before:op.after,next=redo?op.after:op.before;
    if(expected.some(s=>!same(s,stateOf(this.ed.map,s.index)))){h.done=[];h.undone=[];this.note='Stroke history cleared because these tiles were edited with another tool.';this.ed.renderSide();return;}
    applyTerrainPlan(this.ed.map,{changes:next});this.ed.map.fixMaxHeight();from.pop();to.push(op);
    if(this.ed.map.dirty)this.ed.files.set(this.ed.map.id,this.ed.map);else this.ed.files.delete(this.ed.map.id);
    this.note=redo?'Stroke restored.':'Stroke undone.';this.ed.showModel();this.ed.view?.refreshObjects();this.ed.ctx.onChange();this.ed.renderList();this.ed.refresh();this.ed.renderSide();
  }
}

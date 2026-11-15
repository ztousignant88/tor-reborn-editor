import {groundLook} from '../game/lookimport.js';
import {sideThumb} from '../ui/sidethumb.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class MapSides {
  constructor(editor){this.ed=editor;this.source=null;this.facing='all';this.role='all';}
  render(box){
    const ed=this.ed,map=ed.map;if(!map)return;
    const sources=[];
    for(const tile of map.tiles){const look=groundLook(map,tile.index);if(look.templates.some(byFace=>byFace&&Object.keys(byFace).length))sources.push({tile,look});}
    if(!sources.some(s=>s.tile.index===this.source))this.source=sources[0]?.tile.index??null;
    const disabled=ed.ctx.readOnly()||!ed.selected.size||this.source===null;
    box.innerHTML=`<div class="mp-brush">
      <h2>Block sides</h2>
      <p class="hint">Change cliff and wall artwork separately from the top. Select tiles in the map, then choose a side sample. The visible side belongs to the higher tile.</p>
      <label class="field"><span class="field-label">Side sample from this map</span><select id="mp-side-source">${sources.map(({tile,look})=>`<option value="${tile.index}" ${tile.index===this.source?'selected':''}>${esc(ed.kindName(map.materials[map.originalTile(tile.index).surface]?.kind))} · ${tile.x}, ${tile.y} · ${look.templates.filter(Boolean).length} steps</option>`).join('')}</select></label>
      <div id="mp-side-previews" class="mp-side-previews"></div>
      <label class="field"><span class="field-label">Faces to change</span><select id="mp-side-facing">${[['all','All exposed faces'],['N','North (−Y)'],['E','East (+X)'],['S','South (+Y)'],['W','West (−X)']].map(([v,label])=>`<option value="${v}" ${v===this.facing?'selected':''}>${label}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Height section</span><select id="mp-side-role">${[['all','Top, middle and bottom'],['cap','Top edge only'],['body','Middle only'],['foot','Bottom only']].map(([v,label])=>`<option value="${v}" ${v===this.role?'selected':''}>${label}</option>`).join('')}</select></label>
      <div class="mp-tools"><button id="mp-side-apply" ${disabled?'disabled':''}>Apply to selected sides</button><button id="mp-side-reset" ${ed.ctx.readOnly()||!ed.selected.size?'disabled':''}>Reset selected sides</button></div>
      <p class="hint">${ed.selected.size} selected tiles · ${map.wallLooks.size} tiles with side overrides. Height and top artwork stay as they are.</p>
      <p class="hint">Samples bring their top, middle and bottom wall pieces. When a direction or section has no exact sample, the closest available piece is used and reported. Reset returns to automatic side selection.</p>
    </div>`;
    const $=s=>box.querySelector(s);
    $('#mp-side-source').onchange=e=>{this.source=Number(e.target.value);this.render(box);};
    $('#mp-side-facing').onchange=e=>this.facing=e.target.value;
    $('#mp-side-role').onchange=e=>this.role=e.target.value;
    $('#mp-side-apply').onclick=()=>this.apply(false);
    $('#mp-side-reset').onclick=()=>this.apply(true);
    const sample=sources.find(s=>s.tile.index===this.source)?.look.templates??[];
    const depths=[...new Set([0,Math.floor((sample.length-1)/2),sample.length-1])].filter(d=>d>=0);
    for(const depth of depths)for(const [face,quad] of Object.entries(sample[depth]??{})){
      const picture=document.createElement('div'),label=document.createElement('span');
      label.textContent=`${face} · ${depth===0?'top':depth===sample.length-1?'bottom':'middle'}`;
      picture.append(sideThumb(map,quad),label);$('#mp-side-previews').append(picture);
    }
  }
  apply(reset){
    const ed=this.ed;if(ed.ctx.readOnly()||!ed.selected.size)return;
    const before=new Map(ed.map.wallLooks),key=`${this.facing}:${this.role}`;
    for(const i of ed.selected){
      if(reset)ed.map.wallLooks.delete(i);
      else ed.map.wallLooks.set(i,{...ed.map.wallLooks.get(i),[key]:this.source});
    }
    try{if(ed.map.rebuilt().model.verts.length/36>65535)throw new Error('These side edits exceed the map geometry limit.');}
    catch(err){ed.map.wallLooks=before;ed.ctx.toast(err.message,true);return;}
    if(ed.map.dirty)ed.files.set(ed.map.id,ed.map);else ed.files.delete(ed.map.id);
    ed.showModel();ed.ctx.onChange();ed.renderList();ed.refresh();ed.renderSide();
  }
}

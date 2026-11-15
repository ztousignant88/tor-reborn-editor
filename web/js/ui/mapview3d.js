// 3D map view: the real battle map (SceneView) with unit tokens drawn on a
// 2D overlay. Same handler interface as the 2D MapView:
// onSelectUnit(slot), onMoveUnit(slot, x, y), onSelectTile(tile, {shift, ctrl}), onHover({tile, unit}),
// and onDropTile(tile, dataTransfer) for things dragged onto the map from a palette.
// setMarks() outlines selected tiles and shows edited heights as columns
// (raised: amber, lowered: red), since the map's own model doesn't move.
// Controls: drag a unit to move it, drag empty space to orbit, right-drag or
// shift-drag to pan, wheel to zoom.

import { HEIGHT_UNIT } from '../game/bgscene.js';
import { loadActorFrame, loadActorPoses } from '../game/unitsprites.js';
import { facingPose, walkFrame } from '../game/actorposes.js';
import { actionImages, sampleAction } from '../game/sceneanimations.js';
import { objectFrameAt } from '../game/objectsprites.js';
import { loadBattleBodyAction,loadBattleWeaponAction, weaponBodyAction,effectBodyAction } from '../game/battleactions.js';
import {composeWeaponAction} from '../game/weaponactions.js';
import {loadSpellEffects,loadEffectPlan,sampleSpell,spellBillboards} from '../game/spelleffects.js';
import { SceneView } from './scene3d.js';
import { TEAM_COLORS, drawToken } from './tokens.js';

const OBJECT_HEIGHT = 2; // destructible objects stand 2 height steps tall
const OBJECT_COLOR = [124, 98, 71];
const OBJECT_SPRITE_SIZE = 1.3;   // world units covered by a 128x128 object sprite
const OBJECT_PIVOT = 0.2;         // object sprites stand on a point 20% up from their bottom edge
const UNIT_PIXEL = 1 / 64;        // screenshot-calibrated sprite pixels per tile world unit
const UNIT_PIVOT = 0.04;
// Facing as a tile-space direction (0 east, 1 south, 2 west, 3 north).
const FACING_DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export class MapView3D {
  /** handlers.paletteColors(index) -> 256 RGBA colours for a palette index. */
  constructor(glCanvas, overlay, handlers) {
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.handlers = handlers;
    this.view = new SceneView(glCanvas, { onRender: () => this.drawOverlay() });
    this.grid = null;
    this.units = [];
    this.selected = null;
    this.hover = null;
    this.drag = null;
    this.objectBillboards = [];
    this.actorTextures = new Map(); // "actor:palette" -> {texture, width, height} | {placeholder} | null
    this.actionTextures = new Map();
    this.showSprites = true;
    this.marks = { selected: new Set(), changed: new Map() }; // tile index -> {from, to}
    this.bindEvents();
  }

  setScene(scene, grid) {
    this.grid = grid;
    this.view.setScene(scene);
    for (const pack of this.objectTextures?.values() ?? []) for (const f of pack.frames) if (f) this.view.gl.deleteTexture(f.texture);
    this.objectClockStart = performance.now();
    this.objectTextures = new Map();
    for (const [id, tex] of scene.objectSprites) this.objectTextures.set(id, this.makeObjectTexture(tex));
    this.refreshObjects();
  }

  /** Rebuild object sprites and boxes from the grid (after tile edits). */
  refreshObjects() {
    const grid = this.grid;
    const boxes = [];
    this.objectBillboards = [];
    for (const t of grid.tiles) {
      if (t.object === null) continue;
      const pack = this.objectTextures.get(t.object);
      if (pack) {
        const base = { x: t.x + 0.5, y: t.height * HEIGHT_UNIT, z: t.y + 0.5 };
        const sample = (now) => {
          if (!pack.sprite) return {...base,...pack.frames[0]};
          const state = objectFrameAt(pack.sprite,(now-this.objectClockStart)*60/1000);
          if (!state) return null;
          const frame = pack.frames[state.index], pixel = OBJECT_SPRITE_SIZE/128;
          const pivotX = state.flip ? 1-state.pivotX : state.pivotX;
          const side = (0.5-pivotX)*frame.width + state.x*pixel;
          return {...base,texture:frame.texture,width:frame.width,height:frame.height,
            x:base.x+Math.cos(this.view.yaw)*side,z:base.z-Math.sin(this.view.yaw)*side,
            pivot:(state.flipY?1-state.pivot:state.pivot)+state.y/state.height,flip:state.flip,flipY:state.flipY};
        };
        const initial = sample(this.objectClockStart ?? performance.now());
        if (initial) this.objectBillboards.push({...initial,sample,animated:!!pack.sprite?.animated});
      } else {
        boxes.push({
          x0: t.x + 0.22, x1: t.x + 0.78, z0: t.y + 0.22, z1: t.y + 0.78,
          y0: t.height * HEIGHT_UNIT, y1: (t.height + OBJECT_HEIGHT) * HEIGHT_UNIT, color: OBJECT_COLOR,
        });
      }
    }
    this.objectBoxes = boxes;
    this.view.setBoxes([...boxes, ...this.markBoxes()]);
    this.updateBillboards();
  }

  /** Upload each native frame, keeping its proper height and tile-foot origin. */
  makeObjectTexture(tex) {
    const sprite = tex.objectSprite;
    if (!sprite) return {frames:[{texture:this.view.makeTexture(tex),width:OBJECT_SPRITE_SIZE,height:OBJECT_SPRITE_SIZE,pivot:OBJECT_PIVOT}]};
    const pixel = OBJECT_SPRITE_SIZE/128;
    return {sprite,frames:sprite.frames.map(f=>f?{texture:this.view.makeTexture(f.image),width:f.width*pixel,height:f.height*pixel}:null)};
  }

  /** An object picture copied in from another map (map editor). */
  addObjectTexture(type, tex) {
    if (!this.objectTextures.has(type)) this.objectTextures.set(type, this.makeObjectTexture(tex));
  }

  /** Show a rebuilt terrain model (map editor). */
  setTerrain(mesh) { this.view.setTerrain(mesh); }

  /** selected: Set of tile indices; changed: Map tile index -> {from, to} heights; columns: draw height changes as boxes. */
  setMarks(marks) {
    this.marks = marks;
    this.view.setBoxes([...(this.objectBoxes ?? []), ...this.markBoxes()]);
    this.view.render();
  }

  markBoxes() {
    const out = [];
    for (const [i, { from, to }] of this.marks.changed) {
      if (from === to || !this.grid || !this.marks.columns) continue;
      const t = this.grid.tiles[i];
      const lo = Math.min(from, to) * HEIGHT_UNIT, hi = Math.max(from, to) * HEIGHT_UNIT;
      out.push({ x0: t.x + 0.04, x1: t.x + 0.96, z0: t.y + 0.04, z1: t.y + 0.96, y0: lo, y1: hi + 0.002, color: to > from ? [214, 168, 70] : [168, 64, 58] });
    }
    return out;
  }

  setStartTiles(tiles) { this.startTiles = tiles; }

  setUnits(units, selected) {
    this.units = units;
    this.selected = selected;
    for (const u of units) this.requestSprite(u);
    if(units.some(u=>u.spellAnimation)&&!this.spellLoad){
      this.spellLoad=loadSpellEffects().then(bank=>{this.spellBank=bank;this.spellPlans=new Map();this.spellTextures=new Map();this.updateBillboards();})
        .catch(e=>console.warn('spell effects preview:',e));
    }
    this.updateBillboards();
  }

  spriteKey(u) { return `${u.actor}:${u.palette ?? 0}`; }

  clearActionTextures() {
    for (const frames of this.actionTextures.values()) for (const f of frames ?? []) if (f) this.view.gl.deleteTexture(f.texture);
    this.actionTextures.clear();
  }

  actionFrames(resource, u, anchor) {
    const key = `${resource.key}:${u.palette ?? 0}:${anchor?.x ?? 0}:${anchor?.y ?? 8}`;
    if (!this.actionTextures.has(key)) {
      try {
        const frames = actionImages(resource, anchor, this.handlers.paletteColors?.(u.palette ?? 0) ?? undefined);
        this.actionTextures.set(key, frames.map(f => f && ({ ...f, rgba: undefined,
          texture: this.view.makeTexture({ width: f.width, height: f.height, format: 0, data: f.rgba }, { pixelated: true }) })));
      } catch (error) { console.warn(`scene animation ${resource.id}:`, error); this.actionTextures.set(key, null); }
    }
    return this.actionTextures.get(key);
  }

  requestSprite(u) {
    this.requestBodyAction(u);
    const key = this.spriteKey(u);
    if (!u.actor || this.actorTextures.has(key)) return;
    this.actorTextures.set(key, null);
    const loader = this.handlers.directionalSprites ? loadActorPoses : loadActorFrame;
    loader(u.actor, this.handlers.paletteColors?.(u.palette ?? 0) ?? undefined).then((frame) => {
      if (!frame) return;
      if (frame.placeholder) {
        this.actorTextures.set(key, { placeholder: true, name: frame.name });
      } else if (frame.frames) {
        const frames = new Map([...frame.frames].map(([id, f]) => [id, {
          texture: this.view.makeTexture({ width: f.width, height: f.height, format: 0, data: f.rgba }, { pixelated: true }),
          width: f.width, height: f.height, pivot: f.pivot, pivotX: f.pivotX,
        }]));
        this.actorTextures.set(key, { poses: { ...frame, frames } });
      } else {
        const texture = this.view.makeTexture({ width: frame.width, height: frame.height, format: 0, data: frame.rgba }, { pixelated: true });
        this.actorTextures.set(key, { texture, width: frame.width, height: frame.height,pivot:frame.pivot,pivotX:frame.pivotX });
      }
      this.updateBillboards();
    });
  }

  bodyKey(u) { return u.flying ? `${u.actor}:flight` : u.bodyAnimation ? `${u.actor}:${u.palette??0}:${u.bodyAnimation.kind}:${u.bodyAnimation.action??u.bodyAnimation.weapon??''}:${(u.weapons??[]).join(',')}` : null; }

  requestBodyAction(u) {
    const key=this.bodyKey(u);if(!key||!u.actor)return;
    this.bodyResources??=new Map();this.pendingBodyResources??=new Map();
    if(this.bodyResources.has(key))return this.pendingBodyResources.get(key)??Promise.resolve(this.bodyResources.get(key));
    this.bodyResources.set(key,null);
    const pending=(async()=>{
      let action=u.flying?8:u.bodyAnimation?.action,weapon;
      if(u.bodyAnimation?.kind==='cast')action=await effectBodyAction(u.bodyAnimation.effect);
      if(u.bodyAnimation?.kind==='weapon'){
        weapon=u.bodyAnimation.weapon>0?u.bodyAnimation.weapon:(u.weapons??[]).find(w=>w>0&&w<999);
        action=await weaponBodyAction(weapon);
      }
      if(action==null)return;
      let r=await loadBattleBodyAction(u.actor,action);if(!r)return;
      if(weapon){
        const overlay=await loadBattleWeaponAction(weapon);
        if(overlay)try{r=composeWeaponAction(r,overlay,this.handlers.paletteColors?.(u.palette??0)??undefined);}
        catch(error){console.warn('weapon overlay preview:',error);}
      }
      // Humans have no wing frames. Retain their walking artwork in flight.
      const frames=actionImages(r,undefined,this.handlers.paletteColors?.(u.palette??0)??undefined);
      if(!frames.some(f=>f?.rgba.some((v,i)=>i%4===3&&v)))return;
      this.bodyResources.set(key,r);this.updateBillboards();return r;
    })().catch(e=>{console.warn('battle body preview:',e);return null;});
    this.pendingBodyResources.set(key,pending);return pending;
  }

  /** Billboard for a unit, or null while its sprite loads (or if it has none). */
  unitBillboard(u) {
    let sprite = this.showSprites ? this.actorTextures.get(this.spriteKey(u)) : null;
    if (!sprite && this.showSprites && !u.actor && u.sceneAnimation?.definition) sprite = { standalone: true };
    const canWalk=!!sprite?.poses;
    u.actionHidden = false;
    u.placeholder = !!sprite?.placeholder;
    if (!sprite || !this.grid || (sprite.placeholder && !u.sceneAnimation?.definition)) return null;
    const t = this.grid.tileAt(Math.round(u.x), Math.round(u.y)); // x/y may be fractional mid-walk
    // Preserve the legacy battle preview's mirroring. Cutscene poses below
    // resolve each front/back image's native orientation separately.
    const [dx, dz] = FACING_DIR[u.facing] ?? [0, 1];
    const screenX = dx * Math.cos(this.view.yaw) - dz * Math.sin(this.view.yaw);
    const pose = facingPose(u.facing, this.view.yaw, sprite.poses?.singleView);
    let action = null;
    const body=this.bodyResources?.get(this.bodyKey(u));
    const resource=u.flying?body:!u.walking?(u.sceneAnimation??body):null;
    if (resource?.definition) {
      const facing = facingPose(u.facing, this.view.yaw);
      const direction = facing.view === 'front' ? (facing.flip ? 1 : 0) : (facing.flip ? 3 : 2);
      action = sampleAction(resource.definition, direction, u.flying?u.walkTick??0:u.animationTick??0);
      if (action?.hidden) { u.actionHidden = true; return null; }
      const frames = action && this.actionFrames(resource, u, sprite.standalone ? { x: 0, y: 0 } : sprite.poses?.anchor);
      if (frames?.[action.frame]) { sprite = frames[action.frame]; u.placeholder = false; }
      else action = null;
    }
    if (!action && sprite.poses) {
      const p = sprite.poses;
      const id = u.walking ? walkFrame(p[pose.view], u.walkTick ?? 0) : p.idle[pose.view];
      sprite = p.frames.get(id);
    }
    if (sprite.placeholder || sprite.standalone) return null;
    const flip = action ? action.flip : this.handlers.directionalSprites ? pose.flip : screenX > 0;
    const width = sprite.width * UNIT_PIXEL;
    const pivotX = flip ? 1 - (sprite.pivotX ?? 0.5) : (sprite.pivotX ?? 0.5);
    const offset = (0.5 - pivotX) * width;
    let ox = Math.cos(this.view.yaw) * offset, oy = 0, oz = -Math.sin(this.view.yaw) * offset, screenPivotY = 0;
    if (action?.space === 'screen') {
      ox += Math.cos(this.view.yaw) * action.x * UNIT_PIXEL;
      oz -= Math.sin(this.view.yaw) * action.x * UNIT_PIXEL;
      // A 2D action offset moves the artwork around its floor anchor. Keep
      // that anchor fixed so seated/fallen pixels receive floor-plane depth.
      screenPivotY = action.y / sprite.height;
    } else if (action) {
      // Preview conversion for native forward/side/elevation offsets. The
      // editor's world/pixel scale still needs an exact in-game calibration.
      ox += (dx * action.x - dz * action.y) * UNIT_PIXEL;
      oz += (dz * action.x + dx * action.y) * UNIT_PIXEL;
      oy -= action.z * UNIT_PIXEL;
    }
    const pivot = sprite.pivot ?? UNIT_PIVOT;
    return {
      texture: sprite.texture, x: u.x + 0.5 + ox,
      y: (u.worldHeight ?? (t ? t.height : 0) * HEIGHT_UNIT) + (u.heightOffset??0) + oy, z: u.y + 0.5 + oz,
      width, height: sprite.height * UNIT_PIXEL, pivot: (action?.flipY ? 1 - pivot : pivot) + screenPivotY, flip, flipY: !!action?.flipY,
      upright: true,
      spritePriority: resource === u.sceneAnimation ? action?.priority ?? 0 : 0,
      // The battle roster uses the native walking sequence without moving tiles.
      // SceneView's ambient clock stops itself for hidden viewers/tabs.
      ...(this.handlers.walkInPlace && canWalk && !u.walking && !u.bodyAnimation && !u.sceneAnimation && !u.flying && !u.isProp ? {
        animated:true, sample:now=>this.unitBillboard({...u,walking:true,walkTick:now*60/1000}),
      } : {}),
      shadow: !u.isProp ? {x:u.x+0.5,y:(t?t.height:0)*HEIGHT_UNIT+0.003,z:u.y+0.5,
        radius:Math.max(0.18,Math.min(0.38,width*0.22))} : null,
    };
  }

  updateBillboards() {
    const units = this.units.map((u) => ({ u, b: this.unitBillboard(u) })).filter((x) => x.b);
    if (units.some(({ b }) => b.spritePriority)) {
      // Keep terrain occlusion available without letting one cast sprite's
      // depth plane erase another sprite that the animation puts in front.
      for (const { b } of units) b.depthWrite = false;
    }
    for (const x of units) x.u.billboard = x.b;
    for (const u of this.units) if (!units.some((x) => x.u === u)) u.billboard = null;
    const particles=this.spellBillboards(units);
    this.view.setBillboards([...this.objectBillboards, ...units.map((x) => x.b),...particles]);
  }

  spellBillboards(units){
    if(!this.spellBank||!this.showSprites)return [];
    const out=[];
    for(const u of this.units){
      const a=u.spellAnimation;if(!a)continue;
      try{
        const casterTemplate=u.slot===139?139:0,key=`${a.effect}:${casterTemplate}`;
        if(!this.spellPlans.has(key)){
          this.spellPlans.set(key,null);
          loadEffectPlan(this.spellBank,a.effect,undefined,{casterTemplate}).then(plan=>{this.spellPlans.set(key,plan);this.updateBillboards();})
            .catch(error=>{this.spellPreviewError=error;console.warn('spell preview:',error);});
        }
        const plan=this.spellPlans.get(key);if(!plan)continue;
        const sample=sampleSpell(this.spellBank,plan,u.animationTick);
        const target=units.find(x=>Math.round(x.u.x)===a.x&&Math.round(x.u.y)===a.y);
        for(const tint of sample.tints)if(target)target.b.flash=Math.max(target.b.flash??0,Math.min(1,tint.rgba[3]/128));
        const point=(x,y)=>[x+0.5,(this.grid?.tileAt(Math.round(x),Math.round(y))?.height??0)*HEIGHT_UNIT,y+0.5];
        out.push(...spellBillboards(this.view,this.spellTextures,sample,{caster:point(u.x,u.y),target:point(a.x,a.y)}));
      }catch(error){if(!this.spellPreviewError){this.spellPreviewError=error;console.warn('spell preview:',error);}}
    }
    return out;
  }

  render() { this.view.render(); }
  fitView() { this.view.fit(); }

  rotate(step) {
    // snap to the nearest diagonal, then turn by 90°
    const q = Math.round((this.view.yaw - Math.PI / 4) / (Math.PI / 2)) + step;
    this.view.yaw = Math.PI / 4 + q * (Math.PI / 2);
    this.updateBillboards(); // sprite mirroring depends on the view direction
  }

  // ---- geometry -------------------------------------------------------
  tileTop(t) {
    const h = (t.height + (t.object !== null ? OBJECT_HEIGHT : 0)) * HEIGHT_UNIT;
    return [t.x + 0.5, h, t.y + 0.5];
  }

  tilePolygon(t, vp) {
    const y = t.height * HEIGHT_UNIT;
    return [[t.x, y, t.y], [t.x + 1, y, t.y], [t.x + 1, y, t.y + 1], [t.x, y, t.y + 1]].map((p) => this.view.project(p, vp));
  }

  tileAt(mx, my) {
    if (!this.grid) return null;
    const vp = this.view.viewProj();
    let best = null;
    let nearest = null;
    for (const t of this.grid.tiles) {
      const poly = this.tilePolygon(t, vp);
      if (pointInPoly(mx, my, poly)) {
        const depth = poly.reduce((s, p) => s + p.depth, 0) / 4;
        if (!best || depth < best.depth) best = { t, depth };
      } else if (!best) {
        // Cursor over a cliff face or gap: fall back to the closest tile centre.
        const cx = poly.reduce((s, p) => s + p.x, 0) / 4, cy = poly.reduce((s, p) => s + p.y, 0) / 4;
        const span = Math.hypot(poly[0].x - poly[2].x, poly[0].y - poly[2].y);
        const d = Math.hypot(mx - cx, my - cy);
        if (d < span * 0.75 && (!nearest || d < nearest.d)) nearest = { t, d };
      }
    }
    return best?.t ?? nearest?.t ?? null;
  }

  /** The four corners of tile `t`'s wall on `face` (N, E, S, W), from the neighbour's height up to its own; null when no wall shows. */
  sidePolygon(t, face, vp, depth = null) {
    const [dx, dy] = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[face];
    const low = this.grid.tileAt(t.x + dx, t.y + dy)?.height ?? 0;
    if (low >= t.height) return null;
    const [a, b] = { N: [[t.x, t.y], [t.x + 1, t.y]], E: [[t.x + 1, t.y], [t.x + 1, t.y + 1]], S: [[t.x + 1, t.y + 1], [t.x, t.y + 1]], W: [[t.x, t.y + 1], [t.x, t.y]] }[face];
    // depth: one height step of the wall, counted from the top (0 = the step under the top)
    const top = (depth === null ? t.height : t.height - depth) * HEIGHT_UNIT, base = (depth === null ? low : t.height - depth - 1) * HEIGHT_UNIT;
    return [[a[0], top, a[1]], [b[0], top, b[1]], [b[0], base, b[1]], [a[0], base, a[1]]].map((p) => this.view.project(p, vp));
  }

  /** The wall face under the cursor, { tile, face }, when it is nearer than any tile top there; else null. */
  sideAt(mx, my) {
    if (!this.grid) return null;
    const vp = this.view.viewProj();
    let best = null, top = Infinity;
    for (const t of this.grid.tiles) {
      const poly = this.tilePolygon(t, vp);
      if (pointInPoly(mx, my, poly)) top = Math.min(top, poly.reduce((s, p) => s + p.depth, 0) / 4);
      for (const face of ['N', 'E', 'S', 'W']) {
        const side = this.sidePolygon(t, face, vp);
        if (!side || !pointInPoly(mx, my, side)) continue;
        const depth = side.reduce((s, p) => s + p.depth, 0) / 4;
        if (!best || depth < best.depth) best = { tile: t, face, depth };
      }
    }
    if (!best || best.depth >= top) return null;
    // which height step of that wall: the piece under the cursor
    const { tile, face } = best;
    const [dx, dy] = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[face];
    const steps = tile.height - (this.grid.tileAt(tile.x + dx, tile.y + dy)?.height ?? 0);
    let step = 0;
    for (let d = 0; d < steps; d++) { const piece = this.sidePolygon(tile, face, vp, d); if (piece && pointInPoly(mx, my, piece)) { step = d; break; } }
    return { tile, face, depth: step, steps };
  }

  pickUnit(mx, my) {
    for (let i = this.drawn?.length - 1; i >= 0; i--) {
      const d = this.drawn[i];
      if (Math.hypot(mx - d.x, my - d.y) <= d.r + 2) return d.unit;
      const q = d.rect;
      if (q && mx >= q.x0 && mx <= q.x1 && my >= q.y0 && my <= q.y1) return d.unit;
    }
    return null;
  }

  // ---- overlay --------------------------------------------------------
  drawOverlay() {
    const c = this.overlay;
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!this.grid) return;
    const vp = this.view.viewProj();

    const outline = (t, color) => {
      const poly = this.tilePolygon(t, vp);
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    for (const p of this.startTiles ?? []) {
      const t = this.grid.tileAt(p.x,p.y);if (!t) continue;
      const poly = this.tilePolygon(t,vp);ctx.beginPath();
      poly.forEach((q,i) => i ? ctx.lineTo(q.x,q.y) : ctx.moveTo(q.x,q.y));ctx.closePath();
      ctx.fillStyle='rgba(60,220,235,0.2)';ctx.fill();ctx.strokeStyle='#65e7f0';ctx.lineWidth=2;ctx.stroke();
    }
    for (const i of this.marks.selected) { const t = this.grid.tiles[i]; if (t) outline(t, '#f3c76b'); }
    for (const [i] of this.marks.changed) { const t = this.grid.tiles[i]; if (t && !this.marks.selected.has(i)) outline(t, 'rgba(120,200,255,0.8)'); }
    if (this.hover?.side && this.handlers.hoverEdges?.()) {
      // the wall face under the mouse (it belongs to the higher tile)
      const hs = this.hover.side;
      const whole = this.sidePolygon(hs.tile, hs.face, vp), side = this.sidePolygon(hs.tile, hs.face, vp, hs.depth);
      if (whole) { // the whole face faintly, with a line between each of its pieces
        ctx.beginPath(); whole.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(243,199,107,0.45)'; ctx.stroke();
        for (let d = 1; d < hs.steps; d++) { const q = this.sidePolygon(hs.tile, hs.face, vp, d); ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.stroke(); }
      }
      if (side) { // the one piece under the mouse
        ctx.beginPath(); side.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
        ctx.fillStyle = 'rgba(243,199,107,0.28)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#f3c76b'; ctx.stroke();
      }
    } else if (this.hover?.tile && this.handlers.hoverEdges?.()) {
      // map editor: show the hovered tile as a block (its sides down to the lowest
      // neighbour) and the edges of the tiles around it, so the grid reads under the mouse
      const h = this.hover.tile, U = HEIGHT_UNIT;
      const line = (a, b, color, width) => {
        const p = this.view.project(a, vp), q = this.view.project(b, vp);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
      };
      let low = h.height;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const t = this.grid.tileAt(h.x + dx, h.y + dy);
        if (!t || t === h) continue;
        if (Math.abs(dx) + Math.abs(dy) === 1) low = Math.min(low, t.height);
        const far = Math.max(Math.abs(dx), Math.abs(dy)) > 1;
        const poly = this.tilePolygon(t, vp);
        ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
        ctx.lineWidth = 1; ctx.strokeStyle = far ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.34)'; ctx.stroke();
      }
      const poly = this.tilePolygon(h, vp);
      ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
      if (low < h.height) {
        const top = h.height * U, base = low * U;
        const corners = [[h.x, h.y], [h.x + 1, h.y], [h.x + 1, h.y + 1], [h.x, h.y + 1]];
        corners.forEach(([x, z], i) => {
          const [nx, nz] = corners[(i + 1) % 4];
          line([x, top, z], [x, base, z], 'rgba(255,255,255,0.55)', 1.5);
          line([x, base, z], [nx, base, nz], 'rgba(255,255,255,0.3)', 1);
        });
      }
    }
    if (this.hover?.tile) outline(this.hover.tile, this.drag?.unit ? '#f3c76b' : 'rgba(255,255,255,0.9)');

    // token size follows the on-screen size of a tile
    const a = this.view.project([0, 0, 0], vp), b = this.view.project([1, 0, 0], vp);
    const r = Math.max(8, Math.min(18, Math.hypot(b.x - a.x, b.y - a.y) * 0.32));

    this.drawn = this.units.filter(u => !u.actionHidden).map((u) => {
      const t = this.grid.tileAt(Math.round(u.x), Math.round(u.y));
      const top = t ? this.tileTop(t)[1] : 0;
      const anchor = this.view.project([u.x + 0.5, top, u.y + 0.5], vp);
      if (u.billboard) {
        // Sprite drawn by WebGL: small badge above its head, ring at its feet.
        const rect = this.view.billboardRect(u.billboard, vp);
        const rb = r * 0.7;
        return { unit: u, anchor, rect, x: anchor.x, y: rect.y0 - rb - 2, r: rb, depth: anchor.depth };
      }
      if (u.placeholder) {
        // Giant bosses use a different sprite system: show a large marker instead.
        const rb = r * 1.7;
        return { unit: u, anchor, x: anchor.x, y: anchor.y - rb * 1.5, r: rb, depth: anchor.depth, big: true };
      }
      return { unit: u, anchor, x: anchor.x, y: anchor.y - r * 1.6, r, depth: anchor.depth };
    }).sort((p, q) => q.depth - p.depth);

    for (const d of this.drawn) {
      if (this.showUnitMarkers === false || d.unit.isProp) continue; // props use their artwork, without character badges/rings
      const dragging = this.drag?.unit === d.unit && this.drag.moved;
      const selected = d.unit.slot === this.selected;
      ctx.globalAlpha = dragging ? 0.35 : 1;
      if (d.rect) {
        ctx.strokeStyle = selected ? '#f3c76b' : TEAM_COLORS[d.unit.team] || '#9a9a9a';
        ctx.lineWidth = selected ? 3 : 2;
        ctx.beginPath(); ctx.ellipse(d.anchor.x, d.anchor.y, r * 1.1, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (d.big) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.ellipse(d.anchor.x, d.anchor.y, d.r * 1.3, d.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = TEAM_COLORS[d.unit.team] || '#9a9a9a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(d.anchor.x, d.anchor.y); ctx.lineTo(d.x, d.y + d.r); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.ellipse(d.anchor.x, d.anchor.y, r * 0.8, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(d.anchor.x, d.anchor.y); ctx.lineTo(d.x, d.y + d.r); ctx.stroke();
      }
      // The original casting symbol occupies the badge's position above the head.
      if(!(d.unit.spellAnimation?.effect===121&&d.unit.animationTick<32))
        drawToken(ctx, d.unit, d.x, d.y, d.r, { selected, hovered: this.hover?.unit === d.unit });
    }
    ctx.globalAlpha = 1;
    if (this.showUnitMarkers !== false && this.drag?.unit && this.drag.moved) {
      ctx.globalAlpha = 0.75;
      drawToken(ctx, this.drag.unit, this.drag.pos.x, this.drag.pos.y, r, { selected: true });
      ctx.globalAlpha = 1;
    }
  }

  // ---- input ----------------------------------------------------------
  bindEvents() {
    const c = this.overlay;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    c.addEventListener('pointerdown', (e) => {
      if (!this.grid) return;
      const m = pos(e);
      c.setPointerCapture(e.pointerId);
      if(e.button===0&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&this.handlers.paintActive?.()){
        this.drag={painting:true};this.handlers.onPaintStart?.(this.tileAt(m.x,m.y));return;
      }
      const unit = e.button === 0 && !e.shiftKey ? this.pickUnit(m.x, m.y) : null;
      const v = this.view;
      this.drag = {
        unit, start: m, pos: m, moved: false,
        pan: e.button === 2 || e.shiftKey,
        orbit: { yaw: v.yaw, pitch: v.pitch, target: [...v.target] },
        tile: unit ? null : this.tileAt(m.x, m.y),
      };
      if (unit) this.handlers.onSelectUnit?.(unit.slot);
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.grid) return;
      const m = pos(e);
      const d = this.drag;
      if(d?.painting){this.handlers.onPaintMove?.(this.tileAt(m.x,m.y));c.style.cursor='crosshair';return;}
      if (d) {
        if (Math.hypot(m.x - d.start.x, m.y - d.start.y) > 4) d.moved = true;
        d.pos = m;
        if (!d.unit && d.moved) {
          if (d.pan) this.view.panBy(d.orbit, m.x - d.start.x, m.y - d.start.y);
          else { this.view.orbitBy(d.orbit, m.x - d.start.x, m.y - d.start.y); this.updateBillboards(); }
        }
      }
      if (!d || d.unit) {
        const unit = d?.unit ? null : this.pickUnit(m.x, m.y);
        const side = !unit && this.handlers.hoverEdges?.() ? this.sideAt(m.x, m.y) : null;
        this.hover = { unit, tile: unit ? null : side?.tile ?? this.tileAt(m.x, m.y), side };
        this.handlers.onHover?.(this.hover);
      }
      c.style.cursor = d?.unit ? 'grabbing' : d?.moved ? (d.pan ? 'move' : 'grabbing') : this.hover?.unit ? 'grab' : 'default';
      this.view.render();
    });

    const end = (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if(d.painting){this.handlers.onPaintEnd?.();this.view.render();return;}
      if (d.unit && d.moved) {
        const t = this.tileAt(pos(e).x, pos(e).y);
        if (t && (t.x !== d.unit.x || t.y !== d.unit.y)) this.handlers.onMoveUnit?.(d.unit.slot, t.x, t.y);
      } else if (!d.unit && !d.moved && e.button === 2 && this.handlers.onContextTile) {
        const side = this.sideAt(pos(e).x, pos(e).y); // a right-click that didn't pan: on a wall face, or on a top
        this.handlers.onContextTile(side?.tile ?? d.tile, { x: e.clientX, y: e.clientY }, side);
      } else if (!d.unit && !d.moved) {
        this.handlers.onSelectTile?.(d.tile, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      }
      this.view.render();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => { const painting=this.drag?.painting;this.drag = null;if(painting)this.handlers.onPaintEnd?.();this.view.render(); });
    c.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.handlers.onHover?.(null); this.view.render(); } });
    // things dragged from a palette (map editor): the tile under them is outlined, dropping hands it over
    c.addEventListener('dragover', (e) => {
      if (!this.grid || !this.handlers.onDropTile) return;
      e.preventDefault();
      const tile = this.tileAt(pos(e).x, pos(e).y);
      if (tile !== this.hover?.tile) { this.hover = { unit: null, tile }; this.handlers.onHover?.(this.hover); this.view.render(); }
    });
    c.addEventListener('dragleave', () => { this.hover = null; this.handlers.onHover?.(null); this.view.render(); });
    c.addEventListener('drop', (e) => {
      if (!this.grid || !this.handlers.onDropTile) return;
      e.preventDefault();
      const tile = this.tileAt(pos(e).x, pos(e).y);
      if (tile) this.handlers.onDropTile(tile, e.dataTransfer);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.view.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  }
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

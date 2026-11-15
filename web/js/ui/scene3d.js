// WebGL2 renderer for battle map scenes: the textured terrain mesh with the
// game's baked vertex lighting, plus simple blocks for destructible objects.
// Indoor maps with a painted backdrop show the painting from its own camera
// angle (backdrop.js), with the room's mesh kept for depth only, so characters
// behind its walls are hidden; from other angles the mesh is drawn untextured
// (its own atlas is a checkerboard placeholder).

import { TEXTURE_FORMAT } from '../game/bgscene.js';
import { animatedAtlasCells, mapAnimationFrame } from '../game/mapanimations.js';
import { backdropQuad, fitBackdrop, litMask, nativeBackdropFit, backdropAlignmentVersion, paintedTerrainUnderlay, frameBackdropArtwork } from './backdrop.js';
import { renderPreferences,watchRenderPreferences } from './renderpreferences.js';
import {SHIP_STRIPS} from '../game/boatpainting.js';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec2 aUv;
uniform mat4 uViewProj;
out vec4 vColor;
out vec2 vUv;
void main() {
  vColor = aColor;
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vUv;
uniform sampler2D uTex;
uniform int uMode;        // 0 textured + baked light, 1 texture only, 2 vertex colour only
uniform float uLight;     // scale applied to the baked vertex colour
out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUv);
  // The atlases' alpha is all-or-nothing: clear texels are cut-outs (roof edges,
  // fences, leaves) whose colour is black, so they're dropped, not drawn.
  if (uMode != 2 && tex.a < 0.5) discard;
  if (uMode == 1) { outColor = vec4(tex.rgb, 1.0); return; }
  if (uMode == 2) { outColor = vec4(vColor.rgb, 1.0); return; }
  outColor = vec4(tex.rgb * vColor.rgb * uLight, 1.0);
}`;

const SPRITE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 aColor;
uniform mat4 uViewProj;
out vec2 vUv;
out vec4 vColor;
void main() { vUv = aUv; vColor=aColor; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const SPRITE_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
in vec4 vColor;
uniform sampler2D uTex;
uniform float uLight;
uniform bool uShadow;
uniform bool uParticle;
uniform bool uCapture;
uniform vec4 uTint;
uniform float uFlash;
uniform float uGlow;
out vec4 outColor;
void main() {
  if (uShadow) {
    float r = length(vUv * 2.0 - 1.0);
    float a = (1.0 - smoothstep(0.25, 1.0, r)) * 0.28;
    if (a < 0.002) discard;
    outColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }
  vec4 c = texture(uTex, uCapture ? vec2(vUv.x,1.0-vUv.y) : vUv);
  if (uParticle) {
    // Original EFX colours are bytes with neutral 128. The native packed
    // multiply saturates after every stage; an unrestricted product makes
    // soft helper layers much brighter than the game (40CB40).
    vec4 modulation = min(floor(max(uTint*vColor, vec4(0.0))*128.0)/128.0,
                          vec4(255.0/128.0,255.0/128.0,255.0/128.0,1.0));
    // The original simple effect shader saturates texture * colour before
    // blending (Shader.dat, simple effect pixel shader). Glow is a shared
    // preview preference, applied only to additive light contributions.
    c = clamp(c * modulation, 0.0, 1.0);
    c.a *= uGlow;
    if (c.a < 0.002) discard;
    outColor = vec4(c.rgb, c.a); return;
  }
  if (c.a < 0.5) discard;   // pixel-art cut-out
  outColor = vec4(mix(c.rgb * uLight, vec3(1.0), uFlash), 1.0);
}`;

const STRIDE = 36;
const BACKDROP_KEY = 'tor-editor:backdrop:v2:'; // + map name: this browser's adjustment of a painted backdrop

/**
 * The room's creases (edges between faces that meet at an angle, and open
 * edges) as a line list in the vertex layout, drawn bright cyan.
 */
function creaseLines(mesh) {
  const f = new Float32Array(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength / 4);
  const at = (i) => [f[i * 9], f[i * 9 + 1], f[i * 9 + 2]];
  const id = (p) => p.map((v) => v.toFixed(3)).join(',');
  const edges = new Map();
  for (let t = 0; t + 2 < mesh.count; t += 3) {
    const v = [at(t), at(t + 1), at(t + 2)];
    const u = v[1].map((x, k) => x - v[0][k]), w = v[2].map((x, k) => x - v[0][k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n);
    if (len < 1e-9) continue;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const key = [id(v[a]), id(v[b])].sort().join('|');
      if (!edges.has(key)) edges.set(key, { a: v[a], b: v[b], normals: [] });
      edges.get(key).normals.push(n.map((x) => x / len));
    }
  }
  const out = [];
  for (const e of edges.values()) {
    const [n0] = e.normals;
    if (e.normals.length > 1 && e.normals.every((n) => n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] > 0.9)) continue;
    out.push(e.a, e.b);
  }
  const data = new ArrayBuffer(out.length * STRIDE);
  const fl = new Float32Array(data), u8 = new Uint8Array(data);
  out.forEach((p, i) => {
    fl.set(p, i * 9);
    u8.set([80, 230, 255, 255], i * STRIDE + 24);
  });
  return u8;
}

export class SceneView {
  constructor(canvas, { controls = false, onRender = null } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.bptc = gl.getExtension('EXT_texture_compression_bptc');
    this.s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
    this.program = link(gl, VS, FS);
    this.spriteProgram = link(gl, SPRITE_VS, SPRITE_FS);
    this.spriteBuffer = gl.createBuffer();
    this.spriteColorBuffer = gl.createBuffer();
    this.spriteVao = gl.createVertexArray();
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    gl.disableVertexAttribArray(2);gl.vertexAttrib4f(2,1,1,1,1);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    this.billboards = [];
    this.mode = renderPreferences().lighting?0:1;
    this.animatedTiles = renderPreferences().animatedTiles;
    this.spritesOverTerrain = renderPreferences().spritesOverTerrain;
    this.light = 2.0;
    this.yaw = Math.PI / 4;
    this.pitch = 0.6;
    this.zoom = 1;
    this.target = [0, 0, 0];
    this.radius = 10;
    this.scene = null;
    this.onRender = onRender;
    if (controls) this.bindEvents();
    this.resizeObserver=new ResizeObserver(() => this.render());this.resizeObserver.observe(canvas);
    this.visibilityHandler=()=>this.render();document.addEventListener('visibilitychange',this.visibilityHandler);
    this.unwatchPreferences=watchRenderPreferences(p=>{
      if(this.mode!==2)this.mode=p.lighting?0:1;
      this.animatedTiles=p.animatedTiles;
      this.spritesOverTerrain=p.spritesOverTerrain;
      this.render();
    });
  }

  static isSupported() {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      return !!gl && !!gl.getExtension('EXT_texture_compression_bptc');
    } catch {
      return false;
    }
  }

  get supportsBC7() { return !!this.bptc; }

  setScene(scene, textureName) {
    this.scene = scene;
    this.mapClockStart = performance.now();
    this.animatedCells = [];
    this.terrain = this.upload(scene.mesh.vertices, this.terrain);
    this.terrainCount = scene.mesh.count;

    const f = new Float32Array(scene.mesh.vertices.buffer, scene.mesh.vertices.byteOffset, scene.mesh.vertices.byteLength / 4);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < f.length; i += STRIDE / 4) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], f[i + k]); max[k] = Math.max(max[k], f[i + k]); }
    this.bounds = { min, max };
    this.setBackdrop(scene);
    this.fit();
    this.setTexture(textureName ?? defaultTexture(scene)?.name);
  }

  /**
   * Upload the scene's painted backdrop, if it has one, and work out where it
   * sits. Native UV/world pairs supply the camera for all stock painted maps.
   * Custom maps without that data use the silhouette fallback. Manual preview
   * adjustments remain available and can be saved with the editor settings.
   */
  setBackdrop(scene) {
    const gl = this.gl;
    if (this.backdrop) {
      gl.deleteTexture(this.backdrop.texture);
      for(const t of this.backdrop.paintTextures??[])if(t!==this.backdrop.texture)gl.deleteTexture(t);
      if(this.backdrop.paintMesh){gl.deleteBuffer(this.backdrop.paintMesh.vbo);gl.deleteVertexArray(this.backdrop.paintMesh.vao);}
      for (const b of [this.backdrop.quad, this.backdrop.outline]) { gl.deleteBuffer(b.vbo); gl.deleteVertexArray(b.vao); }
    }
    this.backdrop = null;
    if (!scene.backdrop || !this.bptc) { this.renderBackdropPanel(); return; }
    const pic = scene.backdrop;
    const texture = this.makeTexture(pic);
    const splitBoat=scene.paintLayer?.flat&&scene.paintings?.length===2&&/^bg210_0[23]/.test(scene.name);
    const native = nativeBackdropFit(scene,pic);
    const auto = native ?? fitBackdrop(scene.mesh, STRIDE, litMask(gl, texture, pic.width), pic.width);
    const alignmentVersion=backdropAlignmentVersion(scene);
    const key = `${BACKDROP_KEY.replace(':v2:',`:v${alignmentVersion}:`)}${scene.name}`;
    let adjust = { dx: 0, dy: 0, scale: 1, pitch: 0 };
    try { const saved=localStorage.getItem(key)??(alignmentVersion===2&&!/^bg206_01_c0_t00$/i.test(scene.name)?localStorage.getItem(key.replace(':v2:',':v1:')):null); adjust = { ...adjust, ...JSON.parse(saved) }; } catch { /* storage unavailable */ }
    const lines = creaseLines(scene.mesh);
    this.backdrop = { texture, auto, adjust, key, alignmentVersion, size: pic.width, outline: this.upload(lines), outlineCount: lines.length / STRIDE, showOutline: false,
      terrainUnderlay: paintedTerrainUnderlay(scene) };
    if(this.backdrop.terrainUnderlay&&splitBoat&&native){
      // The large ship painting is packed across two 2048px pages. The tops
      // of the sails wrap into the opposite page's bottom 768px. Unpack the
      // connected artwork as strips; the terrain UV footprint crops the sails.
      this.backdrop.paintTextures=(scene.paintings??[pic]).map(p=>p===pic?texture:this.makeTexture(p));
      this.backdrop.adjust={dx:0,dy:0,scale:1,pitch:0};
      const f=this.backdrop.auto,eye=[Math.cos(f.pitch)*Math.sin(f.yaw),Math.sin(f.pitch),Math.cos(f.pitch)*Math.cos(f.yaw)],q=backdropQuad(f,pic.width,eye);
      const rects=[...SHIP_STRIPS].sort((a,b)=>a.page-b.page);
      const data=new Uint8Array(rects.length*6*STRIDE),d=new DataView(data.buffer),batches=[];let n=0;
      const point=(x,y)=>q.tl.map((a,k)=>a+(q.tr[k]-a)*x+(q.bl[k]-a)*y);
      for(const r of rects){
        const texture=scene.paintings.findIndex(p=>p.name.endsWith(`_p0${r.page}`));
        if(batches.at(-1)?.texture===texture)batches.at(-1).count+=6;else batches.push({first:n,count:6,texture});
        for(const [x,y,u,v]of [[r.x0,r.y0,r.u0,r.v0],[r.x0,r.y1,r.u0,r.v1],[r.x1,r.y1,r.u1,r.v1],[r.x0,r.y0,r.u0,r.v0],[r.x1,r.y1,r.u1,r.v1],[r.x1,r.y0,r.u1,r.v0]]){
          point(x,y).forEach((a,k)=>d.setFloat32(n*STRIDE+k*4,a,true));data.fill(255,n*STRIDE+24,n*STRIDE+28);d.setFloat32(n*STRIDE+28,u,true);d.setFloat32(n*STRIDE+32,v,true);n++;
        }
      }
      this.backdrop.paintMesh=this.upload(data);this.backdrop.paintBatches=batches;
      this.backdrop.paintPoints=rects.flatMap(r=>[[r.x0,r.y0],[r.x1,r.y0],[r.x0,r.y1],[r.x1,r.y1]].map(([x,y])=>point(x,y)));
    }else if(scene.paintLayer?.flat&&scene.paintings?.length>1){
      // bg217 is a two-page painted field, not a single backdrop square.
      // Its native flat mesh already positions both texture pages correctly.
      gl.deleteTexture(texture);
      this.backdrop.paintTextures=scene.paintings.map(p=>this.makeTexture(p,{repeat:true}));
      this.backdrop.texture=this.backdrop.paintTextures[0];
      this.backdrop.paintMesh=this.upload(scene.paintLayer.vertices);
      this.backdrop.paintBatches=scene.paintLayer.batches;
      this.backdrop.adjust={dx:0,dy:0,scale:1,pitch:0};
    }
    this.buildBackdropQuad();
    this.renderBackdropPanel();
    if(!this.backdrop.paintMesh)this.restoreBackdropAlignment(scene.name,this.backdrop);
  }

  async restoreBackdropAlignment(map, backdrop) {
    try {
      const response=await fetch('/api/preview-alignment',{headers:{'X-TOR-Editor':'1'}});
      if(!response.ok)return;
      const saved=(await response.json())[map];
      if(this.backdrop!==backdrop||backdrop.touched||saved?.version!==backdrop.alignmentVersion)return;
      const a=saved.adjust;
      if(!a||!['dx','dy','scale','pitch'].every(k=>Number.isFinite(a[k]))||a.scale<=0)return;
      backdrop.adjust={...a};backdrop.persisted=true;
      this.buildBackdropQuad();this.pitch=this.backdropFit().pitch;this.renderBackdropPanel();this.render();
    }catch{/* Browser adjustments remain available when the server cannot be reached. */}
  }

  async saveBackdropAlignment() {
    const b=this.backdrop;if(!b)return;
    const snapshot=JSON.stringify(b.adjust);
    b.saveMessage='Saving…';this.renderBackdropPanel();
    try{
      const response=await fetch('/api/preview-alignment',{method:'POST',headers:{'X-TOR-Editor':'1','Content-Type':'application/json'},body:JSON.stringify({map:this.scene.name,version:b.alignmentVersion,adjust:JSON.parse(snapshot)})});
      if(!response.ok)throw new Error('Save failed. Restart the updated editor server and check that it is writable.');
      b.persisted=JSON.stringify(b.adjust)===snapshot;b.saveMessage=b.persisted?'Alignment saved':'Unsaved alignment';
    }catch(error){b.saveMessage=error.message;}
    if(this.backdrop===b)this.renderBackdropPanel();
  }

  /** The fit with this browser's adjustment applied. */
  backdropFit() {
    const { auto, adjust } = this.backdrop;
    return { yaw: auto.yaw, pitch: auto.pitch + adjust.pitch, scale: auto.scale * adjust.scale, ox: auto.ox - adjust.dx, oy: auto.oy + adjust.dy };
  }

  buildBackdropQuad() {
    const b = this.backdrop;
    const fit = this.backdropFit();
    const eyeDir = [Math.cos(fit.pitch) * Math.sin(fit.yaw), Math.sin(fit.pitch), Math.cos(fit.pitch) * Math.cos(fit.yaw)];
    const { tl, tr, bl, br } = backdropQuad(fit, b.size, eyeDir);
    const data = new ArrayBuffer(6 * STRIDE);
    const f = new Float32Array(data), u8 = new Uint8Array(data);
    [[tl, 0, 0], [bl, 0, 1], [br, 1, 1], [tl, 0, 0], [br, 1, 1], [tr, 1, 0]].forEach(([p, u, v], i) => {
      f.set(p, i * 9);
      u8.fill(255, i * STRIDE + 24, i * STRIDE + 28);
      f[i * 9 + 7] = u; f[i * 9 + 8] = v;
    });
    b.quad = this.upload(u8, b.quad);
  }

  /** Move (picture pixels), scale (factor) or tilt (radians) the backdrop; null resets it. */
  adjustBackdrop(change) {
    const b = this.backdrop;
    if (!b||b.paintMesh) return;
    b.touched=true;b.persisted=false;b.saveMessage='Unsaved alignment';
    if (change === null) b.adjust = { dx: 0, dy: 0, scale: 1, pitch: 0 };
    else {
      b.adjust.dx += change.dx ?? 0;
      b.adjust.dy += change.dy ?? 0;
      b.adjust.scale *= change.scale ?? 1;
      b.adjust.pitch += change.pitch ?? 0;
    }
    try { localStorage.setItem(b.key, JSON.stringify(b.adjust)); } catch { /* storage unavailable */ }
    this.buildBackdropQuad();
    this.pitch = this.backdropFit().pitch; // stay on the backdrop's view
    this.renderBackdropPanel();
    this.render();
  }

  /** The small panel on the view for lining the painting up (shown when the map has one). */
  renderBackdropPanel() {
    const host = this.canvas.parentElement;
    let panel = host?.querySelector(':scope > .backdrop-tools');
    if (!this.backdrop||this.backdrop.paintMesh) { panel?.remove(); return; }
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'backdrop-tools';
      host.append(panel);
      panel.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        const step = e.shiftKey ? 1 : 8;
        const moves = {
          left: { dx: -step }, right: { dx: step }, up: { dy: step }, down: { dy: -step },
          bigger: { scale: 1 + step / 400 }, smaller: { scale: 1 / (1 + step / 400) }, tiltUp: { pitch: step / 800 }, tiltDown: { pitch: -step / 800 },
        };
        if(a==='save'){this.saveBackdropAlignment();return;}
        if (a === 'reset') this.adjustBackdrop(null);
        else if (a === 'outline') { this.backdrop.showOutline = !this.backdrop.showOutline; this.renderBackdropPanel(); this.render(); }
        else if (a === 'view') this.fit();
        else this.adjustBackdrop(moves[a]);
      });
    }
    const b=this.backdrop,adj=b.adjust;
    const moved = adj.dx || adj.dy || adj.scale !== 1 || adj.pitch;
    panel.innerHTML = `<span title="This map is drawn in game as a painted picture. Line it up with the room: tick Outline and move the painting until the room's edges sit on the painted walls and floor. Shift-click for fine steps. Use Save alignment to keep these settings across editor sessions and browsers. These settings only affect the preview.">Painting</span>
      <button data-a="left" title="Move left">◀</button><button data-a="right" title="Move right">▶</button>
      <button data-a="up" title="Move up">▲</button><button data-a="down" title="Move down">▼</button>
      <button data-a="smaller" title="Smaller">−</button><button data-a="bigger" title="Bigger">+</button>
      <button data-a="tiltDown" title="Tilt flatter">⤓</button><button data-a="tiltUp" title="Tilt steeper">⤒</button>
      <button data-a="outline" class="${this.backdrop.showOutline ? 'on' : ''}" title="Draw the room's edges over the painting">Outline</button>
      <button data-a="view" title="Back to the painting's view">View</button>
      <button data-a="save" title="Save preview alignment with the editor settings">Save alignment</button><span class="alignment-status" role="status">${b.saveMessage??(b.persisted?'Alignment saved':'')}</span>
      ${moved ? '<button data-a="reset" title="Back to the automatic fit">Reset</button>' : ''}`;
  }

  /** True when the camera looks from the backdrop's own angle (the picture lines up). */
  onBackdropView() {
    if (!this.backdrop) return false;
    const fit = this.backdropFit();
    const dy = Math.abs(((this.yaw - fit.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    return dy < 0.01 && Math.abs(this.pitch - fit.pitch) < 0.01;
  }

  /** Replace the terrain model only (same textures, camera kept). */
  setTerrain(mesh) {
    this.terrain = this.upload(mesh.vertices, this.terrain);
    this.terrainCount = mesh.count;
    this.render();
  }

  /** Reset the camera to frame the whole map from the default angle (keeping the nearest diagonal). */
  fit() {
    if (!this.bounds) return;
    const { min, max } = this.bounds;
    const quarter = Math.PI / 2;
    this.yaw = Math.PI / 4 + Math.round((this.yaw - Math.PI / 4) / quarter) * quarter;
    this.pitch = 0.6;
    if (this.backdrop) ({ yaw: this.yaw, pitch: this.pitch } = this.backdropFit());
    this.target = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    this.radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    this.zoom = 1.25;
    if(this.backdrop?.paintPoints){
      const rect=this.canvas.getBoundingClientRect();
      const frame=frameBackdropArtwork(this.bounds,this.backdrop.paintPoints,this.backdropFit(),rect.width/Math.max(1,rect.height));
      this.target=frame.target;this.radius=frame.radius;
    }
    // the size on screen is fixed here, in world units per CSS pixel: when the
    // panel around the view changes size, more or less of the map shows, but
    // nothing is rescaled (only zooming changes the size)
    this.unitsPerPx = null;
    this.render();
  }

  /** World units per CSS pixel at zoom 1 (set from the canvas height at the first fit it is shown). */
  baseScale() {
    const h = this.canvas.getBoundingClientRect().height;
    if (this.unitsPerPx == null && h > 0) this.unitsPerPx = this.radius / (h / 2);
    return this.unitsPerPx ?? this.radius / 200;
  }

  upload(bytes, previous) {
    const gl = this.gl;
    if (previous) { gl.deleteVertexArray(previous.vao); gl.deleteBuffer(previous.vbo); }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STRIDE, 28);
    gl.bindVertexArray(null);
    return { vbo, vao };
  }

  setTexture(name) {
    const tex = this.scene.textures.find((t) => t.name === name) || defaultTexture(this.scene);
    if (this.texture) this.gl.deleteTexture(this.texture);
    this.texture = this.makeTexture(tex);
    this.textureName = tex.name;
    this.animatedCells = animatedAtlasCells(this.scene,tex);
    this.render();
  }

  /** Upload {width, height, format, data} (BC7, BC1 or RGBA8) as a GPU texture. */
  makeTexture(tex, { pixelated = false, repeat = false } = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (tex.format === TEXTURE_FORMAT.BC7) {
      if (!this.bptc) throw new Error('This GPU/browser cannot display BC7 textures');
      gl.compressedTexImage2D(gl.TEXTURE_2D, 0, this.bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT, tex.width, tex.height, 0, tex.data);
    } else if (tex.format === TEXTURE_FORMAT.BC1 && this.s3tc) {
      gl.compressedTexImage2D(gl.TEXTURE_2D, 0, this.s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, tex.width, tex.height, 0, tex.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tex.width, tex.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, tex.data);
    }
    const filter = pixelated ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }

  /**
   * Sprites: [{texture, x, y, z, width, height, pivot, flip, upright}].
   * (x, y, z) is the world point under the sprite's pivot; pivot is the fraction
   * of the sprite height (from the bottom) that sits on that point.
   */
  setBillboards(billboards) {
    this.billboards = billboards;
    this.render();
  }

  /** Screen-space corners of a billboard, for picking: {x0, y0, x1, y1}. */
  billboardRect(b, vp = this.viewProj()) {
    const pts = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]].map(([sx, sy]) => this.project(this.billboardPoint(b, sx, sy), vp));
    return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
  }

  billboardPoint(b, sx, sy) {
    if(b.corners){
      const x=sx+0.5;
      return [0,1,2].map(k=>(b.corners[2][k]*(1-x)+b.corners[3][k]*x)*(1-sy)+(b.corners[0][k]*(1-x)+b.corners[1][k]*x)*sy);
    }
    const [right, up] = this.billboardAxes(b), h = b.height * (sy - b.pivot);
    if (b.upright && h < 0) {
      // Feet and seated/fallen poses extend below their origin in the 2D
      // image. Give that portion floor-plane depth instead of burying it.
      // Its projection is unchanged; a tiny camera-axis bias avoids z-fighting.
      const d = -h / Math.sin(this.pitch), epsilon = 0.0001;
      return [b.x + right[0] * b.width * sx + Math.sin(this.yaw) * (d + Math.cos(this.pitch) * epsilon),
        b.y + Math.sin(this.pitch) * epsilon,
        b.z + right[2] * b.width * sx + Math.cos(this.yaw) * (d + Math.cos(this.pitch) * epsilon)];
    }
    return [b.x + right[0] * b.width * sx + up[0] * h, b.y + up[1] * h, b.z + right[2] * b.width * sx + up[2] * h];
  }

  billboardAxes(b = null) {
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    // Unit sprites stand vertically on their tile. A camera-up quad leans
    // back into nearby walls, which can cut through its head and torso.
    // Compensate for vertical foreshortening so the picture keeps exactly
    // the same screen size and position; only its terrain depth changes.
    if (b?.upright) return [right, [0, 1 / Math.cos(this.pitch), 0]];
    // camera up: sprites keep their full height on screen, like the game's 2D sprites
    const up = [-Math.sin(this.pitch) * Math.sin(this.yaw), Math.cos(this.pitch), -Math.sin(this.pitch) * Math.cos(this.yaw)];
    return [right, up];
  }

  drawBillboards(vp) {
    if (!this.billboards.length) return;
    const gl = this.gl;
    // far to near, so cut-out edges blend sensibly
    const now = performance.now();
    const bucket=b=>b.screenSpace?(b.screenPriority<0?-1:1):0;
    // Scene animation frames can separate artwork at the same floor position,
    // such as a chair's seat, the seated actor and the chair's backrest.
    // Use a small camera-depth bias so ordinary world depth still orders distant sprites.
    const priorityStep = Math.hypot(vp[2], vp[6], vp[10]) / 64;
    const list = this.billboards.map(b => b.sample ? b.sample(now) : b).filter(Boolean)
      .map(b => ({ b, d: this.project([b.x, b.y, b.z], vp).depth - (b.spritePriority ?? 0) * priorityStep }))
      .sort((p,q)=>bucket(p.b)-bucket(q.b)||(p.b.screenSpace&&q.b.screenSpace?p.b.screenPriority-q.b.screenPriority:q.d-p.d));
    gl.useProgram(this.spriteProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.spriteProgram, 'uViewProj'), false, vp);
    gl.uniform1f(gl.getUniformLocation(this.spriteProgram, 'uLight'), 1.0);
    gl.uniform1i(gl.getUniformLocation(this.spriteProgram, 'uTex'), 0);
    gl.uniform1i(gl.getUniformLocation(this.spriteProgram, 'uCapture'), 0);
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    // Small floor-plane contact shadows, depth-tested against terrain. They
    // never write depth or cover a character with a later shadow pass.
    const shadows=list.map(({b})=>b.shadow).filter(Boolean);
    if(shadows.length){
      gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'uShadow'),1);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      for(const s of shadows){
        const r=s.radius;
        const corner=(x,z)=>[s.x+x*r,s.y,s.z+z*r,(x+1)/2,(z+1)/2];
        const data=new Float32Array([...corner(-1,-1),...corner(-1,1),...corner(1,1),...corner(-1,-1),...corner(1,1),...corner(1,-1)]);
        gl.bufferData(gl.ARRAY_BUFFER,data,gl.STREAM_DRAW);gl.drawArrays(gl.TRIANGLES,0,6);
      }
      gl.depthMask(true);gl.disable(gl.BLEND);
    }
    gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'uShadow'),0);
    const effectGlow=renderPreferences().effectGlow,identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    let captured=false;
    for (const { b } of list) {
      gl.uniformMatrix4fv(gl.getUniformLocation(this.spriteProgram,'uViewProj'),false,b.screenSpace?identity:vp);
      gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'uCapture'),!!b.capture);
      gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'uParticle'),!!b.particle);
      gl.uniform4fv(gl.getUniformLocation(this.spriteProgram,'uTint'),b.tint??[1,1,1,1]);
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'uFlash'),b.flash??0);
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'uGlow'),b.particle&&(b.blend===1||b.add)?effectGlow:1);
      if(b.particle){
        // 544690 -> 19E770 -> 19FBC2 -> 16ADB0; BB4A08 maps the EFX
        // modes to the D3D factors in BA2840 (58FA0). Model materials can
        // override the element's mode. Mode 2 subtracts from the destination.
        if(b.blend===0)gl.disable(gl.BLEND);
        else{
          gl.enable(gl.BLEND);
          gl.blendEquationSeparate(b.blend===2?gl.FUNC_REVERSE_SUBTRACT:gl.FUNC_ADD,gl.FUNC_ADD);
          gl.blendFuncSeparate(gl.SRC_ALPHA,b.blend===1||b.blend===2||b.add?gl.ONE:gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        }
      }
      // The default preview paints complete artwork over the map. Sorting
      // still orders the sprites, but their cards cannot cut one another or
      // disappear into the terrain. Contact shadows keep floor depth above.
      const overlay=this.spritesOverTerrain!==false||b.depthTest===false;
      const writeDepth = !b.particle && !overlay && b.depthWrite !== false;
      if (overlay) gl.disable(gl.DEPTH_TEST);
      if (!writeDepth) gl.depthMask(false);
      const corner = (sx, sy) => this.billboardPoint(b, sx, sy);
      const u0 = b.flip ? 1 : 0, u1 = b.flip ? 0 : 1;
      const v0 = b.flipY ? 0 : 1, v1 = b.flipY ? 1 : 0;
      const ranges = b.upright && b.pivot > 0 && b.pivot < 1 ? [[0, b.pivot], [b.pivot, 1]] : [[0, 1]];
      const vertices = [];
      for (const [lo, hi] of ranges) {
        const vl = v0 + (v1 - v0) * lo, vh = v0 + (v1 - v0) * hi;
        const uv=(x,y)=>b.uv?b.uv[y===1?(x?1:0):(x?3:2)]:[x?u1:u0,y?vh:vl];
        vertices.push(...corner(-0.5, lo), ...uv(0,0), ...corner(0.5, lo), ...uv(1,0), ...corner(0.5, hi), ...uv(1,1),
          ...corner(-0.5, lo), ...uv(0,0), ...corner(0.5, hi), ...uv(1,1), ...corner(-0.5, hi), ...uv(0,1));
      }
      const data = new Float32Array(vertices);
      if(b.colors){
        gl.bindBuffer(gl.ARRAY_BUFFER,this.spriteColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([2,3,1,2,1,0].flatMap(i=>b.colors[i])),gl.STREAM_DRAW);
        gl.vertexAttribPointer(2,4,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(2);
      }else{gl.disableVertexAttribArray(2);gl.vertexAttrib4f(2,1,1,1,1);}
      gl.bindBuffer(gl.ARRAY_BUFFER,this.spriteBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.activeTexture(gl.TEXTURE0);
      if(b.capture&&!captured){this.captureEffectFrame();captured=true;}
      gl.bindTexture(gl.TEXTURE_2D, b.capture?this.effectCapture?.texture:b.texture);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 5);
      if(b.particle){gl.disable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);}
      if (!writeDepth) gl.depthMask(true);
      if(overlay)gl.enable(gl.DEPTH_TEST);
    }
    gl.bindVertexArray(null);
  }

  // Native 2BCE90 supplies presets 1/2 from renderer copies, not a white
  // bitmap. Preserve a real preview image; never sample the drawing target.
  // Capture cue/feedback timing still differs from the battle renderer.
  captureEffectFrame(){
    const gl=this.gl,w=this.canvas.width,h=this.canvas.height;if(!w||!h)return;
    this.effectCapture??={texture:gl.createTexture(),width:0,height:0};
    const t=this.effectCapture;gl.bindTexture(gl.TEXTURE_2D,t.texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(t.width!==w||t.height!==h){gl.copyTexImage2D(gl.TEXTURE_2D,0,gl.RGBA,0,0,w,h,0);t.width=w;t.height=h;}
    else gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,w,h);
  }

  /** Solid boxes: [{x0, y0, z0, x1, y1, z1, color:[r,g,b]}] in world units, colour 0..255. */
  setBoxes(boxes) {
    const data = new ArrayBuffer(boxes.length * 36 * STRIDE);
    const f = new Float32Array(data);
    const u8 = new Uint8Array(data);
    let v = 0;
    const faces = [ // [normal, shade, 4 corners as (x,y,z) selectors 0=min 1=max]
      [[0, 1, 0], 1.0, [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]],
      [[1, 0, 0], 0.62, [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]],
      [[-1, 0, 0], 0.62, [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]]],
      [[0, 0, 1], 0.46, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
      [[0, 0, -1], 0.46, [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
      [[0, -1, 0], 0.3, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    ];
    for (const b of boxes) {
      const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
      for (const [n, shade, corners] of faces) {
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          const c = corners[idx];
          const base = v * (STRIDE / 4);
          f[base] = c[0] ? hi[0] : lo[0]; f[base + 1] = c[1] ? hi[1] : lo[1]; f[base + 2] = c[2] ? hi[2] : lo[2];
          f[base + 3] = n[0]; f[base + 4] = n[1]; f[base + 5] = n[2];
          const cb = v * STRIDE + 24;
          u8[cb] = b.color[0] * shade; u8[cb + 1] = b.color[1] * shade; u8[cb + 2] = b.color[2] * shade; u8[cb + 3] = 255;
          v++;
        }
      }
    }
    this.boxes = this.upload(new Uint8Array(data), this.boxes);
    this.boxCount = v;
    this.render();
  }

  viewProj() {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const r = (this.baseScale() / this.zoom) * Math.max(1, rect.height) / 2;
    const eye = [
      this.target[0] + Math.cos(this.pitch) * Math.sin(this.yaw) * 100,
      this.target[1] + Math.sin(this.pitch) * 100,
      this.target[2] + Math.cos(this.pitch) * Math.cos(this.yaw) * 100,
    ];
    return mul(ortho(-r * aspect, r * aspect, -r, r, 1, 400), lookAt(eye, this.target, [0, 1, 0]));
  }

  /** World point -> CSS pixel position on the canvas, plus depth (smaller = nearer). */
  project([x, y, z], vp = this.viewProj()) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
    return { x: (cx + 1) / 2 * rect.width, y: (1 - cy) / 2 * rect.height, depth: cz };
  }

  updateMapAnimation(now=performance.now()) {
    if(!this.texture||!this.animatedCells?.length||!this.bptc)return;
    const gl=this.gl,tick=this.animatedTiles===false?0:(now-this.mapClockStart)*60/1000;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    for(const cell of this.animatedCells){
      const frame=Math.abs(mapAnimationFrame(cell.animation,cell.row,tick)-cell.row.first);
      if(frame===cell.lastFrame)continue;
      const tex=cell.frames[frame];
      gl.compressedTexSubImage2D(gl.TEXTURE_2D,0,cell.x,cell.y,64,32,this.bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT,tex.data);
      cell.lastFrame=frame;
    }
  }

  render() {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.scene) {
      this.updateMapAnimation();
      gl.enable(gl.DEPTH_TEST);
      const vp = this.viewProj();
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uViewProj'), false, vp);
      gl.uniform1f(gl.getUniformLocation(this.program, 'uLight'), this.light);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(gl.getUniformLocation(this.program, 'uTex'), 0);
      if (this.onBackdropView()) {
        // Outdoor boat paintings sit over animated water, which must remain visible.
        if (this.backdrop.terrainUnderlay) {
          gl.depthMask(false);
          gl.uniform1i(gl.getUniformLocation(this.program, 'uMode'), this.mode);
          gl.bindVertexArray(this.terrain.vao);
          gl.drawArrays(gl.TRIANGLES, 0, this.terrainCount);
        }
        // The painting, then the room for depth only.
        gl.bindTexture(gl.TEXTURE_2D, this.backdrop.texture);
        gl.uniform1i(gl.getUniformLocation(this.program, 'uMode'), 1);
        gl.depthMask(false);
        if(this.backdrop.paintMesh){
          gl.bindVertexArray(this.backdrop.paintMesh.vao);
          for(const batch of this.backdrop.paintBatches){
            gl.bindTexture(gl.TEXTURE_2D,this.backdrop.paintTextures[batch.texture]);
            gl.drawArrays(gl.TRIANGLES,batch.first,batch.count);
          }
        }else{
          gl.bindVertexArray(this.backdrop.quad.vao);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        gl.depthMask(true);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(gl.getUniformLocation(this.program, 'uMode'), 2);
        gl.colorMask(false, false, false, false);
        gl.bindVertexArray(this.terrain.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.terrainCount);
        gl.colorMask(true, true, true, true);
        if (this.backdrop.showOutline) { // the room's edges, to line the painting up with
          gl.disable(gl.DEPTH_TEST);
          gl.bindVertexArray(this.backdrop.outline.vao);
          gl.drawArrays(gl.LINES, 0, this.backdrop.outlineCount);
          gl.enable(gl.DEPTH_TEST);
        }
      } else {
        gl.uniform1i(gl.getUniformLocation(this.program, 'uMode'), this.backdrop && this.mode !== 2 ? 2 : this.mode);
        gl.bindVertexArray(this.terrain.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.terrainCount);
      }
      if (this.boxCount) {
        gl.uniform1i(gl.getUniformLocation(this.program, 'uMode'), 2);
        gl.bindVertexArray(this.boxes.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.boxCount);
      }
      gl.bindVertexArray(null);
      this.drawBillboards(vp);
    }
    this.onRender?.();
    // Ambient objects keep moving while the scene is paused. Hidden or static
    // viewers stop scheduling; ResizeObserver/visibility changes resume them.
    const animate = rect.width > 0 && rect.height > 0 && document.visibilityState !== 'hidden'
      && (this.billboards.some(b => b.animated) || this.animatedTiles!==false && this.animatedCells?.length > 0);
    if (animate && !this.ambientFrame) this.ambientFrame = requestAnimationFrame(() => {
      this.ambientFrame = null; this.render();
    });
    else if (!animate && this.ambientFrame) { cancelAnimationFrame(this.ambientFrame); this.ambientFrame = null; }
  }

  // The small effect preview owns one context and reuses it between entries.
  // Explicit disposal also removes observers/subscriptions when its owner ends.
  dispose(){
    this.disposed=true;if(this.ambientFrame)cancelAnimationFrame(this.ambientFrame);
    this.resizeObserver?.disconnect();document.removeEventListener('visibilitychange',this.visibilityHandler);this.unwatchPreferences?.();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  bindEvents() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, target: [...this.target], pan: e.button === 2 || e.shiftKey };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.pan) this.panBy(drag, e.clientX - drag.x, e.clientY - drag.y);
      else this.orbitBy(drag, e.clientX - drag.x, e.clientY - drag.y);
    });
    c.addEventListener('pointerup', () => { drag = null; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  }

  orbitBy(start, dx, dy) {
    this.yaw = start.yaw - dx * 0.008;
    this.pitch = Math.max(0.15, Math.min(1.5, start.pitch + dy * 0.006));
    this.render();
  }

  panBy(start, dx, dy) {
    const k = this.baseScale() / this.zoom;
    const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const fwd = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    const s = 1 / Math.max(0.2, Math.sin(this.pitch));
    this.target = [
      start.target[0] - (right[0] * dx + fwd[0] * dy * s) * k,
      start.target[1],
      start.target[2] - (right[2] * dx + fwd[2] * dy * s) * k,
    ];
    this.render();
  }

  zoomBy(factor) {
    this.zoom = Math.max(0.4, Math.min(10, this.zoom * factor));
    this.render();
  }
}

/** The main colour atlas: bgNNN_00_..., else the first BC7 texture. */
export function defaultTexture(scene) {
  return scene.textures.find((t) => /^bg\d{3}_00_/.test(t.name))
    || scene.textures.find((t) => t.format === TEXTURE_FORMAT.BC7 && !/ripple|_a\d\d_/.test(t.name))
    || scene.textures[0];
}

function link(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ---- column-major 4x4 matrices -----------------------------------------
function ortho(l, r, b, t, n, f) {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}

function lookAt(eye, target, up) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

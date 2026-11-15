// Rebuilding a map's 3D model after tile height edits (map editor phase 2).
//
// Model layout (scene section 4 = mesh section at m):
//   m+0x00 u32 section size, +0x0C size-0x10, +0x20 / +0x30 sizes, +0x2C offset
//          (from m+0x20) of an optional second block B; all grow with block A.
//   A = m+0x40: [u32 size, 0x10001, 0x70 (vertex block offset), colour block
//          offset, 0x40, trailer offset, zeros to 0x70]
//     vertex block: [size, count, 36, 0x20, 0...] + count x {pos f32x3,
//          normal f32x3, rgba u8x4, uv f32x2}, padded to 16
//     colour block: [size, count, 1, 0x20, 8, align16(0x20+8*count), 0, 0] +
//          count x 8 bytes (two colours per vertex), padded to 16, then
//          align16(4*count) bytes the game doesn't use (stale data; new vertices get zeros)
//     trailer: u32 count, zeros (0x30 bytes)
//   B (some maps): moves with A; its offsets are relative.
// Scene header: +0x04 total, section offsets at +0x24.. (stored -0x10) and
// +0x5C (a pointer into section 7 when set) move by the size change. Nothing
// else in any of the 394 maps points past the model.
//
// Terrain outline (86 maps, Golyat among them): when +0x5C is set, a block
// chain at C = (+0x5C) + 0x10 holds a positions-only copy of the terrain:
//   C+0x00 [size, 1, 0x20, size-0x10], C+0x20 [size, 0, 0x20, 0],
//   C+0x40 [size, 0x10001, 0x70, 0, 0x40, trailer offset],
//   C+0xB0 [align16(0x20+12n), n, 12, 0x20] + n x f32x3, then trailer [n, 0...].
// Every one of its triangles is a triangle of the model (the model has a few
// more: roof edges). The game seems to use it for movement around raised
// ground, so it is kept in step: matched triangles take the rebuilt
// positions and new triangles are added to it too.
//
// The terrain is built from tiles: each tile's top is flat at its height, and
// walls between tiles are one quad per height step, each using one 1/32 cell
// of the texture atlas; all faces wind counter-clockwise around their normal.
// So for an edited tile: everything standing on its top moves with it, the
// walls on its edges are collapsed and rebuilt, with texture cells copied
// from the walls the tile (or a neighbour) already has, step by step from
// the top.

import { view } from '../lib/pakd.js';
import { HEIGHT_UNIT as U } from './bgscene.js';

const STRIDE = 36;
const EPS = 1e-3;
const align16 = (n) => (n + 15) & ~15;

/** Pull the model apart. Everything is copied, so the scene can be edited separately. */
export function readModel(scene) {
  const v = view(scene);
  const m = v.getUint32(0x24 + 4 * 4, true) + 0x10;
  const A = m + 0x40;
  const vb = A + v.getUint32(A + 8, true);
  const cb = A + v.getUint32(A + 0x0C, true);
  const count = v.getUint32(vb + 4, true);
  if (v.getUint32(vb + 8, true) !== STRIDE || count % 3) throw new Error('unexpected model layout');
  const aSize = v.getUint32(A, true);
  const colorsAt = cb + v.getUint32(cb + 0x0C, true);
  const extraAt = cb + v.getUint32(cb + 0x14, true);
  return {
    m, A, aSize, count,
    head: scene.slice(A, A + 0x70),
    vbHead: scene.slice(vb, vb + 0x20),
    cbHead: scene.slice(cb, cb + 0x20),
    trailer: scene.slice(A + v.getUint32(A + 0x14, true), A + aSize),
    verts: scene.slice(vb + 0x20, vb + 0x20 + count * STRIDE),
    colors: scene.slice(colorsAt, colorsAt + count * 8),
    extra: scene.slice(extraAt, extraAt + align16(count * 4)),
    outline: readOutline(scene, count),
  };
}

const OUT_STRIDE = 12;

function readOutline(scene, modelCount) {
  const v = view(scene);
  const p = v.getUint32(0x5C, true);
  if (!p) return null;
  const C = p + 0x10;
  const vb = C + 0xB0;
  if (C + 0xC0 > scene.length || v.getUint32(vb + 8, true) !== OUT_STRIDE || v.getUint32(vb + 12, true) !== 0x20) return null;
  const n = v.getUint32(vb + 4, true);
  const positions = scene.slice(vb + 0x20, vb + 0x20 + n * OUT_STRIDE);
  // outline triangle -> model triangle with the same three positions
  const key = (bytes, at, stride) => {
    let k = '';
    for (let j = 0; j < 3; j++) for (let b = 0; b < 12; b++) k += String.fromCharCode(bytes[at + j * stride + b]);
    return k;
  };
  const vb2 = (() => { const m = v.getUint32(0x24 + 16, true) + 0x10 + 0x40; return m + v.getUint32(m + 8, true) + 0x20; })();
  const byKey = new Map();
  for (let t = 0; t < modelCount / 3; t++) {
    const k = key(scene, vb2 + t * 3 * STRIDE, STRIDE);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const match = new Int32Array(n / 3).fill(-1);
  for (let t = 0; t < n / 3; t++) {
    const list = byKey.get(key(positions, t * 3 * OUT_STRIDE, OUT_STRIDE));
    if (list?.length) match[t] = list.shift();
  }
  return { C, n, positions, match };
}

/** Block A from a model (byte-exact for an unedited one). */
function buildBlockA(model) {
  const n = model.verts.length / STRIDE;
  const vbSize = align16(0x20 + n * STRIDE);
  const colorsEnd = align16(0x20 + n * 8);
  const cbSize = colorsEnd + align16(n * 4);
  const size = 0x70 + vbSize + cbSize + 0x30;
  const out = new Uint8Array(size);
  const v = view(out);
  out.set(model.head, 0);
  v.setUint32(0x00, size, true);
  v.setUint32(0x0C, 0x70 + vbSize, true);
  v.setUint32(0x14, 0x70 + vbSize + cbSize, true);
  const vb = 0x70;
  out.set(model.vbHead, vb);
  v.setUint32(vb, n === model.count ? view(model.vbHead).getUint32(0, true) : vbSize, true);
  v.setUint32(vb + 4, n, true);
  out.set(model.verts, vb + 0x20);
  const cb = vb + vbSize;
  out.set(model.cbHead, cb);
  v.setUint32(cb, cbSize, true);
  v.setUint32(cb + 4, n, true);
  v.setUint32(cb + 0x14, colorsEnd, true);
  out.set(model.colors, cb + 0x20);
  out.set(model.extra.subarray(0, Math.min(model.extra.length, align16(n * 4))), cb + colorsEnd);
  const tr = cb + cbSize;
  out.set(model.trailer, tr);
  v.setUint32(tr, n, true);
  return out;
}

/** The scene with block A replaced by the model; header offsets after it move with it. */
export function buildScene(scene, model) {
  const a = buildBlockA(model);
  const delta = a.length - model.aSize;
  let out = new Uint8Array(scene.length + delta);
  const aEnd = model.A + model.aSize;
  out.set(scene.subarray(0, model.A), 0);
  out.set(a, model.A);
  out.set(scene.subarray(aEnd), model.A + a.length);
  if (delta) {
    const v = view(out);
    const bump = (o) => v.setUint32(o, v.getUint32(o, true) + delta, true);
    bump(0x04);
    for (let i = 0; i < 11; i++) if (v.getUint32(0x24 + i * 4, true) + 0x10 > model.m) bump(0x24 + i * 4);
    if (v.getUint32(0x5C, true) > model.m) bump(0x5C);
    for (const o of [0x00, 0x0C, 0x20, 0x2C, 0x30]) bump(model.m + o);
  }
  if (model.outline) out = writeOutline(out, model, model.outline.C + (model.outline.C > model.m ? delta : 0));
  return out;
}

/** The terrain outline rebuilt from the model: matched triangles follow it, new ones are added. */
function writeOutline(scene, model, C) {
  const o = model.outline;
  const n = model.verts.length / STRIDE;
  const mv = view(model.verts);
  const tris = [];
  for (let t = 0; t < o.n / 3; t++) tris.push(o.match[t] >= 0 ? o.match[t] : -1 - t);
  for (let t = model.count / 3; t < n / 3; t++) tris.push(t); // walls and tops the rebuild added
  const pos = new Uint8Array(tris.length * 3 * OUT_STRIDE);
  tris.forEach((t, i) => {
    for (let j = 0; j < 3; j++) {
      const dst = (i * 3 + j) * OUT_STRIDE;
      if (t >= 0) pos.set(model.verts.subarray((t * 3 + j) * STRIDE, (t * 3 + j) * STRIDE + 12), dst);
      else pos.set(o.positions.subarray(((-1 - t) * 3 + j) * OUT_STRIDE, ((-1 - t) * 3 + j + 1) * OUT_STRIDE), dst);
    }
  });
  if (!mv) return scene;
  const v = view(scene);
  const vb = C + 0xB0;
  const oldSize = v.getUint32(vb, true);
  const newSize = align16(0x20 + pos.length);
  const d = newSize - oldSize;
  const out = new Uint8Array(scene.length + d);
  out.set(scene.subarray(0, vb + 0x20), 0);
  out.set(pos, vb + 0x20);
  out.set(scene.subarray(vb + oldSize), vb + newSize);
  const w = view(out);
  w.setUint32(vb, newSize, true);
  w.setUint32(vb + 4, pos.length / OUT_STRIDE, true);
  if (d) {
    const bump = (at) => w.setUint32(at, w.getUint32(at, true) + d, true);
    for (const at of [C, C + 0x0C, C + 0x20, C + 0x40, C + 0x54]) bump(at);
    bump(0x04);
    for (let i = 0; i < 11; i++) if (w.getUint32(0x24 + i * 4, true) + 0x10 > vb) bump(0x24 + i * 4);
  }
  w.setUint32(C + 0x40 + w.getUint32(C + 0x54, true), pos.length / OUT_STRIDE, true); // trailer count
  return out;
}

// ---- geometry -----------------------------------------------------------------

/**
 * Rebuild the model for new tile heights. `oldH`/`newH`: heights by tile
 * index (y * width + x). `looks`: tile -> another tile whose look it takes
 * (its top surface, and its walls as the first choice of wall texture), or a
 * look imported from another map (lookimport.js: { foreign, tops, templates }:
 * top triangles relative to the tile's corner and top, wall templates by depth).
 * Returns a new model (the input is left alone) plus notes on anything that
 * couldn't be matched.
 */
export function rebuildModel(model, width, depth, oldH, newH, looks = new Map(), terrain = {}) {
  const edited = [];
  for (let i = 0; i < oldH.length; i++) if (oldH[i] !== newH[i] || looks.has(i) || terrain.wallLooks?.has(i)) edited.push(i);
  if (!edited.length) return { model, notes: [] };
  const n = model.verts.length / STRIDE;
  const verts = model.verts.slice();
  const colors = model.colors.slice();
  const f = new Float32Array(verts.buffer, verts.byteOffset, n * 9);
  const pos = (i) => [f[i * 9], f[i * 9 + 1], f[i * 9 + 2]];
  const tile = (x, z) => (x >= 0 && z >= 0 && x < width && z < depth ? z * width + x : -1);
  const notes = [];

  // classify triangles once
  const tris = [];
  for (let t = 0; t < n; t += 3) {
    const a = pos(t), b = pos(t + 1), c = pos(t + 2);
    const ny = f[t * 9 + 4];
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const minY = Math.min(a[1], b[1], c[1]), maxY = Math.max(a[1], b[1], c[1]);
    const tri = { t, cx, cz, minY, maxY, vertical: Math.abs(ny) < 0.01 };
    if (tri.vertical) {
      for (const [axis, other] of [[0, 2], [2, 0]]) {
        const line = a[axis];
        if (Math.abs(line - Math.round(line)) < EPS && Math.abs(b[axis] - line) < EPS && Math.abs(c[axis] - line) < EPS) {
          tri.edge = { axis, line: Math.round(line), cell: Math.floor((a[other] + b[other] + c[other]) / 3) };
        }
      }
    }
    tris.push(tri);
  }

  // wall-step templates from the original model: tile -> depth from its top -> quad corners
  const templates = new Map();
  const quads = new Map(); // "tile:edge:step" -> triangles
  for (const tri of tris) {
    if (!tri.edge) continue;
    const span = (tri.maxY - tri.minY) / U;
    if (Math.abs(span - 1) > 0.01) continue;
    const nx = f[tri.t * 9 + 3], nz = f[tri.t * 9 + 5];
    const { axis, line, cell } = tri.edge;
    // the wall belongs to the tile it faces away from
    const owner = axis === 0 ? tile(nx > 0 ? line - 1 : line, cell) : tile(cell, nz > 0 ? line - 1 : line);
    if (owner < 0) continue;
    const step = Math.round(tri.maxY / U);
    const key = `${owner}:${axis}:${line}:${cell}:${step}`;
    if (!quads.has(key)) quads.set(key, []);
    quads.get(key).push(tri.t);
  }
  for (const [key, ts] of quads) {
    if (ts.length !== 2) continue;
    const [owner, , , , step] = key.split(':').map(Number);
    const corners = quadCorners(f, colors, ts);
    if (!corners) continue;
    corners.source = { owner, step, key };
    const d = oldH[owner] - step; // 0 = the step just below the top
    if (d < 0) continue;
    const t0 = ts[0];
    corners.facing = facingKey(f[t0 * 9 + 3], f[t0 * 9 + 5]);
    if (!templates.has(owner)) templates.set(owner, []);
    const list = templates.get(owner);
    list[d] ??= {};
    list[d][corners.facing] ??= corners;
  }
  const anyTemplate = [...templates.values()].flatMap((l) => l.filter(Boolean).flatMap((byFacing) => Object.values(byFacing)));
  // Prefer the selected terrain's wall family, facing and cap/body/foot role.
  // The old nearest-wall fallback could borrow a building wall for earth.
  const familyOf=(owner)=>terrain.originalFamilies?.[owner];
  const wantedFamily=(owner)=>{
    const look=looks.get(owner);
    return typeof look==='number'?familyOf(look):look?.planned?look.family:terrain.families?.[owner];
  };
  const role=(d,span)=>d===0?'cap':d===span-1?'foot':'body';
  const templateFor=(owner,d,facing,span)=>{
    const look=looks.get(owner),want=role(d,span),family=wantedFamily(owner);
    const override=terrain.wallLooks?.get(owner);
    // one step of one face given a particular piece (the right-click side picker): `${facing}:d${depth from the top}` -> { tile, depth }
    const piece=override?.[`${facing}:d${d}`];
    if(piece){
      const at=templates.get(piece.tile)?.[piece.depth],exact=at?.[facing]??(at&&Object.values(at)[0]);
      if(exact){if(!at[facing])notes.push(`tile ${owner%width},${Math.floor(owner/width)}: the chosen side piece faces another way`);return exact;}
    }
    const source=override?.[`${facing}:${want}`]??override?.[`${facing}:all`]??override?.[`all:${want}`]??override?.['all:all'];
    if(source!==undefined){
      const explicit=[];
      const list=templates.get(source)??[],last=Math.max(0,list.length-1);
      list.forEach((byFacing,depth)=>{
        for(const [face,t] of Object.entries(byFacing??{}))explicit.push({t,face,depth,score:(face===facing?0:1000)+(role(depth,last+1)===want?0:100)+Math.abs(d-depth)});
      });
      explicit.sort((a,b)=>a.score-b.score);
      if(explicit[0]){
        if(explicit[0].face!==facing||role(explicit[0].depth,last+1)!==want)notes.push(`tile ${owner%width},${Math.floor(owner/width)}: side sample has no exact ${facing} ${want} piece`);
        return explicit[0].t;
      }
      notes.push(`tile ${owner%width},${Math.floor(owner/width)}: side sample has no wall pieces`);
    }
    const sx=owner%width,sz=Math.floor(owner/width);
    const choices=[];
    const add=(list,index,explicit=false)=>{
      const available=[];
      list?.forEach((byFacing,depth)=>{if(byFacing?.[facing])available.push({depth,t:byFacing[facing]});});
      const last=available.at(-1)?.depth??0;
      for(const {depth,t} of available){
        const own=index===owner||index===look;
        const sameFamily=explicit||family===undefined||familyOf(index)===family;
        const rr=role(depth,last+1),distance=Math.abs(index%width-sx)+Math.abs(Math.floor(index/width)-sz);
        const score=(sameFamily?0:10000)+(rr===want?0:want==='body'&&depth>0&&depth<last?0:1000)+(explicit?0:own?1:20)+distance+Math.abs(d-depth)*.01;
        choices.push({t,score,sameFamily});
      }
    };
    if(look?.foreign)add(look.templates,owner,true);
    for(const [index,list] of templates)add(list,index);
    choices.sort((a,b)=>a.score-b.score);
    if(choices[0]){
      if(!choices[0].sameFamily)notes.push(`tile ${sx},${sz}: no wall sample in this terrain family; using the nearest matching facing`);
      return choices[0].t;
    }
    // Some shipped maps only carry camera-facing wall art. Keep a visible
    // fallback and report it instead of silently claiming a correct match.
    const fallback=anyTemplate[0]??null;
    if(fallback)notes.push(`tile ${sx},${sz}: no ${facing}-facing wall sample`);
    return fallback;
  };

  const isEdited = new Set(edited);
  // each tile's surface as the map was made: flat tops, sloped roofs, what stands on them
  const surfaces = tileSurfaces(model.verts, width, depth, oldH);
  // how far below a tile's height its surface meets an edge, before and after the edit
  const oldDrop = (k, face) => surfaces.drops(k)[face];
  const newDrop = (k, face) => {
    const look = looks.get(k);
    if (look === undefined || look === null) return oldDrop(k, face);
    return typeof look === 'number' ? surfaces.drops(look)[face] : look.drops?.[face] ?? 0;
  };
  // 1. an edited tile's surface, and everything standing on it, moves with it
  for (const tri of tris) {
    const k = surfaces.owner.get(tri.t);
    if (k === undefined || !isEdited.has(k)) continue;
    if (looks.has(k)) {
      // the tile takes another tile's surface: its own top goes (collapsed in place)
      const p = pos(tri.t);
      for (let j = 1; j < 3; j++) { f[(tri.t + j) * 9] = p[0]; f[(tri.t + j) * 9 + 1] = p[1]; f[(tri.t + j) * 9 + 2] = p[2]; }
      continue;
    }
    const dy = (newH[k] - oldH[k]) * U;
    for (let j = 0; j < 3; j++) f[(tri.t + j) * 9 + 1] += dy;
  }
  // ...and gets a copy of the source tile's top (and what stands on it) at its new height
  const added = [];
  for (const [k, src] of looks) {
    if (src?.foreign || src?.planned) {
      const kx = k % width, kz = Math.floor(k / width);
      for (const tri of src.tops) added.push(tri.map((v) => ({ ...v, pos: [v.pos[0] + kx, v.pos[1] + newH[k] * U, v.pos[2] + kz] })));
      continue;
    }
    const sx = src % width, sz = Math.floor(src / width), kx = k % width, kz = Math.floor(k / width);
    const dy = (newH[k] - oldH[src]) * U;
    let copied = 0;
    for (const st of surfaces.byTile.get(src) ?? []) {
      const vertsOut = [];
      for (let j = 0; j < 3; j++) {
        const i = st + j;
        const dv = new DataView(model.verts.buffer, model.verts.byteOffset + i * STRIDE, STRIDE); // the untouched original
        vertsOut.push({
          pos: [dv.getFloat32(0, true) + (kx - sx), dv.getFloat32(4, true) + dy, dv.getFloat32(8, true) + (kz - sz)],
          normal: [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)],
          uv: [dv.getFloat32(28, true), dv.getFloat32(32, true)],
          rgba: model.verts.slice(i * STRIDE + 24, i * STRIDE + 28),
          color: model.colors.slice(i * 8, i * 8 + 8),
        });
      }
      added.push(vertsOut);
      copied++;
    }
    if (!copied) notes.push(`tile ${sx},${sz} has no top surface to copy`);
  }

  // 2. walls on every edge of an edited tile
  const edges = new Map();
  for (const k of edited) {
    const x = k % width, z = Math.floor(k / width);
    edges.set(`0:${x}:${z}`, { axis: 0, line: x, cell: z });
    edges.set(`0:${x + 1}:${z}`, { axis: 0, line: x + 1, cell: z });
    edges.set(`2:${z}:${x}`, { axis: 2, line: z, cell: x });
    edges.set(`2:${z + 1}:${x}`, { axis: 2, line: z + 1, cell: x });
  }
  for (const e of edges.values()) {
    const a = e.axis === 0 ? tile(e.line - 1, e.cell) : tile(e.cell, e.line - 1);
    const b = e.axis === 0 ? tile(e.line, e.cell) : tile(e.cell, e.line);
    const onEdge = tris.filter((tri) => tri.edge && tri.edge.axis === e.axis && tri.edge.line === e.line && tri.edge.cell === e.cell);
    // outside the map: the old border wall's bottom (or ground level)
    const floor = onEdge.length ? Math.round(Math.min(...onEdge.map((tri) => tri.minY)) / U) : 0;
    // a tile's wall on this edge starts where its surface meets the edge (below a roof's ridge)
    const faceA = e.axis === 0 ? 'E' : 'S', faceB = e.axis === 0 ? 'W' : 'N';
    const hoA = a < 0 ? floor : Math.max(0, oldH[a] - oldDrop(a, faceA)), hoB = b < 0 ? floor : Math.max(0, oldH[b] - oldDrop(b, faceB));
    const hnA = a < 0 ? floor : Math.max(0, newH[a] - newDrop(a, faceA)), hnB = b < 0 ? floor : Math.max(0, newH[b] - newDrop(b, faceB));
    const lo = Math.min(hoA, hoB) * U - EPS, hi = Math.max(hoA, hoB) * U + EPS;
    for (const tri of onEdge) {
      if (surfaces.owner.has(tri.t)) continue; // part of a tile's surface: handled with the tile
      if (tri.minY < lo || tri.maxY > hi) continue; // fences, building walls above the terrain stay
      const p = pos(tri.t);
      for (let j = 1; j < 3; j++) { f[(tri.t + j) * 9] = p[0]; f[(tri.t + j) * 9 + 1] = p[1]; f[(tri.t + j) * 9 + 2] = p[2]; }
    }
    const top = Math.max(hnA, hnB), bottom = Math.min(hnA, hnB);
    if (top === bottom) continue;
    const high = hnA > hnB ? a : b;
    // outward normal: from the high side towards the low side
    const sign = high === a ? 1 : -1;
    const normal = e.axis === 0 ? [sign, 0, 0] : [0, 0, sign];
    for (let step = top - 1; step >= bottom; step--) {
      const t = templateFor(high < 0 ? (a < 0 ? b : a) : high, top - 1 - step, facingKey(normal[0], normal[2]), top-bottom);
      if (!t) { notes.push(`no wall texture to copy for edge ${e.axis ? 'z' : 'x'}=${e.line}`); continue; }
      const q = wallQuad(e, step, normal, t);
      q.source = t.source;
      added.push(q);
    }
  }

  // 3. append new walls
  const extraVerts = added.reduce((nv, q) => nv + q.length, 0);
  const outVerts = new Uint8Array((n + extraVerts) * STRIDE);
  outVerts.set(verts, 0);
  const outColors = new Uint8Array((n + extraVerts) * 8);
  outColors.set(colors, 0);
  const of = new Float32Array(outVerts.buffer);
  const ov = view(outVerts);
  let i = n;
  for (const q of added) {
    for (const c of q) {
      of.set(c.pos, i * 9);
      of.set(c.normal, i * 9 + 3);
      outVerts.set(c.rgba, i * STRIDE + 24);
      ov.setFloat32(i * STRIDE + 28, c.uv[0], true);
      ov.setFloat32(i * STRIDE + 32, c.uv[1], true);
      outColors.set(c.color, i * 8);
      i++;
    }
  }
  if (n + extraVerts > 65535) notes.push('the model now has more than 65,535 vertices, which tile records can’t index');
  const walls = added.filter((q) => q.length === 6).length;
  return { model: { ...model, verts: outVerts, colors: outColors }, notes, walls, sources: added.map((q) => q.source) };
}

/**
 * Which triangles make up each tile's surface, as the map was made, and how far
 * below the tile's height that surface meets each edge.
 *
 * A flat tile's top sits at its height. A roof tile is stored at its ridge
 * height while the roof slopes down to the eaves (Golyat 6,5: height 10, roof
 * from 10 down to 7), with gables and chimney pieces between. So a tile's
 * surface is: every non-vertical triangle centred in the tile that reaches the
 * tile's height; every other non-vertical triangle centred in it that starts
 * no lower than those do (the lower courses of a roof, dormers, corner and
 * valley pieces that stop short of the ridge); and every vertical triangle of
 * the tile (inside it, or on an edge it faces away from) in that same range. For a
 * flat tile this is what stood on its top before (minY >= height).
 * `drops(k)` = { E, W, S, N }: whole height steps from the tile's height down
 * to the lowest surface point on that edge (0 for a flat top). Walls on that
 * edge start there, not at the ridge.
 */
export function tileSurfaces(verts, width, depth, heights) {
  const n = verts.length / STRIDE;
  const f = new Float32Array(verts.buffer, verts.byteOffset, n * 9);
  const tile = (x, z) => (x >= 0 && z >= 0 && x < width && z < depth ? z * width + x : -1);
  const byTile = new Map(), low = new Map(), owner = new Map(), vertical = [], below = [];
  const add = (k, t) => { if (!byTile.has(k)) byTile.set(k, []); byTile.get(k).push(t); owner.set(t, k); };
  const inside = (cx, cz) => {
    const x = Math.floor(cx), z = Math.floor(cz), fx = cx - x, fz = cz - z;
    return fx < EPS || fx > 1 - EPS || fz < EPS || fz > 1 - EPS ? -1 : tile(x, z);
  };
  for (let t = 0; t < n; t += 3) {
    const p = [0, 1, 2].map((j) => [f[(t + j) * 9], f[(t + j) * 9 + 1], f[(t + j) * 9 + 2]]);
    const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
    const minY = Math.min(p[0][1], p[1][1], p[2][1]), maxY = Math.max(p[0][1], p[1][1], p[2][1]);
    if (Math.abs(f[t * 9 + 4]) < 0.01) { vertical.push({ t, p, cx, cz, minY }); continue; }
    const k = inside(cx, cz);
    if (k < 0) continue;
    if (maxY < heights[k] * U - EPS) { below.push({ t, k, minY }); continue; }
    add(k, t);
    low.set(k, Math.min(low.get(k) ?? Infinity, minY));
  }
  // pieces that stop short of the tile's height but lie within its surface's range
  for (const { t, k, minY } of below) if (low.has(k) && minY >= low.get(k) - EPS) add(k, t);
  const posts = new Map(); // tile -> upright pieces inside it that start below its surface
  for (const { t, p, cx, cz, minY } of vertical) {
    let k = -1, onEdge = false;
    for (const [axis, other] of [[0, 2], [2, 0]]) {
      const line = p[0][axis];
      if (Math.abs(line - Math.round(line)) > EPS || Math.abs(p[1][axis] - line) > EPS || Math.abs(p[2][axis] - line) > EPS) continue;
      onEdge = true;
      const cell = Math.floor((p[0][other] + p[1][other] + p[2][other]) / 3);
      const sign = axis === 0 ? f[t * 9 + 3] : f[t * 9 + 5];
      // on an edge: it belongs to the tile it faces away from
      k = axis === 0 ? tile(sign > 0 ? Math.round(line) - 1 : Math.round(line), cell) : tile(cell, sign > 0 ? Math.round(line) - 1 : Math.round(line));
    }
    if (!onEdge) k = inside(cx, cz);
    if (k < 0 || !low.has(k)) continue;
    if (minY >= low.get(k) - EPS) add(k, t);
    else if (!onEdge) { if (!posts.has(k)) posts.set(k, []); posts.get(k).push({ t, minY, maxY: Math.max(p[0][1], p[1][1], p[2][1]) }); }
  }
  // posts and legs: upright pieces inside the tile that hang from its surface, step by step downwards
  // (a platform on stilts, a pier's piles). Floors beneath them belong to the level below and stay.
  for (const [k, list] of posts) {
    let reach = low.get(k);
    for (const piece of list.sort((a, b) => b.maxY - a.maxY)) {
      if (piece.maxY < reach - EPS) break;
      add(k, piece.t);
      reach = Math.min(reach, piece.minY);
    }
  }
  const dropCache = new Map();
  const drops = (k) => {
    if (dropCache.has(k)) return dropCache.get(k);
    const x = k % width, z = Math.floor(k / width);
    const lowest = { E: Infinity, W: Infinity, S: Infinity, N: Infinity };
    for (const t of byTile.get(k) ?? []) {
      if (Math.abs(f[t * 9 + 4]) < 0.01) continue;
      for (let j = 0; j < 3; j++) {
        const vx = f[(t + j) * 9], vy = f[(t + j) * 9 + 1], vz = f[(t + j) * 9 + 2];
        if (Math.abs(vx - (x + 1)) < EPS) lowest.E = Math.min(lowest.E, vy);
        if (Math.abs(vx - x) < EPS) lowest.W = Math.min(lowest.W, vy);
        if (Math.abs(vz - (z + 1)) < EPS) lowest.S = Math.min(lowest.S, vy);
        if (Math.abs(vz - z) < EPS) lowest.N = Math.min(lowest.N, vy);
      }
    }
    const out = {};
    for (const [face, y] of Object.entries(lowest)) out[face] = y === Infinity ? 0 : Math.max(0, heights[k] - Math.floor(y / U + 0.01));
    dropCache.set(k, out);
    return out;
  };
  return { byTile, owner, drops };
}

export const facingKey = (nx, nz) => (Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'E' : 'W') : (nz > 0 ? 'S' : 'N'));

/**
 * A one-step wall quad as a template: its two triangles, each vertex tagged
 * with the corner it sits on (tl, tr, bl, br as seen from outside). Each
 * triangle keeps its own UVs: the game maps the two halves of a wall step to
 * separate (often rotated) atlas cells.
 */
export function quadCorners(f, colors, ts) {
  const t0 = ts[0];
  const nx = f[t0 * 9 + 3], nz = f[t0 * 9 + 5];
  const r = [-nz, nx]; // right along the wall, seen from outside: (-n) x up
  const vs = [];
  for (const t of ts) for (let j = 0; j < 3; j++) vs.push(t + j);
  const s = (i) => f[i * 9] * r[0] + f[i * 9 + 2] * r[1];
  const ss = vs.map(s), ys = vs.map((i) => f[i * 9 + 1]);
  const sMid = (Math.min(...ss) + Math.max(...ss)) / 2, yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const tris = ts.map((t) => [0, 1, 2].map((j) => {
    const i = t + j, k = vs.indexOf(i);
    const dv = new DataView(f.buffer, f.byteOffset + i * STRIDE, STRIDE);
    return {
      corner: `${ys[k] > yMid ? 't' : 'b'}${ss[k] > sMid ? 'r' : 'l'}`,
      uv: [dv.getFloat32(28, true), dv.getFloat32(32, true)],
      rgba: new Uint8Array(f.buffer, f.byteOffset + i * STRIDE + 24, 4).slice(),
      color: colors.slice(i * 8, i * 8 + 8),
    };
  }));
  // a proper quad covers all four corners and no triangle repeats one
  const all = new Set(tris.flat().map((v) => v.corner));
  if (all.size !== 4 || tris.some((tri) => new Set(tri.map((v) => v.corner)).size !== 3)) return null;
  return { tris };
}

/** Six vertices (two CCW triangles) for one step of wall on an edge, copied from a template quad. */
function wallQuad(e, step, normal, t) {
  const y0 = step * U, y1 = (step + 1) * U;
  const p0 = e.axis === 0 ? [e.line, e.cell] : [e.cell, e.line];
  const p1 = e.axis === 0 ? [e.line, e.cell + 1] : [e.cell + 1, e.line];
  const r = [-normal[2], normal[0]];
  const [left, right] = p0[0] * r[0] + p0[1] * r[1] < p1[0] * r[0] + p1[1] * r[1] ? [p0, p1] : [p1, p0];
  const at = { tl: [left[0], y1, left[1]], tr: [right[0], y1, right[1]], bl: [left[0], y0, left[1]], br: [right[0], y0, right[1]] };
  return t.tris.flatMap((tri) => tri.map((v) => ({ pos: at[v.corner], normal, uv: v.uv, rgba: v.rgba, color: v.color })));
}

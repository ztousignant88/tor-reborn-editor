// A tile's look from another map (map editor). Each map's terrain is textured
// from its own 2048x1024 BC7 atlas (bgNNN_00_..., with a same-sized RGBA "_m"
// companion), cut into 64x32-pixel cells on a 32x32 grid: a tile top or one
// step of wall uses one cell per triangle. Importing a look copies the cells the
// source tile uses into unused, fully transparent cells of this map's atlas -
// BC7 stores 4x4-pixel blocks, so a cell is 16x8 blocks moved as they are, no
// re-encoding - and the source's top triangles and wall-step templates come
// along with their texture coordinates moved to the new cells. They take this
// map's baked lighting (its average for tile tops and for walls by facing), not
// the source map's, so a tile from a dark dungeon isn't dark in a sunny town.
// rebuildModel then uses them like a same-map look (see `looks` there). A copy
// no tile uses any more gives its cells back (releaseUnusedLooks), so reverting
// a tile doesn't use up the atlas.

import { HEIGHT_UNIT as U, TEXTURE_FORMAT, sceneTextures } from './bgscene.js';
import { facingKey, quadCorners, tileSurfaces } from './meshedit.js';
import { textureRGBA } from '../ui/texcanvas.js';

const STRIDE = 36;
const EPS = 1e-3;
const CELL_W = 64, CELL_H = 32;
const ATLAS_W = 2048, ATLAS_H = 1024;
const COLS = ATLAS_W / CELL_W, ROWS = ATLAS_H / CELL_H;
const BLOCK = 16; // bytes per 4x4 BC7 block

/** The colour atlas and its RGBA companion, as views into the scene. */
export function atlases(scene) {
  const textures = sceneTextures(scene);
  const color = textures.find((t) => /^bg\d{3}_00_/.test(t.name) && t.format === TEXTURE_FORMAT.BC7);
  const mask = textures.find((t) => /^bg\d{3}_00_.*_m/.test(t.name) && t.format === TEXTURE_FORMAT.RGBA8);
  if (!color || color.width !== ATLAS_W || color.height !== ATLAS_H) throw new Error('this map has no 2048x1024 colour atlas');
  if (mask && (mask.width !== ATLAS_W || mask.height !== ATLAS_H)) throw new Error('unexpected atlas companion size');
  return { color, mask };
}

/** Cells (cx, cy ranges) a triangle's UVs cover. */
function cellRect(uvs) {
  const us = uvs.map((uv) => uv[0] * ATLAS_W), vs = uvs.map((uv) => uv[1] * ATLAS_H);
  const clamp = (v, n) => Math.max(0, Math.min(n - 1, v));
  return {
    x0: clamp(Math.floor(Math.min(...us) / CELL_W + EPS), COLS), x1: clamp(Math.floor(Math.max(...us) / CELL_W - EPS), COLS),
    y0: clamp(Math.floor(Math.min(...vs) / CELL_H + EPS), ROWS), y1: clamp(Math.floor(Math.max(...vs) / CELL_H - EPS), ROWS),
  };
}

/** tileLook, kept on the map (its model never changes: edits build new ones). */
export function groundLook(map, index) {
  return cachedLook(map,index);
}

/** Every tile's surface as the map was made (meshedit.js tileSurfaces), kept on the map. */
function surfacesOf(map) {
  return (map.surfaceCache ??= tileSurfaces(map.model.verts, map.width, map.depth, map.originalHeights));
}

function cachedLook(map, index) {
  map.lookCache ??= new Map();
  if (!map.lookCache.has(index)) map.lookCache.set(index, tileLook(map, index));
  return map.lookCache.get(index);
}

/** The source tile's top triangles (relative to its corner and top) and its wall-step templates. */
function tileLook(map, index) {
  const { width } = map;
  const sx = index % width, sz = Math.floor(index / width), h = map.originalHeights[index];
  const { verts, colors } = map.model;
  const n = verts.length / STRIDE;
  const f = new Float32Array(verts.buffer, verts.byteOffset, n * 9);
  const dv = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  const tops = [];
  const quads = new Map();
  for (let t = 0; t < n; t += 3) {
    const p = [0, 1, 2].map((j) => [f[(t + j) * 9], f[(t + j) * 9 + 1], f[(t + j) * 9 + 2]]);
    const minY = Math.min(...p.map((q) => q[1])), maxY = Math.max(...p.map((q) => q[1]));
    if (Math.abs(f[t * 9 + 4]) < 0.01) {
      // a wall step on one of the tile's edges, facing away from it
      const nx = f[t * 9 + 3], nz = f[t * 9 + 5];
      for (const [axis, other] of [[0, 2], [2, 0]]) {
        const line = p[0][axis];
        if (Math.abs(line - Math.round(line)) > EPS || p.some((q) => Math.abs(q[axis] - line) > EPS)) continue;
        const cell = Math.floor((p[0][other] + p[1][other] + p[2][other]) / 3);
        const sign = Math.sign(axis === 0 ? nx : nz);
        const ownerX = axis === 0 ? (sign > 0 ? Math.round(line) - 1 : Math.round(line)) : cell;
        const ownerZ = axis === 0 ? cell : (sign > 0 ? Math.round(line) - 1 : Math.round(line));
        if (ownerX !== sx || ownerZ !== sz || Math.abs((maxY - minY) / U - 1) > 0.01) continue;
        const key = `${axis}:${Math.round(line)}:${cell}:${Math.round(maxY / U)}`;
        if (!quads.has(key)) quads.set(key, []);
        quads.get(key).push(t);
      }
      continue;
    }
  }
  // the tile's surface: its flat top or sloped roof, gables, and what stands on it
  const surfaces = surfacesOf(map);
  for (const t of surfaces.byTile.get(index) ?? []) {
    tops.push([0, 1, 2].map((j) => {
      const i = t + j;
      return {
        pos: [f[i * 9] - sx, f[i * 9 + 1] - h * U, f[i * 9 + 2] - sz],
        normal: [f[i * 9 + 3], f[i * 9 + 4], f[i * 9 + 5]],
        uv: [dv.getFloat32(i * STRIDE + 28, true), dv.getFloat32(i * STRIDE + 32, true)],
        rgba: verts.slice(i * STRIDE + 24, i * STRIDE + 28),
        color: colors.slice(i * 8, i * 8 + 8),
      };
    }));
  }
  const templates = []; // depth below the top -> facing -> quad corners
  for (const [key, ts] of quads) {
    if (ts.length !== 2) continue;
    const q = quadCorners(f, colors, ts);
    if (!q) continue;
    const d = h - Number(key.split(':')[3]);
    if (d < 0) continue;
    q.facing = facingKey(f[ts[0] * 9 + 3], f[ts[0] * 9 + 5]);
    templates[d] ??= {};
    templates[d][q.facing] ??= q;
  }
  return { sx, sz, h, tops, templates, drops: surfaces.drops(index) };
}

/** A map's average baked light (vertex rgba and colour-block bytes) for tile tops and for walls by facing. */
function lighting(map) {
  const { verts, colors } = map.model;
  const n = verts.length / STRIDE;
  const f = new Float32Array(verts.buffer, verts.byteOffset, n * 9);
  const sums = {};
  for (let i = 0; i < n; i++) {
    const nx = f[i * 9 + 3], ny = f[i * 9 + 4], nz = f[i * 9 + 5];
    const k = ny > 0.9 ? 'top' : Math.abs(ny) < 0.01 ? facingKey(nx, nz) : null;
    if (!k) continue;
    const acc = (sums[k] ??= { n: 0, rgba: [0, 0, 0, 0], color: new Array(8).fill(0) });
    acc.n++;
    for (let j = 0; j < 4; j++) acc.rgba[j] += verts[i * STRIDE + 24 + j];
    for (let j = 0; j < 8; j++) acc.color[j] += colors[i * 8 + j];
  }
  const out = {};
  for (const [k, acc] of Object.entries(sums)) {
    out[k] = { rgba: Uint8Array.from(acc.rgba, (v) => Math.round(v / acc.n)), color: Uint8Array.from(acc.color, (v) => Math.round(v / acc.n)) };
  }
  const walls = ['E', 'W', 'S', 'N'].map((k) => out[k]).filter(Boolean);
  const any = out.top ?? walls[0];
  for (const k of ['top', 'E', 'W', 'S', 'N']) out[k] ??= walls[0] ?? any;
  return out;
}

/** Cells of the target atlas that nothing uses and that are fully transparent. */
function freeCells(target, color) {
  const used = new Set(target.importedCells ?? []);
  const { verts } = target.model;
  const dv = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  for (let t = 0; t < verts.length / STRIDE; t += 3) {
    const r = cellRect([0, 1, 2].map((j) => [dv.getFloat32((t + j) * STRIDE + 28, true), dv.getFloat32((t + j) * STRIDE + 32, true)]));
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) used.add(y * COLS + x);
  }
  const px = textureRGBA(color);
  const free = new Set();
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
    if (used.has(cy * COLS + cx)) continue;
    let clear = true;
    for (let y = 0; y < CELL_H && clear; y++) {
      const row = ((cy * CELL_H + y) * ATLAS_W + cx * CELL_W) * 4;
      for (let x = 0; x < CELL_W; x++) if (px[row + x * 4 + 3]) { clear = false; break; }
    }
    if (clear) free.add(cy * COLS + cx);
  }
  return free;
}

/** The free cells of target's atlas, kept on it: imports take their cells from this set. */
export function freeRoom(target) {
  return (target.freeCells ??= freeCells(target, atlases(target.scene).color));
}

/** Atlas cells a look of source's tile `index` takes in target (0 when it was copied in before). */
export function lookCost(target, source, index) {
  if (target.imports?.has(`${source.id}:${index}`)) return 0;
  const look = cachedLook(source, index);
  const rects = new Set();
  let cells = 0;
  const add = (tri) => {
    const r = cellRect(tri.map((v) => v.uv));
    const k = `${r.x0},${r.y0},${r.x1},${r.y1}`;
    if (!rects.has(k)) { rects.add(k); cells += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }
  };
  look.tops.forEach(add);
  for (const byFacing of look.templates) for (const q of Object.values(byFacing ?? {})) q.tris.forEach(add);
  return cells;
}

/**
 * Every tile's top as the map was made: { tris: [[{pos (from the tile's corner and
 * top), uv}] x3], key }. Tiles with the same key are painted the same from above
 * (the map editor's Blocks palette shows one of each).
 */
export function tileTops(map) {
  if (map.topsCache) return map.topsCache;
  const { width, depth } = map;
  const { verts } = map.model;
  const n = verts.length / STRIDE;
  const f = new Float32Array(verts.buffer, verts.byteOffset, n * 9);
  const dv = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  const tops = map.tiles.map(() => []);
  const surfaces = surfacesOf(map);
  for (const [i, list] of surfaces.byTile) for (const t of list) {
    if (Math.abs(f[t * 9 + 4]) < 0.01) continue; // upright pieces don't show from above
    const p = [0, 1, 2].map((j) => [f[(t + j) * 9], f[(t + j) * 9 + 1], f[(t + j) * 9 + 2]]);
    const x = i % width, z = Math.floor(i / width), top = map.originalHeights[i] * U;
    tops[i].push([0, 1, 2].map((j) => ({
      pos: [p[j][0] - x, p[j][1] - top, p[j][2] - z],
      uv: [dv.getFloat32((t + j) * STRIDE + 28, true), dv.getFloat32((t + j) * STRIDE + 32, true)],
    })));
  }
  const key = (tris) => tris.map((tri) => tri.map((v) => `${Math.round(v.uv[0] * ATLAS_W)},${Math.round(v.uv[1] * ATLAS_H)}`).join(';')).sort().join('|');
  map.topsCache = tops.map((tris) => ({ tris, key: tris.length ? key(tris) : '' }));
  return map.topsCache;
}

function allocate(free, w, h) {
  for (let cy = 0; cy + h <= ROWS; cy++) for (let cx = 0; cx + w <= COLS; cx++) {
    let ok = true;
    for (let y = 0; y < h && ok; y++) for (let x = 0; x < w && ok; x++) ok = free.has((cy + y) * COLS + cx + x);
    if (!ok) continue;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) free.delete((cy + y) * COLS + cx + x);
    return { x: cx, y: cy };
  }
  return null;
}

// A cell's bytes: BC7 rows of 16 blocks (8 rows per cell, 512 blocks per atlas
// row) in the colour atlas, RGBA rows of 64 pixels in the "_m" companion.
const colorRows = (cx, cy) => Array.from({ length: CELL_H / 4 }, (_, by) => ((cy * CELL_H / 4 + by) * (ATLAS_W / 4) + cx * CELL_W / 4) * BLOCK);
const maskRows = (cx, cy) => Array.from({ length: CELL_H }, (_, y) => ((cy * CELL_H + y) * ATLAS_W + cx * CELL_W) * 4);
const COLOR_ROW = (CELL_W / 4) * BLOCK, MASK_ROW = CELL_W * 4;

function copyCell(from, to, sx, sy, dx, dy) {
  const s = colorRows(sx, sy), d = colorRows(dx, dy);
  s.forEach((o, k) => to.color.data.set(from.color.data.subarray(o, o + COLOR_ROW), d[k]));
  if (!from.mask || !to.mask) return;
  const sm = maskRows(sx, sy), dm = maskRows(dx, dy);
  sm.forEach((o, k) => to.mask.data.set(from.mask.data.subarray(o, o + MASK_ROW), dm[k]));
}

/** Keep a free cell's own bytes before a copy goes into it, to put back if the copy is dropped. */
function keepCell(target, to, cell) {
  target.cellBackups ??= new Map();
  if (target.cellBackups.has(cell)) return;
  const cx = cell % COLS, cy = Math.floor(cell / COLS);
  target.cellBackups.set(cell, {
    color: colorRows(cx, cy).map((o) => to.color.data.slice(o, o + COLOR_ROW)),
    mask: to.mask ? maskRows(cx, cy).map((o) => to.mask.data.slice(o, o + MASK_ROW)) : null,
  });
}

/**
 * Copies no tile uses any more (their tiles reverted or given another look) give
 * their cells back: the cells' own bytes return and they count as free again.
 * Returns how many cells came back.
 */
export function releaseUnusedLooks(target) {
  if (!target.imports?.size) return 0;
  // a look copied in whole, or a planned look built from pieces of copied ones (terrainplanner.js)
  const inUse = new Set([...target.looks.values()].flatMap((l) => (l?.foreign ? [l.key] : l?.planned ? l.uses ?? [] : [])));
  const unused = [...target.imports].filter(([key]) => !inUse.has(key));
  if (!unused.length) return 0;
  const to = atlases(target.scene);
  let freed = 0;
  for (const [key, look] of unused) {
    for (const cell of look.cellList) {
      const b = target.cellBackups.get(cell);
      const cx = cell % COLS, cy = Math.floor(cell / COLS);
      colorRows(cx, cy).forEach((o, k) => to.color.data.set(b.color[k], o));
      if (b.mask) maskRows(cx, cy).forEach((o, k) => to.mask.data.set(b.mask[k], o));
      target.importedCells.delete(cell);
      target.freeCells?.add(cell);
      freed++;
    }
    target.imports.delete(key);
  }
  return freed;
}

/**
 * The look of `source`'s tile `index`, for `target` (MapFile objects): its
 * cells are copied into target's atlas (in place) and the returned look uses them.
 */
export function importLook(target, source, index) {
  target.imports ??= new Map();
  const key = `${source.id}:${index}`;
  if (target.imports.has(key)) return target.imports.get(key);
  const look = cachedLook(source, index);
  if (!look.tops.length) throw new Error(`tile ${look.sx}, ${look.sz} of ${source.id} has no top surface to copy`);
  const from = atlases(source.scene);
  const to = atlases(target.scene);
  const free = freeRoom(target);
  const need = lookCost(target, source, index);
  if (need > free.size) throw new Error(`no room left in this map's texture atlas: this look needs ${need} cells, ${free.size} are free`);
  target.importedCells ??= new Set();

  const moved = new Map(); // "x0,y0,x1,y1" -> destination corner
  const cellList = []; // the target cells this look fills
  const shifted = (tri) => {
    const r = cellRect(tri.map((v) => v.uv));
    const k = `${r.x0},${r.y0},${r.x1},${r.y1}`;
    if (!moved.has(k)) {
      const at = allocate(free, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1);
      if (!at) throw new Error('no free room left in this map\'s texture atlas');
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
        const cell = (at.y + y - r.y0) * COLS + at.x + x - r.x0;
        keepCell(target, to, cell);
        copyCell(from, to, x, y, at.x + x - r.x0, at.y + y - r.y0);
        target.importedCells.add(cell);
        cellList.push(cell);
      }
      moved.set(k, at);
    }
    const at = moved.get(k);
    const du = ((at.x - r.x0) * CELL_W) / ATLAS_W, dv = ((at.y - r.y0) * CELL_H) / ATLAS_H;
    return tri.map((v) => ({ ...v, uv: [v.uv[0] + du, v.uv[1] + dv] }));
  };
  const light = lighting(target);
  const lit = (tri, k) => tri.map((v) => ({ ...v, rgba: light[k].rgba.slice(), color: light[k].color.slice() }));
  // flat and sloped pieces take this map's top light, upright ones (gables) its wall light for their facing
  const tops = look.tops.map((tri) => lit(shifted(tri), Math.abs(tri[0].normal[1]) < 0.01 ? facingKey(tri[0].normal[0], tri[0].normal[2]) : 'top'));
  const templates = look.templates.map((byFacing) => byFacing && Object.fromEntries(Object.entries(byFacing).map(([facing, q]) => [facing, {
    ...q, tris: q.tris.map((tri) => lit(shifted(tri), facing)), source: { foreign: key },
  }])));
  const result = {
    foreign: true, key, sourceId: source.id, x: look.sx, y: look.sz, height: look.h,
    kind: source.materials[source.tiles[index].surface]?.kind ?? null,
    tops, templates, drops: look.drops, cells: cellList.length, cellList,
  };
  target.imports.set(key, result);
  return result;
}

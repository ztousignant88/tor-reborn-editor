// An editable battle map: Data/bg/<id>.dat, pakd entry 0 = the map scene.
// Phase 1 edits the game's tile data in place (same sizes, so nothing else in
// the file moves): each tile record in section 1 (see bgmap.js) holds
//   +0x42 u16 ? (2-4 on the house map; kept as is)
//   +0x46 u16 height
//   +0x48 u8  terrain code: a row of the map's material table (section 5, 32 rows
//             of 32 bytes: +0 u16 terrain kind = PANELTEXT_LC_PANEL_<kind>_NAME,
//             +4 the object that sits on tiles of this code, e.g. Golyat 30 =
//             road with a shipping crate)
//   +0x4A u16 destructible object type, 0xFFFF = none (the high byte must be
//             0 too: 0xFF09 is no object to the game)
// and, after 0x70, the 3D-model triangles that belong to the tile (12-byte
// groups of vertex indices). Header +0x5A (max height) is raised when a tile
// goes higher. When heights change, the 3D model is rebuilt to match on save
// (see meshedit.js); the file then grows, and the pakd is rebuilt around it.

import { buildPakdWithIds, view } from '../lib/pakd.js';
import { encodeDat, loadDat } from './datfile.js';
import { buildScene, readModel, rebuildModel } from './meshedit.js';

const NO_OBJECT = 0xFFFF;
export const MAX_HEIGHT = 60;

export class MapFile {
  static async load(id) {
    return new MapFile(await loadDat(`bg/${id}.dat`), id);
  }

  constructor(dat, id) {
    this.dat = dat;
    this.id = id;
    this.path = dat.path;
    this.scene = dat.pakd.entries[0].data; // a view into dat.pack: edits go straight into the pack
    const v = view(this.scene);
    this.width = v.getUint16(0x56, true);
    this.depth = v.getUint16(0x58, true);
    const count = v.getUint16(0x50, true);
    const start = v.getUint32(0x28, true) + 0x10;
    const end = v.getUint32(0x2C, true) + 0x10;
    this.records = [];
    let o = start;
    for (let i = 0; i < count; i++) {
      const size = v.getUint32(o, true);
      if (size < 0x50 || o + size > end) throw new Error(`${this.path}: bad tile record ${i}`);
      this.records.push(o);
      o += size;
    }
    if (o !== end) throw new Error(`${this.path}: tile records did not end where expected`);
    this.tilesStart = start;
    this.original = this.scene.slice(0, end); // header + tile records, to compare and revert
    this.tiles = this.records.map((_, i) => this.readTile(i));
    const mat = v.getUint32(0x24 + 5 * 4, true) + 0x10;
    this.materials = Array.from({ length: 32 }, (_, c) => ({
      code: c, kind: v.getUint16(mat + c * 32, true), family: v.getUint16(mat + c * 32 + 8, true), object: v.getUint16(mat + c * 32 + 4, true) || null,
      used: this.tiles.filter((t) => t.surface === c).length,
    }));
    this.originalHeights = this.tiles.map((t) => t.height);
    this.model = readModel(this.scene);
    this.wallLooks = new Map(); // tile -> facing/height-section -> original side-sample tile
    this.looks = new Map(); // tile index -> tile whose look (top and walls) it takes
    this.rebuildCache = null;
    // Object pictures are pakd entries keyed by object type (128x128 btx). One
    // copied in from another map (map editor, Objects tab) is saved while a tile uses it.
    this.addedSprites = new Map(); // object type -> entry bytes
  }

  /** Object types this file has a picture for. */
  get spriteTypes() { return [...this.dat.pakd.entries.slice(1).map((e) => e.id), ...this.addedSprites.keys()]; }

  addSprite(type, data) { if (!this.spriteTypes.includes(type)) this.addedSprites.set(type, data); }

  /** Copied-in pictures that some tile uses (the ones saved). */
  get usedAddedSprites() { return [...this.addedSprites].filter(([type]) => this.tiles.some((t) => t.object === type)); }

  get heightsChanged() { return this.tiles.some((t, i) => t.height !== this.originalHeights[i]); }
  get modelChanged() { return this.heightsChanged || this.looks.size > 0 || this.wallLooks.size > 0; }

  /** Give tile i the look of tile `source` (null: its own look), or a look imported from another map (lookimport.js). */
  setLook(i, source) {
    if (source === null || source === i) this.looks.delete(i); else this.looks.set(i, source);
  }

  /** The model rebuilt for the current heights: { model, notes, walls }. */
  rebuilt() {
    const heights = this.tiles.map((t) => t.height);
    const key = `${heights.join(',')}|${JSON.stringify([...this.wallLooks])}|${this.tiles.map(t=>t.surface).join(',')}|${[...this.looks].map(([k, v]) => `${k}:${v?.foreign || v?.planned ? v.key : v}`).join(';')}`;
    if (this.rebuildCache?.key !== key) {
      this.rebuildCache = { key, ...rebuildModel(this.model, this.width, this.depth, this.originalHeights, heights, this.looks, {
        wallLooks:this.wallLooks,
        originalFamilies:this.tiles.map((_,i)=>this.materials[this.originalTile(i).surface]?.family),
        families:this.tiles.map(t=>this.materials[t.surface]?.family),
      }) };
    }
    return this.rebuildCache;
  }

  /** Terrain mesh for the 3D view, in the shape bgscene.js gives. */
  previewMesh() {
    const { model } = this.rebuilt();
    return { count: model.verts.length / 36, vertices: model.verts };
  }

  readTile(i) {
    const o = this.records[i];
    const v = view(this.scene);
    return {
      index: i, x: i % this.width, y: Math.floor(i / this.width),
      height: v.getUint16(o + 0x46, true),
      surface: this.scene[o + 0x48],
      object: v.getUint16(o + 0x4A, true) === NO_OBJECT ? null : this.scene[o + 0x4A],
      kind: v.getUint16(o + 0x42, true),
    };
  }

  originalTile(i) {
    const o = this.records[i];
    const v = view(this.original);
    return {
      height: v.getUint16(o + 0x46, true),
      surface: this.original[o + 0x48],
      object: v.getUint16(o + 0x4A, true) === NO_OBJECT ? null : this.original[o + 0x4A],
    };
  }

  tileAt(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.depth ? this.tiles[y * this.width + x] : null; }

  get maxHeight() { return view(this.scene).getUint16(0x5A, true); }

  /** Change one tile; returns false if nothing changed. */
  set(i, field, value) {
    const o = this.records[i];
    const v = view(this.scene);
    if (field === 'height') {
      const h = Math.max(0, Math.min(MAX_HEIGHT, Math.round(value)));
      if (h === this.tiles[i].height) return false;
      v.setUint16(o + 0x46, h, true);
      if (h > this.maxHeight) v.setUint16(0x5A, h, true);
    } else if (field === 'surface') {
      const s = Math.max(0, Math.min(255, Math.round(value)));
      if (s === this.tiles[i].surface) return false;
      this.scene[o + 0x48] = s;
    } else if (field === 'object') {
      const want = value === null || value === '' ? NO_OBJECT : Math.max(0, Math.min(254, Math.round(value)));
      if (want === v.getUint16(o + 0x4A, true)) return false;
      v.setUint16(o + 0x4A, want, true);
    } else {
      throw new Error(`unknown tile field ${field}`);
    }
    this.tiles[i] = this.readTile(i);
    return true;
  }

  tileChanged(i) {
    if (this.looks.has(i) || this.wallLooks.has(i)) return true;
    const o = this.records[i];
    for (const k of [0x46, 0x47, 0x48, 0x4A, 0x4B]) if (this.scene[o + k] !== this.original[o + k]) return true;
    return false;
  }

  revertTile(i) {
    const o = this.records[i];
    for (const k of [0x46, 0x47, 0x48, 0x4A, 0x4B]) this.scene[o + k] = this.original[o + k];
    this.looks.delete(i);
    this.wallLooks.delete(i);
    this.tiles[i] = this.readTile(i);
    this.fixMaxHeight();
  }

  /** Max height back to the original, or the highest tile if that is higher. */
  fixMaxHeight() {
    const v = view(this.scene);
    const top = Math.max(view(this.original).getUint16(0x5A, true), ...this.tiles.map((t) => t.height));
    v.setUint16(0x5A, top, true);
  }

  get changedTiles() { return this.tiles.filter((t) => this.tileChanged(t.index)); }
  get dirty() { return this.changedTiles.length > 0 || view(this.scene).getUint16(0x5A, true) !== view(this.original).getUint16(0x5A, true) || this.usedAddedSprites.length > 0; }

  /** A grid object in the shape MapView3D expects. */
  grid() {
    return { path: this.path, name: this.id, width: this.width, depth: this.depth, maxHeight: this.maxHeight, tiles: this.tiles, tileAt: (x, y) => this.tileAt(x, y) };
  }

  encode() {
    const added = this.usedAddedSprites.map(([id, data]) => ({ id, data }));
    if (!this.modelChanged && !added.length) return encodeDat(this.dat.pack, this.dat.entryName);
    const scene = this.modelChanged ? buildScene(this.scene, this.rebuilt().model) : this.scene;
    const [first, ...rest] = this.dat.pakd.entries.map((e, i) => ({ id: e.id, data: i === 0 ? scene : e.data }));
    // pictures in object-type order, as the game's own files have them
    const pack = buildPakdWithIds([first, ...[...rest, ...added].sort((a, b) => a.id - b.id)]);
    return encodeDat(pack, this.dat.entryName);
  }
}

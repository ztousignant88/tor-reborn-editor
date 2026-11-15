// Maps mode, Blocks and Objects tabs: the tile looks ("blocks") and object
// pictures of this map or another one, to drag onto a tile (or click to give to
// every selected tile).
//
// Slots: a block from this map costs nothing (the tile only points at another
// tile's look). A block from another map copies its texture cells into this
// map's 2048x1024 atlas (lookimport.js), so the Blocks tab shows the free cells
// and what each block takes; using the same block again is free. An object from
// another map copies its picture into this map's file (MapFile.addSprite); the
// tab counts this map's pictures against the most any game map carries.

import { freeRoom, lookCost, tileTops } from '../game/lookimport.js';
import { MAX_HEIGHT } from '../game/mapfile.js';
import { parseBtx } from '../game/bgscene.js';
import { loadObjectDefinitions, objectSprite } from '../game/objectsprites.js';
import { drawBlock } from '../ui/blockthumb.js';
import { textureCanvas } from '../ui/texcanvas.js';

export const DRAG_TYPE = 'application/x-tor-palette';
// The most object pictures any of the game's 395 maps carries (bg survey,
// 2026-11-02); the game's real limit is not known.
export const MAX_OBJECT_PICTURES = 25;
const ATLAS_CELLS = 32 * 32;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** An object picture's texture from a MapFile (its own entry or one copied in). */
export function spriteTexture(file, type) {
  const data = file.dat.pakd.entries.slice(1).find((e) => e.id === type)?.data ?? file.addedSprites.get(type);
  return data ? objectSprite(parseBtx(data, 0), type) : null;
}

export class MapPalette {
  constructor(editor) {
    this.ed = editor;
    this.source = ''; // '' = the open map, else another map's id
    // Blocks: 'stack' = placing a block puts one on top (height + 1, the block's top and sides);
    // 'paint' = only the tile's look changes (the old behaviour)
    this.mode = 'stack';
    this.armed = null; // the block that clicks on the map place, { kind:'block', map, x, y }
  }

  async sourceFile() {
    const map = this.ed.map;
    return !this.source || this.source === map.id ? map : this.ed.sourceMap(this.source);
  }

  /** Fill `box` with the Blocks or Objects tab. */
  async render(box, tab) {
    const map = this.ed.map;
    if (!map) { box.innerHTML = '<p class="muted pad">Choose a map.</p>'; return; }
    let src;
    try {
      src = await this.sourceFile();
    } catch (err) {
      box.innerHTML = `<p class="muted pad">Can't open ${esc(this.source)}: ${esc(err.message)}</p>`;
      return;
    }
    if (tab === 'objects') await loadObjectDefinitions();
    if (this.ed.map !== map) return; // another map was opened meanwhile
    const maps = this.ed.ctx.catalog.maps;
    const options = [`<option value="">This map (${esc(map.id)})</option>`,
      ...maps.filter((m) => m.id !== map.id).map((m) => {
        const place = this.ed.ctx.catalog.placeLabel(m.id);
        return `<option value="${esc(m.id)}" ${m.id === this.source ? 'selected' : ''}>${esc(m.id)}${place ? ` · ${esc(place)}` : ''}</option>`;
      })].join('');
    box.innerHTML = `
      <div class="mp-pal-head">
        <div class="mp-room"></div>
        <label class="field"><span class="field-label">${tab === 'blocks' ? 'Blocks from' : 'Objects from'}</span><select class="mp-pal-src">${options}</select></label>
        ${tab === 'blocks' ? `<div class="mp-mode" role="radiogroup" aria-label="What placing a block does">
          <label title="The tile goes up one height step and takes the block's top and sides. Click again to keep building up."><input type="radio" name="mp-mode" value="stack" ${this.mode === 'stack' ? 'checked' : ''}> Place a block (+1 height)</label>
          <label title="Only the tile's look changes; its height stays."><input type="radio" name="mp-mode" value="paint" ${this.mode === 'paint' ? 'checked' : ''}> Paint the top only</label>
        </div>
        <div class="mp-mode-actions"><button class="mp-lower" title="Lower the selected tiles one height step (Shift-click a tile while a block is picked does the same)">Take a block off (−1)</button><button class="mp-disarm ghost" ${this.armed ? '' : 'disabled'}>Stop placing</button></div>` : ''}
        <p class="hint mp-pal-hint"></p>
      </div>
      <div class="mp-grid"></div>`;
    box.querySelector('.mp-pal-src').onchange = (e) => { this.source = e.target.value; this.render(box, tab); };
    for (const r of box.querySelectorAll('[name="mp-mode"]')) r.onchange = () => { this.mode = r.value; this.updateHint(box); };
    const lower = box.querySelector('.mp-lower');
    if (lower) lower.onclick = () => this.takeOff();
    const disarm = box.querySelector('.mp-disarm');
    if (disarm) disarm.onclick = () => { this.armed = null; this.render(box, tab); };
    const grid = box.querySelector('.mp-grid');
    if (tab === 'blocks') this.fillBlocks(box, grid, map, src); else this.fillObjects(box, grid, map, src);
    this.updateHint(box);
  }

  /** The line under the source picker: what a click or a drop does now. */
  updateHint(box) {
    const n = this.ed.selected.size;
    const hint = box.querySelector('.mp-pal-hint');
    if (!hint) return;
    if (this.ed.tab === 'blocks' && this.armed) hint.textContent = `Block picked: click tiles on the map to ${this.mode === 'stack' ? 'build up with it, one step per click' : 'paint them with it'}. Shift-click takes a block off. Ctrl-click selects.`;
    else hint.textContent = this.ed.tab === 'blocks'
      ? `Click a block to pick it, then click tiles on the map to place it. Or drag one onto a tile.${n ? ` Picking one also gives it to the ${n} selected tile${n > 1 ? 's' : ''}.` : ''}`
      : `Drag one onto a tile, or click one to give it to the ${n ? `${n} selected tile${n > 1 ? 's' : ''}` : 'selected tiles (none selected yet)'}.`;
  }

  // ---- blocks -----------------------------------------------------------
  fillBlocks(box, grid, map, src) {
    const foreign = src !== map;
    let free;
    try {
      free = freeRoom(map).size;
    } catch (err) {
      box.querySelector('.mp-room').innerHTML = `<p class="muted">${esc(err.message)}: blocks can't be copied into it.</p>`;
      if (foreign) return;
    }
    if (free !== undefined) {
      box.querySelector('.mp-room').innerHTML = `
        <div class="mp-room-line"><b>Atlas room</b><span>${free} of ${ATLAS_CELLS} cells free</span></div>
        <div class="meter"><i style="width:${Math.round((100 * free) / ATLAS_CELLS)}%"></i></div>
        <p class="hint">Blocks from this map are free. One from another map copies its picture into this map's texture atlas and takes the cells shown on it, once; more tiles of that block are free.</p>`;
    }
    let tops;
    try {
      tops = tileTops(src);
    } catch (err) {
      grid.innerHTML = `<p class="muted pad">${esc(err.message)}</p>`;
      return;
    }
    const groups = new Map();
    tops.forEach((top, i) => {
      if (!top.key) return;
      const g = groups.get(top.key);
      if (g) g.count++; else groups.set(top.key, { index: i, count: 1, tris: top.tris });
    });
    const blocks = [...groups.values()].sort((a, b) => b.count - a.count || a.index - b.index);
    if (!blocks.length) { grid.innerHTML = '<p class="muted pad">This map has no tile tops to copy.</p>'; return; }
    const costs = [];
    for (const b of blocks) {
      const t = src.tiles[b.index];
      const kind = this.ed.kindName(src.materials[t.surface]?.kind);
      let cost = 0, problem = null;
      if (foreign) {
        try { cost = lookCost(map, src, b.index); } catch (err) { problem = err.message; }
        if (cost) costs.push(cost);
      }
      const full = foreign && (problem || free === undefined || cost > free);
      const el = document.createElement('button');
      const picked = this.armed && this.armed.map === src.id && this.armed.x === t.x && this.armed.y === t.y;
      el.className = `mp-block${full ? ' full' : ''}${picked ? ' armed' : ''}`;
      el.draggable = !full;
      el.title = `${src.id} tile ${t.x}, ${t.y}: ${kind}, ${b.count} tile${b.count > 1 ? 's' : ''} look like this${foreign ? `\n${problem ?? (cost ? `Copying it in takes ${cost} of the ${free ?? 0} free atlas cells` : 'Already copied in: free')}` : ''}`;
      try {
        el.append(drawBlock(src, b.tris));
      } catch (err) {
        el.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: '?' }));
      }
      el.insertAdjacentHTML('beforeend', `<span class="mp-cap">${esc(kind)}</span><span class="mp-sub">×${b.count}${foreign ? ` · ${problem ? 'can\'t copy' : full ? 'no room' : cost ? `${cost} cell${cost > 1 ? 's' : ''}` : 'free'}` : ''}</span>`);
      const data = { kind: 'block', map: src.id, x: t.x, y: t.y };
      el.ondragstart = (e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(data)); e.dataTransfer.effectAllowed = 'copy'; };
      el.onclick = () => {
        if (full) { this.ed.ctx.toast(problem ?? `Not enough room in this map's atlas: this block takes ${cost} cells, ${free ?? 0} are free.`, true); return; }
        this.armed = data; // clicks on the map now place this block
        if (this.ed.selected.size) this.apply(data); else this.render(box, 'blocks');
      };
      grid.append(el);
    }
    if (costs.length && free !== undefined) {
      const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
      box.querySelector('.mp-room-line').insertAdjacentHTML('afterend',
        `<div class="mp-room-line"><span>Room for about <b>${Math.floor(free / avg)}</b> more new blocks from ${esc(src.id)}</span><span class="muted">${Math.min(...costs)}–${Math.max(...costs)} cells each</span></div>`);
    }
  }

  // ---- objects ----------------------------------------------------------
  fillObjects(box, grid, map, src) {
    const foreign = src !== map;
    const pictures = map.spriteTypes.length;
    box.querySelector('.mp-room').innerHTML = `
      <div class="mp-room-line"><b>Object pictures</b><span>${pictures} in this map</span></div>
      <div class="meter"><i style="width:${Math.round((100 * Math.min(pictures, MAX_OBJECT_PICTURES)) / MAX_OBJECT_PICTURES)}%"></i></div>
      <p class="hint">Objects from this map are free. One from another map copies its picture into this map's file (not tried in game yet). The most any game map has is ${MAX_OBJECT_PICTURES}.</p>`;
    const onMap = (type) => map.tiles.filter((t) => t.object === type).length;
    const none = document.createElement('button');
    none.className = 'mp-block';
    none.draggable = true;
    none.innerHTML = `<span class="mp-none">∅</span><span class="mp-cap">No object</span><span class="mp-sub">removes one</span>`;
    const clear = { kind: 'object', map: map.id, type: null };
    none.ondragstart = (e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(clear)); e.dataTransfer.effectAllowed = 'copy'; };
    none.onclick = () => this.apply(clear);
    grid.append(none);
    const types = [...new Set(src.spriteTypes)].sort((a, b) => a - b);
    if (!types.length) grid.insertAdjacentHTML('beforeend', '<p class="muted pad">This map has no object pictures.</p>');
    for (const type of types) {
      const own = map.spriteTypes.includes(type);
      const full = foreign && !own && pictures >= MAX_OBJECT_PICTURES;
      const el = document.createElement('button');
      el.className = `mp-block${full ? ' full' : ''}`;
      el.draggable = !full;
      el.title = `Object type ${type}${foreign ? (own ? `\nThis map has its own picture for type ${type}, so that one is used` : '\nPlacing it copies its picture into this map\'s file') : ''}`;
      try {
        const tex = spriteTexture(src, type);
        if (tex) {
          el.append(textureCanvas(tex, 0.4));
          if (tex.objectSprite?.animated) el.title += `\nAnimated: ${tex.objectSprite.frames.filter(Boolean).length} native frames`;
        }
      } catch { /* no preview */ }
      const count = onMap(type);
      el.insertAdjacentHTML('beforeend', `<span class="mp-cap">Object ${type}</span><span class="mp-sub">${count ? `on ${count} tile${count > 1 ? 's' : ''}` : 'not placed'}${foreign && !own ? ` · ${full ? 'no room' : 'copies picture'}` : ''}</span>`);
      const data = { kind: 'object', map: src.id, type };
      el.ondragstart = (e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(data)); e.dataTransfer.effectAllowed = 'copy'; };
      el.onclick = () => {
        if (full) { this.ed.ctx.toast(`This map already has ${pictures} object pictures, the most any game map has.`, true); return; }
        this.apply(data);
      };
      grid.append(el);
    }
  }

  // ---- placing ----------------------------------------------------------
  /** Give a palette item to the selected tiles. */
  async apply(data) {
    if (!this.ed.selected.size) { this.ed.ctx.toast('Select tiles on the map first, or drag the block onto a tile.', true); return; }
    if (data.kind === 'block') {
      const own = data.map === this.ed.map.id;
      if (!own && this.mode === 'stack') { // don't raise a tile whose block can't be copied in
        const src = await this.ed.sourceMap(data.map);
        const st = src.tileAt(data.x, data.y);
        let cost;
        try { cost = lookCost(this.ed.map, src, st.index); } catch (err) { this.ed.ctx.toast(err.message, true); return; }
        if (cost > freeRoom(this.ed.map).size) { this.ed.ctx.toast(`Not enough room in this map's atlas for that block (${cost} cells).`, true); return; }
      }
      await this.ed.setLook(own ? `${data.x}, ${data.y}` : `${data.map} ${data.x}, ${data.y}`);
      if (this.mode === 'stack') this.ed.edit('height', (t) => Math.min(MAX_HEIGHT, t.height + 1));
    } else if (data.kind === 'object') {
      await this.ed.placeObject(data.type, data.map);
    }
    this.ed.renderSide();
  }

  /** The selected tiles go down one height step. */
  takeOff() {
    if (!this.ed.selected.size) { this.ed.ctx.toast('Select tiles on the map first.', true); return; }
    this.ed.edit('height', (t) => Math.max(0, t.height - 1));
  }

  /** A click on the map while a block is picked: place it there (shift: take one off). True when handled. */
  clicked(tile, mods) {
    if (this.ed.tab !== 'blocks' || !this.armed || !tile || mods.ctrl) return false;
    if (this.ed.ctx.readOnly()) { this.ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return true; }
    this.ed.selected = new Set([tile.index]);
    if (mods.shift) this.takeOff();
    else this.apply(this.armed).catch((err) => this.ed.ctx.toast(err.message, true));
    return true;
  }

  /** A palette item dropped on a tile: that tile (only) takes it. */
  async dropped(tile, dataTransfer) {
    let data;
    try { data = JSON.parse(dataTransfer.getData(DRAG_TYPE) || 'null'); } catch { data = null; }
    if (!data) return;
    this.ed.selected = new Set([tile.index]);
    await this.apply(data);
  }
}

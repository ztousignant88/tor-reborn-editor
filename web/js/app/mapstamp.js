// Maps mode, Stamp tab: copy a group of tiles (a hut, a wall, a patch of
// ground) from any map and place copies on the open map.
//
// Capture: select tiles on the open map and "Copy selection as a stamp". A
// stamp only remembers where its tiles are ({ map, x, y } plus each tile's
// height and object), so it stays small and is kept in this browser
// (localStorage) between sessions.
// Place: pick a stamp, then click a tile: the stamp's top-left corner goes
// there. Each covered tile takes the source tile's look (top, walls and what
// stands on it: copied into this map's atlas when the stamp comes from another
// map, see lookimport.js), its terrain kind, its object, and its height
// relative to the stamp's lowest tile, on top of the clicked tile's height.
// Roof tiles come with their slopes and gables (meshedit.js tileSurfaces).
// Stamps are not rotated: the game shows maps from a fixed view and wall art
// is drawn for the side it faces.

import { freeRoom, importLook, lookCost } from '../game/lookimport.js';
import { MAX_HEIGHT } from '../game/mapfile.js';
import { MAX_OBJECT_PICTURES, spriteTexture } from './mappalette.js';

const STORE = 'tor-editor-map-stamps';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class MapStamp {
  constructor(editor) {
    this.ed = editor;
    this.stamps = [];
    this.picked = -1; // index of the stamp that clicks on the map place
    this.last = null; // { map, tiles: [index] } of the last placement, for "revert"
    try { this.stamps = JSON.parse(localStorage.getItem(STORE) || '[]').filter((s) => s && Array.isArray(s.tiles)); } catch { this.stamps = []; }
  }

  store() { try { localStorage.setItem(STORE, JSON.stringify(this.stamps)); } catch { /* kept for this session only */ } }

  /** The selected tiles of the open map become a stamp. */
  capture() {
    const map = this.ed.map, sel = this.ed.selectedTiles;
    if (!sel.length) { this.ed.ctx.toast('Select the tiles to copy first (Shift-click adds tiles; "Fill the box" selects the rectangle around them).', true); return; }
    const x0 = Math.min(...sel.map((t) => t.x)), y0 = Math.min(...sel.map((t) => t.y));
    const tiles = sel.map((t) => ({ dx: t.x - x0, dy: t.y - y0, x: t.x, y: t.y, h: t.height, object: t.object }))
      .sort((a, b) => a.dy - b.dy || a.dx - b.dx);
    const w = Math.max(...tiles.map((t) => t.dx)) + 1, d = Math.max(...tiles.map((t) => t.dy)) + 1;
    const place = this.ed.ctx.catalog.placeLabel?.(map.id);
    this.stamps.unshift({ name: `${place || map.id} ${w}×${d} at ${x0}, ${y0}`, map: map.id, w, d, tiles });
    this.picked = 0;
    this.store();
    this.ed.ctx.setStatus(`Stamp copied: ${tiles.length} tile${tiles.length > 1 ? 's' : ''} of ${map.id}. Open the map to build on and click a tile to place it.`);
    this.ed.renderSide();
  }

  /** Select every tile of the rectangle around the selection. */
  fillBox() {
    const sel = this.ed.selectedTiles;
    if (!sel.length) return;
    const x0 = Math.min(...sel.map((t) => t.x)), x1 = Math.max(...sel.map((t) => t.x));
    const y0 = Math.min(...sel.map((t) => t.y)), y1 = Math.max(...sel.map((t) => t.y));
    this.ed.selectWhere((t) => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1);
  }

  /** A click on the map while a stamp is picked. True when handled. */
  clicked(tile, mods) {
    if (this.ed.tab !== 'stamp' || this.picked < 0 || !tile || mods.shift || mods.ctrl) return false;
    if (this.ed.ctx.readOnly()) { this.ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return true; }
    this.place(this.stamps[this.picked], tile).catch((err) => { console.error(err); this.ed.ctx.toast(err.message, true); });
    return true;
  }

  /** Put a copy of `stamp` on the open map with its top-left corner on `anchor`. */
  async place(stamp, anchor) {
    const ed = this.ed, map = ed.map;
    const own = stamp.map === map.id;
    let src;
    try { src = own ? map : await ed.sourceMap(stamp.map); } catch (err) { ed.ctx.toast(`Can't open ${stamp.map}: ${err.message}`, true); return; }
    if (ed.map !== map) return;
    const pairs = [];
    let clipped = 0;
    for (const s of stamp.tiles) {
      const from = src.tileAt(s.x, s.y), to = map.tileAt(anchor.x + s.dx, anchor.y + s.dy);
      if (from && to) pairs.push({ s, from, to }); else clipped++;
    }
    if (!pairs.length) { ed.ctx.toast('No tile of the stamp lands on the map there.', true); return; }
    if (!own) { // room in this map's atlas for every tile look of the stamp (an upper bound)
      const seen = new Set();
      let need = 0;
      for (const { from } of pairs) {
        if (seen.has(from.index)) continue;
        seen.add(from.index);
        try { need += lookCost(map, src, from.index); } catch { /* no top to copy: that tile keeps its own look */ }
      }
      const free = freeRoom(map).size;
      if (need > free) { ed.ctx.toast(`This stamp needs about ${need} atlas cells and this map has ${free} free. Try a smaller stamp, or one from this map.`, true); return; }
    }
    const low = Math.min(...stamp.tiles.map((t) => t.h));
    const base = anchor.height;
    let noPicture = 0, noTerrain = 0, noLook = 0;
    for (const { s, from, to } of pairs) {
      // a source tile with no surface of its own has no look to copy
      let look = null;
      if (own) look = from.index === to.index ? null : from.index;
      else try { look = importLook(map, src, from.index); } catch { noLook++; }
      if (look !== null) map.setLook(to.index, look);
      // object: bring its picture along when this map has none for the type
      let object = s.object ?? null;
      if (object !== null && !map.spriteTypes.includes(object)) {
        const data = map.spriteTypes.length < MAX_OBJECT_PICTURES ? src.dat.pakd.entries.slice(1).find((e) => e.id === object)?.data : null;
        if (data) { map.addSprite(object, data); ed.view?.addObjectTexture(object, spriteTexture(map, object)); } else { object = null; noPicture++; }
      }
      map.set(to.index, 'object', object);
      // terrain: the source's own code on the same map, else this map's code for the same kind
      const kind = src.materials[from.surface]?.kind;
      const code = own ? map.materials[from.surface]
        : map.materials.find((m) => m.kind === kind && m.object === object && m.used) ?? map.materials.find((m) => m.kind === kind && m.used);
      if (code) map.set(to.index, 'surface', ed.codeFor(code.code, object)); else noTerrain++;
      map.set(to.index, 'height', Math.max(0, Math.min(MAX_HEIGHT, base + s.h - low)));
    }
    this.last = { map: map.id, tiles: pairs.map((p) => p.to.index) };
    ed.selected = new Set(this.last.tiles);
    ed.files.set(map.id, map);
    if (!own) ed.refreshAtlas();
    ed.showModel();
    ed.view?.refreshObjects();
    ed.ctx.onChange();
    ed.renderList();
    ed.refresh();
    const notes = [noLook && `${noLook} tile${noLook > 1 ? 's have' : ' has'} no surface to copy and kept the look already there`,
      clipped && `${clipped} tile${clipped > 1 ? 's' : ''} fell off the map`,
      noPicture && `${noPicture} object${noPicture > 1 ? 's' : ''} left out (no room for more object pictures)`,
      noTerrain && `${noTerrain} tile${noTerrain > 1 ? 's keep' : ' keeps'} their own terrain type (this map has no code for the stamp's)`].filter(Boolean);
    ed.ctx.setStatus(`Stamp placed at ${anchor.x}, ${anchor.y}: ${pairs.length} tiles${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
  }

  render(box) {
    const ed = this.ed, map = ed.map;
    if (!map) { box.innerHTML = '<p class="muted pad">Choose a map.</p>'; return; }
    const n = ed.selected.size;
    const canRevert = this.last && this.last.map === map.id;
    box.innerHTML = `
      <div class="mp-pal-head">
        <p class="hint">A stamp is a copy of some tiles: their heights, looks, terrain and objects. Make one from any map, then open the map you're building and click where it should go.</p>
        <div class="mp-mode-actions">
          <button class="st-box" ${n > 1 ? '' : 'disabled'} title="Select every tile of the rectangle around the selected tiles">Fill the box</button>
          <button class="st-copy" ${n ? '' : 'disabled'}>Copy ${n || 'the'} selected tile${n === 1 ? '' : 's'} as a stamp</button>
        </div>
        <div class="mp-mode-actions">
          <button class="st-stop ghost" ${this.picked >= 0 ? '' : 'disabled'}>Stop placing</button>
          <button class="st-revert ghost" ${canRevert ? '' : 'disabled'} title="Puts the tiles of the last stamp back as the map was made">Revert the last stamp's tiles</button>
        </div>
        <p class="hint">${this.picked >= 0 ? 'Stamp picked: click a tile on the map and its top-left corner goes there, built up from that tile\'s height. Shift- or Ctrl-click still selects.' : this.stamps.length ? 'Click a stamp below to pick it.' : 'No stamps yet: select some tiles and copy them.'}</p>
      </div>
      <div class="st-list"></div>`;
    box.querySelector('.st-box').onclick = () => this.fillBox();
    box.querySelector('.st-copy').onclick = () => this.capture();
    box.querySelector('.st-stop').onclick = () => { this.picked = -1; this.render(box); };
    box.querySelector('.st-revert').onclick = () => { const tiles = this.last.tiles; this.last = null; ed.revert(tiles); };
    const list = box.querySelector('.st-list');
    this.stamps.forEach((s, i) => {
      const objects = s.tiles.filter((t) => t.object !== null && t.object !== undefined).length;
      const hs = s.tiles.map((t) => t.h), rise = Math.max(...hs) - Math.min(...hs);
      const row = document.createElement('div');
      row.className = `st-item${i === this.picked ? ' on' : ''}`;
      row.innerHTML = `<button class="st-pick"><b>${esc(s.name)}</b><small>${esc(s.map)}${s.map === map.id ? ' (this map)' : ''} · ${s.tiles.length} tile${s.tiles.length > 1 ? 's' : ''} · ${s.w}×${s.d} · ${rise} step${rise === 1 ? '' : 's'} tall${objects ? ` · ${objects} object${objects > 1 ? 's' : ''}` : ''}</small></button><button class="st-name ghost" title="Rename">✎</button><button class="st-del ghost" title="Delete this stamp">×</button>`;
      row.querySelector('.st-pick').onclick = () => { this.picked = i; this.render(box); };
      row.querySelector('.st-name').onclick = () => { const name = prompt('Stamp name', s.name); if (name?.trim()) { s.name = name.trim(); this.store(); this.render(box); } };
      row.querySelector('.st-del').onclick = () => { this.stamps.splice(i, 1); this.picked = this.picked === i ? -1 : this.picked > i ? this.picked - 1 : this.picked; this.store(); this.render(box); };
      list.append(row);
    });
  }
}

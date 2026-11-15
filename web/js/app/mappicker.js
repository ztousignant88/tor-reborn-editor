// Maps mode: right-click a tile for a visual picker of looks. A floating,
// scrollable grid of block pictures (the same pictures as the Blocks tab); a
// click gives that look to the selected tiles (heights stay). The looks of the
// right-clicked tile's own terrain come first; the list at the top filters by
// terrain, and "From" switches to the map chosen in the Blocks tab.

import { freeRoom, lookCost, tileTops } from '../game/lookimport.js';
import { drawBlock } from '../ui/blockthumb.js';
import { groundLook } from '../game/lookimport.js';
import { sideThumb } from '../ui/sidethumb.js';

const FACE_NAMES = { N: 'north', E: 'east', S: 'south', W: 'west' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class MapPicker {
  constructor(editor) {
    this.ed = editor;
    this.el = null;
    this.filter = 'near'; // 'near' = this tile's terrain first, 'all', or a terrain kind number
    this.onDown = (e) => { if (this.el && !this.el.contains(e.target)) this.close(); };
    this.onKey = (e) => { if (e.key === 'Escape') this.close(); };
  }

  close() {
    this.el?.remove();
    this.el = null;
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
  }

  /** Open at the mouse for `tile` (which joins or becomes the selection). */
  async open(tile, at, side = null) {
    const ed = this.ed;
    this.close();
    if (!tile || !ed.map) return;
    if (ed.ctx.readOnly()) { ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
    if (!ed.selected.has(tile.index)) { ed.selected = new Set([tile.index]); ed.refresh(); }
    const el = document.createElement('div');
    el.className = 'mp-picker';
    el.innerHTML = '<p class="muted pad">Reading looks…</p>';
    document.body.append(el);
    this.el = el;
    this.tile = tile;
    this.side = side; // { tile, face }: the right-click was on a wall face
    this.at = at;
    this.place(at);
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('keydown', this.onKey, true);
    try { await this.fill(); } catch (err) { console.error(err); el.innerHTML = `<p class="muted pad">${esc(err.message)}</p>`; }
    this.place(at);
  }

  place(at) {
    const el = this.el;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, at.x + 6))}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, at.y + 6))}px`;
  }

  /** Side mode: pictures of this map's wall pieces; a click puts that wall art on the selected tiles' sides. */
  fillSides() {
    const ed = this.ed, map = ed.map, el = this.el, tile = this.tile, face = this.side.face;
    this.sideScope ??= 'piece';
    const depth = this.side.depth ?? 0, steps = this.side.steps ?? 1;
    const where = steps <= 1 ? 'only' : depth === 0 ? 'top' : depth === steps - 1 ? 'bottom' : `${depth + 1} of ${steps} from the top`;
    // every different wall piece of this map: one height step of one tile's wall, by its art
    const samples = new Map(); // art key -> { index, depth, quad, count, kind, exact, role }
    for (const t of map.tiles) {
      const templates = groundLook(map, t.index).templates;
      const last = templates.length - 1;
      templates.forEach((byFace, d) => {
        if (!byFace || !Object.keys(byFace).length) return;
        if (this.sideScope !== 'piece' && d !== templates.findIndex((b) => b && Object.keys(b).length)) return; // whole faces: one sample per tile
        const quad = byFace[face] ?? Object.values(byFace)[0];
        const key = quad.tris.map((tri) => tri.map((v) => v.uv.map((u) => u.toFixed(4)).join(',')).join(';')).join('|');
        const s = samples.get(key);
        if (s) s.count++; else samples.set(key, { index: t.index, depth: d, quad, count: 1, kind: map.materials[map.originalTile(t.index).surface]?.kind, exact: !!byFace[face], role: d === 0 ? 'top' : d === last ? 'bottom' : 'middle' });
      });
    }
    const wantRole = depth === 0 ? 'top' : depth === steps - 1 ? 'bottom' : 'middle';
    const myKind = map.materials[tile.surface]?.kind;
    const list = [...samples.values()].sort((a, b) => (b.exact - a.exact) || ((b.kind === myKind) - (a.kind === myKind)) || ((b.role === wantRole) - (a.role === wantRole)) || b.count - a.count);
    const n = ed.selected.size;
    el.innerHTML = `
      <div class="mp-picker-head">
        <b>${this.sideScope === 'piece' ? `Side piece: ${FACE_NAMES[face]} face, ${where}` : `Side for ${n} tile${n > 1 ? 's' : ''}: ${FACE_NAMES[face]} face`}</b>
        <select class="pk-scope" title="Which sides of the selected tiles change">
          <option value="piece" ${this.sideScope === 'piece' ? 'selected' : ''}>This piece only</option>
          <option value="face" ${this.sideScope === 'face' ? 'selected' : ''}>This whole face</option>
          <option value="all" ${this.sideScope === 'all' ? 'selected' : ''}>All four faces</option>
        </select>
        <button class="pk-tops ghost" title="Pick a look for the top instead">Top looks</button>
        <button class="pk-reset ghost" title="Back to automatic side matching">Reset sides</button>
        <button class="pk-close ghost" title="Close (Esc)">×</button>
      </div>
      <div class="mp-picker-grid"></div>
      <p class="hint">${this.sideScope === 'piece' ? 'Click a wall picture: only the piece you right-clicked takes it. Every other piece of the wall stays.' : `Click a wall picture: the selected tiles' ${this.sideScope === 'face' ? `${FACE_NAMES[face]} side takes` : 'sides take'} that tile's wall art, top to bottom.`} Heights and tops stay.</p>`;
    el.querySelector('.pk-scope').onchange = (e) => { this.sideScope = e.target.value; this.fillSides(); };
    el.querySelector('.pk-close').onclick = () => this.close();
    el.querySelector('.pk-tops').onclick = () => { this.side = null; this.fill().then(() => this.place(this.at)); };
    const apply = (sample) => {
      const before = new Map(map.wallLooks);
      if (sample === null) for (const i of ed.selected) map.wallLooks.delete(i);
      else if (this.sideScope === 'piece') map.wallLooks.set(tile.index, { ...map.wallLooks.get(tile.index), [`${face}:d${depth}`]: { tile: sample.index, depth: sample.depth } });
      else for (const i of ed.selected) map.wallLooks.set(i, { ...map.wallLooks.get(i), [`${this.sideScope === 'face' ? face : 'all'}:all`]: sample.index });
      try { if (map.rebuilt().model.verts.length / 36 > 65535) throw new Error('These side edits exceed the map geometry limit.'); }
      catch (err) { map.wallLooks = before; ed.ctx.toast(err.message, true); return; }
      if (map.dirty) ed.files.set(map.id, map); else ed.files.delete(map.id);
      ed.showModel(); ed.ctx.onChange(); ed.renderList(); ed.refresh();
      if (ed.tab !== 'tile') ed.renderSide();
      this.close();
    };
    el.querySelector('.pk-reset').onclick = () => apply(null);
    const grid = el.querySelector('.mp-picker-grid');
    const mine = map.wallLooks.get(tile.index), minePiece = mine?.[`${face}:d${depth}`];
    const isCurrent = (s) => (this.sideScope === 'piece' ? minePiece?.tile === s.index && minePiece?.depth === s.depth : (mine?.[`${face}:all`] ?? mine?.['all:all']) === s.index);
    for (const s of list) {
      const t = map.tiles[s.index];
      const btn = document.createElement('button');
      btn.className = `mp-block${isCurrent(s) ? ' armed' : ''}`;
      btn.title = `Wall art of tile ${t.x}, ${t.y} (${ed.kindName(s.kind)}), on ${s.count} tile${s.count > 1 ? 's' : ''}${s.exact ? '' : ` - no ${FACE_NAMES[face]}-facing piece: its nearest facing is shown and used`}`;
      try { btn.append(sideThumb(map, s.quad)); } catch { btn.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: '?' })); }
      btn.insertAdjacentHTML('beforeend', `<span class="mp-cap">${esc(ed.kindName(s.kind))}</span><span class="mp-sub">${t.x}, ${t.y} ${s.role} · ×${s.count}${s.exact ? '' : ' · other facing'}</span>`);
      btn.onclick = () => apply(s);
      grid.append(btn);
    }
    if (!list.length) grid.innerHTML = '<p class="muted pad">This map has no wall pieces to show.</p>';
  }

  async fill() {
    if (this.side) { this.fillSides(); return; }
    const ed = this.ed, map = ed.map, el = this.el, tile = this.tile;
    const otherId = ed.palette.source && ed.palette.source !== map.id ? ed.palette.source : '';
    const foreign = this.from === 'other' && otherId;
    const src = foreign ? await ed.sourceMap(otherId) : map;
    if (this.el !== el) return;
    const tops = tileTops(src);
    const groups = new Map();
    tops.forEach((top, i) => {
      if (!top.key) return;
      const g = groups.get(top.key);
      if (g) g.count++; else groups.set(top.key, { index: i, count: 1, tris: top.tris, kind: src.materials[src.tiles[i].surface]?.kind });
    });
    const myKind = map.materials[tile.surface]?.kind;
    const kinds = [...new Set([...groups.values()].map((g) => g.kind))].filter((k) => k !== undefined).sort((a, b) => a - b);
    let blocks = [...groups.values()];
    if (this.filter !== 'near' && this.filter !== 'all') blocks = blocks.filter((b) => b.kind === Number(this.filter));
    blocks.sort((a, b) => (this.filter === 'near' ? (b.kind === myKind) - (a.kind === myKind) : 0) || b.count - a.count || a.index - b.index);
    const free = foreign ? freeRoom(map).size : 0;
    const n = ed.selected.size;
    el.innerHTML = `
      <div class="mp-picker-head">
        <b>Look for ${n} tile${n > 1 ? 's' : ''}</b>
        <select class="pk-filter" title="Which looks to show">
          <option value="near" ${this.filter === 'near' ? 'selected' : ''}>${esc(ed.kindName(myKind))} first</option>
          <option value="all" ${this.filter === 'all' ? 'selected' : ''}>All, most used first</option>
          ${kinds.map((k) => `<option value="${k}" ${String(this.filter) === String(k) ? 'selected' : ''}>Only ${esc(ed.kindName(k))}</option>`).join('')}
        </select>
        ${otherId ? `<select class="pk-from" title="Which map's looks"><option value="own">${esc(map.id)}</option><option value="other" ${foreign ? 'selected' : ''}>${esc(otherId)}</option></select>` : ''}
        <button class="pk-own ghost" title="Give the tiles their own look back">Own look</button>
        <button class="pk-close ghost" title="Close (Esc)">×</button>
      </div>
      <div class="mp-picker-grid"></div>
      <p class="hint">Click a picture: the selected tiles take that look, heights stay.${otherId ? '' : ' Pick a map under Blocks → Blocks from to choose from its looks here too.'}</p>`;
    el.querySelector('.pk-filter').onchange = (e) => { this.filter = e.target.value; this.fill(); };
    const from = el.querySelector('.pk-from');
    if (from) from.onchange = (e) => { this.from = e.target.value; this.fill(); };
    el.querySelector('.pk-close').onclick = () => this.close();
    el.querySelector('.pk-own').onclick = async () => { await ed.setLook(''); this.close(); };
    const grid = el.querySelector('.mp-picker-grid');
    const current = map.looks.get(tile.index);
    for (const b of blocks) {
      const t = src.tiles[b.index];
      let cost = 0, problem = null;
      if (foreign) { try { cost = lookCost(map, src, b.index); } catch (err) { problem = err.message; } }
      const full = foreign && (problem || cost > free);
      const btn = document.createElement('button');
      const isCurrent = !foreign && (current === b.index || (current === undefined && tops[tile.index]?.key === tops[b.index].key));
      btn.className = `mp-block${full ? ' full' : ''}${isCurrent ? ' armed' : ''}`;
      btn.title = `${src.id} tile ${t.x}, ${t.y}: ${ed.kindName(b.kind)}, used on ${b.count} tile${b.count > 1 ? 's' : ''}${foreign ? `\n${problem ?? (cost ? `Copying it in takes ${cost} of ${free} free atlas cells` : 'Already copied in')}` : ''}`;
      try { btn.append(drawBlock(src, b.tris)); } catch { btn.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: '?' })); }
      btn.insertAdjacentHTML('beforeend', `<span class="mp-cap">${esc(ed.kindName(b.kind))}</span><span class="mp-sub">${t.x}, ${t.y} · ×${b.count}</span>`);
      btn.onclick = async () => {
        if (full) { ed.ctx.toast(problem ?? 'Not enough room in this map\'s atlas for that look.', true); return; }
        await ed.setLook(foreign ? `${src.id} ${t.x}, ${t.y}` : `${t.x}, ${t.y}`);
        if (ed.tab !== 'tile') ed.renderSide();
        this.close();
      };
      grid.append(btn);
    }
    if (!blocks.length) grid.innerHTML = '<p class="muted pad">No looks to show.</p>';
  }
}

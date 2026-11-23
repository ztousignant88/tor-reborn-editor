// Maps mode (stage 2): pick any map, select tiles on the 3D view and change
// their height, terrain code and destructible object. Tile data is edited in
// place, and when heights change the map's 3D model is rebuilt to match:
// tops move, walls are rebuilt with the map's own wall textures (see
// game/meshedit.js). The view shows the rebuilt model as you edit: a new
// terrain also gives the tile the look of the nearest tile the map was made
// with that terrain (unless turned off), and objects follow height changes.
// The Blocks and Objects tabs (mappalette.js) hold tile looks and objects to
// drag onto tiles.

import { atlases, importLook, releaseUnusedLooks } from '../game/lookimport.js';
import { MAX_HEIGHT, MapFile } from '../game/mapfile.js';
import { loadMapTable } from '../game/maptable.js';
import { MapView3D } from '../ui/mapview3d.js';
import { SceneView } from '../ui/scene3d.js';
import { textureCanvas } from '../ui/texcanvas.js';
import { MAX_OBJECT_PICTURES, MapPalette, spriteTexture } from './mappalette.js';
import { saveDataFiles } from './savefiles.js';
import { attachHelp } from './fieldhelp.js';
import { MapBrush } from './mapbrush.js';
import { MapSides } from './mapsides.js';
import { MapStamp } from './mapstamp.js';
import { MapLibrary } from './maplibrary.js';
import { MapPicker } from './mappicker.js';
import { MapBackdrops } from './mapbackdrops.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class MapEditor {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // { catalog, tables(), toast, setStatus, onChange, readOnly() }
    this.files = new Map(); // id -> MapFile (kept while edited)
    this.map = null;
    this.selected = new Set();
    this.filter = '';
    this.built = false;
    this.tab = 'tile'; // right panel: tile, blocks or objects
    this.palette = new MapPalette(this);
    this.brush = new MapBrush(this);
    this.sides = new MapSides(this);
    this.stamp = new MapStamp(this);
    this.library = new MapLibrary(this);
    this.picker = new MapPicker(this);
    this.backdrops = new MapBackdrops(this);
    this.lookWithTerrain = true; // a new terrain brings that terrain's look
    this.sourceMaps = new Map(); // other maps' files, read for their looks and objects
  }

  /** Another map's file (kept), for copying looks and objects from. */
  async sourceMap(id) {
    if (!this.sourceMaps.has(id)) this.sourceMaps.set(id, await MapFile.load(id));
    return this.sourceMaps.get(id);
  }

  async open() {
    if (!this.built) this.build();
    this.names = await loadMapTable(); // number -> [{id, name}]
    this.byId = new Map();
    for (const [number, list] of this.names) for (const e of list) {
      const info = this.byId.get(e.id) ?? { numbers: [], name: e.name };
      info.numbers.push(number);
      this.byId.set(e.id, info);
    }
    this.renderList();
    if (!this.map && this.ctx.catalog.maps.length) await this.openMap(this.ctx.catalog.maps[0].id);
  }

  build() {
    this.built = true;
    this.root.innerHTML = `
      <aside class="sidebar">
        <div class="sidebar-head">
          <h2>Maps <span id="mp-count" class="count"></span></h2>
          <input id="mp-search" type="search" placeholder="Filter by file, place or map number…">
        </div>
        <div id="mp-list" class="battle-list"></div>
      </aside>
      <section class="stage">
        <div class="stage-head">
          <div class="stage-title"><h1 id="mp-title">Choose a map</h1><span id="mp-meta" class="meta"></span></div>
          <div class="map-controls">
            <button id="mp-rot-l" title="Rotate (Q)">⟲</button><button id="mp-rot-r" title="Rotate (E)">⟳</button>
            <button id="mp-fit" title="Fit map to view">Fit</button>
          </div>
        </div>
        <div class="map-wrap">
          <div class="map3d"><canvas id="mp-gl"></canvas><canvas id="mp-overlay"></canvas></div>
          <div id="mp-hover" class="hover-info">Click a tile to select it · Shift/Ctrl-click to add · drag to orbit · right-drag to pan · right-click for looks</div>
        </div>
      </section>
      <aside class="inspector mp-side">
        <div class="tabs mp-tabs" role="tablist">
          <button data-tab="tile" class="on" role="tab">Tile</button><button data-tab="blocks" role="tab">Blocks</button><button data-tab="objects" role="tab">Objects</button><button data-tab="brush" role="tab">Brush</button><button data-tab="sides" role="tab">Sides</button><button data-tab="stamp" role="tab">Stamp</button><button data-tab="library" role="tab">Library</button><button data-tab="backdrop" role="tab">Backdrop</button>
        </div>
        <div id="mp-inspector" class="mp-pane"></div>
        <div id="mp-palette" class="mp-pane mp-palette" hidden></div>
      </aside>`;
    const $ = (s) => this.root.querySelector(s);
    for (const b of this.root.querySelectorAll('.mp-tabs [data-tab]')) b.onclick = () => { this.tab = b.dataset.tab; this.renderSide(); };
    if (!SceneView.isSupported()) { $('.map-wrap').innerHTML = '<p class="muted pad">This browser has no WebGL2 with BC7 textures, which the map view needs.</p>'; return; }
    this.view = new MapView3D($('#mp-gl'), $('#mp-overlay'), {
      onSelectTile: (tile, mods) => this.clickTile(tile, mods),
      paintActive:()=>this.brush.active,
      onPaintStart:tile=>this.brush.begin(tile),
      onPaintMove:tile=>this.brush.move(tile),
      onPaintEnd:()=>this.brush.end(),
      onHover: (h) => this.renderHover(h),
      hoverEdges: () => true,
      onContextTile: (tile, at, side) => { this.picker.open(tile, at, side); },
      onDropTile: (tile, dataTransfer) => {
        if (this.ctx.readOnly()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
        this.palette.dropped(tile, dataTransfer).catch((err) => this.ctx.toast(err.message, true));
      },
    });
    $('#mp-search').oninput = (e) => { this.filter = e.target.value; this.renderList(); };
    $('#mp-fit').onclick = () => this.view.fitView();
    $('#mp-rot-l').onclick = () => { this.view.rotate(-1); this.view.render(); };
    $('#mp-rot-r').onclick = () => { this.view.rotate(1); this.view.render(); };
  }

  info(id) { return this.byId?.get(id) ?? { numbers: [], name: '' }; }

  renderList() {
    const list = this.root.querySelector('#mp-list');
    const q = this.filter.trim().toLowerCase();
    const maps = this.ctx.catalog.maps.filter((m) => {
      if (!q) return true;
      const i = this.info(m.id);
      return m.id.toLowerCase().includes(q) || i.name.includes(this.filter.trim()) || i.numbers.some((n) => String(n) === q)
        || this.ctx.catalog.mapLabel(m).toLowerCase().includes(q);
    });
    list.innerHTML = '';
    let group = null;
    for (const m of maps) {
      const g = m.id.slice(0, 5);
      if (g !== group) {
        group = g;
        const head = document.createElement('div');
        head.className = 'list-group';
        head.textContent = `${g}${this.ctx.catalog.placeLabel(m.id) ? ` · ${this.ctx.catalog.placeLabel(m.id)}` : ''}`;
        list.append(head);
      }
      const i = this.info(m.id);
      const b = document.createElement('button');
      b.className = `battle${this.map?.id === m.id ? ' active' : ''}`;
      const edited = this.files.get(m.id)?.dirty || this.backdrops.changes.has(m.id.toLowerCase());
      const place = this.ctx.catalog.placeLabel(m.id);
      const encounter = this.ctx.catalog.encounterForMap(m.id);
      const used = this.ctx.catalog.mapLinks(m.id);
      const uses = [used.battles.length && `${used.battles.length} battle${used.battles.length > 1 ? 's' : ''}`, used.scenes.length && `${used.scenes.length} cutscene${used.scenes.length > 1 ? 's' : ''}`].filter(Boolean).join(', ');
      b.title = [used.battles.length && `Battles: ${used.battles.join(', ')}`, used.scenes.length && `Cutscenes: ${used.scenes.join(', ')}`].filter(Boolean).join('\n');
      b.innerHTML = `<span class="battle-title">${esc(encounter?.title ?? m.id)}${edited ? ' <span class="dirty">●</span>' : ''}</span>
        ${place ? `<span class="battle-sub">${esc(encounter ? m.id : place)}</span>` : ''}
        <span class="battle-sub">${m.width}×${m.depth}${i.numbers.length ? ` · map ${i.numbers.join(', ')}` : ''}${/_99_/.test(m.id) ? ' · cutscene' : ''}${uses ? ` · ${uses}` : ''}</span>`;
      b.onclick = () => this.openMap(m.id);
      list.append(b);
    }
    this.root.querySelector('#mp-count').textContent = String(this.ctx.catalog.maps.length);
  }

  async openMap(id) {
    this.brush.end();
    this.ctx.setStatus(`Loading ${id}…`);
    try {
      const file = this.files.get(id) ?? await MapFile.load(id);
      const scene = await this.ctx.catalog.scene(id);
      this.map = file;
      this.selected = new Set();
      this.view?.setScene(scene, file.grid());
      for (const [type] of file.addedSprites) this.view?.addObjectTexture(type, spriteTexture(file, type));
      if (file.addedSprites.size) this.view?.refreshObjects();
      if (file.modelChanged) this.showModel();
      this.view?.fitView();
      this.renderHeader();
      this.renderList();
      this.refresh();
      if (this.tab !== 'tile') this.renderSide();
      this.ctx.setStatus(`${id}: ${file.width}×${file.depth}, ${file.tiles.length} tiles`);
    } catch (err) {
      console.error(err);
      this.ctx.setStatus(`${id}: ${err.message}`, true);
    }
  }

  renderHeader() {
    const i = this.info(this.map.id);
    const encounter = this.ctx.catalog.encounterForMap(this.map.id);
    this.root.querySelector('#mp-title').textContent = encounter?.title ?? this.map.id;
    const place = encounter ? this.map.id : this.ctx.catalog.placeLabel(this.map.id);
    this.root.querySelector('#mp-meta').textContent = `${place ? `${place} · ` : ''}${this.map.width}×${this.map.depth}${i.numbers.length ? ` · map number ${i.numbers.join(', ')}` : ''}`;
  }

  renderHover(h) {
    const el = this.root.querySelector('#mp-hover');
    const t = h?.tile;
    if (!t) { el.textContent = 'Click a tile to select it · Shift/Ctrl-click to add · drag to orbit · right-drag to pan · right-click for looks'; return; }
    const o = this.map.originalTile(t.index);
    el.textContent = `Tile ${t.x}, ${t.y} · height ${t.height}${o.height !== t.height ? ` (was ${o.height})` : ''} · ${this.kindName(this.map.materials[t.surface]?.kind)} (terrain ${t.surface})${t.object !== null ? ` · object ${t.object}` : ''}`;
  }

  // ---- selection --------------------------------------------------------
  clickTile(tile, mods = {}) {
    if (this.palette.clicked(tile, mods) || this.stamp.clicked(tile, mods)) return;
    if (!tile) { if (!mods.shift && !mods.ctrl) this.selected.clear(); this.refresh(); return; }
    if (mods.shift || mods.ctrl) {
      if (this.selected.has(tile.index)) this.selected.delete(tile.index); else this.selected.add(tile.index);
    } else {
      this.selected = new Set([tile.index]);
    }
    this.refresh();
  }

  selectWhere(pred) {
    this.selected = new Set(this.map.tiles.filter(pred).map((t) => t.index));
    this.refresh();
  }

  get selectedTiles() { return [...this.selected].map((i) => this.map.tiles[i]); }

  // ---- editing ----------------------------------------------------------
  /** Name of a terrain kind, from the game's tile-info panel text. */
  kindName(kind) {
    return this.ctx.tables?.()?.text(`PANELTEXT_LC_PANEL_${String(kind).padStart(2, '0')}_NAME`) || `kind ${kind}`;
  }

  /** The terrain code with the same kind as `code` and the given object (the map's own pairing), if any. */
  codeFor(code, object) {
    const kind = this.map.materials[code]?.kind;
    const match = this.map.materials.find((m) => m.kind === kind && m.object === object && (m.used || m.code === code));
    return match ? match.code : code;
  }

  edit(field, valueFor) {
    if (this.ctx.readOnly()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
    let changed = 0, looks = 0, noLook = null;
    for (const t of this.selectedTiles) {
      const value = valueFor(t);
      if (this.map.set(t.index, field, value)) {
        changed++;
        // a new terrain shows on the map: the tile looks like the nearest tile made with it
        if (field === 'surface' && this.lookWithTerrain) {
          const like = this.madeWith(value, t);
          if (like) { this.map.setLook(t.index, like.index); looks++; } else noLook = value;
        }
      }
      // objects come with a terrain code of their own (e.g. road + crate): follow the map's pairing
      if (field === 'object' && this.map.set(t.index, 'surface', this.codeFor(t.surface, value))) changed++;
    }
    if (!changed) return;
    if (field === 'height' || looks) this.showModel();
    if (noLook !== null) this.ctx.toast(`No tile of this map was made with terrain ${noLook}, so the look stays (the terrain still changed).`);
    this.files.set(this.map.id, this.map);
    this.view?.refreshObjects(); // objects stand on the tiles' new heights
    this.ctx.onChange();
    this.renderList();
    this.refresh();
  }

  /** The tile nearest `near` that the map was made with terrain `code`, or null. */
  madeWith(code, near) {
    let best = null, dist = Infinity;
    for (const t of this.map.tiles) {
      if (this.map.originalTile(t.index).surface !== code) continue;
      const d = Math.abs(t.x - near.x) + Math.abs(t.y - near.y);
      if (d < dist) { best = t; dist = d; }
    }
    return best;
  }

  /** The selected tiles get object `type` (null: none); one from another map brings its picture into this file. */
  async placeObject(type, fromId) {
    if (type !== null && !this.map.spriteTypes.includes(type) && fromId !== this.map.id) {
      if (this.map.spriteTypes.length >= MAX_OBJECT_PICTURES) {
        this.ctx.toast(`This map already has ${this.map.spriteTypes.length} object pictures, the most any game map has.`, true);
        return;
      }
      const from = await this.sourceMap(fromId);
      const data = from.dat.pakd.entries.slice(1).find((e) => e.id === type)?.data;
      if (!data) { this.ctx.toast(`${fromId} has no picture for object ${type}.`, true); return; }
      this.map.addSprite(type, data);
      this.view?.addObjectTexture(type, spriteTexture(this.map, type));
      this.ctx.setStatus(`Object ${type}'s picture copied from ${fromId} into ${this.map.id} (saved while a tile uses it)`);
    }
    this.edit('object', () => type);
  }

  /** How a look shows in the field and the changes list. */
  lookLabel(look) {
    if (look === undefined || look === null) return '';
    if (look.planned) return 'Planned terrain edges';
    if (look.foreign) return `${look.sourceId} ${look.x}, ${look.y}`;
    return `${look % this.map.width}, ${Math.floor(look / this.map.width)}`;
  }

  /** "map x, y": every selected tile takes the look of a tile on another map (lookimport.js). */
  async setForeignLook(id, x, y) {
    let source;
    try {
      source = await this.sourceMap(id);
    } catch (err) {
      this.ctx.toast(`Can't open map ${id}: ${err.message}`, true);
      return;
    }
    const st = source.tileAt(x, y);
    if (!st) { this.ctx.toast(`${id} has no tile ${x}, ${y} (it is ${source.width}×${source.depth}).`, true); return; }
    let look;
    try {
      look = importLook(this.map, source, st.index);
    } catch (err) {
      this.ctx.toast(err.message, true);
      return;
    }
    let kept = 0;
    for (const t of this.selectedTiles) {
      this.map.setLook(t.index, look);
      // the tile takes the source's kind of terrain where this map has a code for it
      const code = this.map.materials.find((m) => m.kind === look.kind && m.object === t.object && m.used)
        ?? this.map.materials.find((m) => m.kind === look.kind && m.used);
      if (code) this.map.set(t.index, 'surface', code.code); else kept++;
    }
    if (kept) this.ctx.toast(`This map has no ${this.kindName(look.kind)} terrain code, so those tiles keep their own terrain type.`);
    this.ctx.setStatus(`Look of ${id} ${x}, ${y}: ${look.cells} texture cell${look.cells === 1 ? '' : 's'} copied into this map's atlas`);
    this.refreshAtlas();
  }

  /** Show texture cells copied into the atlas in the 3D preview. */
  refreshAtlas() {
    const sv = this.view?.view;
    if (!sv?.scene) return;
    const { color } = atlases(this.map.scene);
    const i = sv.scene.textures.findIndex((t) => t.name === color.name);
    if (i < 0) return;
    sv.scene.textures[i] = color;
    sv.setTexture(sv.textureName);
  }

  /** "x, y", "map x, y" (or blank) -> every selected tile takes that tile's look. */
  async setLook(text) {
    if (this.ctx.readOnly()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
    const other = /^\s*(bg[0-9a-z_]+?)(?:\.dat)?\s+(\d+)\s*[, ]\s*(\d+)\s*$/i.exec(String(text));
    if (other && other[1].toLowerCase() !== this.map.id.toLowerCase()) {
      await this.setForeignLook(other[1], Number(other[2]), Number(other[3]));
    } else {
      this.setOwnLook(other ? `${other[2]}, ${other[3]}` : text);
      return;
    }
    this.files.set(this.map.id, this.map);
    if (!this.map.dirty) this.files.delete(this.map.id);
    this.showModel();
    this.ctx.onChange();
    this.renderList();
    this.refresh();
  }

  setOwnLook(text) {
    let source = null;
    if (String(text).trim()) {
      const m = /^\s*(\d+)\s*[, ]\s*(\d+)\s*$/.exec(text);
      const t = m && this.map.tileAt(Number(m[1]), Number(m[2]));
      if (!t) { this.ctx.toast('Type the source tile as "x, y", or "map x, y" for another map (e.g. bg206_01_c0_t00 3, 4).', true); return; }
      source = t.index;
    }
    for (const t of this.selectedTiles) {
      this.map.setLook(t.index, source);
      // the tile takes the source's terrain too (tile info, movement), keeping its own object pairing
      if (source !== null) this.map.set(t.index, 'surface', this.codeFor(this.map.tiles[source].surface, t.object));
    }
    this.files.set(this.map.id, this.map);
    if (!this.map.dirty) this.files.delete(this.map.id);
    this.showModel();
    this.ctx.onChange();
    this.renderList();
    this.refresh();
  }

  revert(indices) {
    for (const i of indices) this.map.revertTile(i);
    if (!this.map.dirty) this.files.delete(this.map.id);
    this.showModel();
    this.view?.refreshObjects();
    this.ctx.onChange();
    this.renderList();
    this.refresh();
  }

  refresh() {
    if (!this.map) return;
    const changed = new Map();
    for (const t of this.map.changedTiles) changed.set(t.index, { from: this.map.originalTile(t.index).height, to: t.height });
    this.view?.setMarks({ selected: this.selected, changed, columns: false });
    this.renderInspector();
    if(this.tab==='brush'||this.tab==='sides'||this.tab==='stamp')this.renderSide();
    this.palette.updateHint(this.root.querySelector('#mp-palette'));
  }

  /** Show the right panel's tab: the tile inspector, or the Blocks or Objects palette. */
  renderSide() {
    for (const b of this.root.querySelectorAll('.mp-tabs [data-tab]')) {
      b.classList.toggle('on', b.dataset.tab === this.tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
    }
    const pal = this.root.querySelector('#mp-palette');
    this.root.querySelector('#mp-inspector').hidden = this.tab !== 'tile';
    pal.hidden = this.tab === 'tile';
    if (this.tab === 'tile') this.renderInspector();
    else if(this.tab==='brush') this.brush.render(pal);
    else if(this.tab==='sides') this.sides.render(pal);
    else if(this.tab==='stamp') this.stamp.render(pal);
    else if(this.tab==='library') this.library.render(pal);
    else if(this.tab==='backdrop' && this.map) void this.backdrops.render(pal, this.map.id);
    else this.palette.render(pal, this.tab).catch((err) => { console.error(err); this.ctx.toast(err.message, true); });
  }

  /** Put the rebuilt model (or the original one) on the 3D view. */
  showModel() {
    if (!this.view || !this.map) return;
    if (releaseUnusedLooks(this.map)) this.refreshAtlas(); // copied looks no tile uses free their atlas cells
    try {
      this.view.setTerrain(this.map.previewMesh());
      const notes=[...new Set(this.map.rebuilt().notes)];
      if(notes.length)this.ctx.setStatus(`${this.map.id}: ${notes.length} geometry note(s). ${notes.slice(0,2).join('; ')}`,true);
      else this.ctx.setStatus(`${this.map.id}: ${this.map.changedTiles.length} edited tiles`);
    } catch (err) {
      console.error(err);
      this.ctx.toast(`Couldn't rebuild the model: ${err.message}`, true);
    }
  }

  renderInspector() {
    const box = this.root.querySelector('#mp-inspector');
    const map = this.map;
    const sel = this.selectedTiles;
    const same = (k) => (sel.length && sel.every((t) => t[k] === sel[0][k]) ? sel[0][k] : null);
    const surfaces = new Map();
    for (const t of map.tiles) surfaces.set(t.surface, (surfaces.get(t.surface) ?? 0) + 1);
    const objects = [...(this.view?.objectTextures?.keys() ?? [])].sort((a, b) => a - b);
    const height = same('height'), surface = same('surface'), object = sel.length ? (sel.every((t) => t.object === sel[0].object) ? sel[0].object : undefined) : undefined;
    const changed = map.changedTiles;
    box.innerHTML = `
      <div class="insp-head">
        <div class="insp-title">${sel.length ? `${sel.length} tile${sel.length > 1 ? 's' : ''} selected` : 'No tiles selected'}</div>
        <div class="insp-sub">${sel.length === 1 ? `Tile ${sel[0].x}, ${sel[0].y}` : 'Click tiles on the map; Shift or Ctrl adds more.'}</div>
        <div class="mp-tools">
          <button data-sel="all">All</button><button data-sel="none">None</button>
          <button data-sel="height" ${sel.length ? '' : 'disabled'}>Same height</button>
          <button data-sel="surface" ${sel.length ? '' : 'disabled'}>Same terrain</button>
        </div>
      </div>
      <div class="mp-fields ${sel.length ? '' : 'disabled'}">
        <label class="field"><span class="field-label">Height (0–${MAX_HEIGHT}; the game shows height + 1)</span>
          <div class="mp-height">
            <button data-step="-1" title="Lower (-)">−</button>
            <input id="mp-height" type="number" min="0" max="${MAX_HEIGHT}" value="${height ?? ''}" placeholder="${sel.length ? 'mixed' : ''}">
            <button data-step="1" title="Raise (+)">+</button>
          </div>
        </label>
        <label class="field"><span class="field-label">Terrain (code: kind, from this map's material table)</span>
          <select id="mp-surface">
            ${surface === null ? '<option value="" selected>mixed</option>' : ''}
            ${map.materials.filter((mt) => surfaces.has(mt.code) || mt.kind).map((mt) => `<option value="${mt.code}" ${mt.code === surface ? 'selected' : ''}>${mt.code}: ${esc(this.kindName(mt.kind))}${mt.object ? ` + object ${mt.object}` : ''} (${surfaces.get(mt.code) ?? 0} tiles)</option>`).join('')}
            <option value="other">Other code…</option>
          </select>
        </label>
        <label class="check" title="The tile takes the look of the nearest tile this map was made with that terrain (the Look field below shows which; × puts the tile's own look back)"><input type="checkbox" id="mp-terrain-look" ${this.lookWithTerrain ? 'checked' : ''}> A new terrain brings its look</label>
        <label class="field"><span class="field-label">Destructible object</span>
          <select id="mp-object">
            ${object === undefined ? '<option value="" selected>mixed</option>' : ''}
            <option value="none" ${object === null ? 'selected' : ''}>None</option>
            ${objects.map((o) => `<option value="${o}" ${o === object ? 'selected' : ''}>Object type ${o}</option>`).join('')}
          </select>
          <div class="mp-objpic"></div>
        </label>
        <label class="field"><span class="field-label">Look and terrain copied from tile</span>
          <div class="mp-height">
            <input id="mp-look" placeholder="x, y  or  map x, y" title="A tile of this map (x, y), or of another map: e.g. bg206_01_c0_t00 3, 4" value="${sel.length && sel.every((t) => map.looks.get(t.index) === map.looks.get(sel[0].index)) && map.looks.has(sel[0].index) ? this.lookLabel(map.looks.get(sel[0].index)) : ''}" style="grid-column: span 2">
            <button id="mp-look-clear" title="Use the tile's own look">×</button>
          </div>
        </label>
        <div class="mp-tools">
          <button id="mp-revert-sel" class="ghost" ${sel.some((t) => map.tileChanged(t.index)) ? '' : 'disabled'}>Revert selected</button>
          <button id="mp-revert-all" class="ghost" ${changed.length ? '' : 'disabled'}>Revert map</button>
        </div>
      </div>
      <div class="mp-changes">
        <b>${changed.length} edited tile${changed.length === 1 ? '' : 's'}</b>
        ${changed.length ? `<ul>${changed.slice(0, 60).map((t) => { const o = map.originalTile(t.index); const d = []; if (o.height !== t.height) d.push(`height ${o.height}→${t.height}`); if (o.surface !== t.surface) d.push(`terrain ${o.surface}→${t.surface}`); if (o.object !== t.object) d.push(`object ${o.object ?? 'none'}→${t.object ?? 'none'}`); if (map.looks.has(t.index)) d.push(`look of ${this.lookLabel(map.looks.get(t.index))}`); return `<li><button class="link" data-tile="${t.index}">${t.x}, ${t.y}</button> ${d.join(', ')}</li>`; }).join('')}</ul>` : ''}
      </div>
      ${map.modelChanged ? `<p class="muted pad">Model rebuilt: ${map.rebuilt().walls} new wall step${map.rebuilt().walls === 1 ? '' : 's'}.${map.rebuilt().notes.length ? ` ${esc(map.rebuilt().notes.join(' · '))}` : ''}</p>` : ''}
      <p class="muted pad">Height edits change both the tile data the game plays on (movement, jumping, height bonuses, line of sight) and the 3D model: tile tops and anything standing on them move, and walls are rebuilt with this map's own wall textures. Terrain edits change the tile data, and the look too while "A new terrain brings its look" is ticked. The Blocks and Objects tabs hold looks and objects to drag onto tiles.</p>`;
    const $ = (s) => box.querySelector(s);
    for (const b of box.querySelectorAll('[data-sel]')) {
      b.onclick = () => {
        const k = b.dataset.sel;
        if (k === 'all') this.selectWhere(() => true);
        else if (k === 'none') { this.selected.clear(); this.refresh(); }
        else { const set = new Set(sel.map((t) => t[k])); this.selectWhere((t) => set.has(t[k])); }
      };
    }
    for (const b of box.querySelectorAll('[data-step]')) b.onclick = () => this.edit('height', (t) => t.height + Number(b.dataset.step));
    const help = {
      '#mp-height': 'Raises or lowers the selected tiles and their rebuilt visible geometry. The game displays this height plus one. Height can affect movement, jumping and line of sight; the field is blank when selected tiles have different heights.',
      '#mp-surface': 'Chooses the selected tiles’ terrain/material code. Terrain affects how the game treats the surface. With A new terrain brings its look enabled, the editor also selects a matching visual appearance.',
      '#mp-object': 'Places or removes the selected destructible object type on these tiles. This changes the map object, not a battle unit; an object can affect whether a tile is occupied or blocked.',
      '#mp-look': 'Copies a tile’s look and associated terrain onto the selection. Enter x, y for this map, or a map ID followed by x, y for another map. This is separate from setting tile height.',
      '#mp-look-clear': 'Clears the copied-look override and returns to the tile’s own look. This is different from reverting all edits to the tile.',
      '#mp-terrain-look': 'When terrain changes, also copies the look of a nearby original tile with that terrain. Turn this off to change the gameplay terrain without automatically choosing its appearance.',
      '#mp-revert-sel': 'Restores the selected tiles to the loaded map baseline, including their edited height, terrain, object and copied-look state.',
      '#mp-revert-all': 'Restores all edited tiles in this map to the loaded baseline. The editor will ask before reverting the map.',
    };
    for (const [selector, text] of Object.entries(help)) {
      const control = $(selector);
      attachHelp(control, text);
      if (control?.closest('label')) attachHelp(control.closest('label'), text);
    }
    $('#mp-height').onchange = (e) => { if (e.target.value !== '') this.edit('height', () => Number(e.target.value)); };
    $('#mp-surface').onchange = (e) => {
      let v = e.target.value;
      if (v === 'other') { v = prompt('Terrain code (0–255):', String(surface ?? 0)); if (v === null) { this.renderInspector(); return; } }
      if (v !== '') this.edit('surface', () => Number(v));
    };
    $('#mp-terrain-look').onchange = (e) => { this.lookWithTerrain = e.target.checked; };
    $('#mp-object').onchange = (e) => { const v = e.target.value; if (v !== '') this.edit('object', () => (v === 'none' ? null : Number(v))); };
    $('#mp-look').onchange = (e) => this.setLook(e.target.value);
    $('#mp-look-clear').onclick = () => this.setLook('');
    $('#mp-revert-sel').onclick = () => this.revert(sel.map((t) => t.index));
    $('#mp-revert-all').onclick = () => { if (confirm(`Revert all ${changed.length} edited tiles on ${map.id}?`)) this.revert(changed.map((t) => t.index)); };
    for (const b of box.querySelectorAll('[data-tile]')) b.onclick = () => { this.selected = new Set([Number(b.dataset.tile)]); this.refresh(); };
    // object sprite preview
    if (typeof object === 'number') {
      const tex = this.ctx.catalog.sceneObjectSprite?.(map.id, object);
      Promise.resolve(tex ?? this.ctx.catalog.scene(map.id).then((s) => s.objectSprites.get(object))).then((t) => {
        if (t && this.map === map) $('.mp-objpic')?.append(textureCanvas(t, 0.5));
      }).catch(() => {});
    }
  }

  onKey(e) {
    const k = e.key;
    if (k === '+' || k === '=') { e.preventDefault(); this.edit('height', (t) => t.height + 1); }
    else if (k === '-' || k === '_') { e.preventDefault(); this.edit('height', (t) => t.height - 1); }
    else if (k === 'Escape') { this.selected.clear(); this.refresh(); }
    else if (k.toLowerCase() === 'q') { this.view?.rotate(-1); this.view?.render(); }
    else if (k.toLowerCase() === 'e') { this.view?.rotate(1); this.view?.render(); }
  }

  // ---- saving -----------------------------------------------------------
  dirtyFiles() { return [...this.files.values()].filter((f) => f.dirty); }

  async save() {
    const files = [];
    for (const f of this.dirtyFiles()) {
      this.ctx.setStatus(`Packing ${f.id}…`);
      files.push({ path: f.path, bytes: await f.encode(), originalSize: f.dat.originalSize, dat:f.dat });
    }
    const saved = await saveDataFiles(files);
    for (const f of this.dirtyFiles()) this.ctx.catalog.grids.delete(f.id); // battles and cutscenes see the new heights
    this.ctx.catalog.sceneCache = null;
    const current = this.map?.id;
    this.files.clear();
    this.sourceMaps.clear(); // saved maps are read again as they are now
    this.map = null;
    if (current) await this.openMap(current); // start again from what is on disk
    return saved;
  }
}

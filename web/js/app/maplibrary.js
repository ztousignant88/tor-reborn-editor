// Maps mode, Library tab: whole maps saved under their own names, apart from
// projects (editor/maps on the server), and placing one over a game map.
//
// Saving stores the open map as the editor would write it (unsaved edits
// included), so a saved map is a complete game map file.
// Placing takes a saved map and writes it over the open map's file through the
// normal save path (into the open project, or the game with a backup). Every
// game map names itself and its textures after its own file (survey of the bg
// folder: scene name = file id, textures bgNNN_00_cC_tTT, _01_, _a00_, ..._m),
// so those names are rewritten for the map it lands on. Ids are all the same
// length, so this is a same-size edit of the scene. Not tried in game yet.

import { decrypt } from '../lib/crypt.js';
import { unzipSingle } from '../lib/zip.js';
import { parsePakd, view } from '../lib/pakd.js';
import { encodeDat } from '../game/datfile.js';
import { source } from '../game/source.js';
import { saveDataFiles } from './savefiles.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ID = /^bg(\d{3})_(\d\d)_(c\d_t\d\d)$/;

/** The scene's own id (the name at 0x10). */
export function sceneId(scene) {
  let s = '';
  for (let i = 0x10; i < 0x30 && scene[i]; i++) s += String.fromCharCode(scene[i]);
  return s;
}

/**
 * Rewrite the names inside `scene` from map `from` to map `to` (ids like
 * bg000_01_c1_t00), in place. Returns how many names changed.
 */
export function renameScene(scene, from, to) {
  const a = ID.exec(from), b = ID.exec(to);
  if (!a || !b) throw new Error(`Can't rename ${from} to ${to}: unexpected map id`);
  if (from === to) return 0;
  let text = '';
  for (let i = 0; i < scene.length; i += 0x8000) text += String.fromCharCode.apply(null, scene.subarray(i, i + 0x8000));
  const names = new RegExp(`bg${a[1]}_([0-9a-z]+)_(${a[3]}|p\\d\\d)`, 'g');
  let changed = 0, m;
  while ((m = names.exec(text))) {
    const variant = m[1] === a[2] ? b[2] : m[1]; // the map's own variant number follows it; 00, a00... stay
    const tail = m[2] === a[3] ? b[3] : m[2];
    const next = `bg${b[1]}_${variant}_${tail}`;
    if (next.length !== m[0].length) throw new Error(`Can't rename ${m[0]}: the new name has another length`);
    for (let k = 0; k < next.length; k++) scene[m.index + k] = next.charCodeAt(k);
    changed++;
  }
  return changed;
}

export class MapLibrary {
  constructor(editor) {
    this.ed = editor;
    this.maps = null; // saved maps, read when the tab opens
    this.busy = false;
  }

  async refresh(box) {
    try { this.maps = await source.savedMaps(); } catch (err) { this.maps = []; this.error = err.message; }
    if (box && this.ed.tab === 'library') this.render(box);
  }

  /** Save the open map (with its unsaved edits) under a name of its own. */
  async saveAs(name, box) {
    const map = this.ed.map;
    name = name.trim();
    if (!name) { this.ed.ctx.toast('Give the map a name first.', true); return; }
    const exists = this.maps?.some((m) => m.name.toLowerCase() === name.toLowerCase());
    if (exists && !confirm(`Replace the saved map "${name}"?`)) return;
    this.ed.ctx.setStatus(`Packing ${map.id}…`);
    const bytes = await map.encode();
    await source.writeSavedMap(name, bytes, { source: map.id, width: map.width, depth: map.depth }, exists);
    this.ed.ctx.setStatus(`Saved "${name}" to the map library (${(bytes.length / 1048576).toFixed(1)} MB). The game is unchanged.`);
    await this.refresh(box);
  }

  /** Write a saved map over the open map's file (project or game, through the normal save). */
  async placeOver(saved, box) {
    const ed = this.ed, map = ed.map;
    if (ed.ctx.readOnly()) { ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
    const links = ed.ctx.catalog.mapLinks(map.id);
    const info = await source.info();
    const sizeNote = saved.width && (saved.width !== map.width || saved.depth !== map.depth)
      ? `\n\nSize changes from ${map.width}×${map.depth} to ${saved.width}×${saved.depth}. Battles and cutscenes place units by tile, so units may end up off the map or inside walls: check each battle in Battles mode afterwards.` : '';
    const useNote = links.battles.length || links.scenes.length
      ? `\n\nUsed by ${links.battles.length} battle${links.battles.length === 1 ? '' : 's'} and ${links.scenes.length} cutscene${links.scenes.length === 1 ? '' : 's'}${links.battles.length ? `:\n${links.battles.slice(0, 12).join(', ')}${links.battles.length > 12 ? '…' : ''}` : '.'}` : '';
    const dirty = ed.files.get(map.id)?.dirty ? '\n\nYour unsaved edits to this map will be lost.' : '';
    const where = info.project ? `the project "${info.project}"` : 'the game (the original is backed up)';
    if (!confirm(`Place "${saved.name}" over ${map.id}?\n\nIt is written to ${where}.${sizeNote}${useNote}${dirty}`)) return;
    this.busy = true; this.render(box);
    try {
      ed.ctx.setStatus(`Reading "${saved.name}"…`);
      const { name: entryName, data: pack } = await unzipSingle(decrypt(await source.readSavedMap(saved.name)));
      if (!/(^|\.)pack$/.test(entryName)) throw new Error(`"${saved.name}" is not a map file`);
      const scene = parsePakd(pack).entries[0].data; // a view into pack
      const from = sceneId(scene);
      if (view(scene).getUint16(0x56, true) < 1 || !ID.test(from)) throw new Error(`"${saved.name}" is not a map file`);
      const renamed = renameScene(scene, from, map.id);
      const bytes = await encodeDat(pack, map.dat.entryName);
      await saveDataFiles([{ path: map.path, bytes, originalSize: map.dat.originalSize, dat:map.dat }]);
      // start again from what is on disk, as after a normal save
      ed.ctx.catalog.grids.delete(map.id);
      ed.ctx.catalog.sceneCache = null;
      ed.files.delete(map.id);
      ed.sourceMaps.clear();
      const id = map.id;
      ed.map = null;
      await ed.openMap(id);
      ed.renderList();
      ed.ctx.onChange();
      ed.ctx.setStatus(`"${saved.name}" placed over ${id}${from !== id ? ` (made from ${from}; ${renamed} names inside rewritten)` : ''} · saved to ${where}`);
    } catch (err) {
      console.error(err);
      ed.ctx.toast(err.message, true);
    } finally {
      this.busy = false;
      if (ed.tab === 'library') ed.renderSide();
    }
  }

  render(box) {
    const ed = this.ed, map = ed.map;
    if (!map) { box.innerHTML = '<p class="muted pad">Choose a map.</p>'; return; }
    if (this.maps === null) { box.innerHTML = '<p class="muted pad">Reading the map library…</p>'; this.refresh(box); return; }
    const dirty = ed.files.get(map.id)?.dirty;
    box.innerHTML = `
      <div class="mp-pal-head">
        <p class="hint">Saved maps live in the editor's <code>maps</code> folder under their own names, apart from projects and the game. Save the open map here, then place it over any game map later.</p>
        <label class="field"><span class="field-label">Save ${esc(map.id)}${dirty ? ' (with its unsaved edits)' : ''} as</span><input class="lib-name" type="text" maxlength="60" placeholder="e.g. Harbour town v2"></label>
        <div class="mp-mode-actions"><button class="lib-save">Save to the library</button></div>
        ${this.error ? `<p class="hint warn">${esc(this.error)} (restart the editor server to enable the map library)</p>` : ''}
        <p class="hint">${this.maps.length ? `Placing writes the saved map over <b>${esc(map.id)}</b>, the map open now. Open another map first to place it there.` : 'No saved maps yet.'}</p>
      </div>
      <div class="st-list"></div>`;
    const input = box.querySelector('.lib-name');
    const save = () => this.saveAs(input.value, box).catch((err) => this.ed.ctx.toast(err.message, true));
    box.querySelector('.lib-save').onclick = save;
    input.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    const list = box.querySelector('.st-list');
    for (const m of this.maps) {
      const row = document.createElement('div');
      row.className = 'st-item';
      const size = m.width ? `${m.width}×${m.depth}` : '';
      const differs = m.width && (m.width !== map.width || m.depth !== map.depth);
      row.innerHTML = `<div class="st-pick lib-info"><b>${esc(m.name)}</b><small>${[m.source && `from ${esc(m.source)}`, size, m.saved && esc(m.saved), `${(m.size / 1048576).toFixed(1)} MB`].filter(Boolean).join(' · ')}</small>${differs ? `<small class="warn">Different size from ${esc(map.id)} (${map.width}×${map.depth})</small>` : ''}</div><button class="lib-place" ${this.busy ? 'disabled' : ''} title="Write this saved map over ${esc(map.id)}">Place over this map</button><button class="lib-del ghost" title="Delete this saved map">×</button>`;
      row.querySelector('.lib-place').onclick = () => this.placeOver(m, box);
      row.querySelector('.lib-del').onclick = async () => {
        if (!confirm(`Delete the saved map "${m.name}"? Maps already placed in the game or a project stay.`)) return;
        try { await source.deleteSavedMap(m.name); } catch (err) { this.ed.ctx.toast(err.message, true); }
        await this.refresh(box);
      };
      list.append(row);
    }
  }
}

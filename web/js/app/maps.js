// Map catalog, per-battle map choice and map suggestions.
// Which map, cutscene file and place each battle uses comes from the game's own
// story steps (data/battle_links.json, built by tools/build_battle_links.py:
// story step -> battle stage -> unit file, map number -> map file, stronghold).
// Hand-checked pairings in data/known_battles.json and the user's own choices
// come first; battles the story doesn't start get maps suggested by fit.

import { loadMapGrid, readMapInfo } from '../game/bgmap.js';
import { loadScene } from '../game/bgscene.js';
import { FIELD, readField } from '../game/entryunit.js';
import { source, mapLimit } from '../game/source.js';
import { MapPreferences } from './mappreferences.js';

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

export class MapCatalog {
  constructor() {
    this.maps = [];
    this.grids = new Map();
    this.known = {};
    this.knownMaps = {};
    this.preferences = new MapPreferences();
    this.links = { battles: {}, maps: {}, stages: {} };
    this.placeName = () => ''; // stronghold number -> name in the current text language (set by main.js)
  }

  setScope(info) {
    const changed = this.preferences.setScope(info);
    if (changed) { this.grids.clear(); this.sceneCache = null; }
    return changed;
  }

  async load(onProgress) {
    try {
      const known = await (await fetch('data/known_battles.json')).json();
      this.known = known.battles || {};
      this.knownMaps = known.maps || {};
    } catch {
      this.known = {};
      this.knownMaps = {};
    }
    try {
      const links = await (await fetch('data/battle_links.json')).json();
      this.links = { battles: links.battles || {}, maps: links.maps || {}, stages: links.stages || {} };
    } catch {
      this.links = { battles: {}, maps: {}, stages: {} };
    }
    const files = (await source.list('bg')).filter((f) => /^bg\d{3}_.*_t\d+\.dat$/i.test(f.name));
    const cacheKey = this.preferences.key('mapinfo');
    const cache = store.get(cacheKey, {});
    let done = 0;
    this.maps = (await mapLimit(files, 8, async (f) => {
      const cacheKey = `${f.name}:${f.size}`;
      try {
        if (!cache[cacheKey]) cache[cacheKey] = await readMapInfo(`bg/${f.name}`);
        return { ...cache[cacheKey], file: f.name, id: f.name.replace(/\.dat$/i, '') };
      } catch (err) {
        console.warn(`map ${f.name}:`, err);
        return null;
      } finally {
        onProgress?.(++done, files.length);
      }
    })).filter(Boolean);
    store.set(cacheKey, cache);
  }

  byId(id) { return this.maps.find((m) => m.id === id) || null; }

  /** "Golyat": the place the story is at on this map, in the current text language. */
  placeLabel(id) {
    const l = this.links.maps[id];
    return (l && this.placeName(l.place)) || this.knownMaps[id]?.label || '';
  }

  /** The battles (unit files) and cutscene files the story uses this map for. */
  mapLinks(id) {
    const l = this.links.maps[id];
    const base = l?.variantOf ? this.links.maps[l.variantOf] : l;
    return { battles: base?.battles ?? [], scenes: base?.scenes ?? [] };
  }

  /** "bg003_01_c0_t00 · Almorica Castle (23×17)" */
  mapLabel(m) {
    const name = this.placeLabel(m.id) || this.knownMaps[m.id]?.label;
    return `${m.id}${name ? ` · ${name}` : ''}  (${m.width}×${m.depth})`;
  }

  async grid(id) {
    if (!this.grids.has(id)) this.grids.set(id, loadMapGrid(`bg/${id}.dat`));
    return this.grids.get(id);
  }

  /** Full 3D scene (mesh + textures). Only the latest is kept: scenes are ~20 MB each. */
  async scene(id) {
    if (this.sceneCache?.id !== id) this.sceneCache = { id, scene: loadScene(`bg/${id}.dat`) };
    try {
      return await this.sceneCache.scene;
    } catch (err) {
      this.sceneCache = null;
      throw err;
    }
  }

  /** The map chosen for a battle: user choice, then a hand-checked pairing, then the story's own link. */
  chosenMap(doc) {
    if (this.preferences.hasChoice(doc.key)) return this.preferences.choices[doc.key] || null;
    const selected = this.activeContext(doc);
    const explicit = this.preferences.contexts[doc.key];
    return (explicit && selected?.map) || this.known[doc.key]?.map || selected?.map || this.links.battles[doc.key]?.map || null;
  }

  /** Every recorded use, including separate maps for a shared unit file. */
  battleContexts(doc) {
    const link = this.links.battles[doc.key];
    if (link?.contexts?.length) return link.contexts;
    return link?.map ? [{ ...link, id: 'legacy', scene: link.scenes?.[0], slot: 'normal' }] : [];
  }

  activeContext(doc) {
    const contexts = this.battleContexts(doc);
    return contexts.find((c) => c.id === this.preferences.contexts[doc.key])
      ?? contexts.find((c) => c.id === this.links.battles[doc.key]?.defaultContext) ?? contexts[0] ?? null;
  }

  /** Current use, retaining the union of scenes for shared-file lookups. */
  battleLink(doc) {
    const link = this.links.battles[doc.key];
    return link ? { ...link, ...this.activeContext(doc), scenes: link.scenes } : null;
  }

  setContext(doc, id) {
    if (!this.battleContexts(doc).some((c) => c.id === id)) return false;
    this.preferences.setContext(doc.key, id);
    return true;
  }

  hasChoice(doc) { return this.preferences.hasChoice(doc.key); }
  clearChoice(doc) { this.preferences.clearChoice(doc.key); }
  legacyChoice(doc) {
    const map = this.preferences.legacyChoice(doc.key);
    return map && this.byId(map) ? map : null;
  }

  /** Battle stages (stage table rows) that use this file: [{ stage, slot: 'normal' | 'special' }]. */
  stagesFor(doc) { return this.links.stages[doc.key] ?? []; }

  setChoice(doc, mapId) {
    this.preferences.setChoice(doc.key, mapId);
  }

  label(doc) {
    const link = this.battleLink(doc);
    const game = link ? [this.placeLabel(link.map) || this.placeName(link.place), link.scene || link.scenes.join(', ')].filter(Boolean).join(' · ') : '';
    return this.preferences.labels[doc.key] ?? this.known[doc.key]?.label ?? game;
  }

  setLabel(doc, label) {
    this.preferences.setLabel(doc.key, label);
  }

  labelSuggestion(doc) {
    return this.preferences.labels[doc.key] ?? this.preferences.legacyLabel(doc.key) ?? this.label(doc);
  }

  /**
   * Rank maps that could host this battle: every unit must fit inside the
   * map. Closer fits rank higher; the best few are checked tile by tile
   * so maps that would put units inside destructible objects drop down.
   */
  async suggest(doc, limit = 8) {
    const slots = doc.unitSlots();
    if (!slots.length) return [];
    const positions = slots.map((s) => ({ x: readField(doc.row(s), FIELD.x), y: readField(doc.row(s), FIELD.z) }));
    const { maxX, maxY } = doc.bbox();
    const fits = this.maps
      .filter((m) => m.width > maxX && m.depth > maxY && !/_99_/.test(m.id))
      .map((m) => ({ map: m, slack: (m.width - maxX - 1) + (m.depth - maxY - 1) }))
      .sort((a, b) => a.slack - b.slack)
      .slice(0, limit * 3);
    for (const c of fits) {
      const grid = await this.grid(c.map.id);
      c.blocked = positions.filter((p) => grid.tileAt(p.x, p.y)?.object !== null).length;
      c.score = c.blocked * 10 + c.slack;
    }
    return fits.sort((a, b) => a.score - b.score).slice(0, limit);
  }
}

import {MenuMods}from './menumods.js';
import {PspSpells}from './pspspells.js';
import{RestrictionPreferences}from'./restrictionpreferences.js';
import{source}from'../game/source.js';
import {projectArtOptions}from '../game/customcharacters.js';
// Classes & items mode: edit the class, equipment, item, spell and character
// (unit template) tables in battle_data_release.dat and the shop list in
// menu_data.dat, with the game's own sprites and icons.
// Rows are edited in place (same sizes), so other mods' changes elsewhere in
// the files are kept. Field layouts: data/schemas/*.json (see tools/build_schemas.py).

import { buildPakd, isXlce, parsePakd, parseXlce, view } from '../lib/pakd.js';
import { encodeDat, loadDat } from '../game/datfile.js';
import { loadIconArchive } from '../game/icons.js';
import { LocalizeFile } from '../game/localize.js';
import { LANGUAGES } from '../game/texts.js';
import { decodeForEdit, encodeFromEdit } from '../game/textcodec.js';
import { loadActorFrame } from '../game/unitsprites.js';
import { rgbaCanvas, textureCanvas } from '../ui/texcanvas.js';
import { createPicker } from '../ui/picker.js';
import { itemArt, abilityArt } from '../ui/iconart.js';
import { customIconBinding, iconName, writeCustomIcon } from '../game/customicons.js';
import { ClassMarks, ITEM_BASE, MENU_PATH } from './classmarks.js';
import { IntegratedMods } from './integratedmods.js';
import { RaceRules } from './races.js';
import { SetEditor } from './sets.js';
import { CraftingEditor } from './crafting.js';
import { AutoLoadoutsEditor } from './autoloadouts.js';
import { OthersEditor } from './others.js';
import { syncCopies } from '../game/unitcopies.js';
import { battleData } from '../game/battledata.js';
import { saveDataFiles } from './savefiles.js';
import { isUnknownField, settings } from './settings.js';
import { attachHelp, dataFieldHelp } from './fieldhelp.js';
import {EffectViewer} from '../ui/effectviewer.js';

const PATH = 'battle/battle_data_release.dat';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, w) => String(n).padStart(w, '0');

// Which battle-data table each tab edits (checked by row size when loading).
const KINDS = [
  { key: 'class', entry: 14, rowSize: 208, schema: 'class', title: 'Classes' },
  { key: 'armament', entry: 11, rowSize: 152, schema: 'armament', title: 'Equipment' },
  { key: 'commodity', entry: 13, rowSize: 56, schema: 'commodity', title: 'Items' },
  { key: 'effect', entry: 16, rowSize: 180, schema: 'effect', title: 'Spells & abilities' },
  { key: 'skill', entry: 25, rowSize: 102, expandedRowSize: 166, schema: 'skill', title: 'Skill' },
  // "character sheets": base stats and growths, gender, race, class set, sprite, portraits
  { key: 'template', entry: 23, rowSize: 84, schema: 'template', title: 'Characters' },
  // what the shops sell and from which shop level (menu_data.dat)
  { key: 'shop', file: 'menu', entry: 26, rowSize: 38, schema: 'shop', title: 'Shops' },
];
const KIND_HINTS = {
  skill: 'Use Skill sets to change which classes learn this skill and at what level.',
  template: 'A character sheet (unit template): what a unit starts with before its class and level. Growths are per level, ×10 (12 = 1.2). Units point at their sheet with “Unit template” in Battles mode.',
  shop: 'Each town’s number is the shop level from which it sells this item; 0 = not sold there. Shop levels go up as the story goes on (1-15). An item can also wait for a crafting recipe being obtained or a character recruited.',
};
const fileOf = (kindKey) => KINDS.find((k) => k.key === kindKey)?.file ?? 'battle';
// Which classes each race may use: edits class rows too (see races.js).
// Where an entry's name ID sits and the game texts it names: <prefix><id, padded><suffix>.
const NAME_IDS = {
  class: { offset: 0xB2, desc: 0xB4, prefix: 'CLASS_TEXT_DATA_CLASS', width: 4, suffixes: ['_MALE', '_FEMALE', '_HELP'] },
  armament: { offset: 0x86, desc: 0x62, prefix: 'ARMSTEXT_LC_ARMS_', width: 3, suffixes: ['_NAME', '_HELP'] },
  effect: { offset: 0x94, desc: 0x16, prefix: 'EFFECTTEXT_LC_EFFECT_', width: 3, suffixes: ['_NAME', '_HELP'] },
};
// New entries. Classes (a unit stores its class in one byte) and equipment (the .exe
// and saves hold exactly 761 slots) can't grow, so a new one takes a row the game
// never uses: a class with no texts at all, equipment with no name (no unit has either). Items
// (the save keeps 1000 quantities) and spells & abilities get a row added at the end
// of their table - untested in game. Item texts are keyed by the item's number, and
// each item and piece of equipment has its own "found" flag, so a copy takes its new
// number in those fields.
const NEW_ENTRY = {
  // the 92 class rows with no texts at all are used by no unit in any battle file
  class: {},
  armament: { found: 0x90 },
  commodity: { found: 0x30, base: 1000, own: [0x2A, 0x0A], limit: 1000 },
  effect: {},
};
const align16p1 = (n) => (n + 1 + 15) & ~15;
const RACES = { key: 'race', title: 'Races' };
// One-click changes built on these tables (see integratedmods.js).
const MODS = { key: 'mods', title: 'Integrated mods' };
// Tabs with views of their own, in the order they appear in the sidebar.
const PANELS = [
  { key: 'spellset', title: 'Spell sets', panel: 'spellset' },
  { key: 'skillset', title: 'Skill sets', panel: 'skillset' },
  { key: 'crafting', title: 'Crafting', panel: 'crafting' },
  RACES,
  { key: 'autoloadouts', title: 'Auto Loadouts', panel: 'autoloadouts' },
  { key: 'others', title: 'Others', panel: 'others' },
];
const TABS = [...KINDS.filter(({ key }) => key !== 'skill'), ...PANELS];

export class DataEditor {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // { tables(), lang(), toast, setStatus, onChange, readOnly() }
    this.renames = new Map(); // text key -> new text, written to the text files on save
    this.newKeys = new Set(); // text keys that don't exist yet: added to every language on save
    this.allLanguages = true;
    this.kind = KINDS[0];
    this.selected = 0;
    this.selectedSkill = null;
    this.filter = '';
    this.namedOnly = true;
    this.fieldFilter = '';
    this.thumbs = new Map();
  }

  async open() {
    if (this.dat) return;
    this.ctx.setStatus('Loading game data tables…');
    // shared with Battles mode, which changes stage unit counts (game/battledata.js)
    this.sharedBattle = await battleData();
    this.dat = this.sharedBattle.dat;
    this.menu = await loadDat(MENU_PATH);
    this.keepOriginal(this.sharedBattle.original);
    this.parseTables();
    this.schemas = {};
    for (const k of KINDS) this.schemas[k.key] = await (await fetch(`data/schemas/${k.schema}.json`)).json();
    this.setNames = await (await fetch('data/schemas/sets.json')).json();
    this.localize = await LocalizeFile.load(this.ctx.lang?.() || 'en-us');
    try {
      this.marks = await ClassMarks.load(this);
    } catch (err) {
      console.warn('class marks:', err);
    }
    const info = await source.info();
    this.menuMods = await MenuMods.load(info);
    this.customIcons = info.customIcons ?? [];
    this.entryEdits = new Map(); // battle/entry files changed by integrated mods: path -> { dat, original }
    this.pspSpells = await PspSpells.load(this);
    try {
      this.races = new RaceRules(this);
      this.mods = new IntegratedMods(this);
    } catch (err) {
      console.warn('races:', err);
    }
    this.restrictionGroups = await RestrictionPreferences.load(await source.info());
    this.makePanels();
    this.build();
    this.renderList();
    this.select(this.firstNamed());
    this.ctx.setStatus('Stats & Values ready');
    if (info.integratedContentError) this.ctx.toast(`Integrated mod preview: ${info.integratedContentError}`, true);
  }

  parseTables() {
    this.tables = {};
    for (const k of KINDS) {
      const e = this.fileDat(k.key).pakd.entries[k.entry];
      const table = e && isXlce(e.data) ? parseXlce(e.data) : null;
      if (!table || ![k.rowSize, k.expandedRowSize].includes(table.rowSize)) throw new Error(`${k.title}: table not found where expected`);
      this.tables[k.key] = { ...table, entryOffset: e.offset, headerSize: view(e.data).getUint32(8, true) };
    }
  }

  /** The files as loaded (or last saved): what edits are compared with and reverted to. */
  keepOriginal(battleOriginal = null) {
    const entries = (pack) => parsePakd(pack).entries.map((e) => isXlce(e.data)
      ? { offset: e.offset, ...parseXlce(e.data), headerSize: view(e.data).getUint32(8, true) }
      : { offset: e.offset, count: 0 });
    this.original = battleOriginal ?? this.dat.pack.slice();
    if (this.sharedBattle) this.sharedBattle.original = this.original;
    this.originalEntries = entries(this.original);
    this.menuOriginal = this.menu.pack.slice();
    this.menuOriginalEntries = entries(this.menuOriginal);
  }

  /** The loaded file a table lives in, and that file as it was loaded. */
  fileDat(kindKey) { return fileOf(kindKey) === 'menu' ? this.menu : this.dat; }
  fileOriginal(kindKey) { return fileOf(kindKey) === 'menu' ? this.menuOriginal : this.original; }

  /** Where row i of a table started in the original file (null for a row added since). */
  originalRowStart(kindKey, i) {
    const k = KINDS.find((x) => x.key === kindKey);
    const e = (k.file === 'menu' ? this.menuOriginalEntries : this.originalEntries)[k.entry];
    return i < e.count ? e.offset + e.headerSize + i * e.rowSize : null;
  }

  // ---- data access ----------------------------------------------------------
  table() { return this.tables[this.kind.key]; }
  row(i) { return this.table().row(i); }
  rowStart(i, kind = this.kind.key) {
    const t = this.tables[kind];
    return t.entryOffset + t.headerSize + i * t.rowSize;
  }

  /** Display name from this editor's own rows (so edited name IDs show at once). */
  name(kind, i) {
    const t = this.ctx.tables();
    if (!t) return '';
    const v = view(this.tables[kind].row(i));
    if (kind === 'class') return t.className(i) || (v.getUint8(0x55) ? `Class ${i}` : '');
    if (kind === 'armament') return t.armsName(i) || (v.getUint8(2) ? `Equipment ${i}` : '');
    // items: the name field leaves out "+1"-style grades; the text keyed by item ID has them
    if (kind === 'commodity') return t.commodityName(i) || (v.getUint8(2) ? `Item ${ITEM_BASE+i}` : '');
    if (kind === 'effect') return t.effectName(i) || (v.getUint8(2) ? `Effect ${i}` : '');
    if (kind === 'skill') return v.getUint8(2) ? this.editText(this.textKeys(kind, i).name) || t.skillName(i) || `Skill ${i}` : '';
    if (kind === 'template') return t.templateName(i);
    if (kind === 'shop') {
      const id = v.getUint16(0, true);
      return id ? t.itemName(id) || `Item ${id}` : '';
    }
    return '';
  }

  /**
   * The game texts an entry's name and description come from. Several entries
   * can share a name ID, and then share these texts.
   */
  textKeys(kind, i) {
    if (kind === 'commodity') {
      const k = `COMMODITYTEXT_LC_COMMODITY_${pad(i, 3)}`;
      return { id: null, name: `${k}_NAME`, help: `${k}_HELP` };
    }
    const v = view(this.tables[kind].row(i));
    if (kind === 'class') {
      const k = `CLASS_TEXT_DATA_CLASS${pad(v.getUint16(0xB2, true), 4)}`;
      return { id: v.getUint16(0xB2, true), name: `${k}_MALE`, female: `${k}_FEMALE`, help: `CLASS_TEXT_DATA_CLASS${pad(v.getUint16(0xB4, true), 4)}_HELP` };
    }
    if (kind === 'armament') {
      const k = `ARMSTEXT_LC_ARMS_${pad(v.getUint16(0x86, true), 3)}`;
      return { id: v.getUint16(0x86, true), name: `${k}_NAME`, help: `ARMSTEXT_LC_ARMS_${pad(v.getUint16(0x62, true), 3)}_HELP` };
    }
    if (kind === 'effect') {
      const k = `EFFECTTEXT_LC_EFFECT_${pad(v.getUint16(0x94, true), 3)}`;
      return { id: v.getUint16(0x94, true), name: `${k}_NAME`, help: `EFFECTTEXT_LC_EFFECT_${pad(v.getUint16(0x16, true), 3)}_HELP` };
    }
    if (kind === 'skill') {
      const id = v.getUint16(0x5a, true);
      return { id, name: `SKILLTEXT_LC_SKILL_${pad(id, 3)}_NAME`, help: `SKILLTEXT_LC_SKILL_${pad(v.getUint16(0x5c, true), 3)}_HELP` };
    }
    return null;
  }

  /** Text for editing: a pending rename, else the game's text (control codes kept aside). */
  editText(key) {
    if (this.renames.has(key)) return this.renames.get(key);
    const bytes = this.localize?.get(key);
    return bytes ? decodeForEdit(bytes).text : null;
  }

  /**
   * A name ID no entry of this kind uses: first one whose texts already exist in
   * every language (cut content), else the next unused number (its texts are
   * created on save). null when the ID space is full.
   */
  freeNameId(kind, prefer = null) {
    const spec = NAME_IDS[kind];
    const t = this.tables[kind];
    const used = new Set(Array.from({ length: t.count }, (_, r) => (r === prefer ? -1 : view(t.row(r)).getUint16(spec.offset, true))));
    const key = (id, s) => `${spec.prefix}${pad(id, spec.width)}${s}`;
    const limit = 10 ** spec.width;
    if (prefer !== null && prefer > 0 && !used.has(prefer) && spec.suffixes.every((s) => !this.renames.has(key(prefer, s)))) {
      return { id: prefer, isNew: !this.localize.has(key(prefer, spec.suffixes[0])) };
    }
    for (let id = 1; id < limit; id++) {
      if (used.has(id) || !this.localize.has(key(id, spec.suffixes[0]))) continue;
      if (spec.suffixes.some((s) => this.renames.has(key(id, s)))) continue; // given out this session
      return { id, isNew: false };
    }
    let max = Math.max(...used);
    for (const k of this.localize.index.keys()) if (k.startsWith(spec.prefix)) max = Math.max(max, Number(k.slice(spec.prefix.length, spec.prefix.length + spec.width)) || 0);
    for (const k of this.newKeys) if (k.startsWith(spec.prefix)) max = Math.max(max, Number(k.slice(spec.prefix.length, spec.prefix.length + spec.width)) || 0);
    return max + 1 < limit ? { id: max + 1, isNew: true } : null;
  }

  /** Point entry i at a name ID of its own, starting from the texts it showed. */
  giveOwnName(kind, i, { quiet = false, prefer = null } = {}) {
    const spec = NAME_IDS[kind];
    const free = this.freeNameId(kind, prefer);
    if (!free) { this.ctx.toast('Every name ID of this kind is in use: there is none to give out.', true); return; }
    const before = this.textKeys(kind, i);
    const texts = { name: this.editText(before.name) ?? '', female: before.female ? this.editText(before.female) ?? '' : null, help: this.editText(before.help) ?? '' };
    const row = view(this.tables[kind].row(i));
    row.setUint16(spec.offset, free.id, true);
    if (spec.desc !== undefined) row.setUint16(spec.desc, free.id, true);
    const after = this.textKeys(kind, i);
    for (const k of ['name', 'female', 'help']) {
      if (!after[k] || texts[k] === null) continue;
      if (!this.localize.has(after[k])) this.newKeys.add(after[k]);
      this.rename(after[k], texts[k]);
    }
    this.ctx.setStatus(`${this.kind.title} #${i} now has name ID ${free.id}${free.isNew ? ' (new texts, added to every language on save)' : ' (its unused texts are replaced)'}`);
    if (quiet) return;
    this.refreshListItem(i);
    this.renderDetail();
  }

  rename(key, text) {
    const bytes = this.localize?.get(key);
    const original = bytes ? decodeForEdit(bytes).text : null;
    if (text === original) this.renames.delete(key); else this.renames.set(key, text);
    this.ctx.tables()?.texts.set(key, text); // shows at once in lists and pickers
    this.ctx.onChange();
  }

  get dirty() {
    if (this.renames.size || this.entryEdits?.size || this.restrictionGroups?.dirty || this.warrenRules?.dirty || this.menuMods?.dirty || this.pspSpells?.dirty) return true;
    return this.battleChanged() || this.menuChanged();
  }

  battleChanged() { return !!this.dat && differs(this.dat.pack, this.original); }
  menuChanged() { return !!this.menu && differs(this.menu.pack, this.menuOriginal); }

  rowChanged(i, kind = this.kind.key) {
    const s = this.rowStart(i, kind), o = this.originalRowStart(kind, i);
    if (o === null) return true;
    const pack = this.fileDat(kind).pack, original = this.fileOriginal(kind);
    for (let k = 0; k < this.tables[kind].rowSize; k++) if (pack[s + k] !== original[o + k]) return true;
    return false;
  }

  fieldChanged(i, f, kind = this.kind.key) {
    const s = this.rowStart(i, kind) + f.offset, o = this.originalRowStart(kind, i);
    if (o === null) return true;
    const pack = this.fileDat(kind).pack, original = this.fileOriginal(kind);
    for (let k = 0; k < f.size; k++) if (pack[s + k] !== original[o + f.offset + k]) return true;
    return false;
  }

  /** A row the game never uses, untouched: equipment with no name, a class with no texts at all. */
  unusedRow(kind) {
    const spec = NAME_IDS[kind];
    const t = this.tables[kind];
    if (kind === 'commodity') {
      // items: no name and type 0 (in the shipped data no unit carries or drops one)
      for (let i = 1; i < t.count; i++) {
        const o = this.originalRowStart(kind, i);
        if (o === null || this.original[o + 2] !== 0 || this.ctx.tables()?.commodityName(i)) continue;
        if (this.renames.has(this.textKeys(kind, i).name)) continue; // given out this session
        const row = t.row(i);
        let untouched = true;
        for (let k = 0; k < row.length && untouched; k++) untouched = row[k] === this.original[o + k];
        if (untouched) return i;
      }
      return null;
    }
    for (let i = 1; i < t.count; i++) {
      const o = this.originalRowStart(kind, i);
      if (o === null) continue;
      const id = view(this.original).getUint16(o + spec.offset, true);
      if (kind === 'class' ? spec.suffixes.some((s) => this.localize.has(`${spec.prefix}${pad(id, spec.width)}${s}`)) : id !== 0) continue;
      let untouched = true;
      const row = t.row(i);
      for (let k = 0; k < row.length && untouched; k++) untouched = row[k] === this.original[o + k];
      if (untouched) return i;
    }
    return null;
  }

  /** Add a row at the end of a table (the file is rebuilt around it); returns its number. */
  appendRow(kind, copyOf, slot = this.tables[kind].count) {
    const k = KINDS.find((x) => x.key === kind);
    const t = this.tables[kind];
    const copy = t.row(copyOf).slice();
    const old = this.dat.pakd.entries[k.entry].data;
    const body = 16 + (slot + 1) * k.rowSize;
    const data = new Uint8Array(align16p1(body));
    data.set(old.subarray(0, 16 + t.count * k.rowSize), 0);
    view(data).setUint32(4, slot + 1, true);
    data.set(copy, 16 + slot * k.rowSize);
    this.rebuildPack(k.entry, data);
    return slot;
  }

  *communityItemSlots() {
    const pool = this.menuMods?.saved?.itemPool;
    if (!pool) return;
    const table = this.tables.commodity;
    for (let i = pool.markStart + pool.markCount; i < pool.limit; i++) {
      if (i < table.count && table.row(i).some(Boolean)) continue;
      const keys = this.textKeys('commodity', i);
      if (!this.editText(keys.name) && !this.editText(keys.help)) yield i;
    }
  }

  /** Remove the last row of a table (an added one). */
  dropLastRow(kind) {
    const k = KINDS.find((x) => x.key === kind);
    const t = this.tables[kind];
    const old = this.dat.pakd.entries[k.entry].data;
    const body = 16 + (t.count - 1) * k.rowSize;
    const data = new Uint8Array(align16p1(body));
    data.set(old.subarray(0, body), 0);
    view(data).setUint32(4, t.count - 1, true);
    this.rebuildPack(k.entry, data);
  }

  /** Add `row` at the end of any battle data table (e.g. the AI table); returns its number. */
  appendEntryRow(entry, row) {
    const old = this.dat.pakd.entries[entry].data;
    const t = parseXlce(old);
    if (row.length !== t.rowSize) throw new Error(`entry ${entry} has ${t.rowSize}-byte rows`);
    const body = 16 + (t.count + 1) * t.rowSize;
    const data = new Uint8Array(align16p1(body));
    data.set(old.subarray(0, 16 + t.count * t.rowSize), 0);
    view(data).setUint32(4, t.count + 1, true);
    data.set(row, 16 + t.count * t.rowSize);
    this.rebuildPack(entry, data);
    return t.count;
  }

  /** Remove the last row of any battle data table (one added with appendEntryRow). */
  dropEntryRow(entry) {
    const old = this.dat.pakd.entries[entry].data;
    const t = parseXlce(old);
    const body = 16 + (t.count - 1) * t.rowSize;
    const data = new Uint8Array(align16p1(body));
    data.set(old.subarray(0, body), 0);
    view(data).setUint32(4, t.count - 1, true);
    this.rebuildPack(entry, data);
  }

  rebuildPack(entry, data) {
    const entries = this.dat.pakd.entries.map((e, i) => (i === entry ? data : e.data));
    this.dat.pack = buildPakd(entries);
    this.dat.pakd = parsePakd(this.dat.pack);
    this.refreshBattleData();
  }

  refreshBattleData() {
    this.parseTables();
    try {
      this.races = new RaceRules(this);
      this.mods = new IntegratedMods(this);
    } catch (err) {
      console.warn('races:', err);
    }
    this.makePanels(); // their table views pointed into the old pack
  }

  makePanels() {
    const make = (f) => { try { return f(); } catch (err) { console.warn('panel:', err); return undefined; } };
    this.panels = {
      spellset: make(() => new SetEditor(this, 'effect')),
      skillset: make(() => new SetEditor(this, 'skill')),
      crafting: make(() => new CraftingEditor(this)),
      autoloadouts: make(() => new AutoLoadoutsEditor(this)),
      others: make(() => new OthersEditor(this)),
    };
  }

  /** Undo newEntry: an unused row goes back to how it was, an added (last) row is removed; its new texts go. */
  discardNewEntry(kind, i) {
    const keys = this.textKeys(kind, i);
    const forget = () => { for (const k of ['name', 'female', 'help']) if (keys[k]) { this.renames.delete(keys[k]); this.newKeys.delete(keys[k]); } };
    const o = this.originalRowStart(kind, i);
    if (o === null) {
      if (i !== this.tables[kind].count - 1) return false; // only the last added row can go
      forget();
      this.dropLastRow(kind);
      return true;
    }
    forget();
    const k = KINDS.find((x) => x.key === kind);
    this.tables[kind].row(i).set(this.original.subarray(o, o + k.rowSize));
    return true;
  }

  /** A new entry copied from entry `from`, with its own name: returns its number. */
  newEntry(kind, from, { name = null } = {}) {
    const rule = NEW_ENTRY[kind];
    const t = this.tables[kind];
    const before = this.textKeys(kind, from);
    const texts = { name: this.editText(before.name) ?? '', help: this.editText(before.help) ?? '' };
    let to;
    if (kind === 'commodity' && this.menuMods?.value.modPreparation && this.menuMods.saved?.itemPool) {
      to = this.communityItemSlots().next().value;
      if (to === undefined) { this.ctx.toast('All community item slots are in use.', true); return null; }
      if (to >= t.count) this.appendRow(kind, from, to);
      else t.row(to).set(t.row(from).slice());
    } else if (kind === 'armament' || kind === 'class') {
      to = this.unusedRow(kind);
      if (to === null) { this.ctx.toast(`Every unused ${kind === 'class' ? 'class' : 'equipment'} row has been given out.`, true); return null; }
      t.row(to).set(t.row(from).slice());
    } else {
      const reuse = kind === 'commodity' ? this.unusedRow(kind) : null;
      if (reuse !== null) {
        to = reuse;
        t.row(to).set(t.row(from).slice());
      } else {
        if (rule.limit && t.count >= rule.limit) { this.ctx.toast(`${KINDS.find((k) => k.key === kind).title} can't go past ${rule.limit} (the save file keeps that many).`, true); return null; }
        to = this.appendRow(kind, from);
      }
    }
    const row = view(this.tables[kind].row(to));
    const base = rule.base ?? 0;
    if (rule.found !== undefined && row.getUint16(rule.found, true) === from + base) row.setUint16(rule.found, to + base, true);
    if (NAME_IDS[kind]) {
      this.giveOwnName(kind, to, { quiet: true, prefer: kind === 'class' ? to : null });
    } else {
      // items: texts keyed by the item's own number
      for (const off of rule.own ?? []) if (row.getUint16(off, true) === from + base) row.setUint16(off, to + base, true);
      const keys = this.textKeys(kind, to);
      for (const k of ['name', 'help']) if (!this.localize.has(keys[k])) this.newKeys.add(keys[k]);
      this.rename(keys.help, texts.help);
    }
    const nameKey = this.textKeys(kind, to).name;
    if (!this.localize.has(nameKey)) this.newKeys.add(nameKey);
    this.rename(nameKey, name ?? `${texts.name} (new)`);
    this.ctx.onChange();
    return to;
  }

  read(row, f) {
    const v = view(row);
    if (f.type === 'bytes') return [...row.subarray(f.offset, f.offset + f.size)].map((b) => pad(b.toString(16).toUpperCase(), 2)).join(' ');
    const signed = f.type === 'int';
    if (f.size === 1) return signed ? v.getInt8(f.offset) : v.getUint8(f.offset);
    if (f.size === 2) return signed ? v.getInt16(f.offset, true) : v.getUint16(f.offset, true);
    if (f.size === 4) return signed ? v.getInt32(f.offset, true) : v.getUint32(f.offset, true);
    return 0;
  }

  write(row, f, value) {
    if (this.ctx.readOnly()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return false; }
    const v = view(row);
    if (f.type === 'bytes') {
      const bytes = String(value).trim().split(/\s+/).map((h) => parseInt(h, 16));
      if (bytes.length !== f.size || bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) { this.ctx.toast(`${f.label}: enter ${f.size} hex bytes`, true); return false; }
      row.set(bytes, f.offset);
      return true;
    }
    const n = Math.trunc(Number(value));
    const bits = f.size * 8;
    const [lo, hi] = f.type === 'int' ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] : [0, 2 ** bits - 1];
    if (!Number.isFinite(n) || n < lo || n > hi) { this.ctx.toast(`${f.label}: must be ${lo} to ${hi}`, true); return false; }
    if (f.size === 1) (f.type === 'int' ? v.setInt8 : v.setUint8).call(v, f.offset, n);
    else if (f.size === 2) (f.type === 'int' ? v.setInt16 : v.setUint16).call(v, f.offset, n, true);
    else (f.type === 'int' ? v.setInt32 : v.setUint32).call(v, f.offset, n, true);
    return true;
  }

  openOtherCategory(id) { return this.openPanel('others', id); }
  openAutoLoadout(id, poolView) {
    if (this.panels.autoloadouts) this.panels.autoloadouts.poolView = poolView;
    return this.openPanel('autoloadouts', id);
  }

  openPanel(key, id) {
    if (this.kind === MODS) {
      this.selectedMod = this.selected;
      this.dataSelection = null;
      this.ctx.onOpenData?.();
    }
    this.kind = TABS.find(tab => tab.key === key);
    this.filter = this.root.querySelector('#data-search').value = '';
    this.selected = id;
    this.renderList();
    return this.select(id);
  }

  async showIntegratedMods(open) {
    if (open === (this.kind === MODS)) return;
    if (open) {
      if (!this.mods) throw new Error('Integrated Mods could not be loaded.');
      this.dataSelection = { kind: this.kind, selected: this.selected, selectedSkill: this.selectedSkill,
        filter: this.filter, fieldFilter: this.fieldFilter };
      this.kind = MODS;
      this.selected = this.selectedMod ?? 0;
      this.selectedSkill = null;
      this.fieldFilter = '';
    } else {
      this.selectedMod = this.selected;
      Object.assign(this, this.dataSelection);
      this.dataSelection = null;
    }
    this.renderList();
    await this.select(this.selected, this.selectedSkill);
  }
  openSpellSet(id) {if(!this.panels.spellset?.hasSet(id))throw new Error('Invalid spell set');this.kind=TABS.find(k=>k.key==='spellset');this.filter='';this.root.querySelector('#data-search').value='';this.selected=id;this.renderList();this.select(id);}

  openSkillSet(id) {
    if(!this.panels.skillset?.hasSet(id))throw new Error('Invalid skill set');
    this.kind=TABS.find(k=>k.key==='skillset');this.filter='';this.selected=id;
    this.root.querySelector('#data-search').value='';this.renderList();this.select(id);
  }

  openCharacterTemplate(id) {
    if(!Number.isInteger(id)||id<0||id>=this.tables.template.count)throw new Error('Invalid character sheet');
    this.kind=KINDS.find(k=>k.key==='template');this.filter='';this.namedOnly=false;this.selected=id;
    this.root.querySelector('#data-search').value='';this.root.querySelector('#data-named').checked=false;
    this.renderList();this.select(id);
  }

  firstNamed() {
    if (this.kind === RACES) return Math.max(0, this.races?.sets.findIndex((s) => s.label === 'Lizardman') ?? 0);
    if (this.kind.panel) return this.panels[this.kind.panel].first(this.filter);
    for (let i = 0; i < this.table().count; i++) if (this.name(this.kind.key, i)) return i;
    return 0;
  }

  get tabKey() { return this.kind.key === 'skill' ? 'effect' : this.kind.key; }

  skillEffect(i) {
    const id = view(this.tables.skill.row(i)).getUint16(4, true);
    return id > 0 && id < this.tables.effect.count ? id : null;
  }

  skillRecords() {
    const linked = new Map(), standalone = [];
    for (let i = 0; i < this.tables.skill.count; i++) {
      const name = this.name('skill', i);
      if (this.namedOnly && !name && i !== this.selectedSkill) continue;
      const record = { kind: 'skill', i, name, skills: [] };
      const effect = this.skillEffect(i);
      if (effect === null) standalone.push(record);
      else {
        if (!linked.has(effect)) linked.set(effect, []);
        linked.get(effect).push(record);
      }
    }
    return { linked, standalone };
  }

  listRecords() {
    const kind = this.tabKey;
    const { linked, standalone } = kind === 'effect' ? this.skillRecords() : { linked: new Map(), standalone: [] };
    const records = [];
    for (let i = 0; i < this.tables[kind].count; i++) {
      const skills = linked.get(i) ?? [];
      const name = this.name(kind, i) || skills.find((skill) => skill.name)?.name || '';
      if (this.namedOnly && !name && !skills.length) continue;
      records.push({ kind, i, name, skills });
    }
    return records.concat(standalone);
  }

  openSkill(i) {
    const effect = this.skillEffect(i);
    this.kind = KINDS.find(({ key }) => key === (effect === null ? 'skill' : 'effect'));
    this.select(effect ?? i, i);
    this.renderList();
    if (this.filter && !this.root.querySelector('#data-list .active')) {
      this.filter = this.root.querySelector('#data-search').value = '';
      this.renderList();
    }
  }

  // ---- pictures --------------------------------------------------------------
  /** Icon or sprite for an entry, as a canvas (null if none). */
  async picture(kind, i, large = false) {
    const t = this.tables[kind] ?? this.ctx.tables()?.tables[kind];
    const row = t.row(i);
    const v = view(row);
    try {
      if (kind === 'class' || kind === 'template') {
        const tables=this.ctx.tables(),look=kind==='class'?tables.classLook(i):tables.templateLook(i);
        if(!look)return null;
        const f=await loadActorFrame(look.actor,tables.palette(look.palette)??undefined);
        return f&&!f.placeholder?rgbaCanvas(f.width,f.height,f.rgba,large?2:0.5):null;
      }
      if (kind === 'armament' || kind === 'commodity') {
        return i ? itemArt(kind, row, this.ctx.lang?.(), large ? 1.5 : 0.5) : null;
      }
      if(kind==='effect'||kind==='skill'){
        return i ? abilityArt(kind, i, this.ctx.tables(), this.ctx.lang?.(), large ? 1.5 : 0.5) : null;
      }
      if (kind === 'shop') { // the item's icon
        const id = v.getUint16(0, true);
        if (!id) return null;
        return id < ITEM_BASE ? this.picture('armament', id, large) : this.picture('commodity', id - ITEM_BASE, large);
      }
    } catch (err) {
      console.warn('picture', kind, i, err);
    }
    return null;
  }

  async femaleSprite(i) {
    const v = view(this.tables.class.row(i));
    const actor = v.getUint16(0x92, true);
    if (!actor || actor === v.getUint16(0x90, true)) return null;
    const look=this.ctx.tables()?.classLook(i,true);
    const f = await loadActorFrame(actor, this.ctx.tables()?.palette(look?.palette??0) ?? undefined);
    return f && !f.placeholder ? rgbaCanvas(f.width, f.height, f.rgba, 2) : null;
  }

  // ---- UI ------------------------------------------------------------------------
  build() {
    this.root.innerHTML = `
      <aside class="sidebar data-side">
        <div class="sidebar-head">
          <div class="tabs">${TABS.filter((k) => (k !== RACES || this.races) && (!k.panel || this.panels?.[k.panel])).map((k) => `<button data-kind="${k.key}">${k.title}</button>`).join('')}</div>
          <input id="data-search" type="search" placeholder="Search by name or #id…">
          <label class="toggle"><input id="data-named" type="checkbox" checked> Named entries only</label>
        </div>
        <div id="data-list" class="data-list"></div>
      </aside>
      <section class="data-detail" id="data-detail"></section>`;
    for (const b of this.root.querySelectorAll('.tabs button')) {
      b.onclick = () => {
        this.kind = TABS.find((k) => k.key === b.dataset.kind);
        this.selected = -1;
        this.selectedSkill = null;
        this.renderList();
        this.select(this.firstNamed());
      };
    }
    this.root.querySelector('#data-search').oninput = (e) => { this.filter = e.target.value; this.renderList(); };
    this.root.querySelector('#data-named').onchange = (e) => { this.namedOnly = e.target.checked; this.renderList(); };
  }

  renderList() {
    this.root.querySelector('.sidebar-head').hidden = this.kind === MODS;
    for (const b of this.root.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.kind === this.tabKey);
    if (this.kind === RACES) { this.renderRaceList(); return; }
    if (this.kind === MODS) { this.mods.renderList(this.root.querySelector('#data-list'), this.selected, (i) => this.select(i)); return; }
    if (this.kind.panel) { this.panels[this.kind.panel].renderList(this.root.querySelector('#data-list'), this.selected, this.filter, (i) => this.select(i)); return; }
    const list = this.root.querySelector('#data-list');
    const q = this.filter.trim().toLowerCase();
    list.innerHTML = '';
    const matches = ({ kind, i, name }) => name.toLowerCase().includes(q) ||
      q === `#${i}` || q === String(i) || q === `${kind} #${i}`;
    for (const record of this.listRecords()) {
      const { kind, i, skills } = record;
      if (q && !matches(record) && !skills.some(matches)) continue;
      const b = document.createElement('button');
      b.className = `data-item${i === this.selected && kind === this.kind.key ? ' active' : ''}`;
      b.dataset.index = String(i);
      b.dataset.recordKind = kind;
      const skill = skills.find((entry) => entry.name === record.name) ?? (skills.length === 1 ? skills[0] : null);
      const matchingSkill = q ? skills.find(matches) : null;
      const name = matchingSkill && !matches(record) ? matchingSkill.name : record.name;
      const label = skill ? `Skill #${skill.i}` : kind === 'skill' ? `Skill #${i}` : `#${i}`;
      b.dataset.iconKind = skill ? 'skill' : kind;
      b.dataset.iconIndex = String(skill ? skill.i : i);
      b.innerHTML = `<span class="thumb"></span><span class="data-name">${this.listName({ ...record, name })}</span><span class="picker-id">${label}</span>`;
      b.onclick = () => {
        this.kind = KINDS.find((entry) => entry.key === kind);
        this.select(i, matchingSkill?.i ?? null);
      };
      list.append(b);
    }
    // thumbnails, lazily as they scroll into view
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const { iconKind: kind, iconIndex } = en.target.dataset;
        const i = Number(iconIndex);
        const key = `${this.ctx.lang?.()??'en-us'}:${kind}:${i}`;
        const slot = en.target.querySelector('.thumb');
        const p = this.thumbs.get(key) ?? this.picture(kind, i, false);
        this.thumbs.set(key, p);
        p.then((c) => { if (c && slot) slot.append(c.cloneNode ? cloneCanvas(c) : c); });
      }
    }, { root: list });
    for (const b of list.children) io.observe(b);
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  listName({ kind, i, name, skills }) {
    const dirty = this.rowChanged(i, kind) || skills.some((skill) => this.rowChanged(skill.i, 'skill'));
    return `${esc(name || '(unnamed)')}${dirty ? ' <span class="dirty">●</span>' : ''}`;
  }

  async select(i, skill = null) {
    this.selected = i;
    this.selectedSkill = skill;
    for (const b of this.root.querySelectorAll('.data-item')) {
      b.classList.toggle('active', Number(b.dataset.index) === i &&
        (!b.dataset.recordKind || b.dataset.recordKind === this.kind.key));
    }
    await this.renderDetail();
  }

  renderRaceList() {
    const list = this.root.querySelector('#data-list');
    const q = this.filter.trim().toLowerCase();
    list.innerHTML = '';
    const sets = this.races.sets;
    const pictures = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const b = entry.target;
        pictures.unobserve(b);
        const set = sets[Number(b.dataset.index)];
        const key = `race:${set.bit}:${set.sprite}`;
        const image = this.thumbs.get(key) ?? this.races.setPicture(set, 0.5);
        this.thumbs.set(key, image);
        image.then((canvas) => { if (canvas && b.isConnected) b.querySelector('.thumb').append(cloneCanvas(canvas)); });
      }
    }, { root: list });
    sets.forEach((set, i) => {
      if (q && !set.label.toLowerCase().includes(q)) return;
      const b = document.createElement('button');
      b.className = `data-item${i === this.selected ? ' active' : ''}`;
      b.dataset.index = String(i);
      const count = this.races.count(set);
      b.innerHTML = `<span class="thumb"></span><span class="data-name">${esc(set.label)}${this.races.setChanged(set) ? ' <span class="dirty">●</span>' : ''}</span><span class="picker-id">${count}</span>`;
      b.title = `${set.label} · ${count} classes`;
      b.onclick = () => this.select(i);
      list.append(b);
      pictures.observe(b);
    });
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  async renderDetail() {
    this.effectViewer?.detach();
    if (this.kind.panel) {
      this.panels[this.kind.panel].renderDetail(this.root.querySelector('#data-detail'), this.selected, () => {
        this.ctx.onChange();
        this.renderList();
        this.renderDetail();
      });
      return;
    }
    if (this.kind === MODS) {
      this.mods.renderDetail(this.root.querySelector('#data-detail'), this.selected, () => {
        this.ctx.onChange();
        this.renderList();
        this.renderDetail();
      });
      return;
    }
    if (this.kind === RACES) {
      const set = this.races.sets[this.selected];
      const detail = this.root.querySelector('#data-detail');
      this.races.renderDetail(detail, set, this.fieldFilter, (f) => { this.fieldFilter = f; }, () => {
        this.ctx.onChange();
        this.renderList();
        this.renderDetail();
      });
      return;
    }
    const i = this.selected;
    const kind = this.kind.key;
    const detail = this.root.querySelector('#data-detail');
    const schema = this.schemas[kind];
    const row = this.row(i);
    const skills = kind === 'effect' ? this.skillRecords().linked.get(i) ?? [] : [];
    const name = this.name(kind, i) || skills.find((skill) => skill.name)?.name || '(unnamed)';
    detail.innerHTML = `
      <div class="data-head${['effect','commodity','armament'].includes(kind) ? ' data-head-effect' : ''}">
        <div class="data-pics"></div>
        <div class="data-entry-info">
          <h1>${esc(name)}</h1>
          <div class="meta">${esc(kind === 'effect' ? 'Effect' : this.kind.title)} #${i} · ${this.table().rowSize}-byte record</div>
          <div class="data-names"></div>
          <div data-custom-icon hidden></div>
          ${KIND_HINTS[kind] ? `<p class="hint">${KIND_HINTS[kind]}</p>` : ''}
          ${kind === 'class' && this.marks && this.marks.mark(i) !== null ? '<div class="data-mark"></div>' : ''}
          <div class="data-actions">
            <input id="field-filter" type="search" placeholder="Find a field…" value="${esc(this.fieldFilter)}">
            <button id="data-revert" class="ghost" ${this.rowChanged(i) && (this.originalRowStart(kind, i) !== null || i === this.table().count - 1) ? '' : 'disabled'}>${this.originalRowStart(kind, i) === null ? 'Remove this new entry' : 'Revert this entry'}</button>
            ${NEW_ENTRY[kind] ? `<button id="data-new" class="ghost" title="${kind === 'armament' ? 'Uses one of the equipment rows the game never uses' : kind === 'class' ? 'Uses one of the class rows the game never uses (no texts, no unit)' : 'Adds a row at the end of the table: not yet tested in game'}">New ${{ armament: 'equipment', class: 'class' }[kind] ?? 'entry'} from this one</button>` : ''}
          </div>
        </div>
      </div>
      ${skills.length ? '<div class="data-linked-skills"></div>' : ''}
      <div class="data-groups"></div>`;
    this.refreshEffectPreview(i,row);
    const pics = detail.querySelector('.data-pics');
    this.picture(kind, i, true).then((c) => c && pics.append(c));
    if (kind === 'class') this.femaleSprite(i).then((c) => c && pics.append(c));
    detail.querySelector('#field-filter').oninput = (e) => { this.fieldFilter = e.target.value; this.renderGroups(detail, schema, row, i); };
    detail.querySelector('#data-revert').onclick = () => {
      const o = this.originalRowStart(kind, i);
      if (o === null) {
        // an added row: drop it and the text changes made for it (unless another entry uses those texts)
        const keys = this.textKeys(kind, i);
        this.dropLastRow(kind);
        const t = this.tables[kind];
        const still = new Set();
        for (let r = 0; r < t.count; r++) { const ks = this.textKeys(kind, r); still.add(ks.name); still.add(ks.help); if (ks.female) still.add(ks.female); }
        for (const k of ['name', 'female', 'help']) if (keys[k] && !still.has(keys[k])) { this.renames.delete(keys[k]); this.newKeys.delete(keys[k]); }
        this.selected = Math.max(0, i - 1);
      } else {
        this.fileDat(kind).pack.set(this.fileOriginal(kind).subarray(o, o + this.table().rowSize), this.rowStart(i));
      }
      this.ctx.onChange();
      if (kind === 'skill') {
        this.openSkill(i);
        return;
      }
      this.renderList();
      this.renderDetail();
    };
    detail.querySelector('#data-new')?.addEventListener('click', () => {
      if (this.ctx.readOnly?.()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
      const to = this.newEntry(kind, i);
      if (to === null) return;
      this.ctx.setStatus(`New ${{ armament: 'equipment', class: 'class' }[kind] ?? 'entry'} #${to}, copied from #${i}: rename it above`);
      this.renderList();
      this.select(to);
    });
    this.renderNames(detail.querySelector('.data-names'), kind, i);
    this.renderCustomIcon(detail.querySelector('[data-custom-icon]'), kind, row);
    const skillBox = detail.querySelector('.data-linked-skills');
    for (const skill of skills) this.renderLinkedSkill(skillBox, skill);
    this.renderMark(detail.querySelector('.data-mark'), i);
    this.renderGroups(detail, schema, row, i);
  }

  renderCustomIcon(host, kind, row) {
    if (!row[2]) return;
    const binding = customIconBinding(kind, row);
    if (!binding) return;
    const { bank, id, bankMatches } = binding;
    const options = this.customIcons.filter(icon => icon.bank === bank).map(icon => ({
      id: icon.id,
      name: icon.label,
      art: async () => {
        const texture = (await loadIconArchive(bank, this.ctx.lang?.())).get(iconName(bank, icon.id));
        return texture && textureCanvas(texture, 0.5);
      },
    }));
    const label = document.createElement('div');
    label.className = 'field';
    label.innerHTML = '<span class="field-label">Custom icon</span>';
    const current = bankMatches && options.some(option => option.id === id) ? id : 0;
    const picker = createPicker({
      options, value: current, emptyLabel: 'Choose an imported icon', allowRaw: false,
      onChange: value => {
        if (this.ctx.readOnly() || !writeCustomIcon(kind, row, bank, Number(value))) return;
        this.ctx.onChange();
        this.renderList();
        this.renderDetail();
      },
    });
    picker.setAttribute('aria-label', 'Custom icon');
    picker.disabled = this.ctx.readOnly() || !options.length;
    label.append(picker);
    if (!options.length) {
      const hint = document.createElement('small');
      hint.className = 'hint';
      hint.textContent = 'Add an icon of this type in Files → Art importer/exporter.';
      label.append(hint);
    }
    host.replaceChildren(label);
    host.hidden = false;
  }

  renderLinkedSkill(box, { i, name }) {
    const section = document.createElement('details');
    section.className = 'group';
    section.open = this.selectedSkill === i;
    section.innerHTML = `<summary><span></span></summary><div class="group-body">
      <div class="data-names"></div><div class="field-grid"></div>
      <div><button class="ghost" type="button" data-skill-revert>Revert skill fields</button></div>
    </div>`;
    const title = section.querySelector('summary span');
    const updateTitle = (label) => { title.textContent = `Skill #${i} · ${label || '(unnamed)'}`; };
    updateTitle(name);
    this.renderNames(section.querySelector('.data-names'), 'skill', i, () => {
      updateTitle(this.name('skill', i));
      this.renderList();
    });
    const fields = section.querySelector('.field-grid');
    const row = this.tables.skill.row(i);
    for (const group of this.schemas.skill.groups) {
      for (const field of group.fields) fields.append(this.fieldControl(row, i, field, 'skill'));
    }
    const revert = section.querySelector('[data-skill-revert]');
    const original = this.originalRowStart('skill', i);
    revert.disabled = this.ctx.readOnly?.() || original === null || !this.rowChanged(i, 'skill');
    revert.onclick = () => {
      row.set(this.original.subarray(original, original + row.length));
      this.ctx.onChange();
      this.openSkill(i);
    };
    box.append(section);
  }

  /** Name and description boxes: they edit the game text itself, not the name ID. */
  renderNames(box, kind, i, onRename) {
    const keys = this.textKeys(kind, i);
    if (!keys || !box) return;
    const sharing = keys.id === null ? 1
      : Array.from({ length: this.tables[kind].count }, (_, r) => r).filter((r) => this.textKeys(kind, r).id === keys.id).length;
    // every text box shows, even where the game has no text yet: typing creates it (all languages, on save)
    const fields = [['name', kind === 'class' ? 'Name (male)' : 'Name'], ['female', 'Name (female)'], ['help', 'Description']]
      .filter(([k]) => keys[k]);
    const mark = (key) => (this.renames.has(key) ? '<span class="changed">●</span>' : '');
    box.innerHTML = fields.map(([k, label]) => `<label class="field${k === 'help' ? ' wide' : ''}"><span class="field-label">${label}${mark(keys[k])}</span>${
      k === 'help' ? `<textarea data-key="${esc(keys[k])}" rows="2" placeholder="(no text yet)">${esc(this.editText(keys[k]) ?? '')}</textarea>` : `<input data-key="${esc(keys[k])}" value="${esc(this.editText(keys[k]) ?? '')}" placeholder="(no text yet)">`
    }</label>`).join('')
      + `<p class="hint">Edits the game text <code>${esc(keys.name.replace(/_(MALE|NAME)$/, ''))}</code>${sharing > 1 ? ` · shared by ${sharing} entries (they all change)` : ''} ·
        <label class="inline"><input type="checkbox" class="all-langs" ${this.allLanguages ? 'checked' : ''}> same text in every language</label>
        ${sharing > 1 && NAME_IDS[kind] ? `<button class="ghost own-name" ${this.freeNameId(kind) ? '' : 'disabled title="Every name ID of this kind is in use"'}>Give this entry its own name</button>` : ''}</p>`;
    for (const el of box.querySelectorAll('[data-key]')) {
      el.onchange = () => {
        if (this.ctx.readOnly?.()) {
          this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true);
          el.value = this.editText(el.dataset.key) ?? '';
          return;
        }
        if (!this.localize.has(el.dataset.key)) this.newKeys.add(el.dataset.key);
        this.rename(el.dataset.key, el.value);
        if (onRename) onRename();
        else {
          this.refreshListItem(i);
          const h1 = this.root.querySelector('#data-detail h1');
          if (h1) h1.textContent = this.name(kind, i) || '(unnamed)';
        }
        this.renderNames(box, kind, i, onRename);
      };
    }
    box.querySelector('.all-langs').onchange = (e) => {
      this.allLanguages = e.target.checked;
      for (const control of this.root.querySelectorAll('#data-detail .all-langs')) control.checked = this.allLanguages;
    };
    const own = box.querySelector('.own-name');
    if (own) {
      own.onclick = () => {
        if (this.ctx.readOnly?.()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
        this.giveOwnName(kind, i);
      };
    }
  }

  /** A class's mark: the item the class-change screen asks for (menu data, classes 0-79). */
  renderMark(box, c) {
    if (!box) return;
    const marks = this.marks;
    const cur = marks.mark(c);
    if (marks.integrated(c) !== undefined) {
      const name = cur ? this.name('commodity',cur-ITEM_BASE) || `Item #${cur}` : 'No class mark';
      box.innerHTML = `<p class="hint">Class mark from Special Class Change · ${esc(name)}</p>`;
      return;
    }
    const items = marks.markItems();
    const known = !cur || items.some((m) => m.id === cur);
    const changed = cur !== marks.originalMark(c) ? '<span class="changed">●</span>' : '';
    box.innerHTML = `<label class="field"><span class="field-label">Class mark${changed}</span>
        <select class="mark-pick">
          <option value="0" ${cur ? '' : 'selected'}>None</option>
          ${items.map((m) => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${esc(m.name)} (#${m.row})${marks.classesFor(m.id).filter((k) => k !== c).length ? ' · also ' + marks.classesFor(m.id).filter((k) => k !== c).map((k) => esc(this.name('class', k) || `#${k}`)).join(', ') : ''}</option>`).join('')}
          ${known ? '' : `<option value="${cur}" selected>Item ${cur}</option>`}
        </select></label>
      ${cur ? '' : '<button class="ghost make-mark">Make a class mark</button>'}
      <p class="hint">The item the class-change screen asks for. A class with no mark can't be chosen with one.</p>`;
    const guard = () => {
      if (!this.ctx.readOnly?.()) return true;
      this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true);
      return false;
    };
    box.querySelector('.mark-pick').onchange = (e) => {
      if (!guard()) { e.target.value = String(cur); return; }
      marks.setMark(c, Number(e.target.value));
      this.renderMark(box, c);
    };
    box.querySelector('.make-mark')?.addEventListener('click', () => {
      if (!guard()) return;
      const id = marks.makeMark(c);
      if (id === null) return;
      this.ctx.setStatus(`New class mark: item #${id - ITEM_BASE} "${this.editText(this.textKeys('commodity', id - ITEM_BASE).name)}", for ${this.name('class', c)}`);
      this.renderMark(box, c);
    });
  }

  renderGroups(detail, schema, row, i) {
    const box = detail.querySelector('.data-groups');
    box.innerHTML = '';
    const q = this.fieldFilter.trim().toLowerCase();
    for (const g of schema.groups) {
      const matching = g.fields.filter((f) => !q || f.label.toLowerCase().includes(q) || f.key.includes(q));
      // Settings > Hide unknown values (on by default)
      const fields = settings.hideUnknown ? matching.filter((f) => !isUnknownField(f.label)) : matching;
      if (!fields.length) continue;
      const hidden = matching.length - fields.length;
      const sec = document.createElement('details');
      sec.className = 'group';
      sec.open = true;
      sec.innerHTML = `<summary>${esc(g.label)} <span class="muted">${fields.length}${hidden ? ` · ${hidden} unknown hidden` : ''}</span></summary><div class="group-body field-grid"></div>`;
      const body = sec.querySelector('.field-grid');
      for (const f of fields) body.append(this.fieldControl(row, i, f));
      box.append(sec);
    }
  }

  refreshEffectPreview(i,row){
    const kind=this.kind.key;if(!['effect','commodity','armament'].includes(kind))return;
    const host=this.root.querySelector('#data-detail .data-head');if(!host)return;
    this.effectViewer??=new EffectViewer();this.effectViewer.attach(host);
    if(kind==='effect'){this.effectViewer.select(i,row);return;}
    const id=view(row).getUint16(kind==='commodity'?0x04:0x44,true),effects=this.tables.effect;
    if(kind==='armament'&&(row[2]>=1&&row[2]<=22||row[2]===30||row[2]===31)){this.effectViewer.selectEquipment(i,row,id,id>0&&id<effects.count?effects.row(id):null);return;}
    if(!id)this.effectViewer.clear('No item use effect');
    else if(id>=effects.count)this.effectViewer.clear(`Use effect #${id} is outside the ability table`);
    else this.effectViewer.select(id,effects.row(id));
  }

  itemOptions({ books = false } = {}) {
    const tables = this.ctx.tables();
    const options = books ? tables.lists.recipeBook : tables.lists.item;
    return options.map(o => o.id ? { ...o, art: () => o.id < ITEM_BASE
      ? this.picture('armament', o.id, false) : this.picture('commodity', o.id - ITEM_BASE, false) } : o);
  }

  async classMenuArtOptions(field) {
    const labels = new Map(field.options);
    for (const [klass, icon] of Object.entries(this.menuMods?.saved?.specialClassMenuIcons ?? {})) {
      const name = this.name('class', Number(klass));
      if (name && !labels.has(icon)) labels.set(icon, name);
    }
    const icons = await loadIconArchive('com_class');
    const options = [{ id: 255, name: 'None' }];
    for (const [name, texture] of icons) {
      const match = /^com_class00_unit(\d{4})_00$/.exec(name);
      if (!match || Number(match[1]) >= 255) continue;
      const id = Number(match[1]);
      options.push({ id, name: labels.get(id) || `Class menu art ${id}`, art: () => textureCanvas(texture, 0.5) });
    }
    return options;
  }

  fieldControl(row, i, f, kind = this.kind.key) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.title = dataFieldHelp(kind, f);
    const value = this.read(row, f);
    const changed = this.fieldChanged(i, f, kind) ? '<span class="changed">●</span>' : '';
    wrap.innerHTML = `<span class="field-label">${esc(f.label)}${changed}</span>`;
    let control;
    const commit = (val) => {
      if (this.write(row, f, val)) {
        this.ctx.onChange();
        if (kind === 'skill' && f.ref === 'effect') {
          this.openSkill(i);
          return;
        }
        const label = wrap.querySelector('.field-label');
        if (this.fieldChanged(i, f, kind) && !label.querySelector('.changed')) label.insertAdjacentHTML('beforeend', '<span class="changed">●</span>');
        this.refreshListItem(i);
        if(['effect','commodity','armament'].includes(kind))this.refreshEffectPreview(i,row);
        if (f.ref?.startsWith('name') || /icon|sprite|palette/.test(f.key)) this.renderDetail();
      } else {
        control.value = this.read(row, f);
      }
    };
    const isRecipe = ['crafting_recipe', 'crafting_recipe_obtained'].includes(f.key);
    const isInventory = isRecipe || f.key.startsWith('craft_ingriedient_') || f.key === 'reagent' || kind === 'shop' && f.key === 'item';
    if (f.type === 'enum' && isInventory) {
      control = createPicker({ options: this.itemOptions({ books: isRecipe }), value, onChange: commit, allowRaw: false });
    } else if (f.ref === 'effect' || f.ref === 'skill') {
      const ref = f.ref;
      const options = this.ctx.tables().lists[ref].map(option => option.id ? {
        ...option, art: () => this.picture(ref, option.id, false),
      } : option);
      control = createPicker({ options, value, onChange: commit });
      control.disabled = this.ctx.readOnly();
    } else if (f.type === 'enum' && kind === 'shop' && f.key === 'character_recruited') {
      control = createPicker({ options: this.ctx.tables().lists.unitName, value, onChange: commit, allowRaw: false });
    } else if (f.type === 'enum' && kind === 'class' && f.offset >= 0x98 && f.offset <= 0xa4) {
      const options = f.options.map(([id, name]) => ({ id, name }));
      control = createPicker({ options, value, onChange: commit, allowRaw: false, beforeOpen: () => this.classMenuArtOptions(f) });
    } else if (f.type === 'enum') {
      control = document.createElement('select');
      const options = projectArtOptions(kind, f, this.ctx.tables()?.customCharacters);
      const known = options.some(([v]) => v === value);
      control.innerHTML = options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')
        + (known ? '' : `<option value="${value}" selected>Unknown (${value})</option>`);
      control.onchange = () => commit(control.value);
    } else {
      control = document.createElement('input');
      control.value = value;
      if (f.type !== 'bytes') control.type = 'number';
      control.onchange = () => commit(control.value);
    }
    attachHelp(control, wrap.title);
    wrap.append(control);
    if (f.ref) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = this.refLabel(f.ref, value);
      wrap.append(hint);
    }
    return wrap;
  }

  refLabel(ref, id) {
    const t = this.ctx.tables();
    if (!t || id === 0) return '';
    const text = (key) => t.text(key) || '—';
    switch (ref) {
      case 'class': return t.className(id) || '—';
      case 'arms': return t.armsName(id) || '—';
      case 'item': return t.itemName(id) || '—';
      case 'skill': return t.skillName(id) || '—';
      case 'effect': return t.effectName(id) || '—';
      case 'nameClass': return text(`CLASS_TEXT_DATA_CLASS${pad(id, 4)}_MALE`);
      case 'nameArms': return text(`ARMSTEXT_LC_ARMS_${pad(id, 3)}_NAME`);
      case 'nameCommodity': return text(`COMMODITYTEXT_LC_COMMODITY_${pad(id, 3)}_NAME`);
      case 'nameEffect': return text(`EFFECTTEXT_LC_EFFECT_${pad(id, 3)}_NAME`);
      case 'nameSkill': return text(`SKILLTEXT_LC_SKILL_${pad(id, 3)}_NAME`);
      case 'shopFlag': { // the shop items that wait for the same flag
        const s = this.tables.shop, names = [];
        for (let r = 0; r < s.count; r++) {
          const v = view(s.row(r));
          if ([6, 8, 10].some((o) => v.getUint16(o, true) === id)) names.push(this.name('shop', r));
        }
        return names.length ? `Waited for by: ${names.join(', ')}` : 'No shop item waits for this flag yet';
      }
      default: return '';
    }
  }

  refreshListItem(i) {
    const kind = this.kind.key;
    const b = this.root.querySelector(`.data-item[data-record-kind="${kind}"][data-index="${i}"] .data-name`);
    const skills = kind === 'effect' ? this.skillRecords().linked.get(i) ?? [] : [];
    const name = this.name(kind, i) || skills.find((skill) => skill.name)?.name || '';
    if (b) b.innerHTML = this.listName({ kind, i, name, skills });
    const rev = this.root.querySelector('#data-revert');
    if (rev) rev.disabled = !this.rowChanged(i);
  }

  /** Text files with the pending renames applied: this language, or all of them. */
  async renamedTextFiles() {
    if (!this.renames.size) return [];
    // texts that don't exist yet go into every language, so none is missing them
    const adding = [...this.renames.keys()].some((k) => this.newKeys.has(k));
    const langs = this.allLanguages || adding ? LANGUAGES : [this.localize.lang];
    const files = [];
    for (const lang of langs) {
      const file = lang === this.localize.lang ? this.localize : await LocalizeFile.load(lang);
      const everywhere = this.allLanguages || lang === this.localize.lang;
      for (const [key, text] of this.renames) {
        const bytes = file.get(key);
        if (bytes) {
          if (everywhere) file.set(key, encodeFromEdit(text, decodeForEdit(bytes).info));
          continue;
        }
        if (!this.newKeys.has(key)) continue; // a text this language doesn't have
        // control codes as a sibling text has them (e.g. ARMSTEXT_LC_ARMS_001_NAME for a name)
        const [, prefix, suffix] = /^(.*?)\d+(_[A-Z]+)$/.exec(key) ?? [null, key, ''];
        const sibling = [...file.index.keys()].find((k) => k.startsWith(prefix) && k.endsWith(suffix) && file.get(k)?.length);
        const info = sibling ? decodeForEdit(file.get(sibling)).info : { lead: false, words: false, wordArgs: [1, 1], newline: 0 };
        file.add(key, encodeFromEdit(text, info), prefix);
      }
      files.push(file);
    }
    return files;
  }

  async save() {
    this.lastSavedGroupSettings = false;
    this.lastSavedMenuSettings = false;
    this.refreshIntegratedContent = false;
    const files = [];
    let bytes = null;
    if (this.battleChanged()) {
      bytes = await encodeDat(this.dat.pack, this.dat.entryName);
      files.push({ path: PATH, bytes, originalSize: this.dat.originalSize, dat:this.dat });
    }
    const texts = await this.renamedTextFiles();
    for (const f of texts) files.push({ path: f.path, bytes: await f.encode(), originalSize: f.dat.originalSize, dat:f.dat });
    let menuBytes = null;
    if (this.menuChanged()) { // class marks and shops
      menuBytes = await encodeDat(this.menu.pack, this.menu.entryName);
      files.push({ path: MENU_PATH, bytes: menuBytes, originalSize: this.menu.originalSize, dat:this.menu });
    }
    const changes = [];
    for (const [path, { dat, original }] of this.entryEdits) {
      const b = await encodeDat(dat.pack, dat.entryName);
      files.push({ path, bytes: b, originalSize: dat.originalSize, dat });
      const file = Number(/_(\d+)\.dat$/i.exec(path)?.[1]);
      const oldTable = parsePakd(original).entries[0].data, newTable = parsePakd(dat.pack).entries[0].data;
      if (Number.isInteger(file) && differs(oldTable, newTable)) changes.push({ file, oldTable, newTable });
    }
    // scene files carry copies of battle files for joins (unitcopies.js): keep them in step
    const copies = changes.length ? await syncCopies(changes, { onProgress: (t) => this.ctx.setStatus(t) }) : { files: [] };
    files.push(...copies.files);
    const warrenFile = await this.warrenRules?.saveFile();
    if (warrenFile) files.push(warrenFile);
    const pspArt = this.pspSpells?.saveFiles() ?? [];
    files.push(...pspArt);
    const saved = await saveDataFiles(files);
    this.pspSpells?.saved();
    this.warrenRules?.saved(warrenFile);
    this.lastSavedGroupSettings = await this.restrictionGroups?.save() ?? false;
    const contentChanged = !!(this.menuMods?.info.integratedContentVersion && this.menuMods?.contentChanged);
    this.lastSavedMenuSettings = await this.menuMods?.save() ?? false;
    this.refreshIntegratedContent = !!pspArt.length || contentChanged && this.lastSavedMenuSettings;
    const savedSizes = new Map(files.map(f => [f.path, f.savedSize ?? f.bytes.length]));
    if (menuBytes) {
      this.menu.originalSize = savedSizes.get(MENU_PATH);
      this.marks?.saved();
    }
    for (const [path, { dat }] of this.entryEdits) dat.originalSize = savedSizes.get(path);
    this.entryEdits.clear();
    if (bytes) this.dat.originalSize = savedSizes.get(PATH);
    this.keepOriginal();
    if (texts.length) {
      this.renames.clear();
      this.newKeys.clear();
      this.localize = await LocalizeFile.load(this.localize.lang); // fresh sizes and texts
    }
    this.renderList();
    this.renderDetail();
    return saved;
  }
}

function differs(a, b) {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

function cloneCanvas(c) {
  const n = document.createElement('canvas');
  n.width = c.width;
  n.height = c.height;
  n.getContext('2d').drawImage(c, 0, 0);
  n.style.cssText = c.style.cssText;
  return n;
}

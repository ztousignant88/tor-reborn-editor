// Races tab: which classes each race (and each unique character) may change to.
//   class row +0x88       u64 class-set mask: bit n = set n may use this class
//                         (set names: the class schema's "Class Set Reference" list)
//   class row +0x98..0xA4 class-list icon per race (com_class00_unit<icon:04>), 255 = none.
//                         Columns: human male, human female, then races 2..12.
//   unit template (battle data entry 23, 84-byte rows)
//                         +0x03 gender, +0x38 the unit's class set, +0x39 race,
//                         +0x3A sprite override (non-human races keep their own look)
// In the stock data the icon is set exactly where a race may use the class, so
// enabling a class for a race also gives it an icon, and disabling puts the
// original byte back.

import { isXlce, parseXlce, view } from '../lib/pakd.js';
import { loadIconArchive } from '../game/icons.js';
import { loadActorFrame } from '../game/unitsprites.js';
import { rgbaCanvas, textureCanvas } from '../ui/texcanvas.js';
import { attachHelp } from './fieldhelp.js';
import { createPicker } from '../ui/picker.js';

const MASK = 0x88;
const ICON_HUMAN_MALE = 0x98;
const ICON_HUMAN_FEMALE = 0x99;
const SORT = 0xA8;
const TEMPLATE_ENTRY = 23;
const TEMPLATE_ROW = 84;
const NO_ICON = 255;
const ROGUE = 12;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, w) => String(n).padStart(w, '0');

export class RaceRules {
  constructor(ed) {
    this.ed = ed; // DataEditor: tables.class, dat, original, schemas.class, name()
    const e = ed.dat.pakd.entries[TEMPLATE_ENTRY];
    if (!e || !isXlce(e.data) || parseXlce(e.data).rowSize !== TEMPLATE_ROW) throw new Error('unit template table not found where expected');
    const t = parseXlce(e.data);
    this.templates = Array.from({ length: t.count }, (_, i) => t.row(i));
    this.specialIcons = ed.menuMods?.saved?.specialClassMenuIcons ?? {};
    this.autoIcons = new Set();
  }

  /** Class sets from the schema's labels ("byte3 01 = Denam Morne" -> bit 16), with their units. */
  get sets() {
    const field = this.ed.schemas.class.groups.flatMap((g) => g.fields).find((f) => f.label === 'Class Set Reference');
    const mods = this.ed.menuMods;
    const builtins = mods?.saved?.builtinClassGroups ?? [];
    const assigned = new Set(builtins.flatMap((group) => group.templates));
    const community = new Set(mods?.communityGroups?.flatMap((group) => group.templates) ?? []);
    const sets = [];
    for (const [, label] of field?.options ?? []) {
      const m = /^byte(\d) ([0-9A-F]{2}) = (.+)$/i.exec(label);
      if (!m || /^</.test(m[3])) continue;
      const bit = (Number(m[1]) - 1) * 8 + Math.log2(parseInt(m[2], 16));
      const original = this.templates.flatMap((r, i) => r[0x38] === bit ? [i] : []);
      const members = original.filter((i) => !assigned.has(i) && !community.has(i));
      if (bit >= 16 && original.length && !members.length) continue;
      sets.push(this.makeSet(bit, m[3], members));
    }
    for (const group of builtins) {
      sets.push(this.makeSet(group.id, group.label, group.templates.filter((i) => !community.has(i)), group));
    }
    return sets;
  }

  makeSet(bit, label, members, builtin = null) {
    const units = members.map((i) => this.templates[i]).filter(Boolean);
    const races = units.map((r) => r[0x39]);
    return {
      bit, label, members, builtin, units: units.length,
      race: builtin?.menuRace ?? (races.length ? mostCommon(races) : bit >= 2 && bit <= 12 ? bit : 1),
      genders: new Set(units.map((r) => r[3])),
      ownSprite: units.length > 0 && units.every((r) => view(r).getUint16(0x3A, true)),
      sprite: builtin?.actor || units.map((r) => view(r).getUint16(0x3A, true)).find(Boolean) || 0,
    };
  }

  /** Icon byte offsets used by a set's units. */
  columns(set) {
    if (set.race >= 2 && set.race <= 12) return [ICON_HUMAN_MALE + set.race];
    if (set.race !== 1) return [];
    const cols = [];
    if (!set.genders.size || set.genders.has(0)) cols.push(ICON_HUMAN_MALE);
    if (!set.genders.size || set.genders.has(1)) cols.push(ICON_HUMAN_FEMALE);
    return cols;
  }

  classRow(c) { return this.ed.tables.class.row(c); }
  originalByte(c, offset) { return this.ed.original[this.ed.originalRowStart('class', c) + offset]; }
  mask(c) { return view(this.classRow(c)).getBigUint64(MASK, true); }
  originalMask(c) { return view(this.ed.original).getBigUint64(this.ed.originalRowStart('class', c) + MASK, true); }

  nativeOn(c, bit) { return Boolean((this.mask(c) >> BigInt(bit)) & 1n); }

  builtinDefault(c, set) {
    if (c === ROGUE && this.ed.menuMods.value.rougesReborn) {
      return set.members.some((i) => this.nativeOn(c, this.templates[i][0x38]));
    }
    return set.builtin.classes.includes(c);
  }

  isOn(c, set) {
    if (!set.builtin) return this.nativeOn(c, set.bit);
    return this.ed.menuMods.builtinClassGroupOverrides[set.bit]?.[c] ?? this.builtinDefault(c, set);
  }

  wasOn(c, set) {
    if (!set.builtin) return Boolean((this.originalMask(c) >> BigInt(set.bit)) & 1n);
    return this.ed.menuMods.savedBuiltinClassGroupOverrides[set.bit]?.[c] ?? this.builtinDefault(c, set);
  }

  /** Named classes (row 0 is "nothing"). */
  classes(set = null) {
    const out = [];
    for (let c = 1; c < this.ed.tables.class.count; c++) {
      const name = this.ed.name('class', c);
      if (!name) continue;
      if (set?.builtin && (c === 77 || !this.classRow(c)[0x55] || (c >= 81 && c <= 96) ||
          (c >= 80 && this.specialIcons[c] === undefined))) continue;
      out.push({ c, name, sort: this.classRow(c)[SORT] });
    }
    return out;
  }

  count(set) { return this.classes(set).filter(({ c }) => this.isOn(c, set)).length; }
  setChanged(set) { return this.classes(set).some(({ c }) => this.classChanged(c, set)); }

  classChanged(c, set) {
    return this.isOn(c, set) !== this.wasOn(c, set) || this.iconColumns(c, set)
      .some((col) => this.classRow(c)[col] !== this.originalByte(c, col));
  }

  /** Icon a set uses for class c (255 = none). */
  iconColumns(c, set) {
    if (c >= 80 || this.classRow(c)[0x58] || this.specialIcons[c] !== undefined) return [];
    return this.columns(set);
  }

  icon(c, set) {
    return this.specialIcons[c] ?? this.classRow(c)[this.classRow(c)[0x58] ? ICON_HUMAN_MALE : this.columns(set)[0]] ?? NO_ICON;
  }

  /** The icon this race shows for most of its classes (its look in the class list). */
  defaultIcon(col, set, c) {
    const used = this.classes(set).filter(({ c: k }) => k !== c && this.isOn(k, set)).map(({ c: k }) => this.classRow(k)[col]).filter((v) => v !== NO_ICON);
    if (used.length) return mostCommon(used);
    const own = this.classRow(c)[ICON_HUMAN_MALE];
    return own !== NO_ICON ? own : NO_ICON;
  }

  setOn(c, set, on) {
    const row = this.classRow(c);
    if (set.builtin) {
      const overrides = this.ed.menuMods.builtinClassGroupOverrides;
      const choices = overrides[set.bit] ?? {};
      if (on === this.builtinDefault(c, set)) delete choices[c];
      else choices[c] = on;
      if (Object.keys(choices).length) overrides[set.bit] = choices;
      else delete overrides[set.bit];
    } else {
      const bit = 1n << BigInt(set.bit);
      view(row).setBigUint64(MASK, on ? this.mask(c) | bit : this.mask(c) & ~bit, true);
    }
    for (const col of this.iconColumns(c, set)) {
      const key = `${c}:${col}`;
      if (on && row[col] === NO_ICON) {
        row[col] = this.defaultIcon(col, set, c);
        this.autoIcons.add(key);
      } else if (!on && this.autoIcons.has(key) && this.originalByte(c, col) === NO_ICON &&
          !this.sets.some((other) => this.isOn(c, other) && this.iconColumns(c, other).includes(col))) {
        row[col] = NO_ICON;
        this.autoIcons.delete(key);
      }
    }
  }

  revert(set) {
    for (const { c } of this.classes(set)) {
      if (this.isOn(c, set) !== this.wasOn(c, set)) this.setOn(c, set, this.wasOn(c, set));
      for (const col of this.iconColumns(c, set)) {
        this.classRow(c)[col] = this.originalByte(c, col);
        this.autoIcons.delete(`${c}:${col}`);
      }
    }
  }

  // ---- pictures ------------------------------------------------------------
  async iconCanvas(icon, scale) {
    if (icon === NO_ICON) return null;
    const tex = (await loadIconArchive('com_class')).get(`com_class00_unit${pad(icon, 4)}_00`);
    return tex ? textureCanvas(tex, scale) : null;
  }

  async menuArtOptions(col) {
    const names = new Map();
    for (const { c, name } of this.classes()) {
      const id = this.classRow(c)[col];
      if (!names.has(id)) names.set(id, new Set());
      names.get(id).add(name);
    }
    const archive = await loadIconArchive('com_class');
    const options = [];
    for (const name of archive.keys()) {
      const match = /^com_class00_unit(\d{4})_00$/.exec(name);
      if (!match || Number(match[1]) >= NO_ICON) continue;
      const id = Number(match[1]);
      options.push({ id, name: [...(names.get(id) ?? [])].join(' / ') || `Class art ${id}`,
                     art: () => this.iconCanvas(id, 0.5) });
    }
    return options.sort((a, b) => Number(!names.has(a.id)) - Number(!names.has(b.id)) || a.name.localeCompare(b.name));
  }

  async setPicture(set, scale) {
    let actor = set.sprite;
    if (!actor) {
      const first = this.classes(set).filter(({ c }) => this.isOn(c, set)).sort((a, b) => a.sort - b.sort)[0];
      actor = first ? view(this.classRow(first.c)).getUint16(0x90, true) : 0;
    }
    if (!actor) return null;
    const f = await loadActorFrame(actor, this.ed.ctx.tables()?.palette(0) ?? undefined);
    return f && !f.placeholder ? rgbaCanvas(f.width, f.height, f.rgba, scale) : null;
  }

  // ---- UI --------------------------------------------------------------------
  renderDetail(detail, set, filter, onFilter, onChange) {
    const n = this.count(set);
    const look = set.ownSprite
      ? 'Units of this race keep their own sprite whatever their class.'
      : 'Units take each class’s own sprite, so a class made for another race shows that race’s look.';
    detail.innerHTML = `
      <div class="data-head">
        <div class="data-pics"></div>
        <div>
          <h1>${esc(set.label)}</h1>
          <div class="meta">${set.builtin ? 'Special class-change group' : 'Class set'} ${set.bit} · ${n} class${n === 1 ? '' : 'es'} available · ${set.units} unit template${set.units === 1 ? '' : 's'}</div>
          <div class="meta">${esc(look)}</div>
          <p class="hint">Menu art is shared by units of the same race. It changes the class-change picture. Classes with dedicated art use their own picture.</p>
          <div class="data-actions">
            <input id="field-filter" type="search" placeholder="Find a class…" value="${esc(filter)}">
            <button id="data-revert" class="ghost" ${this.setChanged(set) && !this.ed.ctx.readOnly() ? '' : 'disabled'}>Revert class rules</button>
          </div>
        </div>
      </div>
      <div class="race-classes"></div>`;
    this.setPicture(set, 2).then((cv) => cv && detail.querySelector('.data-pics')?.append(cv));
    detail.querySelector('#field-filter').oninput = (e) => { onFilter(e.target.value); this.renderClasses(detail, set, e.target.value, onChange); };
    detail.querySelector('#data-revert').onclick = () => { this.revert(set); onChange(); };
    this.renderClasses(detail, set, filter, onChange);
  }

  renderClasses(detail, set, filter, onChange) {
    const box = detail.querySelector('.race-classes');
    const q = filter.trim().toLowerCase();
    const all = this.classes(set).filter(({ name }) => !q || name.toLowerCase().includes(q));
    const on = all.filter(({ c }) => this.isOn(c, set)).sort((a, b) => a.sort - b.sort || a.c - b.c);
    const off = all.filter(({ c }) => !this.isOn(c, set)).sort((a, b) => a.name.localeCompare(b.name));
    const readOnly = this.ed.ctx.readOnly();
    box.innerHTML = '';
    for (const [title, list] of [[`Available (${on.length})`, on], [`Not available (${off.length})`, off]]) {
      const h = document.createElement('h3');
      h.className = 'race-group';
      h.textContent = title;
      box.append(h);
      const grid = document.createElement('div');
      grid.className = 'race-grid';
      for (const { c, name } of list) {
        const card = document.createElement('div');
        const allowed = this.isOn(c, set);
        const changed = this.classChanged(c, set);
        card.className = `race-class${changed ? ' edited' : ''}`;
        card.title = `Allows members of ${set.label} to change to ${name} (class #${c}). Class marks and story requirements still apply. The destination class supplies its stats and ability lists; a personal sprite override can keep the character’s appearance.${changed ? ' Changed from the loaded rules.' : ''}`;
        card.innerHTML = `<span class="race-icon"></span><label class="race-name" for="race-allowed-${c}">${esc(name)}</label><input id="race-allowed-${c}" type="checkbox" ${allowed ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>`;
        attachHelp(card.querySelector('input'), card.title);
        card.querySelector('input').onchange = (e) => {
          if (this.ed.ctx.readOnly()) { e.target.checked = !e.target.checked; this.ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
          this.setOn(c, set, e.target.checked);
          onChange();
        };
        const slot = card.querySelector('.race-icon');
        const icon = this.icon(c, set);
        (icon !== NO_ICON ? this.iconCanvas(icon, 0.5) : this.ed.picture('class', c, false)).then((cv) => cv && slot.append(cv));
        const columns = allowed ? this.iconColumns(c, set) : [];
        if (columns.length) {
          const art = document.createElement('div');
          art.className = 'race-art';
          for (const col of columns) {
            const label = columns.length === 1 ? 'Menu art' : col === ICON_HUMAN_MALE ? 'Male menu art' : 'Female menu art';
            const value = this.classRow(c)[col];
            const picker = createPicker({ options: [{ id: value, name: label }], value, allowRaw: false,
              beforeOpen: () => this.menuArtOptions(col),
              onChange: (id) => { this.classRow(c)[col] = id; this.autoIcons.delete(`${c}:${col}`); onChange(); },
            });
            picker.disabled = readOnly;
            picker.setAttribute('aria-label', `${name} ${label.toLowerCase()}`);
            art.append(picker);
          }
          card.append(art);
        }
        grid.append(card);
      }
      box.append(grid);
    }
  }
}

function mostCommon(values) {
  const n = new Map();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0][0];
}

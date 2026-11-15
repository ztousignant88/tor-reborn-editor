// Spell sets and skill sets (Classes & items). Each class names one spell set
// (class +0x51) and one skill set (+0x53): column numbers in two usability
// tables of battle_data_release.dat, a byte per set:
//   spells: entry 51, a row per spell group (a spell's +0x90 names its row),
//           64 bytes: 0 or 0xFF = unavailable, n = auto-loadout level threshold;
//   skills: entry 25 (the skill table itself), bytes 0x10-0x4F: 0xFF = can't
//           use, 0 = may use if known, n = learns at level n.
// 31 spell sets and 59 skill sets are named (tactics-ogre-tool); the rest are
// unused columns, so a new set is a copy of one into a free column.

import { isXlce, parseXlce, view } from '../lib/pakd.js';
import { attachHelp } from './fieldhelp.js';
import { isSpell } from '../game/tables.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NONE = 0xFF;
const SETS = 64;
const SPEC = {
  effect: { entry: 51, rowSize: 64, column: 0, classField: 0x51, title: 'Spell set', what: 'spells', level: 'Auto-loadout level' },
  skill: { entry: 25, rowSize: 102, column: 0x10, classField: 0x53, title: 'Skill set', what: 'skills', level: 'Learns at level' },
};

export class SetEditor {
  constructor(ed, which) {
    this.ed = ed; // DataEditor
    this.which = which;
    this.spec = SPEC[which];
    const e = ed.dat.pakd.entries[this.spec.entry];
    if (!e || !isXlce(e.data)) throw new Error(`${which} sets: table not found where expected`);
    this.table = parseXlce(e.data);
    if (![this.spec.rowSize, this.spec.rowSize + SETS].includes(this.table.rowSize)) {
      throw new Error(`${which} sets: unsupported table width`);
    }
    this.labels = ed.setNames?.[which] ?? [];
    this.filterText = '';
    this.usableOnly = false;
    this.rowNames = this.readRowNames();
    this.installedExpanded = this.table.rowSize !== this.spec.rowSize ? this.readInstalledSets() : null;
  }

  get expanded() {
    return this.installedExpanded ?? this.ed.menuMods?.[this.expandedKey] ?? [];
  }

  get expandedKey() { return this.which === 'effect' ? 'spellSets' : 'skillSets'; }

  get expandedSlots() {
    return this.ed.menuMods?.saved?.[this.which === 'effect' ? 'spellSetSlots' : 'skillSetSlots'];
  }

  get expandedEnabled() {
    const mods = this.ed.menuMods;
    return !this.installedExpanded && !!(mods?.info.project && mods.value.modPreparation && this.expandedSlots);
  }

  readInstalledSets() {
    const result = [];
    const classes = this.ed.tables.class;
    for (let i = 0; i < SETS; i++) {
      const id = SETS + i, column = this.spec.rowSize + i;
      const assigned = [];
      for (let c = 1; c < classes.count; c++) {
        if (classes.row(c)[this.spec.classField] === column - this.spec.column) assigned.push(c);
      }
      const levels = Array.from({length: this.table.count}, (_, r) => this.table.row(r)[column]);
      if (assigned.length || levels.some(v => v !== NONE)) {
        result.push({id, name: `${this.spec.title} ${id}`, classes: assigned, levels});
      }
    }
    return result;
  }

  expandedSet(id) { return this.expanded.find(row => row.id === id); }

  hasSet(id) { return Number.isInteger(id) && id >= 0 && (id < SETS || !!this.expandedSet(id)); }

  groupFor(c) {
    const custom = (this.installedExpanded || this.expandedEnabled) && this.expanded.find(row => row.classes.includes(c));
    return custom ? custom.id : this.ed.tables.class.row(c)[this.spec.classField];
  }

  assign(c, s) {
    const custom = this.expandedSet(s);
    if (this.installedExpanded || this.ed.ctx.readOnly?.() || !this.hasSet(s) || !Number.isInteger(c) || c < 0 ||
        c >= this.ed.tables.class.count || (custom && (!this.expandedEnabled || c === 0))) return false;
    if (this.expandedEnabled) {
      for (const row of this.expanded) row.classes = row.classes.filter(id => id !== c);
    }
    if (custom) {
      custom.classes.push(c);
      custom.classes.sort((a, b) => a - b);
    } else {
      this.ed.tables.class.row(c)[this.spec.classField] = s;
    }
    return true;
  }

  nextExpanded() {
    if (!this.expandedEnabled) return null;
    const {first, limit} = this.expandedSlots;
    for (let id = first; id < limit; id++) if (!this.expandedSet(id)) return id;
    return null;
  }

  copyExpanded(source) {
    const id = this.nextExpanded();
    if (id === null || this.ed.ctx.readOnly?.()) return null;
    this.expanded.push({id, name: `${this.spec.title} ${id}`, classes: [],
      levels: Array.from({length: this.table.count}, (_, r) => this.value(r, source))});
    this.expanded.sort((a, b) => a.id - b.id);
    return id;
  }

  /** Names for the table's rows: the spells that use the row, or the skill's name. */
  readRowNames() {
    const names = Array.from({ length: this.table.count }, () => []);
    if (this.which === 'effect') {
      const fx = this.ed.tables.effect;
      for (let i = 0; i < fx.count; i++) {
        const row = fx.row(i);
        if (!isSpell(row)) continue;
        const r = view(row).getUint16(0x90, true);
        const name = this.ed.name('effect', i);
        if (r && r < names.length && name && !names[r].some(entry => entry.name === name)) {
          names[r].push({ id: i, name });
        }
      }
    } else {
      for (let r = 0; r < this.table.count; r++) {
        const name = this.ed.name('skill', r);
        if (name) names[r].push({ id: r, name });
      }
    }
    return names;
  }

  value(r, s) {
    if (s >= SETS) return this.expandedSet(s)?.levels[r] ?? NONE;
    return this.table.row(r)[this.spec.column + s];
  }

  originalValue(r, s) {
    if (this.installedExpanded) return this.value(r, s);
    if (s >= SETS) {
      const saved = this.which === 'effect' ? this.ed.menuMods.savedSpellSets : this.ed.menuMods.savedSkillSets;
      return saved.find(row => row.id === s)?.levels[r] ?? NONE;
    }
    const o = this.ed.originalEntries[this.spec.entry].offset;
    return this.ed.original[o + 16 + r * this.spec.rowSize + this.spec.column + s];
  }

  setValue(r, s, v) {
    if (this.installedExpanded) return false;
    if (this.ed.ctx.readOnly?.()) { this.ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return false; }
    if (s >= SETS) {
      const row = this.expandedSet(s);
      if (!row || !this.expandedEnabled) return false;
      while (row.levels.length <= r) row.levels.push(NONE);
      row.levels[r] = v;
      return true;
    }
    this.table.row(r)[this.spec.column + s] = v;
    return true;
  }

  /** A class's name, with its number when other classes share it (the Knight Commanders). */
  className(c) {
    const name = this.ed.name('class', c);
    const t = this.ed.tables.class;
    let same = 0;
    for (let i = 0; i < t.count && same < 2; i++) if (this.ed.name('class', i) === name) same++;
    return same > 1 ? `${name} #${c}` : name;
  }

  label(s) {
    if (s >= SETS) return this.expandedSet(s)?.name ?? `${this.spec.title} ${s}`;
    const l = this.labels[s];
    return l && l !== '<not used>' ? l : `Unused set ${s}`;
  }

  /** Named classes whose set is s. */
  classesUsing(s) {
    if (s >= SETS) return this.expandedSet(s)?.classes ?? [];
    const c = this.ed.tables.class;
    const out = [];
    for (let i = 0; i < c.count; i++) if (this.groupFor(i) === s && this.ed.name('class', i)) out.push(i);
    return out;
  }

  allows(value) {
    return value !== NONE && (this.which === 'skill' || value !== 0);
  }

  usable(s) {
    let n = 0;
    for (let r = 1; r < this.table.count; r++) if (this.rowNames[r]?.length && this.allows(this.value(r, s))) n++;
    return n;
  }

  columnChanged(s) {
    for (let r = 0; r < this.table.count; r++) if (this.value(r, s) !== this.originalValue(r, s)) return true;
    return false;
  }

  /** A column no class uses and nothing is usable in (as loaded and now): free for a new set. */
  freeSet() {
    const classes = this.ed.tables.class;
    const used = new Set();
    for (let c = 0; c < classes.count; c++) if (this.ed.name('class', c)) used.add(classes.row(c)[this.spec.classField]);
    for (let s = 1; s < SETS - 1; s++) {
      if (this.labels[s] && this.labels[s] !== '<not used>') continue;
      if (used.has(s)) continue;
      let empty = true;
      for (let r = 0; r < this.table.count && empty; r++) empty = this.value(r, s) === NONE && this.originalValue(r, s) === NONE;
      if (empty) return s;
    }
    return null;
  }

  first() {
    const s = this.labels.findIndex((l, k) => k > 0 && l && l !== '<not used>');
    return s < 0 ? 0 : s;
  }

  valueLabel(v) {
    if (v === NONE) return 'Can’t use';
    if (v === 0) return this.which === 'skill' ? 'May use if known' : 'Can’t use (0)';
    return `${this.spec.level} ${v}`;
  }

  renderList(list, selected, filter, onSelect) {
    this.rowNames = this.readRowNames();
    const q = filter.trim().toLowerCase();
    list.innerHTML = '';
    for (const s of [...Array.from({length: SETS}, (_, i) => i), ...this.expanded.map(row => row.id)]) {
      const classes = this.classesUsing(s);
      const usable = this.usable(s);
      const label = this.label(s);
      const names = classes.map((c) => this.className(c));
      if (q && !label.toLowerCase().includes(q) && !names.some((n) => n.toLowerCase().includes(q)) && String(s) !== q) continue;
      const b = document.createElement('button');
      b.className = `data-item${s === selected ? ' active' : ''}`;
      b.dataset.index = String(s);
      const free = !classes.length && !usable;
      b.innerHTML = `<span class="thumb"></span><span class="data-name">${esc(label)}${free ? ' <span class="muted">(free)</span>' : ''}${this.columnChanged(s) ? ' <span class="dirty">●</span>' : ''}</span><span class="picker-id">${usable}</span>`;
      b.title = `${usable} ${this.spec.what} usable${names.length ? ` · used by ${names.join(', ')}` : ''}`;
      b.onclick = () => onSelect(s);
      list.append(b);
    }
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  renderDetail(detail, s, onChange) {
    if (!this.hasSet(s)) s = this.first();
    this.rowNames = this.readRowNames();
    const custom = this.expandedSet(s);
    const locked = !!this.installedExpanded || (!!custom && !this.expandedEnabled);
    const classes = this.classesUsing(s);
    const allClasses = [];
    for (let i = custom ? 1 : 0; i < this.ed.tables.class.count; i++) if (this.ed.name('class', i)) allClasses.push(i);
    const free = this.freeSet();
    const levelLimit = this.ed.menuMods?.value.levelCap99 ? 99 : 50;
    const levels = [NONE, ...(this.which === 'skill' ? [0] : []), ...Array.from({ length: levelLimit }, (_, k) => k + 1)];
    const options = (v) => levels.map((x) => `<option value="${x}" ${x === v ? 'selected' : ''}>${esc(this.valueLabel(x))}</option>`).join('')
      + (levels.includes(v) ? '' : `<option value="${v}" selected>${esc(this.valueLabel(v))}</option>`);
    detail.innerHTML = `
      <div class="data-head"><div>
        <h1>${esc(this.label(s))}</h1>
        <div class="meta">${this.spec.title} #${s} · ${this.usable(s)} ${this.spec.what} usable · class field +0x${this.spec.classField.toString(16)}</div>
        <p class="set-classes">Used by: ${classes.length ? classes.map((c) => `<b>${esc(this.className(c))}</b>`).join(', ') : '<span class="muted">no class</span>'}</p>
        <div class="data-actions">
          <label class="field"><span class="field-label">Give a class this set</span>
            <select class="set-class" ${locked ? 'disabled' : ''}>${allClasses.map((c) => `<option value="${c}">${esc(this.className(c))} (now: ${esc(this.label(this.groupFor(c)))})</option>`).join('')}</select></label>
          <button class="ghost set-assign" ${locked ? 'disabled' : ''}>Use this set</button>
          <button class="ghost set-copy" ${this.installedExpanded || free === null ? 'disabled' : `title="Copies this set into unused set ${free}"`}>New set from this one</button>
          ${this.expandedEnabled ? `<button class="ghost set-expand" ${this.nextExpanded() === null ? 'disabled' : ''}>New expanded set from this one</button>` : ''}
          <button class="ghost set-revert" ${!locked && this.columnChanged(s) ? '' : 'disabled'}>Revert this set</button>
        </div>
        ${custom ? `<div class="data-actions"><label class="field">Set name <input class="set-name-edit" value="${esc(custom.name)}" maxlength="80" ${locked ? 'disabled' : ''}></label>
          <button class="ghost set-delete" ${locked ? 'disabled' : ''}>Remove this expanded set</button></div>
          ${this.installedExpanded ? '' : `<p class="hint">${locked ? 'Enable Mod Preparation to edit and use this expanded set.' : `Removing this set or disabling Mod Preparation restores each class’s original ${this.spec.title.toLowerCase()}.`}</p>`}` : ''}
        ${this.installedExpanded ? '<p class="hint">Open the project that built these permissions to edit the sets.</p>' : ''}
        <div class="data-actions">
          <input class="set-filter" type="search" placeholder="Find a ${this.which === 'effect' ? 'spell' : 'skill'}…" value="${esc(this.filterText)}">
          <label class="toggle"><input class="set-usable" type="checkbox" ${this.usableOnly ? 'checked' : ''}> Usable only</label>
        </div>
        <p class="hint">${this.which === 'effect'
    ? 'These levels set when spells become eligible for automatic spell loadouts, including Fill empty enemy spell slots. Each row is a spell group and can cover several spells.'
    : 'Which skills a class with this set may use or learn, and at what level.'} Set names come from the classes the game gives them to; a new set is unnamed until a class uses it.</p>
      </div></div>
      <div class="set-rows"></div>`;
    const rows = detail.querySelector('.set-rows');
    attachHelp(detail.querySelector('.set-class'), 'Chooses the class that Use this set will assign to this shared list. Assignment affects units of that class; it does not copy the list or increase equipped slots.');
    attachHelp(detail.querySelector('.set-assign'), 'Assigns the selected class to this shared permission list. Changes to the list affect every class using it.');
    attachHelp(detail.querySelector('.set-copy'), free === null ? 'No empty unused list was found. Unassigned lists containing data are not automatically treated as free.' : 'Copies this list into an empty unused list so it can be edited independently. Give a class the copied list with Use this set.');
    attachHelp(detail.querySelector('.set-revert'), 'Restores this list’s permission and level values to the loaded baseline. All classes assigned to the list use those values.');
    attachHelp(detail.querySelector('.set-usable'), 'Shows only entries allowed by this list. This is a view filter and does not change permissions.');
    const draw = () => {
      const q = this.filterText.trim().toLowerCase();
      const html = [];
      for (let r = 1; r < this.table.count; r++) {
        const entries = this.rowNames[r];
        if (!entries?.length) continue;
        const v = this.value(r, s);
        if (this.usableOnly && !this.allows(v)) continue;
        const visible = q ? entries.filter(entry => entry.name.toLowerCase().includes(q)) : entries;
        if (!visible.length) continue;
        const changed = v !== this.originalValue(r, s) ? '<span class="changed">●</span>' : '';
        html.push(`<label class="set-row"><span class="set-name">${visible.map(entry =>
          `<span class="set-entry"><span class="thumb" data-art="${entry.id}"></span>${esc(entry.name)}</span>`).join('')}${changed}</span><select data-row="${r}" ${locked ? 'disabled' : ''}>${options(v)}</select></label>`);
      }
      rows.innerHTML = html.join('') || '<p class="muted">Nothing matches.</p>';
      for(const slot of rows.querySelectorAll('[data-art]')){
        this.ed.picture(this.which,Number(slot.dataset.art),false).then(c=>{if(c&&slot.isConnected)slot.append(c);});
      }
      for (const sel of rows.querySelectorAll('select')) {
        const help = this.which === 'skill'
          ? 'Sets whether classes using this list may learn/use this skill and at what level. Can’t use blocks it; May use if known does not grant it through an unlock level. Skill restriction groups and equipped-slot limits still apply.'
          : 'Sets the minimum unit level for automatic spell loadouts. The same value controls class permission for this spell group. Can’t use blocks the group. Spells that share a group use the same setting.';
        attachHelp(sel, help);
        attachHelp(sel.closest('.set-row'), help);
        sel.onchange = () => {
          const r = Number(sel.dataset.row);
          if (!this.setValue(r, s, Number(sel.value))) { sel.value = String(this.value(r, s)); return; }
          onChange();
        };
      }
    };
    draw();
    detail.querySelector('.set-filter').oninput = (e) => { this.filterText = e.target.value; draw(); };
    detail.querySelector('.set-usable').onchange = (e) => { this.usableOnly = e.target.checked; draw(); };
    detail.querySelector('.set-assign').onclick = () => {
      if (this.ed.ctx.readOnly?.()) { this.ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
      const c = Number(detail.querySelector('.set-class').value);
      if (!this.assign(c, s)) return;
      this.ed.ctx.setStatus(`${this.className(c)} now uses ${this.spec.title.toLowerCase()} ${this.label(s)} (#${s})`);
      onChange();
    };
    detail.querySelector('.set-copy').onclick = () => {
      if (this.installedExpanded || free === null || this.ed.ctx.readOnly?.()) return;
      for (let r = 0; r < this.table.count; r++) this.setValue(r, free, this.value(r, s));
      this.ed.ctx.setStatus(`${this.label(s)} copied into ${this.spec.title.toLowerCase()} #${free}: give it to a class with "Use this set"`);
      this.ed.selected = free;
      onChange();
    };
    detail.querySelector('.set-revert').onclick = () => {
      for (let r = 0; r < this.table.count; r++) this.setValue(r, s, this.originalValue(r, s));
      onChange();
    };
    const expand = detail.querySelector('.set-expand');
    if (expand) expand.onclick = () => {
      const id = this.copyExpanded(s);
      if (id === null) return;
      this.ed.selected = id;
      onChange();
    };
    if (custom) {
      detail.querySelector('.set-name-edit').onchange = e => {
        if (locked || this.ed.ctx.readOnly?.()) return;
        const name = e.target.value.trim();
        if (!name) { e.target.value = custom.name; return; }
        custom.name = name;
        onChange();
      };
      detail.querySelector('.set-delete').onclick = () => {
        if (locked || this.ed.ctx.readOnly?.() || !confirm(`Remove ${custom.name}? Assigned classes will return to their original sets.`)) return;
        this.ed.menuMods[this.expandedKey] = this.expanded.filter(row => row !== custom);
        this.ed.selected = this.first();
        onChange();
      };
    }
  }
}

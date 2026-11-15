// Finishers (Classes & items): explicit battle presets occupy eight u16 slots
// at +0x9C. Automatic lists also check the effect's class restriction at +0x7C,
// weapon family and proficiency rank. Thus battle presets are only one source;
// see research/CLASS_FINISHER_FINDINGS.md for the native class-aware generator.
// Changes are written to the battle files, and the scene files that carry a
// copy of them (joins) are updated on save.

import { view } from '../lib/pakd.js';
import { attachHelp } from './fieldhelp.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLOTS = 0x9C, SLOT_COUNT = 8, AUTO = 0xAC, U_CLASS = 0x06;

export class FinisherEditor {
  constructor(ed) {
    this.ed = ed; // DataEditor
    this.loaded = null;
    this.list = [];
  }

  /** Read every battle file once: holders per finisher, and the finisher list. */
  load() {
    this.loaded ??= (async () => {
      const files = await this.ed.mods.battleFiles((t) => this.ed.ctx.setStatus(t));
      this.files = files;
      const fx = this.ed.tables.effect;
      // the finishers are the effects in the spell-set line most finisher slots point into
      const rows = new Map();
      for (const { units } of files) {
        for (let r = 0; r < units.count; r++) {
          const v = view(units.row(r));
          for (let k = 0; k < SLOT_COUNT; k++) {
            const id = v.getUint16(SLOTS + 2 * k, true);
            if (id && id < fx.count) { const g = view(fx.row(id)).getUint16(0x90, true); rows.set(g, (rows.get(g) ?? 0) + 1); }
          }
        }
      }
      const group = [...rows].sort((a, b) => b[1] - a[1])[0]?.[0];
      this.finishers = [];
      for (let i = 1; i < fx.count; i++) if (view(fx.row(i)).getUint16(0x90, true) === group && this.ed.name('effect', i)) this.finishers.push(i);
      this.ed.ctx.setStatus(`${this.finishers.length} finishers, in ${files.length} battle files`);
    })();
    return this.loaded;
  }

  holders(id) {
    const out = [];
    for (const f of this.files) {
      for (let r = 0; r < f.units.count; r++) {
        const v = view(f.units.row(r));
        for (let k = 0; k < SLOT_COUNT; k++) if (v.getUint16(SLOTS + 2 * k, true) === id) out.push({ f, r, k });
      }
    }
    return out;
  }

  unitLabel(f, r) {
    const row = f.units.row(r);
    const name = this.ed.ctx.tables()?.unitName(view(row).getUint16(0, true)) || 'Generic';
    return `${name} (${this.ed.name('class', row[U_CLASS]) || `class ${row[U_CLASS]}`})`;
  }

  /** Remember a battle file's bytes before its first change (saving writes it; see DataEditor.save). */
  touch(f) {
    if (!this.ed.entryEdits.has(f.path)) this.ed.entryEdits.set(f.path, { dat: f.dat, original: f.dat.pack.slice() });
  }

  first() { return 0; }

  renderList(list, selected, filter, onSelect) {
    if (!this.finishers) {
      list.innerHTML = '<p class="muted">Reading battle files…</p>';
      this.load().then(() => { this.renderList(list, selected, filter, onSelect); onSelect(Math.max(0, selected)); });
      return;
    }
    const q = filter.trim().toLowerCase();
    this.list = this.finishers.filter((id) => !q || this.ed.name('effect', id).toLowerCase().includes(q));
    list.innerHTML = '';
    this.list.forEach((id, n) => {
      const b = document.createElement('button');
      b.className = `data-item${n === selected ? ' active' : ''}`;
      b.innerHTML = `<span class="thumb"></span><span class="data-name">${esc(this.ed.name('effect', id))}</span><span class="picker-id">${this.holders(id).length}</span>`;
      b.title = `${this.holders(id).length} explicit battle presets list this finisher. Automatic availability can also depend on its class restriction, weapon family and proficiency rank. Duplicate names may refer to different effect IDs.`;
      b.onclick = () => onSelect(n);
      this.ed.picture('effect', id, false).then((c) => c && b.querySelector('.thumb').append(c));
      list.append(b);
    });
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  renderDetail(detail, n, onChange) {
    if (!this.finishers) { detail.innerHTML = '<p class="muted">Reading battle files…</p>'; return; }
    const id = this.list[n];
    if (id === undefined) { detail.innerHTML = '<p class="muted">No finisher matches.</p>'; return; }
    const held = this.holders(id);
    const files = this.files.filter((f) => f.units.count);
    const fileLabel = (f) => {
      const names = [];
      for (let r = 0; r < f.units.count && names.length < 4; r++) {
        const nm = this.ed.ctx.tables()?.unitName(view(f.units.row(r)).getUint16(0, true));
        if (nm && !names.includes(nm)) names.push(nm);
      }
      return `${f.path.split('/').pop().replace('.dat', '')}${names.length ? ` · ${names.join(', ')}` : ''}`;
    };
    detail.innerHTML = `
      <div class="data-head"><div class="data-pics"></div><div>
        <h1>${esc(this.ed.name('effect', id))}</h1>
        <div class="meta">Finisher · spell #${id} · ${held.length} battle unit${held.length === 1 ? '' : 's'}</div>
        <p class="hint">This panel edits explicit battle finisher presets (eight slots per unit). Automatic finishers also depend on weapon family, proficiency and the ability’s class restriction: Ozma’s Demon Rose #496 points to her playable Knight Commander class #70. Find “Restrict to Class?” and “Prerequisite Rank” on the corresponding entry in Spells &amp; abilities. Scene copies are updated on save, but a preset does not by itself guarantee availability after recruitment or class changes.</p>
      </div></div>
      <h3>Units with it</h3>
      <div class="finisher-holders">${held.length ? held.map(({ f, r, k }, x) => `<div class="finisher-holder">${esc(this.unitLabel(f, r))} <span class="muted">${esc(f.path.split('/').pop())}, slot ${k + 1}${view(f.units.row(r)).getUint8(AUTO) ? ', automatic finishers on' : ''}</span> <button class="ghost" data-take="${x}">Take away</button></div>`).join('') : '<p class="muted">No battle unit has it.</p>'}</div>
      <h3>Give it to a unit</h3>
      <div class="data-actions">
        <label class="field"><span class="field-label">Battle file</span><select class="fin-file">${files.map((f, x) => `<option value="${x}">${esc(fileLabel(f))}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Unit</span><select class="fin-unit"></select></label>
        <button class="ghost fin-give">Give</button>
      </div>`;
    this.ed.picture('effect', id, true).then((c) => c && detail.querySelector('.data-pics').append(c));
    const fileSel = detail.querySelector('.fin-file'), unitSel = detail.querySelector('.fin-unit');
    attachHelp(fileSel, 'Chooses the battle file whose explicit unit presets will be edited. This does not change the finisher’s shared class restriction or automatically assign it to every unit of a class.');
    attachHelp(unitSel, 'Chooses the unit in the selected battle file. Give adds this finisher to that unit’s explicit preset; it does not edit the character’s saved army record directly.');
    attachHelp(detail.querySelector('.fin-give'), 'Adds this effect ID to an empty slot in the selected unit’s eight-finisher battle preset. Automatic generation and later class/equipment changes can still affect the final list.');
    const fillUnits = () => {
      const f = files[Number(fileSel.value)];
      const opts = [];
      for (let r = 0; r < f.units.count; r++) {
        const row = f.units.row(r);
        if (!view(row).getUint16(0, true) && !row[U_CLASS]) continue; // empty slot
        opts.push(`<option value="${r}">${esc(this.unitLabel(f, r))} #${r + 1}</option>`);
      }
      unitSel.innerHTML = opts.join('');
    };
    fileSel.onchange = fillUnits;
    fillUnits();
    const guard = () => {
      if (!this.ed.ctx.readOnly?.()) return true;
      this.ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true);
      return false;
    };
    detail.querySelector('.fin-give').onclick = () => {
      if (!guard()) return;
      const f = files[Number(fileSel.value)], r = Number(unitSel.value);
      const v = view(f.units.row(r));
      const slots = Array.from({ length: SLOT_COUNT }, (_, k) => v.getUint16(SLOTS + 2 * k, true));
      if (slots.includes(id)) { this.ed.ctx.toast('That unit already has it.', true); return; }
      const free = slots.indexOf(0);
      if (free < 0) { this.ed.ctx.toast('All eight finisher slots of that unit are taken: take one away first.', true); return; }
      this.touch(f);
      v.setUint16(SLOTS + 2 * free, id, true);
      this.ed.ctx.setStatus(`${this.unitLabel(f, r)} in ${f.path.split('/').pop()} now has ${this.ed.name('effect', id)} (slot ${free + 1})`);
      onChange();
    };
    for (const b of detail.querySelectorAll('[data-take]')) {
      attachHelp(b, 'Clears this explicit finisher assignment from this battle unit. It does not remove the finisher’s automatic class/weapon/proficiency eligibility.');
      b.onclick = () => {
        if (!guard()) return;
        const { f, r, k } = held[Number(b.dataset.take)];
        this.touch(f);
        view(f.units.row(r)).setUint16(SLOTS + 2 * k, 0, true);
        onChange();
      };
    }
  }
}

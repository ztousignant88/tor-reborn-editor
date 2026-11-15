// Crafting (Classes & items): every piece of equipment and every item carries
// its own recipe: the recipe book needed (equipment +0x78, items +0x1E) and up
// to four ingredients (the next four u16s), each an item or equipment ID.
// Crafting always succeeds in Reborn, so the old success fields are left alone.

import { view } from '../lib/pakd.js';
import { attachHelp } from './fieldhelp.js';
import { createPicker } from '../ui/picker.js';
import { ITEM_BASE } from './classmarks.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RECIPE = {
  armament: { book: 0x78, parts: [0x7A, 0x7C, 0x7E, 0x80], title: 'Equipment' },
  commodity: { book: 0x1E, parts: [0x20, 0x22, 0x24, 0x26], title: 'Item' },
};

export class CraftingEditor {
  constructor(ed) {
    this.ed = ed; // DataEditor
    this.everything = false;
  }

  get(kind, i, off) { return view(this.ed.tables[kind].row(i)).getUint16(off, true); }

  craftable(kind, i) {
    const r = RECIPE[kind];
    return this.get(kind, i, r.book) !== 0 || r.parts.some((o) => this.get(kind, i, o) !== 0);
  }

  changed(kind, i) {
    const o = this.ed.originalRowStart(kind, i);
    if (o === null) return true;
    const r = RECIPE[kind];
    return [r.book, ...r.parts].some((off) => view(this.ed.original).getUint16(o + off, true) !== this.get(kind, i, off));
  }

  entries(filter) {
    const q = filter.trim().toLowerCase();
    const out = [];
    for (const kind of ['armament', 'commodity']) {
      const t = this.ed.tables[kind];
      for (let i = 1; i < t.count; i++) {
        const name = this.ed.name(kind, i);
        if (!name) continue;
        if (!this.everything && !this.craftable(kind, i) && !this.changed(kind, i)) continue;
        const id = kind === 'commodity' ? ITEM_BASE + i : i;
        const label = `${kind === 'armament' ? 'E' : 'I'}${i}`;
        if (q && !name.toLowerCase().includes(q) && q !== label.toLowerCase() &&
            q !== String(id) && q !== `#${id}`) continue;
        out.push({ id, kind, i, name, label });
      }
    }
    return out;
  }

  first(filter = '') { return this.entries(filter)[0]?.id ?? 0; }

  renderList(list, selected, filter, onSelect) {
    const entries = this.entries(filter);
    list.innerHTML = `<label class="toggle crafting-all"><input type="checkbox" ${this.everything ? 'checked' : ''}> All items and equipment (to add a recipe)</label>`;
    list.querySelector('input').onchange = (e) => {
      this.everything = e.target.checked;
      const current = this.ed.selected;
      this.renderList(list, current, filter, onSelect);
      onSelect(list.querySelector('.active') ? current : this.first(filter));
    };
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = new IntersectionObserver((observed, observer) => {
      for (const { target, isIntersecting } of observed) {
        if (!isIntersecting && target.isConnected) continue;
        observer.unobserve(target);
        if (!target.isConnected) continue;
        const { recipeKind, recipeIndex } = target.dataset;
        this.ed.picture(recipeKind, Number(recipeIndex), false).then((art) => {
          if (art && target.isConnected) target.querySelector('.thumb').append(art);
        }).catch(() => {});
      }
    }, { root: list });
    for (const e of entries) {
      const b = document.createElement('button');
      b.className = `data-item${e.id === selected ? ' active' : ''}`;
      b.dataset.index = String(e.id);
      b.dataset.recipeKind = e.kind;
      b.dataset.recipeIndex = String(e.i);
      b.innerHTML = `<span class="thumb"></span><span class="data-name">${esc(e.name)}${this.changed(e.kind, e.i) ? ' <span class="dirty">●</span>' : ''}</span><span class="picker-id">${e.label}</span>`;
      b.onclick = () => onSelect(e.id);
      list.append(b);
      this.thumbnailObserver.observe(b);
    }
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  renderDetail(detail, id, onChange) {
    const kind = id >= ITEM_BASE ? 'commodity' : 'armament';
    const i = kind === 'commodity' ? id - ITEM_BASE : id;
    if (i <= 0 || i >= this.ed.tables[kind].count) {
      detail.innerHTML = '<p class="muted">Select a recipe, or tick “All items and equipment” to add one.</p>';
      return;
    }
    const e = { kind, i, name: this.ed.name(kind, i) };
    const r = RECIPE[e.kind];
    const original = this.ed.originalRowStart(kind, i);
    const readOnly = this.ed.ctx.readOnly?.();
    detail.innerHTML = `
      <div class="data-head"><div class="data-pics"></div><div>
        <h1>${esc(e.name)}</h1>
        <div class="meta">${r.title} #${e.i}${this.craftable(e.kind, e.i) ? '' : ' · not craftable'}</div>
        <p class="hint">Crafted with the recipe book below and up to four ingredients (pick “Nothing” for an empty slot). With no book and no ingredients the entry can't be crafted. The same fields are under “Acquisition” in the ${e.kind === 'armament' ? 'Equipment' : 'Items'} tab.</p>
      </div></div>
      <div class="field-grid crafting-fields">
        <label class="field" data-off="${r.book}"><span class="field-label">Recipe book</span></label>
        ${r.parts.map((off, k) => `<label class="field" data-off="${off}"><span class="field-label">Ingredient ${k + 1}</span></label>`).join('')}
      </div>
      <div class="data-actions"><button class="ghost craft-clear" ${readOnly || !this.craftable(kind, i) ? 'disabled' : ''}>Not craftable</button><button class="ghost craft-revert" ${readOnly || original === null || !this.changed(kind, i) ? 'disabled' : ''}>Revert recipe</button></div>`;
    const picture = detail.querySelector('.data-pics');
    this.ed.picture(kind, i, true).then((art) => {
      if (art && picture.isConnected) picture.append(art);
    }).catch(() => {});
    const write = (off, v) => {
      if (this.ed.ctx.readOnly?.()) { this.ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return false; }
      view(this.ed.tables[e.kind].row(e.i)).setUint16(off, v, true);
      return true;
    };
    const recipeBooks = this.ed.itemOptions({ books: true });
    const ingredients = this.ed.itemOptions();
    for (const field of detail.querySelectorAll('[data-off]')) {
      const off = Number(field.dataset.off), books = off === r.book;
      const help = books
        ? 'Chooses the recipe book needed to craft this entry. Ingredients are configured separately. With no book and no ingredients the entry is not craftable.'
        : 'Chooses one ingredient required by this recipe. Nothing leaves this slot empty. This selects an ingredient ID, not a quantity.';
      const picker = createPicker({ options: books ? recipeBooks : ingredients, value: this.get(e.kind, e.i, off),
        allowRaw: false, emptyLabel: 'Nothing', onChange: (value) => {
        if (!write(off, Number(value))) return;
        onChange();
      } });
      picker.disabled = !!readOnly;
      picker.setAttribute('aria-label', field.textContent);
      attachHelp(picker, help);
      field.append(picker);
    }
    detail.querySelector('.craft-clear').onclick = () => {
      if ([r.book, ...r.parts].every((off) => write(off, 0))) onChange();
    };
    attachHelp(detail.querySelector('.craft-clear'), 'Clears the book and all four ingredients, making this entry not craftable through this recipe. The item itself is not deleted.');
    attachHelp(detail.querySelector('.craft-revert'), 'Restores this entry’s recipe book and ingredients to the loaded baseline. Other item settings are unchanged.');
    detail.querySelector('.craft-revert').onclick = () => {
      if (original === null) return;
      if ([r.book, ...r.parts].every((off) => write(off, view(this.ed.original).getUint16(original + off, true)))) onChange();
    };
  }
}

// Class marks (Classes & items). menu/menu_data.dat pakd entry 35 is the
// class-change screen's list of class -> class mark: one u16 item ID per class
// (item = 1000 + item table row), classes 0-79, 0 = no mark. Marks are items of
// type 35 (416-462 in the shipped data) with no use effect of their own; which
// class a mark serves is only recorded here. Edits are in place (same size).

import { isXlce, parseXlce, view } from '../lib/pakd.js';

export const MENU_PATH = 'menu/menu_data.dat';
const MARK_TABLE = 35;
const MARK_TYPE = 35;
export const ITEM_BASE = 1000;

export class ClassMarks {
  /** On the menu data the editor has loaded (it saves the file, with the shops). */
  static async load(ed) {
    return new ClassMarks(ed, ed.menu);
  }

  constructor(ed, dat) {
    this.ed = ed; // DataEditor
    this.dat = dat;
    this.original = dat.pack.slice();
    const e = dat.pakd.entries[MARK_TABLE];
    if (!e || !isXlce(e.data) || parseXlce(e.data).rowSize !== 2) throw new Error('class mark list not found where expected');
    this.table = parseXlce(e.data);
    this.offset = e.offset + 16; // first row, in the file
  }

  get count() { return this.table.count; }

  integrated(c) { return this.ed.menuMods?.value.specialClassChange ? this.ed.menuMods.saved?.specialClassMarks?.[c] : undefined; }

  /** Item ID of class c's mark (0 = none), or null for a class past the list. */
  mark(c) { return this.integrated(c) ?? (c < this.count ? view(this.table.row(c)).getUint16(0, true) : null); }
  originalMark(c) { return this.integrated(c) ?? (c < this.count ? view(this.original).getUint16(this.offset + c * 2, true) : null); }

  setMark(c, itemId) {
    if (this.integrated(c) !== undefined) throw new Error('This mark is supplied by Special Class Change');
    if (c >= this.count) throw new Error(`the class mark list covers classes 0-${this.count - 1}`);
    view(this.table.row(c)).setUint16(0, itemId, true);
    this.ed.ctx.onChange();
  }

  get dirty() {
    const p = this.dat.pack;
    for (let i = 0; i < p.length; i++) if (p[i] !== this.original[i]) return true;
    return false;
  }

  /** Every item that is a class mark (type 35): { id: item ID, row, name }. */
  markItems() {
    const t = this.ed.tables.commodity;
    const out = [];
    for (let i = 0; i < t.count; i++) if (t.row(i)[2] === MARK_TYPE) out.push({ id: ITEM_BASE + i, row: i, name: this.ed.name('commodity', i) || `item #${i}` });
    return out;
  }

  /** Classes whose mark is this item. */
  classesFor(itemId) {
    const out = [];
    for (let c = 0; c < this.ed.tables.class.count; c++) if (this.mark(c) === itemId) out.push(c);
    return out;
  }

  /**
   * A new mark for class c: a copy of an existing mark (an unused item row first,
   * else a row added to the item table), named "<class>'s Mark", set as c's mark.
   * Returns its item ID, or null.
   */
  makeMark(c, name = null) {
    const from = this.markItems()[0];
    if (!from) { this.ed.ctx.toast('No class mark to copy from.', true); return null; }
    const className = this.ed.name('class', c) || `Class ${c}`;
    const to = this.ed.newEntry('commodity', from.row, { name: name ?? `${className}'s Mark` });
    if (to === null) return null;
    this.setMark(c, ITEM_BASE + to);
    return ITEM_BASE + to;
  }

  /** After the editor saved the menu data. */
  saved() {
    this.original = this.dat.pack.slice();
  }
}

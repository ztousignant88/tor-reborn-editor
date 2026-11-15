// Editable LocalizeText_<lang>.dat: pakd of txte tables. txte layout:
// 'txte', count, body start 0x10, entry size 0x20; entries of 4 u64 string
// offsets (key, value, gender form, unknown); then the string pool in entry
// order, padded to align16(len + 1). Rebuilding an untouched table reproduces
// it byte for byte; only tables holding edited strings are rebuilt.

import { buildPakd, view } from '../lib/pakd.js';
import { encodeDat, loadDat } from './datfile.js';

const TXTE = 0x65747874;

const cstr = (d, o) => { let e = o; while (d[e]) e++; return d.subarray(o, e); };

export class LocalizeFile {
  static async load(lang) {
    return new LocalizeFile(await loadDat(`localize/LocalizeText_${lang}.dat`), lang);
  }

  constructor(dat, lang) {
    this.dat = dat;
    this.lang = lang;
    this.path = dat.path;
    this.tables = dat.pakd.entries.map((e) => (view(e.data).getUint32(0, true) === TXTE ? parseTxte(e.data) : null));
    this.index = new Map(); // key -> [table, row]
    this.tables.forEach((t, ti) => t?.rows.forEach((r, ri) => this.index.set(r.key, [ti, ri])));
    this.dirtyTables = new Set();
  }

  has(key) { return this.index.has(key); }

  get(key) {
    const at = this.index.get(key);
    return at ? this.tables[at[0]].rows[at[1]].value : null;
  }

  set(key, bytes) {
    const at = this.index.get(key);
    if (!at) throw new Error(`no text "${key}" in ${this.path}`);
    this.tables[at[0]].rows[at[1]].value = bytes;
    this.dirtyTables.add(at[0]);
  }

  /**
   * Add a new text, appended to the table that holds keys starting with
   * `siblingPrefix` (e.g. "SCENARIO_C1_"). Tables aren't sorted, so the end is fine.
   */
  add(key, bytes, siblingPrefix) {
    if (this.index.has(key)) { this.set(key, bytes); return; }
    const ti = this.tables.findIndex((t) => t?.rows.some((r) => r.key.startsWith(siblingPrefix)));
    if (ti < 0) throw new Error(`no text table for ${siblingPrefix}* in ${this.path}`);
    const keyBytes = new TextEncoder().encode(key);
    const empty = new Uint8Array(0);
    this.tables[ti].rows.push({ key, keyBytes, value: bytes, gender: empty, extra: empty });
    this.index.set(key, [ti, this.tables[ti].rows.length - 1]);
    this.dirtyTables.add(ti);
  }

  /** Take back a text added with add() (undo); other texts are left alone. */
  remove(key) {
    const at = this.index.get(key);
    if (!at) return;
    const rows = this.tables[at[0]].rows;
    rows.splice(at[1], 1);
    this.index.delete(key);
    rows.forEach((r, ri) => this.index.set(r.key, [at[0], ri]));
  }

  get dirty() { return this.dirtyTables.size > 0; }

  async encode() {
    const entries = this.dat.pakd.entries.map((e, i) => (this.dirtyTables.has(i) ? buildTxte(this.tables[i]) : e.data));
    return encodeDat(buildPakd(entries), this.dat.entryName);
  }
}

function parseTxte(d) {
  const v = view(d);
  const count = v.getUint32(4, true);
  const bodyStart = v.getUint32(8, true);
  const entrySize = v.getUint32(12, true);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const at = bodyStart + i * entrySize;
    const s = [0, 8, 16, 24].map((k) => cstr(d, Number(v.getBigUint64(at + k, true))));
    rows.push({ key: new TextDecoder().decode(s[0]), keyBytes: s[0], value: s[1], gender: s[2], extra: s[3] });
  }
  return { header: d.subarray(0, bodyStart), entrySize, rows };
}

function buildTxte(t) {
  const n = t.rows.length;
  const base = t.header.length + n * t.entrySize;
  const strings = t.rows.flatMap((r) => [r.keyBytes, r.value, r.gender, r.extra]);
  const poolSize = strings.reduce((a, s) => a + s.length + 1, 0);
  const out = new Uint8Array((base + poolSize + 1 + 15) & ~15); // align16(len + 1), as the game pads
  out.set(t.header, 0);
  const v = view(out);
  v.setUint32(4, n, true);
  let p = base;
  strings.forEach((s, i) => {
    const row = Math.floor(i / 4), field = i % 4;
    v.setBigUint64(t.header.length + row * t.entrySize + field * 8, BigInt(p), true);
    out.set(s, p);
    p += s.length + 1;
  });
  return out;
}

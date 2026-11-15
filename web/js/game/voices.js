// Voice index: sound/sound_<en|ja>.dat, a pakd of xlce tables with 16-byte
// rows [u64 string offset, u64 id]; the string is a cue name ("SCENARIO_C1_001_001_00")
// after 8 control bytes. Tables 0-9 are per chapter; the last repeats every
// cue. A line is voiced only if its cue has a row, so removing its rows (from
// every table) mutes that line, like the game's own unvoiced lines.
// Rebuilding (rows, then strings in row order, padded to 16) is byte-exact.

import { buildPakd, parseXlce, view } from '../lib/pakd.js';
import { encodeDat, loadDat } from './datfile.js';

export const VOICE_LANGS = ['en', 'ja'];

/** "SCENARIO_C1_001_001_00_TEXT" -> "SCENARIO_C1_001_001_00" */
export const cueForKey = (key) => key.replace(/_TEXT$/, '');

export class VoiceIndex {
  static async load(lang) {
    return new VoiceIndex(await loadDat(`sound/sound_${lang}.dat`), lang);
  }

  constructor(dat, lang) {
    this.dat = dat;
    this.lang = lang;
    this.path = dat.path;
    this.tables = dat.pakd.entries.map((e) => {
      const t = parseXlce(e.data);
      return {
        header: e.data.subarray(0, 16),
        rows: Array.from({ length: t.count }, (_, i) => {
          const r = view(t.row(i));
          const at = Number(r.getBigUint64(0, true));
          let end = at;
          while (e.data[end]) end++;
          const raw = e.data.subarray(at, end);
          const cue = new TextDecoder().decode(raw.subarray(raw.lastIndexOf(0x08) + 1));
          return { raw, id: r.getBigUint64(8, true), cue };
        }),
      };
    });
    // A cue appears in its chapter's table and again in the last, combined table.
    this.cues = new Map(); // cue -> Set of table indices
    this.tables.forEach((t, ti) => t.rows.forEach((r) => {
      if (!this.cues.has(r.cue)) this.cues.set(r.cue, new Set());
      this.cues.get(r.cue).add(ti);
    }));
    this.removed = new Set();
  }

  isVoiced(cue) { return this.cues.has(cue) && !this.removed.has(cue); }
  hadVoice(cue) { return this.cues.has(cue); }

  setVoiced(cue, on) {
    if (!this.cues.has(cue)) return;
    if (on) this.removed.delete(cue); else this.removed.add(cue);
  }

  get dirty() { return this.removed.size > 0; }

  async encode() {
    const touched = new Set([...this.removed].flatMap((c) => [...this.cues.get(c)]));
    const entries = this.dat.pakd.entries.map((e, i) => (touched.has(i) ? this.buildTable(this.tables[i]) : e.data));
    return encodeDat(buildPakd(entries), this.dat.entryName);
  }

  buildTable(t) {
    const rows = t.rows.filter((r) => !this.removed.has(r.cue));
    const base = 16 + rows.length * 16;
    const size = base + rows.reduce((a, r) => a + r.raw.length + 1, 0);
    const out = new Uint8Array((size + 1 + 15) & ~15); // align16(len + 1), as the game pads
    out.set(t.header, 0);
    const v = view(out);
    v.setUint32(4, rows.length, true);
    let p = base;
    rows.forEach((r, i) => {
      v.setBigUint64(16 + i * 16, BigInt(p), true);
      v.setBigUint64(24 + i * 16, r.id, true);
      out.set(r.raw, p);
      p += r.raw.length + 1;
    });
    return out;
  }
}

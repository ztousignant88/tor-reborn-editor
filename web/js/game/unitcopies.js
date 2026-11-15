// Battle file copies inside scene files. Story steps that add characters
// (AddGuest, AddUnit, AddGuestWithMessage) name a battle file and a character,
// but the game reads the unit from the scene file that is loaded when the step
// runs: pakd entry 0xD000 + n holds a copy of battle/entry/entry_unit_<n>.dat's
// unit table (its entry 0, byte for byte). The battle file itself is only read
// for battles. A join from a file the current scene doesn't carry never happens.
// web/data/unit_copies.json (tools/build_unit_copy_index.py) lists which scenes
// carry which file; copies the editor adds this session are noted on top.

import { buildPakdWithIds, isXlce, parseXlce, view } from '../lib/pakd.js';
import { encodeDat, loadDat } from './datfile.js';

export const COPY_BASE = 0xD000;
export const copyId = (file) => COPY_BASE + file;
const UNIT_ROW = 196;
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

let index = null;
const noted = new Map(); // file -> Set(scene file names) added this session

/** file number -> Set of scene file names that carry a copy. */
export async function loadCopyIndex() {
  index ??= fetch('data/unit_copies.json').then((r) => (r.ok ? r.json() : { files: {} })).catch(() => ({ files: {} }))
    .then((j) => new Map(Object.entries(j.files ?? {}).map(([n, names]) => [Number(n), new Set(names)])));
  const out = new Map([...(await index)].map(([n, s]) => [n, new Set(s)]));
  for (const [n, s] of noted) for (const name of s) (out.get(n) ?? out.set(n, new Set()).get(n)).add(name);
  return out;
}

/** Remember that a scene now carries a copy of `file` (until the page reloads). */
export function noteCopy(file, sceneFileName) {
  (noted.get(file) ?? noted.set(file, new Set()).get(file)).add(sceneFileName);
}

const unitRows = (data) => {
  if (!isXlce(data)) return null;
  const t = parseXlce(data);
  return t.rowSize === UNIT_ROW ? Array.from({ length: t.count }, (_, i) => t.row(i)) : null;
};
const character = (row) => view(row).getUint16(0, true);

/** The copy's row for `char` (a view into `data`), or null. */
export function copyRow(data, char) {
  return unitRows(data)?.find((r) => character(r) === char) ?? null;
}

/** A unit table with `row` added after its last unit (padded like the game's: align16(length + 1)). */
export function appendRow(table, row) {
  const count = view(table).getUint32(4, true), head = view(table).getUint32(8, true);
  const used = head + (count + 1) * UNIT_ROW;
  const out = new Uint8Array((used + 1 + 15) & ~15);
  out.set(table.subarray(0, head + count * UNIT_ROW));
  out.set(row, head + count * UNIT_ROW);
  view(out).setUint32(4, count + 1, true);
  return out;
}

/**
 * Bring a scene's copy in step with a battle file edit (unit table old -> new).
 * A copy equal to the old table becomes the new one. Otherwise only the bytes
 * the edit changed are carried over, row by row, so changes made to the copy
 * itself (a joining unit's level) stay: rows are matched by position when all
 * three tables have the same number of units, else by character. Returns the
 * new copy, `copy` itself when there is nothing to change, or null when no
 * row could be matched.
 */
export function mergeCopy(copy, oldTable, newTable) {
  if (sameBytes(copy, newTable)) return copy;
  if (sameBytes(copy, oldTable)) return newTable.slice();
  const out = copy.slice();
  const c = unitRows(out), o = unitRows(oldTable), n = unitRows(newTable);
  if (!c || !o || !n) return null;
  const carry = (cr, or, nr) => { for (let k = 0; k < UNIT_ROW; k++) if (or[k] !== nr[k]) cr[k] = nr[k]; };
  if (c.length === o.length && o.length === n.length) {
    c.forEach((cr, i) => carry(cr, o[i], n[i]));
  } else {
    const only = (rows, ch) => { const m = rows.filter((r) => character(r) === ch); return m.length === 1 ? m[0] : null; };
    let matched = false;
    for (const cr of c) {
      const ch = character(cr);
      const or = ch && only(o, ch), nr = ch && only(n, ch);
      if (!or || !nr) continue;
      carry(cr, or, nr);
      matched = true;
    }
    if (!matched) return null;
  }
  return sameBytes(out, copy) ? copy : out;
}

/**
 * Scene files to rewrite after battle files change. changes: [{ file, oldTable,
 * newTable }]. Scenes in `skip` (names) are left out: the caller updates its own
 * copy of them. Returns { files: [{ path, bytes, originalSize }], updated: [names],
 * skipped: ['C1_ST_030.dat (unit file 001)'] }.
 */
export async function syncCopies(changes, { skip = new Set(), onProgress } = {}) {
  const idx = await loadCopyIndex();
  const byScene = new Map();
  for (const ch of changes) {
    for (const name of idx.get(ch.file) ?? []) if (!skip.has(name)) (byScene.get(name) ?? byScene.set(name, []).get(name)).push(ch);
  }
  const files = [], updated = [], skipped = [];
  let done = 0;
  for (const [name, list] of byScene) {
    onProgress?.(`Updating unit copies in scene files… ${++done}/${byScene.size}`);
    let dat;
    try { dat = await loadDat(`event/scene/${name}`); } catch { continue; }
    const entries = dat.pakd.entries.map((e) => ({ id: e.id, data: e.data }));
    let changed = false;
    for (const ch of list) {
      const e = entries.find((x) => x.id === copyId(ch.file));
      if (!e) continue; // the index is older than the scene
      const merged = mergeCopy(e.data, ch.oldTable, ch.newTable);
      if (merged === null) { skipped.push(`${name} (unit file ${String(ch.file).padStart(3, '0')})`); continue; }
      if (merged !== e.data) { e.data = merged; changed = true; }
    }
    if (!changed) continue;
    files.push({ path: dat.path, bytes: await encodeDat(buildPakdWithIds(entries), dat.entryName), originalSize: dat.originalSize, dat });
    updated.push(name);
  }
  return { files, updated, skipped };
}

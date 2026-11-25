// Battle documents (one per entry_unit file), undo history and saving.

import { decodeDat, encodeDat, loadDat } from '../game/datfile.js';
import { saveDataFiles } from './savefiles.js';
import { buildEntryPack, isEmptySlot, parseEntryPack, readField, FIELD, UNIT_ROW_SIZE } from '../game/entryunit.js';
import { source, loadStartupFiles } from '../game/source.js';
import { syncCopies } from '../game/unitcopies.js';
import { parsePakd } from '../lib/pakd.js';

const ENTRY_DIR = 'battle/entry';

const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export class BattleDoc {
  constructor(dat, fileName) {
    this.dat = dat;
    this.fileName = fileName;
    this.path = `${ENTRY_DIR}/${fileName}`;
    const m = /_(\d+)\.dat$/i.exec(fileName);
    this.number = m ? Number(m[1]) : null;
    this.key = fileName.replace(/\.dat$/i, '').toLowerCase();
    // Each unit: { row: 196 bytes, sprite: [actor set, unit sprite], orig: as loaded or null if added }
    this.units = parseEntryPack(dat.pakd);
    // The editor rebuilds the whole pack on save, so refuse files it can't reproduce exactly.
    if (!sameBytes(buildEntryPack(this.units), dat.pack)) throw new Error('unexpected file layout');
    this.savedPack = dat.pack;
    this.dirty = false;
  }

  get slotCount() { return this.units.length; }
  row(i) { return this.units[i].row; }

  /** Slots that hold a unit (empty template + class means unused). */
  unitSlots() {
    const out = [];
    for (let i = 0; i < this.units.length; i++) if (!isEmptySlot(this.row(i))) out.push(i);
    return out;
  }

  build() { return buildEntryPack(this.units); }

  /** True when the file the editor would write differs from what is on disk. */
  hasChanges() { return !sameBytes(this.build(), this.savedPack); }

  isNew(slot) { return !this.units[slot].orig; }

  isFieldChanged(slot, fd) {
    const unit = this.units[slot];
    if (!unit.orig) return false; // new units carry a "new" badge instead
    return readField(unit.row, fd) !== readField(unit.orig.row, fd);
  }

  isSpriteChanged(slot) {
    const unit = this.units[slot];
    return !!unit.orig && (unit.sprite[0] !== unit.orig.sprite[0] || unit.sprite[1] !== unit.orig.sprite[1]);
  }

  bbox() {
    let maxX = 0, maxY = 0;
    for (const s of this.unitSlots()) {
      maxX = Math.max(maxX, readField(this.row(s), FIELD.x));
      maxY = Math.max(maxY, readField(this.row(s), FIELD.z));
    }
    return { maxX, maxY };
  }

  /** Mark the current state as saved. */
  markSaved(pack) {
    this.savedPack = pack;
    for (const unit of this.units) unit.orig = { row: unit.row.slice(), sprite: [...unit.sprite] };
    this.dirty = false;
  }
}

/** Load every entry_unit file. Files the editor can't round-trip are skipped. */
export async function loadAllBattles(onProgress) {
  const files = (await source.list(ENTRY_DIR)).filter((f) => /\.dat$/i.test(f.name));
  let done = 0;
  const docs = await loadStartupFiles(ENTRY_DIR, files, async (f, loaded) => {
    try {
      const path = `${ENTRY_DIR}/${f.name}`;
      return new BattleDoc(loaded ? await decodeDat(path, loaded) : await loadDat(path), f.name);
    } catch (err) {
      console.warn(`skipping ${f.name}:`, err);
      return null;
    } finally {
      onProgress?.(++done, files.length);
    }
  });
  return docs.filter(Boolean).sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.fileName.localeCompare(b.fileName));
}

/** Undo/redo shared by all battles: byte patches plus unit inserts and removals. */
export class History {
  constructor(onChange) {
    this.done = [];
    this.undone = [];
    this.onChange = onChange;
  }

  /**
   * Write `bytes` into unit `slot` at `offset`. `sprite`, when given, replaces
   * the unit's sprite pair in the same step (class/template changes).
   */
  apply(doc, slot, offset, bytes, label, sprite = null) {
    const unit = doc.units[slot];
    const before = unit.row.slice(offset, offset + bytes.length);
    const spriteBefore = [...unit.sprite];
    const spriteAfter = sprite ? [...sprite] : spriteBefore;
    if (sameBytes(before, bytes) && sameBytes(spriteBefore, spriteAfter)) return false;
    this.push({ kind: 'patch', doc, slot, offset, before, after: bytes.slice(), spriteBefore, spriteAfter, label });
    return true;
  }

  /** `effect(forward)`, when given, runs after the step is done (true) or undone (false): stage counts, cutscenes. */
  insert(doc, index, unit, label, effect = null) {
    this.push({ kind: 'insert', doc, index, unit, label, effect });
  }

  remove(doc, index, label, effect = null) {
    this.push({ kind: 'remove', doc, index, unit: doc.units[index], label, effect });
  }

  push(op) {
    run(op, true);
    this.done.push(op);
    this.undone.length = 0;
    this.onChange?.();
  }

  undo() { return this.step(this.done, this.undone, false); }
  redo() { return this.step(this.undone, this.done, true); }

  step(from, to, forward) {
    const op = from.pop();
    if (!op) return null;
    run(op, forward);
    to.push(op);
    this.onChange?.();
    return op;
  }

  clear() { this.done.length = 0; this.undone.length = 0; this.onChange?.(); }
}

function run(op, forward) {
  const { doc } = op;
  if (op.kind === 'patch') {
    const unit = doc.units[op.slot];
    unit.row.set(forward ? op.after : op.before, op.offset);
    unit.sprite = [...(forward ? op.spriteAfter : op.spriteBefore)];
  } else if ((op.kind === 'insert') === forward) {
    doc.units.splice(op.index, 0, op.unit);
  } else {
    doc.units.splice(op.index, 1);
  }
  doc.dirty = doc.hasChanges();
  op.effect?.(forward);
}

export function newUnit(row, sprite) {
  if (row.length !== UNIT_ROW_SIZE) throw new Error('bad unit row');
  return { row: row.slice(), sprite: [...sprite], orig: null };
}

/**
 * Write every dirty battle back to the game folder (see savefiles.js), with
 * the scene files that carry a copy of it (joins read those: unitcopies.js).
 * Returns { saved: paths, scenes: scene files updated, skipped: copies left alone }.
 */
export async function saveBattles(docs, { onProgress } = {}) {
  const dirty = docs.filter((d) => d.dirty);
  if (!dirty.length) return { saved: [], scenes: [], skipped: [] };

  const encoded = [];
  const changes = [];
  for (const doc of dirty) {
    const pack = doc.build();
    encoded.push({ doc, pack, bytes: await encodeDat(pack) });
    const oldTable = parsePakd(doc.savedPack).entries[0].data, newTable = parsePakd(pack).entries[0].data;
    if (doc.number !== null && !sameBytes(oldTable, newTable)) changes.push({ file: doc.number, oldTable, newTable });
  }
  const copies = changes.length ? await syncCopies(changes, { onProgress }) : { files: [], updated: [], skipped: [] };
  await saveDataFiles([
    ...encoded.map(({ doc, bytes }) => ({ path: doc.path, bytes, originalSize: doc.dat.originalSize, dat:doc.dat })),
    ...copies.files,
  ]);

  for (const { doc, pack, bytes } of encoded) {
    doc.dat.originalSize = bytes.length;
    doc.markSaved(pack);
  }
  return { saved: [...encoded.map((e) => e.doc.path), ...copies.files.map((f) => f.path)], scenes: copies.updated, skipped: copies.skipped };
}

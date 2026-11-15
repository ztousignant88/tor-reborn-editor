// Chapter files: Data/event/chapter/chapter_<x>.dat (pakd, IDs 1, 2, 3, 6).
//   id 1 "PGRS" story steps: u16 ?, u16 count, then 44-byte records (layout
//        from Asvel's ExtractScreenplay): stage, map, scene, invk, task,
//        next scene, next task, ..., flags +0x1E (bit 7: has a script), menu task
//        type +0x1F, param1 +0x20, param2 +0x22, next "other" +0x24 (1 = world map).
//        Menu task 1 = AddGuest(entry_unit_<p1>, character p2),
//        2 = AddUnit (joins for good), 13 = AddGuestWithMessage.
//        Steps whose scene has no script just run their menu task: after the
//        opening scene, steps 3 and 4 add Vyce and Catiua as guests.
//   id 2 "INVK", id 3 "TASK": conditions and flag tasks (kept as they are).
//   id 6 messages: xlce of 24-byte rows [u16 msg, u16 speaker (character,
//        255 = leader/none), u16 page, u16 0, u64 key offset, u64 extra],
//        then the NUL-terminated keys in row order. A message's pages share
//        its msg id. Talk commands in scene scripts name msg ids. The third
//        u16 is the message's page count, repeated on each of its rows (true
//        of every row in every chapter), and a message's rows are contiguous.
// New messages are appended. Every chapter keeps its story steps sorted by
// scene ID, so a new step, which takes the next free ID, goes at the end of the
// list; nextScene links put it in the story. Such a step runs when it is linked
// in before the story returns to the world map (Deneb cameo v19, v25); one
// linked after that return didn't (v18). A step that adds a character reads the
// unit from the current scene file's copy of the unit file (unitcopies.js).

import { buildPakdWithIds, view } from '../lib/pakd.js';
import { encodeDat, loadDat } from './datfile.js';
import { InvocationBank, parseSceneTriggers } from './scenetriggers.js';
import {SceneTasks, encodeTask} from './scenetasks.js';

const PGRS = 0x53524750;
const RECORD = 44;
export const MENU = { addGuest: 1, addUnit: 2, addGeneralUnit:3, removeGuest: 4, addGuestWithMessage: 13 };
const align16p1 = (n) => (n + 1 + 15) & ~15;
const cstr = (d, o) => { let e = o; while (d[e]) e++; return d.subarray(o, e); };

export class ChapterFile {
  static async load(chapter) {
    return new ChapterFile(await loadDat(`event/chapter/${chapter.file}.dat`), chapter);
  }

  constructor(dat, chapter) {
    this.dat = dat;
    this.chapter = chapter;
    this.path = dat.path;
    this.entries = dat.pakd.entries.map((e) => ({ id: e.id, data: e.data }));
    this.msgEntry = this.entries.find((e) => e.id === 6);
    this.pgrsEntry = this.entries.find((e) => view(e.data).getUint32(0, true) === PGRS);
    this.taskEntry=this.entries.find(e=>view(e.data).getUint32(0,true)===0x4b534154);
    this.taskBank=new SceneTasks(this.taskEntry.data);
    this.rows = this.readRows();
    this.records = this.readRecords();
    this.triggers = parseSceneTriggers(this.entries.find(e => e.data[0] === 73 && e.data[1] === 78 && e.data[2] === 86 && e.data[3] === 75)?.data);
    this.invkEntry=this.entries.find(e=>e.data[0]===73&&e.data[1]===78&&e.data[2]===86&&e.data[3]===75);
    this.invocations=null;
    this.originalRows = this.rows.length;
    this.originalRecords = this.records.length;
    this.addedScenes = new Set();
    this.edited = false;
  }

  readRows() {
    const d = this.msgEntry.data;
    const v = view(d);
    const count = v.getUint32(4, true), head = v.getUint32(8, true), size = v.getUint32(12, true);
    return Array.from({ length: count }, (_, i) => {
      const o = head + i * size;
      return {
        msg: v.getUint16(o, true), speaker: v.getUint16(o + 2, true), page: v.getUint16(o + 4, true), pad: v.getUint16(o + 6, true),
        key: cstr(d, Number(v.getBigUint64(o + 8, true))), extra: v.getBigUint64(o + 16, true),
      };
    });
  }

  readRecords() {
    const d = this.pgrsEntry.data;
    const count = view(d).getUint16(6, true);
    return Array.from({ length: count }, (_, i) => d.slice(8 + i * RECORD, 8 + (i + 1) * RECORD));
  }

  /** msg id -> [text keys (pages)] */
  messages() {
    const map = new Map();
    map.speakers = new Map(); // retain the chapter message speaker, separately from script actor handles
    const dec = new TextDecoder();
    for (const r of this.rows) {
      if (!map.has(r.msg)) map.set(r.msg, []);
      map.get(r.msg).push(dec.decode(r.key));
      if (!map.speakers.has(r.msg)) map.speakers.set(r.msg, r.speaker);
    }
    return map;
  }

  get dirty() { return this.edited||!!this.invocations?.dirty; }

  invocationBank(){return this.invocations??=new InvocationBank(this.invkEntry.data);}
  refreshTriggers(){this.triggers=parseSceneTriggers(this.invocationBank().build());}

  /** Add a message with one key per page; returns its msg id. */
  addMessage(speaker, keys) {
    const msg = Math.max(0, ...this.rows.map((r) => r.msg)) + 1;
    keys.forEach((k) => this.rows.push({ msg, speaker, page: keys.length, pad: 0, key: new TextEncoder().encode(k), extra: 0n, added: true }));
    this.edited = true;
    return msg;
  }

  removeMessage(msg) {
    this.rows = this.rows.filter((r) => !r.added || r.msg !== msg);
    this.edited = this.rowsEdited() || this.addedScenes.size > 0;
  }

  rowsEdited() { return this.pagesEdited || this.rows.length !== this.originalRows || this.rows.some((r) => r.added); }

  // ---- pages of a message ----------------------------------------------------
  /** Text keys of a message's pages, in order. */
  pageKeys(msg) { const dec = new TextDecoder(); return this.rows.filter((r) => r.msg === msg).map((r) => dec.decode(r.key)); }

  /** Add a page (text key `key`) to message `msg` after page `after` (0-based; default: at the end). */
  addPage(msg, key, after = null) {
    const first = this.rows.findIndex((r) => r.msg === msg);
    if (first < 0) throw new Error(`message ${msg} is not in this chapter`);
    const count = this.rows.filter((r) => r.msg === msg).length;
    if (count >= 255) throw new Error('a message can have at most 255 pages');
    const at = first + Math.min(count, after === null ? count : after + 1);
    const like = this.rows[first];
    this.rows.splice(at, 0, { msg, speaker: like.speaker, page: count + 1, pad: like.pad, key: new TextEncoder().encode(key), extra: 0n, added: true });
    for (const r of this.rows) if (r.msg === msg) r.page = count + 1;
    this.pagesEdited = true;
    this.edited = true;
  }

  /** Remove page `index` (0-based) of message `msg`; a message keeps at least one page. */
  removePage(msg, index) {
    const rows = this.rows.filter((r) => r.msg === msg);
    if (rows.length < 2) throw new Error('a line needs at least one page; delete the step instead');
    if (!rows[index]) throw new Error('no such page');
    this.rows.splice(this.rows.indexOf(rows[index]), 1);
    for (const r of this.rows) if (r.msg === msg) r.page = rows.length - 1;
    this.pagesEdited = true;
    this.edited = true;
  }

  /** The message rows and edit flags, to put back with restoreRows (undo). */
  snapshotRows() { return { rows: this.rows.map((r) => ({ ...r })), edited: this.edited, pagesEdited: !!this.pagesEdited }; }
  /** The edited flag is never lowered here: other panels (after events, battle rules) may have set it since. */
  restoreRows(s) { this.rows = s.rows.map((r) => ({ ...r })); this.edited = this.edited || s.edited; this.pagesEdited = s.pagesEdited; }

  // ---- story steps ---------------------------------------------------------
  record(i) {
    const v = view(this.records[i]);
    return {
      i, stage: v.getUint16(0, true), map: v.getUint16(2, true), scene: v.getUint16(4, true), nextScene: v.getUint16(10, true),
      invk: v.getUint16(6, true), task: v.getUint16(8, true), extraTask:v.getUint16(12,true), battleStage: v.getUint16(0x10, true),
      flags: this.records[i][0x1E], menuType: this.records[i][0x1F], menuP1: v.getUint16(0x20, true), menuP2: v.getUint16(0x22, true),
      nextOther: this.records[i][0x24],
    };
  }

  allRecords() { return this.records.map((_, i) => this.record(i)); }

  /**
   * The steps that follow `sceneId` before the story moves on: script-less
   * steps (flag bit 7 clear) on the same stage, like the guest-joining steps
   * after the opening scene. Returns [sceneStep, ...chain].
   */
  chain(sceneId) {
    const all = this.allRecords();
    const first = all.find((r) => r.scene === sceneId && r.nextScene) ?? all.find((r) => r.scene === sceneId);
    if (!first) return [];
    const out = [first];
    let cur = first;
    for (let guard = 0; guard < 50 && cur.nextScene; guard++) {
      const next = all.find((r) => r.scene === cur.nextScene);
      if (!next || next.flags & 0x80 || next.stage !== cur.stage) break;
      out.push(next);
      cur = next;
    }
    return out;
  }

  /** The step in the chain after `sceneId` that returns to the world map, or null. */
  returnStep(sceneId) {
    return this.chain(sceneId).slice(1).find((r) => r.nextOther) ?? null;
  }

  /** Menu tasks the chain after `sceneId` runs. */
  joinsAfter(sceneId) {
    return this.chain(sceneId).slice(1).filter((r) => r.menuType);
  }

  /**
   * Add a step that runs a menu task (e.g. AddUnit) after the scene's chain,
   * but before any step that leaves for the world map. It takes the next free
   * scene ID and goes where that ID sorts (the end of the list); the
   * predecessor's nextScene points at it. The scene file must carry a copy of
   * unit file `param1` holding character `param2` (the Cutscenes mode adds it).
   * With `afterReturnStep`, the step goes after the step that returns to the
   * world map instead, and that return (+0x24, the only byte that marks it)
   * moves onto the new step, so the story still returns right after it.
   */
  addMenuTaskAfter(sceneId, type, param1, param2, { afterReturnStep = false } = {}) {
    const chain = this.chain(sceneId);
    if (!chain.length) throw new Error(`scene ${sceneId} has no story step to follow`);
    let last = chain[0];
    for (const r of chain.slice(1)) {
      if (r.nextOther) { // a map transition: join before it, or take it over
        if (afterReturnStep) last = r;
        break;
      }
      last = r;
    }
    const ids = this.allRecords().flatMap((r) => [r.scene, r.nextScene]);
    const id = Math.max(...ids) + 1;
    const template = chain.length > 1 ? chain[1] : last; // a script-less step's fields where there is one
    const rec = this.records[template.i].slice();
    const v = view(rec);
    const lastView = view(this.records[last.i]);
    v.setUint16(4, id, true); // scene
    v.setUint16(6, 0, true); // invk
    v.setUint16(8, 0, true); // task
    v.setUint16(10, lastView.getUint16(10, true), true); // goes where `last` went
    v.setUint16(12, 0, true); // next task
    rec[0x1E] = 0; // flags: no script
    rec[0x1F] = type;
    v.setUint16(0x20, param1, true);
    v.setUint16(0x22, param2, true);
    rec[0x24] = 0; // next other
    if (last.nextOther) { rec[0x24] = last.nextOther; this.records[last.i][0x24] = 0; } // the transition moves after the join
    lastView.setUint16(10, id, true); // chain -> new step
    const at = this.records.findIndex((r) => view(r).getUint16(4, true) > id);
    this.records.splice(at < 0 ? this.records.length : at, 0, rec);
    this.addedScenes.add(id);
    this.edited = true;
    return id;
  }

  /** Remove a step added by addMenuTaskAfter, reconnecting the chain around it. */
  removeAddedStep(sceneId) {
    if (!this.addedScenes.has(sceneId)) throw new Error('only added steps can be removed');
    const i = this.records.findIndex((r) => view(r).getUint16(4, true) === sceneId);
    const next = view(this.records[i]).getUint16(10, true);
    const other = this.records[i][0x24];
    for (const r of this.records) {
      if (view(r).getUint16(10, true) !== sceneId) continue;
      view(r).setUint16(10, next, true);
      if (other) r[0x24] = other;
    }
    this.records.splice(i, 1);
    this.addedScenes.delete(sceneId);
    this.edited = this.rowsEdited() || this.addedScenes.size > 0;
  }

  // ---- in-battle events -------------------------------------------------------
  // A scene part that plays during a battle is a story step with a script
  // (flags bit 7) and an invocation: "Unit turn start" (group 1) or "Unit turn
  // end" (group 5), conditions [0x60 (2): both must hold; 0x31 local flag f = 0;
  // 0x33 the unit whose turn it is = character c], and a task that sets local
  // flag f to 1 (task opcode 2), so the part plays once. That is the stock
  // pattern (chapter 1 scene 6: Denam's first turn at Golyat, local flag 1).

  /** Local flags named by the chapter's invocations and tasks. */
  localFlagsUsed(records = this.allRecords()) {
    const used = new Set();
    for (const r of records) {
      for (const t of this.triggers.entries.get(r.invk) ?? []) for (const c of t.conditions) if (c.op === 0x31) used.add(c.args[0]);
      for (const id of [r.task, r.extraTask]) {
        let commands = [];
        try { commands = this.taskBank.commands(id); } catch { /* unknown opcode: skip */ }
        for (const c of commands) if (c.op === 2) used.add(c.args[0] | (c.args[1] << 8));
      }
    }
    return used;
  }

  /**
   * Add a once-only in-battle event to the battle of story step `like`:
   * it plays when `character`'s turn starts (group 1) or ends (group 5).
   * Returns { scene, invk, task, flag }; the scene file needs a script part
   * numbered `scene` (cutscene.js addEventPart).
   */
  addBattleEvent(like, { group, character }) {
    if (![1, 5].includes(group)) throw new Error('choose turn start or turn end');
    if (!Number.isInteger(character) || character < 1 || character > 65534 || character === 255) throw new Error('choose a named character of this battle');
    if (!like?.battleStage) throw new Error('this part is not linked to a battle');
    const everywhere = this.localFlagsUsed(), here = this.localFlagsUsed(this.allRecords().filter((r) => r.stage === like.stage));
    const free = (used) => { for (let f = 1; f < 64; f++) if (!used.has(f)) return f; return 0; };
    const flag = free(everywhere) || free(here); // one no battle of the chapter uses, else one this battle doesn't
    if (!flag) throw new Error('this battle has no free event flag left (1-63 are all in use)');
    const bank = this.invocationBank();
    const scene = Math.max(bank.nextId() - 1, ...this.allRecords().flatMap((r) => [r.scene, r.nextScene])) + 1;
    if (scene >= 0x8000) throw new Error('chapter scene numbers are used up');
    const task = this.taskBank.add(encodeTask([new Uint8Array([2, 0, flag & 255, flag >> 8, 1])]));
    bank.add(scene, group, [{ op: 0x60, args: [2] }, { op: 0x31, args: [flag, 0, 0] }, { op: 0x33, args: [0, character] }]);
    const row = this.records[like.i].slice(), v = view(row);
    v.setUint16(4, scene, true); v.setUint16(6, scene, true); v.setUint16(8, task, true);
    row.fill(0, 10, 0x10); // next scene, next task
    row.fill(0, 0x16, 0x2a); // branch guard, menu task, map transition: none
    row[0x1E] = 0x80; // has a script
    row[0x28] = 2; row[0x29] = 2; // as the stock triggered parts (scenes 6, 7, 9)
    this.records.push(row); // new numbers are the highest, so the list stays sorted
    this.addedScenes.add(scene);
    this.edited = true;
    this.refreshTriggers();
    return { scene, invk: scene, task, flag };
  }

  /** Take back an event added with addBattleEvent. */
  removeBattleEvent(ev) {
    const i = this.records.findIndex((r) => view(r).getUint16(4, true) === ev.scene);
    if (i >= 0) this.records.splice(i, 1);
    this.invocationBank().remove(ev.invk);
    this.taskBank.remove(ev.task);
    this.addedScenes.delete(ev.scene);
    this.refreshTriggers();
  }

  // ---- writing ---------------------------------------------------------------
  buildMessages() {
    const head = view(this.msgEntry.data).getUint32(8, true);
    const size = 24;
    const poolStart = head + this.rows.length * size;
    const poolLen = this.rows.reduce((n, r) => n + r.key.length + 1, 0);
    const out = new Uint8Array(align16p1(poolStart + poolLen));
    out.set(this.msgEntry.data.subarray(0, head), 0);
    const v = view(out);
    v.setUint32(4, this.rows.length, true);
    let p = poolStart;
    this.rows.forEach((r, i) => {
      const o = head + i * size;
      v.setUint16(o, r.msg, true);
      v.setUint16(o + 2, r.speaker, true);
      v.setUint16(o + 4, r.page, true);
      v.setUint16(o + 6, r.pad, true);
      v.setBigUint64(o + 8, BigInt(p), true);
      v.setBigUint64(o + 16, r.extra, true);
      out.set(r.key, p);
      p += r.key.length + 1;
    });
    return out;
  }

  buildPgrs() {
    const out = new Uint8Array(align16p1(8 + this.records.length * RECORD));
    out.set(this.pgrsEntry.data.subarray(0, 8), 0);
    view(out).setUint16(6, this.records.length, true);
    this.records.forEach((r, i) => out.set(r, 8 + i * RECORD));
    return out;
  }

  /** The pakd with rebuilt message and step tables (byte-exact when nothing changed). */
  buildPack() {
    return buildPakdWithIds(this.entries.map((e) => ({
      id: e.id, data: e === this.msgEntry ? this.buildMessages() : e === this.pgrsEntry ? this.buildPgrs() : e===this.taskEntry?this.taskBank.build():e===this.invkEntry&&this.invocations?this.invocations.build():e.data,
    })));
  }

  encode() { return encodeDat(this.buildPack(), this.dat.entryName); }
}

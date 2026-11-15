// Cutscenes: Data/event/scene/<Chapter>_ST_<n>.dat (pakd, IDs sorted). Parts used here:
//   script entries (magic 0x8000000C): one per scene part, each a main
//     script plus helper scripts;
//   the cast table (xlce, 12-byte rows: u16 character id, u16 portrait,
//     u16 default animation resource, u16 sprite set, then 4 bytes: ?, start x,
//     start y, start facing);
//   each named character's portrait (id 0x11000 + portrait, ashg) and sprite
//     set (id 0x50000 + sprite, pakd), bundled in the same file;
//   copies of the battle files the story steps after the scene add characters
//     from (id 0xD000 + file number): joins read these (unitcopies.js).
// Scripts name a named character by its character id (Deneb is actor 13
// wherever she stands in the cast); generic soldiers, which share ids, by
// cast row + 1. Actors with no cast row are party or battle units.
// Dialogue: talk(actor, msg) -> the chapter file's message table (chapter.js)
// -> LocalizeText key -> text.

import { buildPakdWithIds, isXlce, parseXlce, view } from '../lib/pakd.js';
import { ChapterFile } from './chapter.js';
import { encodeDat, loadDat } from './datfile.js';
import { NATIVES } from './natives.js';
import { encodeCall, functionOps, isScript, parseScriptFile, spliceCode, blankScriptFromTemplate } from './script.js';
import {projectCharacters,customCastLook} from './customcharacters.js';
import { source } from './source.js';
import { movementFacing } from './actorposes.js';
import { sceneActionResources } from './sceneanimations.js';
import { bodyActionDurations,effectBodyActions,weaponActionDurations } from './battleactions.js';
import {loadSpellEffects,loadEffectPlan} from './spelleffects.js';
import { copyId } from './unitcopies.js';

const CAST_ROW = 12;
export const PORTRAIT_BASE = 0x11000;
export const SPRITE_BASE = 0x50000;

export const CHAPTERS = [
  { prefix: 'C1', file: 'chapter_1', label: 'Chapter 1' },
  { prefix: 'C2a', file: 'chapter_2a', label: 'Chapter 2 (Chaos)' },
  { prefix: 'C2b', file: 'chapter_2b', label: 'Chapter 2 (Law)' },
  { prefix: 'C3a', file: 'chapter_3a', label: 'Chapter 3 (Neutral)' },
  { prefix: 'C3b', file: 'chapter_3b', label: 'Chapter 3 (Chaos)' },
  { prefix: 'C3c', file: 'chapter_3c', label: 'Chapter 3 (Law)' },
  { prefix: 'C4', file: 'chapter_4', label: 'Chapter 4' },
  { prefix: 'EP', file: 'chapter_ep', label: 'Epilogue' },
  { prefix: 'DLC', file: 'chapter_dlc', label: 'DLC' },
];

export const chapterOf = (fileName) => CHAPTERS.find((c) => fileName.toLowerCase().startsWith(`${c.prefix.toLowerCase()}_`)) || null;

export async function listSceneFiles() {
  const files = (await source.list('event/scene')).filter((f) => /\.dat$/i.test(f.name));
  return files.map((f) => ({ ...f, id: f.name.replace(/\.dat$/i, ''), chapter: chapterOf(f.name) }));
}

const chapters = new Map();

/** The chapter file (messages and story steps), loaded once and shared. */
export function loadChapter(chapter) {
  if (!chapters.has(chapter.file)) chapters.set(chapter.file, ChapterFile.load(chapter));
  return chapters.get(chapter.file);
}

/** Forget a chapter after saving, so the next load reads it from disk. */
export function forgetChapter(chapter) { chapters.delete(chapter.file); }

/** msg id -> [text keys (pages)] for a chapter. */
export async function loadMessageTable(chapter) {
  return (await loadChapter(chapter)).messages();
}

// ---- cast ------------------------------------------------------------------

function readCastRow(row) {
  const r = view(row);
  return {
    character: r.getUint16(0, true), portrait: r.getUint16(2, true), generic: r.getUint16(4, true), animation: r.getUint16(4, true), sprite: r.getUint16(6, true),
    palette:row[8],start: { x: row[9], y: row[10], dir: row[11] },
  };
}

const isNamed = (c) => c && c.character > 0 && c.portrait > 0 && c.sprite > 0;

/** Cast row index for a script actor number (-1 if the actor isn't in the cast). */
export function actorSlot(scene, actor) {
  const byId = scene.cast.findIndex((c) => isNamed(c) && c.character === actor);
  if (byId >= 0) return byId;
  return scene.cast[actor - 1]&&!isNamed(scene.cast[actor-1]) ? actor - 1 : -1;
}

/** Script actor number for a cast row. */
export const slotActor = (scene, slot) => (isNamed(scene.cast[slot]) ? scene.cast[slot].character : slot + 1);

/** Where each cast member stands when the scene starts (from the cast rows). */
export function castStarts(scene) {
  const out = new Map();
  scene.cast.forEach((c, slot) => {
    const visible = !!(c.character && (c.start.x || c.start.y));
    const resource = c.animation ? scene.animations?.get(c.animation) : null;
    if (!visible && !resource) return;
    const start = { x: c.start.x, y: c.start.y, dir: c.start.dir&3 };
    if (!visible) start.visible = false; // retain a prop's default artwork for a later placement
    if (resource) {
      start.animation = { index: null, key: `cast:${slot}`, start: 0, resource };
      if (!c.sprite) start.defaultAnimation = start.animation;
    }
    out.set(slotActor(scene, slot), start);
  });
  return out;
}

/** Characters seen in any cutscene cast, with a scene that bundles their portrait and sprites. */
let castIndex = null;
export function loadCastIndex() {
  castIndex ??= Promise.all([fetch('data/cast_index.json').then(r=>r.ok?r.json():{looks:[]}),projectCharacters()]).then(([j,characters])=>[...j.looks,...characters.map(customCastLook)]);
  return castIndex;
}

export async function loadCutscene(fileName) {
  const dat = await loadDat(`event/scene/${fileName}`);
  const entries = dat.pakd.entries.map((e) => ({ id: e.id, data: e.data, offset: e.offset }));
  const parts = [];
  let castEntry = null;
  for (const e of entries) {
    if (isScript(e.data)) {
      const file = parseScriptFile(e.data);
      const main = file.scripts[0];
      parts.push({ entryId: e.id, data: e.data, offset: e.offset, origLength: e.data.length, file, name: main?.name ?? `entry ${e.id}`, helpers: file.scripts.slice(1).map((s) => s.name) });
    } else if (!castEntry && isXlce(e.data) && parseXlce(e.data).rowSize === CAST_ROW) {
      castEntry = e;
    }
  }
  const scene = {
    fileName, chapter: chapterOf(fileName), dat, parts, castEntry, entries,
    originalPack: dat.pack.slice(),
    added: new Set(), // entry ids copied in from other scenes
    remaps: new Map(), // cast slot -> script values changed when its character was swapped
    copyOriginals: new Map(), // unit file copies changed (unitcopies.js): entry id -> data as loaded, null if added
  };
  readCast(scene);
  scene.animations = sceneActionResources(scene);
  const [durations,casts,weapons]=await Promise.all([bodyActionDurations(),effectBodyActions(),weaponActionDurations()]);
  for(const part of parts){part.bodyDurations=durations;part.castActions=casts;part.weaponDurations=weapons;}
  // Native 258 waits for the whole ability. A body's final sprite frame is
  // not the end of its particles; share the effect viewer's compiled lifetime.
  await refreshEffectDurations(scene);
  scene.original = scene.castRows.map((r) => r.slice());
  return scene;
}

export async function refreshEffectDurations(scene){
  const parts=scene.parts,effectDurations=scene.effectDurations??=new Map();
  for(const part of parts)part.effectDurations=effectDurations;
  const effectIds=[...new Set(parts.flatMap(part=>buildTimeline(part).filter(s=>s.kind==='cast'&&Number.isInteger(s.effect)&&!effectDurations.has(s.effect)).map(s=>s.effect)))];
  if(effectIds.length){
    try{
      const bank=await loadSpellEffects();
      await Promise.all(effectIds.map(async id=>{if(id>=0&&id<bank.effects.count)effectDurations.set(id,(await loadEffectPlan(bank,id)).duration);}));
    }catch(error){scene.effectPreviewError=error.message;}
  }
}

function readCast(scene) {
  const table = scene.castEntry ? parseXlce(scene.castEntry.data) : null;
  scene.castRows = table ? Array.from({ length: table.count }, (_, i) => table.row(i)) : [];
  scene.cast = scene.castRows.map(readCastRow);
  for(const part of scene.parts)part.castActors=scene.cast.map((_,i)=>slotActor(scene,i));
}

export const hasEntry = (scene, id) => scene.entries.some((e) => e.id === id);
export const isAddedSlot = (scene, slot) => slot >= scene.original.length;
export const castChanged = (scene, slot) => isAddedSlot(scene, slot) || scene.castRows[slot].some((b, i) => b !== scene.original[slot][i]);
export const partChanged = (scene, part) => !!part.isNew || part.data.length !== part.origLength
  || part.data.some((b, i) => b !== scene.originalPack[part.offset + i]);
export const sceneDirty = (scene) => scene.added.size > 0 || scene.castRows.length !== scene.original.length
  || scene.castRows.some((_, i) => castChanged(scene, i)) || scene.parts.some((p) => partChanged(scene, p)) || copiesChanged(scene);

// ---- battle file copies (what joins read: see unitcopies.js) ----------------

/** The scene's copy of battle file `file`'s unit table, or null. */
export const unitCopy = (scene, file) => scene.entries.find((e) => e.id === copyId(file))?.data ?? null;

/** Replace (or add) the scene's copy of battle file `file`. */
export function setUnitCopy(scene, file, data) {
  const id = copyId(file);
  const e = scene.entries.find((x) => x.id === id);
  if (!scene.copyOriginals.has(id)) scene.copyOriginals.set(id, e ? e.data : null);
  if (e) e.data = data;
  else {
    scene.entries.push({ id, data });
    scene.entries.sort((a, b) => a.id - b.id);
  }
}

/** Put the copy back as loaded (an added one goes). */
export function revertUnitCopy(scene, file) {
  const id = copyId(file);
  if (!scene.copyOriginals.has(id)) return;
  const original = scene.copyOriginals.get(id);
  if (original) scene.entries.find((x) => x.id === id).data = original;
  else scene.entries.splice(scene.entries.findIndex((x) => x.id === id), 1);
  scene.copyOriginals.delete(id);
}

/** True when the copy was added or changed since the scene was loaded. */
export const copyTouched = (scene, file) => scene.copyOriginals.has(copyId(file));

function copiesChanged(scene) {
  for (const [id, original] of scene.copyOriginals) {
    const now = scene.entries.find((x) => x.id === id)?.data ?? null;
    if (!original || !now || original.length !== now.length || original.some((b, i) => b !== now[i])) return true;
  }
  return false;
}

/** Copy a character's portrait and sprite set in from a donor scene if this file lacks them. */
async function ensureResources(scene, look) {
  const need = [PORTRAIT_BASE + look.portrait, SPRITE_BASE + look.sprite].filter((id) => !hasEntry(scene, id));
  if(look.custom&&need.length){
    const object=await loadDat(`object/${look.custom.stem}00.dat`);
    for(const [id,sourceId]of [[PORTRAIT_BASE+look.portrait,0x10000+look.portrait],[SPRITE_BASE+look.sprite,look.sprite]])if(need.includes(id)){
      const entry=object.pakd.entries.find(e=>e.id===sourceId);if(!entry)throw new Error('Project character art is incomplete');
      scene.entries.push({id,data:entry.data.slice()});scene.added.add(id);need.splice(need.indexOf(id),1);
    }
  }
  for (const donorName of need.length ? look.donors : []) {
    const donor = await loadDat(`event/scene/${donorName}`);
    for (const id of [...need]) {
      const e = donor.pakd.entries.find((x) => x.id === id);
      if (!e) continue;
      scene.entries.push({ id, data: e.data.slice() });
      scene.added.add(id);
      need.splice(need.indexOf(id), 1);
    }
    if (!need.length) break;
  }
  if (need.length) throw new Error(`couldn't find resources ${need.map((n) => `0x${n.toString(16)}`).join(', ')} in the donor scenes`);
  scene.entries.sort((a, b) => a.id - b.id);
}

async function lookPalette(look){
  if(Number.isInteger(look.palette))return look.palette;
  for(const name of look.donors??[]){
    const donor=await loadDat(`event/scene/${name}`);
    for(const e of donor.pakd.entries){
      if(!isXlce(e.data))continue;
      const table=parseXlce(e.data);if(table.rowSize!==CAST_ROW)continue;
      for(let i=0;i<table.count;i++){
        const r=table.row(i),c=readCastRow(r);
        if(c.character===look.character&&c.sprite===look.sprite)return r[8];
      }
    }
  }
  return 0;
}

// Natives whose first argument is an actor (besides the step kinds the
// timeline decodes): numbered actor_* natives, binds, talk, and a few
// unnamed ones seen with actor numbers.
const ACTOR_FIRST = new Set([105, 106, 161, 165, 175, 125]);
const takesActor = (native, name) => ACTOR_FIRST.has(native) || name.startsWith('actor_')
  || (native >= 27 && native <= 32) || (native >= 288 && native <= 293);

/** Every immediate actor argument equal to `actor`, across all parts. */
function actorRefs(scene, actor) {
  const out = [];
  for (const part of scene.parts) {
    for (const s of part.file.scripts) {
      for (const fn of s.functions) {
        for (const op of functionOps(part.file, s, fn)) {
          const a = op.type === 'call' && takesActor(op.native, op.name) ? op.args[0] : null;
          if (a?.kind === 'imm' && a.value === actor) out.push({ part, at: a.at });
        }
      }
    }
  }
  return [...new Map(out.map((r) => [`${r.part.entryId}:${r.at}`, r])).values()];
}

/**
 * Give cast slot `slot` (0-based) another character's look. Their portrait
 * and sprite set are copied in from a donor scene when needed. A named
 * character is addressed by id, so the scripts' references to the old
 * character are renamed too (and put back by revertCastSlot).
 */
export async function setCastLook(scene, slot, look) {
  if (scene.cast.some((c, i) => i !== slot && isNamed(c) && c.character === look.character)) {
    throw new Error('that character is already in this scene’s cast');
  }
  await ensureResources(scene, look);
  const previous = scene.remaps.get(slot);
  undoRemap(scene, slot);
  // what the scripts call this slot: its character id, or row + 1 for a generic unit
  const before = scene.cast[slot];
  const from = previous ? previous.from : isNamed(before) ? before.character : slot + 1;
  const ambiguous = !isNamed(before) && scene.cast.some((c) => isNamed(c) && c.character === from);
  const r = view(scene.castRows[slot]);
  r.setUint16(0, look.character, true);
  r.setUint16(2, look.portrait, true);
  r.setUint16(4, 0, true);
  r.setUint16(6, look.sprite, true);
  scene.castRows[slot][8]=await lookPalette(look);
  if (from !== look.character && !ambiguous) {
    const refs = actorRefs(scene, from);
    for (const ref of refs) view(ref.part.data).setInt16(ref.at + 1, look.character, true);
    scene.remaps.set(slot, { refs, from });
    reparse(scene);
  }
  scene.cast[slot] = readCastRow(scene.castRows[slot]);
  for(const part of scene.parts)part.castActors=scene.cast.map((_,i)=>slotActor(scene,i));
}

function undoRemap(scene, slot) {
  const m = scene.remaps.get(slot);
  if (!m) return;
  for (const ref of m.refs) view(ref.part.data).setInt16(ref.at + 1, m.from, true);
  scene.remaps.delete(slot);
  reparse(scene);
}

export function revertCastSlot(scene, slot) {
  if (isAddedSlot(scene, slot)) { removeCastRow(scene, slot); return; }
  undoRemap(scene, slot);
  scene.castRows[slot].set(scene.original[slot]);
  scene.cast[slot] = readCastRow(scene.castRows[slot]);
  for(const part of scene.parts)part.castActors=scene.cast.map((_,i)=>slotActor(scene,i));
}

function writeCastTable(scene, rows) {
  const head = scene.castEntry.data.subarray(0, 16);
  const out = new Uint8Array((16 + rows.length * CAST_ROW + 1 + 15) & ~15); // align16(len + 1)
  out.set(head, 0);
  view(out).setUint32(4, rows.length, true);
  rows.forEach((r, i) => out.set(r, 16 + i * CAST_ROW));
  scene.castEntry.data = out;
  readCast(scene);
}

/** Add a character to the cast; returns their script actor number. */
export async function addCastRow(scene, look, start = { x: 0, y: 0, dir: 0 }) {
  if (!scene.castEntry) throw new Error('this scene has no cast table');
  if (scene.cast.some((c) => isNamed(c) && c.character === look.character)) throw new Error('that character is already in this scene’s cast');
  await ensureResources(scene, look);
  const row = new Uint8Array(CAST_ROW);
  const v = view(row);
  v.setUint16(0, look.character, true);
  v.setUint16(2, look.portrait, true);
  v.setUint16(6, look.sprite, true);
  row.set([await lookPalette(look), start.x, start.y, start.dir], 8);
  writeCastTable(scene, [...scene.castRows.map((r) => r.slice()), row]);
  return look.character;
}

/** Set an added character's start position bytes (the game's rows match each character's first placement). */
export function setCastStart(scene, slot, start) {
  scene.castRows[slot].set([start.x, start.y, start.dir], 9);
  scene.cast[slot] = readCastRow(scene.castRows[slot]);
}

export function removeCastRow(scene, slot) {
  if (!isAddedSlot(scene, slot)) throw new Error('only added cast rows can be removed');
  writeCastTable(scene, scene.castRows.filter((_, i) => i !== slot).map((r) => r.slice()));
}

// ---- commands --------------------------------------------------------------

function reparse(scene) {
  for (const part of scene.parts) part.file = parseScriptFile(part.data);
}

function setPartData(scene, part, data) {
  part.data = data;
  part.file = parseScriptFile(data);
  const e = scene.entries.find((x) => x.id === part.entryId);
  e.data = data;
}

/** Instruction range [start, count] of a step's command: its argument pushes and the call. */
export function stepRange(part, step) {
  const code = part.file.scripts[step.script].code;
  const call = code.findIndex((c) => c.at === step.at);
  if (call < 0) throw new Error('command not found in its script');
  let start = call;
  const pushed = (step.refs ?? []).filter((r) => r.at !== null && r.at !== undefined).length;
  for (let k = 0; k < pushed && start > 0; k++) {
    const op = code[start - 1].op;
    if (!(op === 79 || op === 78 || op === 80 || op === 72 || (op >= 62 && op <= 65))) break;
    start--;
  }
  return [start, call - start + 1];
}

/**
 * Insert commands ([{native, args}]) into script `si` of a part before
 * instruction `index`. Positions after the edit move with the code.
 */
export function insertCommands(scene, part, si, index, commands) {
  const bytes = commands.map((c) => encodeCall(c.native, c.args));
  const all = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of bytes) { all.set(b, o); o += b.length; }
  setPartData(scene, part, spliceCode(part.data, si, index, 0, all));
}

/** Unscripted battle records in this archive, including alternate encounter variants. */
export function battleDraftRecords(scene) {
  const stage=Number(/_ST_(\d+)/i.exec(scene?.fileName??'')?.[1]);
  return (scene?.chapterFile?.allRecords()??[]).filter(r=>r.stage===stage&&r.battleStage&&!scene.entries.some(e=>e.id===r.scene));
}

/** Resolve the displayed existing part or selected battle draft to its chapter record. */
export function sceneRecord(scene,part,draftIndex=null) {
  const stage=Number(/_ST_(\d+)/i.exec(scene?.fileName??'')?.[1]);
  const records=scene?.chapterFile?.allRecords().filter(r=>r.stage===stage)??[];
  if(part)return records.find(r=>r.scene===part.entryId)??null;
  const drafts=battleDraftRecords(scene);
  return drafts.find(r=>r.i===draftIndex)??drafts[0]??(records.length===1?records[0]:null);
}

/** Create the scene resource expected by a linked, previously scriptless chapter record. */
export async function addBattleScenePart(scene,record) {
  if(!record?.battleStage||!record.scene||record.stage!==Number(/_ST_(\d+)/i.exec(scene.fileName)?.[1]))throw new Error('A new cutscene needs an unambiguous battle-linked story record.');
  if(scene.entries.some(e=>e.id===record.scene))throw new Error('That scene resource ID is already occupied.');
  const template=await loadCutscene('C1_ST_010.dat'),donor=template.parts[0];
  const data=blankScriptFromTemplate(donor.data),file=parseScriptFile(data);
  const part={entryId:record.scene,data,file,offset:-1,origLength:0,isNew:true,name:file.scripts[0].name,helpers:[],animations:[],castActors:[],
    bodyDurations:donor.bodyDurations,castActions:donor.castActions,weaponDurations:donor.weaponDurations};
  scene.entries.push({id:part.entryId,data});scene.entries.sort((a,b)=>a.id-b.id);scene.parts.push(part);
  return part;
}

const EMPTY_INDEX = new Uint8Array([0x49, 0x44, 0x58, 0x30, 0, 0, 0xFF, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0]); // 'IDX0', no resources (as C1_ST_020 entry 0x8006)

/** A new, empty part for an in-battle event (chapter.js addBattleEvent), with the empty resource index stock parts have. */
export async function addEventPart(scene, record) {
  const part = await addBattleScenePart(scene, record);
  const id = 0x8000 + record.scene;
  if (!scene.entries.some((e) => e.id === id)) { scene.entries.push({ id, data: EMPTY_INDEX.slice() }); scene.entries.sort((a, b) => a.id - b.id); }
  part.addedEvent = true;
  // Stock in-battle parts end with native 1 before their return (the smallest,
  // C1_ST_020 cut_scene_1_120, is just a tutorial call, native 1, return).
  const main = part.file.scripts[0];
  insertCommands(scene, part, 0, main.functions[main.events[0] >= 0 ? main.events[0] : 0].start, [{ native: 1, args: [] }]);
  return part;
}

/** Insert before a step's command (or at the start of the main function with no step). */
export function insertBefore(scene, part, step, commands) {
  if (step) {
    const [start] = stepRange(part, step);
    insertCommands(scene, part, step.script, start, commands);
  } else {
    const main = part.file.scripts[0];
    const fn = main.functions[main.events[0] >= 0 ? main.events[0] : 0];
    insertCommands(scene, part, 0, fn.start, commands);
  }
}

/** Insert at the end of the part's main script: before its closing command (native 1) where it has one. */
export function insertAtEnd(scene, part, commands) {
  const main = buildTimeline(part).filter((s) => s.script === 0);
  const close = main.filter((s) => s.native === 1).at(-1);
  if (close) insertBefore(scene, part, close, commands);
  else if (main.length) insertAfter(scene, part, main.at(-1), commands);
  else insertBefore(scene, part, null, commands);
}

/** Insert right after a step's command. */
export function insertAfter(scene, part, step, commands) {
  const [start, count] = stepRange(part, step);
  insertCommands(scene, part, step.script, start + count, commands);
}

export function deleteStep(scene, part, step) {
  const [start, count] = stepRange(part, step);
  setPartData(scene, part, spliceCode(part.data, step.script, start, count));
}

// ---- pieces of a step, and undo -------------------------------------------------
// A walk's via points are separate commands (103, or 117 in a helper script
// that walks its own bound actor) queued before the walk command.

/** Add a via point to walk step `move` before its via point `index` (default: last, right before the walk). */
export function addWaypoint(scene, part, move, x, y, index = null) {
  const bound = move.refs?.[0]?.kind === 'bound';
  if (!bound && typeof move.actor !== 'number') throw new Error('this walk’s character is worked out while the scene runs, so a via point can’t be added');
  const before = move.waypoints?.[index ?? Infinity] ?? move;
  const command = bound ? { native: 117, args: [x, y] } : COMMANDS.walkVia(move.actor, x, y);
  const [start] = stepRange(part, before);
  insertCommands(scene, part, before.script, start, [command]);
}

/** Remove one via point (a waypoint step) from its walk. */
export function removeWaypoint(scene, part, waypoint) { deleteStep(scene, part, waypoint); }

/** Every part's script bytes and the cast rows, to put back with restoreScripts (undo). */
export function snapshotScripts(scene) {
  return { parts: scene.parts.map((p) => ({ id: p.entryId, data: p.data.slice() })), cast: scene.castRows.map((r) => r.slice()) };
}

/** Put back a snapshotScripts() state. Returns false when the scene's parts or cast changed shape since. */
export function restoreScripts(scene, snap) {
  if (snap.parts.length !== scene.parts.length || snap.cast.length !== scene.castRows.length
    || snap.parts.some((s, i) => scene.parts[i].entryId !== s.id)) return false;
  snap.parts.forEach((s, i) => setPartData(scene, scene.parts[i], s.data.slice()));
  snap.cast.forEach((r, i) => { scene.castRows[i].set(r); scene.cast[i] = readCastRow(scene.castRows[i]); });
  return true;
}

export function revertPart(scene, part) {
  if(part.isNew){scene.entries=scene.entries.filter(e=>e.id!==part.entryId&&!(part.addedEvent&&e.id===0x8000+part.entryId));scene.parts=scene.parts.filter(p=>p!==part);return;}
  const original = scene.originalPack.slice(part.offset, part.offset + part.origLength);
  setPartData(scene, part, original);
}

/** Bytes of the scene's .dat with the cast edits and any copied-in resources. */
export async function encodeScene(scene) {
  const used = new Set();
  for (const c of scene.cast) { used.add(PORTRAIT_BASE + c.portrait); used.add(SPRITE_BASE + c.sprite); }
  // drop copied-in resources no slot uses any more (reverted or swapped again)
  const entries = scene.entries.filter((e) => !scene.added.has(e.id) || used.has(e.id));
  return encodeDat(buildPakdWithIds(entries), scene.dat.entryName);
}

// Commands the editor can add, as natives and argument lists.
export const COMMANDS = {
  place: (actor, x, y, dir) => ({ native: 143, args: [actor, x, y, dir] }),
  walkVia: (actor, x, y) => ({ native: 103, args: [actor, x, y] }),
  walk: (actor, x, y, speed = 5) => ({ native: 95, args: [actor, x, y, speed] }),
  fly: (actor, x, y, speed = 0) => ({ native: 96, args: [actor, x, y, speed] }),
  body: (actor, action) => [{ native:210,args:[actor,action] },{native:67,args:[actor]}],
  weapon: (actor, weapon = -1) => [{native:212,args:[actor,weapon]},{native:67,args:[actor]}],
  cast: (actor, effect, x, y) => ({native:258,args:[actor,effect,x,y]}),
  waitWalk: (actor) => ({ native: 105, args: [actor] }),
  face: (actor, dir) => ({ native: 47, args: [actor, dir] }),
  talk: (actor, msg, box = 27) => ({ native: box, args: [actor, msg] }),
  wait: (frames) => ({ native: 0, args: [frames] }),
  notice: (msg) => ({ native: 268, args: [msg] }),
  // Show/hide: the game fades actors with 163 and 159 together (actor, alpha, frames), then 122 waits.
  fade: (actor, alpha, frames) => [{ native: 163, args: [actor, alpha, frames] }, { native: 159, args: [actor, alpha, frames] }, { native: 122, args: [] }],
  hideNow: (actor) => [{ native: 163, args: [actor, 0, 0] }, { native: 159, args: [actor, 0, 0] }],
  showNow: (actor) => [{ native: 163, args: [actor, 255, 0] }, { native: 159, args: [actor, 255, 0] }],
};

export const TALK_BOXES = { 27: 'left lower', 28: 'left upper', 29: 'right lower', 30: 'right upper', 31: 'right middle', 32: 'left middle' };

// ---- characters added to a scene stay in its later parts ---------------------
// An added character starts every part hidden (addCharacter puts hideNow at the
// start of each part). Once placed or shown in one part, each later part starts
// with them where the previous part left them: placed there and shown at once,
// or hidden. The setup sits at the very start of the part's main function.

const SETUP = new Set([143, 163, 159]);

/** The setup steps for `actor` at the start of a part (hide-now or a carried place/show). */
function setupSteps(part, actor) {
  const main = part.file.scripts[0];
  const fn = main.functions[main.events[0] >= 0 ? main.events[0] : 0];
  const ats = new Set();
  for (const op of functionOps(part.file, main, fn)) {
    if (op.type !== 'call' || !SETUP.has(op.native) || typeof op.args[0]?.value !== 'number') break;
    if (op.args[0].value === actor) ats.add(op.at);
  }
  return buildTimeline(part).filter((s) => s.script === 0 && ats.has(s.at));
}

/** Where an added character is at the end of a part: { x, y, dir, shown } or null if never placed. */
export function addedActorEnd(scene, part, actor) {
  const steps = buildTimeline(part);
  const pos = stateAt(steps, steps.length - 1, castStarts(scene)).actors.get(actor);
  if (!pos) return null;
  let shown = false; // added characters start each part hidden
  for (const s of steps) {
    if (s.actor !== actor) continue;
    if (s.kind === 'fade' && typeof s.alpha === 'number') shown = s.alpha > 0;
    else if (s.kind === 'remove') shown = false;
  }
  return { x: pos.x, y: pos.y, dir: pos.dir ?? 0, shown };
}

/** Carry an added character from `fromPart` through every later part of the scene. */
export function carryAddedActor(scene, fromPart, actor) {
  const parts = scene.parts;
  for (let k = parts.indexOf(fromPart) + 1; k > 0 && k < parts.length; k++) {
    const end = addedActorEnd(scene, parts[k - 1], actor);
    const part = parts[k];
    for (let guard = 0; guard < 8; guard++) {
      const [s] = setupSteps(part, actor);
      if (!s) break;
      deleteStep(scene, part, s);
    }
    const cmds = [];
    if (end) cmds.push(COMMANDS.place(actor, end.x, end.y, end.dir));
    cmds.push(...(end?.shown ? COMMANDS.showNow(actor) : COMMANDS.hideNow(actor)));
    insertBefore(scene, part, null, cmds);
  }
}

/**
 * Start part `part` with added character `actor` standing at `pos` ({ x, y, dir },
 * shown at once), or hidden when pos is null, and carry that into the later parts
 * (not in a battle-map scene, whose later parts play during the battle: there a
 * unit is wherever the battle has it).
 */
export function setActorStart(scene, part, actor, pos, { carry = true } = {}) {
  clearActorStart(scene, part, actor);
  const cmds = pos ? [COMMANDS.place(actor, pos.x, pos.y, pos.dir), ...COMMANDS.showNow(actor)] : COMMANDS.hideNow(actor);
  insertBefore(scene, part, null, cmds);
  if (carry) carryAddedActor(scene, part, actor);
}

/** Remove the place / show / hide steps for `actor` at the very start of a part. */
export function clearActorStart(scene, part, actor) {
  for (let guard = 0; guard < 8; guard++) {
    const [s] = setupSteps(part, actor);
    if (!s) break;
    deleteStep(scene, part, s);
  }
}

/** Take an added character out of the scene: every command that names them, then their cast row. */
export function removeAddedActor(scene, actor) {
  const slot = scene.cast.findIndex((c, i) => isAddedSlot(scene, i) && slotActor(scene, i) === actor);
  if (slot < 0) return false;
  for (const part of scene.parts) {
    for (let guard = 0; guard < 500; guard++) {
      const s = buildTimeline(part).find((x) => x.actor === actor);
      if (!s) break;
      deleteStep(scene, part, s);
    }
  }
  removeCastRow(scene, slot);
  return true;
}

// ---- positions -------------------------------------------------------------
// Literal arguments can be replaced in place without changing branch offsets.
// Table-backed arguments become local immediates, preserving shared tables.

/** Editable fields of a step: field -> index into step.refs. */
export function stepFields(step) {
  const actor=typeof step.actor==='number'?{actor:0}:{};
  switch(step.kind){
    case 'place':return {...actor,x:1,y:2,...(step.dir!==undefined?{dir:3}:{})};
    case 'move':return {...actor,x:1,y:2,...(step.duration!==undefined?{duration:3}:step.speed!==undefined?{speed:3}:{})};
    case 'waypoint':return {...actor,x:1,y:2};
    case 'face':return {...actor,dir:1};
    case 'anim':return {...actor,anim:1};
    case 'body':return {...actor,action:1};
    case 'weapon':return {...actor,weapon:1};
    case 'cast':return {...actor,effect:1,x:2,y:3};
    case 'worldOffset':return {...actor,dx:1,dh:2,dz:3};
    case 'nudge':return {...actor,dx:1,dy:2};
    case 'talk':return {...actor,msg:1,box:-1};
    case 'narration':return {msg:step.notice?0:1};
    case 'wait':return {frames:0};
    case 'fade':return {...actor,alpha:1};
    default:return actor;
  }
}
export function fieldLock(step,field){
  if(field==='box'&&step.kind==='talk')return null;
  const ref=step.refs?.[stepFields(step)[field]];
  if(!ref||ref.at==null)return 'Controlled by the helper binding, rather than this command';
  return ['imm','int','float'].includes(ref.kind)?null:'Computed while the scene runs';
}
export function setStepField(part,step,field,value){
  const why=fieldLock(step,field);if(why)throw new Error(why);
  const n=Number(value);if(!Number.isInteger(n)||n< -32768||n>32767)throw new Error('Enter a whole number from -32768 to 32767');
  const v=view(part.data);
  if(field==='box'){
    if(!TALK[n])throw new Error('Choose a dialogue box position');
    v.setInt16(step.at+1,n+(step.native>=288?261:0),true);
  }else{
    const ref=step.refs[stepFields(step)[field]];
    // All three literal pushes are three bytes. Convert this argument to an
    // immediate, preserving branches and the shared table used elsewhere.
    part.data[ref.at]=79;v.setInt16(ref.at+1,n,true);
  }
  part.file=parseScriptFile(part.data);
}

// ---- timeline ----------------------------------------------------------
// Native numbers -> step kinds. Names follow Gibbed's notes; 95/96/102/103/
// 140-143 meanings were inferred from argument patterns (tile coordinates).
// 102 (actor, x, y, duration parameter) and 96 (Canopus flying) are how the
// Golyat pre-battle scene brings Lans's team to their battle start tiles.
const TALK = { 27: 'left lower', 28: 'left upper', 29: 'right lower', 30: 'right upper', 31: 'right middle', 32: 'left middle' };
const NARRATION = new Set([33, 34, 35, 36, 37, 38]);
const BIND = new Set([124, 125, 126, 127, 129]); // a helper takes control of an actor
const WAIT_MOVE = 105; // (actor): wait until the actor stops walking

// "current actor" natives act on the helper's bound actor; map each to the
// numbered actor native it mirrors (named current_actor_unknown_<n>).
const CURRENT = new Map([[58, 47], [69, 65], [70, 66], [74, 73], [71,67], [211,210], [213,212], [119, WAIT_MOVE]]);
for (const [n, [name]] of NATIVES) {
  const m = /^current_actor_.*_(\d+)$/.exec(name);
  if (m && !CURRENT.has(n) && NATIVES.get(Number(m[1]))?.[0].startsWith('actor_')) CURRENT.set(n, Number(m[1]));
}

// Rough timing, used only to interleave the main script with its helpers.
const FRAMES_PER_TILE = 16;
const TALK_FRAMES = 120;
const MAX_STEPS = 6000;

function toStep(native, args, base) {
  const val = (a) => (typeof a?.value === 'number' ? a.value : null);
  const a = args;
  const n = native;
  if (n === 0) return { ...base, kind: 'wait', frames: val(a[0]) ?? 0 };
  if (TALK[n]) return { ...base, kind: 'talk', actor: val(a[0]), msg: val(a[1]), box: TALK[n] };
  // Reborn adds (actor, msg, flag) versions numbered 261 higher: 288-293 talk, 294-299 messages.
  if (TALK[n - 261]) return { ...base, kind: 'talk', actor: val(a[0]), msg: val(a[1]), box: TALK[n - 261] };
  if (NARRATION.has(n) || NARRATION.has(n - 261)) return { ...base, kind: 'narration', msg: val(a[1]) };
  // 268: the notice box in the middle of the screen ("You received a White Knight's Mark."); its message row has speaker 0
  if (n === 268) return { ...base, kind: 'narration', notice: true, msg: val(a[0]) };
  if (n === 47) return { ...base, kind: 'face', actor: val(a[0]), dir: val(a[1]) };
  if (n === 140) return { ...base, kind: 'place', actor: val(a[0]), x: val(a[1]), y: val(a[2]) };
  if (n === 141) return { ...base, kind: 'nudge', actor: val(a[0]), dx: val(a[1]) ?? 0, dy: val(a[2]) ?? 0 };
  if (n === 143) return { ...base, kind: 'place', actor: val(a[0]), x: val(a[1]), y: val(a[2]), dir: val(a[3]) };
  if (n === 142) return { ...base,kind:'worldOffset',actor:val(a[0]),dx:val(a[1])??0,dh:val(a[2])??0,dz:val(a[3])??0 };
  if (n === 103) return { ...base, kind: 'waypoint', actor: val(a[0]), x: val(a[1]), y: val(a[2]) };
  if (n === 95 || n === 96) return { ...base, kind: 'move', actor: val(a[0]), x: val(a[1]), y: val(a[2]), flying:n===96,speed:val(a[3]) };
  if (n === 102) return { ...base, kind: 'move', actor: val(a[0]), x: val(a[1]), y: val(a[2]), duration: val(a[3]),retainPose:true };
  if (n === 130) return { ...base, kind: 'remove', actor: val(a[0]) };
  if (n === 65 || n === 66) return { ...base, kind: 'anim', actor: val(a[0]), anim: val(a[1]) };
  if (n === 210) return {...base,kind:'body',actor:val(a[0]),action:val(a[1])};
  if (n === 220) return {...base,kind:'death',actor:val(a[0]),action:15};
  if (n === 212) return {...base,kind:'weapon',actor:val(a[0]),weapon:val(a[1])};
  if (n === 258||n===259) return {...base,kind:'cast',actor:val(a[0]),effect:val(a[1]),x:val(a[2]),y:val(a[3])};
  if (n === 73 || n===67) return { ...base, kind: 'animWait', actor: val(a[0]) };
  if (n === 136 || n===137) return {...base,kind:'visibility',actor:val(a[0]),visible:n===136};
  if (n === 163) return { ...base, kind: 'fade', actor: val(a[0]), alpha: val(a[1]) }; // with 159: fade an actor in or out
  return { ...base, kind: 'other' };
}

/**
 * Run a scene part: every script's init, then the functions its event table
 * starts, following requests into helper scripts. Helpers run alongside the
 * main script; a rough frame clock (waits, talk, walking time) interleaves
 * their steps. Branches aren't evaluated, so optional paths all appear.
 */
export function buildTimeline(part,{weaponForActor,bindBattleActor}={}) {
  const { file } = part;
  const steps = [];
  let seq = 0;
  const bound = new Map(); // script index -> actor slot it controls
  const moveEnd = new Map(); // actor -> frame its walk ends
  const animationEnd = new Map(); // actor -> native action's end frame
  const lastPos = new Map(); // actor -> [x, y], to time walks
  const pending = new Map(); // actor -> waypoint steps before its next move
  const fnEnd = new Map(); // "script:fn" -> frame that run finished
  const tableEnd = new Map(); // request table -> frame all finished

  const run = (si, fi, t, depth) => {
    const script = file.scripts[si];
    const fn = script?.functions[fi];
    if (!fn || depth > 6) return t;
    for (const op of functionOps(file, script, fn)) {
      if (steps.length > MAX_STEPS) break;
      if (op.type === 'req') fnEnd.set(`${op.script}:${op.fn}`, run(op.script, op.fn, t, depth + 1));
      else if (op.type === 'reqwait') t = Math.max(t, fnEnd.get(`${op.script}:${op.fn}`) ?? t);
      else if (op.type === 'reqall') {
        let end = t;
        for (const r of file.requests[op.table] ?? []) {
          const e = run(r.script, r.fn, t, depth + 1);
          fnEnd.set(`${r.script}:${r.fn}`, e);
          end = Math.max(end, e);
        }
        tableEnd.set(op.table, end);
      } else if (op.type === 'reqwaitall') t = Math.max(t, tableEnd.get(op.table) ?? t);
      else {
        let native = op.native;
        let args = op.args;
        if (BIND.has(native) && typeof args[0]?.value === 'number') {
          const key=args[0].value;
          const actor=native===124||native===126?(part.castActors?.[key]??null):native===125?key:bindBattleActor?.(native,key)??null;
          bound.set(si,actor);continue;
        }
        if(native===221){native=220;args=[{value:bound.get(si)??null,at:null,kind:'bound'},...args];}
        if (CURRENT.has(native)) {
          native = CURRENT.get(native);
          args = [{ value: bound.get(si) ?? null, at: null, kind: 'bound' }, ...args];
        }
        // refs line up with the step's arguments (a helper's bound actor comes first)
        const s = toStep(native, args, { native: op.native, name: op.name, args: op.args.map((x) => x.value), refs: args, at: op.at, t, seq: seq++, script: si, by: si ? script.name : null });
        steps.push(s);
        if (s.kind === 'anim') {
          s.animationResource = part.animations?.[s.anim] ?? null;
          s.frames = s.animationResource?.definition?.duration ?? 0;
          s.animationKey = `${part.entryId}:${s.script}:${s.at}:${s.seq}`;
          animationEnd.set(s.actor, t + s.frames);
        }
        if(s.kind==='body'||s.kind==='weapon'||s.kind==='cast'||s.kind==='death'){
          if(s.kind==='cast')s.action=part.castActions?.[s.effect]??null;
          const weapon=s.kind==='weapon'?(s.weapon>0?s.weapon:weaponForActor?.(s.actor)):null;
          s.frames=s.kind==='weapon'?(part.weaponDurations?.[weapon]||60):(part.bodyDurations?.[s.action]??0);
          if(s.kind==='cast'){s.bodyFrames=s.frames;s.frames=Math.max(s.frames,part.effectDurations?.get(s.effect)??0);}
          s.animationKey=`${part.entryId}:${s.script}:${s.at}:${s.seq}`;
          animationEnd.set(s.actor,t+s.frames);
          if(s.kind==='death'||s.kind==='cast')t+=s.frames;
        }
        if (s.kind === 'wait') t += Math.max(0, s.frames);
        else if (s.kind === 'animWait') t = Math.max(t, animationEnd.get(s.actor) ?? t);
        else if (s.kind === 'talk' || s.kind === 'narration') t += TALK_FRAMES;
        else if (s.kind === 'place') lastPos.set(s.actor, [s.x, s.y]);
        else if(s.kind==='worldOffset'&&lastPos.has(s.actor)){const p=lastPos.get(s.actor);lastPos.set(s.actor,[p[0]+s.dx,p[1]+s.dz]);}
        else if (s.kind === 'waypoint') {
          if (!pending.has(s.actor)) pending.set(s.actor, []);
          pending.get(s.actor).push(s);
        } else if (s.kind === 'move') {
          s.waypoints = pending.get(s.actor) ?? [];
          s.path = [...s.waypoints.map((w) => [w.x, w.y]), [s.x, s.y]];
          pending.delete(s.actor);
          let from = lastPos.get(s.actor) ?? s.path[0];
          let tiles = 0;
          for (const p of s.path) { tiles += Math.abs(p[0] - from[0]) + Math.abs(p[1] - from[1]); from = p; }
          moveEnd.set(s.actor, t + (s.duration>0?s.duration:tiles*FRAMES_PER_TILE));
          lastPos.set(s.actor, [s.x, s.y]);
        } else if (s.native === WAIT_MOVE || CURRENT.get(s.native) === WAIT_MOVE) {
          const actor = s.native === WAIT_MOVE ? args[0]?.value : bound.get(si);
          t = Math.max(t, moveEnd.get(actor) ?? t);
        }
      }
    }
    return t;
  };

  file.scripts.forEach((s, si) => {
    const init = s.functions.findIndex((f) => f.name === 'init');
    if (init >= 0) run(si, init, 0, 0);
  });
  file.scripts.forEach((s, si) => { if (s.events[0] >= 0) run(si, s.events[0], 0, 0); });
  steps.sort((a, b) => a.t - b.t || a.seq - b.seq);
  return steps;
}

/** Steps the player stops at when stepping. */
export const isStop = (s) => ['talk','narration','move','place','face','remove','anim','body','weapon','cast','death'].includes(s.kind);

/**
 * Actor state after applying steps[0..index]. `initial` (actor -> {x, y, dir})
 * is where cast members stand before any command: their cast rows' start
 * positions.
 */
export function stateAt(steps, index, initial = null) {
  const actors = new Map();
  for (const [a, p] of initial ?? []) actors.set(a, { ...p, visible: p.visible ?? true });
  let line = null;
  for (let i = 0; i <= index && i < steps.length; i++) {
    const s = steps[i];
    const a = s.actor;
    if (typeof a !== 'number' && s.kind !== 'talk' && s.kind !== 'narration') continue; // actor held in a variable
    if (s.kind === 'place') actors.set(a, { ...(actors.get(a) ?? { dir: 1 }), x: s.x, y: s.y, heightOffset:0,groundAnchor:null, ...(s.dir !== undefined && s.dir !== null ? { dir: s.dir } : {}), visible: true });
    else if (s.kind === 'move' && actors.has(a)) {
      const previous = actors.get(a), path = s.path?.length ? s.path : [[s.x, s.y]];
      let from = [previous.x, previous.y], dir = previous.dir ?? 1;
      for (const to of path) { dir = movementFacing(from, to, dir); from = to; }
      actors.set(a, { ...previous, x: s.x, y: s.y, dir:s.retainPose?previous.dir:dir, heightOffset:0,groundAnchor:null,bodyAnimation:s.retainPose?previous.bodyAnimation:null, animation: previous.defaultAnimation ?? null });
    }
    else if (s.kind === 'anim' && actors.has(a)) actors.set(a, { ...actors.get(a),bodyAnimation:null, animation: { index: s.anim, key: s.animationKey, start: s.t ?? 0, resource: s.animationResource } });
    else if(['body','weapon','cast','death'].includes(s.kind)&&actors.has(a)){
      const p=actors.get(a),dir=s.kind==='cast'?movementFacing([p.x,p.y],[s.x,s.y],p.dir):p.dir;
      actors.set(a,{...p,dir,animation:null,bodyAnimation:{...s,start:s.t??0,key:s.animationKey}});
    }
    else if(s.kind==='worldOffset'&&actors.has(a)){const p=actors.get(a);actors.set(a,{...p,groundAnchor:p.groundAnchor??[p.x,p.y],x:p.x+s.dx,y:p.y+s.dz,heightOffset:(p.heightOffset??0)+s.dh});}
    else if(s.kind==='visibility'&&actors.has(a))actors.set(a,{...actors.get(a),visible:s.visible});
    else if (s.kind === 'nudge' && actors.has(a)) actors.set(a, { ...actors.get(a), x: actors.get(a).x + s.dx, y: actors.get(a).y + s.dy });
    else if (s.kind === 'face' && actors.has(a)) actors.set(a, { ...actors.get(a), dir: s.dir });
    else if (s.kind === 'remove' && actors.has(a)) actors.set(a, { ...actors.get(a), visible: false });
    else if (s.kind === 'fade' && actors.has(a) && typeof s.alpha === 'number') actors.set(a, { ...actors.get(a), visible: s.alpha > 0 });
    if (s.kind === 'talk' || s.kind === 'narration') line = i === index ? s : null;
    else if (s.kind !== 'wait' && s.kind !== 'anim' && s.kind !== 'other' && s.kind !== 'waypoint' && s.kind !== 'nudge' && s.kind !== 'fade') line = null;
  }
  return { actors, line };
}

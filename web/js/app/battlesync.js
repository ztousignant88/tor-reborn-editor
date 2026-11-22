// Battles and the cutscene that starts them, kept in step. The story starts a
// battle after one cutscene part (data/battle_links.json: battle -> start part).
// A character added to a battle (Battles mode, "Add a character") is also put
// in that part, standing on their battle tile; a character added to that part
// (Cutscenes mode) is also put in the battle, on the field. Moving one moves
// the other. That is what made Deneb appear at Golyat (cameo v7): a unit row
// on the field (+0x0D = 1), the battle's ally count raised (stage table), and
// the pre-battle scene placing her where she starts.
//
// Most battle-map scenes have no cast table: their actors are the battle's own
// units (named ones by character number, others by slot + 1), so a character
// added to the battle only needs placing in the start part, and is not carried
// into the later parts (those play during the battle, where the unit is
// wherever the battle has it).
//
// A new battle unit comes from the character's own row in another battle file
// (class, gear, sprites), at the level of the battle's enemies (their average),
// on the field, on one of three sides (SIDES): an AI-controlled guest on the
// player's side as Deneb's Golyat row is (team 1, guest, the AI of the battle's
// other guests), a unit on the player's side under the player's control (team 1,
// not a guest, as Denam's row), or an enemy (team 2, the AI of the battle's
// enemies, next to them).

import {characterDonor,customKey} from '../game/customcharacters.js';
import { FIELD, encodeField, isEmptySlot, parseEntryPack, readField } from '../game/entryunit.js';
import { previewWeapons } from '../game/weaponactions.js';
import { ALLY_TEAM, changeStageCount, stageCounts } from '../game/battledata.js';
import { parsePakd } from '../lib/pakd.js';
import {
  COMMANDS, addCastRow, addedActorEnd, clearActorStart, insertBefore, isAddedSlot, loadCastIndex, loadCutscene, removeAddedActor, setActorStart, setCastStart,
  slotActor, sceneRecord,
} from '../game/cutscene.js';
import { newUnit } from './battles.js';
import { sceneBattleUses, battleStartActors } from '../game/battlepreview.js';

const ON_FIELD = 1;
const ENEMY_TEAM = 2;
function fieldCounts(units) {
  const counts = { allies: 0, others: 0 };
  for (const { row } of units) {
    if (isEmptySlot(row) || readField(row, FIELD.appears) !== ON_FIELD) continue;
    counts[readField(row, FIELD.team) === ALLY_TEAM ? 'allies' : 'others']++;
  }
  return counts;
}

export const SIDES = {
  guest: { label: 'Your side, AI guest', team: ALLY_TEAM, guest: true },
  player: { label: 'Your side, under your control', team: ALLY_TEAM, guest: false },
  enemy: { label: 'Enemy', team: ENEMY_TEAM, guest: false },
};

export class BattleSync {
  constructor(ctx) {
    // { catalog, history, battles(), cutscenes() (async, creates the editor), tables(), freeTile(doc, x, y), toast, setStatus, onChange }
    this.ctx = ctx;
    this.pairs = []; // { doc, unit, file, part, actor, sceneAdded }
    this.characterRows = null;
    this.pending = new Set();
  }

  track(promise) {
    this.pending.add(promise);
    const done = () => this.pending.delete(promise);
    promise.then(done, done);
    return promise;
  }

  async finishPending() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  // ---- links ----------------------------------------------------------------
  /** The cutscene part a battle starts after: { file: 'C1_ST_020.dat', part: 5 } or null. */
  startOf(doc) {
    const s = this.ctx.catalog.battleLink(doc)?.start;
    return s?.part != null ? { file: `${s.scene}.dat`, part: s.part } : null;
  }

  /** All scene starts of a shared unit file, independent of its preview choice. */
  startsOf(doc) {
    const contexts = this.ctx.catalog.battleContexts(doc);
    return contexts.filter((c) => c.start?.part != null)
      .map((c) => ({ file: `${c.start.scene}.dat`, part: c.start.part }));
  }

  /** The battle a cutscene part starts, or null. */
  battleFor(fileName, partId) {
    return this.ctx.battles().find((d) => this.startsOf(d).some((s) => s.file === fileName && s.part === partId)) ?? null;
  }

  /** Newly created scene parts have no pre-generated start link yet. */
  battleForPart(scene,part) {
    const record=sceneRecord(scene,part);
    return record?.battleStage?this.scenePreview(scene,record).doc:this.battleFor(scene.fileName,part.entryId);
  }

  /** Stages (stage table rows) that load this battle file as their main one. */
  stagesOf(doc) { return this.ctx.catalog.stagesFor(doc).filter((s) => s.slot === 'normal').map((s) => s.stage); }

  /** A unit's side changes its stage counts when it is added (+1) or taken out (-1), if it is on the field. */
  countChange(doc, row, sign) {
    if (this.ctx.catalog.encounters.has(doc.key)) return () => {}; // built-in stages recount saved rosters
    if (row[FIELD.appears.offset] !== ON_FIELD) return () => {};
    const team = row[FIELD.team.offset];
    const stages = this.stagesOf(doc);
    return (forward) => {
      const delta = (forward ? 1 : -1) * sign;
      this.track(Promise.all(stages.map((stage) => changeStageCount(stage, team, delta)))
        .catch((err) => this.ctx.toast(`Could not update battle unit counts: ${err.message}`, true)));
    };
  }

  /** Keep new on-field units within the stage's load counts before either file is saved. */
  async ensureAddedUnitsLoad(doc, limit) {
    if (this.ctx.catalog.encounters.has(doc.key)) return;
    const stages = this.stagesOf(doc);
    if (!stages.length) return;
    const before = fieldCounts(parseEntryPack(parsePakd(doc.savedPack)));
    const after = fieldCounts(doc.units);
    const changes = [];
    for (const stage of stages) {
      const counts = await stageCounts(stage);
      for (const [side, team] of [['allies', ALLY_TEAM], ['others', ENEMY_TEAM]]) {
        if (after[side] <= before[side] || after[side] <= counts[side]) continue;
        changes.push([stage, team, after[side] - counts[side]]);
        counts[side] = after[side];
      }
      const total = counts.deployment + counts.allies + counts.others;
      if (total > limit) {
        throw new Error(`Stage ${stage} needs ${total} slots including deployment and guests. The limit is ${limit}.`);
      }
    }
    for (const change of changes) await changeStageCount(...change);
  }

  // ---- characters -----------------------------------------------------------
  /** character -> { doc, unit }: the character's row in the lowest-numbered battle file that has one. */
  characters() {
    if (this.characterRows) return this.characterRows;
    const out = new Map();
    for (const doc of this.ctx.battles()) {
      for (const s of doc.unitSlots()) {
        const name = readField(doc.row(s), FIELD.name);
        if (name && !out.has(name)) out.set(name, { doc, unit: doc.units[s] });
      }
    }
    this.characterRows = out;
    return out;
  }

  /** Keep distinct battle forms even when their localized name is identical. */
  specialForms() {
    if(this.formRows)return this.formRows;
    const out=new Map(),seen=new Set();
    for(const [name,{unit}]of this.characters())seen.add([name,readField(unit.row,FIELD.template),readField(unit.row,FIELD.class),unit.sprite[0]].join(':'));
    for(const doc of this.ctx.battles())for(const slot of doc.unitSlots()){
      if(doc.number===null)continue;
      const unit=doc.units[slot],row=unit.row,name=readField(row,FIELD.name),template=readField(row,FIELD.template),cls=readField(row,FIELD.class);
      if(!name&&readField(row,FIELD.randomName))continue;
      const signature=[name,template,cls,unit.sprite[0]].join(':');if(seen.has(signature))continue;seen.add(signature);
      const tables=this.ctx.tables(),gender=tables.isFemale(template)?'female':'male';
      const label=name?`${tables.unitName(name)||'Special character'} — ${template===139?'large final boss':tables.className(cls,tables.isFemale(template))||'class '+cls} (template ${template}, class ${cls})`:`Unknown special — ${gender} (template ${template}, class ${cls})`;
      out.set(`form:${doc.fileName}:${slot}`,{doc,unit,label});
    }
    for(const character of this.ctx.tables()?.customCharacters??[])out.set(customKey(character),characterDonor(character,this.ctx.battles()));
    this.formRows=out;return out;
  }

  projectCharacter(key){return this.ctx.tables()?.customCharacters.find(c=>key===customKey(c)||Number(key)===c.template)??null;}

  name(character) {
    const form=this.specialForms().get(character);if(form)return form.label;
    const name=this.ctx.tables()?.unitName(character)||`Character ${character}`,src=this.characters().get(character),template=src&&readField(src.unit.row,FIELD.template);
    return [432,433].includes(template)?`${name} — Unknown special ${template===432?'male':'female'} (template ${template})`:name;
  }


  posOf(unit) { return { x: readField(unit.row, FIELD.x), y: readField(unit.row, FIELD.z), dir: readField(unit.row, FIELD.facing) }; }

  /** A row for `character` in battle `doc` on `side` (see SIDES and the top of this file). */
  makeUnit(doc, character, pos, side = 'guest') {
    const want = SIDES[side] ?? SIDES.guest;
    const src = this.characters().get(character)??this.specialForms().get(character);
    if (!src) throw new Error(`${this.name(character)} has no unit in any battle file to copy`);
    const row = src.unit.row.slice();
    const set = (fd, v) => row.set(encodeField(fd, v), fd.offset);
    for (const fd of [FIELD.leader, FIELD.target, FIELD.subtarget]) set(fd, false);
    set(FIELD.event, 0);
    set(FIELD.team, want.team);
    set(FIELD.guest, want.guest);
    set(FIELD.appears, ON_FIELD);
    set(FIELD.appearValue, 0);
    const units = doc.unitSlots().map((s) => doc.units[s]);
    // the AI of a unit already on that side (guests' for a guest, enemies' for an enemy, the leader's for yours)
    const like = units.find((u) => readField(u.row, FIELD.team) === want.team && !!readField(u.row, FIELD.guest) === want.guest);
    if (like) set(FIELD.ai, readField(like.row, FIELD.ai));
    const levels = units.filter((u) => readField(u.row, FIELD.team) !== ALLY_TEAM).map((u) => readField(u.row, FIELD.levelBase)).filter((l) => l > 0);
    if (levels.length) set(FIELD.levelBase, Math.max(1, Math.round(levels.reduce((a, b) => a + b, 0) / levels.length)));
    const ally = units.find((u) => readField(u.row, FIELD.team) === want.team) ?? units[0];
    const at = pos ?? (() => {
      const [x, y] = this.ctx.freeTile(doc, readField(ally?.row ?? row, FIELD.x), readField(ally?.row ?? row, FIELD.z));
      return { x, y, dir: readField(ally?.row ?? row, FIELD.facing) };
    })();
    set(FIELD.x, at.x);
    set(FIELD.z, at.y);
    set(FIELD.facing, at.dir);
    return newUnit(row, src.unit.sprite);
  }

  // ---- battle -> cutscene ---------------------------------------------------
  /**
   * Add `character` to battle `doc` (Battles mode). The unit goes on the field,
   * the battle's ally count goes up, and the cutscene part that starts the battle
   * gets them standing on that tile. Returns the new slot.
   */
  async addToBattle(doc, character, { pos = null, pair = null, side = 'guest' } = {}) {
    const unit = this.makeUnit(doc, character, pos, side);
    const index = doc.units.length;
    const counts = this.countChange(doc, unit.row, 1);
    const start = this.startOf(doc);
    const p = pair ?? (start ? { doc, unit, file: start.file, part: start.part, actor: null, sceneAdded: false } : null);
    if (p) { p.unit = unit; this.pairs.push(p); }
    let first = true;
    this.ctx.history.insert(doc, index, unit, `Add ${this.name(character)}`, (forward) => {
      counts(forward);
      if (first || !p?.sceneAdded) return;
      // undo / redo also takes them out of, or puts them back in, the cutscene
      this.track((forward ? this.placeInScene(p) : this.takeOutOfScene(p)).catch((err) => this.ctx.toast(err.message, true)));
    });
    first = false;
    if (p && !pair) await this.track(this.placeInScene(p).catch((err) => {
      this.ctx.toast(`Added to battle. Could not place the character in ${p.file}: ${err.message}`, true);
    }));
    return index;
  }

  /** The scene object for a file: the cutscene editor's (edited or open) copy, else loaded into it. */
  async sceneFor(file) {
    const cs = await this.ctx.cutscenes();
    const scene = cs.edited.get(file) ?? (cs.scene?.fileName === file ? cs.scene : await loadCutscene(file));
    return { cs, scene };
  }

  /** A battle unit's actor number in a battle-map scene: named by character, others by slot + 1. */
  unitActor(doc, unit) { return readField(unit.row, FIELD.template); }

  /** Put a pair's character in its start part, on their battle tile. */
  async placeInScene(p) {
    const { cs, scene } = await this.sceneFor(p.file);
    const character = this.projectCharacter(readField(p.unit.row,FIELD.template))?.template??readField(p.unit.row, FIELD.name);
    if (!scene.castEntry) { // a battle-map scene: the unit is already one of its actors
      const part = scene.parts.find((x) => x.entryId === p.part);
      if (!part) throw new Error(`${p.file} has no part ${p.part}`);
      p.actor = this.unitActor(p.doc, p.unit);
      p.noCast = true;
      setActorStart(scene, part, p.actor, this.posOf(p.unit), { carry: false });
      p.sceneAdded = true;
      cs.edited.set(scene.fileName, scene);
      cs.refreshScene(scene);
      this.ctx.onChange();
      return true;
    }
    if (scene.cast.some((c, i) => !isAddedSlot(scene, i) && c.character === character && c.portrait)) {
      this.ctx.setStatus(`${this.name(character)} is already in ${p.file}'s own cast: left as the scene has them`);
      return false;
    }
    const part = scene.parts.find((x) => x.entryId === p.part);
    if (!part) throw new Error(`${p.file} has no part ${p.part}`);
    let slot = scene.cast.findIndex((c, i) => isAddedSlot(scene, i) && c.character === character);
    if (slot < 0) {
      const look = (await loadCastIndex()).find((l) => l.character === character);
      if (!look) { this.ctx.toast(`${this.name(character)} has no cutscene look to copy: added to the battle only.`, true); return false; }
      p.actor = await addCastRow(scene, look);
      for (const x of scene.parts) insertBefore(scene, x, null, COMMANDS.hideNow(p.actor));
      slot = scene.cast.length - 1;
    } else {
      p.actor = slotActor(scene, slot);
    }
    const pos = this.posOf(p.unit);
    setActorStart(scene, part, p.actor, pos);
    setCastStart(scene, slot, pos);
    p.sceneAdded = true;
    cs.edited.set(scene.fileName, scene);
    cs.refreshScene(scene);
    this.ctx.onChange();
    return true;
  }

  async takeOutOfScene(p) {
    const { cs, scene } = await this.sceneFor(p.file);
    if (p.noCast) {
      const part = scene.parts.find((x) => x.entryId === p.part);
      if (part && p.actor != null) clearActorStart(scene, part, p.actor);
      cs.edited.set(scene.fileName, scene);
      cs.refreshScene(scene);
      this.ctx.onChange();
      return;
    }
    if (p.actor != null && removeAddedActor(scene, p.actor)) {
      cs.edited.set(scene.fileName, scene);
      cs.refreshScene(scene);
      this.ctx.onChange();
    }
  }

  /** A battle unit was moved or turned (Battles mode): its cutscene start follows. */
  async unitMoved(doc, unit) {
    const p = this.pairs.find((x) => x.doc === doc && x.unit === unit && x.sceneAdded);
    if (!p) return;
    await this.track(this.moveSceneUnit(p));
  }

  async moveSceneUnit(p) {
    const { cs, scene } = await this.sceneFor(p.file);
    const part = scene.parts.find((x) => x.entryId === p.part);
    if (!part) return;
    const pos = this.posOf(unit);
    if (p.noCast) {
      setActorStart(scene, part, p.actor, pos, { carry: false });
    } else {
      const slot = scene.cast.findIndex((c, i) => isAddedSlot(scene, i) && slotActor(scene, i) === p.actor);
      if (slot < 0) return;
      setActorStart(scene, part, p.actor, pos);
      setCastStart(scene, slot, pos);
    }
    cs.edited.set(scene.fileName, scene);
    cs.refreshScene(scene);
  }

  /** A battle unit was taken out: so is its cutscene character (undo puts both back). */
  removed(doc, unit) {
    const p = this.pairs.find((x) => x.doc === doc && x.unit === unit && x.sceneAdded);
    const counts = this.countChange(doc, unit.row, -1);
    return (forward) => {
      counts(forward);
      if (!p) return;
      this.track((forward ? this.takeOutOfScene(p) : this.placeInScene(p)).catch((err) => this.ctx.toast(err.message, true)));
    };
  }

  // ---- cutscene -> battle ---------------------------------------------------
  /**
   * A character was added to a cutscene (Cutscenes mode). On the part that
   * starts a battle they also go into the battle, and stand on their tile in the
   * part from its start. Returns a status line, or null when no battle starts here.
   */
  async sceneCharacterAdded(scene, part, actor, character, side = 'guest') {
    const doc = this.battleForPart(scene,part);
    if (!doc) return null;
    const custom=this.projectCharacter(character);if(custom)character=customKey(custom);
    const matches=row=>readField(row,custom?FIELD.template:FIELD.name)===(custom?custom.template:character);
    if (!scene.castEntry) { // a battle-map scene: adding to the battle adds them to the scene
      if (doc.unitSlots().some((s) => matches(doc.row(s)))) throw new Error(`${this.name(character)} is already in ${doc.fileName}`);
      // This addition belongs to the scene being edited, even when Battles mode
      // currently previews another use of the same unit file.
      const pair = { doc, unit: null, file: scene.fileName, part: part.entryId, actor: null, sceneAdded: false };
      const slot = await this.addToBattle(doc, character, { pair, side });
      await this.placeInScene(pair);
      const unit = doc.units[slot];
      return `${this.name(character)} added to ${doc.fileName} (slot ${slot}, level ${readField(unit.row, FIELD.levelBase)}, ${SIDES[side].label.toLowerCase()}, ${side === 'enemy' ? 'enemy' : 'ally'} count +1) and standing on their tile in this part. Move them in either mode and the other follows.`;
    }
    let unit = doc.unitSlots().map((s) => doc.units[s]).find((u) => matches(u.row) && readField(u.row, FIELD.appears) === ON_FIELD);
    const pair = { doc, unit: null, file: scene.fileName, part: part.entryId, actor, sceneAdded: true };
    let note;
    if (unit) {
      pair.unit = unit;
      this.pairs.push(pair);
      note = `already in ${doc.fileName}: placed on their tile`;
    } else {
      await this.addToBattle(doc, character, { pair, side });
      unit = pair.unit;
      note = `also added to ${doc.fileName} (level ${readField(unit.row, FIELD.levelBase)}, ${SIDES[side].label.toLowerCase()}) and to its ${side === 'enemy' ? 'enemy' : 'ally'} count`;
    }
    const slot = scene.cast.findIndex((c, i) => isAddedSlot(scene, i) && slotActor(scene, i) === actor);
    const pos = this.posOf(unit);
    setActorStart(scene, part, actor, pos);
    if (slot >= 0) setCastStart(scene, slot, pos);
    return `${this.name(character)}: ${note}. Move them in either mode and the other follows.`;
  }

  /** Formation appearance and identity; unit/template and name IDs are separate. */
  unitLook(doc, slot) {
    const tables = this.ctx.tables(), row = doc.row(slot);
    const tpl = tables?.template(readField(row, FIELD.template));
    return { character: readField(row, FIELD.template), nameId: readField(row, FIELD.name), name: tables?.unitName(readField(row, FIELD.name)) ?? '', actor: doc.units[slot].sprite[0],
      palette: tables?.unitPalette(row) ?? 0, team: readField(row, FIELD.team),
        ...previewWeapons(row,tables),
      guest: !!readField(row, FIELD.guest), leader: readField(row, FIELD.leader),
      cls: tables?.className(readField(row, FIELD.class), tpl?.female) ?? '' };
  }

  /** Exact chapter part -> battle stage/map use. A shared scene file is insufficient. */
  scenePreview(scene, record) {
    const uses = sceneBattleUses(scene, record, this.ctx.battles(), this.ctx.catalog);
    const primary = uses.filter(u => u.context.slot === 'normal');
    const docs = [...new Set(primary.map(u => u.doc))];
    const doc = docs.length === 1 ? docs[0] : null;
    const look=(d,slot)=>this.unitLook(d,slot);
    return { uses, doc, actors: doc ? battleStartActors(doc, look) : new Map(),
      candidates: doc ? battleStartActors(doc, look, true) : new Map() };
  }

  actorLook(fileName, actor, preview = null) {
    const seeded = preview?.actors?.get(actor) ?? preview?.candidates?.get(actor);
    if (seeded) return seeded.look;
    const id = fileName.replace(/\.dat$/i, '');
    // When a part is known, never borrow a different part's enemies.
    const docs = preview ? (preview.doc ? [preview.doc] : [])
      : this.ctx.battles().filter(d => this.ctx.catalog.battleLink(d)?.scenes?.includes(id));
    for (const doc of docs) {
      const slot = doc.unitSlots().find(s => readField(doc.row(s), FIELD.template) === actor);
      if (slot !== undefined) return this.unitLook(doc,slot);
    }
    // Artwork fallback for a named party member. This does not invent a location.
    for (const doc of this.ctx.battles()) {
      const slot = doc.unitSlots().find(s => readField(doc.row(s), FIELD.template) === actor && readField(doc.row(s), FIELD.name) > 0);
      if (slot !== undefined) return { ...this.unitLook(doc, slot), team: ALLY_TEAM, representative: true };
    }
    return null;
  }

  /** The battle a scene part starts, with the characters that can be added to it (Cutscenes mode). */
  battleChoices(scene, part) {
    const doc = this.battleForPart(scene,part);
    if (!doc) return null;
    const characters = [...this.characters().keys(),...(this.ctx.tables()?.customCharacters??[]).map(customKey)].map((c) => ({ c, name: this.name(c) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { doc, characters };
  }

  /** A cutscene was edited: characters paired with a battle unit take their place at the end of the start part. */
  sceneChanged(scene) {
    for (const p of this.pairs) {
      if (p.file !== scene.fileName || !p.sceneAdded) continue;
      const part = scene.parts.find((x) => x.entryId === p.part);
      const end = part && addedActorEnd(scene, part, p.actor);
      if (!end?.shown) continue;
      const now = this.posOf(p.unit);
      if (now.x === end.x && now.y === end.y && now.dir === end.dir) continue;
      const slot = p.doc.units.indexOf(p.unit);
      if (slot < 0) continue;
      this.ctx.history.apply(p.doc, slot, FIELD.x.offset, new Uint8Array([end.x, end.y, end.dir]), 'Move (from the cutscene)');
    }
  }
}

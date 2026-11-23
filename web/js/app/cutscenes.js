import {FIELD,readField} from '../game/entryunit.js';
// Cutscenes mode: pick a scene, watch it on its map step by step (helper
// scripts included), edit its dialogue, switch spoken voice off for lines
// whose text no longer matches, change and add cast members, move where
// people stand, walk and face, add or delete commands and lines, and choose
// who joins the army after the scene.

import {
  CHAPTERS, COMMANDS, TALK_BOXES, actorSlot, addCastRow, carryAddedActor, castStarts, buildTimeline, castChanged, copyTouched, deleteStep, encodeScene, fieldLock,
  forgetChapter, insertAfter, insertBefore, isAddedSlot, isStop, listSceneFiles, loadCastIndex, loadChapter, loadCutscene,
  addBattleScenePart, battleDraftRecords, sceneRecord, loadMessageTable, partChanged, revertCastSlot, revertPart, revertUnitCopy, sceneDirty, setCastLook, setCastStart, setStepField, setUnitCopy, slotActor,
  stateAt, stepFields, stepRange, unitCopy,refreshEffectDurations,
  addWaypoint, removeWaypoint, snapshotScripts, restoreScripts, addEventPart, insertAtEnd,
} from '../game/cutscene.js';
import { MENU } from '../game/chapter.js';
import { triggerSummary, triggerDetails } from '../game/scenetriggers.js';
import { playerStartTiles } from '../game/battlepreview.js';
import { loadMapTable } from '../game/maptable.js';
import { LANGUAGES } from '../game/texts.js';
import { source } from '../game/source.js';
import { loadDat } from '../game/datfile.js';
import { appendRow, copyRow, noteCopy } from '../game/unitcopies.js';
import { loadActorFrame } from '../game/unitsprites.js';
import { movementFacing } from '../game/actorposes.js';
import {BODY_ACTION_NAMES} from '../game/battleactions.js';
import {HEIGHT_UNIT} from '../game/bgscene.js';
import { rgbaCanvas } from '../ui/texcanvas.js';
import { abilityArt } from '../ui/iconart.js';
import { createPicker } from '../ui/picker.js';
import { LocalizeFile } from '../game/localize.js';
import { VOICE_LANGS, VoiceIndex, cueForKey } from '../game/voices.js';
import { decodeForEdit, displayText, encodeFromEdit } from '../game/textcodec.js';
import { MapView } from '../ui/mapview.js';
import { MapView3D } from '../ui/mapview3d.js';
import { SceneView } from '../ui/scene3d.js';
import { saveDataFiles } from './savefiles.js';
import { attachHelp } from './fieldhelp.js';
import {AfterEventsPanel} from './afterevents.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FACING = ['east', 'south', 'west', 'north'];
const MUTED_KEY = 'tor-editor:muted-voices:v1';

export class CutsceneEditor {
  constructor(ctx) {
    this.ctx = ctx; // { tables(), catalog, lang(), toast, setStatus, onChange, readOnly() }
    this.files = [];
    this.scene = null;
    this.scriptIndex = 0;
    this.steps = [];
    this.stops = [];
    this.pos = -1; // index into steps; -1 = before the first step
    this.playing = null;
    this.localize = null;
    this.voices = new Map(); // lang -> VoiceIndex
    this.filter = '';
    this.edited = new Map(); // file name -> scene with unsaved cast or script changes
    this.chapterFiles = new Set(); // chapter files with new messages or story steps
    this.newKeys = new Set(); // text keys added this session (copied to every language on save)
    this.panel = 'lines';
    this.undoStack = []; // script and dialogue-page edits of the open part (see pushUndo)
    this.afterEvents=new AfterEventsPanel(this);
    this.addForm = { type: 'place', actor: null, x: 0, y: 0, dir: 0, anim: 0, action:54,weapon:-1,effect:121,frames: 30, text: '', box: 27, closeAfterLine: true };
    const handlers = {
      directionalSprites: true,
      onSelectUnit: () => {},
      onMoveUnit: (slot, x, y) => this.dragActor(slot, x, y),
      onSelectTile: () => {},
      onHover: (h) => this.renderHover(h),
      paletteColors: (i) => this.ctx.tables()?.palette(i),
    };
    this.view2d = new MapView($('#cs-map'), handlers);
    this.view3d = SceneView.isSupported() ? new MapView3D($('#cs-gl'), $('#cs-overlay'), handlers) : null;
    this.bind();
  }

  // ---- loading --------------------------------------------------------
  async open(refresh = false) {
    if (this.files.length && !refresh) return;
    this.ctx.setStatus('Listing cutscenes…');
    this.files = await listSceneFiles();
    this.renderList();
    this.ctx.setStatus(`${this.files.length} cutscene files`);
  }

  async ensureText() {
    const lang = this.ctx.lang();
    this.characterLooks ??= await loadCastIndex();
    if (this.localize?.lang !== lang) {
      if (this.localize?.dirty && !confirm('Unsaved dialogue edits in the other language will be dropped. Continue?')) return;
      this.localize = await LocalizeFile.load(lang);
    }
    for (const l of VOICE_LANGS) if (!this.voices.has(l)) this.voices.set(l, await VoiceIndex.load(l));
  }

  async openScene(file) {
    this.stop();
    this.ctx.setStatus(`Loading ${file.id}…`);
    try {
      await this.ensureText();
      const scene = this.edited.get(file.name) ?? await loadCutscene(file.name);
      const encounter = this.ctx.catalog.encounterForScene(file.id);
      scene.chapterFile = await loadChapter(scene.chapter);
      if (encounter && !scene.chapterFile.allRecords().some(r => r.stage === encounter.storyStage && r.map === encounter.mapNumber)) {
        if (scene.chapterFile.dirty) throw new Error('Save the open chapter edits before opening this new cutscene.');
        forgetChapter(scene.chapter);
        scene.chapterFile = await loadChapter(scene.chapter);
        scene.messages = null;
      }
      scene.messages ??= await loadMessageTable(scene.chapter);
      this.scene = scene;
      this.file = file;
      this.draftRecordIndex=null;
      const main = scene.parts.findIndex((s) => /^cut_scene/.test(s.name));
      await this.selectScript(Math.max(0, main));
      this.renderList();
      const helpers = scene.parts.reduce((n, p) => n + p.helpers.length, 0);
      this.ctx.setStatus(scene.parts.length?`${file.id}: ${scene.parts.length} part(s), ${helpers} helper script(s), ${scene.cast.length} cast slots`:this.storyRecord()?.battleStage?`${file.id}: Battle map loaded. No cutscene yet — use Add cutscene to begin.`:`${file.id}: Empty scene archive — no linked battle or cutscene parts.`);
    } catch (err) {
      console.error(err);
      this.ctx.setStatus(`${file.id}: ${err.message}`, true);
    }
  }

  async selectScript(i) {
    this.stop();
    this.view3d?.setUnits([], null);
    this.view3d?.clearActionTextures();
    this.scriptIndex = this.scene.parts[i]?i:(i===-1&&battleDraftRecords(this.scene).length?-1:this.scene.parts.length?0:-1);
    this.battlePreview = this.ctx.sync?.scenePreview(this.scene, this.storyRecord()) ?? null;
    this.rebuildSteps();
    this.pos = -1;
    await this.loadMap();
    this.renderHeader();
    this.renderLines();
    this.renderCast();
    this.afterEvents.render($('#cs-after'));
    this.render();
    this.renderStepEditor();
  }

  get mapKey() { return { key: `scene:${this.file.id.toLowerCase()}` }; }

  /** The map the game itself uses for this part: story step -> map number -> map file. */
  async gameMap() {
    try {
      const rec = this.storyRecord();
      const entry = rec ? (await loadMapTable()).get(rec.map)?.[0] : null;
      return entry && this.ctx.catalog.maps.some((m) => m.id === entry.id) ? entry : null;
    } catch {
      return null;
    }
  }

  async loadMap() {
    const catalog = this.ctx.catalog;
    this.fromGame = await this.gameMap();
    const id = catalog.chosenMap(this.mapKey) || this.fromGame?.id;
    const grid = id ? catalog.grid(id) : null;
    // Keep the camera when switching parts on the same unchanged map.
    if (id && id === this.loadedMap && grid === this.loadedGrid && this.has3d && this.grid) return;
    this.loadedMap = id;
    this.loadedGrid = grid;
    this.grid = null;
    this.has3d = false;
    if (id) {
      try {
        this.grid = await grid;
        if (this.view3d) {
          this.view3d.setScene(await catalog.scene(id), this.grid);
          this.has3d = true;
        }
      } catch (err) {
        this.ctx.setStatus(`Map ${id}: ${err.message}`, true);
      }
    }
    const { maxX, maxY } = this.bbox();
    this.view2d.setGrid(this.grid, { width: Math.max(maxX + 3, 8), depth: Math.max(maxY + 3, 8) });
    $('#cs-map').hidden = this.has3d;
    $('#cs-3d').hidden = !this.has3d;
  }

  bbox() {
    let maxX = 0, maxY = 0;
    for (const s of this.steps) {
      for (const [x, y] of [[s.x, s.y], ...(s.path ?? [])]) {
        if (typeof x === 'number') maxX = Math.max(maxX, x);
        if (typeof y === 'number') maxY = Math.max(maxY, y);
      }
    }
    return { maxX, maxY };
  }

  // ---- text helpers ---------------------------------------------------
  keysFor(msg) { return this.scene?.messages.get(msg) ?? []; }

  storyRecord(part = this.part) { return sceneRecord(this.scene,part,this.draftRecordIndex); }

  draftLabel(record) {
    const doc=this.ctx.sync?.scenePreview(this.scene,record)?.doc;
    return `No cutscene · Battle ${record.battleStage} · ${doc?.fileName??'no fixed formation'}`;
  }

  triggersFor(part = this.part) {
    const record = this.storyRecord(part);
    return record ? this.scene.chapterFile?.triggers.entries.get(record.invk) ?? [] : [];
  }

  initialActors() {
    const initial = castStarts(this.scene);
    if ($('#cs-battle-units').checked) {
      const actors = $('#cs-conditional-units').checked ? this.battlePreview?.candidates : this.battlePreview?.actors;
      for (const [key,p] of actors ?? []) {
        if(!initial.has(key))initial.set(key,p);
      }
    }
    return initial;
  }

  lineSpeaker(line) {
    const id = this.scene.messages.speakers?.get(line.msg);
    // 0 = no named speaker; 255 = runtime leader/selected unit. Resolve those from the command.
    return (id > 0 && id !== 255 && this.characterName(id)) || (typeof line.actor==='number'?this.speaker(line.actor):'Message');
  }

  partLabel(part, steps = part ? buildTimeline(part) : []) {
    if(!part)return 'No cutscene parts';
    const talks = steps.filter(s => s.kind === 'talk' || s.kind === 'narration');
    const names = [...new Set(talks.map(s => this.lineSpeaker(s)).filter(n=>n!=='Message'))];
    const when = triggerSummary(this.triggersFor(part),id => this.characterName(id) || `Character ${id}`);
    const extraNames = names.filter(name => !when.includes(name));
    return `${part.name} · ${when || (this.storyRecord(part)?.battleStage?`Battle ${this.storyRecord(part).battleStage}`:'Story part')}${extraNames.length ? ` · ${extraNames.join(', ')}` : ''} · ${talks.length} line${talks.length === 1 ? '' : 's'}`;
  }


  /** Named characters by id, generic soldiers by cast row + 1; others are party or battle units. */
  speaker(actor) {
    // Battle actors use unit/template IDs; some party appearances need a representative template.
    if (!this.scene.cast.length) {
      const look = this.ctx.sync?.actorLook(this.scene.fileName, actor, this.battlePreview);
      if (look) {
        if (look.name) return look.name;
        // Anonymous formation IDs can overlap unrelated story-character IDs.
        if (!look.nameId) return `${look.cls || 'Soldier'} (${actor < 0 ? `formation row ${-actor}` : `actor ${actor}`})`;
        return this.characterName(look.character) || `Battle actor ${actor}`;
      }
      return this.characterName(actor) || `Battle actor ${actor}`;
    }
    const slot = actorSlot(this.scene, actor);
    const name = this.characterName(slot >= 0 ? this.scene.cast[slot].character : actor < 512 ? actor : 0);
    return name ?? `Actor ${actor}`;
  }

  characterName(character) {
    const custom=this.ctx.tables()?.customCharacter(character);if(custom)return custom.name;
    const t = this.ctx.tables()?.texts;
    const name = character && t?.get(`CHARACTER_NAME_LC_CHRNAME_${String(character).padStart(3, '0')}_NAME`);
    return name && name !== 'Nothing' ? name : null;
  }

  lineText(key) {
    const bytes = this.localize.get(key);
    return bytes ? decodeForEdit(bytes) : { text: '(missing)', info: {} };
  }

  isVoiced(key) {
    const cue = cueForKey(key);
    return [...this.voices.values()].some((v) => v.isVoiced(cue));
  }

  hadVoice(key) {
    const cue = cueForKey(key);
    return [...this.voices.values()].some((v) => v.hadVoice(cue));
  }

  setVoiced(key, on) {
    for (const v of this.voices.values()) v.setVoiced(cueForKey(key), on);
    this.ctx.onChange();
  }

  // ---- playback ---------------------------------------------------------
  stepTo(pos) {
    this.pos = Math.max(-1, Math.min(this.steps.length - 1, pos));
    this.render();
    this.renderStepEditor();
  }

  get part() { return this.scene?.parts[this.scriptIndex]; }

  rebuildSteps() {
    this.steps = this.part ? buildTimeline(this.part,{
      bindBattleActor:(native,key)=>native===127?[...(this.battlePreview?.candidates??[])].find(([,p])=>p.eventId===key)?.[0]??null:null,
      weaponForActor:actor=>this.ctx.sync?.actorLook(this.scene.fileName,actor,this.battlePreview)?.weapons?.find(w=>w>0&&w<999)
    }) : [];
    this.stops = this.steps.map((s, k) => (isStop(s) ? k : -1)).filter((k) => k >= 0);
  }

  next() {
    const n = this.stops.find((k) => k > this.pos);
    this.stepTo(n ?? this.steps.length - 1);
  }

  prev() {
    const p = [...this.stops].reverse().find((k) => k < this.pos);
    this.stepTo(p ?? -1);
  }

  togglePlay() {
    if (this.playing) this.stop(); else this.play();
  }

  stop() {
    const wasPlaying = !!this.playing;
    if (this.playing) this.playing.cancelled = true;
    this.playing = null;
    this.animationEpochs = null;
    $('#cs-play').textContent = '▶';
    if (wasPlaying) this.render();
  }

  async play() {
    if (this.pos >= this.steps.length - 1) this.pos = -1;
    const token = { cancelled: false };
    this.playing = token;
    $('#cs-play').textContent = '❚❚';
    const speed = Number($('#cs-speed').value) || 1;
    this.animationEpochs = new Map();
    this.animationClockStart = performance.now();
    this.animationClockSpeed = speed;
    const sleep = (ms) => this.previewWait(ms / speed, token);
    while (!token.cancelled && this.pos < this.steps.length - 1) {
      const s = this.steps[this.pos + 1];
      if (s.kind === 'move' && s.path?.length) await this.animateMove(s, token, speed);
      if (token.cancelled) break;
      this.stepTo(this.pos + 1);
      if (s.kind === 'wait') await sleep(Math.max(0, (s.frames / 60) * 1000));
      else if (s.kind === 'animWait') {
        const actor = stateAt(this.steps, this.pos, this.initialActors()).actors.get(s.actor);
        const a=actor?.animation??actor?.bodyAnimation;
        const unit=this.view3d?.units.find(u=>u.slot===s.actor);
        const resource=a?.kind==='weapon'&&unit?await this.view3d.requestBodyAction(unit):a?.resource;
        if (a) await sleep(Math.max(0, (resource?.definition?.duration ?? a.frames ?? 0) - this.animationTick(a)) * 1000 / 60);
      }
      else if(s.kind==='cast'||s.kind==='death')await sleep(s.frames*1000/60);
      else if (s.kind === 'talk' || s.kind === 'narration') {
        const text = this.keysFor(s.msg).map((k) => displayText(this.lineText(k).text)).join(' ');
        await sleep(Math.max(1400, 45 * text.length));
      } else if (isStop(s) && s.kind !== 'anim') await sleep(250);
    }
    if (this.playing === token) this.stop();
  }

  animationTick(animation) {
    const seek = Math.max(0, (this.steps[this.pos]?.t ?? 0) - animation.start);
    if (!this.playing || !this.animationEpochs) return seek;
    const now = (performance.now() - this.animationClockStart) * this.animationClockSpeed * 60 / 1000;
    if (!this.animationEpochs.has(animation.key)) this.animationEpochs.set(animation.key, now - seek);
    return Math.max(0, now - this.animationEpochs.get(animation.key));
  }

  async previewWait(ms, token) {
    const end = performance.now() + ms;
    while (!token.cancelled && performance.now() < end) {
      this.render(null, true);
      await new Promise(resolve => setTimeout(resolve, Math.min(16, Math.max(1, end - performance.now()))));
    }
  }

  /** Walk an actor along its path, tile by tile. */
  async animateMove(step, token, speed) {
    const before = stateAt(this.steps, this.pos, this.initialActors()).actors.get(step.actor);
    if (!before) return;
    let from = [before.x, before.y];
    let facing = before.dir ?? 1;
    const walkStart = performance.now();
    // Move commands start asynchronously in the game; a same-tick fade-in
    // after the command is already active while the actor travels.
    const fade=this.steps.slice(this.pos+2).find(s=>s.t===step.t&&s.actor===step.actor&&s.kind==='fade');
    for (const to of step.path) {
      if(!step.retainPose)facing = movementFacing(from, to, facing);
      const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const total=step.path.reduce((sum,p,i)=>sum+Math.hypot(p[0]-(i?step.path[i-1][0]:before.x),p[1]-(i?step.path[i-1][1]:before.y)),0);
      const ms = step.duration>0 ? step.duration/60*1000*dist/Math.max(1e-8,total)/speed : (Math.max(1, dist) * 260) / speed;
      const t0 = performance.now();
      const ground=p=>(this.grid?.tileAt(Math.round(p[0]),Math.round(p[1]))?.height??0)*HEIGHT_UNIT;
      const h0=ground(before.groundAnchor??from)+(before.heightOffset??0),h1=ground(to);
      for (;;) {
        if (token.cancelled) return;
        const k = Math.min(1, (performance.now() - t0) / ms);
        this.render({ actor: step.actor, x: from[0] + (to[0] - from[0]) * k, y: from[1] + (to[1] - from[1]) * k,
          facing, walking: k < 1&&!step.retainPose,retainPose:!!step.retainPose, flying:!!step.flying&&k<1,worldHeight:step.flying?h0+(h1-h0)*k:undefined,heightOffset:0,
          visible:fade?fade.alpha>0:before.visible,
          walkTick: (performance.now() - walkStart) * speed * 60 / 1000 }, true);
        if (k >= 1) break;
        await new Promise((r) => setTimeout(r, 16)); // not rAF: it stalls while the page is hidden
      }
      from = to;
    }
  }

  // ---- rendering --------------------------------------------------------
  render(override = null, animateOnly = false) {
    if (!this.scene) return;
    const { actors, line } = stateAt(this.steps, this.pos, this.initialActors());
    const units = [];
    for (const [actor, a] of actors) {
      if (!(override?.actor===actor?(override.visible??a.visible):a.visible)) continue;
      const row = this.scene.cast[actorSlot(this.scene, actor)];
      const name = row?.animation && !row.sprite ? this.scene.animations.get(row.animation)?.label ?? this.speaker(actor) : this.speaker(actor);
      const isProp = !!(row?.animation && !row.sprite);
      const at = override?.actor === actor ? override : a;
      // Retain off-map starting state for walk-in commands, but draw it only once on the grid.
      if (a.battleStart && this.grid && !this.grid.tileAt(Math.round(at.x),Math.round(at.y))) continue;
      // a cast row's sprite, else (battle-map scenes) the battle unit's own look, team and colours
      const inherited=a.look??this.ctx.sync?.actorLook(this.scene.fileName,actor,this.battlePreview);
      const look = row?.sprite || row?.animation ? { actor: row.sprite, palette: row.palette??0, team: inherited?.team??1,weapons:inherited?.weapons } : inherited;
      const body=a.bodyAnimation,tick=body?this.animationTick(body):0;
      units.push({
        slot: actor, x: at.x, y: at.y, team: look?.team ?? 1, facing: at.facing ?? a.dir ?? 1, actor: look?.actor, palette: look?.palette ?? 0,
        walking: !!at.walking && !isProp, walkTick: at.walkTick ?? 0,
        flying:!!at.flying,worldHeight:at.worldHeight??(a.groundAnchor?(this.grid?.tileAt(...a.groundAnchor)?.height??0)*HEIGHT_UNIT:undefined),heightOffset:at.heightOffset??0,weapons:look?.weapons,
        bodyAnimation:override?.actor===actor&&!override.retainPose||body?.kind==='cast'&&tick>(body.bodyFrames??body.frames)?null:body,
        spellAnimation:override?.actor===actor?null:body?.kind==='cast'?body:null,
        isProp,
        sceneAnimation: override?.actor === actor && !isProp ? null : a.animation?.resource,
        animationTick: a.animation ? this.animationTick(a.animation) : tick,
        leader: !!look?.leader, name, cls: look?.cls ?? '', label: look?.cls ? `${name} · ${look.cls}` : name, initials: name.slice(0, 2).toUpperCase(),
      });
    }
    const active = this.has3d ? this.view3d : this.view2d;
    const tiles = $('#cs-start-tiles').checked && (!this.loadedMap || this.battlePreview?.uses.some(u => u.context.map === this.loadedMap)) ? playerStartTiles(this.battlePreview?.doc) : [];
    active.setStartTiles(tiles);
    active.showUnitMarkers=!$('#cs-hide-icons').checked;
    active.setUnits(units, line?.actor ?? null);
    if (!animateOnly) {
      this.renderSpeech(line);
      this.renderTransport();
      this.highlightLine(line);
    }
  }

  renderSpeech(line) {
    const box = $('#cs-speech');
    if (!line || $('#cs-hide-dialogue')?.checked) { box.hidden = true; return; }
    const keys = this.keysFor(line.msg);
    const text = keys.map((k) => displayText(this.lineText(k).text)).join('\n') || `(message ${line.msg} not found)`;
    box.hidden = false;
    box.dataset.box = line.kind === 'talk' ? line.box : 'narration';
    $('#cs-speaker').textContent = this.lineSpeaker(line);
    $('#cs-speech-text').textContent = text;
    $('#cs-speech-voice').textContent = keys.some((k) => this.isVoiced(k)) ? '🔊 voiced' : keys.some((k) => this.hadVoice(k)) ? '🔇 voice off' : '';
  }

  describe(s) {
    if (!s) return 'Start of scene';
    const what = this.describeStep(s);
    return s.by ? `${what} · helper "${s.by}"` : what;
  }

  describeStep(s) {
    const who = s.kind === 'talk' ? this.lineSpeaker(s) : typeof s.actor === 'number' ? this.speaker(s.actor) : '';
    switch (s.kind) {
      case 'talk': return `${who} speaks (${s.box})`;
      case 'closeDialogue': return 'Close dialogue';
      case 'narration': return s.notice?'Notice box':this.lineSpeaker(s)==='Message'?'Message':`${this.lineSpeaker(s)} speaks`;
      case 'place': return `${who} appears at ${s.x}, ${s.y}${s.dir != null ? `, facing ${FACING[s.dir] ?? s.dir}` : ''}`;
      case 'move': return `${who} moves to ${s.x}, ${s.y}${s.path.length > 1 ? ` via ${s.path.slice(0, -1).map((p) => p.join(',')).join(' → ')}` : ''}`;
      case 'body': return `${who} · ${BODY_ACTION_NAMES[s.action]??`Body action ${s.action}`}`;
      case 'death': return `${who} falls and dies`;
      case 'visibility': return `${who} ${s.visible?'appears':'disappears'}`;
      case 'weapon': return `${who} · weapon action (${s.weapon<0?'equipped weapon':s.weapon})`;
      case 'cast': return `${who} casts ${this.ctx.tables()?.effectName(s.effect)??`effect ${s.effect}`} at ${s.x}, ${s.y}`;
      case 'worldOffset':return `${who} shifts in space (${s.dx}, ${s.dh}, ${s.dz})`;
      case 'face': return `${who} turns ${FACING[s.dir] ?? s.dir}`;
      case 'remove': return `${who} leaves`;
      case 'nudge': return `${who} shifts ${s.dx}, ${s.dy}`;
      case 'fade': return `${who} fades ${s.alpha > 0 ? 'in' : 'out'}`;
      case 'waypoint': return `${who} will walk via ${s.x}, ${s.y}`;
      case 'wait': return `Wait ${s.frames} frames`;
      case 'anim': return `${who} · ${s.animationResource?.label ?? `Animation ${s.anim}`} (scene index ${s.anim}, resource ${s.animationResource?.id ?? '?'})`;
      case 'animWait': return `${who} waits for the current animation`;
      default: return `${s.name}(${s.args.join(', ')})`;
    }
  }

  renderTransport() {
    const stopIndex = this.stops.filter((k) => k <= this.pos).length;
    $('#cs-step').max = String(this.steps.length - 1);
    $('#cs-step').value = String(this.pos);
    $('#cs-step-label').textContent = `${stopIndex}/${this.stops.length} · ${this.describe(this.steps[this.pos])}`;
  }

  renderHover(h) {
    const el = $('#cs-hover');
    if (!h?.tile && !h?.unit) { el.textContent = 'Drag to orbit · right-drag to pan · scroll to zoom'; return; }
    el.textContent = h.unit ? `${h.unit.label} · tile ${Math.round(h.unit.x)}, ${Math.round(h.unit.y)}` : `Tile ${h.tile.x}, ${h.tile.y}`;
  }

  renderHeader() {
    const encounter = this.ctx.catalog.encounterForScene(this.file.id);
    $('#cs-title').textContent = encounter?.title ?? this.file.id;
    const sel = $('#cs-script');
    const drafts=battleDraftRecords(this.scene),record=this.storyRecord();
    sel.disabled=this.scene.parts.length+drafts.length<2;
    for(const id of ['cs-start','cs-prev','cs-play','cs-next','cs-end','cs-step'])$('#'+id).disabled=!this.part;
    sel.innerHTML=this.scene.parts.map((p,i)=>`<option value="${i}" ${i===this.scriptIndex?'selected':''}>${esc(this.partLabel(p))}</option>`).join('')
      +(drafts.length?`<optgroup label="Battles without a cutscene">${drafts.map(r=>`<option value="draft:${r.i}" ${!this.part&&r.i===record?.i?'selected':''}>${esc(this.draftLabel(r))}</option>`).join('')}</optgroup>`:'')
      ||'<option>No cutscene parts</option>';
    const maps = $('#cs-map-select');
    const chosen = this.ctx.catalog.chosenMap(this.mapKey);
    const { maxX, maxY } = this.bbox();
    const fits = this.ctx.catalog.maps.filter((m) => m.width > maxX && m.depth > maxY);
    const game = this.fromGame;
    maps.innerHTML = (game ? `<option value="">The game's map: ${esc(game.id)} ${this.ctx.catalog.placeLabel(game.id) ? ` (${esc(this.ctx.catalog.placeLabel(game.id))})` : ''}</option>` : `<option value="">${chosen ? 'No map (flat grid)' : '— choose the map for this cutscene —'}</option>`)
      + `<optgroup label="Maps the cast fits on">${fits.map((m) => `<option value="${m.id}">${esc(this.ctx.catalog.mapLabel(m))}</option>`).join('')}</optgroup>`
      + `<optgroup label="All maps">${this.ctx.catalog.maps.map((m) => `<option value="${m.id}">${esc(this.ctx.catalog.mapLabel(m))}</option>`).join('')}</optgroup>`;
    maps.value = chosen || '';
    const cast = [...new Set(this.scene.cast.map((c) => this.characterName(c.character)).filter(Boolean))];
    const battle = this.battlePreview?.doc;
    $('#cs-meta').textContent = [this.file.chapter?.label, encounter && this.file.id, cast.join(', '), battle?.fileName].filter(Boolean).join(' · ');
    const battleLink=$('#cs-open-battle');
    battleLink.hidden=!battle;
    battleLink.title=battle?`Open ${battle.fileName} for this cutscene part`:'';
    battleLink.onclick=async()=>{
      if(!battle)return;
      const use=this.battlePreview?.uses.find(u=>u.doc===battle&&u.context.slot==='normal');
      try{await this.ctx.openBattle(battle,use?.context);}catch(e){this.ctx.toast(e.message,true);}
    };
    $('#cs-battle-units-label').hidden = !!this.scene.cast.length || !battle;
    const conditional = (this.battlePreview?.candidates.size ?? 0) - (this.battlePreview?.actors.size ?? 0);
    $('#cs-conditional-units-label').hidden = !!this.scene.cast.length || !conditional;
    $('#cs-start-tiles-label').hidden = !battle;
    const note = $('#cs-context-note');
    const when = triggerSummary(this.triggersFor(), id => this.characterName(id) || `Character ${id}`);
    const starts = playerStartTiles(battle).length;
    note.textContent = battle ? `${when || 'Story part'} · Battle-start preview from ${battle.fileName}. Later positions, defeated units and your deployed army depend on the live battle.${conditional ? ` ${conditional} conditional unit candidates ${$('#cs-conditional-units').checked ? 'included' : 'hidden'}; their appearance rules are not evaluated.` : ''} Cyan outlines: ${starts} recorded friendly starting tiles; the full deployment boundary is not yet mapped.`
      : when ? `${when}. This part has no confirmed battle formation; party positions require runtime battle data.` : '';
    note.hidden = !note.textContent;
    note.title = triggerDetails(this.triggersFor());
    $('#cs-script').title = this.part?this.partLabel(this.part):record?.battleStage?this.draftLabel(record):'No cutscene parts';

  }

  renderLines() {
    const list = $('#cs-lines');
    list.innerHTML = '';
    if(!this.part){list.innerHTML='<p class="muted pad">This battle has no cutscene part yet.</p>';this.renderRetreatLines(list);return;}
    const parts = $('#cs-all-parts').checked ? this.scene.parts.map((p,pi) => ({p,pi})) : [{p:this.part,pi:this.scriptIndex}];
    const talks = parts.flatMap(({p,pi}) => (pi === this.scriptIndex ? this.steps : buildTimeline(p)).map((s,i) => ({s,i,pi})).filter(({s}) => s.kind === 'talk' || s.kind === 'narration'));
    let lastPart = -1;
    if (!talks.length) { list.innerHTML = '<p class="muted pad">This script has no dialogue.</p>'; this.renderRetreatLines(list); return; }
    for (const { s, i, pi } of talks) {
      if (lastPart !== pi) {
        lastPart = pi;
        const heading = document.createElement('button');
        heading.className = 'cs-part-heading'; heading.dataset.part = String(pi);
        heading.textContent = this.partLabel(this.scene.parts[pi]);
        heading.title = triggerDetails(this.triggersFor(this.scene.parts[pi]));
        heading.onclick = () => this.selectScript(pi);
        list.append(heading);
      }
      for (const key of this.keysFor(s.msg)) {
        const { text, info } = this.lineText(key);
        const card = document.createElement('div');
        card.className = 'line';
        card.dataset.step = String(i);
        card.dataset.part = String(pi);
        card.dataset.key = key;
        const had = this.hadVoice(key);
        card.innerHTML = `
          <div class="line-head">
            <button class="line-jump" title="Show this moment">▶</button>
            <b>${esc(this.lineSpeaker(s))}</b>
            <span class="muted">${esc(key.replace(/^SCENARIO_/, '').replace(/_TEXT$/, ''))}</span>
            ${had ? `<label class="voice" title="Play the recorded voice for this line (English and Japanese)"><input type="checkbox" ${this.isVoiced(key) ? 'checked' : ''}> Voice</label>`
              : this.muted.has(cueForKey(key)) ? '<span class="muted voice" title="Muted by the editor and saved. Restore originals brings the voice back.">voice muted</span>'
                : '<span class="muted voice">no voice</span>'}
          </div>
          <textarea rows="${Math.min(6, 1 + Math.ceil(text.length / 48))}" spellcheck="true"></textarea>`;
        const ta = card.querySelector('textarea');
        ta.value = text;
        ta.addEventListener('change', () => this.editLine(key, ta.value, info, card));
        card.querySelector('.line-jump').onclick = async () => { const scene = this.scene; this.stop(); if (pi !== this.scriptIndex) await this.selectScript(pi); if (scene === this.scene) this.stepTo(i); };
        card.querySelector('.voice input')?.addEventListener('change', (e) => { this.setVoiced(key, e.target.checked); this.render(); });
        list.append(card);
      }
    }
    this.renderRetreatLines(list);
  }

  // ---- a new in-battle event ----------------------------------------------------
  /** Named characters of the previewed battle: [{ id, name, side }]. */
  battleCharacters() {
    const doc = this.battlePreview?.doc, tables = this.ctx.tables(), out = new Map();
    for (const slot of doc?.unitSlots() ?? []) {
      const row = doc.row(slot), id = readField(row, FIELD.name);
      if (!id || id === 255 || out.has(id)) continue;
      const team = readField(row, FIELD.team);
      out.set(id, { id, name: tables?.unitName(id) || this.characterName(id) || `Character ${id}`, side: team === 1 ? (readField(row, FIELD.guest) ? 'guest' : 'your side') : team === 2 ? 'enemy' : 'other side' });
    }
    return [...out.values()];
  }

  renderEventForm(list) {
    const record = this.storyRecord(), who = this.battleCharacters();
    if (!this.part || !record?.battleStage || !who.length || !this.scene.chapterFile) return;
    const box = document.createElement('details');
    box.className = 'speech-all event-add';
    box.open = !!this.eventFormOpen;
    box.innerHTML = `<summary title="Makes a new, empty part of this scene that the game plays during this battle, the first time the chosen character's turn starts or ends. Then add its lines and other steps under the map.">+ Add an in-battle event (new dialogue during this battle)</summary>
      <div class="se-row"><label>When <select data-ev="group"><option value="1">a character's turn starts</option><option value="5">a character's turn ends</option></select></label>
      <label>Who <select data-ev="who">${who.map((c) => `<option value="${c.id}">${esc(c.name)} · ${c.side}</option>`).join('')}</select></label>
      <button data-ev="add">Add event</button></div>
      <div class="muted">Plays once per battle, like the game's own turn events (it gets its own "already played" flag). The new part starts empty: use <b>Add a new step</b> under the map to add its lines. Not yet tested in game.</div>`;
    box.addEventListener('toggle', () => { this.eventFormOpen = box.open; });
    box.querySelector('[data-ev="add"]').onclick = () => this.addBattleEvent(Number(box.querySelector('[data-ev="group"]').value), Number(box.querySelector('[data-ev="who"]').value));
    list.append(box);
  }

  async addBattleEvent(group, character) {
    if (!this.guardEdit() || this.addingEvent) return;
    this.addingEvent = true;
    const scene = this.scene, chapter = scene.chapterFile, like = this.storyRecord();
    let ev = null;
    try {
      ev = chapter.addBattleEvent(like, { group, character });
      const record = chapter.allRecords().find((r) => r.scene === ev.scene);
      const part = await addEventPart(scene, record);
      part.event = ev;
      this.chapterFiles.add(chapter);
      this.edited.set(scene.fileName, scene);
      this.undoStack.length = 0;
      this.ctx.onChange();
      if (this.scene === scene) {
        await this.selectScript(scene.parts.indexOf(part));
        this.renderList();
        const actor = this.battlePreview?.doc?.unitSlots().map((s) => this.battlePreview.doc.row(s)).find((row) => readField(row, FIELD.name) === character);
        Object.assign(this.addForm, { type: 'line', actor: actor ? readField(actor, FIELD.template) : this.addForm.actor });
        this.renderStepEditor();
        document.querySelector('#cs-stepedit .se-insert')?.setAttribute('open', '');
      }
      this.ctx.setStatus(`New in-battle event: plays the first time ${this.characterName(character) ?? `character ${character}`}'s turn ${group === 1 ? 'starts' : 'ends'} (scene part ${ev.scene}, event flag ${ev.flag}). Add its lines under the map, then save.`);
    } catch (error) {
      if (ev) chapter.removeBattleEvent(ev);
      console.error(error);
      this.ctx.toast(error.message, true);
    } finally { this.addingEvent = false; }
  }

  // ---- lines said when a unit falls (shift stone retreat, or death) -------------
  // Not part of any scene script: the game picks them itself when a unit drops to
  // 0 HP. Texts SPEECH_LC_SPEECH_<row>_FLIGHT (leaves by shift stone) and _DEATH
  // (dies), rows 0-67; a unit's row is byte +0x2F of its character sheet (unit
  // template, battle data entry 23). Rows 1-40 belong to story characters, 41-58
  // to generic soldiers' sheets and 59-67 to monsters'.
  speechRow(template) {
    const t = this.ctx.tables()?.tables?.unitTemplate;
    return t && template > 0 && template < t.count ? t.row(template)[0x2F] : 0;
  }

  speechKey(row, kind) { return `SPEECH_LC_SPEECH_${String(row).padStart(3, '0')}_${kind}`; }

  /** Speech row -> names of the character sheets that use it. */
  speechOwners() {
    if (this.speechOwnerMap) return this.speechOwnerMap;
    const tables = this.ctx.tables(), t = tables?.tables?.unitTemplate, out = new Map();
    for (let id = 1; t && id < t.count; id++) {
      const row = t.row(id)[0x2F];
      if (!row) continue;
      if (!out.has(row)) out.set(row, []);
      out.get(row).push(this.characterName(id) || tables.templateName(id) || `Character sheet ${id}`);
    }
    return (this.speechOwnerMap = out);
  }

  speechCard(row, title, sub) {
    const card = document.createElement('div');
    card.className = 'line speech-line';
    card.dataset.speech = String(row);
    const owners = this.speechOwners().get(row) ?? [];
    card.title = `Fallen-unit lines, row ${row}. Used by: ${owners.join(', ') || 'no character sheet'}.\nThese texts belong to the character, not to this scene: an edit shows in every battle.`;
    card.innerHTML = `<div class="line-head"><b>${esc(title)}</b><span class="muted">${esc(sub)}</span></div>`;
    for (const [kind, label, help] of [['FLIGHT', 'Leaves by shift stone', 'Said when this unit drops to 0 HP and leaves the battle alive (guests and story characters).'], ['DEATH', 'Dies', 'Said when this unit dies for good. Empty for most story characters, who have their own scenes.']]) {
      const key = this.speechKey(row, kind);
      if (!this.localize.has(key)) continue;
      const { text, info } = this.lineText(key);
      const wrap = document.createElement('label');
      wrap.className = 'speech-kind';
      wrap.title = `${help}\nText name: ${key}`;
      wrap.innerHTML = `<span class="muted">${label}</span><textarea rows="${Math.min(4, 1 + Math.ceil(text.length / 48))}" spellcheck="true" placeholder="(no line)"></textarea>`;
      const ta = wrap.querySelector('textarea');
      ta.value = text;
      ta.addEventListener('change', () => {
        if (!this.guardEdit()) { ta.value = text; return; }
        this.localize.set(key, encodeFromEdit(ta.value, info));
        for (const c of document.querySelectorAll(`#cs-lines [data-speech="${row}"]`)) {
          c.classList.add('edited');
          for (const other of c.querySelectorAll('textarea')) if (other !== ta && other.closest('label').title.endsWith(key)) other.value = ta.value;
        }
        this.ctx.onChange();
      });
      card.append(wrap);
    }
    return card;
  }

  renderRetreatLines(list) {
    this.renderEventForm(list);
    const tables = this.ctx.tables();
    if (!tables?.tables?.unitTemplate || !this.localize?.has(this.speechKey(1, 'FLIGHT'))) return;
    const doc = this.battlePreview?.doc;
    const head = document.createElement('div');
    head.className = 'cs-part-heading speech-heading';
    head.textContent = doc ? `When a unit falls · shift stone and death lines · ${doc.fileName}` : 'When a unit falls · shift stone and death lines';
    head.title = 'These lines are not in any scene script. The game shows them itself when a unit drops to 0 HP: guests and story characters leave by shift stone with the first line, others die with the second. Each line belongs to a character (or to a kind of soldier), so an edit shows in every battle.';
    list.append(head);
    if (doc) {
      const rows = new Map(); // speech row -> who in this battle uses it
      for (const slot of doc.unitSlots()) {
        const unit = doc.row(slot), template = readField(unit, FIELD.template), row = this.speechRow(template);
        if (!row || !this.localize.has(this.speechKey(row, 'FLIGHT'))) continue;
        const name = tables.unitName(readField(unit, FIELD.name)) || tables.className(readField(unit, FIELD.class), tables.isFemale(template)) || `Unit ${slot + 1}`;
        const side = readField(unit, FIELD.team) === 1 ? (readField(unit, FIELD.guest) ? 'guest' : 'your side') : readField(unit, FIELD.team) === 2 ? 'enemy' : 'other side';
        if (!rows.has(row)) rows.set(row, { names: new Map(), sides: new Set() });
        const r = rows.get(row);
        r.names.set(name, (r.names.get(name) ?? 0) + 1);
        r.sides.add(side);
      }
      const order = { guest: 0, 'your side': 1, 'other side': 2, enemy: 3 };
      const sorted = [...rows].sort((a, b) => Math.min(...[...a[1].sides].map((s) => order[s])) - Math.min(...[...b[1].sides].map((s) => order[s])) || a[0] - b[0]);
      for (const [row, r] of sorted) {
        const names = [...r.names].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
        list.append(this.speechCard(row, names, `${[...r.sides].join(', ')} · row ${row}`));
      }
      if (!sorted.length) list.insertAdjacentHTML('beforeend', '<p class="muted pad">No unit in this battle file has a fallen-unit line.</p>');
    }
    const all = document.createElement('details');
    all.className = 'speech-all';
    all.innerHTML = '<summary>All shift stone and death lines (every character)</summary>';
    all.addEventListener('toggle', () => {
      if (!all.open || all.dataset.filled) return;
      all.dataset.filled = '1';
      for (let row = 1; this.localize.has(this.speechKey(row, 'FLIGHT')); row++) {
        const owners = this.speechOwners().get(row) ?? [];
        const title = owners.length ? owners.slice(0, 3).join(', ') + (owners.length > 3 ? ` +${owners.length - 3} more` : '') : 'Not used by any character sheet';
        all.append(this.speechCard(row, title, `row ${row}`));
      }
    });
    list.append(all);
  }

  editLine(key, text, info, card) {
    this.localize.set(key, encodeFromEdit(text, info));
    card.classList.add('edited');
    // Recorded speech no longer matches edited text: switch it off (can be turned back on).
    if (this.isVoiced(key)) {
      this.setVoiced(key, false);
      const box = card.querySelector('.voice input');
      if (box) box.checked = false;
      this.ctx.toast('Voice switched off for this line so it matches the new text. Tick "Voice" to keep it.');
    }
    this.ctx.onChange();
    this.render();
  }

  highlightLine(line) {
    for (const c of document.querySelectorAll('#cs-lines .line')) c.classList.toggle('current', line && c.dataset.part === String(this.scriptIndex) && c.dataset.step === String(this.pos));
    const cur = document.querySelector('#cs-lines .line.current');
    cur?.scrollIntoView({ block: 'nearest' });
  }

  renderList() {
    const list = $('#cs-list');
    const q = this.filter.trim().toLowerCase();
    const titles = new Map(this.ctx.catalog.customEncounters().map(row => [row.scene, row.title]));
    list.innerHTML = '';
    for (const ch of [...CHAPTERS, { prefix: null, label: 'Other' }]) {
      const files = this.files.filter((f) => (f.chapter ? f.chapter.prefix === ch.prefix : ch.prefix === null) &&
        (!q || f.id.toLowerCase().includes(q) || titles.get(f.id)?.toLowerCase().includes(q)));
      if (!files.length) continue;
      const head = document.createElement('div');
      head.className = 'list-group';
      head.textContent = `${ch.label} (${files.length})`;
      list.append(head);
      for (const f of files) {
        const b = document.createElement('button');
        b.className = `battle${this.file?.id === f.id ? ' active' : ''}`;
        const mapped = this.ctx.catalog.chosenMap({ key: `scene:${f.id.toLowerCase()}` });
        const title = titles.get(f.id);
        b.innerHTML = `<span class="battle-title">${esc(title ?? f.id)}${this.edited.has(f.name) ? ' <span class="dirty">●</span>' : ''}</span><span class="battle-sub">${title ? esc(f.id) + ' · ' : ''}${(f.size / 1024 / 1024).toFixed(1)} MB${mapped ? ' · map ✓' : ''}</span>`;
        b.onclick = () => this.openScene(f);
        list.append(b);
      }
    }
    $('#cs-count').textContent = String(this.files.length);
  }

  // ---- positions ----------------------------------------------------------
  /** The step that put `actor` where it stands at the current moment. */
  positionStep(actor) {
    for (let k = this.pos; k >= 0; k--) {
      const s = this.steps[k];
      if (s.actor === actor && (s.kind === 'place' || s.kind === 'move')) return s;
    }
    return null;
  }

  /** Dragging a character edits the command that put it there (its placement or walk). */
  dragActor(actor, x, y) {
    if (this.ctx.readOnly?.()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return; }
    const s = this.positionStep(actor);
    if (!s) { this.ctx.toast(`${this.speaker(actor)} isn't placed by this part's scripts yet at this step.`, true); return; }
    const locked = ['x', 'y'].map((f) => fieldLock(s, f)).filter(Boolean);
    if (locked.length === 2) { this.ctx.toast(`Can't move ${this.speaker(actor)} here: the position ${locked[0]}.`, true); return; }
    this.editStep(s, { x, y });
    if (locked.length) this.ctx.toast(`Only part of the position could change: one coordinate ${locked[0]}.`);
    else this.ctx.setStatus(`${this.describeStep(this.steps[this.pos] ?? s)} (${s.kind === 'move' ? 'walk destination' : 'placement'} edited)`);
  }

  /** Apply field values to a step's command, then rebuild the timeline at the same moment. */
  async editStep(step, values) {
    // stay on the step that is showing, also when one of its pieces (a via point) was the one edited
    const shown = this.steps[this.pos] ?? step;
    const key = { script: shown.script, at: shown.at };
    const nth = this.steps.slice(0, this.pos + 1).filter((s) => s.script === key.script && s.at === key.at).length;
    this.pushUndo(`Change ${Object.keys(values).join(', ')}`);
    try {
      for (const [field, value] of Object.entries(values)) if (!fieldLock(step, field)) setStepField(this.part, step, field, value);
    } catch (err) {
      this.undoStack.pop();
      this.ctx.toast(err.message, true);
      return;
    }
    if(step.kind==='cast'&&Object.hasOwn(values,'effect')){
      const scene=this.scene,part=this.part;this.edited.set(scene.fileName,scene);this.ctx.onChange();
      await refreshEffectDurations(scene);if(this.scene!==scene||this.part!==part)return;
    }
    this.carryAddedCharacters();
    this.edited.set(this.scene.fileName, this.scene);
    if (!sceneDirty(this.scene)) this.edited.delete(this.scene.fileName);
    this.rebuildSteps();
    // stay on the same command (timing can shift when a walk gets longer or shorter)
    const same = this.steps.map((s, k) => ({ s, k })).filter(({ s }) => s.script === key.script && s.at === key.at);
    const target = same[Math.max(0, nth - 1)]?.k;
    if (target !== undefined && this.pos >= 0) this.pos = target;
    this.ctx.onChange();
    this.renderHeader();
    this.renderList();
    this.render();
    this.renderStepEditor();
  }

  renderStepEditor() {
    const box = $('#cs-stepedit');
    if (!this.scene || !this.part) {
      const record=this.storyRecord();
      if(!this.scene||!record?.battleStage){box.hidden=true;return;}
      box.hidden=false;box.innerHTML='<div class="se-current"><b>This battle has no cutscene yet</b><button id="cs-create-part">Add cutscene</button></div><p class="muted">The battle map is ready. Add a cutscene to start inserting dialogue, movement and other steps. Opening this view does not change the battle.</p>';
      $('#cs-create-part').onclick=()=>this.createBattleCutscene();return;
    }
    const s = this.steps[this.pos];
    const fields = s ? stepFields(s) : {};
    const changed = partChanged(this.scene, this.part);
    box.hidden = false;
    if (!s || !Object.keys(fields).length) {
      box.innerHTML = `${s?'<div class="se-current"><b>Editing current step</b> <button id="cs-delete-step" class="ghost">Delete this step</button></div>':''}${this.addFormHtml(s)}<div class="se-foot">
        ${changed ? '<span class="muted">This part was edited.</span>' : ''}${this.undoButtonHtml()}${changed ? ` <button id="cs-revert-part" class="ghost">${this.part.addedEvent ? 'Remove this added event' : 'Revert this part'}</button>` : ''}</div>`;
      this.bindStepEditor(box, s);
      return;
    }
    const runs = this.steps.filter((x) => x.script === s.script && x.at === s.at).length;
    const input = (step, field, label) => {
      const why = fieldLock(step, field);
      const value = step[field] ?? '';
      if(field==='actor')return `<label>Character <select data-field="actor" ${why?'disabled':''}>${this.actorOptions(value)}</select></label>`;
      if(field==='box')return `<label>Dialogue box <select data-field="box">${Object.entries(TALK_BOXES).map(([id,name])=>`<option value="${id}" ${name===value?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
      if (field === 'dir') {
        const opts = FACING.map((f, i) => `<option value="${i}" ${Number(value) === i ? 'selected' : ''}>${f}</option>`).join('');
        return `<label class="${why ? 'locked' : ''}" title="${esc(why ?? 'Chooses which way this actor faces at this command. It does not move the actor or change their battle team.')}">${label} <select data-field="dir" ${why ? 'disabled' : ''}>${opts}${value === '' || FACING[value] ? '' : `<option selected>${esc(value)}</option>`}</select></label>`;
      }
      if (field === 'anim') {
        return `<label title="Names come from the original assets. Each resource includes its own character artwork. IDs refer to this part's resource list.">Animation <select data-field="anim" ${why ? 'disabled' : ''}>${this.animationOptions(value)}</select></label>`;
      }
      if(field==='action')return `<label>Body action <select data-field="action" ${why?'disabled':''}>${this.bodyOptions(value)}</select></label>`;
      if(field==='effect')return `<label>Spell / effect <span data-effect-picker data-effect-value="${esc(value)}" ${why?'data-locked':''}></span></label>`;
      return `<label class="${why ? 'locked' : ''}" title="${esc(why ?? `Sets the actor’s ${field.toUpperCase()} map-tile coordinate for this placement, walking destination or waypoint. This edits the cutscene command, not every battle appearance of the character.`)}">${label} <input data-field="${field}" type="number" step="1" value="${esc(value)}" ${why ? 'disabled' : ''}></label>`;
    };
    const row = (step, title, extra = '') => `<div class="se-row" data-at="${step.at}" data-script="${step.script}">
        <span class="se-title">${esc(title)}</span>
        ${Object.keys(stepFields(step)).map((f) => input(step, f, f === 'dir' ? 'Facing' : f.toUpperCase())).join('')}${extra}
      </div>`;
    const kinds = { place: 'Placed at', move: s.flying?'Flies to':'Walks to', waypoint: 'Walks via', face: 'Turns to', anim: 'Plays animation',body:'Body action',weapon:'Weapon action',cast:'Casts at tile',worldOffset:'Offset in world space' };
    let html = `<div class="se-current"><b>Editing current step · ${esc(this.describe(s))}</b> <button id="cs-delete-step" class="ghost">Delete this step</button></div>`+row(s,typeof s.actor==='number'?`${this.speaker(s.actor)} · ${kinds[s.kind]||s.kind}`:s.kind);
    if(['talk','narration'].includes(s.kind)){
      // A line's pieces are its pages: each is shown in its own box, one after the other.
      const keys=this.keysFor(s.msg);
      html+=keys.map((key,i)=>`<div class="se-piece"><label>${keys.length>1?`Page ${i+1} of ${keys.length}`:'Current dialogue'}<textarea data-current-text="${esc(key)}" rows="3">${esc(this.lineText(key).text)}</textarea></label>${keys.length>1?`<button class="ghost" data-remove-page="${i}" title="Remove this page from the line. The other pages stay. Undo brings it back.">Remove page</button>`:''}</div>`).join('');
      if(keys.length)html+='<div class="se-row"><button data-add-page title="Add another page (dialogue box) to this line, after the last one. New pages have no recorded voice.">+ Add a page</button><span class="muted">A line can show several pages one after the other; each page is one dialogue box.</span></div>';
    }
    if (s.kind === 'anim') {
      const r = s.animationResource;
      html += `<div class="muted">${esc(r?.nativeName ? `Original asset: ${r.nativeName}` : 'No original asset name found')}${r?.error ? ` · ${esc(r.error)}` : ''}${r?.definition?.has3d ? ' · Position offsets use the current preview scale; verify them in game.' : ''}</div>`;
    }
    if(s.kind==='weapon')html+='<div class="muted">Shows the character and weapon artwork together. −1 uses equipped gear. Automatic gear is shown only when the record’s minimum level leaves one matching weapon appearance; the game’s battle level can change the generated equipment.</div>';
    if(s.kind==='cast')html+='<div class="muted">The game executes the whole ability and waits for it. This preview uses the same original effect layers as the effect viewer and keeps their visible tail after the casting pose ends. Timing and some attachments remain approximate; unsupported layer types are listed in the effect viewer. Battle results are not simulated.</div>';
    if (s.kind === 'move') {
      // A walk's pieces are its via points: tiles the character passes before the destination.
      s.waypoints?.forEach((w, i) => { html += row(w, `via point ${i + 1}`, `<button class="ghost" data-remove-via="${i}" title="Remove this via point; the walk keeps its other points and its destination. Undo brings it back.">Remove</button>`); });
      html += `<div class="se-row"><button data-add-via title="Add a tile this walk passes through, after the via points it already has and before its destination.">+ Add a via point</button><span class="muted">${s.waypoints?.length ? 'Via points are passed in this order, then the destination.' : 'This walk goes straight to its destination. Add via points to choose its route.'}</span></div>`;
    }
    html += this.addFormHtml(s);
    html += `<div class="se-foot">${runs > 1 ? `<span class="warn">This command runs ${runs} times in this part; editing it changes every run.</span>` : ''}
      ${this.undoButtonHtml()}${changed ? `<button id="cs-revert-part" class="ghost">${this.part.addedEvent ? 'Remove this added event' : 'Revert this part'}</button>` : ''}</div>`;
    box.innerHTML = html;
    for (const el of box.querySelectorAll('[data-field]')) {
      attachHelp(el, el.closest('label').title);
      el.onchange = () => {
        const rowEl = el.closest('.se-row');
        const target = [s, ...(s.waypoints ?? [])].find((x) => String(x.at) === rowEl.dataset.at && String(x.script) === rowEl.dataset.script);
        if (this.ctx.readOnly?.()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); this.renderStepEditor(); return; }
        if(el.dataset.field==='actor'&&el.value.startsWith('add:')){this.addActorChoice(Number(el.value.slice(4)),target);return;}
        this.editStep(target, { [el.dataset.field]: el.value });
      };
    }
    for(const ta of box.querySelectorAll('[data-current-text]'))ta.onchange=()=>{if(!this.guardEdit())return;const key=ta.dataset.currentText;this.editLine(key,ta.value,this.lineText(key).info,ta.closest('label'));this.renderLines();};
    for (const b of box.querySelectorAll('[data-remove-via]')) b.onclick = () => this.removeViaPoint(s, Number(b.dataset.removeVia));
    box.querySelector('[data-add-via]')?.addEventListener('click', () => this.addViaPoint(s));
    for (const b of box.querySelectorAll('[data-remove-page]')) b.onclick = () => this.removePage(s, Number(b.dataset.removePage));
    box.querySelector('[data-add-page]')?.addEventListener('click', () => this.addPage(s));
    const effectHost = box.querySelector('[data-effect-picker]');
    if (effectHost) {
      const picker = this.effectPicker(Number(effectHost.dataset.effectValue), value => {
        if (this.guardEdit()) this.editStep(s, { effect: value });
      });
      picker.disabled = effectHost.hasAttribute('data-locked') || !!this.ctx.readOnly?.();
      effectHost.append(picker);
    }
    this.bindStepEditor(box, s);
  }

  undoButtonHtml() {
    const u = this.undoStack.at(-1);
    return u && u.scene === this.scene && u.part === this.scriptIndex
      ? `<button id="cs-undo-step" class="ghost" title="Takes back the last change made to this part's steps here: an edited value, an added or deleted step, a via point or a page.">Undo: ${esc(u.label)}</button>` : '';
  }

  actorOptions(value){
    const actors=new Map(this.scene.cast.map((c,i)=>[slotActor(this.scene,i),this.speaker(slotActor(this.scene,i))]));
    for(const a of [...this.steps.map(s=>s.actor),...(this.battlePreview?.candidates.keys()??[])])if(typeof a==='number')actors.set(a,this.speaker(a));
    if(value!==undefined&&!actors.has(Number(value)))actors.set(Number(value),this.speaker(Number(value)));
    const available=new Map();for(const look of this.characterLooks??[])if(this.scene.cast.length&&look.character>0&&!actors.has(look.character))available.set(look.character,this.characterName(look.character)||this.ctx.tables()?.unitName(look.character)||`Character ${look.character}`);
    if(!this.scene.cast.length)for(const [id,donor] of this.ctx.sync?.characters()??[]){const actor=readField(donor.unit.row,FIELD.template);if(!actors.has(actor))available.set(id,this.ctx.sync.name(id));}
    return `<optgroup label="In this scene">${[...actors].map(([id,name])=>`<option value="${id}" ${Number(value)===id?'selected':''}>${esc(name)} · ${id}</option>`).join('')}</optgroup><optgroup label="Add character to scene">${[...available].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>`<option value="add:${id}">${esc(name)}</option>`).join('')}</optgroup>`;
  }

  async addActorChoice(character,step=null){
    if(!this.guardEdit())return;
    try{
      let actor=character;
      const oldScript=step&&this.part.file.scripts[step.script],oldIndex=oldScript?.code.findIndex(op=>op.at===step.at),oldLength=oldScript?.code.length;
      if(this.scene.cast.length){
        const look=this.characterLooks?.find(l=>l.character===character);if(!look)throw new Error('No original appearance is available for that character.');
        actor=await addCastRow(this.scene,look);
        for(const p of this.scene.parts)insertBefore(this.scene,p,null,COMMANDS.hideNow(actor));
      }else{
        const donor=this.ctx.sync?.characters().get(character);if(!donor)throw new Error('This character has no battle formation to copy.');
        if(!this.battlePreview?.doc)throw new Error('This part has no confirmed battle formation. Add the character in the linked battle first.');
        actor=readField(donor.unit.row,FIELD.template);
        await this.ctx.sync.sceneCharacterAdded(this.scene,this.part,null,character,'guest');
      }
      if(step){
        const script=this.part.file.scripts[step.script],index=oldIndex+(step.script===0?script.code.length-oldLength:0),at=script.code[index]?.at;
        const refreshed=buildTimeline(this.part).find(s=>s.script===step.script&&s.at===at);
        if(!refreshed)throw new Error('The current command could not be located after adding the character.');
        setStepField(this.part,refreshed,'actor',actor);
      }
      this.addForm.actor=actor;this.edited.set(this.scene.fileName,this.scene);
      const oldPos=this.pos;this.afterScriptChange(oldPos);
      if(step){const pos=this.steps.findIndex(s=>s.script===step.script&&s.kind===step.kind&&s.actor===actor&&s.seq>=step.seq);if(pos>=0)this.stepTo(pos);}
    }catch(error){this.ctx.toast(error.message,true);this.renderStepEditor();}
  }

  animationOptions(value) {
    const resources = this.part?.animations ?? [];
    if (!resources.length) return '<option value="" disabled selected>No animations bundled in this part</option>';
    const options = resources.map((r, i) => `<option value="${i}" title="${esc(r.nativeName ?? '')}" ${Number(value) === i ? 'selected' : ''}>${i}: ${esc(r.label)} · resource ${r.id}</option>`).join('');
    return options + (resources[Number(value)] ? '' : `<option value="${esc(value)}" selected>Unresolved animation ${esc(value)}</option>`);
  }

  bodyOptions(value){
    const count=this.part?.bodyDurations?.length??118;
    return Array.from({length:count},(_,i)=>`<option value="${i}" ${Number(value)===i?'selected':''}>${i}: ${esc(BODY_ACTION_NAMES[i]??'Body action '+i)}</option>`).join('');
  }

  effectPicker(value, onChange) {
    const tables = this.ctx.tables();
    const options = (tables?.lists.effect ?? []).map(option => option.id ? {
      ...option, art: () => abilityArt('effect', option.id, tables, this.ctx.lang?.()),
    } : option);
    const picker = createPicker({ options, value, onChange, allowRaw: false, emptyLabel: 'Choose a spell or effect' });
    picker.setAttribute('aria-label', 'Spell / effect');
    return picker;
  }

  /** The "add a command" row of the step bar. */
  addFormHtml(step) {
    const f = this.addForm;
    let actors = this.scene.cast.map((c, slot) => ({ actor: slotActor(this.scene, slot), name: this.speaker(slotActor(this.scene, slot)) }));
    if (!actors.length) {
      // Known runtime unit IDs, not an invented contiguous list of unit-file slots.
      const used = this.steps.map((x) => x.actor).filter((a) => typeof a === 'number' && a > 0);
      const known = [...new Set([...used, ...(this.battlePreview?.candidates.keys() ?? [])])].filter(a => a > 0).sort((a,b) => a-b);
      actors = known.map(actor => ({ actor, name: `${this.speaker(actor)} · actor ${actor}` }));
      if (!actors.length) actors = [{actor:1,name:'Leader / actor 1 (runtime party)'}];
    }
    if (f.actor === null || !actors.some((a) => a.actor === f.actor)) f.actor = actors[0]?.actor ?? 1;
    const types = { place: 'Place', walk: 'Walk to', fly:'Fly to',via: 'Walk via (before a walk)', face: 'Turn', anim: 'Scene animation',body:'Body action / attack',weapon:'Equipped weapon action',cast:'Cast spell / effect', line: 'Line of dialogue', closeDialogue: 'Close dialogue', notice: 'Notice box ("You received…")', wait: 'Wait', show: 'Fade in', hide: 'Fade out', hidenow: 'Hide at once' };
    const uses = { place: 'xy dir', walk: 'xy',fly:'xy', via: 'xy', face: 'dir', anim: 'anim',body:'action',weapon:'weapon',cast:'effect xy', line: 'text box closeAfterLine', closeDialogue: '', notice: 'text', wait: 'frames', show: 'frames', hide: 'frames', hidenow: '' }[f.type];
    const on = (k) => (uses.split(' ').includes(k) ? '' : ' hidden');
    return `<details class="se-insert"${this.stops.length ? '' : ' open'}><summary>Add a new step</summary><div class="se-add" data-uses="${uses}">
      <span class="se-title">Add</span>
      <select data-add="type">${Object.entries(types).map(([k, l]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${['wait', 'notice', 'closeDialogue'].includes(f.type) ? '' : `<select data-add="actor" title="Who">${this.actorOptions(f.actor)}</select>`}
      <label${on('xy')}>X <input data-add="x" type="number" value="${f.x}"></label>
      <label${on('xy')}>Y <input data-add="y" type="number" value="${f.y}"></label>
      <label${on('dir')}>Facing <select data-add="dir">${FACING.map((n, i) => `<option value="${i}" ${i === f.dir ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label${on('anim')}>Animation <select data-add="anim">${this.animationOptions(f.anim)}</select></label>
      <label${on('action')}>Body action <select data-add="action">${this.bodyOptions(f.action)}</select></label>
      <label${on('weapon')}>Weapon (−1 equipped) <input data-add="weapon" type="number" min="-1" max="760" value="${f.weapon}"></label>
      <label${on('effect')}>Spell / effect <span data-add-effect></span></label>
      <label${on('frames')}>Frames <input data-add="frames" type="number" value="${f.frames}"></label>
      <label${on('box')}>Box <select data-add="box">${Object.entries(TALK_BOXES).map(([n, l]) => `<option value="${n}" ${Number(n) === f.box ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label${on('closeAfterLine')}><input data-add="closeAfterLine" type="checkbox" ${f.closeAfterLine ? 'checked' : ''}> Close box after this line</label>
      <textarea data-add="text" rows="2" class="se-text${on('text')}" placeholder="Text. A blank line starts a new page; {Leader} is the player's name.">${esc(f.text)}</textarea>
      <button data-add="before">Insert ${step ? 'before' : 'at start'}</button>
      ${step ? '<button data-add="after">Insert after</button>' : ''}
        ${f.type==='cast'?'<div class="muted">Exorcism includes its original symbol, sparkles and target flash, with approximate timing and placement. Effects use the same original layers as the effect viewer. Battle results require an in-game test.</div>':f.type==='weapon'?'<div class="muted">Preview includes the weapon’s artwork, movement and foreground/background order.</div>':''}
    </div></details>`;
  }

  bindStepEditor(box, step) {
    const f = this.addForm;
    const help = {
      type: 'Chooses the kind of cutscene command to insert, such as placement, walking, facing, dialogue, waiting or fading. The remaining controls describe that new command.',
      actor: 'Chooses the cast member or battle unit affected by the new command. Battle actor IDs come from the unit/template ID, rather than the order of rows in the formation.',
      x: 'Sets the new command’s X map-tile coordinate. For a walk it is the destination; for Place it is the placement position.',
      y: 'Sets the new command’s Y map-tile coordinate. This is a position on the map, not the actor’s elevation.',
      dir: 'Chooses which way the actor faces for the inserted placement or turn command.',
      frames: 'Sets the command’s duration/wait in script frames. This is cutscene timing, not battle Recovery Time or a number of turns.',
      anim: 'Selects an animation already bundled in this scene part. Each action uses its own character artwork; choosing a different actor does not redraw it for that character. Names come from the original assets. Insertion also waits for the animation to finish.',
      action:'Uses the selected character’s own battle poses. The number selects a shared action, with four facing directions. It does not apply damage.',
        weapon:'−1 uses the actor’s equipped weapon in game. A positive number previews that equipment’s artwork and motion. This does not change equipment or apply damage.',
      effect:'Runs the game’s battle spell/effect at X,Y and waits for completion. Effects can change units or terrain in game; the preview shows only a casting pose.',
      box: 'Chooses where/how this new line’s dialogue box is presented. This does not change who speaks the line.',
      closeAfterLine: 'Closes the dialogue box in game after the last page. Clear this to leave it open for a later Close dialogue step.',
      text: 'Writes the inserted dialogue. A blank line starts a new page; {Leader} inserts the player character’s name. New text does not create a matching recorded voice line.',
      before: 'Inserts the configured command before the selected step, or at the start when no step is selected.',
      after: 'Inserts the configured command after the selected step. Commands that run several times can affect each execution of that script command.',
    };
    for (const el of box.querySelectorAll('.se-add [data-add]')) {
      attachHelp(el, help[el.dataset.add] || 'Configures the new cutscene command.');
      if (el.tagName === 'BUTTON') continue;
      el.onchange = () => {
        const k = el.dataset.add;
        if(k==='actor'&&el.value.startsWith('add:')){this.addActorChoice(Number(el.value.slice(4)));return;}
        if (k === 'type') {
          f.type = el.value;
          this.renderStepEditor();
        } else if (el.type === 'checkbox') {
          f[k] = el.checked;
        } else {
          f[k] = k === 'text' ? el.value : Number(el.value);
        }
      };
    }
    if (f.type === 'cast') {
      const picker = this.effectPicker(f.effect, value => { f.effect = Number(value); });
      picker.disabled = !!this.ctx.readOnly?.();
      box.querySelector('[data-add-effect]')?.append(picker);
    }
    box.querySelector('[data-add="text"]')?.addEventListener('input', (e) => { f.text = e.target.value; });
    box.querySelector('[data-add="before"]')?.addEventListener('click', () => this.addCommand(step, 'before'));
    box.querySelector('[data-add="after"]')?.addEventListener('click', () => this.addCommand(step, 'after'));
    box.querySelector('#cs-delete-step')?.addEventListener('click', () => this.removeStep(step));
    box.querySelector('#cs-undo-step')?.addEventListener('click', () => this.undoLast());
    box.querySelector('#cs-revert-part')?.addEventListener('click', () => this.revertPartPositions());
  }

  guardEdit() {
    if (this.ctx.readOnly?.()) { this.ctx.toast('Read-only mode: start the server without --readonly to edit.', true); return false; }
    return true;
  }

  // ---- undo (step edits, added and deleted steps, pieces of a step) -----------
  /** Remember the scene's scripts, cast rows and the chapter's message rows before a change. */
  pushUndo(label) {
    const scene = this.scene, chapter = scene.chapterFile ?? null;
    this.undoStack.push({ scene, label, part: this.scriptIndex, pos: this.pos, scripts: snapshotScripts(scene), chapter, rows: chapter?.snapshotRows() ?? null, keys: new Set(this.newKeys) });
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  undoLast() {
    if (!this.guardEdit()) return;
    const u = this.undoStack.pop();
    if (!u) return;
    if (u.scene !== this.scene || u.part !== this.scriptIndex || !restoreScripts(u.scene, u.scripts)) {
      this.undoStack.length = 0;
      this.ctx.toast('That change can no longer be undone here (the scene or its cast changed since). Use Revert this part instead.', true);
      this.renderStepEditor();
      return;
    }
    if (u.rows) { u.chapter.restoreRows(u.rows); this.scene.messages = u.chapter.messages(); }
    for (const key of [...this.newKeys]) if (!u.keys.has(key)) { this.newKeys.delete(key); this.localize.remove(key); }
    this.afterScriptChange(u.pos);
    this.ctx.setStatus(`Undone: ${u.label}`);
  }

  // ---- pieces of a step: via points of a walk, pages of a line -----------------
  /** Add a via point to the walk `move`, last in its path (then drag it or type its tile). */
  addViaPoint(move) {
    if (!this.guardEdit()) return;
    const last = move.waypoints?.at(-1);
    const before = this.pos > 0 ? stateAt(this.steps, this.pos - 1, this.initialActors()).actors.get(move.actor) : null;
    // start between where the walk comes from and where it goes, so the new point is easy to find
    const from = last ?? before ?? move;
    const mid = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.round((a + b) / 2) : Number.isFinite(b) ? b : 0);
    const x = mid(from.x, move.x), y = mid(from.y, move.y);
    this.pushUndo('Add a via point');
    try {
      addWaypoint(this.scene, this.part, move, x, y);
    } catch (err) { this.undoStack.pop(); this.ctx.toast(err.message, true); return; }
    this.afterPieceChange(move);
    this.ctx.setStatus(`Via point ${(move.waypoints?.length ?? 0) + 1} added at ${x}, ${y}. Change its X and Y below.`);
  }

  removeViaPoint(move, index) {
    if (!this.guardEdit()) return;
    const w = move.waypoints?.[index];
    if (!w) return;
    this.pushUndo(`Remove via point ${index + 1}`);
    try {
      removeWaypoint(this.scene, this.part, w);
    } catch (err) { this.undoStack.pop(); this.ctx.toast(err.message, true); return; }
    this.afterPieceChange(move);
    this.ctx.setStatus(`Via point ${index + 1} removed.`);
  }

  /** Redraw after a via point was added or removed, staying on the same walk command. */
  afterPieceChange(move) {
    const order = (steps) => steps.map((s, k) => ({ s, k })).filter(({ s }) => s.kind === 'move' && s.script === move.script).sort((a, b) => a.s.seq - b.s.seq);
    const nth = order(this.steps).findIndex(({ s }) => s === move);
    this.afterScriptChange(this.pos);
    const k = order(this.steps)[nth]?.k;
    if (k !== undefined && k !== this.pos) this.stepTo(k);
  }

  /** Add a page to the line a talk step shows, after its last page. */
  addPage(step) {
    if (!this.guardEdit()) return;
    const chapter = this.scene.chapterFile, keys = this.keysFor(step.msg);
    if (!chapter || !keys.length) { this.ctx.toast('This line has no text in the chapter’s message table.', true); return; }
    const m = /^(.*_)(\d{2})_TEXT$/.exec(keys.at(-1));
    if (!m) { this.ctx.toast('This line’s text name has an unusual form, so a page can’t be added to it.', true); return; }
    let n = Number(m[2]) + 1, key;
    do { key = `${m[1]}${String(n++).padStart(2, '0')}_TEXT`; } while (this.localize.has(key) && n < 100);
    if (this.localize.has(key)) { this.ctx.toast('This line has no free page number left.', true); return; }
    this.pushUndo('Add a page');
    try {
      const info = this.localize.get(keys.at(-1)) ? decodeForEdit(this.localize.get(keys.at(-1))).info : { lead: true, words: true, wordArgs: [1, 1], newline: 0 };
      this.localize.add(key, encodeFromEdit('...', info), key.replace(/\d{3}_\d+_\d{2}_TEXT$/, ''));
      this.newKeys.add(key);
      chapter.addPage(step.msg, key);
      this.chapterFiles.add(chapter);
      this.scene.messages = chapter.messages();
    } catch (err) { this.undoStack.pop(); this.ctx.toast(err.message, true); return; }
    this.afterScriptChange(this.pos);
    this.ctx.setStatus(`Page ${keys.length + 1} added to this line. Type its text below; it has no recorded voice.`);
    document.querySelector(`#cs-stepedit [data-current-text="${key}"]`)?.select();
  }

  removePage(step, index) {
    if (!this.guardEdit()) return;
    const chapter = this.scene.chapterFile, keys = this.keysFor(step.msg);
    if (!chapter || keys.length < 2) return;
    if (!confirm(`Remove page ${index + 1} of this line?\n\n${displayText(this.lineText(keys[index]).text)}`)) return;
    this.pushUndo(`Remove page ${index + 1}`);
    try {
      chapter.removePage(step.msg, index);
      this.chapterFiles.add(chapter);
      this.scene.messages = chapter.messages();
    } catch (err) { this.undoStack.pop(); this.ctx.toast(err.message, true); return; }
    this.afterScriptChange(this.pos);
    this.ctx.setStatus(`Page ${index + 1} removed from this line.`);
  }

  async createBattleCutscene() {
    if(this.creatingBattleScene||!this.guardEdit())return;
    this.creatingBattleScene=true;
    const scene=this.scene,chapter=scene.chapterFile,record=this.storyRecord();
    try{
      const opening = !!this.ctx.catalog.encounterForScene(this.file.id);
      const part=await addBattleScenePart(scene,record,{opening});
      part.chapterRecordIndex=record.i;
      if (!opening) {
        part.originalChapterFlags=record.flags;const baseline=chapter.newSceneBaseline??={pack:chapter.buildPack(),edited:chapter.edited};part.chapterBefore=baseline.pack;part.chapterWasEdited=baseline.edited;
        chapter.records[record.i][0x1e]|=0x80;chapter.edited=true;this.chapterFiles.add(chapter);
      }
      this.edited.set(scene.fileName,scene);this.ctx.onChange();
      if(this.scene===scene){await this.selectScript(scene.parts.indexOf(part));this.renderList();}
      this.ctx.setStatus('New cutscene ready. Insert the first step below the viewer. Save when ready.');
    }catch(error){this.ctx.toast(error.message,true);}
    finally{this.creatingBattleScene=false;}
  }

  async addCommand(step, where) {
    if (!this.guardEdit()) return;
    const f = this.addForm;
    const a = f.actor;
    let insertionStep = step;
    let cmds;
    this.pushUndo(`Add a step (${f.type})`);
    const undo = this.undoStack.at(-1);
    try {
      switch (f.type) {
        case 'place': {
          cmds = [COMMANDS.place(a, f.x, f.y, f.dir)];
          const slot = actorSlot(this.scene, a);
          if (slot >= 0 && isAddedSlot(this.scene, slot)) setCastStart(this.scene, slot, f);
          break;
        }
        case 'walk': cmds = [COMMANDS.walk(a, f.x, f.y), COMMANDS.waitWalk(a)]; break;
        case 'fly':cmds=[COMMANDS.fly(a,f.x,f.y),COMMANDS.waitWalk(a)];break;
        case 'body':cmds=COMMANDS.body(a,f.action);break;
        case 'weapon':cmds=COMMANDS.weapon(a,f.weapon);break;
        case 'cast':{
          if(!this.battlePreview?.doc||this.scene.cast.length)throw new Error('Spell casts require a battle-map scene with battle units. Story-only cast actors cannot execute this command.');
          if(!this.battlePreview.candidates?.has(a))throw new Error('Choose a unit present in this battle formation.');
          if(!this.ctx.tables()?.lists.effect?.some(r=>r.id===f.effect&&r.id>0))throw new Error('Choose a spell or effect.');
          cmds=[COMMANDS.cast(a,f.effect,f.x,f.y)];break;
        }
        case 'via': cmds = [COMMANDS.walkVia(a, f.x, f.y)]; break;
        case 'face': cmds = [COMMANDS.face(a, f.dir)]; break;
        case 'anim': {
          if (!this.part.animations?.[f.anim]?.definition) throw new Error('Choose an available animation from this scene part.');
          cmds = [{ native: 65, args: [a, f.anim] }, { native: 73, args: [a] }]; break;
        }
        case 'wait': cmds = [COMMANDS.wait(f.frames)]; break;
        case 'show': cmds = COMMANDS.fade(a, 255, f.frames); break;
        case 'hide': cmds = COMMANDS.fade(a, 0, f.frames); break;
        case 'hidenow': cmds = COMMANDS.hideNow(a); break;
        case 'line': {
          if (!f.text.trim()) { this.undoStack.pop(); this.ctx.toast('Type the line first.', true); return; }
          const msg = await this.addMessage(a, f.text);
          cmds = [COMMANDS.talk(a, msg, f.box)];
          if (f.closeAfterLine) cmds.push(COMMANDS.closeDialogue());
          f.text = '';
          break;
        }
        case 'closeDialogue': cmds = [COMMANDS.closeDialogue()]; break;
        case 'notice': {
          if (!f.text.trim()) { this.undoStack.pop(); this.ctx.toast('Type the text of the box first.', true); return; }
          cmds = [COMMANDS.notice(await this.addMessage(0, f.text, { speaker: 0 }))];
          f.text = '';
          break;
        }
        default: this.undoStack.pop(); return;
      }
      if (where === 'after' && step) {
        if (step.kind === 'talk') {
          const [start, count] = stepRange(this.part, step);
          const next = this.part.file.scripts[step.script].code[start + count];
          insertionStep = this.steps.find(s => s.kind === 'closeDialogue' && s.script === step.script && s.at === next?.at) ?? step;
        }
        insertAfter(this.scene, this.part, insertionStep, cmds);
      }
      else insertBefore(this.scene, this.part, step ?? null, cmds);
    } catch (err) {
      console.error(err);
      if (this.undoStack.at(-1) === undo) this.undoStack.pop();
      this.ctx.toast(err.message, true);
      return;
    }
    if(f.type==='cast'){
      const scene=this.scene,part=this.part;this.edited.set(scene.fileName,scene);this.ctx.onChange();
      await refreshEffectDurations(scene);if(this.scene!==scene||this.part!==part)return;
    }
    if (f.type === 'line') f.closeAfterLine = true;
    const at = where === 'after' ? this.steps.indexOf(insertionStep) + 1 : Math.max(0, this.pos);
    this.afterScriptChange(at);
    this.ctx.setStatus(`Added: ${this.describe(this.steps[this.pos])}`);
  }

  removeStep(step) {
    if (!step || !this.guardEdit()) return;
    if (!confirm(`Delete this step?\n\n${this.describe(step)}`)) return;
    this.pushUndo('Delete a step');
    try {
      deleteStep(this.scene, this.part, step);
    } catch (err) {
      this.undoStack.pop();
      this.ctx.toast(err.message, true);
      return;
    }
    this.afterScriptChange(Math.max(-1, this.pos - 1));
  }

  /**
   * Characters added to this scene stay in its later parts: each later part
   * starts with them where this one leaves them (placed and shown, or hidden).
   */
  carryAddedCharacters() {
    const { scene } = this;
    for (let slot = scene.original.length; slot < scene.cast.length; slot++) {
      try {
        carryAddedActor(scene, this.part, slotActor(scene, slot));
      } catch (err) {
        console.error(err);
        this.ctx.toast(`Couldn't carry ${this.speaker(slotActor(scene, slot))} into the later parts: ${err.message}`, true);
      }
    }
  }

  /** Redraw after another mode changed this scene (app/battlesync.js). */
  refreshScene(scene) {
    if (this.scene !== scene) return;
    this.undoStack.length = 0;
    this.rebuildSteps();
    this.pos = Math.min(this.pos, this.steps.length - 1);
    this.renderHeader();
    this.renderLines();
    this.renderCast();
    this.renderList();
    this.render();
    this.renderStepEditor();
  }

  afterScriptChange(pos) {
    this.carryAddedCharacters();
    this.ctx.sync?.sceneChanged(this.scene);
    this.edited.set(this.scene.fileName, this.scene);
    if (!sceneDirty(this.scene)) this.edited.delete(this.scene.fileName);
    this.rebuildSteps();
    this.pos = Math.min(pos, this.steps.length - 1);
    this.ctx.onChange();
    this.renderHeader();
    this.renderLines();
    this.renderCast();
    this.renderList();
    this.render();
    this.renderStepEditor();
  }

  /** A new message for `actor`: one text key per page (pages split by a blank line). */
  async addMessage(actor, text, { speaker: fixedSpeaker = null, part = this.part } = {}) {
    const chapter = await loadChapter(this.scene.chapter);
    const prefix = `SCENARIO_${this.scene.chapter.prefix.toUpperCase()}_`;
    const sceneNo = String(/(\d+)$/.exec(part.name)?.[1] ?? '0').padStart(3, '0');
    let n = 900;
    while (this.localize.has(`${prefix}${sceneNo}_${n}_00_TEXT`)) n++;
    // control codes (line start, word marks) copied from one of the chapter's own lines
    const sample = [...chapter.messages().values()][0]?.[0];
    const info = sample && this.localize.get(sample) ? decodeForEdit(this.localize.get(sample)).info : { lead: true, words: true, wordArgs: [1, 1], newline: 0 };
    const pages = text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => (fixedSpeaker === 0 && !/^\{1A:/i.test(t) ? `{1A:03}${t}` : t)); // the game's own notice boxes open every page with code 1A:03
    const keys = pages.map((_, i) => `${prefix}${sceneNo}_${n}_${String(i).padStart(2, '0')}_TEXT`);
    pages.forEach((t, i) => this.localize.add(keys[i], encodeFromEdit(t, info), prefix));
    keys.forEach((k) => this.newKeys.add(k));
    const slot = actorSlot(this.scene, actor);
    // The name shown with the line comes from the message row, not from the command's actor. In a
    // battle-map scene (no cast table) the game's own rows hold the unit's character number.
    const battleName = !this.scene.cast.length ? this.ctx.sync?.actorLook(this.scene.fileName, actor, this.battlePreview)?.nameId : 0;
    const named = slot >= 0 && this.scene.cast[slot].portrait ? this.scene.cast[slot].character : battleName > 0 && battleName < 255 ? battleName : 255;
    const speaker = fixedSpeaker ?? (named === 1 ? 255 : named); // the leader's lines are 255 in the game's rows, so the player's chosen name shows
    const msg = chapter.addMessage(speaker, keys);
    this.chapterFiles.add(chapter);
    this.scene.messages = chapter.messages();
    return msg;
  }

  /** A notice box ("You received ...") as the last step of `part`, after a short pause as the game's own have. Returns its message number. */
  async addRewardNotice(part, text) {
    const scene = this.scene;
    const msg = await this.addMessage(0, text, { speaker: 0, part });
    insertAtEnd(scene, part, [COMMANDS.wait(45), COMMANDS.notice(msg)]);
    this.undoStack.length = 0;
    this.edited.set(scene.fileName, scene);
    if (part === this.part) this.afterScriptChange(this.pos);
    else { this.ctx.onChange(); this.renderLines(); this.renderList(); }
    return msg;
  }

  /** Take back a notice box added with addRewardNotice (and its pause), if it is still there. */
  removeRewardNotice(part, msg) {
    const scene = this.scene;
    if (!scene?.parts.includes(part)) return;
    const steps = buildTimeline(part);
    const i = steps.findIndex((s) => s.notice && s.msg === msg);
    if (i < 0) return;
    const before = steps.slice(0, i).filter((s) => s.script === steps[i].script).at(-1);
    deleteStep(scene, part, steps[i]);
    const pause = before?.kind === 'wait' && before.frames === 45 ? buildTimeline(part).find((s) => s.seq === before.seq && s.kind === 'wait' && s.frames === 45) : null;
    if (pause) deleteStep(scene, part, pause);
    for (const key of scene.chapterFile?.pageKeys(msg) ?? []) if (this.newKeys.has(key)) { this.localize.remove(key); this.newKeys.delete(key); }
    scene.chapterFile?.removeMessage(msg);
    scene.messages = scene.chapterFile?.messages() ?? scene.messages;
    this.undoStack.length = 0;
    if (!sceneDirty(scene)) this.edited.delete(scene.fileName);
    if (part === this.part) this.afterScriptChange(this.pos);
    else { this.ctx.onChange(); this.renderLines(); this.renderList(); }
  }

  revertPartPositions() {
    this.undoStack.length = 0;
    if(this.part?.addedEvent){
      const part=this.part,chapter=this.scene.chapterFile;
      chapter.removeBattleEvent(part.event);revertPart(this.scene,part);
      if(!sceneDirty(this.scene))this.edited.delete(this.scene.fileName);
      this.ctx.onChange();this.selectScript(0).then(()=>this.renderList());
      this.ctx.setStatus('The added in-battle event was removed.');return;
    }
    if(this.part?.isNew){
      const part=this.part;
      const chapter=this.scene.chapterFile;revertPart(this.scene,part);
      if (part.chapterBefore) {
        chapter.records[part.chapterRecordIndex][0x1e]=part.originalChapterFlags;
        const packed=chapter.buildPack();chapter.edited=part.chapterWasEdited||packed.length!==part.chapterBefore.length||packed.some((v,i)=>v!==part.chapterBefore[i]);
        if(!chapter.edited)this.chapterFiles.delete(chapter);
      }
      if(!sceneDirty(this.scene))this.edited.delete(this.scene.fileName);
      this.draftRecordIndex=part.chapterRecordIndex;this.selectScript(-1);this.ctx.onChange();return;
    }
    revertPart(this.scene, this.part);
    this.carryAddedCharacters();
    if (!sceneDirty(this.scene)) this.edited.delete(this.scene.fileName);
    this.rebuildSteps();
    this.pos = Math.min(this.pos, this.steps.length - 1);
    this.ctx.onChange();
    this.renderList();
    this.render();
    this.renderStepEditor();
  }

  // ---- cast -------------------------------------------------------------
  /** Cast rows this part's steps use. */
  slotsInPart() {
    return new Set(this.steps.map((s) => s.actor).filter((a) => typeof a === 'number').map((a) => actorSlot(this.scene, a)).filter((k) => k >= 0));
  }

  async renderCast() {
    const box = $('#cs-cast');
    const scene = this.scene;
    if(!this.part){box.innerHTML=this.battlePreview?.doc?`<p class="muted pad">Battle formation: ${esc(this.battlePreview.doc.fileName)}. Add a cutscene below the viewer to begin. Use Include conditional units to preview possible enemy placements.</p>`:'<p class="muted pad">No actors: this scene archive contains no cutscene parts.</p>';return;}
    if (!scene.cast.length) {
      // a battle-map scene: its actors are the units of the battle it belongs to
      const roster = this.battlePreview?.doc;
      const inherited = roster ? `<div class="pad"><b>Inherited battle units</b><p class="muted">${esc(roster.fileName)} · recorded starting positions. Party members can use their current army appearance in game; this preview uses the battle templates.</p><ul>${[...this.battlePreview.candidates].map(([actor,p]) => `<li>${esc(this.speaker(actor))} · ${esc(p.look?.cls ?? '')} · ${p.look?.team === 2 ? 'enemy' : p.look?.guest ? 'guest' : 'friendly'} · ${p.x}, ${p.y}${p.conditional ? ' · conditional candidate' : ''}</li>`).join('')}</ul></div>` : '';
      const choice = this.ctx.sync?.battleChoices(scene, this.part);
      if (!choice) { box.innerHTML = inherited || '<p class="muted pad">This file has no cast table. Its actors depend on battle/party state; no formation is confirmed for this part.</p>'; return; }
      box.innerHTML = `${inherited}<div class="cast-add"><b>Add a character to the battle</b>
        <p class="muted">This part starts ${esc(this.ctx.catalog.label(choice.doc) || choice.doc.fileName)} (${esc(choice.doc.fileName)}). Its characters are that battle's units, so a character added here goes into the battle (on the side you choose, on the field, that side's unit count +1) and stands on their tile from the start of this part. Move them in either mode and the other follows.</p>
        <label>Character <select data-who>${choice.characters.map((o) => `<option value="${o.c}">${esc(o.name)}</option>`).join('')}</select></label>
        <label>Side <select data-side><option value="guest">Your side, AI guest</option><option value="player">Your side, you control</option><option value="enemy">Enemy</option></select></label>
        <button>Add</button></div>`;
      box.querySelector('button').onclick = async () => {
        if (!this.guardEdit()) return;
        try {
          const note = await this.ctx.sync.sceneCharacterAdded(scene, this.part, null, (/^(form|custom):/.test(box.querySelector('[data-who]').value)?box.querySelector('[data-who]').value:Number(box.querySelector('[data-who]').value)), box.querySelector('[data-side]').value);
          this.ctx.toast(note);
          this.ctx.setStatus(note);
        } catch (err) {
          this.ctx.toast(err.message, true);
        }
        this.edited.set(scene.fileName, scene);
        this.refreshScene(scene);
        this.ctx.onChange();
      };
      return;
    }
    const looks = await loadCastIndex();
    if (this.scene !== scene) return;
    const named = looks.map((l, i) => ({ ...l, i, label: l.label ?? this.characterName(l.character) ?? `Character ${l.character}` }))
      .sort((a, b) => a.label.localeCompare(b.label) || b.uses - a.uses);
    const used = this.slotsInPart();
    box.innerHTML = '';
    scene.cast.forEach((c, slot) => {
      const card = document.createElement('div');
      const changed = castChanged(scene, slot);
      card.className = `cast-slot${changed ? ' edited' : ''}${used.has(slot) ? '' : ' unused'}`;
      const name = this.characterName(c.character);
      const generic = !c.portrait || !c.sprite;
      const current = named.find((l) => l.character === c.character && l.portrait === c.portrait && l.sprite === c.sprite);
      const looksOf = (character) => named.filter((x) => x.character === character).length;
      card.innerHTML = `
        <div class="cast-pic"></div>
        <div class="cast-body">
          <div class="cast-head"><b>Slot ${slot + 1}</b> <span class="muted">${isAddedSlot(scene, slot) ? 'added' : used.has(slot) ? 'in this part' : 'not in this part'}</span>
            ${changed ? `<button class="ghost cast-revert">${isAddedSlot(scene, slot) ? 'Remove' : 'Revert'}</button>` : ''}</div>
          <select>
            ${current ? '' : `<option value="" selected>${esc(name ?? (generic ? `Generic unit (${c.generic})` : `Character ${c.character}`))}</option>`}
            ${named.map((l) => `<option value="${l.i}" ${l === current ? 'selected' : ''}>${esc(l.label)}${looksOf(l.character) > 1 ? ` (look ${l.sprite})` : ''}</option>`).join('')}
          </select>
        </div>`;
      card.querySelector('select').onchange = (e) => this.changeCast(slot, looks[Number(e.target.value)]);
      card.querySelector('.cast-revert')?.addEventListener('click', () => this.revertCast(slot));
      if (c.sprite) {
        loadActorFrame(c.sprite,this.ctx.tables()?.palette(c.palette??0)??undefined).then((f) => {
          if (!f?.rgba) return;
          const cv = rgbaCanvas(f.width, f.height, f.rgba);
          cv.style.width = '48px';
          cv.style.height = `${(48 * f.height) / f.width}px`;
          card.querySelector('.cast-pic').append(cv);
        });
      }
      box.append(card);
    });
    // add a character
    const add = document.createElement('div');
    add.className = 'cast-add';
    add.innerHTML = `<b>Add to the scene cast</b>
      <select>${named.map((l) => `<option value="${l.i}">${esc(l.label)}${named.filter((x) => x.character === l.character).length > 1 ? ` (look ${l.sprite})` : ''}</option>`).join('')}</select>
      <button>Add</button>
      <p class="muted">They start hidden. Use <b>Add</b> under the playback controls to place them and fade them in. Once placed, they stay in the scene's later parts where you left them. Use <b>After events</b> to have a character join your army after the scene or battle.</p>`;
    add.querySelector('button').onclick = () => this.addCharacter(looks[Number(add.querySelector('select').value)]);
    box.append(add);
  }

  async addCharacter(look) {
    if (!look || !this.guardEdit()) return;
    try {
      const actor = await addCastRow(this.scene, look);
      for (const part of this.scene.parts) insertBefore(this.scene, part, null, COMMANDS.hideNow(actor));
      this.addForm.actor = actor;
      this.edited.set(this.scene.fileName, this.scene);
      // on the part that starts a battle, they go into the battle too (app/battlesync.js)
      const note = await this.ctx.sync?.sceneCharacterAdded(this.scene, this.part, actor, look.character);
      if (note) this.ctx.toast(note);
      this.ctx.setStatus(note ?? `${this.characterName(look.character)} added to the cast (hidden until placed)`);
    } catch (err) {
      this.ctx.toast(err.message, true);
    }
    this.afterScriptChange(this.pos);
  }

  // ---- joining the army -------------------------------------------------------
  /** Characters the game adds to the army somewhere: character -> { type, unitFile }. */
  async joinable() {
    this.joinables ??= (async () => {
      const out = new Map();
      for (const ch of CHAPTERS) {
        let c;
        try { c = await loadChapter(ch); } catch { continue; }
        for (const r of c.allRecords()) {
          if (![MENU.addUnit, MENU.addGuest, MENU.addGuestWithMessage].includes(r.menuType) || !r.menuP2) continue;
          const prev = out.get(r.menuP2);
          if (!prev || (prev.type !== MENU.addUnit && r.menuType === MENU.addUnit)) out.set(r.menuP2, { type: r.menuType, unitFile: r.menuP1 });
        }
      }
      return out;
    })();
    return this.joinables;
  }

  async joinsPanel() {
    const box = document.createElement('div');
    box.className = 'cast-add';
    const chapter = await loadChapter(this.scene.chapter);
    const sceneId = this.part.entryId;
    if (!chapter.chain(sceneId).length) {
      box.innerHTML = '<b>After this scene</b><p class="muted">This part isn’t a story step the editor can follow, so nobody can be added to the army here.</p>';
      return box;
    }
    const scene = this.scene;
    const kind = { [MENU.addGuest]: 'joins as a guest', [MENU.addUnit]: 'joins the army', [MENU.addGuestWithMessage]: 'joins as a guest (with message)' };
    const pad = (n) => String(n).padStart(3, '0');
    const nameOf = (c) => this.characterName(c) ?? `Character ${c}`;
    const levelLimit = this.ctx.tables()?.levelLimit ?? 50;
    const joins = chapter.joinsAfter(sceneId);
    const back = chapter.returnStep(sceneId);
    const returning = back ? (back.menuType in kind && back.menuP2 ? `${nameOf(back.menuP2)}’s step` : `scene ${back.scene}`) : null;
    const list = await this.joinable();
    const options = [...list].map(([character, j]) => ({ character, j, name: nameOf(character) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // the game takes the unit from this scene's copy of the unit file, so that is what is shown and edited
    const unitOf = (r) => {
      if (!(r.menuType in kind)) return ''; // not a task that adds a character (a system message, say)
      const row = copyRow(unitCopy(scene, r.menuP1) ?? new Uint8Array(0), r.menuP2);
      return row
        ? `<label class="join-level">Level <input type="number" min="1" max="${levelLimit}" value="${row[0x08]}" data-level="${r.menuP1}:${r.menuP2}"></label>`
        : `<span class="hint warn">This scene carries no unit file ${pad(r.menuP1)} with them, so the game won’t find them.</span>`;
    };
    box.innerHTML = `<b>After this scene</b>
      ${joins.length ? `<ul>${joins.map((r) => `<li>${esc(nameOf(r.menuP2))} ${kind[r.menuType] ?? `task ${r.menuType}`} <span class="muted">(unit file ${pad(r.menuP1)})</span>${chapter.addedScenes.has(r.scene) ? ` <button class="ghost" data-remove="${r.scene}">Remove</button>` : ''} ${unitOf(r)}</li>`).join('')}</ul>` : '<p class="muted">Nobody joins after this scene.</p>'}
      <label>Character <select data-who>${options.map((o) => `<option value="${o.character}">${esc(o.name)}</option>`).join('')}</select></label>
      <label>How <select data-how><option value="${MENU.addUnit}">Joins the army</option><option value="${MENU.addGuest}">Joins as a guest</option></select></label>
      <label>Unit file (battle/entry/entry_unit_<i>NNN</i>) <input data-file type="number" min="1"></label>
      <label>Level <input data-lv type="number" min="1" max="${levelLimit}" placeholder="as in the unit file"></label>
      ${returning ? `<label>When <select data-where>
        <option value="before">Before ${esc(returning)} (the step that returns to the world map)</option>
        <option value="after">After ${esc(returning)} (the return to the world map moves onto the join)</option>
      </select></label>` : ''}
      <button data-join>Add</button>
      <p class="muted">The game takes the character (level, class, gear) from this scene’s own copy of the unit file, not from the battle file: <b>Add</b> copies the file into the scene when it doesn’t carry it yet. Any file with a unit of that character works; the one the game uses for them is filled in. <b>Level</b> changes only this scene’s copy (gear stays as it is). Joins happen before the story returns to the world map.</p>`;
    const who = box.querySelector('[data-who]');
    const file = box.querySelector('[data-file]');
    const fill = () => { file.value = list.get(Number(who.value))?.unitFile ?? 1; };
    who.onchange = fill;
    fill();
    box.querySelector('[data-join]').onclick = async () => {
      if (!this.guardEdit()) return;
      const character = Number(who.value);
      const unitFile = Number(file.value);
      const how = Number(box.querySelector('[data-how]').value);
      const lv = box.querySelector('[data-lv]').value;
      let table;
      try {
        const dat = await loadDat(`battle/entry/entry_unit_${pad(unitFile)}.dat`);
        table = dat.pakd.entries[0].data;
        if (!copyRow(table, character)) throw new Error(`entry_unit_${pad(unitFile)} has no unit for ${nameOf(character)}`);
      } catch (err) {
        this.ctx.toast(err.message, true);
        return;
      }
      const had = unitCopy(scene, unitFile);
      let note = '';
      if (!had || !copyRow(had, character)) {
        // the whole file when the scene has no copy; else only their row, after the copy's last unit,
        // so the rows other steps name by position stay where they are
        const copy = had ? appendRow(had, copyRow(table, character)) : table.slice();
        // joining for good from a copy made for it: not a guest, like Sara's row (the setup Deneb joined with)
        if (how === MENU.addUnit) copyRow(copy, character)[0x11] = 0;
        setUnitCopy(scene, unitFile, copy);
        noteCopy(unitFile, scene.fileName);
        note = had ? `; their unit was added to this scene’s copy of unit file ${pad(unitFile)}` : `; unit file ${pad(unitFile)} copied into ${this.file.id}`;
      }
      if (lv !== '') this.setJoinLevel(unitFile, character, Number(lv));
      chapter.addMenuTaskAfter(sceneId, how, unitFile, character, { afterReturnStep: box.querySelector('[data-where]')?.value === 'after' });
      this.chapterFiles.add(chapter);
      this.edited.set(scene.fileName, scene);
      this.ctx.setStatus(`${nameOf(character)} ${kind[how]} after this scene${note}`);
      this.ctx.onChange();
      this.renderCast();
    };
    for (const input of box.querySelectorAll('[data-level]')) {
      input.onchange = () => {
        if (!this.guardEdit()) return;
        const [f, c] = input.dataset.level.split(':').map(Number);
        this.setJoinLevel(f, c, Number(input.value));
        this.renderCast();
      };
    }
    for (const b of box.querySelectorAll('[data-remove]')) {
      b.onclick = () => {
        const r = joins.find((x) => x.scene === Number(b.dataset.remove));
        chapter.removeAddedStep(r.scene);
        // a copy added or changed for this join goes back once no join after this scene's parts uses the file
        const still = scene.parts.some((p) => chapter.joinsAfter(p.entryId).some((x) => x.menuP1 === r.menuP1));
        if (copyTouched(scene, r.menuP1) && !still) revertUnitCopy(scene, r.menuP1);
        if (!sceneDirty(scene)) this.edited.delete(scene.fileName);
        this.ctx.onChange();
        this.renderCast();
      };
    }
    return box;
  }

  /** A joining character's level in this scene's copy of the unit file. */
  setJoinLevel(file, character, level) {
    const copy = unitCopy(this.scene, file);
    const lv = Math.max(1, Math.min(this.ctx.tables()?.levelLimit ?? 50, Math.round(level) || 1));
    if (!copy || copyRow(copy, character)?.[0x08] === lv) return;
    const next = copy.slice();
    copyRow(next, character)[0x08] = lv;
    setUnitCopy(this.scene, file, next);
    this.edited.set(this.scene.fileName, this.scene);
    this.ctx.onChange();
  }

  /** Scene files rewritten elsewhere (a battle save updated their unit copies): reopen the one shown. */
  async reloadScenes(names) {
    if (this.scene && names.includes(this.scene.fileName) && !this.edited.has(this.scene.fileName)) await this.openScene(this.file);
  }

  async changeCast(slot, look) {
    if (!look) return;
    const scene = this.scene;
    this.ctx.setStatus(`Copying ${this.characterName(look.character) ?? 'character'} into ${this.file.id}…`);
    try {
      await setCastLook(scene, slot, look);
      this.edited.set(scene.fileName, scene);
      this.ctx.setStatus(`Slot ${slot + 1} is now ${this.characterName(look.character) ?? look.character}`);
    } catch (err) {
      console.error(err);
      this.ctx.setStatus(`Cast change failed: ${err.message}`, true);
    }
    this.afterCastChange();
  }

  revertCast(slot) {
    revertCastSlot(this.scene, slot);
    this.afterCastChange();
  }

  afterCastChange() {
    this.undoStack.length = 0;
    if (!sceneDirty(this.scene)) this.edited.delete(this.scene.fileName);
    this.ctx.onChange();
    this.renderHeader();
    this.renderCast();
    this.renderLines();
    this.renderList();
    this.render();
  }

  showPanel(name) {
    this.panel = name;
    for (const b of document.querySelectorAll('#cs-tabs button')) b.classList.toggle('on', b.dataset.panel === name);
    $('#cs-lines').hidden = name !== 'lines';
    $('#cs-cast').hidden = name !== 'cast';
    $('#cs-after').hidden = name !== 'after';
    if(name==='after')this.afterEvents.render($('#cs-after'));
    $('#cs-all-parts').parentElement.hidden = name !== 'lines';
    $('#cs-panel-sub').textContent = name==='after'?'Choose who joins and which Goth, item or equipment rewards are given after the scene or battle.':name === 'lines'
      ? 'Edit lines in the current text language. Editing a voiced line switches its voice off so the speech matches the text.'
      : 'Choose who appears during the scene. Use After events for army recruitment and rewards after the scene or battle.';
  }

  // ---- saving -------------------------------------------------------------
  dirtyFiles() {
    const out = [];
    if (this.localize?.dirty) out.push(this.localize);
    for (const v of this.voices.values()) if (v.dirty) out.push(v);
    for (const scene of this.edited.values()) {
      if (sceneDirty(scene)) out.push({ path: scene.dat.path, dat: scene.dat, encode: () => encodeScene(scene) });
    }
    for (const c of this.chapterFiles) if (c.dirty) out.push(c);
    return out;
  }

  /** New lines go into every language's text file, so no language is missing them. */
  async otherLanguageFiles() {
    if (!this.newKeys.size) return [];
    const have = new Set((await source.list('localize')).map((f) => f.name));
    const out = [];
    for (const lang of LANGUAGES) {
      if (lang === this.localize.lang || !have.has(`LocalizeText_${lang}.dat`)) continue;
      const file = await LocalizeFile.load(lang);
      for (const key of this.newKeys) file.add(key, this.localize.get(key), key.replace(/\d{3}_\d+_\d{2}_TEXT$/, ''));
      out.push(file);
    }
    return out;
  }

  /** Cues muted by the editor (kept so their cards can say so after a save). */
  get muted() {
    try { return new Set(JSON.parse(localStorage.getItem(MUTED_KEY)) ?? []); } catch { return new Set(); }
  }

  async save() {
    const files = [];
    for (const f of [...this.dirtyFiles(), ...await this.otherLanguageFiles()]) files.push({ path: f.path, bytes: await f.encode(), originalSize: f.dat.originalSize, dat:f.dat });
    const saved = await saveDataFiles(files);
    this.undoStack.length = 0;
    for (const c of this.chapterFiles) forgetChapter(c.chapter);
    this.chapterFiles.clear();
    this.newKeys.clear();
    this.joinables = null;
    if (this.scene) {
      this.scene.messages = await loadMessageTable(this.scene.chapter);
      this.scene.chapterFile=await loadChapter(this.scene.chapter);
    }
    const muted = this.muted;
    for (const v of this.voices.values()) for (const c of v.removed) muted.add(c);
    try { localStorage.setItem(MUTED_KEY, JSON.stringify([...muted])); } catch { /* storage unavailable */ }
    // reload so the next edit starts from what is on disk
    if (this.localize?.dirty) this.localize = await LocalizeFile.load(this.localize.lang);
    for (const l of VOICE_LANGS) if (this.voices.get(l)?.dirty) this.voices.set(l, await VoiceIndex.load(l));
    const reopen = this.scene && this.edited.has(this.scene.fileName);
    this.edited.clear();
    if (reopen) await this.openScene(this.file);
    else if (this.scene) { this.renderLines(); this.render();this.afterEvents.render($('#cs-after')); }
    return saved;
  }

  // ---- events ---------------------------------------------------------------
  bind() {
    $('#cs-all-parts').onchange = () => { if (this.scene) this.renderLines(); };
    $('#cs-battle-units').onchange = () => { if (this.scene) this.render(); };
    $('#cs-start-tiles').onchange = () => { if (this.scene) this.render(); };
    $('#cs-hide-dialogue').onchange=()=>{if(this.scene)this.render();};
    $('#cs-hide-icons').onchange=()=>{if(this.scene)this.render();};
    $('#cs-conditional-units').onchange = () => { if (this.scene) { this.renderHeader(); this.render(); } };
    $('#cs-search').oninput = (e) => { this.filter = e.target.value; this.renderList(); };
    $('#cs-script').onchange = e=>{const value=e.target.value;if(value.startsWith('draft:')){this.draftRecordIndex=Number(value.slice(6));this.selectScript(-1);}else this.selectScript(Number(value));};
    $('#cs-map-select').onchange = async (e) => {
      this.ctx.catalog.setChoice(this.mapKey, e.target.value || null);
      await this.loadMap();
      this.renderHeader();
      this.renderList();
      this.render();
    };
    $('#cs-start').onclick = () => { this.stop(); this.stepTo(-1); };
    $('#cs-prev').onclick = () => { this.stop(); this.prev(); };
    $('#cs-play').onclick = () => this.togglePlay();
    $('#cs-next').onclick = () => { this.stop(); this.next(); };
    $('#cs-end').onclick = () => { this.stop(); this.stepTo(this.steps.length - 1); };
    $('#cs-step').oninput = (e) => { this.stop(); this.stepTo(Number(e.target.value)); };
    $('#cs-fit').onclick = () => (this.has3d ? this.view3d : this.view2d).fitView();
    for (const b of document.querySelectorAll('#cs-tabs button')) b.onclick = () => this.showPanel(b.dataset.panel);
  }

  /** Keyboard: space play/pause, arrows step (only while this mode is shown). */
  onKey(e) {
    if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
    else if (e.key === 'ArrowRight') { this.stop(); this.next(); }
    else if (e.key === 'ArrowLeft') { this.stop(); this.prev(); }
    else if (e.key === 'Home') { this.stop(); this.stepTo(-1); }
  }
}

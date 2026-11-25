import {BattleConditionsPanel} from './app/battleconditions.js';
import { source } from './game/source.js';
import { loadTexts, LANGUAGES } from './game/texts.js';
import { GameTables, TEAMS, ELEMENTS } from './game/tables.js';
import { FIELD, LARGEST_STOCK_BATTLE, battleFieldPatch, encodeField, readField } from './game/entryunit.js';
import { displayHeight } from './game/bgmap.js';
import { playerStartTiles } from './game/battlepreview.js';
import { BattleDoc, loadAllBattles, History, newUnit, saveBattles } from './app/battles.js';
import { loadDat } from './game/datfile.js';
import { installWorldMap } from './app/world-map.js';
import { MapCatalog } from './app/maps.js';
import { forgetMapTable } from './game/maptable.js';
import { MapView } from './ui/mapview.js';
import { MapView3D } from './ui/mapview3d.js';
import { SceneView } from './ui/scene3d.js';
import { Inspector } from './ui/inspector.js';
import { CutsceneEditor } from './app/cutscenes.js';
import { BattleSync, SIDES } from './app/battlesync.js';
import { ALLY_TEAM, battleDataFile, battleDataSaved, changeStageCount, countsChanged, stageCounts } from './game/battledata.js';
import { saveDataFiles, SaveCancelled } from './app/savefiles.js';
import { setHideUnknown, settings } from './app/settings.js';
import { Projects } from './app/projects.js';
import { renderPreferences,setRenderPreferences } from './ui/renderpreferences.js';
import {genericRoster,makeGeneric} from './game/genericroster.js';
import {installCharacterPickers} from './ui/characterpickers.js';
import {loadCastIndex,actorSlot} from './game/cutscene.js';
import {installVersus, versusSettings} from './app/versus.js';

const $ = (sel) => document.querySelector(sel);
const LANG_KEY = 'tor-editor:lang';

const state = {
  info: null,
  tables: null,
  battles: [],
  doc: null,
  slot: null,
  grid: null,
  filter: '',
};

installVersus(() => state.tables?.lists?.ai ?? [], () => projects.run('apply'), async () => {
  await $('#integrated-mods-btn').onclick();
  await dataEditor?.showIntegratedMods(true, 'versus');
}, syncVersusExpansion);
const openWorldMap = installWorldMap({
  battle: async (path) => {
    const file = path.split('/').at(-1);
    const doc = state.battles.find(item => item.fileName === file);
    const roster = doc?.dirty ? doc : new BattleDoc(await loadDat(path), file);
    state.battles = [...state.battles.filter(item => item !== doc), roster].sort((a, b) => a.number - b.number);
    state.tables?.observeSprites(state.battles);
    await $('#modes button[data-mode="battles"]').onclick();
    await openBattle(roster);
  },
  map: async (id) => {
    await $('#modes button[data-mode="maps"]').onclick();
    await mapEditor.openMap(id);
    if (mapEditor.map?.id !== id) throw new Error('Could not open this event’s map.');
  },
  cutscene: async (id) => {
    await $('#modes button[data-mode="cutscenes"]').onclick();
    const file = cutscenes.files.find(row => row.id === id);
    if (!file) throw new Error('Could not find the linked cutscene.');
    await cutscenes.openScene(file);
    if (cutscenes.file?.id !== id) throw new Error('Could not open the linked cutscene.');
  },
}, async (world) => {
  const info = await source.info();
  if (info.project !== state.info?.project || info.dataRoot !== state.info?.dataRoot) return;
  const encounterMaps = new Set(catalog.customEncounters().map(row => row.map));
  const previousRosters = new Set((state.info.encounterLinks || []).map(link => link.roster));
  state.info = info;
  dataEditor?.menuMods?.syncWorldEventExpansion(world.eventExpansionEnabled, world.eventExpansionRequired);
  updateToolbar();
  catalog.setScope(info);
  for (const row of catalog.customEncounters()) encounterMaps.add(row.map);
  forgetMapTable();
  mapEditor?.backdrops.invalidate();
  await catalog.refreshEncounterMaps(encounterMaps);
  if (cutscenes) await cutscenes.open(true);
  const links = [...new Set((info.encounterLinks || []).map(link => link.roster))];
  const missing = links.filter(key => !state.battles.some(doc => doc.key === key));
  const newBattles = await Promise.all(missing.map(async key =>
    new BattleDoc(await loadDat('battle/entry/' + key + '.dat'), key + '.dat')));
  state.battles = state.battles.filter(doc => !previousRosters.has(doc.key) || links.includes(doc.key) || doc.dirty);
  state.battles.push(...newBattles);
  state.battles.sort((a, b) => a.number - b.number);
  state.tables?.observeSprites(state.battles);
  renderBattleList();
  if (state.doc && !state.battles.includes(state.doc) && state.battles[0]) await openBattle(state.battles[0]);
});
versusSettings.addEventListener('message', event => syncVersusExpansion(event.data));

function syncVersusExpansion(project) {
  if (project.name !== state.info?.project || project.dataRoot !== state.info?.dataRoot) return;
  state.info.battleUnitLimit = project.battleUnitLimit;
  const mods = dataEditor?.menuMods;
  if (mods?.info.project === project.name) {
    mods.syncBattleExpansion(project.expanded);
    state.tables?.updateProjectOptions(mods);
  }
  updateToolbar();
  if (state.mode === 'mods' && dataEditor) {
    dataEditor.renderList();
    void dataEditor.select(dataEditor.selected);
  } else if (state.doc) {
    renderRoster();
    renderWarnings();
  }
}

const catalog = new MapCatalog();
catalog.placeName = (n) => (n ? state.tables?.text(`STRONGHOLD_LC_STRONGHOLD_${String(n).padStart(3, '0')}_NAME`) ?? '' : '');
const history = new History(() => { updateToolbar(); renderBattleList(); });

const viewHandlers = {
  directionalSprites: true,
  walkInPlace: true,
  onSelectUnit: (slot) => select(slot),
  onMoveUnit: (slot, x, y) => moveUnit(slot, x, y),
  onSelectTile: (tile) => {
    if (!tile) return;
    const unit = unitAt(tile.x, tile.y);
    if (unit !== null) select(unit);
  },
  onHover: (hover) => renderHover(hover),
  paletteColors: (index) => state.tables?.palette(index),
};
const mapView = new MapView($('#map'), viewHandlers);
const VIEW_KEY = 'tor-editor:view';
const has3D = SceneView.isSupported();
const mapView3d = has3D ? new MapView3D($('#map3d-gl'), $('#map3d-overlay'), viewHandlers) : null;
state.viewMode = has3D ? (localStorage.getItem(VIEW_KEY) || '3d') : '2d';
state.scene3dFor = null; // map id whose 3D scene is loaded into mapView3d

/** The view currently on screen: 3D needs a chosen map with its scene loaded. */
function activeView() {
  return state.viewMode === '3d' && state.scene3dFor && state.grid ? mapView3d : mapView;
}

function showActiveView() {
  const is3d = activeView() === mapView3d;
  $('#map').hidden = is3d;
  $('#map3d').hidden = !is3d;
  document.body.classList.toggle('view-3d', is3d);
  for (const b of document.querySelectorAll('#view-mode button')) b.classList.toggle('on', b.dataset.view === state.viewMode);
}

const inspector = new Inspector($('#inspector'), {
  get tables() { return state.tables; },
  expandedLoadout: () => {
    const mods = dataEditor?.menuMods;
    return state.info?.project && (mods?.info.project === state.info.project
      ? mods.value.expandedLoadout : state.info.expandedLoadout);
  },
  lang: () => $('#lang').value,
  apply: (fd, value) => applyField(state.slot, fd, value),
  applyBlock: ({ offset, bytes }, label) => applyBytes(state.slot, offset, bytes, label),
  applyRaw: (offset, byte) => applyBytes(state.slot, offset, new Uint8Array([byte]), `+${offset.toString(16)}`),
  setSprite: (sprite) => setSprite(state.slot, sprite),
});

// ---- startup -----------------------------------------------------------
/** A popup over the editor while it starts, mirroring the status line. */
function startupPopup() {
  const box = document.createElement('div');
  box.className = 'startup-overlay';
  box.setAttribute('role', 'status');
  box.innerHTML = '<div class="startup-card"><div class="startup-spin" aria-hidden="true"></div><b>Starting the editor</b><span class="startup-step"></span><span class="startup-time muted"></span></div>';
  document.body.append(box);
  const step = box.querySelector('.startup-step'), time = box.querySelector('.startup-time'), began = Date.now();
  const sync = () => { step.textContent = $('#status').textContent; };
  const watch = new MutationObserver(sync);
  watch.observe($('#status'), { childList: true, characterData: true, subtree: true });
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - began) / 1000);
    time.textContent = s >= 4 ? `${s} s · the first start after opening a project prepares its mod content, which can take a little while` : '';
  }, 1000);
  sync();
  return {
    done() { watch.disconnect(); clearInterval(tick); box.classList.add('hide'); setTimeout(() => box.remove(), 300); },
    fail() { watch.disconnect(); clearInterval(tick); box.remove(); },
  };
}

async function start() {
  const popup = startupPopup();
  try {
    setStatus('Connecting to the editor server…');
    state.info = await source.info();
    updateToolbar();
    if (state.info.integratedContentPending) setStatus(`Preparing project "${state.info.project}"…`);
    catalog.setScope(state.info);
    projects.render();
    state.editedFiles = await editedFiles();
    $('#data-path').textContent = state.info.dataRoot;
    $('#data-path').title = state.info.dataRoot;
    if (state.info.readOnly) document.body.classList.add('read-only');

    const lang = localStorage.getItem(LANG_KEY) || 'en-us';
    buildLanguageMenu(lang);
    await loadNames(lang);

    state.battles = await loadAllBattles((n, total) => setStatus(`Reading battles ${n}/${total}…`));
    state.tables.observeSprites(state.battles);
    renderBattleList();
    setStatus('Indexing maps…');
    await catalog.load((n, total) => setStatus(`Indexing maps ${n}/${total}…`));
    renderBattleList(); // titles from the story's links
    setStatus(`${state.battles.length} battles · ${catalog.maps.length} maps`);
    const first = state.battles.find((d) => d.key === 'entry_unit_002') || state.battles[0];
    if (first) openBattle(first);
    popup.done();
  } catch (err) {
    popup.fail();
    console.error(err);
    setStatus(`Error: ${err.message}`, true);
    $('#inspector').innerHTML = `<div class="empty-state error"><p><b>Could not start.</b></p><p>${escapeHtml(err.message)}</p><p class="muted">Start the editor with <code>python serve.py</code> and open the address it prints.</p></div>`;
  }
}

/** Game files the editor has changed: those with a backup, and the open project's. */
async function editedFiles() {
  const files = new Set(await source.backups().catch(() => []));
  if (state.info?.project) {
    const { projects: list } = await source.projects();
    for (const f of list.find((p) => p.name === state.info.project)?.files ?? []) files.add(f);
  }
  return files;
}

async function loadNames(lang) {
  setStatus(`Loading ${lang} text…`);
  const texts = await loadTexts(lang);
  state.tables = await GameTables.load(texts, state.info);
  state.tables.updateProjectOptions(dataEditor?.menuMods);
}

function buildLanguageMenu(current) {
  const sel = $('#lang');
  sel.innerHTML = LANGUAGES.map((l) => `<option value="${l}" ${l === current ? 'selected' : ''}>${l}</option>`).join('');
  sel.onchange = async () => {
    localStorage.setItem(LANG_KEY, sel.value);
    await loadNames(sel.value);
    state.tables.observeSprites(state.battles);
    setStatus(`${state.battles.length} battles · ${catalog.maps.length} maps`);
    renderAll();
    renderBattleList();
  };
}

// ---- battles -----------------------------------------------------------
function battleTitle(doc) {
  return catalog.label(doc) || `Battle ${doc.number ?? doc.fileName}`;
}

function namedUnits(doc) {
  const t = state.tables;
  return doc.unitSlots().map((s) => t.unitName(readField(doc.row(s), FIELD.name))).filter(Boolean);
}

function renderBattleList() {
  const list = $('#battle-list');
  const q = state.filter.trim().toLowerCase();
  list.innerHTML = '';
  let shown = 0;
  for (const doc of state.battles) {
    const names = namedUnits(doc);
    const title = battleTitle(doc);
    const hay = `${title} ${doc.fileName} ${names.join(' ')}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    shown++;
    const item = document.createElement('button');
    item.className = `battle${doc === state.doc ? ' active' : ''}`;
    const count = doc.unitSlots().length;
    item.innerHTML = `
      <span class="battle-title">${escapeHtml(title)}${doc.dirty ? '<span class="dirty" title="Unsaved changes">●</span>' : ''}</span>
      <span class="battle-sub">${escapeHtml(doc.fileName.replace(/\.dat$/i, ''))} · ${count} unit${count === 1 ? '' : 's'}${catalog.chosenMap(doc) ? ' · map ✓' : ''}</span>
      ${names.length ? `<span class="battle-names">${escapeHtml(names.slice(0, 4).join(', '))}${names.length > 4 ? '…' : ''}</span>` : ''}`;
    item.onclick = () => openBattle(doc);
    list.append(item);
  }
  $('#battle-count').textContent = q ? `${shown} of ${state.battles.length}` : `${state.battles.length}`;
}

async function openBattle(doc) {
  state.doc = doc;
  state.slot = doc.unitSlots()[0] ?? null;
  renderBattleList();
  await loadMapFor(doc);
  renderAll();
}

let mapLoadRevision = 0;
async function loadMapFor(doc) {
  const revision = ++mapLoadRevision;
  const mapId = catalog.chosenMap(doc);
  state.grid = null;
  const { maxX, maxY } = doc.bbox();
  if (mapId) {
    try {
      setStatus(`Loading map ${mapId}…`);
      const grid = await catalog.grid(mapId);
      if (revision !== mapLoadRevision || state.doc !== doc) return;
      state.grid = grid;
      setStatus(`${state.battles.length} battles · ${catalog.maps.length} maps`);
    } catch (err) {
      if (revision !== mapLoadRevision || state.doc !== doc) return;
      setStatus(`Map ${mapId}: ${err.message}`, true);
    }
  }
  mapView.setGrid(state.grid, { width: Math.max(maxX + 3, 8), depth: Math.max(maxY + 3, 8) });
  await load3D(mapId);
  if (revision !== mapLoadRevision || state.doc !== doc) return;
  showActiveView();
  renderMapHeader();
}

async function load3D(mapId) {
  if (!mapView3d || state.viewMode !== '3d' || !state.grid || !mapId) return;
  if (state.scene3dFor === mapId) return;
  state.scene3dFor = null;
  try {
    setStatus(`Loading 3D map ${mapId}…`);
    const scene = await catalog.scene(mapId);
    if (state.grid?.path !== `bg/${mapId}.dat`) return; // battle changed meanwhile
    mapView3d.setScene(scene, state.grid);
    state.scene3dFor = mapId;
    setStatus(`${state.battles.length} battles · ${catalog.maps.length} maps`);
  } catch (err) {
    console.error(err);
    setStatus(`3D map ${mapId}: ${err.message} (showing the 2D grid)`, true);
  }
}

for (const b of document.querySelectorAll('#view-mode button')) {
  b.onclick = async () => {
    if (b.dataset.view === '3d' && !mapView3d) { toast('This browser or GPU cannot show BC7 textures, so only the 2D grid is available.', true); return; }
    state.viewMode = b.dataset.view;
    try { localStorage.setItem(VIEW_KEY, state.viewMode); } catch { /* storage unavailable */ }
    if (state.doc) await load3D(catalog.chosenMap(state.doc));
    showActiveView();
    if (state.viewMode === '3d' && !state.scene3dFor) toast('Choose the map for this battle to see it in 3D.');
    renderAll();
  };
}

let mapHeaderRevision = 0;
async function renderMapHeader() {
  const revision = ++mapHeaderRevision;
  const doc = state.doc;
  if (!doc) return;
  $('#battle-title').textContent = battleTitle(doc);
  const stages = catalog.stagesFor(doc);
  const link = catalog.battleLink(doc);
  const contexts = catalog.battleContexts(doc);
  const context = catalog.activeContext(doc);
  $('#battle-dialogue').hidden = !context?.scene || context.sceneExists === false;
  $('#battle-meta').textContent = [
    doc.fileName,
    stages.length ? `stage ${stages.map((s) => s.stage + (s.slot === 'special' ? '*' : '')).join(', ')}` : null,
    context ? `${context.scene || 'Recorded use'} · map ${context.map}` : 'No recorded chapter map',
    state.grid ? `${state.grid.width}×${state.grid.depth} tiles` : null,
  ].filter(Boolean).join(' · ');

  const sel = $('#map-select');
  const chosen = catalog.chosenMap(doc);
  const uses = $('#battle-context');
  uses.replaceChildren();
  for (const c of contexts) {
    const label = `${c.scene || c.chapter || 'Recorded use'} · stage ${c.stage}${c.slot === 'special' ? ' (special)' : ''} · ${c.map}${c.review ? ' · review note' : ''}`;
    uses.append(new Option(label, c.id, false, c.id === context?.id));
  }
  $('#battle-context-picker').hidden = contexts.length < 2;
  uses.title = uses.selectedOptions[0]?.textContent || '';
  $('#map-reset').textContent = context ? 'Use recorded map' : 'Clear map choice';
  $('#map-reset').disabled = !catalog.hasChoice(doc);
  const legacy = catalog.legacyChoice(doc);
  $('#map-legacy').hidden = !legacy || catalog.hasChoice(doc);
  $('#map-legacy').title = legacy ? `Use the older browser choice ${legacy} for this game and project.` : '';
  const notes = [`Cyan outlines mark ${playerStartTiles(doc).length} recorded friendly starting tiles (including guests). The complete player deployment boundary is not yet mapped.`];
  if (contexts.length > 1) {
    const mapCount = new Set(contexts.map((c) => c.map)).size;
    notes.push(`Shared unit file: ${contexts.length} recorded uses${mapCount > 1 ? ` on ${mapCount} maps` : ''}. Unit edits affect every use.`);
  }
  if (!contexts.length) notes.push('No chapter map association was found. Map suggestions are guesses; choosing one changes the preview.');
  if (context?.review) notes.push(context.review);
  if (catalog.hasChoice(doc)) notes.push(chosen ? 'A manual map choice is being previewed. Use recorded map restores the selected battle use.' : 'Showing a flat grid.');
  const note = $('#battle-mapping-note');
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
  sel.innerHTML = '';
  sel.append(new Option('No map (flat grid)', ''));
  const recorded = document.createElement('optgroup');
  recorded.label = 'Recorded maps';
  for (const id of new Set(contexts.map((c) => c.map))) {
    const m = catalog.byId(id);
    if (m) recorded.append(new Option(catalog.mapLabel(m), id));
  }
  if (recorded.children.length) sel.append(recorded);
  const suggestedGroup = document.createElement('optgroup');
  suggestedGroup.label = 'Size matches (guesses, check in game)';
  const allGroup = document.createElement('optgroup');
  allGroup.label = 'All battle maps';
  for (const m of catalog.maps) allGroup.append(new Option(catalog.mapLabel(m), m.id, false, m.id === chosen));
  sel.append(suggestedGroup, allGroup);
  sel.value = chosen || '';
  const forDoc = doc;
  catalog.suggest(doc).then((list) => {
    if (state.doc !== forDoc || revision !== mapHeaderRevision) return;
    for (const c of list) {
      const label = `${catalog.mapLabel(c.map)}${c.blocked ? ` · ${c.blocked} unit${c.blocked > 1 ? 's' : ''} on objects` : ''}`;
      suggestedGroup.append(new Option(label, c.map.id));
    }
    sel.value = chosen || '';
  }).catch((err) => console.warn('suggest', err));
  renderWarnings();
}

$('#map-select').onchange = async (e) => {
  catalog.setChoice(state.doc, e.target.value || null);
  await loadMapFor(state.doc);
  renderAll();
  renderBattleList();
};

$('#battle-context').onchange = async (e) => {
  if (!state.doc || !catalog.setContext(state.doc, e.target.value)) return;
  await loadMapFor(state.doc);
  renderAll();
  renderBattleList();
};

$('#map-reset').onclick = async () => {
  if (!state.doc) return;
  catalog.clearChoice(state.doc);
  await loadMapFor(state.doc);
  renderAll();
  renderBattleList();
};

$('#map-legacy').onclick = async () => {
  if (!state.doc) return;
  const map = catalog.legacyChoice(state.doc);
  if (!map) return;
  catalog.setChoice(state.doc, map);
  await loadMapFor(state.doc);
  renderAll();
  renderBattleList();
};

$('#rename').onclick = () => {
  const doc = state.doc;
  if (!doc) return;
  const label = prompt('Name this battle (saved for this game and project):', catalog.labelSuggestion(doc));
  if (label === null) return;
  catalog.setLabel(doc, label.trim());
  renderMapHeader();
  renderBattleList();
};

// ---- units -------------------------------------------------------------
function unitAt(x, y) {
  const doc = state.doc;
  for (const s of doc.unitSlots()) {
    const row = doc.row(s);
    if (readField(row, FIELD.x) === x && readField(row, FIELD.z) === y) return s;
  }
  return null;
}

function unitView(slot) {
  const t = state.tables;
  const row = state.doc.row(slot);
  const tpl = t.template(readField(row, FIELD.template));
  const name = t.unitName(readField(row, FIELD.name)) || t.customCharacter(readField(row,FIELD.template))?.name || '';
  const cls = t.className(readField(row, FIELD.class), tpl?.female) || `Class ${readField(row, FIELD.class)}`;
  const initials = (name || cls).replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
  return {
    slot,
    x: readField(row, FIELD.x),
    y: readField(row, FIELD.z),
    team: readField(row, FIELD.team),
    facing: readField(row, FIELD.facing),
    actor: state.doc.units[slot].sprite[0],
    palette: t.unitPalette(row),
    leader: readField(row, FIELD.leader),
    name, cls,
    label: name ? `${name} · ${cls}` : cls,
    initials: (initials.length > 1 ? initials[0][0] + initials[1][0] : (initials[0] || '?').slice(0, 2)).toUpperCase(),
  };
}

function select(slot) {
  state.slot = slot;
  renderAll();
}

function canEdit() {
  if (!state.info?.readOnly) return true;
  toast('Read-only mode: start the server without --readonly to edit.', true);
  return false;
}

function applyBytes(slot, offset, bytes, label, sprite = null) {
  if (!canEdit()) return;
  if (history.apply(state.doc, slot, offset, bytes, label, sprite)) renderAll();
}

function applyField(slot, fd, value) {
  try {
    const { offset, bytes } = battleFieldPatch(state.doc.row(slot), fd, value);
    let sprite = null;
    if (fd === FIELD.class || fd === FIELD.template) {
      // Class and template decide which graphics the battle must preload.
      const unit = state.doc.units[slot];
      const next = unit.row.slice();
      next.set(bytes, fd.offset);
      sprite = state.tables.spriteFor(next, unit.row, unit.sprite);
      if (!sprite) toast(`No known graphics rule for this ${fd.label.toLowerCase()}; the unit keeps its old sprite.`, true);
    }
    applyBytes(slot, offset, bytes, fd.label, sprite);
    if (fd === FIELD.x || fd === FIELD.z || fd === FIELD.facing) sync.unitMoved(state.doc, state.doc.units[slot]).catch((err) => toast(err.message, true));
  } catch (err) {
    toast(`${fd.label}: ${err.message}`, true);
    renderAll();
  }
}

function setSprite(slot, sprite) {
  applyBytes(slot, 0, new Uint8Array(0), 'Colour variant', sprite);
}

/** A free tile near (x, y) in any battle: the open one checks its map, others only their units. */
function freeTileIn(doc, x, y) {
  if (doc === state.doc) return freeTileNear(x, y);
  const taken = new Set(doc.unitSlots().map((s) => `${readField(doc.row(s), FIELD.x)},${readField(doc.row(s), FIELD.z)}`));
  for (let r = 0; r < 8; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const k = `${x + dx},${y + dy}`;
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && x + dx >= 0 && y + dy >= 0 && !taken.has(k)) return [x + dx, y + dy];
      }
    }
  }
  return [x, y];
}

/** Nearest tile (by steps) that is on the map, free of units and objects. */
function freeTileNear(x, y) {
  const grid = state.grid || mapView.grid;
  const taken = new Set(state.doc.unitSlots().map((s) => `${readField(state.doc.row(s), FIELD.x)},${readField(state.doc.row(s), FIELD.z)}`));
  const seen = new Set([`${x},${y}`]);
  const queue = [[x, y]];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    const tile = grid?.tileAt(cx, cy);
    if (tile && tile.object === null && !taken.has(`${cx},${cy}`)) return [cx, cy];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${cx + dx},${cy + dy}`;
      if (!seen.has(k) && grid?.tileAt(cx + dx, cy + dy)) { seen.add(k); queue.push([cx + dx, cy + dy]); }
    }
  }
  return [x, y];
}

// Generic soldiers' character sheets (unit templates) come in families of up to
// four, e.g. "Human m 1"-"Human m 4" (159-162), with their own stats and growths.
// Names come from a random-name list picked by +0x05: 1, 3 and 5 for men, 2 and 4
// for women (stock battles: 8,164 generics).
const NAME_LISTS = { male: [1, 3, 5], female: [2, 4] };
let templateFamilies = null;

/** template -> the other templates of its family (from the Characters tab's labels). */
async function loadTemplateFamilies() {
  if (templateFamilies) return templateFamilies;
  const { labels } = await (await fetch('data/schemas/template.json')).json();
  const byBase = new Map();
  for (const [id, label] of Object.entries(labels)) {
    const m = /^(?!<)(.*\S)\s+(\d)$/.exec(label);
    if (!m) continue;
    if (!byBase.has(m[1])) byBase.set(m[1], []);
    byBase.get(m[1]).push(Number(id));
  }
  templateFamilies = new Map();
  for (const ids of byBase.values()) for (const id of ids) templateFamilies.set(id, ids);
  return templateFamilies;
}

/**
 * A generic copied by Duplicate becomes another soldier: the sheet of its family
 * this battle uses least (not its own), and another name list of the same gender
 * (the game picks the name from it). Named characters stay as they are.
 */
async function genericVariant(doc, row) {
  if (readField(row, FIELD.name)) return null;
  const tpl = readField(row, FIELD.template);
  const family = (await loadTemplateFamilies()).get(tpl) ?? [tpl];
  const uses = (fd, v) => doc.unitSlots().filter((s) => readField(doc.row(s), fd) === v).length;
  const least = (list, fd) => [...list].sort((a, b) => uses(fd, a) - uses(fd, b) || a - b)[0];
  const template = family.length > 1 ? least(family.filter((t) => t !== tpl), FIELD.template) : tpl;
  const list = readField(row, FIELD.randomName);
  const lists = NAME_LISTS[state.tables.isFemale(template) ? 'female' : 'male'];
  const randomName = list && lists.length > 1 ? least(lists.filter((l) => l !== list), FIELD.randomName) : list;
  return { template, randomName };
}

async function duplicateUnit(slot) {
  if (!canEdit() || slot === null) return;
  const doc = state.doc;
  const original = doc.units[slot];
  const row = original.row.slice();
  // A copy must not take over story roles: clear leader/target flags and the event hook.
  for (const fd of [FIELD.leader, FIELD.target, FIELD.subtarget]) row.set(encodeField(fd, false), fd.offset);
  row.set(encodeField(FIELD.event, 0), FIELD.event.offset);
  const [x, y] = freeTileNear(readField(row, FIELD.x), readField(row, FIELD.z));
  row.set(encodeField(FIELD.x, x), FIELD.x.offset);
  row.set(encodeField(FIELD.z, y), FIELD.z.offset);
  // the copy is on the field, so the battle loads it (its side's count goes up with it)
  row.set(encodeField(FIELD.appears, 1), FIELD.appears.offset);
  let sprite = original.sprite;
  const variant = await genericVariant(doc, row).catch((err) => { console.warn('variant', err); return null; });
  if (variant) {
    row.set(encodeField(FIELD.template, variant.template), FIELD.template.offset);
    row.set(encodeField(FIELD.randomName, variant.randomName), FIELD.randomName.offset);
    sprite = state.tables.spriteFor(row, original.row, original.sprite) ?? original.sprite; // the sheet can change the graphics
  }
  const index = doc.units.length;
  history.insert(doc, index, newUnit(row, sprite), variant ? 'Add a variant' : 'Add unit', sync.countChange(doc, row, 1));
  state.slot = index;
  const team = readField(row, FIELD.team) === ALLY_TEAM ? 'ally' : 'enemy';
  const counted = sync.stagesOf(doc).length ? ` The battle's ${team} count went up by 1, so it appears in battle.` : ' This battle has no stage in the story links, so no unit count was changed.';
  const what = variant
    ? `a variant of slot ${slot} (sheet ${variant.template}${variant.template !== readField(original.row, FIELD.template) ? ` instead of ${readField(original.row, FIELD.template)}` : ''}, name list ${variant.randomName})`
    : `a copy of slot ${slot}`;
  toast(`Added ${what} at ${x}, ${y} as slot ${index}.${counted}`);
  renderAll();
  renderBattleList();
}

function removeUnit(slot) {
  if (!canEdit() || slot === null) return;
  const doc = state.doc;
  const later = doc.units.slice(slot + 1).some((u) => u.orig);
  if (!doc.isNew(slot) || later) {
    const ok = confirm(`Remove slot ${slot}?\n\nStory events can refer to units by slot number. Removing this unit renumbers ${doc.units.length - slot - 1} later slot(s), which may break scripted scenes in this battle. Adding units is safer than removing them.`);
    if (!ok) return;
  }
  history.remove(doc, slot, 'Remove unit', sync.removed(doc, doc.units[slot]));
  const slots = doc.unitSlots();
  state.slot = slots.length ? slots[Math.min(slot, slots.length - 1)] : null;
  renderAll();
  renderBattleList();
}

function moveUnit(slot, x, y) {
  const other = unitAt(x, y);
  if (other !== null && other !== slot) {
    toast('Another unit already stands there.', true);
    return;
  }
  const tile = state.grid?.tileAt(x, y);
  if (tile && tile.object !== null) toast(`Tile ${x},${y} holds object #${tile.object}; units normally can't stand there.`, true);
  applyField(slot, FIELD.x, x);
  applyField(slot, FIELD.z, y);
  state.slot = slot;
  renderAll();
}

/** Add a story character to the open battle (and to the cutscene that starts it). */
async function addCharacter(character) {
  if (!canEdit() || !character) return;
  const doc = state.doc;
  const side = $('#add-side').value;
  try {
    const slot = await sync.addToBattle(doc, character, { side });
    state.slot = slot;
    const start = sync.startOf(doc);
    const scene = start && sync.pairs.find((p) => p.doc === doc && p.unit === doc.units[slot])?.sceneAdded;
    toast(`${sync.name(character)} added as slot ${slot} (${SIDES[side].label.toLowerCase()}), on the field${scene ? `, and standing there in ${start.file.replace('.dat', '')} (the scene before the battle)` : ''}. The battle's ${side === 'enemy' ? 'enemy' : 'ally'} count went up by 1.`);
  } catch (err) {
    toast(err.message, true);
  }
  renderAll();
  renderBattleList();
}

function renderCharacterPicker() {
  const sel = $('#add-character');
  if (!sel || sel.options.length > 1) return;
  const list = [...sync.characters().keys()].map((c) => ({ c, name: sync.name(c) })).sort((a, b) => a.name.localeCompare(b.name));
  for (const { c, name } of list) sel.append(new Option(name, String(c)));
  const project=document.createElement('optgroup');project.label='Project characters';
  for(const [key,{label,custom}]of sync.specialForms())if(custom)project.append(new Option(label,key));
  if(project.children.length)sel.prepend(project);
  const forms=document.createElement('optgroup');forms.label='Other forms and unnamed specials';
  for(const [key,{label}]of [...sync.specialForms()].filter(([,row])=>!row.custom).sort((a,b)=>a[1].label.localeCompare(b[1].label)))forms.append(new Option(label,key));
  sel.append(forms);
}

let genericChoices;
async function renderGenericPicker(){
  const select=$('#add-generic');if(!select||!state.tables)return;
  if(!genericChoices){const {labels}=await (await fetch('data/schemas/template.json')).json();genericChoices=genericRoster(state.battles,state.tables,labels);}
  if(select.options.length>1)return;
  for(const g of genericChoices)select.append(new Option(g.label,g.key));
}
async function addGeneric(key){
  if(!canEdit()||!key)return;
  const doc=state.doc;
  try{
    await renderGenericPicker();const group=genericChoices.find(g=>g.key===key),side=SIDES[$('#add-side').value];
    const units=doc.unitSlots().map(s=>doc.row(s)),near=units.find(r=>readField(r,FIELD.team)===side.team)||units[0];
    const [x,y]=freeTileNear(near?readField(near,FIELD.x):0,near?readField(near,FIELD.z):0);
    if(state.grid&&(!state.grid.tileAt(x,y)||state.grid.tileAt(x,y).object))throw new Error('No free tile found on this map.');
    if(unitAt(x,y)!==null)throw new Error('No free tile found on this map.');
    const levels=units.filter(r=>readField(r,FIELD.team)===2).map(r=>readField(r,FIELD.levelBase)).filter(Boolean);
    const level=levels.length?Math.round(levels.reduce((a,b)=>a+b,0)/levels.length):1;
    const {row,sprite}=makeGeneric(group,state.tables,{...side,x,y,level});
    const slot=doc.units.length;history.insert(doc,slot,newUnit(row,sprite),'Add '+group.label,sync.countChange(doc,row,1));
    state.slot=slot;toast(`${group.label} added at ${x}, ${y}; sheet ${readField(row,FIELD.template)}, random name, ${ELEMENTS[readField(row,FIELD.element)]}.`);
    renderAll();renderBattleList();
  }catch(error){toast(error.message,true);}
}

// ---- rendering ---------------------------------------------------------
function renderAll() {
  if (!state.doc) return;
  const slots = state.doc.unitSlots();
  if(!slots.includes(state.slot))state.slot=slots[0]??null;
  const startTiles = $('#toggle-start-tiles').checked && (!state.grid || catalog.chosenMap(state.doc) === catalog.battleLink(state.doc)?.map) ? playerStartTiles(state.doc) : [];
  activeView().setStartTiles(startTiles);
  activeView().setUnits(slots.map(unitView), state.slot);
  inspector.render(state.doc, state.slot, state.grid || mapView.grid);
  renderRoster();
  renderWarnings();
  updateToolbar();
}

function renderRoster() {
  const body = $('#roster tbody');
  body.innerHTML = '';
  const doc = state.doc;
  for (const s of doc.unitSlots()) {
    const u = unitView(s);
    const row = doc.row(s);
    const tile = state.grid?.tileAt(u.x, u.y);
    const tr = document.createElement('tr');
    if (s === state.slot) tr.className = 'active';
    const lvl = `${readField(row, FIELD.levelBase)}${readField(row, FIELD.levelMod) ? `+${readField(row, FIELD.levelMod)}` : ''}`;
    tr.innerHTML = `
      <td class="num">${s}${doc.isNew(s) ? ' <span class="new-badge">new</span>' : ''}</td>
      <td><span class="team-dot t${u.team}"></span>${escapeHtml(u.name || '—')}${u.leader ? ' <span class="crown" title="Leader">★</span>' : ''}</td>
      <td>${escapeHtml(u.cls)}</td>
      <td class="num">${lvl}</td>
      <td class="num">${u.x}, ${u.y}</td>
      <td class="num">${tile ? displayHeight(tile) : '—'}</td>
      <td>${escapeHtml(ELEMENTS[readField(row, FIELD.element)] ?? String(readField(row, FIELD.element)))}</td>
      <td>${escapeHtml(TEAMS[u.team]?.split(':')[0] ?? `#${u.team}`)}</td>`;
    tr.onclick = () => select(s);
    body.append(tr);
  }
  const count = $('#roster-count');
  count.textContent = `${doc.unitSlots().length} roster units · ${battleLimit()} battle limit`;
  count.title = 'The battle limit counts player deployment slots, guests, and enemies together.';
  $('#add-unit').disabled = state.slot === null || !!state.info?.readOnly;
  $('#add-character').disabled = !state.doc || !!state.info?.readOnly;
  $('#add-generic').disabled = !state.doc || !!state.info?.readOnly;
  $('#add-side').disabled = !state.doc || !!state.info?.readOnly;
  $('#remove-unit').disabled = state.slot === null || !!state.info?.readOnly;
}

let warningsDrawn = 0;
function renderWarnings() {
  const doc = state.doc;
  const warnings = [];
  const seen = new Map();
  for (const s of doc.unitSlots()) {
    const u = unitView(s);
    const key = `${u.x},${u.y}`;
    if (seen.has(key)) warnings.push(`Slots ${seen.get(key)} and ${s} share tile ${key}`);
    else seen.set(key, s);
    if (state.grid) {
      const tile = state.grid.tileAt(u.x, u.y);
      if (!tile) warnings.push(`Slot ${s} (${u.name || u.cls}) is outside the map`);
      else if (tile.object !== null) warnings.push(`Slot ${s} (${u.name || u.cls}) stands on object #${tile.object}`);
    }
  }
  const el = $('#warnings');
  el.innerHTML = warnings.map((w) => `<span class="warning">⚠ ${escapeHtml(w)}</span>`).join('');
  const token = ++warningsDrawn;
  countWarnings(doc).then((list) => {
    if (token !== warningsDrawn) return; // drawn again meanwhile
    for (const w of list) {
      const span = document.createElement('span');
      span.className = 'warning';
      span.textContent = `⚠ ${w.text} `;
      if (!w.fix) {
        el.append(span);
        continue;
      }
      const fix = document.createElement('button');
      fix.className = 'link';
      fix.textContent = w.fixLabel;
      fix.onclick = async () => {
        if (!canEdit()) return;
        await w.fix();
        toast(`${w.fixDone} Save to write the battle data.`);
        updateToolbar();
        renderWarnings();
      };
      span.append(fix);
      el.append(span);
    }
  }).catch((err) => console.warn('battle conditions / counts', err));
}

/**
 * The stage table says how many units per side a battle loads (allies, others);
 * units past that count don't appear. Duplicate and Add a character raise it, but
 * a battle edited without that (older editor, other tools) can be short. Stock
 * battles don't always match the field either, so only edited ones are checked.
 */
async function countWarnings(doc) {
  const stages = sync.stagesOf(doc);
  if (!stages.length) return [];
  const edited = doc.dirty || state.editedFiles?.has(`battle/entry/${doc.fileName}`);
  if (!edited) return [];
  let allies = 0, others = 0;
  for (const s of doc.unitSlots()) {
    const row = doc.row(s);
    if (readField(row, FIELD.appears) !== 1) continue;
    if (readField(row, FIELD.team) === ALLY_TEAM) allies++; else others++;
  }
  const out = [];
  const limit = battleLimit();
  for (const stage of stages) {
    const c = await stageCounts(stage);
    const total = c.deployment + Math.max(allies, c.allies) + Math.max(others, c.others);
    if (total > limit) {
      out.push({text: `Stage ${stage} needs ${total} slots including deployment and guests. The limit is ${limit}.`});
      continue;
    }
    for (const [side, field, count, team] of [['allies', allies, c.allies, ALLY_TEAM], ['enemies', others, c.others, 2]]) {
      if (field <= count) continue;
      out.push({
        text: `Stage ${stage} loads ${count} ${side}, but ${field} are on the field: the last ${field - count} won't appear in battle.`,
        fixLabel: `Load ${field}`,
        fixDone: `Stage ${stage} now loads ${field} ${side}.`,
        fix: () => changeStageCount(stage, team, field - count),
      });
    }
  }
  return out;
}

function renderHover(hover) {
  const el = $('#hover-info');
  if (!hover || (!hover.tile && !hover.unit)) { el.textContent = 'Hover a tile or unit · drag units to move · scroll to zoom · drag to pan'; return; }
  if (hover.unit) {
    const u = hover.unit;
    el.textContent = `${u.label} · slot ${u.slot} · tile ${u.x}, ${u.y}`;
    return;
  }
  const t = hover.tile;
  if (mapView.grid?.synthetic) { el.textContent = `Tile ${t.x}, ${t.y} · no map selected`; return; }
  el.textContent = `Tile ${t.x}, ${t.y} · height ${displayHeight(t)} (raw ${t.height}) · surface #${t.surface}${t.object !== null ? ` · object #${t.object}` : ''}`;
}

// ---- modes -------------------------------------------------------------
state.mode = 'battles';
let cutscenes = null;

function ensureCutscenes() {
  cutscenes ??= new CutsceneEditor({
    tables: () => state.tables, catalog, sync, lang: () => $('#lang').value, toast, setStatus, onChange: updateToolbar, readOnly: () => !!state.info?.readOnly,
    openBattle:async(doc,context)=>{
      if(context)catalog.setContext(doc,context.id);
      await $('#modes button[data-mode="battles"]').onclick();
      await openBattle(doc);
    },
  });
  window.torEditor.cutscenes = cutscenes;
  return cutscenes;
}

// Battles and the cutscenes that start them, kept in step (app/battlesync.js)
const sync = new BattleSync({
  catalog, history, battles: () => state.battles ?? [], cutscenes: async () => ensureCutscenes(), tables: () => state.tables,
  freeTile: (doc, x, y) => freeTileIn(doc, x, y), toast, setStatus, onChange: updateToolbar,
});

const modeButtons = document.querySelectorAll('#modes button[data-mode], #integrated-mods-btn');
function highlightMode(mode) {
  for (const button of modeButtons) button.classList.toggle('on', button.dataset.mode === mode);
}

for (const b of modeButtons) {
  b.onclick = async () => {
    const mode = b.dataset.mode;
    state.mode = mode;
    highlightMode(mode);
    const layout = mode === 'mods' ? 'data' : mode;
    for (const id of ['battles', 'cutscenes', 'data', 'maps']) $(`#${id}-layout`).hidden = id !== layout;
    if (mode === 'cutscenes') {
      ensureCutscenes();
      await cutscenes.open();
    }
    if (mode === 'battles') renderAll();
    if (layout === 'data') {
      try {
        await openDataEditor();
        if (state.mode === mode) await dataEditor.showIntegratedMods(mode === 'mods');
      } catch (error) { toast(error.message, true); }
    }
    if (mode === 'maps') await openMapEditor();
  };
}

// Classes & items editor (built separately; see ui/dataeditor.js)
$('#toggle-start-tiles').onchange = () => renderAll();
$('#toggle-unit-walking').onchange=e=>{if(mapView3d){mapView3d.handlers.walkInPlace=e.target.checked;mapView3d.updateBillboards();}};
$('#toggle-unit-icons').onchange=e=>{if(mapView3d){mapView3d.showUnitMarkers=!e.target.checked;mapView3d.drawOverlay();}};
$('#battle-dialogue').onclick = async () => {
  const context = catalog.activeContext(state.doc);
  if (!context?.scene) return;
  await $('#modes button[data-mode="cutscenes"]').onclick();
  const file = cutscenes.files.find(f => f.id === context.scene);
  if (!file) { toast(`No scene file found for ${context.scene}.`,true); return; }
  $('#cs-all-parts').checked = true;
  cutscenes.showPanel('lines');
  await cutscenes.openScene(file);
  const part = cutscenes.scene?.parts.findIndex(p => p.entryId === context.start?.part);
  if (part >= 0 && part !== cutscenes.scriptIndex) await cutscenes.selectScript(part);
};

let dataEditor = null;
let openingDataEditor = null;
const battleConditions = new BattleConditionsPanel({
  catalog, tables:()=>state.tables, doc:()=>state.doc, readOnly:()=>!!state.info?.readOnly,
  toast, chapterChanged:chapter=>{ensureCutscenes().chapterFiles.add(chapter);updateToolbar();}, onChange:()=>{if(dataEditor?.dat)dataEditor.refreshBattleData();updateToolbar();},
});
$('#battle-conditions').onclick=()=>battleConditions.open();
function openDataEditor() {
  openingDataEditor ??= (async () => {
    const { DataEditor } = await import('./app/dataeditor.js');
    const editor = new DataEditor($('#data-layout'), { tables: () => state.tables, lang: () => $('#lang').value, toast, setStatus,
      onChange: () => { state.tables?.updateProjectOptions(editor.menuMods); updateToolbar(); }, readOnly: () => !!state.info?.readOnly,
      createModProject: () => projects.saveAs(),
      openWorldMap,
      onOpenData: () => { state.mode = 'data'; highlightMode('data'); } });
    await editor.open();
    dataEditor = editor;
  })().catch(error => { openingDataEditor = null; throw error; });
  return openingDataEditor;
}

// Maps mode (tile editing; see app/mapeditor.js)
let mapEditor = null;
async function openMapEditor() {
  if (!mapEditor) {
    const { MapEditor } = await import('./app/mapeditor.js');
    mapEditor = new MapEditor($('#maps-layout'), { catalog, tables: () => state.tables, toast, setStatus, onChange: updateToolbar, readOnly: () => !!state.info?.readOnly });
    window.torEditor.maps = mapEditor;
  }
  await mapEditor.open();
}

// ---- toolbar -----------------------------------------------------------
function pendingChanges() {
  const battles = state.battles.filter((d) => d.dirty).length;
  const scenes = cutscenes?.dirtyFiles().length ?? 0;
  // stage unit counts live in the battle data: Classes & items saves them when it is open
  const data = dataEditor?.dat ? (dataEditor.dirty ? 1 : 0) : (countsChanged() ? 1 : 0);
  const maps = mapEditor?.dirtyFiles().length ?? 0;
  const backdrops = mapEditor?.backdrops.changes.size ?? 0;
  return { battles, scenes, data, maps, backdrops, total: battles + scenes + data + maps + backdrops };
}

function updateToolbar() {
  const p = pendingChanges();
  const mods = dataEditor?.menuMods;
  const enabled = state.info?.project && (mods?.info.project === state.info.project
    ? mods.savedVersusEnabled : state.info.versusEnabled);
  const versus = $('#versus-btn');
  versus.disabled = !state.info?.expandedBattlesSupported || !enabled;
  versus.title = versus.disabled ? 'Enable Versus Mode in Integrated Mods and save the project.'
    : 'Set up a Versus match or tournament.';
  $('#save').disabled = !!saveInProgress || !p.total || state.info?.readOnly;
  const parts = [];
  if (p.battles) parts.push(`${p.battles} battle${p.battles > 1 ? 's' : ''}`);
  if (p.scenes) parts.push('scenes / rules');
  if (p.data) parts.push(dataEditor?.dat ? 'game data' : 'battle conditions / counts');
  if (p.maps) parts.push(`${p.maps} map${p.maps > 1 ? 's' : ''}`);
  if (p.backdrops) parts.push(`${p.backdrops} backdrop${p.backdrops > 1 ? 's' : ''}`);
  $('#save').textContent = p.total ? `Save ${parts.join(' + ')} to ${state.info?.project ? 'project' : 'game'}` : 'Saved';
  $('#save').title = state.info?.project ? `Save into the project "${state.info.project}" (Ctrl+S). The game changes when you apply it (Files menu).` : 'Save to the game (Ctrl+S)';
  $('#undo').disabled = !history.done.length;
  $('#redo').disabled = !history.undone.length;
}

function battleLimit() {
  const mods = dataEditor?.menuMods;
  if (state.info?.expandedBattlesSupported && state.info.project && mods?.info.project === state.info.project) {
    return mods.value.expandedBattleLimit ? state.info.expandedBattleUnitLimit : LARGEST_STOCK_BATTLE;
  }
  return state.info?.battleUnitLimit ?? LARGEST_STOCK_BATTLE;
}

let saveInProgress = null;
/** Save every pending change into the open project or game. Apply can wait on the same write. */
function save(options) {
  saveInProgress ??= savePending(options).finally(() => {
    saveInProgress = null;
    updateToolbar();
  });
  $('#save').disabled = true;
  return saveInProgress;
}

async function savePending({ quiet = false } = {}) {
  try {
    await sync.finishPending();
    for (const doc of state.battles.filter((doc) => doc.dirty)) await sync.ensureAddedUnitsLoad(doc, battleLimit());
  } catch (err) {
    toast(`Save failed: ${err.message}`, true);
    setStatus(`Save failed: ${err.message}`, true);
    return false;
  }
  const p = pendingChanges();
  if (!p.total) return true;
  const what = [
    p.battles && `${p.battles} battle file${p.battles > 1 ? 's' : ''}`,
    p.scenes && 'cutscene and battle-rule changes',
    p.data && (dataEditor?.dat ? 'class/item/spell data and names' : 'battle conditions and unit counts (battle data)'),
    p.maps && `${p.maps} map file${p.maps > 1 ? 's' : ''} (tile data)`,
    p.backdrops && 'map backdrop settings',
  ].filter(Boolean).join(', ');
  const project = state.info.project;
  const groupSettingsOnly=p.data&&!p.battles&&!p.scenes&&!p.maps&&!p.backdrops&&(dataEditor?.restrictionGroups?.dirty||dataEditor?.menuMods?.dirty)&&!dataEditor?.warrenRules?.dirty&&!dataEditor.battleChanged()&&!dataEditor.menuChanged()&&!dataEditor.renames.size&&!dataEditor.entryEdits.size;
  const ok = quiet || groupSettingsOnly || confirm(project
    ? `Save ${what} into the project "${project}"?\n\nThe game doesn't change until you apply the project (Files > Apply project to the game).`
    : `Write ${what} and update FileTable.bin in:\n${state.info.dataRoot}\n\nOriginals are backed up the first time a file is changed. (To keep edits apart from the game, use Files > New project or Save project as.)`);
  if (!ok) return false;
  try {
    $('#save').disabled = true;
    setStatus('Saving…');
    const saved = [];
    const notes = [];
    // cutscenes first: saving a battle file updates the scene files that carry a copy of it
    if (p.scenes) saved.push(...await cutscenes.save());
    if (p.battles) {
      const r = await saveBattles(state.battles, { onProgress: setStatus });
      saved.push(...r.saved);
      history.clear();
      if (r.scenes.length) {
        notes.push(`${r.scenes.length} scene file${r.scenes.length > 1 ? 's' : ''} carrying a copy for joins updated`);
        await cutscenes?.reloadScenes(r.scenes);
      }
      if (r.skipped.length) notes.push(`copies left alone (no matching units): ${r.skipped.join(', ')}`);
    }
    if (dataEditor?.dat) {
      if (p.data) {saved.push(...await dataEditor.save());if(dataEditor.lastSavedGroupSettings)notes.push('Restriction group names and empty groups saved with the project/game settings.');if(dataEditor.lastSavedMenuSettings)notes.push(state.info.project?'Project settings saved.':'Menu controls saved for the next game launch.');}
    } else if (p.battles || p.data) {
      const f = await battleDataFile(); // stage unit counts
      if (f) { await saveDataFiles([f]); await battleDataSaved(f.bytes, f.savedSize); saved.push(f.path); }
    }
    if (p.backdrops) {
      await mapEditor.backdrops.save();
      notes.push('Map backdrops saved.');
    }
    if (p.maps) saved.push(...await mapEditor.save());
    toast(!saved.length ? (notes.length?notes.join(' '):'Nothing to save: everything is as it was.')
      : project ? `Saved ${saved.length} file${saved.length > 1 ? 's' : ''} into the project "${project}".${notes.length ? ` ${notes.join('; ')}.` : ''}`
      : `Saved ${saved.length} file${saved.length > 1 ? 's' : ''} and updated FileTable.bin.${notes.length ? ` ${notes.join('; ')}.` : ''}`);
    setStatus(`Saved ${saved.length?saved.join(', '):'editor settings'}${project ? ` into ${project}` : ''}`);
    state.editedFiles = await editedFiles();
    if (!quiet && dataEditor?.refreshIntegratedContent) {
      dataEditor.refreshIntegratedContent = false;
      leaving = true;
      location.reload();
      return true;
    }
    renderAll();
    renderBattleList();
    return true;
  } catch (err) {
    if (err instanceof SaveCancelled) {
      setStatus(err.message);
      return false;
    }
    console.error(err);
    toast(`Save failed: ${err.message}`, true);
    setStatus(`Save failed: ${err.message}`, true);
    return false;
  }
}

async function restore() {
  const files = await source.backups();
  if (!files.length) { toast('No backups yet: nothing has been changed by the editor.'); return; }
  const ok = confirm(`Restore ${files.length} original file${files.length > 1 ? 's' : ''} from the editor's backups?\n\n${files.slice(0, 12).join('\n')}${files.length > 12 ? '\n…' : ''}\n\nUnsaved edits will be discarded.`);
  if (!ok) return;
  const { restored } = await source.restore();
  toast(`Restored ${restored.length} file${restored.length > 1 ? 's' : ''}. Reloading…`);
  leaving = true;
  setTimeout(() => location.reload(), 800);
}

let leaving = false; // a reload the user already agreed to: no "leave site?" prompt
const projects = new Projects({
  info: () => state.info,
  refreshInfo: async () => {
    state.info = await source.info();
    dataEditor?.restrictionGroups?.setScope(state.info);
    dataEditor?.menuMods?.setScope(state.info);
    if (catalog.setScope(state.info) && state.doc) { await loadMapFor(state.doc); renderAll(); renderBattleList(); }
    projects.render(); updateToolbar();
  },
  pending: () => pendingChanges(),
  save, finishSave: () => saveInProgress, restore,
  leave: () => { leaving = true; },
  closeMenu: () => showMenu('files', false),
  toast, setStatus,
});

$('#add-unit').onclick = () => duplicateUnit(state.slot);
$('#add-character').onfocus = renderCharacterPicker;
$('#add-character').onchange = (e) => { const key=e.target.value,c=/^(form|custom):/.test(key)?key:Number(key); e.target.value = ''; addCharacter(c); };
$('#add-generic').onfocus=()=>renderGenericPicker().catch(e=>toast(e.message,true));
$('#add-generic').onchange=e=>{const key=e.target.value;e.target.value='';addGeneric(key);};
$('#remove-unit').onclick = () => removeUnit(state.slot);
$('#save').onclick = () => save();
$('#undo').onclick = () => { afterHistory(history.undo()); renderAll(); };
$('#redo').onclick = () => { afterHistory(history.redo()); renderAll(); };

/** An undone or redone move: a unit kept in step with a cutscene takes the cutscene with it. */
function afterHistory(op) {
  if (op?.kind !== 'patch') return;
  const moved = op.offset <= FIELD.facing.offset && op.offset + op.after.length > FIELD.x.offset;
  if (moved) sync.unitMoved(op.doc, op.doc.units[op.slot]).catch((err) => toast(err.message, true));
}
$('#rot-left').onclick = () => activeView().rotate(-1);
$('#rot-right').onclick = () => activeView().rotate(1);
$('#fit').onclick = () => activeView().fitView();
$('#toggle-sprites').onchange = (e) => { if (mapView3d) { mapView3d.showSprites = e.target.checked; mapView3d.updateBillboards(); } };
$('#toggle-light').checked=renderPreferences().lighting;
$('#toggle-animated-tiles').checked=renderPreferences().animatedTiles;
$('#toggle-sprites-over-terrain').checked=renderPreferences().spritesOverTerrain;
$('#toggle-light').onchange=e=>setRenderPreferences({lighting:e.target.checked});
$('#toggle-animated-tiles').onchange=e=>setRenderPreferences({animatedTiles:e.target.checked});
$('#toggle-sprites-over-terrain').onchange=e=>setRenderPreferences({spritesOverTerrain:e.target.checked});
$('#effect-glow').value=Math.round(renderPreferences().effectGlow*100);
$('#effect-glow-value').textContent=$('#effect-glow').value+'%';
$('#effect-glow').oninput=e=>{
  setRenderPreferences({effectGlow:Number(e.target.value)/100});
  $('#effect-glow-value').textContent=e.target.value+'%';
};
$('#toggle-heights').onchange = (e) => { mapView.showHeights = e.target.checked; mapView.render(); };
$('#toggle-ontop').onchange = (e) => { mapView.unitsOnTop = e.target.checked; mapView.render(); };
$('#color-mode').onchange = (e) => { mapView.colorMode = e.target.value; mapView.render(); };
$('#search').oninput = (e) => { state.filter = e.target.value; renderBattleList(); };

// ---- top-bar menus: Files (projects, restore) and Settings (language, hide unknown values)
const MENUS = { files: { button: '#files-btn', panel: '#files-menu', wrap: '.files' }, settings: { button: '#settings-btn', panel: '#settings-menu', wrap: '.settings' } };
function showMenu(name, open) {
  const m = MENUS[name];
  $(m.panel).hidden = !open;
  $(m.button).setAttribute('aria-expanded', String(open));
}
for (const [name, m] of Object.entries(MENUS)) {
  $(m.button).onclick = () => {
    const open = $(m.panel).hidden;
    for (const other of Object.keys(MENUS)) showMenu(other, other === name && open);
    if (open) $(m.panel).querySelector('button, select, input')?.focus();
  };
}
document.addEventListener('pointerdown', (e) => {
  for (const [name, m] of Object.entries(MENUS)) if (!e.target.closest(m.wrap)) showMenu(name, false);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const [name, m] of Object.entries(MENUS)) if (!$(m.panel).hidden) { showMenu(name, false); $(m.button).focus(); }
});
$('#save-editor-open').onclick = () => {
  showMenu('files', false);
  window.open('/save-editor/', '_blank', 'noopener');
};
let artViewer = null;
$('#art-open').onclick = async () => {
  showMenu('files', false);
  try {
    if (!artViewer) {
      const { ArtViewer } = await import('./app/artviewer.js');
      artViewer = new ArtViewer({ tables: () => state.tables, lang: () => $('#lang').value, pending: () => pendingChanges().total });
    }
    await artViewer.open();
  } catch (error) { toast(error.message, true); }
};

$('#hide-unknown').checked = settings.hideUnknown;
$('#hide-unknown').onchange = (e) => {
  setHideUnknown(e.target.checked);
  renderAll();
  if (dataEditor?.dat) dataEditor.renderDetail();
};

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (state.mode === 'cutscenes') {
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (!typing && !mod) cutscenes?.onKey(e);
    return;
  }
  if (state.mode === 'maps') {
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (!typing && !mod) mapEditor?.onKey(e);
    return;
  }
  if (state.mode !== 'battles') {
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    return;
  }
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); afterHistory(history.undo()); renderAll(); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); afterHistory(history.redo()); renderAll(); }
  else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  else if (!typing && e.key.toLowerCase() === 'q') activeView().rotate(-1);
  else if (!typing && e.key.toLowerCase() === 'e') activeView().rotate(1);
});

window.addEventListener('beforeunload', (e) => {
  if (!leaving && pendingChanges().total) { e.preventDefault(); e.returnValue = ''; }
});

// ---- helpers -----------------------------------------------------------
function setStatus(text, error = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

let toastTimer;
function toast(text, error = false) {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, error ? 5000 : 3000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.torEditor = { state, catalog, mapView, mapView3d, sync, history }; // for debugging from the browser console
start();

loadCastIndex().then(looks=>installCharacterPickers((select,value)=>{
  if(!value||!state.tables||!state.battles.length)return null;
  const unitLook=unit=>unit?{actor:unit.sprite[0],palette:state.tables?.unitPalette(unit.row)??0,...(()=>{const c=state.tables.customCharacter(readField(unit.row,FIELD.template));return c?{portraitPath:`object/${c.stem}00.dat`,owner:c.name}:{};})()}:null;
  const donor=id=>sync.specialForms().get(id)??sync.characters().get(Number(id));
  if(select.id==='add-generic')return unitLook(genericChoices?.find(g=>g.key===value)?.donors[0]);
  if(select.id==='add-character'||select.matches('[data-character],[data-who]'))return unitLook(donor(value)?.unit);
  if(select.matches('[data-field="actor"],[data-add="actor"]')){
    if(value.startsWith('add:')){const id=Number(value.slice(4)),look=looks.find(l=>l.character===id);return look?{actor:look.sprite,palette:look.palette??0,...(look.custom?{portraitPath:`object/${look.custom.stem}00.dat`,owner:look.custom.name}:{})}:unitLook(donor(id)?.unit);}
    const scene=cutscenes?.scene;if(!scene)return null;
    const slot=actorSlot(scene,Number(value)),cast=scene.cast[slot];
    if(cast?.sprite)return {actor:cast.sprite,palette:cast.palette??0};
    return sync.actorLook(scene.fileName,Number(value),cutscenes.battlePreview);
  }
  const look=looks[Number(value)];return look?{actor:look.sprite,palette:look.palette??0,...(look.custom?{portraitPath:`object/${look.custom.stem}00.dat`,owner:look.custom.name}:{})}:null;
}));

import {aiLabels as stockAiLabels} from '../game/aiprofiles.js';
import {createPicker} from '../ui/picker.js';

const API = '/api/versus/';
const SAVE_SIZE_LIMIT = 8 * 1024 * 1024;
export const randomArena = {id: 'random', name: 'Random arena'};

export function arenaChoice(select) {
  return select.value === randomArena.id ? randomArena.id : Number(select.value);
}

function element(tag, text) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  return el;
}

function control(label, field) {
  const el = element('label', label);
  el.append(field);
  return el;
}

function options(select, choices, selected) {
  select.replaceChildren(...choices.map(({id, name}) => new Option(name, id)));
  if (selected != null) select.value = String(selected);
}

export function randomTeamControl(assign) {
  const theme = element('select'), button = element('button', 'Assign random team');
  button.type = 'button';
  const node = element('div');
  node.className = 'versus-theme';
  node.append(control('Squad theme', theme), button);
  return {node, theme, button, setThemes(themes) {
    options(theme, [{id: '', name: 'Any theme'}, ...themes], theme.value);
    button.disabled = !themes.length;
    button.onclick = () => assign(drawTeamTheme(themes, theme.value));
  }};
}

export function drawTeamTheme(themes, preferred, used = new Set()) {
  if (preferred) return preferred;
  const available = themes.filter(({id}) => !used.has(id));
  const choices = available.length ? available : themes;
  return choices[Math.floor(Math.random() * choices.length)].id;
}

export async function request(route, body) {
  const headers = {'X-TOR-Editor': '1'};
  const init = {headers};
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    Object.assign(init, {method: 'POST', body: JSON.stringify(body)});
  }
  const res = await fetch(API + route, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Versus could not load.');
  return data;
}

export const versusSettings = new BroadcastChannel('tor-versus-settings');

export async function requestExpandedBattles(project, promptText = '24 vs 24 and 30 vs 30 require Expanded Battle Limit. Enable it for this project?') {
  project ??= await request('project');
  if (!project.enabled) throw new Error('Enable Versus in Integrated Mods and save the project.');
  if (project.expanded) return project;
  if (!project.supported || project.readOnly) throw new Error('Expanded Battle Limit requires an editable Steam project.');
  if (!confirm(promptText)) return null;
  const updated = await request('project', {project: project.name, enableExpanded: true});
  versusSettings.postMessage(updated);
  return updated;
}

export function saveLabel(save) {
  return `Save ${save.slot} · ${save.leader || 'Army'} · ${save.units} units`;
}

export function versusAiOptions(profiles, labels = []) {
  const byId = new Map([...stockAiLabels(), ...labels].map(({id, name}) => [id, name]));
  return profiles.map(({id, name}) => ({
    id,
    name: name === `AI ${id}` ? byId.get(id) ?? name : name.replace(`${id} · `, ''),
  }));
}

export function versusFighterOptions(units) {
  return units.filter(unit => !unit.error).map(unit => ({
    id: unit.slot,
    name: `${unit.name} · Lv. ${unit.level} ${unit.className}`,
    look: () => ({actor: unit.actor, palette: unit.palette}),
  }));
}

export function versusPicker(label, options, value, onChange) {
  const picker = createPicker({options, value, onChange, allowRaw: false});
  picker.setAttribute('aria-label', label);
  return picker;
}

export async function readSave(file) {
  if (file.size > SAVE_SIZE_LIMIT) throw new Error('The save file is too large.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return {upload: btoa(binary)};
}

export function installVersus(aiLabels, applyProject, openMods, syncExpansion) {
  const $ = id => document.getElementById(id);
  const dialog = $('versus'), arena = $('versus-arena'), size = $('versus-size');
  const hideSpectator = $('versus-hide-spectator');
  const omitSnapshots = $('versus-omit-snapshots');
  const host = $('versus-squads'), check = $('versus-preview'), status = $('versus-status');
  const randomTeams = $('versus-random-teams');
  const save = $('versus-save'), saveLater = $('versus-save-later'), title = $('versus-match-title');
  const preview = $('versus-map-preview');
  const result = $('versus-result');
  const mods = $('versus-mods'), apply = $('versus-apply'), projectStatus = $('versus-project-status');
  const setupPanel = $('versus-setup'), queueLink = dialog.querySelector('.versus-queue-link');
  const squads = [];
  const expansionOffered = new Set();
  let setup, setupProject, project, previewArena, busy = false, revision = 0, lastSize = size.value;

  const target = () => Number(size.value);
  const body = () => ({
    size: target(), arena: arenaChoice(arena), hideSpectator: hideSpectator.checked,
    omitSnapshots: omitSnapshots.checked, title: title.value,
    teams: squads.map(s => ({...s.source, units: s.picks})),
  });
  const show = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  };
  const updateButtons = () => {
    check.disabled = !project?.enabled || busy || size.disabled || squads.length !== 2 ||
      squads.some(s => s.loading || s.picks.length !== target());
    saveLater.disabled = check.disabled || project?.readOnly;
    save.disabled = saveLater.disabled || !project?.runtime || (target() === 24 && !project.appliedExpanded);
    randomTeams.disabled = !project?.enabled || busy || squads.length !== 2 ||
      !setup?.themes?.length || squads.some(s => s.loading);
  };
  const update = () => {
    revision++;
    previewArena = undefined;
    updateButtons();
    preview.hidden = true;
  };

  function renderProject(data) {
    project = data;
    const installed = data.name === data.applied && data.runtime;
    const expandedNeeded = target() === 24 && !data.appliedExpanded;
    const available = data.enabled && data.supported;
    mods.hidden = available;
    setupPanel.hidden = queueLink.hidden = !available;
    apply.hidden = !available || (installed && data.smallTeams && !expandedNeeded) || data.readOnly;
    projectStatus.textContent = !data.supported ? 'Versus requires Steam 1.0.8.0.'
      : !data.name ? 'Open or create a project, then enable Versus in Integrated Mods.'
      : !data.enabled ? 'Enable Versus in Integrated Mods and save the project.'
      : !installed || expandedNeeded ? 'Apply the project and restart the game before queuing a fight.'
      : !data.smallTeams ? 'Apply the updated project and restart the game to enable 3 vs 3 and 6 vs 6.'
      : 'Select Versus at Almorica Castle to start your queued fight.';
    updateButtons();
  }

  mods.onclick = () => {
    dialog.close();
    void openMods?.();
  };

  apply.onclick = async () => {
    dialog.close();
    try {
      await applyProject();
    } catch (err) {
      if (!dialog.open) dialog.showModal();
      show(err.message, true);
    }
  };

  function useFirst(squad, keep) {
    const retained = keep ? squad.picks.slice(0, target()) : [];
    const seen = new Set(retained.map(pick => pick.slot));
    for (const unit of squad.data?.units ?? []) {
      if (retained.length === target()) break;
      if (!seen.has(unit.slot) && !unit.error) retained.push({slot: unit.slot, ai: unit.ai});
    }
    squad.picks = retained;
  }

  function render(squad) {
    const data = squad.data;
    const count = data?.units.filter(u => !u.error).length ?? 0;
    squad.summary.textContent = data
      ? `${data.title || squad.sourceName} · ${squad.picks.length}/${target()} selected`
      : '';
    squad.summary.classList.toggle('is-error', !!data && count < target());
    if (data && count < target()) squad.summary.textContent += ` · ${count} eligible units`;
    const selected = new Set(squad.picks.map(p => p.slot));
    const snapshotCount = data?.units.reduce((n, unit) => n + (selected.has(unit.slot) ? unit.snapshotCount ?? 0 : 0), 0) ?? 0;
    if (snapshotCount) squad.summary.textContent += ` · ${snapshotCount} snapshot weapon${snapshotCount === 1 ? '' : 's'}`;
    const profileOptions = versusAiOptions(setup.ai, aiLabels());
    const unitOptions = versusFighterOptions(data?.units ?? []);
    squad.rows.replaceChildren(...squad.picks.map((pick, index) => {
      const row = element('div');
      row.className = 'versus-unit';
      const fighter = data.units.find(u => u.slot === pick.slot);
      const available = unitOptions.filter(u => u.id === pick.slot || !selected.has(u.id));
      const unit = versusPicker(`${squad.label}, unit ${index + 1}`, available, pick.slot, slot => {
        const selected = data.units.find(u => u.slot === slot);
        squad.picks[index] = {slot: selected.slot, ai: selected.ai};
        render(squad);
        squad.rows.children[index].firstElementChild.focus();
        update();
      });
      const ai = versusPicker(`AI for ${fighter.name}`, profileOptions, pick.ai, id => {
        pick.ai = id;
        update();
      });
      row.append(unit, ai);
      return row;
    }));
  }

  async function loadSquad(squad, selection, name) {
    const revision = ++squad.revision;
    squad.loading = true;
    squad.summary.textContent = selection.theme ? 'Rolling lineup…' : 'Reading save…';
    update();
    try {
      const source = await selection;
      const data = await request('squad', source);
      if (revision !== squad.revision) return;
      squad.source = {...source, ...(data.seed && {seed: data.seed}), sha256: data.sha256};
      squad.sourceName = name;
      squad.data = data;
      useFirst(squad, false);
      render(squad);
      return true;
    } catch (err) {
      if (revision === squad.revision) squad.summary.textContent = err.message;
    } finally {
      if (revision === squad.revision) {
        squad.loading = false;
        update();
      }
    }
  }

  function buildSquad(label, suggestedSlot) {
    const section = element('section');
    const local = element('select'), profile = element('select'), upload = element('input');
    local.setAttribute('aria-label', `${label} local save`);
    upload.type = 'file';
    upload.accept = '.sav,application/octet-stream';
    const summary = element('p'), rows = element('div');
    summary.className = 'hint';
    summary.setAttribute('role', 'status');
    rows.className = 'versus-lineup';
    const squad = {label, summary, rows, picks: [], revision: 0};
    squad.assign = async theme => {
      if (await loadSquad(squad, {theme})) {
        local.value = '';
        upload.value = '';
      }
    };
    squad.random = randomTeamControl(squad.assign);
    squad.random.setThemes(setup.themes ?? []);
    squads.push(squad);
    section.append(element('h3', label), control('Save profile', profile), control('Local save', local),
      control('Or import a save file', upload), squad.random.node, summary, rows);
    host.append(section);
    options(profile, setup.profiles.map(id => ({id, name: id})), setup.profile);
    function list(saves) {
      options(local, [{id: '', name: 'Select a save…'}, ...saves.filter(s => s.ok)
        .map(s => ({id: s.name, name: saveLabel(s)}))]);
    }
    list(setup.saves);
    const showLocal = () => {
      if (!local.value) return;
      upload.value = '';
      return loadSquad(squad, {profile: profile.value, name: local.value}, local.selectedOptions[0].textContent);
    };
    local.onchange = showLocal;
    profile.disabled = !setup.profiles.length;
    profile.onchange = async () => {
      const key = profile.value;
      ++squad.revision;
      squad.data = null;
      squad.picks = [];
      squad.loading = false;
      local.disabled = true;
      render(squad);
      update();
      try {
        const data = await request('setup?profile=' + encodeURIComponent(key));
        if (key === profile.value) list(data.saves);
      } catch (err) {
        if (key === profile.value) squad.summary.textContent = err.message;
      } finally {
        if (key === profile.value) local.disabled = false;
      }
    };
    upload.onchange = () => {
      const file = upload.files[0];
      if (file) {
        local.value = '';
        return loadSquad(squad, readSave(file), file.name);
      }
    };
    const suggested = setup.saves.find(s => s.slot === suggestedSlot && s.ok && s.units >= target());
    if (suggested) {
      local.value = suggested.name;
      void showLocal();
    }
  }

  $('versus-btn').onclick = async () => {
    dialog.showModal();
    mods.hidden = setupPanel.hidden = queueLink.hidden = true;
    apply.hidden = true;
    projectStatus.textContent = 'Checking the project…';
    try {
      let data = await request('project');
      if (data.enabled && data.supported && !data.expanded && !data.readOnly && !expansionOffered.has(data.name)) {
        expansionOffered.add(data.name);
        const updated = await requestExpandedBattles(data,
          'Enable Expanded Battle Limit for 24 vs 24 fights and 30 vs 30 tournaments?\n\nChoose Cancel to use Versus with 3 vs 3, 6 vs 6, and 12 vs 12.');
        if (updated) {
          data = updated;
          syncExpansion?.(data);
        }
      }
      if (setupProject !== data.name) {
        setup = null;
        squads.length = 0;
        host.replaceChildren();
      }
      if (target() === 24 && !data.expanded) size.value = lastSize = '12';
      renderProject(data);
      if (!data.enabled || !data.supported) return;
      void request('result').then(data => {
        result.hidden = !data.result;
        result.textContent = data.result || '';
      }).catch(() => { result.hidden = true; });
      if (setup) return;
      show('Loading local saves and AI profiles…');
      setup = await request('setup');
      setupProject = data.name;
      options(arena, [...setup.maps, randomArena]);
      buildSquad('Team A · Blue', 4);
      buildSquad('Team B · Red', 5);
      updateButtons();
      show('Choose a save or assign a random team to each side.');
    } catch (err) {
      projectStatus.textContent = err.message;
    }
  };
  randomTeams.onclick = async () => {
    const used = new Set(squads.map(squad => squad.random.theme.value).filter(Boolean));
    await Promise.all(squads.map(squad => {
      const theme = drawTeamTheme(setup.themes, squad.random.theme.value, used);
      used.add(theme);
      return squad.assign(theme);
    }));
  };
  arena.onchange = update;
  hideSpectator.onchange = update;
  omitSnapshots.onchange = update;
  size.onchange = async () => {
    size.disabled = true;
    updateButtons();
    try {
      if (target() === 24) {
        const data = await requestExpandedBattles();
        if (!data) {
          size.value = lastSize;
          return;
        }
        syncExpansion?.(data);
        renderProject(data);
      }
      lastSize = size.value;
    } catch (err) {
      size.value = lastSize;
      show(err.message, true);
      return;
    } finally {
      size.disabled = false;
      updateButtons();
    }
    for (const squad of squads) {
      useFirst(squad, true);
      render(squad);
    }
    update();
    if (project) renderProject(project);
  };
  check.onclick = async () => {
    busy = true;
    update();
    const checking = revision;
    show('Checking lineups and arena positions…');
    try {
      const match = await request('preview', body());
      if (revision !== checking) {
        show('The setup changed while checking. Check the new lineup to refresh the arena preview.');
        return;
      }
      const heading = element('h3', match.arena);
      const count = element('p', `${match.teams.map(t => t.lineup.length).join(' vs ')} + 1 spectator`);
      const field = element('div');
      field.className = 'versus-field';
      for (const [team, points] of match.teams.map((t, i) => [i, t.lineup]).concat([
        [2, [{tile: match.spectator, name: 'Spectator'}]],
      ])) {
        for (const {tile: [x, y], name} of points) {
          const dot = element('span', team === 2 ? 'S' : ['A', 'B'][team]);
          dot.style.gridArea = `${y + 1} / ${x + 1}`;
          dot.className = `versus-side-${team}`;
          dot.classList.toggle('versus-hidden-spectator', team === 2 && match.hideSpectator);
          dot.title = `${name} (${x}, ${y})`;
          field.append(dot);
        }
      }
      preview.replaceChildren(heading, count, field);
      previewArena = match.arenaId;
      const omitted = match.teams.flatMap(team => team.lineup).reduce((n, unit) => n + unit.omittedSnapshots, 0);
      show(omitted ? `Formation verified. ${omitted} snapshot weapon slots will be empty in this fight.`
        : 'Lineups and spawn positions verified. Use Save & Queue Fight to send them to Training.');
      preview.hidden = false;
    } catch (err) {
      show(err.message, true);
    } finally {
      busy = false;
      updateButtons();
    }
  };
  async function saveFight(queue) {
    const selection = {...body(), queue};
    if (previewArena != null) selection.arena = previewArena;
    busy = true;
    update();
    show(queue ? 'Saving and queuing both lineups…' : 'Saving both lineups…');
    try {
      const saved = await request('save', selection);
      const omitted = saved.omittedSnapshots ? ` ${saved.omittedSnapshots} snapshot weapon slots will be empty.` : '';
      if (saved.queued) {
        show(`Queued “${saved.title}” at ${saved.arena}. Select Versus at Almorica Castle to start it.${omitted}`);
      } else if (saved.queueError) {
        show(`Saved “${saved.title}” for later. ${saved.queueError}${omitted}`, true);
      } else {
        show(`Saved “${saved.title}” at ${saved.arena}. To play it, choose Queue Fight in the Match queue.${omitted}`);
      }
    } catch (err) {
      show(err.message, true);
    } finally {
      busy = false;
      update();
    }
  }
  save.onclick = () => saveFight(true);
  saveLater.onclick = () => saveFight(false);
}

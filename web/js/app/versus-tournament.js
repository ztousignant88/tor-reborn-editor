import {arenaChoice, drawTeamTheme, randomArena, randomLoadoutNote, randomTeamControl, readSave, request, saveLabel,
  requestExpandedBattles, versusAiOptions, versusFighterOptions, versusPicker} from './versus.js';
import {battleData} from '../game/battledata.js';
import {GameTables} from '../game/tables.js';

function node(tag, text = '') {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

function field(label, input) {
  const el = node('label', label);
  el.append(input);
  return el;
}

function choices(select, entries, selected) {
  select.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
  if (selected != null) select.value = selected;
}

export function installTournament(refresh) {
  const $ = id => document.getElementById(`tournament-${id}`);
  const picker = $('picker'), board = $('bracket'), next = $('next'), info = $('status');
  const controls = $('controls'), auto = $('auto'), launch = $('launch'), restart = $('restart');
  const random = $('random-arena');
  const setup = $('setup'), form = $('form'), size = $('size'), map = $('map'), profile = $('profile');
  const teamCount = $('team-count');
  const source = $('source'), split = $('split'), save = $('save'), draft = $('draft-status');
  const randomTeams = $('random-teams');
  const randomLoadout = $('random-loadout');
  const aiPanel = $('ai'), aiTeam = $('ai-team'), aiLineup = $('ai-lineup'), aiSave = $('ai-save'), aiInfo = $('ai-status');
  const resultPanel = $('result'), resultWinner = $('result-winner'), resultSave = $('result-save');
  let resultMatch;
  let aiBracket, aiOptions, aiPending = false;
  let state, bracketId, pinnedId = localStorage.getItem('tor-tournament-pinned'), savedId;
  let rendered, busy = false, catalog, saves = [], lastSize = size.value;
  let paletteReady;
  let updatingControls = false, pendingOption, controlError = '';
  const count = () => Number(size.value);
  const activeTeams = () => teams.slice(0, Number(teamCount.value));
  const otherSlots = team => new Set(activeTeams().filter(other => other !== team && other.source?.sha256 === team.source?.sha256)
    .flatMap(other => other.picks.map(pick => pick.slot)));
  const eligible = team => (team.data?.units ?? []).filter(unit => !unit.error);
  const teams = Array.from({length: 8}, (_, i) => {
    const section = node('section');
    section.hidden = i >= Number(teamCount.value);
    const name = node('input'), local = node('select'), upload = node('input');
    name.disabled = section.hidden;
    name.value = `Team ${i + 1}`;
    name.maxLength = 28;
    name.required = true;
    upload.type = 'file';
    upload.accept = '.sav,application/octet-stream';
    const notes = node('p'), lineup = node('details'), rows = node('div');
    lineup.append(node('summary', 'Lineup'), rows);
    rows.className = 'versus-lineup';
    notes.className = 'muted';
    const team = {section, name, defaultName: name.value, local, upload, notes, rows, picks: []};
    team.random = randomTeamControl(theme => work(async () => {
      await load(team, {theme});
      local.value = '';
      upload.value = '';
    }));
    team.random.button.disabled = true;
    section.append(field('Team name', name), field('Local save', local), field('Or import a save file', upload),
      team.random.node, notes, lineup);
    $('teams').append(section);
    local.onchange = () => {
      upload.value = '';
      if (local.value) void work(async () => {
        await load(team, {profile: profile.value, name: local.value});
      });
    };
    upload.onchange = () => {
      if (upload.files.length) void work(async () => {
        local.value = '';
        await load(team, await readSave(upload.files[0]));
      });
    };
    return team;
  });

  function render(data = state) {
    state = data;
    const find = id => state.tournaments.find(item => item.id === id);
    const forMatch = id => id && state.tournaments.find(item => item.fights.some(fight => fight.match === id));
    const live = forMatch(state.active) ?? forMatch(state.queued);
    const selected = find(savedId) ?? find(pinnedId);
    const bracket = selected ?? live ?? find(bracketId) ?? state.tournaments.at(-1);
    bracketId = bracket?.id;
    const view = JSON.stringify([state, bracketId, busy, updatingControls, pendingOption, controlError]);
    if (view === rendered) return;
    rendered = view;
    picker.hidden = !bracket;
    choices(picker, [['', live ? `Follow live · ${live.title}` : 'Follow live tournament'],
      ...state.tournaments.map(t => [t.id, t.title])], selected?.id ?? '');
    const editable = state.projectEnabled && !state.readOnly;
    setup.hidden = !editable;
    randomLoadout.textContent = `${randomLoadoutNote(state)} Saved brackets keep their original loadouts.`;
    aiPanel.hidden = !bracket || !editable;
    if (aiBracket !== bracket?.id) {
      aiBracket = bracket?.id;
      aiPanel.open = false;
      choices(aiTeam, (bracket?.teams ?? []).map((team, i) => [i, team.name]));
    }
    board.replaceChildren();
    controls.hidden = !bracket || !editable;
    auto.checked = pendingOption?.autoAdvance ?? !!bracket?.autoAdvance;
    auto.disabled = updatingControls;
    launch.checked = pendingOption?.autoLaunch ?? !!bracket?.autoLaunch;
    launch.disabled = updatingControls || !auto.checked || !state.autoLaunchSupported;
    launch.parentElement.title = !state.autoLaunchSupported
      ? 'Apply the updated Versus project and restart the game to enable this option.'
      : 'Open Training and reuse the automatically deployed spectator after a tournament win.';
    random.checked = pendingOption?.randomArena ?? !!bracket?.randomArena;
    random.disabled = updatingControls;
    restart.disabled = updatingControls || !state.ready;
    next.hidden = !bracket || bracket.champion != null;
    next.disabled = !state.ready || !editable || busy || updatingControls || !['ready', 'draw'].includes(bracket?.next?.phase);
    const fightToReport = bracket?.next;
    resultPanel.hidden = !editable || !fightToReport?.match || !['ready', 'battle'].includes(fightToReport.phase);
    if (fightToReport?.match !== resultMatch) {
      resultMatch = fightToReport?.match;
      resultPanel.open = false;
      if (resultMatch) {
        choices(resultWinner, [
          ['', 'Choose the confirmed result'],
          ['Team A wins', `${bracket.teams[fightToReport.teams[0]].name} won`],
          ['Team B wins', `${bracket.teams[fightToReport.teams[1]].name} won`],
          ['draw', 'Draw'],
        ]);
      }
    }
    if (!bracket) {
      info.textContent = state.projectEnabled ? 'Choose a four-team or eight-team bracket.'
        : 'Enable Versus in Integrated Mods and save the project to set up a tournament.';
      return;
    }
    const teams = bracket.teams;
    next.textContent = bracket.next?.phase === 'draw' ? 'Replay drawn fight' : 'Queue next tournament fight';
    info.textContent = bracket.champion != null ? `Champion · ${teams[bracket.champion].name}`
      : bracket.next.phase === 'queued' ? (state.launch === bracket.next.match
        ? 'Fight queued. Training opens automatically when the game returns to Almorica Castle.'
        : 'Fight queued. Select Versus at Almorica Castle.')
      : bracket.next.phase === 'battle' ? 'Fight in progress. The next fight unlocks when the game reports a result.'
      : !state.ready ? 'Apply a Versus-enabled project to queue this tournament.'
      : `${bracket.size} vs ${bracket.size} · ${bracket.randomArena ? randomArena.name : bracket.arena}`;
    if (bracket.autoAdvance && bracket.champion == null) {
      info.textContent += bracket.next.phase === 'draw'
        ? ' Auto advance waits for a winner.'
        : bracket.autoLaunch
          ? ' Auto start reuses the opening spectator. Formation appears if deployment needs your input.'
          : ' Auto advance queues the next fight after a win.';
      if (state.autoError) info.textContent += ` Could not auto-advance. ${state.autoError}`;
    }
    if (controlError) info.textContent = controlError;
    const rounds = bracket.teams.length === 8 ? Array.from({length: 3}, () => {
      const column = node('div');
      column.className = 'versus-round';
      board.append(column);
      return column;
    }) : null;
    for (const [index, fight] of bracket.fights.entries()) {
      const card = node('article');
      const result = {won: 'Winner', waiting: 'Waiting for the previous round', ready: 'Ready',
                      queued: 'Queued', battle: 'In battle', draw: 'Draw · replay required'}[fight.phase];
      card.append(node('h3', fight.label));
      if (fight.arena) card.append(node('p', fight.arena));
      for (const i of fight.teams) {
        if (i == null) {
          card.append(node('p', 'Winner from previous round'));
          continue;
        }
        const team = teams[i];
        const line = node('details');
        line.append(node('summary', team.name + (i === fight.winner ? ' · Winner' : '')), node('p', team.fighters.join(', ')));
        if (team.omittedSnapshots) line.append(node('p', `${team.omittedSnapshots} snapshot weapons left off`));
        card.append(line);
      }
      if (fight.phase !== 'won') card.append(node('p', result));
      if (fight.notice) card.append(node('p', fight.notice));
      (rounds?.[index < 4 ? 0 : index < 6 ? 1 : 2] ?? board).append(card);
    }
  }

  function updateDraft() {
    const active = activeTeams();
    const profiles = versusAiOptions(catalog?.ai ?? []);
    save.disabled = busy || active.some(team => team.picks.length !== count());
    for (const [index, team] of teams.entries()) team.name.disabled = team.section.hidden = index >= active.length;
    for (const team of active) {
      const members = new Map(eligible(team).map(unit => [unit.slot, unit]));
      team.notes.textContent = team.data
        ? `${team.source?.theme ? team.data.title + ' · ' : ''}${team.picks.length}/${count()} selected`
        : 'Choose a save or assign a random team';
      const excluded = otherSlots(team);
      const selected = new Set(team.picks.map(pick => pick.slot));
      const fighters = versusFighterOptions([...members.values()]);
      team.rows.replaceChildren(...team.picks.map((pick, index) => {
        const row = node('div');
        row.className = 'tournament-fighter';
        const available = fighters.filter(u => u.id === pick.slot || (!excluded.has(u.id) && !selected.has(u.id)));
        const unit = versusPicker(`${team.name.value}, fighter ${index + 1}`, available, pick.slot, slot => {
          const u = members.get(slot);
          team.picks[index] = {slot: u.slot, ai: u.ai};
          updateDraft();
          team.rows.children[index].firstElementChild.focus();
        });
        const ai = versusPicker(`AI for ${members.get(pick.slot).name} in ${team.name.value}`, profiles, pick.ai,
          id => { pick.ai = id; });
        row.append(unit, ai);
        return row;
      }));
    }
  }

  function showSavedAI() {
    const bracket = state.tournaments.find(item => item.id === aiBracket);
    const team = bracket?.teams[Number(aiTeam.value)];
    if (!team || !aiOptions) return;
    aiLineup.replaceChildren(...team.fighters.map((name, i) => {
      const row = node('div', name);
      row.className = 'tournament-fighter';
      const id = team.ai[i];
      const ai = versusPicker(`AI for ${name}, fighter ${i + 1}`, aiOptions, id, () => {});
      if (!aiOptions.some(option => option.id === id)) {
        ai.setOptions([...aiOptions, {id, name: `AI ${id} (unavailable)`}]);
      }
      row.append(ai);
      return row;
    }));
    aiSave.disabled = aiPending;
  }

  aiPanel.ontoggle = async () => {
    if (!aiPanel.open) return;
    const opening = aiBracket;
    aiOptions = null;
    aiLineup.replaceChildren();
    aiSave.disabled = true;
    aiInfo.textContent = 'Loading AI profiles…';
    try {
      const settings = await request('setup');
      if (opening !== aiBracket || !aiPanel.open) return;
      aiOptions = versusAiOptions(settings.ai);
      showSavedAI();
      aiInfo.textContent = 'Changes take effect the next time you queue a fight.';
    } catch (err) {
      aiInfo.textContent = err.message;
    }
  };

  aiTeam.onchange = showSavedAI;
  aiSave.onclick = async () => {
    aiPending = aiSave.disabled = true;
    try {
      await request('tournaments', {
        action: 'assignAI', id: aiBracket, team: Number(aiTeam.value),
        profiles: [...aiLineup.querySelectorAll('button.picker')].map(picker => Number(picker.value)),
      });
      await refresh();
      aiInfo.textContent = 'AI assignments saved for future queues.';
    } catch (err) {
      aiInfo.textContent = err.message;
    } finally {
      aiPending = aiSave.disabled = false;
    }
  };

  function fill(team) {
    const used = otherSlots(team);
    const held = new Set(team.picks.map(pick => pick.slot));
    for (const {slot, ai} of eligible(team)) {
      if (team.picks.length === count()) break;
      if (!used.has(slot) && !held.has(slot)) team.picks.push({slot, ai});
    }
  }

  async function work(task) {
    if (busy) return;
    busy = true;
    form.querySelector('fieldset').disabled = true;
    draft.textContent = '';
    if (state) render();
    try {
      await task();
    } catch (err) {
      draft.textContent = err.message;
    } finally {
      busy = false;
      form.querySelector('fieldset').disabled = false;
      updateDraft();
      if (state) render();
    }
  }

  async function load(team, selection) {
    const data = await request('squad', selection);
    // The companion has no main editor to initialize the battle palette bank.
    paletteReady ??= battleData().then(({dat}) => new GameTables(dat, new Map())).catch(() => null);
    await paletteReady;
    Object.assign(team, {source: {...selection, ...(data.seed && {seed: data.seed}), sha256: data.sha256}, data, picks: []});
    if (team.name.value === team.defaultName) {
      if (selection.theme) {
        const duplicate = activeTeams().some(other => other !== team && other.name.value === data.title);
        team.defaultName = duplicate ? `${data.title.slice(0, 26)} ${teams.indexOf(team) + 1}` : data.title;
      } else {
        team.defaultName = `Team ${teams.indexOf(team) + 1}`;
      }
      team.name.value = team.defaultName;
    }
    fill(team);
  }

  async function saveList(key) {
    catalog = await request(key ? `setup?profile=${encodeURIComponent(key)}` : 'setup');
    choices(profile, catalog.profiles.map(id => [id, id]), catalog.profile);
    choices(map, [...catalog.maps, randomArena].map(m => [m.id, m.name]), map.value || 264);
    saves = [['', 'Choose a save'], ...catalog.saves.filter(s => s.ok).map(s => [s.name, saveLabel(s)])];
    choices(source, saves);
    for (const team of teams) {
      choices(team.local, saves, team.source?.profile === profile.value ? team.source.name : '');
      team.random.setThemes(catalog.themes ?? []);
    }
    randomTeams.disabled = !catalog.themes?.length;
  }

  setup.ontoggle = () => {
    if (setup.open && !catalog) void work(() => saveList());
  };
  profile.onchange = () => work(() => saveList(profile.value));
  function updateFormat() {
    const taken = new Set();
    for (const team of activeTeams()) {
      team.picks = team.picks.slice(0, count()).filter(pick => {
        const identity = `${team.source.sha256}:${pick.slot}`;
        if (taken.has(identity)) return false;
        taken.add(identity);
        return true;
      });
    }
    for (const team of activeTeams()) fill(team);
    split.textContent = Number(teamCount.value) === 8 ? 'Fill all eight teams' : 'Fill all four teams';
    updateDraft();
  }
  teamCount.onchange = updateFormat;
  size.onchange = () => work(async () => {
    try {
      if (count() > 12) {
        const project = await requestExpandedBattles();
        if (!project) {
          size.value = lastSize;
          return;
        }
        if (!project.runtime || !project.appliedExpanded || count() > project.maxTeamSize) {
          draft.textContent = `Apply the project and restart the game before queuing a ${count()} vs ${count()} fight.`;
        }
      }
      lastSize = size.value;
      updateFormat();
    } catch (err) {
      size.value = lastSize;
      throw err;
    }
  });
  split.onclick = () => work(async () => {
    if (!source.value) throw new Error('Choose a save to split.');
    const selection = {profile: profile.value, name: source.value};
    const data = await request('squad', selection);
    const available = data.units.filter(unit => !unit.error);
    const active = activeTeams();
    const needed = count() * active.length;
    if (available.length < needed) throw new Error(`This size needs ${needed} eligible fighters. The save has ${available.length}.`);
    for (const [i, team] of active.entries()) {
      const picks = available.filter((_, j) => j % active.length === i).slice(0, count()).map(({slot, ai}) => ({slot, ai}));
      Object.assign(team, {source: {...selection, sha256: data.sha256}, data, picks});
      team.local.value = source.value;
      team.upload.value = '';
    }
  });
  randomTeams.onclick = () => work(async () => {
    const active = activeTeams();
    const used = new Set(active.map(team => team.random.theme.value).filter(Boolean));
    await Promise.all(active.map(async team => {
      const theme = drawTeamTheme(catalog.themes, team.random.theme.value, used);
      used.add(theme);
      await load(team, {theme});
      team.local.value = '';
      team.upload.value = '';
    }));
  });
  form.onsubmit = event => {
    event.preventDefault();
    void work(async () => {
      const saved = await request('tournaments', {
        action: 'create', title: $('name').value, size: count(), arena: arenaChoice(map),
        omitSnapshots: $('omit').checked,
        teams: activeTeams().map(team => ({...team.source, label: team.name.value, units: team.picks})),
      });
      savedId = saved.id;
      pinnedId = null;
      localStorage.removeItem('tor-tournament-pinned');
      setup.open = false;
      await refresh();
    });
  };
  picker.onchange = () => {
    controlError = '';
    savedId = null;
    pinnedId = picker.value;
    if (pinnedId) localStorage.setItem('tor-tournament-pinned', pinnedId);
    else localStorage.removeItem('tor-tournament-pinned');
    render();
  };
  async function changeBracket(action, extra = {}) {
    const id = bracketId;
    updatingControls = true;
    pendingOption = {[action]: extra.enabled};
    controlError = '';
    render();
    try {
      const bracket = state.tournaments.find(item => item.id === id);
      const queuing = action === 'queue' || action === 'restart';
      if (queuing && bracket?.size > 12 && (!state.expanded || bracket.size > state.maxTeamSize)) {
        if (state.expanded || await requestExpandedBattles()) {
          controlError = `Apply the project and restart the game before queuing a ${bracket.size} vs ${bracket.size} fight.`;
        }
        return;
      }
      await request('tournaments', {action, id, ...extra});
      if ((action === 'queue' || action === 'restart') && savedId === id) savedId = null;
      await refresh();
    } catch (err) {
      controlError = err.message;
    } finally {
      updatingControls = false;
      pendingOption = null;
      render();
    }
  }
  next.onclick = () => changeBracket('queue');
  restart.onclick = () => changeBracket('restart');
  auto.onchange = () => changeBracket('autoAdvance', {enabled: auto.checked});
  launch.onchange = () => changeBracket('autoLaunch', {enabled: launch.checked});
  random.onchange = () => changeBracket('randomArena', {enabled: random.checked});
  resultSave.onclick = async () => {
    if (!resultWinner.value) return;
    resultSave.disabled = true;
    try {
      await request('tournaments', {action: 'recordResult', id: bracketId, match: resultMatch, result: resultWinner.value});
      await refresh();
    } catch (err) {
      info.textContent = err.message;
    } finally {
      resultSave.disabled = false;
    }
  };
  return render;
}

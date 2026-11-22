import {request, requestExpandedBattles} from './versus.js';
import {installTournament} from './versus-tournament.js';
import {useInstalledGameData} from '../game/source.js';

useInstalledGameData();

const summary = document.getElementById('queue-summary');
const matches = document.getElementById('queue-matches');
const next = document.getElementById('queue-next');
const clear = document.getElementById('queue-clear');
let state, pending = false, message = '', rendered, requestVersion = 0;
const renderTournament = installTournament(refresh);

function element(tag, label) {
  const el = document.createElement(tag);
  el.textContent = label;
  return el;
}

function unplayed() {
  return state.matches.find(m => !state.results[m.id] && ![state.active, state.queued].includes(m.id));
}

function render() {
  if (!state) return;
  const enabled = state.ready && !state.readOnly && !pending;
  next.disabled = !enabled || !unplayed();
  clear.disabled = !enabled || !state.queued;
  const label = (id, isActive = false) => {
    if (!id) return null;
    const match = state.matches.find(m => m.id === id);
    if (match) return match.title;
    for (const bracket of state.tournaments ?? []) {
      const fight = bracket.fights.find(f => f.match === id && (!isActive || f.phase === 'battle'));
      if (fight) return `${bracket.title} · ${fight.label}`;
    }
    return null;
  };
  const queued = label(state.queued);
  const active = label(state.active, true);
  summary.textContent = message || (active
    ? `In battle · ${active}${queued && state.queued !== state.active ? `. Up next · ${queued}` : ''}`
    : queued ? `Queued · ${queued}. Select Versus at Almorica Castle to load it.`
    : state.ready ? 'Choose a fight to queue for Almorica Castle Training.'
    : 'Enable Versus in Integrated Mods, then save and apply the project to send a fight to the game.');
  const snapshot = JSON.stringify([state, enabled]);
  if (snapshot === rendered) return;
  rendered = snapshot;
  matches.replaceChildren(...state.matches.map(match => {
    const row = element('li', '');
    row.className = 'versus-match';
    const details = element('div', '');
    const description = element('p', `${match.arena} · ${match.size} vs ${match.size}`);
    description.className = 'muted';
    const result = state.results[match.id];
    const notices = state.notices?.[match.id];
    const labels = [match.id === state.active ? 'In battle'
      : match.id === state.queued ? 'Queued' : '', result].filter(Boolean);
    details.append(element('strong', match.title), description);
    if (labels.length) details.append(element('span', labels.join(' · ')));
    if (match.omittedSnapshots) details.append(element('p', `${match.omittedSnapshots} snapshot weapons left off`));
    if (notices) details.append(element('p', notices));
    const squads = element('details', '');
    squads.append(element('summary', 'Lineups'), ...match.squads.map((squad, i) =>
      element('p', `Team ${i ? 'B' : 'A'} · ${squad.join(', ')}`)));
    details.append(squads);
    const choose = element('button', 'Queue fight');
    choose.type = 'button';
    choose.disabled = !enabled || match.id === state.queued;
    choose.onclick = () => update({id: match.id});
    row.append(details, choose);
    return row;
  }));
  if (!state.matches.length) matches.append(element('li', 'Use Save Fight in the editor to add your first matchup.'));
}

async function refresh() {
  if (pending) return;
  const version = ++requestVersion;
  try {
    const [data, tournaments] = await Promise.all([request('queue'), request('tournaments')]);
    if (version !== requestVersion) return;
    state = {...data, tournaments: tournaments.tournaments};
    renderTournament(tournaments);
    render();
  } catch (err) {
    if (version !== requestVersion) return;
    summary.textContent = err.message;
    next.disabled = clear.disabled = true;
  }
}

async function update(body) {
  pending = true;
  ++requestVersion;
  message = '';
  render();
  try {
    if (!state.expanded && state.matches.some(match => match.id === body.id && match.size === 24)) {
      if (await requestExpandedBattles()) {
        message = 'Apply the project and restart the game before queuing a 24 vs 24 fight.';
      }
    } else {
      await request('queue', body);
    }
  } catch (err) {
    message = err.message;
  } finally {
    pending = false;
    await refresh();
  }
}

next.onclick = () => { const match = unplayed(); if (match) void update({id: match.id}); };
clear.onclick = () => update({clear: true});
void refresh();
setInterval(refresh, 3000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh();
});

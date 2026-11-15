import { startingStatusCatalog } from './startingstatuscatalog.js';
const buffs = startingStatusCatalog.filter(row => row.kind === 'buff');
const debuffs = startingStatusCatalog.filter(row => row.kind === 'debuff');
const byId = new Map(startingStatusCatalog.map(row => [row.id, row]));
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const sides = { Player: 'playerStartingStatus', Enemy: 'enemyStartingStatus' };

export const startingStatusDefaults = () => ({
  playerStartingStatus: { conditions: [], persistent: false },
  enemyStartingStatus: { conditions: [], persistent: false },
  startingStatusAllowCure: true,
});

const groups = hardMode => hardMode
  ? [['Enemy', 'buffs', buffs], ['Player', 'debuffs', debuffs]]
  : [['Player', 'buffs', buffs], ['Enemy', 'debuffs', debuffs]];

export function startingStatusesEnabled(value, hardMode) {
  return groups(hardMode).some(([side, , options]) => options.some(({ id }) => value[sides[side]]?.conditions.includes(id)));
}

export function startingStatusesChanged(value, saved, hardMode) {
  const changed = groups(hardMode).some(([side, , options]) => options.some(({ id }) =>
    !!value[sides[side]]?.conditions.includes(id) !== !!saved[sides[side]]?.conditions.includes(id)));
  return changed || hardMode && (
    (value.startingStatusAllowCure ?? true) !== (saved.startingStatusAllowCure ?? true) ||
    Object.values(sides).some(key => !!value[key]?.persistent !== !!saved[key]?.persistent));
}

export function renderStartingStatuses(section, value, supported, readOnly, hardMode, onChange) {
  const disabled = !supported || readOnly;
  const checked = flag => flag ? 'checked' : '';
  const locked = flag => flag ? 'disabled' : '';
  section.innerHTML = `<h2>Starting statuses</h2>
    <p class="hint">${supported ? 'Select any compatible combination of conditions. Each side’s selections are shared between Hard Mode and Cheats and apply in fresh battles. Conditions that replace or block a selected effect are unavailable.' : 'Open a project in the updated editor to configure starting statuses.'}</p>
    <label class="starting-status-search">Find a status<input type="search" data-status-search placeholder="Search names or effects" aria-label="Find a starting status"></label>
    <div class="starting-status-groups">${groups(hardMode).map(([side, type, options]) => {
      const key = sides[side];
      const ids = value[key].conditions;
      return `<fieldset><legend>${side} ${type}</legend>
        <p class="muted">${ids.length} selected for this side</p>
        <div class="starting-status-options">${[...new Set(options.map(row => row.group))].map(group => {
          const rows = options.filter(row => row.group === group);
          const open = group === 'Combat & magic' || group === 'Ailments' || rows.some(row => ids.includes(row.id));
          return `<details data-status-group ${open ? 'open' : ''}><summary>${esc(group)}</summary>${rows.map(row => {
            const selected = ids.includes(row.id);
            const conflict = ids.find(id => row.conflicts.includes(id));
            const reason = conflict === undefined ? '' : `Replaces or blocks ${byId.get(conflict)?.name ?? conflict}.`;
            return `<label data-condition="${row.id}"><input type="checkbox" data-status="${key}-${row.id}" ${checked(selected)} ${locked(disabled || !selected && conflict !== undefined)}>
              <span><b>${esc(row.name)}</b><small>${esc(row.help)}${row.untimed ? ' Uses native consumption and removal rules.' : ''}</small>${reason && !selected ? `<small>${esc(reason)}</small>` : ''}</span></label>`;
          }).join('')}</details>`;
        }).join('')}</div></fieldset>`;
    }).join('')}</div>
    ${hardMode ? `<fieldset class="starting-status-rules"><legend>Rules for both tabs</legend>
      ${Object.entries(sides).map(([side, key]) => `<label><input type="checkbox" data-status="${key}-persistent" ${checked(value[key].persistent)} ${locked(disabled)}> Keep timed ${side.toLowerCase()} starting statuses from expiring naturally</label>`).join('')}
      <label><input type="checkbox" data-status="cure" ${checked(value.startingStatusAllowCure)} ${locked(disabled)}> Allow cures for persistent starting statuses</label>
      <p class="hint">These rules protect persistent timers. Single-use and other untimed effects keep the game’s native consumption and removal rules. Ordinary statuses and timed loadouts can still be cured.</p></fieldset>` :
      '<p class="hint">Set duration and cure rules for both sides under Hard Mode → Starting statuses.</p>'}`;
  const parent = section.parentElement;
  const search = section.querySelector('[data-status-search]');
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    for (const label of section.querySelectorAll('[data-condition]')) {
      const row = byId.get(Number(label.dataset.condition));
      label.hidden = !`${row.name} ${row.help}`.toLowerCase().includes(query);
    }
    for (const group of section.querySelectorAll('[data-status-group]')) {
      group.hidden = [...group.querySelectorAll('[data-condition]')].every(label => label.hidden);
      if (query && !group.hidden) group.open = true;
    }
  };
  for (const input of section.querySelectorAll('input[data-status]')) input.onchange = () => {
    if (input.disabled) return;
    const field = input.dataset.status;
    if (field === 'cure') value.startingStatusAllowCure = input.checked;
    else {
      const [key, choice] = field.split('-');
      const row = value[key];
      if (choice === 'persistent') value[key] = { ...row, persistent: input.checked };
      else {
        const id = Number(choice);
        const conditions = input.checked ? [...row.conditions, id].sort((a, b) => a - b) : row.conditions.filter(item => item !== id);
        value[key] = { ...row, conditions };
      }
    }
    const query = search.value;
    onChange();
    const nextSearch = parent?.querySelector('[data-status-search]');
    if (nextSearch) {
      nextSearch.value = query;
      nextSearch.oninput();
    }
    parent?.querySelector(`[data-status="${field}"]`)?.focus({ preventScroll: true });
  };
}

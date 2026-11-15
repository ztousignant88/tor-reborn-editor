import {autoTables, applyAutoEquipment} from '../game/autoloadouts.js';
import {enemyPoolRow, enemyPoolOptions} from '../game/enemy_equipment_pool.js';
import {touchBattleData} from '../game/battledata.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

export function renderEquipmentPool(detail, ed, onChange, poolView, onViewChange) {
  const {equipment} = autoTables(ed.dat);
  const mods = ed.menuMods;
  const settings = mods?.value ?? {};
  const overrides = settings.enemyEquipmentOverrides ?? {};
  const supportsEnemy = !!mods?.info.project && mods.info.hardModeVersion >= 8 && !mods.saved?.error;
  const enabledPreset = enemyPoolOptions.some(key => settings[key]);
  const enemyDefault = supportsEnemy && (poolView ? poolView === 'enemy' : enabledPreset || Object.keys(overrides).length);
  const base = new Map();
  const names = new Map();
  for (let id = 1; id < equipment.count && id < 889; ++id) {
    const row = equipment.row(id);
    const name = ed.name('armament', id);
    if (name) base.set(id, {allowed: row[14] === 0, level: row[96]});
    if (row[2] > 0 && row[2] <= 29 && name) names.set(id, name);
  }
  const draft = structuredClone(overrides);
  const writable = !ed.ctx.readOnly?.();
  detail.innerHTML = `<h1>Automatic equipment pool</h1>
    ${supportsEnemy ? `<label>Pool <select data-pool-view aria-label="Equipment pool">
      <option value="enemy" ${enemyDefault?'selected':''}>Enemy pool</option>
      <option value="base" ${enemyDefault?'':'selected'}>Base game pool</option>
    </select></label>` : ''}
    <p class="hint" data-pool-help></p>
    <button data-permissions class="ghost" type="button">Open equipment permissions</button>
    <fieldset class="others-settings" ${writable?'':'disabled'}>
      <label>Find equipment <input data-search type="search" aria-label="Find automatic equipment" placeholder="Search equipment…"></label>
      <label data-filter-label>Show <select data-pool-filter><option value="all">All equipment</option>
        <option value="eligible">Eligible only</option><option value="changed">Changed by presets or overrides</option></select></label>
      <div class="auto-equipment-head"><span>Equipment</span><span>Allow auto</span><span>Minimum level</span></div>
      <div data-equipment></div>
      <p data-error class="error" role="alert"></p>
      <button data-apply type="button">Apply equipment pool</button>
      <button data-reset class="ghost" type="button">Reset pending changes</button>
    </fieldset>`;
  const query = selector => detail.querySelector(selector);
  const enemyView = () => query('[data-pool-view]')?.value === 'enemy';
  const setOverride = (id, field, value) => {
    const row = draft[id] ??= {};
    row[field] = value;
  };
  function draw() {
    const enemy = enemyView();
    const search = query('[data-search]').value.trim().toLowerCase();
    const filter = query('[data-pool-filter]').value;
    const host = query('[data-equipment]');
    query('[data-filter-label]').hidden = !enemy;
    query('[data-pool-help]').textContent = enemy
      ? 'Shows the current Hard Mode presets and your project overrides. Class and slot restrictions still apply. To unlock an item excluded at level 255 in the base table, change its level in Base game pool first.'
      : 'Set availability and minimum levels in the shared game table. Level 255 excludes an item.';
    host.replaceChildren();
    const rows = enemy ? names : new Map([...base].map(([id]) => [id, ed.name('armament', id)]));
    for (const [id, name] of rows) {
      if (search && !`${name} #${id}`.toLowerCase().includes(search)) continue;
      const override = draft[id];
      const row = enemy ? enemyPoolRow(equipment.row(id), id, settings, override) : base.get(id);
      if (!row || enemy && (filter === 'eligible' && !row.allowed || filter === 'changed' && !row.preset && !override)) continue;
      const label = row.locked ? row.note ?? row.preset : override ? 'Project override' : row.preset;
      const element = document.createElement('div');
      element.className = 'auto-equipment-row';
      const disabled = row.locked || (enemy && id >= 761 && !settings.modPreparation);
      element.innerHTML = `<span>${esc(name)} <small class="muted">#${id}${enemy && label ? ' · '+esc(label) : ''}</small>
        ${enemy && !disabled ? `<button type="button" class="ghost" data-clear ${override?'':'hidden'}>Use preset</button>` : ''}</span>
        <input data-allowed type="checkbox" aria-label="Auto equip ${esc(name)}" ${row.allowed?'checked':''} ${disabled?'disabled':''}>
        <input data-level type="number" min="0" max="255" aria-label="Minimum level for ${esc(name)}" value="${row.level}" ${disabled?'disabled':''}>`;
      const allowed = element.querySelector('[data-allowed]');
      const level = element.querySelector('[data-level]');
      const clear = element.querySelector('[data-clear]');
      const markOverride = () => {
        element.querySelector('small').textContent = `#${id} · Project override`;
        clear.hidden = false;
      };
      allowed.onchange = () => {
        if (!enemy) { row.allowed = allowed.checked; return; }
        setOverride(id, 'allowed', allowed.checked);
        if (allowed.checked && Number(level.value) === 255) {
          setOverride(id, 'level', 1);
          level.value = '1';
        }
        markOverride();
      };
      level.onchange = () => {
        const next = level.valueAsNumber;
        if (!Number.isInteger(next) || next < 0 || next > 255) {
          level.value = String(row.level);
          query('[data-error]').textContent = 'Enter a whole level between 0 and 255.';
          return;
        }
        query('[data-error]').textContent = '';
        if (enemy) {
          setOverride(id, 'level', next);
          if (next === 255) allowed.checked = false;
          else allowed.checked = enemyPoolRow(equipment.row(id), id, settings, draft[id]).allowed;
          markOverride();
        } else {
          row.level = next;
        }
      };
      if (clear) clear.onclick = () => { delete draft[id]; draw(); };
      host.append(element);
    }
    if (!host.childElementCount) host.textContent = 'No matching equipment.';
  }
  query('[data-permissions]').onclick = () => ed.openOtherCategory(3001);
  query('[data-search]').oninput = draw;
  query('[data-pool-filter]').onchange = draw;
  const view = query('[data-pool-view]');
  if (view) view.onchange = () => { onViewChange(view.value); draw(); };
  query('[data-reset]').onclick = () => renderEquipmentPool(detail, ed, onChange, view?.value, onViewChange);
  query('[data-apply]').onclick = () => {
    if (!writable) return;
    try {
      if (enemyView()) {
        mods.value.enemyEquipmentOverrides = draft;
        onViewChange('enemy');
        onChange();
        ed.ctx.toast('Enemy equipment pool updated. Save the project to keep your overrides.');
      } else if (applyAutoEquipment(ed.dat, base)) {
        touchBattleData();
        onChange();
        ed.ctx.toast('Automatic equipment pool updated. Use Save to write it.');
      }
    } catch (error) {
      query('[data-error]').textContent = error.message;
    }
  };
  draw();
}

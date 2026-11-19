import { FORMULA_DOMAINS, formulaReferences, formulaTable, formulaValue, setFormulaValue } from '../game/formulas.js';
import { touchBattleData } from '../game/battledata.js';

export const FORMULA_CATEGORY = 32000;
const SLOTS_PER_DOMAIN = 256;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const descriptions = {
  hp_damage: 'Tune how equipment, stats, action power, and situational modifiers contribute to HP damage.',
  hit_rate: 'Tune the stats and modifiers used by calculated accuracy checks. An ability can also use a separate chance setting.',
  hp_restore: 'Tune how the healer, target, equipment, and situational modifiers contribute to HP recovery.',
};

export class FormulaEditor {
  constructor(editor) {
    this.editor = editor;
    this.schemas = new Map();
  }

  schema(domain) {
    if (!this.schemas.has(domain.key)) {
      this.schemas.set(domain.key, fetch(`data/schemas/formula_${domain.key}.json`).then(response => {
        if (!response.ok) throw new Error(`Could not load the ${domain.label} field definitions.`);
        return response.json();
      }).catch(error => {
        this.schemas.delete(domain.key);
        throw error;
      }));
    }
    return this.schemas.get(domain.key);
  }

  profileName(domain, id) {
    if (domain.key === 'hp_restore' && id === 1) return 'Standard healing';
    const field = this.editor.schemas.armament.groups.flatMap(group => group.fields).find(field => field.key === domain.selector);
    const label = field?.options?.find(([option]) => option === id)?.[1];
    return label && !label.startsWith('<') ? label : `Profile ${id}`;
  }

  renderList(list, selected, filter, onSelect) {
    const domainIndex = Math.floor(selected / SLOTS_PER_DOMAIN);
    const domain = FORMULA_DOMAINS[domainIndex];
    if (!domain) return;
    const nav = document.createElement('div');
    nav.className = 'ai-subnav formula-nav';
    for (const [index, category] of FORMULA_DOMAINS.entries()) {
      const button = document.createElement('button');
      button.className = 'ghost';
      button.textContent = category.label;
      button.setAttribute('aria-pressed', String(index === domainIndex));
      button.onclick = () => this.editor.openOtherCategory(FORMULA_CATEGORY + index * SLOTS_PER_DOMAIN);
      nav.append(button);
    }
    list.append(nav);
    try {
      const table = formulaTable(this.editor.dat, domain);
      const references = formulaReferences(this.editor.dat, domain);
      const query = filter.trim().toLowerCase();
      for (let id = 1; id + 1 < Math.min(table.count, SLOTS_PER_DOMAIN); id += 2) {
        const name = this.profileName(domain, id);
        if (query && !`${name} #${id}`.toLowerCase().includes(query)) continue;
        const local = domainIndex * SLOTS_PER_DOMAIN + id;
        const uses = references.get(id)?.length ?? 0;
        const button = document.createElement('button');
        button.className = `data-item others-entry${local === selected ? ' active' : ''}`;
        button.dataset.index = String(FORMULA_CATEGORY + local);
        button.innerHTML = `<span class="data-name">${esc(name)}<small class="muted formula-link-count">${uses} ${uses === 1 ? 'reference' : 'references'}</small></span><span class="picker-id">#${id}</span>`;
        button.onclick = () => onSelect(local);
        list.append(button);
      }
    } catch (error) {
      const warning = document.createElement('p');
      warning.className = 'hint warn';
      warning.textContent = error.message;
      list.append(warning);
    }
  }

  async renderDetail(detail, selected) {
    const domain = FORMULA_DOMAINS[Math.floor(selected / SLOTS_PER_DOMAIN)];
    const id = selected % SLOTS_PER_DOMAIN;
    const editor = this.editor;
    if (!domain || id === 0) {
      detail.innerHTML = `<h1>${domain?.label ?? 'Formulas'}</h1><p>${domain ? descriptions[domain.key] : ''}</p><p class="muted">Choose a formula profile on the left. Each profile shows the current project weights and their stock values.</p>`;
      return;
    }
    detail.textContent = 'Loading formula weights…';
    try {
      const schema = await this.schema(domain);
      if (editor.kind.key !== 'others' || editor.selected !== FORMULA_CATEGORY + selected) return;
      const table = formulaTable(editor.dat, domain);
      if (schema.rowSize !== table.rowSize || id % 2 !== 1 || id + 1 >= table.count) throw new Error('Select a compatible formula profile.');
      const items = formulaReferences(editor.dat, domain).get(id) ?? [];
      detail.innerHTML = `<div class="data-head"><div><h1>${esc(this.profileName(domain, id))}</h1><p class="muted">${domain.label} · Profile #${id}</p></div></div>
        <p>${descriptions[domain.key]}</p>
        <p class="hint">Weights apply to all actions using this profile. ${domain.key === 'hp_damage' ? 'For core damage weights, 100 represents a 1× coefficient. ' : ''}Valid edits are included in the next Save. Stock values are from clean PC game data.</p>
        <details class="formula-references" open><summary>Used by · ${items.length} direct ${items.length === 1 ? 'reference' : 'references'}</summary><div data-formula-references></div></details>
        <p data-formula-error class="error" role="alert" hidden></p><div data-formula-weights></div>`;
      this.renderReferences(detail.querySelector('[data-formula-references]'), items);
      const weights = detail.querySelector('[data-formula-weights]');
      for (const [index, group] of schema.groups.entries()) {
        this.renderWeights(weights, group, index === 0, domain, table, id, detail.querySelector('[data-formula-error]'));
      }
    } catch (error) {
      if (editor.kind.key === 'others' && editor.selected === FORMULA_CATEGORY + selected) detail.textContent = error.message;
    }
  }

  renderReferences(host, items) {
    if (!items.length) {
      host.textContent = 'No equipment or effect records currently select this profile directly.';
      return;
    }
    const prompt = document.createElement('p');
    prompt.className = 'muted';
    prompt.textContent = 'Select a reference to open its Equipment or Spells & Abilities record.';
    const list = document.createElement('ul');
    const skills = this.editor.skillRecords().linked;
    const references = items.map(reference => {
      const { kind, id } = reference;
      const name = this.editor.name(kind, id) || skills.get(id)?.find(skill => skill.name)?.name ||
        `${kind === 'armament' ? 'Equipment' : 'Effect'} ${id}`;
      return { ...reference, name };
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    for (const { kind, id, name, operation, active } of references) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link';
      button.textContent = name;
      button.onclick = () => this.editor.openPanel(kind, id);
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = ` #${id}${operation ? ` · Operation ${operation}` : ' · Equipment'}${active ? '' : ' · Stored selector, bypassed by current mode'}`;
      item.append(button, meta);
      list.append(item);
    }
    host.append(prompt, list);
  }

  renderWeights(host, group, open, domain, table, id, error) {
    const section = document.createElement('details');
    section.className = 'formula-weight-group';
    section.open = open;
    section.innerHTML = `<summary>${esc(group.label)}</summary><table class="formula-weights">
      <thead><tr><th scope="col">Weight</th>${domain.sides.map((side, index) => `<th scope="col">${side} · row ${id + index}</th>`).join('')}</tr></thead><tbody></tbody></table>`;
    const body = section.querySelector('tbody');
    const readOnly = this.editor.ctx.readOnly?.();
    for (const field of group.fields) {
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = field.label;
      row.append(label);
      domain.sides.forEach((side, index) => {
        const key = id + index;
        const cell = document.createElement('td');
        const stock = document.createElement('small');
        stock.className = 'muted';
        stock.textContent = field.stock[key] === undefined ? 'Stock —' : `Stock ${field.stock[key]}`;
        const current = formulaValue(table.row(key), field);
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '1';
        input.min = field.type === 'int' ? '-32768' : '0';
        input.max = field.type === 'int' ? '32767' : '65535';
        input.value = String(current);
        input.readOnly = readOnly || !field.editable;
        input.setAttribute('aria-label', `${side} ${group.label} ${field.label}`);
        input.oninput = () => {
          if (input.readOnly) return;
          try {
            if (setFormulaValue(table, key, field, input.valueAsNumber)) {
              touchBattleData();
              this.editor.ctx.onChange();
            }
            input.removeAttribute('aria-invalid');
            error.hidden = true;
          } catch (problem) {
            input.setAttribute('aria-invalid', 'true');
            error.hidden = false;
            error.textContent = problem.message;
          }
        };
        cell.append(input, stock);
        row.append(cell);
      });
      body.append(row);
    }
    host.append(section);
  }
}

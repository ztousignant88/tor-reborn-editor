import { isXlce, parseXlce, view } from '../lib/pakd.js';

export const FORMULA_DOMAINS = [
  { key: 'hp_damage', entry: 19, size: 260, label: 'HP Damage', selector: 'damage_scaling', process: 1,
    sides: ['Attacker', 'Defender'] },
  { key: 'hit_rate', entry: 18, size: 252, label: 'Accuracy', selector: 'accuracy',
    sides: ['Attacker', 'Defender'] },
  { key: 'hp_restore', entry: 20, size: 268, label: 'HP Healing', process: 2,
    sides: ['Healer', 'Recipient'] },
  { key: 'mp_damage', entry: 21, size: 276, label: 'MP Damage', process: 4,
    sides: ['Caster', 'Target'] },
];

const OPERATIONS = [0x2a, 0x44, 0x5e];

export function formulaTable(dat, domain) {
  const bytes = dat.pakd.entries[domain.entry]?.data;
  const table = bytes && isXlce(bytes) ? parseXlce(bytes) : null;
  if (!table || table.rowSize !== domain.size || table.count < 3 || table.row(table.count - 1).length !== domain.size) {
    throw new Error(`${domain.label} has an unsupported table layout.`);
  }
  return table;
}

/** Index direct selectors in the live project, including newly added equipment and effects. */
export function formulaReferences(dat, domain) {
  const references = new Map();
  const add = (id, reference) => {
    if (!id) return;
    if (!references.has(id)) references.set(id, []);
    references.get(id).push(reference);
  };
  if (domain.selector) {
    const equipment = parseXlce(dat.pakd.entries[11].data);
    const offset = domain.entry === 18 ? 0x11 : 0x12;
    for (let id = 1; id < equipment.count; id++) {
      add(equipment.row(id)[offset], { kind: 'armament', id, active: true });
    }
  }
  const effects = parseXlce(dat.pakd.entries[16].data);
  for (let id = 1; id < effects.count; id++) {
    const row = effects.row(id);
    if (!row[2]) continue;
    OPERATIONS.forEach((base, index) => {
      const process = row[base];
      if (!process) return;
      if (domain.entry === 18) {
        const mode = row[base + 5];
        add(row[base + 7], { kind: 'effect', id, operation: index + 1, active: mode === 0 || mode === 1 });
      } else if (process === domain.process) {
        add(row[base + 9], { kind: 'effect', id, operation: index + 1, active: row[base + 8] === 3 });
      }
    });
  }
  return references;
}

export function formulaValue(row, field) {
  const bytes = view(row);
  return field.type === 'int' ? bytes.getInt16(field.offset, true) : bytes.getUint16(field.offset, true);
}

export function setFormulaValue(table, id, field, value) {
  if (!Number.isInteger(id) || id < 1 || id >= table.count || !field.editable ||
      field.sides && !field.sides.includes((id - 1) % 2) ||
      field.size !== 2 || field.offset < 0 || field.offset + 2 > table.rowSize) {
    throw new Error('This formula field cannot be edited.');
  }
  const [min, max] = field.type === 'int' ? [-32768, 32767] : [0, 65535];
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Enter a whole number from ${min} to ${max}.`);
  }
  const row = table.row(id);
  if (formulaValue(row, field) === value) return false;
  const bytes = view(row);
  if (field.type === 'int') bytes.setInt16(field.offset, value, true);
  else bytes.setUint16(field.offset, value, true);
  return true;
}

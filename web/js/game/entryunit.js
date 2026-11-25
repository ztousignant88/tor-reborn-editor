// battle/entry/entry_unit_*.dat: pakd entry 0 is an xlce table of 196-byte
// unit records. Layout from Gibbed's battle_entry_unit.sheet.toml (zlib),
// with team/facing/element meanings from the tactics-ogre-tool modules and
// positions verified against the Golyat battle.

import { ALIGNMENTS, CLANS, ELEMENTS, FACING, TEAMS } from './tables.js';

export const UNIT_ROW_SIZE = 196;
export const LARGEST_STOCK_BATTLE = 30; // most units in any story battle's file
export const STOCK_LOADOUT_SLOTS = 4;
export const EXPANDED_LOADOUT_SLOTS = 8;

// The Steam battle loader only reads skills 1–4. Store the extra skills in
// records 5–8 and use records 9–10 for four tagged 12-bit spell effect IDs.
// Keep these offsets and tags in sync with expanded_loadout_entry.c.
const EXTRA_SKILL_AT = 0x32;
const EXTRA_SPELL_AT = 0x42;
const SPELL_TAGS = [0xd000, 0xe000, 0xf000, 0xc000];
const SPELL_ID_MASK = 0x0fff;

export function hasExpandedLoadout(row) {
  return SPELL_TAGS.every((tag, slot) => (row[EXTRA_SPELL_AT + 2 * slot + 1] & 0xf0) === tag >>> 8);
}

export function canExpandLoadout(row) {
  return hasExpandedLoadout(row) || !row.subarray(EXTRA_SKILL_AT, 0x4a).some(Boolean);
}

const align16 = (n) => (n + 15) & ~15;

/**
 * An entry_unit pack holds two tables, one entry per unit:
 *   0: xlce table of 196-byte unit records, padded to align16(len + 1)
 *   1: u32 count, 12 zero bytes, then per unit a u32 pair
 *      [actor sprite set, unit sprite file] (the graphics the battle preloads),
 *      padded to align16(len + 16)
 * Layout verified by rebuilding all 538 stock files byte for byte.
 */
export function parseEntryPack(pakd) {
  const [unitsEntry, spritesEntry] = pakd.entries;
  if (pakd.count !== 2 || !unitsEntry || !spritesEntry) throw new Error('expected 2 tables');
  const units = new DataView(unitsEntry.data.buffer, unitsEntry.data.byteOffset, unitsEntry.data.byteLength);
  const sprites = new DataView(spritesEntry.data.buffer, spritesEntry.data.byteOffset, spritesEntry.data.byteLength);
  const count = units.getUint32(4, true);
  if (units.getUint32(12, true) !== UNIT_ROW_SIZE) throw new Error('not a unit table');
  if (sprites.getUint32(0, true) !== count) throw new Error('sprite table count does not match unit count');
  const headerSize = units.getUint32(8, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    const row = unitsEntry.data.slice(headerSize + i * UNIT_ROW_SIZE, headerSize + (i + 1) * UNIT_ROW_SIZE);
    const sprite = [sprites.getUint32(16 + i * 8, true), sprites.getUint32(20 + i * 8, true)];
    out.push({ row, sprite, orig: { row: row.slice(), sprite: [...sprite] } });
  }
  return out;
}

export function buildEntryPack(units) {
  const n = units.length;
  const unitsLen = align16(16 + UNIT_ROW_SIZE * n + 1);
  const spritesLen = align16(16 + 8 * n + 16);
  const out = new Uint8Array(0x20 + unitsLen + spritesLen);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x646B6170, true); // 'pakd'
  v.setUint32(4, 2, true);
  v.setUint32(8, 0x20, true);
  v.setUint32(12, 0x20 + unitsLen, true);
  v.setUint32(16, 0x20 + unitsLen + spritesLen, true);
  const u = 0x20;
  v.setUint32(u, 0x65636C78, true); // 'xlce'
  v.setUint32(u + 4, n, true);
  v.setUint32(u + 8, 16, true);
  v.setUint32(u + 12, UNIT_ROW_SIZE, true);
  units.forEach((unit, i) => out.set(unit.row, u + 16 + i * UNIT_ROW_SIZE));
  const s = 0x20 + unitsLen;
  v.setUint32(s, n, true);
  units.forEach((unit, i) => {
    v.setUint32(s + 16 + i * 8, unit.sprite[0], true);
    v.setUint32(s + 20 + i * 8, unit.sprite[1], true);
  });
  return out;
}

// kind: u8 | i8 | u16 | bool. `list` names a GameTables list or a fixed enum.
const f = (key, label, offset, kind, extra = {}) => ({ key, label, offset, kind, ...extra });

function repeat(prefix, label, base, count, stride, parts) {
  const out = [];
  for (let i = 0; i < count; i++) {
    for (const p of parts) {
      out.push(f(`${prefix}${i}_${p.key}`, `${label} ${i + 1} ${p.label}`.trim(), base + i * stride + p.offset, p.kind,
        { ...p.extra, slot: i, part: p.key, group: prefix }));
    }
  }
  return out;
}

const enumList = (labels) => labels.map((name, id) => ({ id, name }));

export const FIELDS = [
  f('name', 'Unit name', 0x00, 'u16', { list: 'unitName', hint: '0 = generic soldier' }),
  f('template', 'Unit template', 0x02, 'u16', { hint: 'Base stats, gender and sprite come from this template' }),
  f('event', 'Event ID', 0x04, 'u8'),
  f('randomName', 'Random name set', 0x05, 'u8'),
  f('class', 'Class', 0x06, 'u8', { list: 'class' }),
  f('levelBase', 'Level (base)', 0x08, 'u8'),
  f('levelMod', 'Level (modifier)', 0x09, 'u8'),
  f('x', 'X', 0x0A, 'i8'),
  f('z', 'Y', 0x0B, 'i8'),
  f('facing', 'Facing', 0x0C, 'u8', { list: enumList(FACING) }),
  // 1 on nearly every unit in a battle file, 0 in recruit files (entry_unit_001)
  // and on units the story brings in later: a 0 here keeps the unit off the field.
  f('appears', 'On the field', 0x0D, 'u8', {
    list: enumList(['No (story adds it)', 'At battle start', 'Mode 2 (most generic enemies)']),
    hint: 'No = the unit never appears unless the story adds it',
  }),
  f('appearValue', 'Mode 2 value', 0x0E, 'u8', { hint: 'Used with mode 2 (20-154 in stock battles); meaning unknown' }),
  f('team', 'Team', 0x10, 'u8', { list: Object.entries(TEAMS).map(([id, name]) => ({ id: Number(id), name })) }),
  f('guest', 'Guest', 0x11, 'bool'),
  f('leader', 'Leader', 0x12, 'bool'),
  f('target', 'Defeat target', 0x13, 'bool'),
  f('subtarget', 'Sub-target', 0x1F, 'bool'),
  f('zombie', 'Undead', 0x1E, 'bool'),
  f('alignment', 'Alignment', 0x14, 'u8', { list: enumList(ALIGNMENTS) }),
  f('loyalty', 'Loyalty', 0x15, 'u8'),
  f('clan', 'Clan', 0x16, 'u8', { list: enumList(CLANS) }),
  f('union', 'Union', 0x17, 'u8'),
  f('element', 'Element', 0x98, 'u8', { list: enumList(ELEMENTS) }),
  f('ai', 'AI behaviour', 0x94, 'u8', { list: 'ai', hint: 'Row of the AI table (battle data entry 27): which weights the unit\'s AI uses for damage, healing, buffs, ailments and positioning. 0 = the player controls it.' }),
  f('scream', 'Scream voice', 0x99, 'u8', { hint: '0 = use template voice' }),
  f('noPersuade', 'Cannot be persuaded', 0x9A, 'bool'),
  f('autoEquipment', 'Auto equipment', 0x1C, 'u8', { hint: '0 = off; nonzero fills eligible empty equipment slots. Equipment ID 999 blocks an automatic slot.' }),
  f('autoSpellProfile', 'Auto spell profile', 0x1B, 'u8', { hint: '0 = off; nonzero selects this class’s spell profile from Stats & Values → Auto Loadouts.' }),
  f('autoFinishers', 'Auto finishers', 0xAC, 'u8', { hint: 'Non-zero: finishers picked from equipment' }),
  ...repeat('arms', 'Equipment', 0x4A, 7, 4, [
    { key: 'id', label: '', offset: 0, kind: 'u16', extra: { list: 'arms' } },
    { key: 'drop', label: 'drop %', offset: 2, kind: 'u8' },
  ]),
  ...repeat('item', 'Item', 0x66, 4, 4, [
    { key: 'id', label: '', offset: 0, kind: 'u16', extra: { list: 'commodity' } },
    { key: 'drop', label: 'drop %', offset: 2, kind: 'u8' },
  ]),
  ...repeat('drop', 'Drop', 0x76, 4, 4, [
    { key: 'id', label: '', offset: 0, kind: 'u16', extra: { list: 'item' } },
    { key: 'qty', label: 'qty', offset: 2, kind: 'u8' },
    { key: 'chance', label: 'chance %', offset: 3, kind: 'u8' },
  ]),
  ...repeat('skill', 'Skill', 0x22, EXPANDED_LOADOUT_SLOTS, 4, [
    { key: 'id', label: '', offset: 0, kind: 'u16', extra: { list: 'skill' } },
    { key: 'rank', label: 'rank', offset: 2, kind: 'u16' },
  ]),
  ...repeat('spell', 'Spell', 0x86, 4, 2, [
    { key: 'id', label: '', offset: 0, kind: 'u16', extra: { list: 'spell' } },
  ]),
  ...SPELL_TAGS.map((tag, slot) => f(`spell${slot + 4}_id`, `Spell ${slot + 5}`, EXTRA_SPELL_AT + 2 * slot,
    'u16', { list: 'spell', slot: slot + 4, part: 'id', group: 'spell', tag })),
  ...repeat('finisher', 'Finisher', 0x9C, 8, 2, [
    { key: 'id', label: '', offset: 0, kind: 'u16', extra: { list: 'finisher' } },
  ]),
  ...repeat('card', 'Buff card', 0xAD, 4, 1, [
    { key: 'id', label: '', offset: 0, kind: 'u8' },
  ]),
];

export const FIELD = Object.fromEntries(FIELDS.map((fd) => [fd.key, fd]));

// Bytes not covered by FIELDS are shown raw so nothing is hidden from modders.
export const UNKNOWN_BYTES = (() => {
  const covered = new Set();
  const width = { u8: 1, i8: 1, bool: 1, u16: 2 };
  for (const fd of FIELDS) for (let i = 0; i < width[fd.kind]; i++) covered.add(fd.offset + i);
  return Array.from({ length: UNIT_ROW_SIZE }, (_, i) => i).filter((i) => !covered.has(i));
})();

export function readField(row, fd) {
  if (isExpandedLoadoutField(fd) && !hasExpandedLoadout(row)) return 0;
  const v = new DataView(row.buffer, row.byteOffset, row.byteLength);
  switch (fd.kind) {
    case 'u8': return v.getUint8(fd.offset);
    case 'i8': return v.getInt8(fd.offset);
    case 'bool': return v.getUint8(fd.offset) !== 0;
    case 'u16': return v.getUint16(fd.offset, true) & (fd.tag ? SPELL_ID_MASK : 0xffff);
    default: throw new Error(fd.kind);
  }
}

/** Bytes a field write would produce (used for undoable byte patches). */
export function encodeField(fd, value) {
  switch (fd.kind) {
    case 'u8': return new Uint8Array([clamp(value, 0, 255)]);
    case 'i8': return new Uint8Array([clamp(value, -128, 127) & 0xFF]);
    case 'bool': return new Uint8Array([value ? 1 : 0]);
    case 'u16': {
      if (fd.tag && Number(value) > SPELL_ID_MASK) throw new Error('This slot supports spell effect IDs through 4095.');
      const n = clamp(value, 0, fd.tag ? SPELL_ID_MASK : 0xffff) | (fd.tag ?? 0);
      return new Uint8Array([n & 0xff, n >> 8]);
    }
    default: throw new Error(fd.kind);
  }
}

function isExpandedLoadoutField(fd) {
  return fd.slot >= STOCK_LOADOUT_SLOTS && (fd.group === 'spell' || fd.group === 'skill');
}

export function initializeBattleLoadout() {
  const bytes = new Uint8Array(0x4a - EXTRA_SKILL_AT);
  SPELL_TAGS.forEach((tag, slot) => { bytes[EXTRA_SPELL_AT - EXTRA_SKILL_AT + 2 * slot + 1] = tag >>> 8; });
  return { offset: EXTRA_SKILL_AT, bytes };
}

export function battleFieldPatch(row, fd, value) {
  const bytes = encodeField(fd, value);
  if (!isExpandedLoadoutField(fd)) return { offset: fd.offset, bytes };
  if (!canExpandLoadout(row)) throw new Error('This unit has existing data in the extra loadout fields.');
  if (hasExpandedLoadout(row)) return { offset: fd.offset, bytes };
  if (!Number(value)) return { offset: fd.offset, bytes: new Uint8Array(bytes.length) };
  const patch = initializeBattleLoadout();
  patch.bytes.set(bytes, fd.offset - patch.offset);
  return patch;
}

function clamp(value, lo, hi) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) throw new Error('not a number');
  return Math.min(hi, Math.max(lo, n));
}

export const isEmptySlot = (row) => readField(row, FIELD.template) === 0 && readField(row, FIELD.class) === 0;

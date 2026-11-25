// Unit editor panel: every field of the selected unit record, grouped.

import { FIELD, UNKNOWN_BYTES, readField, canExpandLoadout, initializeBattleLoadout, STOCK_LOADOUT_SLOTS, EXPANDED_LOADOUT_SLOTS } from '../game/entryunit.js';
import { displayHeight } from '../game/bgmap.js';
import { createPicker } from './picker.js';
import { abilityArt, itemOptionArt } from './iconart.js';
import { ARMS_AUTO } from '../game/tables.js';
import { settings } from '../app/settings.js';
import { attachHelp, battleFieldHelp } from '../app/fieldhelp.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
};

const RANGES = { u8: [0, 255], i8: [-128, 127], u16: [0, 65535] };

export class Inspector {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // { tables, apply(fd, value), applyRaw(offset, byte) }
    this.openGroups = new Set(['identity', 'placement', 'equipment']);
    this.optionArt = new WeakMap();
  }

  render(doc, slot, grid) {
    this.root.innerHTML = '';
    if (!doc || slot === null || slot === undefined) {
      this.root.append(h('div', { class: 'empty-state' },
        h('p', {}, 'Select a unit on the map or in the roster to edit it.'),
        h('p', { class: 'muted' }, 'Drag a unit on the map to move it to another tile.')));
      return;
    }
    this.doc = doc;
    this.slot = slot;
    const row = doc.row(slot);
    const wantsExpandedLoadout = this.ctx.expandedLoadout?.();
    const loadoutSlots = wantsExpandedLoadout && canExpandLoadout(row) ? EXPANDED_LOADOUT_SLOTS : STOCK_LOADOUT_SLOTS;
    const t = this.ctx.tables;
    const val = (key) => readField(row, FIELD[key]);
    const tpl = t.template(val('template'));
    const female = tpl?.female;
    const name = t.unitName(val('name')) || t.customCharacter(val('template'))?.name || 'Generic unit';
    const className = t.className(val('class'), female) || `Class #${val('class')}`;

    this.root.append(h('div', { class: 'insp-head' },
      h('div', { class: 'insp-title' }, name),
      h('div', { class: 'insp-sub' }, `${className} · slot ${slot} · ${doc.fileName}`)));

    const group = (id, title, ...content) => {
      const details = h('details', { class: 'group', open: this.openGroups.has(id) });
      details.addEventListener('toggle', () => (details.open ? this.openGroups.add(id) : this.openGroups.delete(id)));
      details.append(h('summary', {}, title), h('div', { class: 'group-body' }, ...content));
      return details;
    };

    const tile = grid?.tileAt(val('x'), val('z'));
    const tileInfo = !grid || grid.synthetic ? 'No map selected for this battle'
      : !tile ? 'Outside the map!'
        : `Tile height ${displayHeight(tile)} · surface #${tile.surface}${tile.object !== null ? ` · object #${tile.object} (blocked)` : ''}`;

    this.root.append(
      group('identity', 'Identity',
        this.field('name'), this.templateField(tpl), this.field('class'), this.spriteField(),
        h('div', { class: 'pair' }, this.field('levelBase'), this.field('levelMod')),
        h('p', { class: 'hint' }, 'Many later battles use base 0, so the game likely scales levels per battle. Exactly how base and modifier combine is not confirmed yet.'),
        h('div', { class: 'pair' }, this.field('randomName'), this.field('event'))),
      group('placement', 'Placement & role',
        h('div', { class: 'pair' }, this.field('x'), this.field('z')),
        h('p', { class: tile || !grid || grid.synthetic ? 'hint' : 'hint warn' }, tileInfo),
        h('div', { class: 'pair' }, this.field('facing'), this.field('team')),
        h('div', { class: 'pair' }, this.field('appears'), this.field('appearValue')),
        val('appears') === 0 ? h('p', { class: 'hint warn' }, 'Not on the field: this unit only appears if the story adds it.') : null,
        h('div', { class: 'checks' }, this.field('leader'), this.field('target'), this.field('subtarget'), this.field('guest'))),
      group('allegiance', 'Allegiance',
        h('div', { class: 'pair' }, this.field('alignment'), this.field('loyalty')),
        h('div', { class: 'pair' }, this.field('clan'), this.field('union')),
        h('div', { class: 'checks' }, this.field('zombie'), this.field('noPersuade'))),
      group('equipment', 'Equipment', this.field('autoEquipment'), this.slots('arms', 7, ['id', 'drop'])),
      group('items', 'Items & drops',
        h('div', { class: 'sub' }, 'Carried items'), this.slots('item', 4, ['id', 'drop']),
        h('div', { class: 'sub' }, 'Drops on defeat'), this.slots('drop', 4, ['id', 'qty', 'chance'])),
      group('skills', 'Skills', this.slots('skill', loadoutSlots, ['id', 'rank']),
        wantsExpandedLoadout && loadoutSlots === STOCK_LOADOUT_SLOTS
          ? h('div', {},
            h('p', { class: 'hint warn' }, 'This unit has existing data in fields the battle loader skips. Initialize those fields to edit slots 5–8.'),
            h('button', { type: 'button', onclick: () => {
              if (confirm('Replace this unit’s reserved values with empty slots 5–8? You can undo this change before saving.')) {
                this.ctx.applyBlock(initializeBattleLoadout(), 'Initialize skill and spell slots 5–8');
              }
            } }, 'Initialize slots 5–8')) : null),
      group('magic', 'Spells & finishers',
        h('div', { class: 'sub' }, 'Spells'), this.field('autoSpellProfile'), this.slots('spell', loadoutSlots, ['id']),
        h('div', { class: 'sub' }, 'Finishers'), this.field('autoFinishers'), this.slots('finisher', 8, ['id'])),
      group('combat', 'Element & behaviour',
        h('div', { class: 'pair' }, this.field('element'), this.field('ai')),
        this.field('scream'),
        h('div', { class: 'sub' }, 'Buff cards'),
        h('div', { class: 'quad' }, [0, 1, 2, 3].map((i) => this.field(`card${i}_id`, `#${i + 1}`)))),
      settings.hideUnknown ? null : group('raw', 'Unknown bytes', this.rawBytes(row)),
    );
  }

  changedMark(fd) {
    return this.doc.isFieldChanged(this.slot, fd) ? h('span', { class: 'changed', title: 'Changed since load/save' }, '●') : null;
  }

  field(key, labelOverride) {
    const fd = FIELD[key];
    const row = this.doc.row(this.slot);
    const value = readField(row, fd);
    const label = labelOverride ?? fd.label;
    const help = battleFieldHelp(fd);
    const t = this.ctx.tables;
    let control;
    if (fd.kind === 'bool') {
      control = h('input', { type: 'checkbox', checked: value, onchange: (e) => this.ctx.apply(fd, e.target.checked) });
      attachHelp(control, help);
      return h('label', { class: 'check', title: help }, control, label, this.changedMark(fd));
    }
    if(key==='template'){
      control=createPicker({options:t.lists.template,value,onChange:v=>this.ctx.apply(fd,v)});
    } else if (key === 'autoSpellProfile') {
      const options = t.spellProfileOptions(readField(row, FIELD.class));
      control = createPicker({ options, value, onChange: (v) => this.ctx.apply(fd, v) });
    } else if (typeof fd.list === 'string') {
      control = createPicker({ options: key==='class'?t.classOptionsFor(readField(row,FIELD.template),value):t.lists[fd.list], value, onChange: (v) => this.ctx.apply(fd, v) });
    } else if (Array.isArray(fd.list)) {
      control = h('select', { onchange: (e) => this.ctx.apply(fd, Number(e.target.value)) });
      const known = fd.list.some((o) => o.id === value);
      for (const o of fd.list) control.append(h('option', { value: o.id, selected: o.id === value }, `${o.name}`));
      if (!known) control.append(h('option', { value, selected: true }, `Unknown (${value})`));
    } else {
      const [min, max] = RANGES[fd.kind];
      control = h('input', { type: 'number', min, max, value, onchange: (e) => this.ctx.apply(fd, e.target.value) });
    }
    attachHelp(control, help);
    return h('label', { class: 'field', title: help },
      h('span', { class: 'field-label' }, label, this.changedMark(fd)), control);
  }

  templateField(tpl) {
    const wrap = h('div', { class: 'template' }, this.field('template'));
    if (tpl) {
      const stats = [['HP', tpl.hp], ['MP', tpl.mp], ['STR', tpl.str], ['VIT', tpl.vit], ['DEX', tpl.dex], ['AGI', tpl.agi],
        ['AVD', tpl.avd], ['INT', tpl.int], ['MND', tpl.mnd], ['RES', tpl.res]];
      wrap.append(h('div', { class: 'stats', title: 'Base stats of this template, shared by every unit that uses it' },
        stats.map(([k, v]) => h('span', {}, h('b', {}, k), ` ${v}`)),
        h('span', { class: 'muted' }, tpl.female ? '♀' : '♂')));
    }
    return wrap;
  }

  /** Graphics the battle preloads for this unit; updated automatically on class/template changes. */
  spriteField() {
    const unit = this.doc.units[this.slot];
    const [actor, sprite] = unit.sprite;
    const variants = this.ctx.tables.spriteVariants(unit.row);
    const select = h('select', { onchange: (e) => this.ctx.setSprite([actor, Number(e.target.value)]) });
    variants.forEach((id, i) => select.append(h('option', { value: id, selected: id === sprite }, `Colour ${i + 1} (#${id})`)));
    if (!variants.includes(sprite)) select.append(h('option', { value: sprite, selected: true }, `Custom (#${sprite})`));
    const mark = this.doc.isSpriteChanged(this.slot) ? h('span', { class: 'changed', title: 'Changed since load/save' }, '●') : null;
    return h('label', { class: 'field', title: 'Sprite set and colour variant the battle loads for this unit. Set automatically when class or template changes.' },
      h('span', { class: 'field-label' }, `Graphics · sprite set #${actor}`, mark),
      h('div', { class: 'sprite-row' }, select));
  }

  slots(prefix, count, parts) {
    const rows = [];
    for (let i = 0; i < count; i++) {
      const cells = parts.map((p) => {
        const key = `${prefix}${i}_${p}`;
        const fd = FIELD[key];
        if (p === 'id') return this.bareControl(fd);
        return h('label', { class: 'mini', title: battleFieldHelp(fd) }, h('span', {}, fd.label.replace(/^.*?\d+\s*/, '')), this.bareControl(fd));
      });
      rows.push(h('div', { class: `slot-row cols-${parts.length}` }, h('span', { class: 'slot-n' }, String(i + 1)), cells));
    }
    return h('div', { class: 'slots' }, rows);
  }

  bareControl(fd) {
    const value = readField(this.doc.row(this.slot), fd);
    const mark = this.changedMark(fd);
    let control;
    if (typeof fd.list === 'string') {
      const tables = this.ctx.tables;
      const item = ['arms', 'item', 'commodity'].includes(fd.list);
      const kind = item ? 'item' : fd.list === 'skill' ? 'skill' : 'effect';
      const name = item ? tables.itemName(value) : kind === 'skill' ? tables.skillName(value) : tables.effectName(value);
      const withArt = (o) => !o.id || o.id === ARMS_AUTO && item ? o : { ...o, art: () => item
        ? itemOptionArt(tables, o.id, this.ctx.lang?.()) : abilityArt(kind, o.id, tables, this.ctx.lang?.()) };
      const catalog = tables.lists[fd.list];
      if (!this.optionArt.has(catalog)) this.optionArt.set(catalog, catalog.map(withArt));
      let options = this.optionArt.get(catalog);
      if (value && !options.some(({ id }) => id === value)) {
        options = [withArt({ id: value, name: name || `Stored ID ${value}`, group: 'Current assignment' }), ...options];
      }
      control = createPicker({ options, value, onChange: (v) => this.ctx.apply(fd, v) });
    } else {
      const [min, max] = RANGES[fd.kind];
      control = h('input', { type: 'number', min, max, value, onchange: (e) => this.ctx.apply(fd, e.target.value) });
    }
    attachHelp(control, battleFieldHelp(fd));
    return mark ? h('span', { class: 'with-mark', title: battleFieldHelp(fd) }, control, mark) : control;
  }

  rawBytes(row) {
    const cells = UNKNOWN_BYTES.map((offset) => h('label', { class: 'raw' },
      h('span', {}, `+${offset.toString(16).toUpperCase().padStart(2, '0')}`),
      h('input', {
        value: row[offset].toString(16).toUpperCase().padStart(2, '0'),
        maxlength: 2,
        onchange: (e) => {
          const v = parseInt(e.target.value, 16);
          if (Number.isNaN(v) || v < 0 || v > 255) { e.target.value = row[offset].toString(16).padStart(2, '0'); return; }
          this.ctx.applyRaw(offset, v);
        },
      })));
    return h('div', {},
      h('p', { class: 'hint' }, 'Bytes whose meaning is not known yet, shown in hex. Change with care and note what happens in game.'),
      h('div', { class: 'raw-grid' }, cells));
  }
}

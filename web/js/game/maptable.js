// The game's map list: Data/system/system_data.dat, pakd entry 5.
//   u32 size, u32 count (394), u32 header size (16), u32 ?; then 32-byte rows
//   [u16 map number, ..., byte 7: variant flags (0x40 = alternate version),
//    u64 file-name offset, u64 Japanese place-name offset] (offsets from the
//   string pool, which starts right after the rows).
// Story steps (chapter PGRS records) name their map by this number: e.g. map
// 1 = bg000_01 (Golyat port), 93 = bg206_01 (abandoned house in Golyat), the
// map of the opening cutscene and the scene after the first battle.

import { loadDat } from './datfile.js';
import { view } from '../lib/pakd.js';

let table = null;
export function forgetMapTable() { table = null; }

/** map number -> [{ id: 'bg206_01_c0_t00', name, variant }] (base version first). */
export function loadMapTable() {
  table ??= loadDat('system/system_data.dat').then((dat) => {
    const d = dat.pakd.entries[5].data;
    const v = view(d);
    const count = v.getUint32(4, true);
    const head = v.getUint32(8, true);
    const pool = head + count * 32;
    const cstr = (o) => { let e = pool + o; while (d[e]) e++; return new TextDecoder().decode(d.subarray(pool + o, e)); };
    const map = new Map();
    for (let i = 0; i < count; i++) {
      const at = head + i * 32;
      const number = v.getUint16(at, true);
      const file = cstr(Number(v.getBigUint64(at + 16, true)));
      const entry = { id: file.replace(/^bg\//, '').replace(/\.dat$/i, ''), name: cstr(Number(v.getBigUint64(at + 24, true))), variant: d[at + 7] };
      if (!map.has(number)) map.set(number, []);
      map.get(number).push(entry);
    }
    for (const list of map.values()) list.sort((a, b) => a.variant - b.variant);
    return map;
  }).catch((err) => {
    console.warn('map table:', err);
    return new Map();
  });
  return table;
}

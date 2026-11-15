// Copy project characters from another project into the open one, with new IDs.
//
// Characters made in separate projects take the next free sprite, appearance and
// character-sheet numbers *of that project*, so two projects can give different
// characters the same numbers. A project merge then sees them as the same
// character and keeps only one. This copies each character's art, portrait,
// actor row, character sheet, menu faces and menu portrait from the other project
// and gives them the next free numbers here (and a new file name if the name is
// taken), the same way Create new character does.

import {source} from './source.js';
import {readFileRegistry} from '../lib/filetable.js';
import {unpackArt,rebuildPakd,verifyArtCompression} from '../lib/artrebuild.js';
import {parsePakd,parseXlce,buildPakdWithIds,view} from '../lib/pakd.js';
import {zipSingle} from '../lib/zip.js';
import {encrypt} from '../lib/crypt.js';
import {sha256} from '../lib/artfiles.js';
import {renameObject,parseArc,buildArc,renameArcRecord} from './artregistry.js';

const enc = new TextEncoder();
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Append a copy of `donor` (one 24-byte actor row from another table) with a new id and name. */
function appendActorRow(table, donor, id, name) {
  const v = view(table), n = v.getUint32(4, true), head = v.getUint32(8, true), stride = v.getUint32(12, true);
  if (stride !== 24 || donor.length !== 24) throw new Error('Unexpected actor table layout');
  const out = new Uint8Array((table.length + stride + enc.encode(name + '\0').length + 15) & ~15), o = view(out), rowsEnd = head + n * stride;
  out.set(table.subarray(0, rowsEnd)); out.set(donor, rowsEnd); out.set(table.subarray(rowsEnd), rowsEnd + stride);
  for (let i = 0; i < n; i++) o.setBigUint64(head + i * stride, o.getBigUint64(head + i * stride, true) + BigInt(stride), true);
  o.setUint32(4, n + 1, true); o.setBigUint64(rowsEnd, BigInt(table.length + stride), true); o.setUint32(rowsEnd + 8, id, true);
  out.set(enc.encode(name + '\0'), table.length + stride);
  return out;
}

/** Append a copy of `row` (one 84-byte character sheet from another table) pointing at the new art. */
function appendTemplateRow(table, row, {actor, portrait, palette}) {
  const v = view(table), n = v.getUint32(4, true), head = v.getUint32(8, true), stride = v.getUint32(12, true);
  if (stride !== 84 || row.length !== 84) throw new Error('Unexpected character template layout');
  const out = new Uint8Array((head + (n + 1) * stride + 15) & ~15);
  out.set(table.subarray(0, head + n * stride)); out.set(row, head + n * stride); view(out).setUint32(4, n + 1, true);
  const r = out.subarray(head + n * stride, head + (n + 1) * stride), rv = view(r);
  rv.setUint16(0x3a, actor, true); r[0x3d] = palette; for (let at = 0x40; at <= 0x4c; at += 2) rv.setUint16(at, portrait, true);
  return {table: out, index: n};
}

/** Plan copying `characters` (project character records) from project `from` into the open project. */
export async function copyCharactersPlan({from, characters, progress = () => {}}) {
  if (!characters?.length) throw new Error('Choose at least one character to copy');
  const readFrom = (path) => source.readProjectFile(from, path);
  const made = new Map(), originals = new Map();
  // the open project's view of a file, with this plan's earlier changes on top
  const current = async (path) => {
    if (made.has(path)) return made.get(path);
    const bytes = (await source.read(path)).bytes;
    originals.set(path, bytes);
    return bytes;
  };
  const files = new Map(), registrations = [], added = [], notes = [];
  async function emit(path, pack, entryName) {
    verifyArtCompression(pack);
    const bytes = encrypt(await zipSingle(entryName, pack)), decoded = await unpackArt(bytes);
    if (!same(decoded.pack, pack)) throw new Error('Copied archive did not verify: ' + path);
    made.set(path, bytes);
    files.set(path, bytes);
    return bytes;
  }
  const otherBattle = await unpackArt(await readFrom('battle/battle_data_release.dat')), otherRoot = parsePakd(otherBattle.pack);
  const otherActors = otherRoot.entries[74].data, otherTemplates = parseXlce(otherRoot.entries[23].data);
  const otherUnitArc = parseArc(parsePakd((await unpackArt(await readFrom('menu/texture_x4/com_unit.dat'))).pack).entries[0].data);
  for (const c of characters) {
    progress(`Copying ${c.name}…`);
    const table = readFileRegistry(await current('FileTable.bin'));
    const taken = new Set([...table.map((e) => e.path.toLowerCase()), ...registrations.map((r) => r.path.toLowerCase())]);
    const next = (dir) => Math.max(0, ...table.filter((e) => e.directory === dir).map((e) => e.id), ...registrations.filter((r) => r.directory === dir).map((r) => r.id)) + 1;
    const actorID = next(20), appearance = next(30);
    if (actorID > 65535 || appearance > 65535) throw new Error('No unused character art IDs remain');
    let stem = c.stem, suffix = 0;
    while (taken.has(`object/${stem}.dat`.toLowerCase()) || taken.has(`object/${stem}00.dat`.toLowerCase())) {
      if (suffix >= 26) throw new Error(`Rename ${c.name}: no free file name`);
      stem = c.stem.slice(0, 17) + String.fromCharCode(65 + suffix++);
    }
    // art: the body and its 00 archive (sprite + portrait), renamed if the name was taken
    const body = await unpackArt(await readFrom(`object/${c.stem}.dat`)), unit = await unpackArt(await readFrom(`object/${c.stem}00.dat`));
    const unitRoot = parsePakd(unit.pack), portraitEntry = unitRoot.entries.find((e) => e.id === 0x10000 + c.appearance) ?? unitRoot.entries.find((e) => e.id >= 0x10000 && e.id < 0x20000);
    if (!portraitEntry) throw new Error(`${c.name} has no portrait resource`);
    const newBody = stem === c.stem ? body.pack : renameObject(body.pack, c.stem, stem), portrait = stem === c.stem ? portraitEntry.data : renameObject(portraitEntry.data, c.stem, stem);
    await emit(`object/${stem}.dat`, newBody, stem + '.pack');
    await emit(`object/${stem}00.dat`, buildPakdWithIds([{id: actorID, data: newBody}, {id: 0x10000 + appearance, data: portrait}]), unit.name);
    // character sheet and actor row, copied from the other project's battle data
    const av = view(otherActors), an = av.getUint32(4, true), ah = av.getUint32(8, true);
    let donor = null;
    for (let i = 0; i < an; i++) if (av.getUint32(ah + i * 24 + 8, true) === c.actor) donor = otherActors.slice(ah + i * 24, ah + (i + 1) * 24);
    if (!donor) throw new Error(`${c.name}'s sprite row is missing from ${from}`);
    if (c.template >= otherTemplates.count) throw new Error(`${c.name}'s character sheet is missing from ${from}`);
    const battle = await unpackArt(await current('battle/battle_data_release.dat')), root = parsePakd(battle.pack);
    const actors = appendActorRow(root.entries[74].data, donor, actorID, stem.toLowerCase());
    const {table: templates, index: template} = appendTemplateRow(root.entries[23].data, otherTemplates.row(c.template).slice(), {actor: actorID, portrait: appearance, palette: c.palette ?? 0});
    await emit('battle/battle_data_release.dat', rebuildPakd(battle.pack, new Map([[74, actors], [23, templates]])), battle.name);
    // menu faces and the full menu portrait
    const menu = await unpackArt(await current('menu/texture_x4/com_unit.dat')), menuRoot = parsePakd(menu.pack), arc = parseArc(menuRoot.entries[0].data);
    const prefix = `com_unit_face_${c.stem.toLowerCase()}_`, faces = otherUnitArc.records.filter((r) => r.name.toLowerCase().startsWith(prefix));
    if (!faces.length) notes.push(`${c.name}: the other project has no menu faces for it; none copied.`);
    const newPrefix = `com_unit_face_${stem.toLowerCase()}_`;
    arc.records = arc.records.filter((r) => !r.name.toLowerCase().startsWith(newPrefix));
    arc.records.push(...faces.map((r) => (stem === c.stem ? r : renameArcRecord(r, r.name.toLowerCase().replace(prefix, newPrefix)))));
    await emit('menu/texture_x4/com_unit.dat', rebuildPakd(menu.pack, new Map([[0, buildArc(arc)]])), menu.name);
    const portraits = await unpackArt(await current('menu/menu_classface.dat')), entries = parsePakd(portraits.pack).entries;
    if (entries.some((e) => e.id === appearance)) throw new Error('The next portrait ID is already in the menu archive');
    await emit('menu/menu_classface.dat', buildPakdWithIds([...entries.map((e) => ({id: e.id, data: e.data})), {id: appearance, data: portrait}]), portraits.name);
    registrations.push({directory: 20, id: actorID, path: `object/${stem}.dat`}, {directory: 30, id: appearance, path: `object/${stem}00.dat`});
    added.push({name: c.name, stem, template, actor: actorID, appearance, baseTemplate: c.baseTemplate ?? 0, classId: c.classId ?? 1, palette: c.palette ?? 0,
      copiedFrom: {project: from, stem: c.stem, template: c.template, actor: c.actor, appearance: c.appearance}});
    notes.push(`${c.name}: sprite ${c.actor} → ${actorID}, appearance ${c.appearance} → ${appearance}, character sheet ${c.template} → ${template}${stem === c.stem ? '' : `, files renamed ${c.stem} → ${stem}`}.`);
  }
  const out = [];
  for (const [path, bytes] of files) out.push({path, bytes, expectedSHA256: originals.has(path) ? await sha256(originals.get(path)) : null});
  return {
    title: `Characters from ${from}`,
    summary: `${added.length} character${added.length === 1 ? '' : 's'} copied from ${from} with new IDs. ${out.length} archives rebuilt.`,
    notes: [...notes, 'The other project is unchanged. Battles that used these characters in the other project still point at its old numbers: choose the copied characters again under Project characters.'],
    files: out, registrations, characters: added,
  };
}

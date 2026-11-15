// Battle maps: Data/bg/bgMMM_VV_cC_tTT.dat. pakd entry 0 is the map scene.
// Scene header: name at 0x10, section offsets from 0x24, and at 0x50 six u16:
// tile count, ?, 32, width (X), depth (Y), max height. Section 1 (+0x10) is a
// chain of size-prefixed tile records, ordered index = y * width + x.
// Tile record fields (found by matching a hand-mapped Golyat survey):
//   +0x46 u16 height (in-game display shows height + 1)
//   +0x48 u8  surface code (per-map; e.g. on Golyat 0 earth, 1/26 grass, 2/30 road, 6 sea)
//   +0x4A u16 destructible object type, 0xFFFF = none (object adds 2 to the shown height)

import { decryptPrefix } from '../lib/crypt.js';
import { unzipPrefix } from '../lib/zip.js';
import { parsePakd, view } from '../lib/pakd.js';
import { source } from './source.js';


/** Read just enough of a map file to cover `uncompressedBytes` of its pack. */
async function readPackPrefix(path, uncompressedBytes, firstRead = 256 * 1024) {
  let readBytes = firstRead;
  for (;;) {
    const { bytes, size } = await source.read(path, readBytes);
    // A truncated read decrypts one byte short: each byte needs its successor.
    const plain = bytes.length < size ? decryptPrefix(bytes, bytes.length - 1) : decryptPrefix(bytes, size);
    const pack = await unzipPrefix(plain, uncompressedBytes);
    if (pack.length >= uncompressedBytes || bytes.length >= size) return pack;
    readBytes *= 4;
  }
}

function sceneHeader(pack) {
  const pakd = parsePakd(pack);
  const sceneOffset = pakd.entries[0].offset;
  const scene = pack.subarray(sceneOffset);
  const v = view(scene);
  const name = new TextDecoder().decode(scene.subarray(0x10, 0x20)).replace(/\0.*$/s, '');
  return {
    name,
    sceneOffset,
    tileCount: v.getUint16(0x50, true),
    width: v.getUint16(0x56, true),
    depth: v.getUint16(0x58, true),
    maxHeight: v.getUint16(0x5A, true),
    tilesStart: v.getUint32(0x28, true) + 0x10,
    tilesEnd: v.getUint32(0x2C, true) + 0x10,
  };
}

/** Header only: name and dimensions (cheap: reads a few KB of the file). */
export async function readMapInfo(path) {
  const pack = await readPackPrefix(path, 0x200, 8 * 1024);
  const h = sceneHeader(pack);
  return { path, name: h.name, width: h.width, depth: h.depth, maxHeight: h.maxHeight };
}

export async function loadMapGrid(path) {
  const head = sceneHeader(await readPackPrefix(path, 0x200, 8 * 1024));
  const pack = await readPackPrefix(path, head.sceneOffset + head.tilesEnd);
  const h = sceneHeader(pack);
  const scene = pack.subarray(h.sceneOffset);
  const v = view(scene);
  const tiles = [];
  let o = h.tilesStart;
  for (let i = 0; i < h.tileCount; i++) {
    const size = v.getUint32(o, true);
    if (size < 0x50 || o + size > scene.length) throw new Error(`${path}: bad tile record ${i}`);
    tiles.push({
      x: i % h.width,
      y: Math.floor(i / h.width),
      height: v.getUint16(o + 0x46, true),
      surface: scene[o + 0x48],
      object: v.getUint16(o + 0x4A, true) === 0xFFFF ? null : scene[o + 0x4A],
    });
    o += size;
  }
  if (o !== h.tilesEnd) throw new Error(`${path}: tile records did not end where expected`);
  return {
    path,
    name: h.name,
    width: h.width,
    depth: h.depth,
    maxHeight: h.maxHeight,
    tiles,
    tileAt: (x, y) => (x >= 0 && y >= 0 && x < h.width && y < h.depth ? tiles[y * h.width + x] : null),
  };
}

/** Height the game shows in its tile info panel. */
export const displayHeight = (tile) => tile.height + 1 + (tile.object !== null ? 2 : 0);

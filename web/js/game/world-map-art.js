import { parseBtx } from './bgscene.js';
import { source } from './source.js';
import { decrypt } from '../lib/crypt.js';
import { parsePakd, view } from '../lib/pakd.js';
import { unzipSingle } from '../lib/zip.js';
import { textureCanvas } from '../ui/texcanvas.js';

// The stock plane's rectangular texture regions use atlas UVs measured
// from the corresponding worldmapMesh vertices in the BMAR model.
const regions = [
  ['worldMap00', -8, -4.5, -2, 1.5, .002, .002, .998, .998],
  ['worldMap01', -2, -4.5, 4, 1.5, .002, .002, .998, .998],
  ['worldMap02', -8, 1.5, -2, 4.5, .002, .002, .998, .498],
  ['worldMap02', -2, 1.5, 4, 4.5, .002, .502, .998, .998],
  ['worldMap03', 4, -4.5, 8, 1.5, .002, .002, .661, .998],
  ['worldMap03', 4, 1.5, 6, 4.5, .670, .001, .999, .497],
  ['worldMap03', 6, 1.5, 8, 4.5, .667, .502, .998, .998],
];

export async function drawWorldMapArt(canvas) {
  const { bytes } = await source.read('worldmap/Worldmap.dat');
  const { data } = await unzipSingle(decrypt(bytes));
  const model = parsePakd(data).entries[28]?.data;
  if (!model || view(model).getUint32(0, true) !== 0x52414d42) throw new Error('Invalid world map model.');
  const nameMap = new Map();
  const modelView = view(model);
  for (let i = 0; i + 80 <= model.length; i += 4) {
    if (modelView.getUint32(i, true) !== 0x00787462) continue;
    const tex = parseBtx(model, i);
    if (/^worldMap0[0-3]$/.test(tex.name) && tex.width === 2048 && tex.height === 2048 && tex.format === 13) {
      nameMap.set(tex.name, tex);
    }
    if (tex.end > i) i = tex.end - 4;
  }
  if (nameMap.size !== 4) throw new Error('Missing world map textures.');
  const context = canvas.getContext('2d');
  for (const [name, texture] of nameMap) {
    const tile = textureCanvas(texture);
    for (const [atlas, x1, y1, x2, y2, u1, v1, u2, v2] of regions) {
      if (atlas !== name) continue;
      context.drawImage(tile,
        u1 * tile.width, v1 * tile.height, (u2 - u1) * tile.width, (v2 - v1) * tile.height,
        (x1 + 8) / 16 * canvas.width, (y1 + 4.5) / 9 * canvas.height,
        (x2 - x1) / 16 * canvas.width, (y2 - y1) / 9 * canvas.height);
    }
  }
}

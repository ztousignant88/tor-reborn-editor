import { battleData } from './battledata.js';
import { parseBtx } from './bgscene.js';
import { artPixels } from '../ui/artpixels.js';
import { rgbaCanvas } from '../ui/texcanvas.js';
import { view } from '../lib/pakd.js';

let cardAtlas;

async function loadAtlas() {
  const { dat } = await battleData();
  for (const { data } of dat.pakd.entries.slice(3, 11)) {
    const header = view(data);
    for (let at = 0; at + 80 < data.length; at += 4) {
      if (header.getUint32(at, true) !== 0x00787462 ||
          header.getUint16(at+8, true) !== 512 || header.getUint16(at+10, true) !== 192) continue;
      const texture = parseBtx(data, at);
      if (texture.name === 'card_buff') return artPixels({ texture });
    }
  }
  throw new Error('Buff card artwork is unavailable');
}

export async function startingCardArt(id) {
  cardAtlas ??= loadAtlas();
  const pixels = await cardAtlas;
  const x = (id + 1) % 8 * 64, y = Math.floor((id + 1) / 8) * 64;
  const card = new Uint8Array(64 * 64 * 4);
  for (let row = 0; row < 64; row++) {
    const start = ((y + row) * 512 + x) * 4;
    card.set(pixels.subarray(start, start + 64 * 4), row * 64 * 4);
  }
  return rgbaCanvas(64, 64, card, 0.44);
}

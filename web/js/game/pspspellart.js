import { scanArt } from './artassets.js';
import { parseArc, renameArcRecord } from './artregistry.js';
import { patchTextureData } from './artcolour.js';
import { artPixels } from '../ui/artpixels.js';
import { parsePakd, view } from '../lib/pakd.js';
import { readRGBAPNG } from '../lib/pngrgba.js';
import { rebuildTexturePixels } from '../lib/bc7encode.js';
import { sha256 } from '../lib/artfiles.js';

const circle = (x, y, cx, cy, rx, ry) => Math.hypot((x-cx)/rx, (y-cy)/ry);

function necromancyPixels(original, motif) {
  const pixels = original.slice();
  const badge = new Uint8Array(original.length);
  for (let y=0; y<64; y++) for (let x=0; x<64; x++) {
    const at=(y*64+x)*4;
    const fill=[27,22,27];
    if (circle(x,y,15.6,47.6,11.8,11.7)<=1) {
      const mirror=(y*64+63-x)*4;
      if (x<20 || y>50 || original[at+1]<85 || original[at+2]<85) {
        badge.set(original.subarray(at,at+4),at);
      }
      if (original[mirror+1]>=75 && original[mirror+2]>=75) pixels.set(fill,at);
      else pixels.set(original.subarray(mirror,mirror+4),at);
    } else {
      const mix=Math.max(0,Math.min(1,(1-circle(x,y,31.5,29.8,17.3,22.8))*6));
      for (let c=0; c<3; c++) pixels[at+c]=Math.round(original[at+c]*(1-mix)+fill[c]*mix);
    }
  }
  for (const overlay of [motif,badge]) for (let at=0; at<pixels.length; at+=4) {
    const fg=overlay[at+3]/255,bg=pixels[at+3]/255;
    const alpha=fg+bg*(1-fg);
    if (!fg) continue;
    for (let c=0; c<3; c++) pixels[at+c]=Math.round((overlay[at+c]*fg+pixels[at+c]*bg*(1-fg))/alpha);
    pixels[at+3]=Math.round(alpha*255);
  }
  return pixels;
}

export async function pspSpellArtwork(recipe, pack, loadImage) {
  if (!recipe.icons.some(icon => icon.donor)) return recipe;
  const bank = parsePakd(pack).entries[0].data;
  const records = new Map(parseArc(bank).records.map(record => [record.name,record]));
  const assets = new Map(scanArt(bank).assets.map(asset => [asset.name,asset]));
  const icons = await Promise.all(recipe.icons.map(async icon => {
    if (!icon.donor) return icon;
    const donor = records.get(icon.donor);
    if (!donor) throw new Error(`Missing local spell icon ${icon.donor}`);
    const record = renameArcRecord(donor,icon.name);
    if (icon.motif) {
      const asset=assets.get(icon.donor),original=artPixels(asset);
      const { rgba } = await readRGBAPNG(await loadImage(icon.motif),{width:64,height:64});
      const rebuilt=await rebuildTexturePixels(asset,original,necromancyPixels(original,rgba));
      const v=view(record.payload),at=v.getUint16(4,true);
      const leaf=record.payload.subarray(at,at+v.getUint32(0,true));
      record.payload.set(patchTextureData(leaf,rebuilt.data),at);
    }
    const previous = records.get(icon.name);
    return {...icon,previousDigest:previous ? await sha256(previous.payload) : null,
      header:btoa(String.fromCharCode(...record.header)),
      payload:btoa(String.fromCharCode(...record.payload))};
  }));
  return {...recipe,icons};
}

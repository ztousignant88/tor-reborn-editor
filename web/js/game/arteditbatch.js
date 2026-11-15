// One rebuild per archive, with unrelated image payloads checked byte for byte.
import {unpackArt,repackArt,patchArt,patchIndices}from '../lib/artrebuild.js';
import {prepareTexturePixels,portraitFitNote}from './artportraitfit.js';
import {sha256}from '../lib/artfiles.js';
import {scanArt}from './artassets.js';
import {canImportTexture,patchTextureData,rgbaAsset}from './artcolour.js';
import {artPixels}from '../ui/artpixels.js';
export const sameBytes=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
const key=a=>JSON.stringify(a.locator);
export class ArtEditBatch{
 constructor({decode=artPixels,progress=()=>{},fitPortraits='off'}={}){this.decode=decode;this.progress=progress;this.fitPortraits=fitPortraits;this.adjustments=new WeakMap();this.fitNotes=[];this.archives=new Map();this.cache=new Map();this.count=0;}
 async entry(archive){let e=this.archives.get(archive.path);if(!e){e={archive,pack:(await unpackArt(archive.original)).pack,edits:new Map()};this.archives.set(archive.path,e);}else if(e.archive!==archive)throw new Error('Duplicate source snapshot for '+archive.path);return e;}
 async indices(archive,asset,indices,palette,label){
  if(indices.length!==asset.width*asset.height)throw new Error('Sprite dimensions changed');if(sameBytes(asset.sheet.indices,indices))return;
  const e=await this.entry(archive);if(e.edits.has(asset.id))throw new Error('Image scheduled twice');e.pack=patchArt(e.pack,asset.locator,leaf=>patchIndices(leaf,indices,asset.width,asset.height));const expected={...asset,sheet:{...asset.sheet,indices}};e.edits.set(asset.id,{before:asset,expected,imported:rgbaAsset(asset.width,asset.height,artPixels(expected,palette)),palette,label});this.count++;
 }
 async rgba(archive,asset,rgba,label){
  if(!canImportTexture(asset))throw new Error('Cannot rebuild '+archive.path+' / '+asset.name);const e=await this.entry(archive),supplied=rgba,prepared=await prepareTexturePixels({path:archive.path,pack:e.pack,asset,original:this.decode(asset),rgba,fitPortraits:this.fitPortraits,progress:this.progress,cache:this.cache,adjustments:this.adjustments}),{encoded,fit}=prepared;rgba=prepared.rgba;if(sameBytes(encoded.data,asset.texture.data))return;
  if(e.edits.has(asset.id))throw new Error('Image scheduled twice');e.pack=patchArt(e.pack,asset.locator,leaf=>patchTextureData(leaf,encoded.data));if(fit)this.fitNotes.push(archive.path+' · '+asset.name+': '+portraitFitNote(fit));e.edits.set(asset.id,{before:asset,expected:{...asset,texture:{...asset.texture,data:encoded.data}},...(fit?{originalImported:rgbaAsset(asset.width,asset.height,supplied)}:{}),imported:rgbaAsset(asset.width,asset.height,rgba),label,stats:{portraitFit:fit,changed:encoded.changed,kept:encoded.kept,unit:encoded.unit}});this.count++;
 }
 async finish(){const files=[],previews=[];for(const {archive,pack,edits}of this.archives.values()){
  this.progress('Validating '+archive.path+'…');const bytes=await repackArt(archive.original,pack,{path:archive.path}),checked=scanArt((await unpackArt(bytes)).pack,archive.path);if(checked.assets.length!==archive.assets.length)throw new Error('Rebuilt image count changed');
  for(const before of archive.assets){const after=checked.assets.find(a=>a.id===before.id),edit=edits.get(before.id);if(!after||after.name!==before.name||after.kind!==before.kind||after.width!==before.width||after.height!==before.height||after.format!==before.format||after.bpp!==before.bpp||key(after)!==key(before))throw new Error('Rebuilt image identity changed');
   if(!edit){if(!sameBytes(before.raw,after.raw))throw new Error('Unrelated art changed: '+before.name);continue;}
   if(before.kind==='indexed'){if(!sameBytes(after.sheet.indices,edit.expected.sheet.indices))throw new Error('Sprite indices failed verification');}
   else{if(!sameBytes(after.texture.data,edit.expected.texture.data))throw new Error('Texture payload failed verification');const actual=this.decode(after),rgba=edit.imported.texture.data;let error=0,weight=0;for(let i=0;i<rgba.length;i+=4){if([0,255].includes(rgba[i+3])&&actual[i+3]!==rgba[i+3])throw new Error('Texture transparency failed verification');const a=rgba[i+3]/255;weight+=a*3;for(let c=0;c<3;c++)error+=a*Math.abs(rgba[i+c]-actual[i+c]);}edit.stats.meanColourError=weight?error/weight:0;}
   previews.push({label:edit.label??archive.path+' · '+before.name,before,imported:edit.imported,originalImported:edit.originalImported,after,palette:edit.palette,stats:edit.stats});
  }
  if(!sameBytes(bytes,archive.original))files.push({path:archive.path,bytes,expectedSHA256:await sha256(archive.original)});
 }return {files,previews,fitNotes:this.fitNotes};}
}

import {readArtPackageZIP,packagePath}from '../lib/artpackagezip.js';
import {sha256}from '../lib/artfiles.js';
import {readRGBAPNG}from '../lib/pngrgba.js';
import {readSpritePNG,spriteConversionNote}from './spritepalette.js';
import {patchIndices,patchArt,unpackArt,repackArt}from '../lib/artrebuild.js';
import {readArtArchive,scanArt}from './artassets.js';
import {artPixels}from '../ui/artpixels.js';
import {canImportTexture,patchTextureData,rgbaAsset}from './artcolour.js';
import {prepareTexturePixels,portraitFitNote}from './artportraitfit.js';
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]),locator=x=>JSON.stringify(x),hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
export async function packageImportPlan(bytes,{palette,decode=artPixels,progress=()=>{},fitPortraits='off',colourMode='indexed'}={}){
 progress('Reading art package…');const zip=await readArtPackageZIP(bytes),raw=zip.get('manifest.json');if(!raw||raw.length>8*1024*1024)throw new Error('This ZIP needs the art exporter’s manifest.json');let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new Error('Art package manifest is invalid JSON');}
 if(manifest.format!=='tor-art-export'||manifest.version!==1||!Array.isArray(manifest.archives)||!manifest.archives.length||manifest.archives.length>128)throw new Error('Unsupported art export manifest');
 const files=[],previews=[],notes=[],paths=new Set();let imageCount=0,unchanged=0,skipped=0,helperOmitted=0;
 for(const [index,entry]of manifest.archives.entries()){
  const path=packagePath(entry.path);if(!/^[A-Za-z0-9_./-]+\.(dat|efz)$/i.test(path)||paths.has(path)||!hex(entry.sha256)||!Array.isArray(entry.images)||entry.images.length>10000)throw new Error('Invalid or duplicate archive in art manifest');paths.add(path);imageCount+=entry.images.length;if(imageCount>10000)throw new Error('Art package contains too many images');progress(`Checking archive ${index+1}/${manifest.archives.length}: ${path}…`);
  const archive=await readArtArchive(path);if(await sha256(archive.original)!==entry.sha256)throw new Error(path+' changed since this package was exported. Export the current saved version before importing.');if(entry.source){const original=zip.get(packagePath(entry.source));if(!original||await sha256(original)!==entry.sha256)throw new Error('Packaged source archive changed: '+path);}
  let pack=path.endsWith('.dat')?(await unpackArt(archive.original)).pack:null;const edits=new Map(),seen=new Set();
  for(const record of entry.images){
   if(!Number.isInteger(record.id)||seen.has(record.id))throw new Error('Invalid or duplicate image ID');seen.add(record.id);const asset=archive.assets.find(a=>a.id===record.id);
   if(!asset||asset.name!==record.name||asset.kind!==record.kind||asset.width!==record.width||asset.height!==record.height||locator(asset.locator)!==locator(record.locator)||!hex(record.sourcePayloadSHA256)||await sha256(asset.raw)!==record.sourcePayloadSHA256)throw new Error(path+': image metadata no longer matches its native resource');
   if(!record.png){if(record.omitted==='helper-art-disabled')helperOmitted++;else skipped++;continue;}const png=zip.get(packagePath(record.png));if(!png)throw new Error('Missing exported PNG: '+record.png);let imported,originalImported,expected,stats=null,selectedPalette=null;
   if(asset.kind==='indexed'){
    if(asset.bpp!==record.bpp)throw new Error('Native sprite bit depth changed');selectedPalette=asset.palettes[0]??palette?.(record.paletteIndex??0);if(!selectedPalette||!Array.isArray(record.paletteRGBA)||!same(selectedPalette,new Uint8Array(record.paletteRGBA)))throw new Error(path+': the exported sprite palette differs from the current native palette');
    let image;try{image=await readSpritePNG(png,selectedPalette,{width:asset.width,height:asset.height,bpp:asset.bpp,colourMode});}catch(e){e.message=record.png+': '+e.message;throw e;}if(image.originalRGBA){originalImported=rgbaAsset(asset.width,asset.height,image.originalRGBA);stats={meanColourError:image.meanColourError};notes.push(record.png+': '+spriteConversionNote(image));}if(same(image.indices,asset.sheet.indices)){unchanged++;continue;}if(!pack)throw new Error('This archive type cannot be rebuilt yet');pack=patchArt(pack,asset.locator,leaf=>patchIndices(leaf,image.indices,image.width,image.height));expected={...asset,sheet:{...asset.sheet,indices:image.indices}};imported=rgbaAsset(asset.width,asset.height,artPixels(expected,selectedPalette));
   }else{
    if(asset.format!==record.format)throw new Error('Native texture format changed');const image=await readRGBAPNG(png,{width:asset.width,height:asset.height}),original=decode(asset);if(same(original,image.rgba)){unchanged++;continue;}if(!pack||!canImportTexture(asset))throw new Error(path+' / '+asset.name+': this changed texture type cannot be rebuilt yet');
    const {encoded,rgba,fit}=await prepareTexturePixels({path,pack,asset,original,rgba:image.rgba,fitPortraits,progress});if(fit){originalImported=rgbaAsset(asset.width,asset.height,image.rgba);notes.push(path+' · '+asset.name+': '+portraitFitNote(fit));}if(!encoded.changed){unchanged++;continue;}pack=patchArt(pack,asset.locator,leaf=>patchTextureData(leaf,encoded.data));expected={...asset,texture:{...asset.texture,data:encoded.data}};imported=rgbaAsset(asset.width,asset.height,rgba);stats={portraitFit:fit,changed:encoded.changed,kept:encoded.kept,unit:encoded.unit};
   }
   edits.set(asset.id,{before:asset,imported,originalImported,expected,palette:selectedPalette,stats,label:path+' · '+asset.name});
  }
  if(!edits.size)continue;const rebuilt=await repackArt(archive.original,pack,{path}),checked=scanArt((await unpackArt(rebuilt)).pack,path);if(checked.assets.length!==archive.assets.length)throw new Error('Rebuilt package resource count changed');
  for(const asset of archive.assets){const after=checked.assets.find(a=>a.id===asset.id),edit=edits.get(asset.id);if(!after||after.name!==asset.name||after.width!==asset.width||after.height!==asset.height||after.kind!==asset.kind)throw new Error('Rebuilt package resource identity changed');
   if(!edit){if(!same(after.raw,asset.raw))throw new Error('An unrelated art resource changed during rebuild');continue;}
   if(asset.kind==='indexed'){if(!same(after.sheet.indices,edit.expected.sheet.indices))throw new Error('Rebuilt sprite indices did not verify');}
   else{if(!same(after.texture.data,edit.expected.texture.data))throw new Error('Rebuilt texture pixels did not verify');const actual=decode(after),rgba=edit.imported.texture.data;let error=0,weight=0;for(let i=0;i<rgba.length;i+=4){if([0,255].includes(rgba[i+3])&&actual[i+3]!==rgba[i+3])throw new Error('Texture transparency failed to verify');const alpha=rgba[i+3]/255;weight+=3*alpha;for(let c=0;c<3;c++)error+=alpha*Math.abs(actual[i+c]-rgba[i+c]);}edit.stats.meanColourError=weight?error/weight:0;}
   previews.push({...edit,after});
  }
  if(!same(rebuilt,archive.original))files.push({path,bytes:rebuilt,expectedSHA256:entry.sha256});
 }
 notes.push(`${unchanged.toLocaleString()} exported images were unchanged; their native compressed blocks or sprite indices were preserved.`);if(skipped)notes.push(`${skipped} resources had no exported PNG and were preserved.`);if(helperOmitted)notes.push(`${helperOmitted} helper images were omitted from export and kept in their native source form. Use Sprite art helper to regenerate silhouettes and menu pictures affected by edited body art.`);notes.push('Resource names, IDs, native dimensions and unrelated art are retained. Only edited PNG images are imported; packaged DAT, animation and palette-bank files are never installed.','BC7 colour compression is lossy. Choose an edited image below and inspect its rebuilt preview.','This restores art into existing slots. New character IDs, new animation families, palette-bank edits and automatic cutscene-copy propagation are separate work.');
 return {title:'Art package import',summary:`${previews.length} edited images across ${files.length} rebuilt archives.`,notes,previews,files,...(previews[0]?{before:previews[0].before,imported:previews[0].imported,after:previews[0].after}:{})};
}

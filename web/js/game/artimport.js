import {nativePose,menuFromPose}from './arthelpers.js';
import {artAnimationBank}from './artassets.js';
import {DEFAULT_PALETTE}from './palette.js';
import {artPixels}from '../ui/artpixels.js';
import {rebuildTexturePixels}from '../lib/bc7encode.js';
import {patchTextureData,rgbaAsset}from './artcolour.js';
import {readSpritePNG,spriteConversionNote}from './spritepalette.js';
import {source}from './source.js';
import {scanArt,readArtArchive,artFiles}from './artassets.js';
import {poseGroup}from './actorposes.js';
import {unpackArt,repackArt,patchArt,replaceNativeArt,patchIndices}from '../lib/artrebuild.js';
import {sha256}from '../lib/artfiles.js';
const family=p=>p.split('/').pop().replace(/\.dat$/i,'').replace(/\d\d$/,'');
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
export async function indexedImportPlan(archive,asset,png,palette,{colourMode='indexed'}={}){
 if(asset.kind!=='indexed')throw new Error('Select an indexed sprite sheet for PNG import');const image=await readSpritePNG(png,palette,{width:asset.width,height:asset.height,bpp:asset.bpp,colourMode});
 const {pack}=await unpackArt(archive.original),next=patchArt(pack,asset.locator,leaf=>patchIndices(leaf,image.indices,image.width,image.height)),bytes=await repackArt(archive.original,next,{path:archive.path}),check=scanArt((await unpackArt(bytes)).pack,archive.path).assets.find(a=>JSON.stringify(a.locator)===JSON.stringify(asset.locator));if(!check||!same(check.sheet.indices,image.indices))throw new Error('Rebuilt sprite did not verify');
 return {title:'Indexed sprite import',summary:`${archive.path}: one sprite sheet; native frame layout, masks and palette bank retained.`,notes:[...(image.originalRGBA?[spriteConversionNote(image),'The source PNG is unchanged. Native dimensions, frame positions and palette banks are retained.']:[]),'PNG import does not generate new masks or aura art. If you change the silhouette, those resources also need updating.'],before:asset,...(image.originalRGBA?{originalImported:rgbaAsset(asset.width,asset.height,image.originalRGBA),imported:rgbaAsset(asset.width,asset.height,artPixels(check,palette)),stats:{meanColourError:image.meanColourError}}:{}),after:check,files:same(bytes,archive.original)?[]:[{path:archive.path,bytes,expectedSHA256:await sha256(archive.original)}]};
}
export async function appearanceImportPlan({target='Warrior_m',donor='Pumpkin',bothWarriors=true,portraits=true,menuFaces=true,menuPoses=true,palette=DEFAULT_PALETTE,progress=()=>{}}={}){
 if(target===donor)throw new Error('Choose a different donor appearance');if(poseGroup(target)!==poseGroup(donor))throw new Error('Choose a donor using the same native animation family');
 const all=await artFiles('characters'),exists=new Set(all.map(f=>f.path)),targets=bothWarriors&&/^Warrior_[mf]$/i.test(target)?['Warrior_m','Warrior_f']:[target];
 if(!exists.has(`object/${donor}.dat`))throw new Error('The donor base sprite file is missing');for(const t of targets)if(!exists.has(`object/${t}.dat`))throw new Error('The target base sprite file is missing');
 const cache=new Map(),read=async p=>{if(!cache.has(p))cache.set(p,readArtArchive(p));return cache.get(p);},base=await read(`object/${donor}.dat`),body=base.assets;
 if(body.length!==6||body.filter(a=>a.kind==='indexed').length!==2)throw new Error('This appearance layout is not supported by the first transfer tool');
 const files=[],notes=['Class rules, statistics, animation-family IDs and shared palette data are unchanged.','Bundled cutscene copies and unique scene actions are outside this first appearance import.'],paths=all.filter(f=>targets.includes(family(f.path))&&(portraits||!/\d\d\.dat$/i.test(f.path))).map(f=>f.path);let before=null,after=null;
 for(const path of paths){progress(`Rebuilding ${path}…`);const dest=await read(path);if(![6,7].includes(dest.assets.length))throw new Error(`${path}: unsupported character resource layout`);let {pack}=await unpackArt(dest.original);
  for(let i=0;i<6;i++)pack=patchArt(pack,dest.assets[i].locator,replaceNativeArt(dest.assets[i],body[i]));
  if(dest.assets.length===7){const suffix=/([0-9]{2})\.dat$/i.exec(path)?.[1]??'00',match=`object/${donor}${suffix}.dat`,fallback=`object/${donor}00.dat`,donorPath=exists.has(match)?match:fallback;if(!exists.has(donorPath))throw new Error('Donor portrait is missing');const portrait=(await read(donorPath)).assets.find(a=>a.kind==='texture'&&a.width===512&&a.height===512&&a.name===donor+donorPath.match(/([0-9]{2})\.dat$/i)[1]);if(!portrait)throw new Error('Donor portrait could not be identified');pack=patchArt(pack,dest.assets[6].locator,replaceNativeArt(dest.assets[6],portrait));if(donorPath!==match)notes.push(`${path}: uses the donor’s default portrait because variant ${suffix} is absent.`);}
  const bytes=await repackArt(dest.original,pack,{path}),verified=scanArt((await unpackArt(bytes)).pack,path);if(verified.assets.length!==dest.assets.length)throw new Error('Rebuilt resource count changed');for(let i=0;i<6;i++){const a=verified.assets[i],b=body[i];if(!same(a.kind==='indexed'?a.sheet.indices:a.texture.data,b.kind==='indexed'?b.sheet.indices:b.texture.data))throw new Error('Rebuilt appearance pixels did not verify');}
  if(!before&&family(path)===target){before=dest.assets[0];after=verified.assets[0];}if(!same(bytes,dest.original))files.push({path,bytes,expectedSHA256:await sha256(dest.original)});
 }
 if(menuFaces||menuPoses){
  let pose=null;if(menuPoses&&/^Warrior_[mf]$/i.test(target)){const bank=await artAnimationBank(donor);pose=nativePose(base,bank.definition,0,palette);}
  for(const path of (menuFaces?['menu/texture_x4/com_unit.dat','menu/texture_x4/com_class.dat']:['menu/texture_x4/com_class.dat'])){
   const archive=await read(path);let {pack}=await unpackArt(archive.original);let changed=0;const expected=new Map();
   for(const a of archive.assets){let donorAsset;
    if(path.endsWith('com_unit.dat')){const m=/^com_unit_face_(.+)_([0-9]{2})$/i.exec(a.name);if(!m||!targets.some(t=>t.toLowerCase()===m[1].toLowerCase()))continue;donorAsset=archive.assets.find(b=>b.name.toLowerCase()===`com_unit_face_${donor}_${m[2]}`.toLowerCase())??archive.assets.find(b=>b.name.toLowerCase()===`com_unit_face_${donor}_00`.toLowerCase());}
    else if(/^Warrior_[mf]$/i.test(target)&&donor==='Pumpkin'){const m=/^com_class00_face(0017|0035)_00$/.exec(a.name);if(!m||!targets.includes(m[1]==='0017'?'Warrior_m':'Warrior_f'))continue;donorAsset=archive.assets.find(b=>b.name==='com_class00_face0091_00');}
    if(donorAsset&&menuFaces&&!same(a.texture.data,donorAsset.texture.data)){pack=patchArt(pack,a.locator,replaceNativeArt(a,donorAsset));expected.set(a.id,donorAsset.texture.data);changed++;}
   }
   if(pose&&path.endsWith('com_class.dat'))for(const a of archive.assets){const m=/^com_class00_unit(0017|0035)_00$/.exec(a.name);if(!m||!targets.includes(m[1]==='0017'?'Warrior_m':'Warrior_f'))continue;const original=artPixels(a),rgba=menuFromPose(pose,a.width,a.height,{mode:'standing',template:original}),encoded=await rebuildTexturePixels(a,original,rgba,progress);if(encoded.changed){pack=patchArt(pack,a.locator,leaf=>patchTextureData(leaf,encoded.data));expected.set(a.id,encoded.data);changed++;}notes.push(`${a.name}: standing picture generated from the donor’s native pose at the target’s existing dimensions.`);}
   if(changed){const bytes=await repackArt(archive.original,pack,{path}),verified=scanArt((await unpackArt(bytes)).pack,path);if(verified.assets.length!==archive.assets.length)throw new Error('Rebuilt menu resource count changed');for(const a of archive.assets){const check=verified.assets.find(b=>b.id===a.id);if(!check||check.name!==a.name||check.width!==a.width||check.height!==a.height||check.format!==a.format||!same(check.texture.data,expected.get(a.id)??a.texture.data))throw new Error('Rebuilt menu artwork did not verify');}if(!same(bytes,archive.original))files.push({path,bytes,expectedSHA256:await sha256(archive.original)});notes.push(`${changed} menu artwork resources updated in ${path}.`);}
  }if(menuPoses&&!pose)notes.push('Automatic standing-menu links are mapped for male/female Warrior in this pilot. Use Sprite art helper on other standing resources.');
 }
 return {title:`${targets.join(' / ')} → ${donor}`,summary:`${files.length} rebuilt files. Battle sprites${portraits?', linked object portraits':''}${menuFaces?' and matching menu faces':''}${menuPoses?' plus mapped standing pictures':''}.`,notes,before,after,files};
}
export async function stageArtImport(plan,{name,baseProject=null,dataRoot,intoOpen=false}={}){
 if(!plan.files.length&&!plan.icon)throw new Error('The import has no changed pixels');const encode=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
 const files=plan.files.map(f=>({path:f.path,data:encode(f.bytes),expectedSHA256:f.expectedSHA256}));
 const icon=plan.icon?{...plan.icon,texture:encode(plan.icon.texture)}:undefined;const res=await fetch('/api/art/stage',{method:'POST',headers:{'X-TOR-Editor':'1','Content-Type':'application/json'},body:JSON.stringify({name,baseProject,dataRoot,intoOpen,title:plan.title,files,icon,registrations:plan.registrations??[],characters:plan.characters??[]})});const result=await res.json();if(!res.ok)throw new Error(result.error||'Could not stage art import');return result;
}

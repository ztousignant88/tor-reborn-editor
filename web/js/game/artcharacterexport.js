import {actorNames}from './unitsprites.js';
import {readArtArchive}from './artassets.js';
export const isCharacterHelperTexture=a=>a.kind==='texture'&&/_(aura|mask)$/i.test(a.name);
export function classArtworkIDs(actor,names,classes){
 const actorId=names.findIndex(n=>n.toLowerCase()===actor.toLowerCase())+1,ids=new Set();if(!actorId||!classes)return ids;
 for(let i=0;i<classes.count;i++){const row=classes.row(i);if(row.length<0x9a)continue;const v=new DataView(row.buffer,row.byteOffset,row.byteLength);for(const [sprite,icon]of [[0x90,0x98],[0x92,0x99]])if(v.getUint16(sprite,true)===actorId&&row[icon])ids.add(row[icon]);}
 return ids;
}
export async function characterExtraArchives(actor,{faces=false,pictures=false,classes,names,read=readArtArchive}={}){
 if(!faces&&!pictures)return[];names??=await actorNames();const ids=classArtworkIDs(actor,names,classes),paths=[...(faces?['menu/texture_x4/com_unit.dat']:[]),...((faces||pictures)&&ids.size?['menu/texture_x4/com_class.dat']:[])],archives=await Promise.all(paths.map(read)),prefix=`com_unit_face_${actor.toLowerCase()}_`;
 return archives.map(archive=>({archive,imageIDs:new Set(archive.assets.filter(a=>{
  if(archive.path.endsWith('com_unit.dat'))return faces&&a.name.toLowerCase().startsWith(prefix);
  const m=/^com_class00_(face|unit)([0-9]{4})_[0-9]{2}$/i.exec(a.name);return m&&ids.has(Number(m[2]))&&(m[1].toLowerCase()==='face'?faces:pictures);
 }).map(a=>a.id))})).filter(a=>a.imageIDs.size);
}

// The class/unit menus keep additional full portrait copies outside object/*.dat.
// Match native resource names, not an assumed numeric position in the archive.
export async function characterPortraitArchives(actor,{all=true,read=readArtArchive}={}){
 const archive=await read('menu/menu_classface.dat'),name=String(actor).toLowerCase(),imageIDs=new Set(archive.assets.filter(a=>a.kind==='texture'&&a.name.slice(0,-2).toLowerCase()===name&&/^[0-9]{2}$/.test(a.name.slice(-2))&&(all||a.name.endsWith('00'))).map(a=>a.id));return imageIDs.size?[{archive,imageIDs}]:[];
}

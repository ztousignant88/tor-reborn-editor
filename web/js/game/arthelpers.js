// Derive menu pictures and auxiliary silhouettes from the saved native sprite/pose data.
import {readArtArchive,artAnimationBank}from './artassets.js';
import {artPixels}from '../ui/artpixels.js';
import {textureRGBAPlan}from './artcolour.js';
export function alphaBounds(rgba,w,h){let x0=w,y0=h,x1=0,y1=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(rgba[(y*w+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}return x1>x0?{x0,y0,x1,y1}:null;}
export function nativePose(archive,definition,frameId,palette){
 const frame=definition.frames[frameId];if(!frame)throw new Error('Choose an available native frame');const sheets=archive.assets.filter(a=>a.kind==='indexed'),sheet=sheets[frame.sheet];if(!sheet)throw new Error('This frame uses a missing sprite sheet');const cells=frame.cells.filter(c=>c.width&&c.height);if(!cells.length)throw new Error('The selected frame is empty');
 const x0=Math.min(...cells.map(c=>c.x)),y0=Math.min(...cells.map(c=>c.y)),x1=Math.max(...cells.map(c=>c.x+c.width)),y1=Math.max(...cells.map(c=>c.y+c.height)),w=x1-x0,h=y1-y0;if(w*h>4*1024*1024)throw new Error('Pose is too large');const rgba=new Uint8Array(w*h*4),source=artPixels(sheet,sheet.palettes?.[0]??palette);
 for(const c of cells){if(c.u+c.width>sheet.width||c.v+c.height>sheet.height)throw new Error('Pose cell exceeds sprite sheet');for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const si=((c.v+y)*sheet.width+c.u+x)*4,di=((c.y-y0+y)*w+c.x-x0+x)*4;if(source[si+3])rgba.set(source.subarray(si,si+4),di);}}
 return {width:w,height:h,rgba,pivotX:-x0,pivotY:8-y0};
}
/** The automatic face crop of a pose: the top `headFraction` of its visible pixels, as wide as they are there. */
export function faceCrop(pose,headFraction=.42){const bounds=alphaBounds(pose.rgba,pose.width,pose.height);if(!bounds)return null;const crop={...bounds,y1:Math.min(bounds.y1,bounds.y0+Math.max(8,Math.round((bounds.y1-bounds.y0)*headFraction)))};let left=pose.width,right=0;for(let y=crop.y0;y<crop.y1;y++)for(let x=0;x<pose.width;x++)if(pose.rgba[(y*pose.width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x+1);}if(right>left){crop.x0=left;crop.x1=right;}return crop;}
export function menuFromPose(pose,width,height,{mode='standing',scale=1,dx=0,dy=0,headFraction=.42,template=null,box=null}={}){
 if(!Number.isFinite(headFraction)||headFraction<.1||headFraction>1)throw new Error('Choose a face crop between 10% and 100%');if(!Number.isFinite(scale)||scale<.1||scale>8||![dx,dy].every(n=>Number.isFinite(n)&&Math.abs(n)<=1024))throw new Error('Invalid pose placement');const bounds=alphaBounds(pose.rgba,pose.width,pose.height);if(!bounds)throw new Error('The selected pose has no visible pixels');
 let crop={x0:0,y0:0,x1:pose.width,y1:pose.height};if(mode==='face'){crop=box?{x0:Math.max(0,Math.round(box.x)),y0:Math.max(0,Math.round(box.y)),x1:Math.min(pose.width,Math.round(box.x+box.w)),y1:Math.min(pose.height,Math.round(box.y+box.h))}:faceCrop(pose,headFraction);if(crop.x1-crop.x0<2||crop.y1-crop.y0<2)throw new Error('The face box is outside the pose');scale*=Math.min((width-4)/(crop.x1-crop.x0),(height-4)/(crop.y1-crop.y0));}
 const foot=template?alphaBounds(template,width,height)?.y1:height-8,originX=mode==='face'?width/2-(crop.x0+crop.x1)/2*scale:width/2-pose.pivotX*scale,originY=mode==='face'?height/2-(crop.y0+crop.y1)/2*scale:(foot??height-8)-bounds.y1*scale,rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=Math.floor((x-originX-dx)/scale),sy=Math.floor((y-originY-dy)/scale);if(sx<crop.x0||sx>=crop.x1||sy<crop.y0||sy>=crop.y1)continue;const si=(sy*pose.width+sx)*4;rgba.set(pose.rgba.subarray(si,si+4),(y*width+x)*4);}return rgba;
}
export function auraFromPose(pose,width,height,{blur=4}={}){
 if(!Number.isFinite(blur)||blur<0||blur>16)throw new Error('Choose blur between 0 and 16 pixels');const initial=new Float32Array(width*height),ox=Math.floor((width-pose.width)/2),oy=Math.floor((height-pose.height)/2);
 for(let y=0;y<pose.height;y++)for(let x=0;x<pose.width;x++)if(x+ox>=0&&x+ox<width&&y+oy>=0&&y+oy<height)initial[(y+oy)*width+x+ox]=pose.rgba[(y*pose.width+x)*4+3];
 const radius=Math.ceil(blur*2),weights=Array.from({length:radius*2+1},(_,i)=>blur?Math.exp(-((i-radius)**2)/(2*blur*blur)):1),sum=weights.reduce((a,b)=>a+b,0),tmp=new Float32Array(initial.length),out=new Float32Array(initial.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let i=-radius;i<=radius;i++)if(x+i>=0&&x+i<width)tmp[y*width+x]+=initial[y*width+x+i]*weights[i+radius]/sum;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let i=-radius;i<=radius;i++)if(y+i>=0&&y+i<height)out[y*width+x]+=tmp[(y+i)*width+x]*weights[i+radius]/sum;
 const rgba=new Uint8Array(width*height*4);for(let i=0;i<out.length;i++){const a=Math.round(out[i]);rgba.set([a,0,0,a],i*4);}return rgba;
}
export function fitAuraPose(pose,width,height){
 if(pose.width<=width&&pose.height<=height)return pose;const b=alphaBounds(pose.rgba,pose.width,pose.height);if(!b)throw new Error('Aura source pose is empty');const scale=Math.min(1,Math.max(1,width-8)/(b.x1-b.x0),Math.max(1,height-8)/(b.y1-b.y0)),w=Math.max(1,Math.floor((b.x1-b.x0)*scale)),h=Math.max(1,Math.floor((b.y1-b.y0)*scale)),rgba=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=((b.y0+Math.min(b.y1-b.y0-1,Math.floor(y/scale)))*pose.width+b.x0+Math.min(b.x1-b.x0-1,Math.floor(x/scale)))*4;rgba.set(pose.rgba.subarray(i,i+4),(y*w+x)*4);}return {width:w,height:h,rgba,fitted:true,scale};
}
export function maskFromSheet(sheet,template){if(sheet.length!==template.length)throw new Error('Mask and sprite-sheet dimensions must match');const out=template.slice();for(let i=0;i<sheet.length;i+=4){out[i+2]=255-sheet[i+3];out[i+3]=sheet[i+3];}return out;}
export async function spriteHelperPlan(archive,asset,{actor,frame=0,palette,mode='standing',scale=1,dx=0,dy=0,headFraction=.42,blur=4,progress=()=>{},decode=artPixels}={}){
 if(!actor)throw new Error('Choose a source sprite');const source=await readArtArchive(`object/${actor}.dat`),bank=await artAnimationBank(actor),original=decode(asset);let rgba,notes=[];
 if(mode==='mask'){const sheet=source.assets.find(a=>a.kind==='indexed'&&a.width===asset.width&&a.height===asset.height);if(!sheet)throw new Error('Select a mask with the same dimensions as the source sprite sheet');rgba=maskFromSheet(artPixels(sheet,palette),original);notes=['Experimental mask helper: preserves the template’s red/green channels and rebuilds blue/alpha from sprite coverage.','Native masks contain more than a silhouette. Their full rendering meaning is not mapped; test this generated result in game before distribution.'];}
 else{const pose=nativePose(source,bank.definition,Number(frame),palette);rgba=mode==='aura'?auraFromPose(pose,asset.width,asset.height,{blur}):menuFromPose(pose,asset.width,asset.height,{mode,scale,dx,dy,headFraction,template:original});notes=mode==='aura'?['Generated red/alpha blurred silhouette matches the channel convention observed in the stock Warrior aura. Its native rendering use and exact blur kernel remain unverified.']:['Generated from a native pose; portraits and hand-drawn facial detail still need separate artwork.','Review the crop and placement. The helper uses nearest-neighbour pixels and keeps the target canvas size.'];}
 return textureRGBAPlan(archive,asset,rgba,{decode,progress,title:`Sprite helper: ${mode}`,extraNotes:notes});
}

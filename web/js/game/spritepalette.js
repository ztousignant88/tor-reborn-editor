// Keep native palette slots when possible; colour mapping is always an explicit choice.
import {readRGBAPNG,indexedPaletteMatches,spritePNGCorrection}from '../lib/pngrgba.js';
import {readIndexedPNG}from '../lib/artrebuild.js';
export function quantizeBody(rgba,palette,bpp,{alphaCutoff=128}={}){
 if(!palette||palette.length%4||palette.length<8||![4,8].includes(bpp)||rgba.length%4)throw new Error('Choose a native sprite palette');if(!Number.isInteger(alphaCutoff)||alphaCutoff<1||alphaCutoff>255)throw new Error('Invalid transparency threshold');const indices=new Uint8Array(rgba.length/4),cache=new Map(),limit=Math.min(palette.length/4,2**bpp);let changedAlpha=0,error=0,visible=0;
 for(let i=0;i<indices.length;i++){const at=i*4,a=rgba[at+3];if(a!==0&&a!==255)changedAlpha++;if(a<alphaCutoff)continue;const key=rgba[at]*65536+rgba[at+1]*256+rgba[at+2];let match=cache.get(key);if(!match){let best=-1,distance=Infinity;for(let p=1;p<limit;p++){if(!palette[p*4+3])continue;const d=3*(rgba[at]-palette[p*4])**2+4*(rgba[at+1]-palette[p*4+1])**2+2*(rgba[at+2]-palette[p*4+2])**2;if(d<distance){best=p;distance=d;}}if(best<0)throw new Error('Palette has no opaque sprite colours');match={index:best,error:(Math.abs(rgba[at]-palette[best*4])+Math.abs(rgba[at+1]-palette[best*4+1])+Math.abs(rgba[at+2]-palette[best*4+2]))/3};cache.set(key,match);}indices[i]=match.index;error+=match.error;visible++;}
 return {indices,changedAlpha,meanColourError:visible?error/visible:0};
}
export async function convertSpritePNG(png,palette,{width,height,bpp}={}){
 const image=await readRGBAPNG(png,{width,height}),preservedIndices=indexedPaletteMatches(image,palette)&&image.indices.every(n=>n<2**bpp),mapped=preservedIndices?{indices:image.indices,changedAlpha:0,meanColourError:0}:quantizeBody(image.rgba,palette,bpp);
 return {...mapped,width:image.width,height:image.height,originalRGBA:image.rgba,preservedIndices,png:image.png};
}
export async function readSpritePNG(png,palette,{width,height,bpp,colourMode='indexed'}={}){
 if(!['indexed','remap'].includes(colourMode))throw new Error('Invalid sprite colour mode');if(colourMode==='remap')return convertSpritePNG(png,palette,{width,height,bpp});
 const image=await readIndexedPNG(png,palette,{width,height});if(image.indices.some(n=>n>=2**bpp))throw spritePNGCorrection('Some colour slots exceed this sprite’s native palette. Convert and preview to map them to supported colours.');return image;
}
export function spriteConversionNote(image){return image.preservedIndices?'PNG encoding corrected; the original native colour slots were preserved exactly.':`Colours mapped to the selected native palette; average visible colour difference ${image.meanColourError.toFixed(2)}/255. ${image.changedAlpha} partially transparent pixels made opaque or transparent (50% threshold). Review colours and faction palette variants before saving.`;}

// Native screen-space effects: loaders 5449E0/544AB0/544B90 and draws
// 536D80/537D70/538D50. These use a 480 x 270 reference viewport, not tiles.
import {readCurve,sampleCurve,readVector,sampleVector,readColor,sampleColor,readMaterial} from './efx.js';
const packed=(a,b)=>a.map((n,i)=>Math.max(0,Math.min(255,Math.floor(Math.floor(n)*Math.floor(b[i])/128))));
export function readScreen(d){
  const kind=d.kind,b=d.body,at=kind===162?0x6c0:kind===165?0x870:0xb40;
  const colorCount=kind===162?1:kind===165?4:9;
  const base=kind===162?0x160:kind===165?0x310:0x5e0;
  const materials=Array.from({length:4},(_,i)=>{
    const offset=at+i*0x1a0,m=readMaterial(d,offset);
    // Screen/procedural passes use +122. Model materials use +11F.
    return {...m,blend:b[offset+0x122],slot:i,position:readVector(d,base+i*0x68),rotation:readCurve(d,base+0x1a0+i*0x20),scale:readVector(d,base+0x220+i*0x68),uvScale:readVector(d,base+0x3c0+i*0x68)};
  }).filter(m=>m.type);
  return {kind,materials,colors:Array.from({length:colorCount},(_,i)=>readColor(d,0xd0+i*0x90))};
}
const fullUV=[[0,0],[1,0],[0,1],[1,1]];
export function screenPieces(screen,age,r,{texture,shape,track,generatorColor=[128,128,128,128],opacity=100,scaleFirst=false}={}){
  const colors=screen.colors.map(c=>packed(sampleColor(c,age,r),generatorColor));
  const out=[];
  for(const m of screen.materials){
    let faces=[],textureId=null,capture=null;
    if(m.type===2){
      const t=texture(m.texture),uvScale=sampleVector(m.uvScale,age,r);
      // Type 2 stretches the image to the reference viewport. uvScale is
      // applied by the native screen renderer, independently of geometry.
      faces=[{points:[[-240,135,0],[240,135,0],[-240,-135,0],[240,-135,0]],uv:fullUV.map(p=>p.map((n,i)=>n*uvScale[i]))}];textureId=m.texture;
    }else if(m.type===3){
      const frames=shape(m.shape).frames,index=m.track?track(m.track,age):0;
      faces=index===null?[]:frames[Math.min(index,frames.length-1)]??[];textureId=faces[0]?.texture??null;
    }else if(m.type===4||m.type===5){
      faces=[{points:[[-240,135,0],[240,135,0],[-240,-135,0],[240,-135,0]],uv:fullUV}];
      if(m.type===4&&m.preset)capture=m.preset;
    }else continue;
    const scale=sampleVector(m.scale,age,r),position=sampleVector(m.position,age,r),angle=sampleCurve(m.rotation,age,r),c=Math.cos(angle),s=Math.sin(angle);
    const mc=sampleColor(m.color,age,r),scroll=sampleVector(m.scroll,age,r);
    const colorAt=i=>{
      const rgba=packed(colors[Math.min(i,colors.length-1)],mc);rgba[3]=Math.floor(rgba[3]*opacity/100);
      return rgba.map((n,k)=>Math.min(k===3?1:255/128,n/(k===3&&m.blend===4?255:128)));
    };
    for(const f of faces){
      const transform=p=>{
        let x=p[0],y=p[1];
        if(scaleFirst){[x,y]=[x*c-y*s,x*s+y*c];x*=scale[0];y*=scale[1];}
        else{x*=scale[0];y*=scale[1];[x,y]=[x*c-y*s,x*s+y*c];}
        return [(x+position[0])/240,(y+position[1])/135,0];
      };
      if(screen.kind!==166){
        const ids=screen.kind===165?[0,1,2,3]:[0,0,0,0];
        out.push({corners:f.points.map(transform),uv:f.uv.map(p=>p.map((n,i)=>n+scroll[i])),colors:ids.map(colorAt),texture: f.texture??textureId,capture,blend:m.blend,slot:m.slot});
      }else{
        // Native type 166 is a 3 x 3 vertex grid with nine separate colour
        // curves; a single tinted quad discards its central flash/vignette.
        const vertex=(x,y)=>{
          const u=x/2,v=y/2,p=[0,1,2].map(k=>(f.points[0][k]*(1-u)+f.points[1][k]*u)*(1-v)+(f.points[2][k]*(1-u)+f.points[3][k]*u)*v);
          const uv=[0,1].map(k=>(f.uv[0][k]*(1-u)+f.uv[1][k]*u)*(1-v)+(f.uv[2][k]*(1-u)+f.uv[3][k]*u)*v+scroll[k]);
          return {p:transform(p),uv,color:colorAt(y*3+x)};
        };
        for(let y=0;y<2;y++)for(let x=0;x<2;x++){
          const q=[vertex(x,y),vertex(x+1,y),vertex(x,y+1),vertex(x+1,y+1)];
          out.push({corners:q.map(v=>v.p),uv:q.map(v=>v.uv),colors:q.map(v=>v.color),texture:f.texture??textureId,capture,blend:m.blend,slot:m.slot});
        }
      }
    }
  }
  return out;
}

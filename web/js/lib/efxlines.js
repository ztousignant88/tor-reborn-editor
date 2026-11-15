// Textured EFX lines. Kind 102: loader 5451A0, update 5413E0, draw 53F310.
// Keep these as strips with the original materials, not substituted sprites.
import {readCurve,sampleCurve,readVector,sampleVector,readColor,sampleColor,readMaterial} from './efx.js';
import {add3,unit3,random01} from './efxmath.js';
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((n,i)=>n-b[i]),mul=(a,s)=>a.map(n=>n*s),lerp=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*t);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const normal=a=>Math.hypot(...a)>1e-7?unit3(a):[0,0,0];
export function readLinePoint(d,at){
  const b=d.body,v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  return {offset:readVector(d,at),reference:v.getUint32(at+0x68,true),kind:b[at+0x70],subtype:b[at+0x71],mode:b[at+0xc0],attachment:b[at+0xc2],frozen:!!b[at+0xc3],variant:!!b[at+0xc4]};
}
export function readLightning(d){
  const b=d.body,v=new DataView(b.buffer,b.byteOffset,b.byteLength),curves={};
  for(let at=0x8a0;at<=0xa60;at+=32)curves[at]=readCurve(d,at);
  const materials=Array.from({length:2},(_,i)=>{
    const at=0xbb0+i*0x1a0;
    // Procedural draw 540E08 reads +122, unlike the model draw's +11F.
    return {...readMaterial(d,at),blend:b[at+0x122],jitter:[v.getFloat32(at+0x158,true),v.getFloat32(at+0x15c,true)],uvScale:readVector(d,0xa80+i*0x68)};
  });
  return {curves,materials,rotation:readVector(d,0xd0),scale:readVector(d,0x138),position:readVector(d,0x1a0),end:readVector(d,0x208),endpoint:readLinePoint(d,0xef0),
    colors:Array.from({length:9},(_,i)=>readColor(d,0x270+i*0x90)),tints:[readColor(d,0x780),readColor(d,0x810)],
    strands:readCurve(d,0xb50,true),points:readCurve(d,0xb70,true),extraStrands:b[0xfe4],extraPoints:b[0xfe5],
    pathHold:v.getUint16(0xfe6,true),noiseHold:v.getUint16(0xfe8,true),flipU:!!b[0xfea],flipV:!!b[0xfeb],lengthUV:!!b[0xfec],widthUV:!!b[0xfed],sphereStart:!!b[0xfee],sphereEnd:!!b[0xfef],
    ranges:Array.from({length:11},(_,i)=>v.getFloat32(0xfb8+i*4,true))};
}
// Kind 107: 544F40 / 53DEF0 / 53CC20. The same strip tessellator can
// draw its cubic beam, with three independent original material passes.
export function readBeam(d){
  const b=d.body,v=new DataView(b.buffer,b.byteOffset,b.byteLength),constant=n=>({sides:[[[0,n]],[]],randomMode:0,interpolation:[0,0],loop:[0,0]}),vector=a=>({mode:2,curves:a.map(constant),groups:[0,0]});
  const curves=Object.fromEntries(Array.from({length:15},(_,i)=>[0x8a0+i*32,constant(0)]));
  for(const [to,from]of [[0x8c0,0x7f0],[0x980,0x1c0],[0x9a0,0x1e0],[0x9c0,0x200],[0x9e0,0x220],[0xa00,0x240],[0xa20,0x260],[0xa40,0x8b0],[0xa60,0x8d0]])curves[to]=readCurve(d,from);
  for(const at of [0x8e0,0x900,0x920])curves[at]=constant(1);
  const white={constant:[128,128,128,128]};
  return {beam:true,definition:d,window:{speed:readCurve(d,0x790),acceleration:readCurve(d,0x7b0),length:readCurve(d,0x7d0),initial:v.getFloat32(0xecc,true),speedRange:v.getFloat32(0xe98,true),accelerationRange:v.getFloat32(0xe9c,true),lengthRange:v.getFloat32(0xea0,true)},widthEnd:readCurve(d,0x810),curves,materials:Array.from({length:3},(_,i)=>{const at=0x8f0+i*0x1a0;return {...readMaterial(d,at),blend:b[at+0x122],jitter:[v.getFloat32(at+0x158,true),v.getFloat32(at+0x15c,true)],uvScale:{mode:2,curves:[readCurve(d,i===0?0x830:0x850),constant(1),constant(0)],groups:[0,0]}};}),
    rotation:vector([0,0,0]),scale:vector([1,1,1]),position:readVector(d,0xf0),end:readVector(d,0x158),endpoint:readLinePoint(d,0xdd0),
    colors:Array.from({length:9},(_,i)=>readColor(d,0x280+i*0x90)),tints:[white,white,white],strands:constant(1),points:constant(Math.min(128,v.getUint16(0xed0,true)||32)),
    extraStrands:0,extraPoints:0,pathHold:0,noiseHold:0,ranges:Array(11).fill(0)};
}
// Kind 103: loader 544D30, history 539E60/53A1A0, draw 53AD30.
export function readRibbon(d){
  const b=d.body,v=new DataView(b.buffer,b.byteOffset,b.byteLength),curves={};
  for(const at of [0x208,0x228,0x248,...Array.from({length:12},(_,i)=>0x800+i*32)])curves[at]=readCurve(d,at);
  return {curves,materials:Array.from({length:3},(_,i)=>{
    const at=0x980+i*0x1a0;
    return {...readMaterial(d,at),blend:b[at+0x122],jitter:[v.getFloat32(at+0x158,true),v.getFloat32(at+0x15c,true)]};
  }),position:readVector(d,0xd0),rotation:readVector(d,0x138),scale:readVector(d,0x1a0),twist:readVector(d,0x268),
    colors:Array.from({length:9},(_,i)=>readColor(d,0x2f0+i*0x90)),
    fixed:Object.fromEntries([...Array.from({length:16},(_,i)=>0xe60+i*4),0xeb0,0xeb4,0xeb8,0xec4,0xec8,0xecc,0xed0].map(at=>[at,v.getFloat32(at,true)])),
    strands:Math.min(128,v.getUint16(0xea0,true)),segments:Math.min(128,v.getUint16(0xea2,true)),prewarm:Math.min(1800,v.getUint16(0xec0,true)),
    regularAngles:!!b[0xebc],flipU:!!b[0xebd],flipV:!!b[0xebe],asymmetric:!!b[0xead],noise:!!b[0xeae],sharedUV:!!b[0xec3],lengthUV:!!b[0xea7],widthUV:!!b[0xec2]};
}
// Three longitudinal colour stops, each containing left/centre/right RGBA.
// The middle stop is authored independently for the two material passes.
export function lineColor(colors,t,column,mid){
  const u=mid<=1e-4?t:mid>=0.9999?t:t<mid?t/mid:(t-mid)/(1-mid);
  const left=mid<=1e-4?1:mid>=0.9999?0:t<mid?0:1;
  return lerp(colors[left*3+column],colors[(left+1)*3+column],clamp(u,0,1));
}
const packed=(a,b)=>a.map((n,i)=>clamp(Math.floor(Math.floor(n)*Math.floor(b[i])/128),0,255));
export function beamWindow(line,age,seed=0){
 const w=line.window;if(!w)return{head:1,tail:0,visible:true};
 const r=random01(seed,0),sr=random01(seed,71)-.5,ar=random01(seed,72)-.5,lr=random01(seed,73)-.5;
 let head=w.initial,velocity=0;
 for(let t=0;t<=Math.floor(Math.max(0,age));t++){
  velocity+=sampleCurve(w.acceleration,t,r)+ar*w.accelerationRange;
  head+=velocity+sampleCurve(w.speed,t,r)+sr*w.speedRange;
 }
 const length=sampleCurve(w.length,age,r)+lr*w.lengthRange;
 return{head:clamp(head,0,1),tail:clamp(head-length,0,1),visible:head>0&&head-length<1};
}
export function lightningStrips(line,age,seed,start,end,{forward,right,generatorColor=[128,128,128,128],opacity=100,scale=[1,1,1]}={}){
  const out=[],r=random01(seed,0),c=at=>sampleCurve(line.curves[at],age,r),epoch=(hold,t)=>hold?Math.floor(t/hold):0;
  const pathEpoch=epoch(line.pathHold,age),noiseEpoch=epoch(line.noiseHold,age);
  const strands=clamp(Math.trunc(sampleCurve(line.strands,age,r)+random01(seed,1)*line.extraStrands),0,128);
  const points=clamp(Math.trunc(sampleCurve(line.points,age,r)+random01(seed,2)*line.extraPoints),0,128);
  if(points<2||!strands)return out;
  let direction=normal(sub(end,start));if(Math.hypot(...direction)<1e-7)direction=[0,1,0];
  const perpendicular=unit3(cross(Math.abs(direction[1])>0.9?[0,1,0.01]:[0,1,0],direction)),other=unit3(cross(direction,perpendicular));
  const colors=line.colors.map(x=>sampleColor(x,age,r));
  // The game seeds a private PRNG for each strand and reseeds path/noise
  // on separate timers. Our seekable PRNG preserves those timers, but not
  // the exact random sequence of a running battle.
  for(let strand=0;strand<strands;strand++){
    const random=(channel,epoch=pathEpoch)=>random01(seed+strand*65537,channel+epoch*257);
    const radius=(angle,amount,sphere=false)=>sphere?mul(unit3([random(80)*2-1,random(81)*2-1,random(82)*2-1]),amount):add3(mul(perpendicular,Math.cos(angle)*amount),mul(other,Math.sin(angle)*amount));
    const a=add3(start,radius(random(10)*2*Math.PI,c(0x940)+random(12)*line.ranges[0],line.sphereStart));
    const d=add3(end,radius(random(11)*2*Math.PI,c(0x960)+random(13)*line.ranges[1],line.sphereEnd));
    const b=add3(lerp(a,d,c(0x980)+random(14)*line.ranges[5]),radius(c(0xa00)+random(15)*line.ranges[9],c(0x9c0)+random(16)*line.ranges[7]));
    const cc=add3(lerp(a,d,c(0x9a0)+random(17)*line.ranges[6]),radius(c(0xa20)+random(18)*line.ranges[10],c(0x9e0)+random(19)*line.ranges[8]));
    const width=(c(0x8c0)+random(20,0)*line.ranges[3])*(c(0x8e0)+random(21,0)*line.ranges[4]);
    const widths=[c(0x900)*width,width,width,c(0x920)*width];
    const window=line.beam?beamWindow(line,age,seed):{head:1,tail:0,visible:true};if(!window.visible)continue;
    const path=Array.from({length:points},(_,i)=>{
      const t=line.beam?window.head+(window.tail-window.head)*i/(points-1):i/(points-1),u=1-t;
      let p=a.map((n,k)=>u*u*u*n+3*u*u*t*b[k]+3*u*t*t*cc[k]+t*t*t*d[k]);
      if(i&&i!==points-1)p=add3(p,radius(random(100+i,noiseEpoch)*2*Math.PI,c(0x8a0)+random(300+i,noiseEpoch)*line.ranges[2]));
      return p;
    });
    const distances=[0];for(let i=1;i<points;i++)distances.push(distances.at(-1)+Math.hypot(...sub(path[i],path[i-1])));
    const length=distances.at(-1);if(length<1e-7)continue;
    const sides=path.map((p,i)=>{
      const tangent=sub(path[Math.min(points-1,i+1)],path[Math.max(0,i-1)]),axis=cross(tangent,forward);
      return Math.hypot(...axis)>1e-7?unit3(axis):right;
    });
    for(let pass=0;pass<line.materials.length;pass++){
      const material=line.materials[pass];if(!material.type)continue;
      const uvScale=sampleVector(material.uvScale,age,r),scroll=sampleVector(material.scroll,age,r),mc=sampleColor(material.color,age,r);
      let tint=packed(sampleColor(line.tints[pass],age,r),packed(colors[1],generatorColor));
      tint=tint.map((n,i)=>i===3?Math.min(1,n/128*clamp(opacity,0,100)/100):n/128);
      const flipU=line.flipU&&random(31,0)<0.5?-1:1,flipV=line.flipV&&random(32,0)<0.5?-1:1;
      const mid=c(pass?0xa60:0xa40),rows=path.map((p,i)=>{
        const t=i/(points-1),section=Math.min(2,Math.floor(t*3)),fraction=t===1?1:t*3-section;
        // Native beam draw 53D59F treats the authored width as full width.
        const w=(line.beam?(c(0x8c0)+(sampleCurve(line.widthEnd,age,r)-c(0x8c0))*t)*.5:widths[section]*(1-fraction)+widths[section+1]*fraction)*Math.max(...scale.map(Math.abs));
        const u=(length?distances[i]/length:0)*flipU*uvScale[0]+scroll[0]-random(41,0)*material.jitter[0];
        return [-1,0,1].map((sign,column)=>({point:add3(p,mul(sides[i],sign*w)),uv:[u,0.5+sign*0.5*uvScale[1]*flipV+scroll[1]+random(42,0)*material.jitter[1]],color:packed(lineColor(colors,t,column,mid),mc).map((n,k)=>Math.min(k===3?1:255/128,n/128))}));
      });
      for(let i=1;i<points;i++)for(let column=0;column<2;column++){
        const q=[rows[i-1][column],rows[i-1][column+1],rows[i][column],rows[i][column+1]];
        out.push({corners:q.map(x=>x.point),uv:q.map(x=>x.uv),colors:q.map(x=>x.color),texture:material.type===4?null:material.texture,blend:material.blend,tint,repeat:true});
        if(out.length>=8192)return out;
      }
    }
  }
  return out;
}

// Build a seekable history from world positions, not a queue populated only
// during playback. Scrubbing, pause, replay and loop must produce the same tail.
export function ribbonStrips(line,age,seed,{forward,right,point,vector,generatorColor=[128,128,128,128],opacity=100}={}){
  const out=[],r=random01(seed,0),c=at=>sampleCurve(line.curves[at],age,r),colors=line.colors.map(x=>sampleColor(x,age,r));
  const history=Math.min(47,Math.floor(age)+1+line.prewarm);if(history<3||line.segments<2)return out;
  for(let strand=0;strand<line.strands;strand++){
    const random=channel=>random01(seed+strand*65537,channel),f=at=>line.fixed[at],range=(at,channel)=>f(at)+random(channel)*f(at+4);
    const angle=line.regularAngles?f(0xeb4)+strand*f(0xeb8):random(1)*2*Math.PI,radius=range(0xe78,2),base=[Math.sin(angle)*radius,range(0xe80,3),Math.cos(angle)*radius];
    const radial=mul(normal([base[0],0,base[2]]),range(0xe90,4)),vertical=range(0xe88,5),phase=range(0xe98,6);
    const path=[];for(let k=0;k<history;k++){
      const t=Math.max(0,Math.floor(age)-k),velocity=add3(radial,[0,Math.cos((t+line.prewarm)*phase)*vertical,0]);
      path.push(add3(point(t,base),mul(vector(t,velocity),k)));
    }
    // Native limits the tail by travelled distance, then resamples it. Keep
    // its original authored length instead of drawing a fixed number of tiles.
    const maximum=c(0x208)*range(0xe70,7),lengths=[0];
    let used=path.length;
    for(let i=1;i<path.length;i++){
      const distance=Math.hypot(...sub(path[i],path[i-1])),total=lengths.at(-1)+distance;
      if(maximum>0&&total>=maximum){path[i]=lerp(path[i-1],path[i],distance?(maximum-lengths.at(-1))/distance:0);lengths.push(maximum);used=i+1;break;}
      lengths.push(total);
    }
    path.length=used;const length=lengths.at(-1);if(length<1e-7)continue;
    const points=Array.from({length:line.segments},(_,i)=>{
      const distance=i/(line.segments-1)*length;let j=1;while(j<lengths.length-1&&lengths[j]<distance)j++;
      const span=lengths[j]-lengths[j-1],u=span?(distance-lengths[j-1])/span:0;
      // Native uses Hermite interpolation. The control velocities are not
      // completely decoded yet; interpolate the decoded history positions.
      return lerp(path[j-1],path[j],u);
    });
    const sides=points.map((p,i)=>{const axis=cross(sub(points[Math.min(points.length-1,i+1)],points[Math.max(0,i-1)]),forward);return Math.hypot(...axis)>1e-7?unit3(axis):right;});
    // 53AA40 averages the two endpoint widths unless EAD enables the
    // separately authored middle. 53BCA1 then halves the sampled full width
    // before adding/subtracting it on either side of the centre line.
    const width=c(0x228)*0.5,head=range(0xe60,8),tail=range(0xe68,9),mid=line.asymmetric?range(0xecc,10):(head+tail)/2;
    const widths=[head,mid,tail].map(n=>n*width),middle=clamp(c(0x248),0.0001,0.9999);
    for(let pass=0;pass<line.materials.length;pass++){
      const material=line.materials[pass];if(!material.type)continue;
      const scroll=sampleVector(material.scroll,age,r),mc=sampleColor(material.color,age,r),flipU=line.flipU&&random(11)<0.5?-1:1,flipV=line.flipV&&random(12)<0.5?-1:1;
      const tint=generatorColor.map((n,i)=>i===3?Math.min(1,n/128*clamp(opacity,0,100)/100):n/128);
      const uvRandom=pass*2,offsetU=scroll[0]+random(20+uvRandom)*material.jitter[0],offsetV=scroll[1]+random(21+uvRandom)*material.jitter[1];
      const rows=points.map((p,i)=>{
        const t=i/(points.length-1),w=t<middle?widths[0]+(widths[1]-widths[0])*t/middle:widths[1]+(widths[2]-widths[1])*(t-middle)/(1-middle);
        return [-1,0,1].map((sign,column)=>({point:add3(p,mul(sides[i],sign*w)),uv:[t*flipU*c(0x860+pass*32)+offsetU,0.5+sign*0.5*c(0x920+pass*32)*flipV+offsetV],color:packed(lineColor(colors,t,column,c(0x800+pass*32)),mc).map((n,k)=>Math.min(k===3?1:255/128,n/128))}));
      });
      for(let i=1;i<points.length;i++)for(let column=0;column<2;column++){
        const q=[rows[i-1][column],rows[i-1][column+1],rows[i][column],rows[i][column+1]];
        out.push({corners:q.map(x=>x.point),uv:q.map(x=>x.uv),colors:q.map(x=>x.color),texture:material.type===4?null:material.texture,blend:material.blend,tint,repeat:true});
        if(out.length>=8192)return out;
      }
    }
  }
  return out;
}

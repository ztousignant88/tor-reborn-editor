// Native EFX attachment positions: 533BF0 (point), 533DB0 (linear),
// 5340F0/5344B0 (three-/four-point routes). Curves come from the asset.
import {readCurve,sampleCurve,readVector,sampleVector} from './efx.js';
import {add3,mul3,unit3} from './efxmath.js';
const defs=new WeakMap(),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const lerp=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*t),sub=(a,b)=>a.map((n,i)=>n-b[i]);
const heightStep=0.408248961;
export function readAttachment(d){
  if(defs.has(d))return defs.get(d);
  const b=d.body,v=new DataView(b.buffer,b.byteOffset,b.byteLength),kind=b[0x138];
  const point=at=>({offset:readVector(d,at),kind:b[at+0x70],subtype:b[at+0x71],reference:v.getUint32(at+0x68,true),matrixFlags:b[at+0x73]|b[at+0x75]<<1|b[at+0x76]<<2});
  const a={kind,position:readVector(d,0),rotation:readVector(d,0x68),scale:readVector(d,0xd0),order:b[0x13a],aim:b[0x139],delay:v.getUint16(0x13e,true),duration:v.getUint16(0x140,true)};
  if(kind===0)a.from=point(0x148);
  if(kind===1)Object.assign(a,{from:point(0x168),to:point(0x228),progress:readCurve(d,0x148)});
  if(kind===2||kind===3)Object.assign(a,{from:point(0x148),to:point(0x208),along:readCurve(d,0x2c8),radius:readCurve(d,0x2e8),angle:readCurve(d,0x308),randomAngle:!!b[0x32a],progress:readCurve(d,kind===2?0x378:0x428)});
  if(kind===3)Object.assign(a,{along2:readCurve(d,0x378),radius2:readCurve(d,0x398),angle2:readCurve(d,0x3b8),randomAngle2:!!b[0x3da]});
  defs.set(d,a);return a;
}
export function sampleEffectPoint(p,t,context,r=0.5){
  let origin=context.origin;
  if(p.kind===1||p.kind===2){
    const h=p.kind===1?context.casterHeight:context.targetHeight;
    const y=p.subtype===1?heightStep:p.subtype===2?3*heightStep:p.subtype===3?h:p.subtype===4?Math.max(heightStep/2,h-heightStep):0;
    origin=context.unitPoint?.(p.reference,p.kind,p.subtype)??add3(p.kind===1?context.caster:context.target,[0,y,0]);
  }else if(p.kind===8)origin=context.target;
  else if(p.kind===15){
    // Native 4FDF58 reads the sequence's cached destination (+0x420).
    // The normal battle sequence seeds this from the selected impact tile.
    origin=context.unitPoint?.(p.reference,p.kind,p.subtype)??context.impactPoint??context.target;
  }else if(p.kind===16)origin=context.target;
  return add3(origin,sampleVector(p.offset,t,r));
}
// 40CC80 aligns local X to the chord, Y to up × chord, and Z to X × Y.
function chordAxes(direction){
  const x=unit3(direction),y=unit3(cross([0,1,0],x)),z=unit3(cross(x,y));return [x,y,z];
}
export function attachmentBasis(direction,order){
  const d=unit3(direction),side=unit3(cross([0,1,0],d)),up=unit3(cross(d,side));
  return order<2?chordAxes(direction):order<4?[side,d,unit3(cross(side,d))]:[side,up,d];
}
export function applyBasis(point,basis){return [0,1,2].map(i=>basis[0][i]*point[0]+basis[1][i]*point[1]+basis[2][i]*point[2]);}
const quadratic=(a,b,c,u)=>a.map((n,i)=>(1-u)**2*n/2+((1-u)*u+0.5)*b[i]+u*u*c[i]/2);
export function sampleAttachment(d,clock,context,r=0.5){
  const a=readAttachment(d);if(a.kind>3)return null;
  const t=Math.max(0,Math.min(a.duration||Infinity,clock-a.delay)),from=sampleEffectPoint(a.from,t,context,r),to=a.to?sampleEffectPoint(a.to,t,context,r):from;
  let origin=from;
  if(a.kind===1)origin=lerp(from,to,sampleCurve(a.progress,t,r));
  if(a.kind===2||a.kind===3){
    const basis=chordAxes(sub(to,from)),controlPoint=(along,radiusCurve,angleCurve,randomAngle)=>{
      const base=lerp(from,to,sampleCurve(along,t,r)),radius=sampleCurve(radiusCurve,t,r),angle=sampleCurve(angleCurve,randomAngle?0:t,r);
      return add3(base,applyBasis([0,Math.sin(angle)*radius,Math.cos(angle)*radius],basis));
    };
    const control=controlPoint(a.along,a.radius,a.angle,a.randomAngle);
    if(a.kind===3){
      const control2=controlPoint(a.along2,a.radius2,a.angle2,a.randomAngle2),lengths=[sub(control,from),sub(control2,control),sub(to,control2)].map(v=>Math.hypot(...v)),total=2*lengths.reduce((s,n)=>s+n,0),u=sampleCurve(a.progress,t,r);
      if(total){
        const left=lengths[0]/total,middle=2*left+lengths[1]/total,right=1-lengths[2]/total;
        if(u<left)origin=left?lerp(from,control,u/(2*left)):from;
        else if(u>=right)origin=right<1?lerp(control2,to,(u-(2*right-1))/(2*(1-right))):to;
        else if(u<middle)origin=middle>left?quadratic(from,control,control2,(u-left)/(middle-left)):control;
        else origin=right>middle?quadratic(control,control2,to,(u-middle)/(right-middle)):control2;
      }
    }else{
    const d1=Math.hypot(...sub(control,from)),d2=Math.hypot(...sub(to,control)),total=2*(d1+d2),u=sampleCurve(a.progress,t,r);
    if(total){
      const left=d1/total,right=1-d2/total;
      if(u<=left)origin=left?lerp(from,control,u/(2*left)):from;
      else if(u>=right)origin=right<1?lerp(control,to,(u-2*left)/(1-2*left)):to;
      else{
        const v=(u-left)/(right-left);
        origin=quadratic(from,control,to,v);
      }
    }
    }
  }
  const position=add3(origin,sampleVector(a.position,t,r)),direction=a.aim===4?sub(from,origin):a.aim===5?sub(to,origin):null;
  return {position,rotation:sampleVector(a.rotation,t,r),scale:sampleVector(a.scale,t,r),order:a.order,basis:direction&&Math.hypot(...direction)>1e-8?attachmentBasis(direction,a.order):null,unitPicture:a.aim===2&&!!(a.from.matrixFlags&4)};
}

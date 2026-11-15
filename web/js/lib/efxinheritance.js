// Native 503796–503805: child emitters optionally inherit their parent's
// *evaluated* scale/rotation, and its initial packed colour. These values are
// frozen when the child is born, not resampled from the parent each frame.
import {sampleVector,sampleColor} from './efx.js';
const vector=(c,t,r,fallback)=>c?sampleVector(c,t,r):fallback.slice();
const packed=(a,b)=>a.map((n,i)=>Math.max(0,Math.min(255,Math.floor(Math.floor(n)*Math.floor(b[i])/128))));
export function particleGeneration(p){
  if(p.generation)return p.generation;
  const {g,birth,random:r}=p;
  const state={scale:vector(g.scale,birth,r,[1,1,1]),rotation:vector(g.rotation,birth,r,[0,0,0]),spin:vector(g.spin,birth,r,[0,0,0]),color:sampleColor(g.color,birth,r)};
  if(p.parent){
    const age=Math.max(0,p.start-p.parent.start),parent=particleAppearance(p.parent,age);
    if(g.parentScale)state.scale=state.scale.map((n,i)=>n*parent.scale[i]);
    if(g.parentRotation){state.rotation=state.rotation.map((n,i)=>n+parent.rotation[i]);state.spin=state.spin.map((n,i)=>n+parent.generation.spin[i]);}
    // Native +1F0 is the parent's initial colour, not the sprite's animated
    // colour at +1F4. Using the latter would fade children twice.
    if(g.parentColor)state.color=packed(state.color,particleInitialColor(p.parent));
  }
  return p.generation=state;
}
export function particleInitialColor(p){
  const inherit=p.e.inheritColor??(p.e.body?!!p.e.body[0x8a]:true);
  return inherit?particleGeneration(p).color:[128,128,128,128];
}
export function particleAppearance(p,age){
  const {e,random:r}=p,generation=particleGeneration(p),scaleCurve=e.scale??e.line?.scale,rotationCurve=e.rotation??e.line?.rotation;
  const scale=vector(scaleCurve,age,r,[1,1,1]).map((n,i)=>n*((!scaleCurve||e.inheritScale)?generation.scale[i]:1));
  const rotation=vector(rotationCurve,age,r,[0,0,0]);
  if(!rotationCurve||e.inheritRotation)for(let i=0;i<3;i++)rotation[i]+=generation.rotation[i]+generation.spin[i]*age;
  return {scale,rotation,generation};
}

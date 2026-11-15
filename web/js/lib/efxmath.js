// Row-vector rotation orders used by native 5418C0 and 5357A0.
const ORDERS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
export const add3=(a,b)=>a.map((n,i)=>n+b[i]);
export const mul3=(a,b)=>a.map((n,i)=>n*b[i]);
export function rotate3(point,angles,order=0){
  let [x,y,z]=point;
  for(const axis of ORDERS[order]??ORDERS[0]){
    const c=Math.cos(angles[axis]),s=Math.sin(angles[axis]);
    if(axis===0)[y,z]=[y*c-z*s,y*s+z*c];
    else if(axis===1)[x,z]=[x*c+z*s,-x*s+z*c];
    else [x,y]=[x*c-y*s,x*s+y*c];
  }
  return [x,y,z];
}
export function random01(seed,channel=0){
  let n=Math.imul(seed^Math.imul(channel+1,0x9e3779b9),0x85ebca6b);
  n=Math.imul(n^(n>>>13),0xc2b2ae35);return ((n^(n>>>16))>>>0)/4294967296;
}
export function unit3(a){const n=Math.hypot(...a);return n?a.map(x=>x/n):[1,0,0];}

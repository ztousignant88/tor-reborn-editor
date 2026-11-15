// Frame world-space effect artwork without rescaling or moving its vertices.
// Screen-space overlays do not determine the world camera's bounds.
export function effectFrame(packets,{right,up,forward,aspect=1,margin=1.12}={}){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],axes=[right,up,forward];let count=0;
  for(const b of packets){
    if(!b.particle||b.screenSpace)continue;
    for(const p of b.corners??[]){
      if(!p.every(Number.isFinite))continue;count++;
      for(let k=0;k<3;k++){const n=p.reduce((s,v,i)=>s+v*axes[k][i],0);lo[k]=Math.min(lo[k],n);hi[k]=Math.max(hi[k],n);}
    }
  }
  if(!count)return null;
  const centre=lo.map((n,k)=>(n+hi[k])/2),target=[0,1,2].map(i=>axes.reduce((s,a,k)=>s+a[i]*centre[k],0));
  return {target,radius:Math.max(1,(hi[1]-lo[1])/2,(hi[0]-lo[0])/(2*Math.max(.1,aspect)))*margin};
}

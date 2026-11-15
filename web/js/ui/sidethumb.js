import {atlases} from '../game/lookimport.js';
import {textureRGBA,rgbaCanvas} from './texcanvas.js';

/** Front-on preview of the two native triangles in one wall-step sample. */
export function sideThumb(map,quad){
  if(!map.atlasPicture){const {color}=atlases(map.scene),rgba=textureRGBA(color);map.atlasPicture={canvas:rgbaCanvas(color.width,color.height,rgba),rgba,width:color.width,height:color.height};}
  const atlas=map.atlasPicture,c=document.createElement('canvas');c.width=112;c.height=56;
  const ctx=c.getContext('2d'),corners={tl:[2,2],tr:[110,2],bl:[2,54],br:[110,54]};
  ctx.imageSmoothingEnabled=false;
  for(const tri of quad.tris){
    const d=tri.map(v=>corners[v.corner]),s=tri.map(v=>[v.uv[0]*atlas.width,v.uv[1]*atlas.height]);
    const u1=s[1][0]-s[0][0],v1=s[1][1]-s[0][1],u2=s[2][0]-s[0][0],v2=s[2][1]-s[0][1],den=u1*v2-u2*v1;
    if(Math.abs(den)<1e-6)continue;
    const x1=d[1][0]-d[0][0],y1=d[1][1]-d[0][1],x2=d[2][0]-d[0][0],y2=d[2][1]-d[0][1];
    const a=(x1*v2-x2*v1)/den,b=(y1*v2-y2*v1)/den,cc=(x2*u1-x1*u2)/den,dd=(y2*u1-y1*u2)/den;
    ctx.save();ctx.beginPath();d.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();
    ctx.setTransform(a,b,cc,dd,d[0][0]-a*s[0][0]-cc*s[0][1],d[0][1]-b*s[0][0]-dd*s[0][1]);ctx.drawImage(atlas.canvas,0,0);ctx.restore();
  }
  return c;
}

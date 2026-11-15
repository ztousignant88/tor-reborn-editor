// Editor-side planning learned from original neighboring tiles. This is not
// claimed to be the game's unknown authoring algorithm. Only flat ground
// samples are eligible: never copy a house, stair or elevated decoration.
import {tileTops,groundLook,importLook} from './lookimport.js';

const DIRS=[[0,-1],[1,0],[0,1],[-1,0],[-1,-1],[1,-1],[1,1],[-1,1]];
const kindAt=(map,i,original=false)=>map.materials[(original?map.originalTile(i):map.tiles[i]).surface]?.kind??-1;
const hash=(x)=>{x=Math.imul(x^(x>>>16),0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return (x^(x>>>16))>>>0;};
// Which edge of the tile a top triangle covers: 0 north, 1 east, 2 south, 3 west.
const edgeOf=(tri)=>{const cx=(tri[0].pos[0]+tri[1].pos[0]+tri[2].pos[0])/3,cz=(tri[0].pos[2]+tri[1].pos[2]+tri[2].pos[2])/3;return cz<.2?0:cx>.8?1:cz>.8?2:cx<.2?3:-1;};
export function terrainSignature(map,index,original=false) {
  const tile=original?map.originalTile(index):map.tiles[index],kind=kindAt(map,index,original),x=index%map.width,y=Math.floor(index/map.width);
  return DIRS.map(([dx,dy])=>{
    const t=map.tileAt(x+dx,y+dy);if(!t)return null;
    const n=original?map.originalTile(t.index):t,k=kindAt(map,t.index,original);
    return {same:k===kind,kind:k,height:Math.sign(n.height-tile.height)};
  });
}

export function terrainLibrary(map) {
  if(map.terrainLibrary)return map.terrainLibrary;
  const tops=tileTops(map),byKind=new Map(),safe=new Set();
  for(const tile of map.tiles){
    const o=map.originalTile(tile.index),tris=tops[tile.index].tris;
    if(!tris.length||tris.some(tri=>tri.some(v=>Math.abs(v.pos[1])>.001)))continue;
    // All copied vertices must stay inside the tile; large art crosses tiles.
    if(tris.some(tri=>tri.some(v=>v.pos[0]<-.001||v.pos[0]>1.001||v.pos[2]<-.001||v.pos[2]>1.001)))continue;
    const kind=kindAt(map,tile.index,true);if(kind<0)continue;
    const material=map.materials[o.surface],code=map.materials.find(m=>m.kind===kind&&m.family===material.family&&m.object===null)?.code;
    if(code===undefined)continue;
    safe.add(tile.index);
    if(!byKind.has(kind))byKind.set(kind,[]);
    const corners=new Map();
    for(const tri of groundLook(map,tile.index).tops){
      const xs=tri.map(v=>v.pos[0]),zs=tri.map(v=>v.pos[2]),cx=xs.reduce((a,b)=>a+b)/3,cz=zs.reduce((a,b)=>a+b)/3;
      const edge=cz<.2?0:cx>.8?1:cz>.8?2:cx<.2?3:-1;
      if(edge>=0&&!corners.has(edge))corners.set(edge,tri);
    }
    byKind.get(kind).push({index:tile.index,surface:code,family:material.family,key:tops[tile.index].key,signature:terrainSignature(map,tile.index,true),corners:corners.size===4&&tris.length===4?corners:null});
  }
  return map.terrainLibrary={byKind,safe};
}

function mismatch(want,have,directions=null) {
  let score=0,edges=0;
  for(let d=0;d<8;d++){
    if(directions&&!directions.includes(d))continue;
    const a=want[d],b=have[d];if(!a&&!b)continue;
    const weight=d<4?8:3;
    if(!a||!b){score+=weight;edges++;continue;}
    if(a.same!==b.same){score+=weight;edges++;}
    else if(!a.same&&a.kind!==b.kind){score+=d<4?2:1;edges++;}
    if(a.height!==b.height){score+=d<4?6:2;edges++;}
  }
  return {score,edges};
}

// `donor` (another map's MapFile, optional): when this map has no edge piece
// for a border, a piece of the donor with exactly that border is copied into
// this map's atlas (lookimport.js) and used instead of an approximate one.
export function planTerrain(map,indices,{kind,seed=0,height=null,donor=null}={}) {
  const library=terrainLibrary(map),samples=library.byKind.get(Number(kind))??[];
  const lent=donor&&donor!==map?terrainLibrary(donor).byKind:null;
  const lentFor=(k)=>lent?.get(k)?.filter(s=>s.corners)??[];
  const paintCode=samples[0]?.surface??map.materials.find(m=>m.kind===Number(kind)&&m.object===null)?.code;
  if(paintCode===undefined)throw new Error('This map has no terrain code for that terrain.');
  if(!samples.length&&!lentFor(Number(kind)).length)throw new Error('This map has no flat samples for that terrain.');
  let borrowed=0,borrowError=null;
  const painted=new Set(),affected=new Set(),skipped=[];
  // A temporary view: plan against the whole proposed stroke, never the
  // iteration order of its individual cells.
  const proposed=new Map();
  for(const i of indices){
    const t=map.tiles[i];if(!t||t.object!==null||!library.safe.has(i)||map.looks.get(i)?.foreign){skipped.push(i);continue;}
    painted.add(i);proposed.set(i,{...t,height:height===null?t.height:Math.max(0,Math.min(60,Math.round(height))),surface:paintCode});
  }
  const virtual=Object.create(map);virtual.tiles=map.tiles.map((t,i)=>proposed.get(i)??t);
  virtual.tileAt=(x,y)=>x>=0&&y>=0&&x<map.width&&y<map.depth?virtual.tiles[y*map.width+x]:null;
  for(const i of painted){
    affected.add(i);const t=map.tiles[i];
    for(const [dx,dy] of DIRS){const n=map.tileAt(t.x+dx,t.y+dy);if(n&&library.safe.has(n.index)&&n.object===null&&!map.looks.get(n.index)?.foreign)affected.add(n.index);}
  }
  const changes=[],approximate=[];
  for(const i of [...affected].sort((a,b)=>a-b)){
    const t=virtual.tiles[i],tileKind=kindAt(virtual,i),list=library.byKind.get(tileKind)??[],lentList=lentFor(tileKind);
    if(!list.length&&!lentList.length)continue;
    const want=terrainSignature(virtual,i),rank=list.map(s=>({...s,...mismatch(want,s.signature)}));
    const bestScore=rank.length?Math.min(...rank.map(r=>r.score)):Infinity,best=rank.filter(r=>r.score===bestScore);
    // Stable per-cell variation. Equal patterns with the same art aren't
    // overrepresented just because the original map repeats them often.
    const variants=[...new Map(best.map(s=>[s.key,s])).values()].sort((a,b)=>a.index-b.index);
    const chosen=variants.length?variants[hash(i^Math.imul(seed+1,0x9e3779b1))%variants.length]:null;
    const current=map.looks.get(i)??i;
    const stable=painted.has(i)?null:best.find(s=>s.index===current);
    // no sample of this terrain on this map at all: every piece comes from the donor
    const result=stable??chosen??{index:i,edges:1,family:lentList[0].family,surface:paintCode};
    if(result.edges)approximate.push(i);
    let look=result.index===i?undefined:result.index,approx=result.edges>0;
    // Shipped flat tiles commonly use four triangles meeting at the centre.
    // Plan these edge pieces separately when no whole-tile sample matches.
    // This covers far more new shore/grass arrangements than whole-tile copying.
    const localDirections=[[0,4,5],[1,5,6],[2,6,7],[3,7,4]];
    if(bestScore>0&&(list.some(s=>s.corners)||lentList.length)){
      const tops=[],ids=[],uses=new Set();let whole=true,edgeApprox=false;
      for(let edge=0;edge<4;edge++){
        const pick=(pool,salt)=>{
          const ranked=pool.map(s=>({...s,...mismatch(want,s.signature,localDirections[edge])}));
          if(!ranked.length)return null;
          const min=Math.min(...ranked.map(r=>r.score)),best=ranked.filter(r=>r.score===min);
          const variants=[...new Map(best.map(s=>[s.corners.get(edge).map(v=>v.uv.join(',')).join(';'),s])).values()];
          return variants[hash(i^Math.imul(seed+1,0x9e3779b1)^Math.imul(edge+1,0x85ebca6b)^salt)%variants.length];
        };
        const mine=pick(list.filter(s=>s.corners),0);
        // this map has no piece for this border: take one from the donor when it fits better
        const theirs=(!mine||mine.score>0)&&lentList.length?pick(lentList,0x51ed27):null;
        if(theirs&&(!mine||theirs.score<mine.score)){
          try{
            const copy=importLook(map,donor,theirs.index),tri=copy.tops.find(tr=>edgeOf(tr)===edge);
            if(!tri)throw new Error('the donor piece has another shape');
            tops.push(tri);ids.push(`${donor.id}:${theirs.index}`);uses.add(copy.key);borrowed++;
            if(theirs.edges)edgeApprox=true;
            continue;
          }catch(err){borrowError=err.message;}
        }
        if(!mine){whole=false;break;}
        tops.push(mine.corners.get(edge));ids.push(mine.index);if(mine.edges)edgeApprox=true;
      }
      if(whole){approx=edgeApprox;look={planned:true,key:`planned:${ids.join(',')}`,tops,templates:[],kind:tileKind,family:result.family,uses:[...uses]};}
      else approx=true;
    }
    if(approx&&!approximate.includes(i))approximate.push(i);
    if(!approx){const at=approximate.indexOf(i);if(at>=0)approximate.splice(at,1);}
    const previous=map.looks.get(i),sameLook=look===previous||(look?.planned&&previous?.planned&&look.key===previous.key);
    if(t.surface!==map.tiles[i].surface||t.height!==map.tiles[i].height||!sameLook)changes.push({index:i,surface:painted.has(i)?result.surface:t.surface,height:t.height,look});
  }
  return {changes,painted:[...painted].sort((a,b)=>a-b),approximate,skipped:skipped.sort((a,b)=>a-b),borrowed,borrowError};
}

export function applyTerrainPlan(map,plan) {
  for(const c of plan.changes){map.set(c.index,'surface',c.surface);map.set(c.index,'height',c.height);map.setLook(c.index,c.look??null);}
}

export function brushTiles(map,from,to,size=1) {
  const out=new Set(),r=Math.floor(size/2),dx=to.x-from.x,dy=to.y-from.y,steps=Math.max(Math.abs(dx),Math.abs(dy),1);
  for(let n=0;n<=steps;n++){
    const x=Math.round(from.x+dx*n/steps),y=Math.round(from.y+dy*n/steps);
    for(let oy=-r;oy<=r;oy++)for(let ox=-r;ox<=r;ox++){const t=map.tileAt(x+ox,y+oy);if(t)out.add(t.index);}
  }
  return [...out];
}

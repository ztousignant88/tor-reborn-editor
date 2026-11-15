// The body's SAS3 track and bank 10's weapon track share a native pixel origin.
// Composite them before upload so the weapon's signed foreground/background
// priority is respected without introducing a second terrain-depth plane.
import {actionImages,sampleAction} from './sceneanimations.js';

export function composeWeaponAction(body,weapon,palette,projectAction){
  const layers=[body,weapon].map(r=>actionImages(r,{x:0,y:0},palette));
  const images=[],slots=[];
  for(let direction=0;direction<4;direction++){
    const length=Math.max(body.definition.slots[direction]?.length??0,weapon.definition.slots[direction]?.length??0);
    const times=new Set([0,length]);
    for(const r of [body,weapon])for(const c of r.definition.slots[direction]?.commands??[])times.add(c.tick);
    const commands=[];
    for(const tick of [...times].sort((a,b)=>a-b)){
      const parts=[body,weapon].flatMap((r,i)=>{
        let s=sampleAction(r.definition,direction,tick);const f=s&&!s.hidden?layers[i][s.frame]:null;
        if(!f)return [];
        if(s.space!=='screen'&&projectAction)s=projectAction(s,direction);
        if(s.space!=='screen')throw new Error('weapon action requires an unmapped world-space transform');
        const x0=-f.pivotX*f.width,y0=f.height*(f.pivot-1);
        return [{...s,image:f,x:Math.round(s.x+(s.flip?-x0-f.width:x0)),y:Math.round(s.y+(s.flipY?-y0-f.height:y0)),order:i?(s.priority??1):0}];
      }).sort((a,b)=>a.order-b.order);
      if(!parts.length){commands.push({tick,op:7});continue;}
      const x0=Math.min(...parts.map(p=>p.x)),y0=Math.min(...parts.map(p=>p.y));
      const x1=Math.max(...parts.map(p=>p.x+p.image.width)),y1=Math.max(...parts.map(p=>p.y+p.image.height));
      const width=x1-x0,height=y1-y0,rgba=new Uint8Array(width*height*4);
      for(const p of parts)for(let y=0;y<p.image.height;y++)for(let x=0;x<p.image.width;x++){
        const src=((p.flipY?p.image.height-1-y:y)*p.image.width+(p.flip?p.image.width-1-x:x))*4;
        if(p.image.rgba[src+3])rgba.set(p.image.rgba.subarray(src,src+4),((p.y-y0+y)*width+p.x-x0+x)*4);
      }
      const frame=images.length;images.push({rgba,width,height,pivotX:-x0/width,pivot:(y1-8)/height});
      commands.push({tick,op:0,frame,flip:false,flipY:false,x:0,y:0,z:0});
    }
    slots.push({mirror:false,length,commands});
  }
  return {key:`${body.key}+${weapon.key}`,id:body.id,label:weapon.label,rgbaFrames:images,
    definition:{frames:images.map(()=>({cells:[]})),slots,duration:Math.max(...slots.map(s=>s.length))}};
}

/** Conservative preview of automatic equipment: choose only when the native
 * level/class/gender/proficiency filters leave one weapon appearance. Runtime
 * party level is unavailable in an editor, so this uses the record's minimum
 * level; it never writes the generated choice into the battle record. */
export function previewWeapons(row,tables){
  const v=new DataView(row.buffer,row.byteOffset,row.byteLength),weapons=[v.getUint16(0x4a,true),v.getUint16(0x4e,true)];
  if(!tables||!row[0x1c]||weapons.some(w=>w>0))return {weapons};
  const cls=tables.tables.class.row(row[6]),set=cls[0x60],level=Math.max(1,row[8]+row[9]);
  const female=!!tables.template(v.getUint16(2,true))?.female;
  const types=new Set(Array.from({length:4},(_,i)=>v.getUint16(0x22+i*4,true)).filter(s=>s>=1&&s<=20));
  if(!types.size)return {weapons};
  const a=tables.tables.armament,candidates=[];
  for(let i=1;i<a.count;i++){
    const r=a.row(i),w=new DataView(r.buffer,r.byteOffset,r.byteLength);
    if(r[0xe]||r[0x60]===255||r[0x60]>level||!types.has(r[2])||!(w.getBigUint64(0x58,true)&(1n<<BigInt(set))))continue;
    if(r[0xf]===1&&female||r[0xf]===2&&!female)continue;
    candidates.push({id:i,appearance:`${w.getUint16(0x6c,true)}:${r[0x72]}:${r[0x66]}`});
  }
  if(!candidates.length||new Set(candidates.map(c=>c.appearance)).size!==1)return {weapons};
  return {weapons:[candidates[0].id,0],generatedWeapon:{level,candidates:candidates.map(c=>c.id)}};
}

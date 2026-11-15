import {FIELD,readField,encodeField} from './entryunit.js';
const pick=(xs,random)=>xs[Math.min(xs.length-1,Math.floor(random()*xs.length))];
export function templateFamilies(labels,templates){
  const groups=new Map(),families=new Map();
  for(const [id,label]of Object.entries(labels)){
    if (templates && (Number(id)>=templates.count || !templates.row(Number(id)).some(Boolean))) continue;
    const name=templates?label.replace(/^<not used>\s*/i,''):label;
    const m=/^(?!<)(.+)\s+([1-4])$/.exec(name);if(!m)continue;
    if(!groups.has(m[1]))groups.set(m[1],[]);groups.get(m[1]).push(Number(id));
  }
  for(const [name,ids]of groups)for(const id of ids)families.set(id,{name,ids:ids.sort((a,b)=>a-b)});
  return families;
}
export function genericRoster(docs,tables,labels){
  const families=templateFamilies(labels,tables.tables.unitTemplate),groups=new Map(),classAis=new Map();
  for(const doc of docs)for(const slot of doc.unitSlots()){const row=doc.units[slot].row,cls=readField(row,FIELD.class),ai=readField(row,FIELD.ai);if(!ai)continue;if(!classAis.has(cls))classAis.set(cls,new Map());const counts=classAis.get(cls);counts.set(ai,(counts.get(ai)||0)+1);}
  for(const doc of docs)for(const slot of doc.unitSlots()){
    const unit=doc.units[slot],row=unit.row;
    if(readField(row,FIELD.name)||!readField(row,FIELD.randomName))continue;
    const template=readField(row,FIELD.template),family=families.get(template);if(!family)continue;
    const cls=readField(row,FIELD.class),key=`${family.name}:${cls}`;
    if(!groups.has(key))groups.set(key,{key,label:`${family.name} · ${tables.className(cls,tables.isFemale(template))||'Class '+cls}`,family,cls,donors:[],ais:new Map()});
    const g=groups.get(key);g.donors.push(unit);const ai=readField(row,FIELD.ai);if(ai)g.ais.set(ai,(g.ais.get(ai)||0)+1);
  }
  const labelsCount=new Map();for(const g of groups.values())labelsCount.set(g.label,(labelsCount.get(g.label)||0)+1);
  for(const g of groups.values())if(labelsCount.get(g.label)>1)g.label+=` (class ${g.cls})`;
  for(const g of groups.values())if(!g.ais.size)g.ais=classAis.get(g.cls)??new Map();
  return [...groups.values()].filter(g=>g.ais.size).sort((a,b)=>a.label.localeCompare(b.label));
}
export function makeGeneric(group,tables,{team=2,guest=false,x=0,y=0,dir=0,level=1,random=Math.random}={}){
  if(!group?.donors.length)throw new Error('Choose a generic class and race.');
  const donor=pick(group.donors,random),row=donor.row.slice(),set=(field,n)=>row.set(encodeField(field,n),field.offset);
  const template=pick(group.family.ids,random),names=tables.isFemale(template)?[2,4]:[1,3,5];
  for(const f of [FIELD.leader,FIELD.target,FIELD.subtarget])set(f,false);
  set(FIELD.name,0);set(FIELD.template,template);set(FIELD.randomName,pick(names,random));set(FIELD.event,0);
  set(FIELD.appears,1);set(FIELD.appearValue,0);set(FIELD.team,team);set(FIELD.guest,guest);
  set(FIELD.x,x);set(FIELD.z,y);set(FIELD.facing,dir);set(FIELD.levelBase,level);set(FIELD.levelMod,0);
  set(FIELD.element,1+Math.floor(random()*8));
  const ai=[...group.ais].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??readField(donor.row,FIELD.ai);
  set(FIELD.ai,team===1&&!guest?0:ai);
  const sprite=tables.spriteFor(row,donor.row,donor.sprite);if(!sprite)throw new Error('No compatible graphics for this generic template.');
  return {row,sprite};
}

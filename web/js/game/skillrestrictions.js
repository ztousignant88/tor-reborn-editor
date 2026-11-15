import{parseXlce}from'../lib/pakd.js';
import{templateFamilies}from'./genericroster.js';
export const RESTRICTION_NAMES=['Unrestricted / None','Faerie','Gremlin','Pumpkinhead'];
export const restrictionName=id=>RESTRICTION_NAMES[id]??`Custom group ${id}`;
export function restrictionTables(dat){const skills=parseXlce(dat.pakd.entries[25].data),templates=parseXlce(dat.pakd.entries[23].data);if(![102,166].includes(skills.rowSize)||templates.rowSize!==84)throw new Error('Unsupported skill restriction tables');return{skills,templates};}
export function restrictionMembers(dat,kind,group){const t=restrictionTables(dat)[kind],offset=kind==='skills'?0x65:0x53;if(!t)throw new Error('Invalid restriction table');return Array.from({length:t.count},(_,id)=>id).filter(id=>id>0&&t.row(id)[offset]===group&&(kind==='skills'?t.row(id)[2]:t.row(id).some(Boolean)));}
export function usedRestrictionGroups(dat){const groups=new Set([0,1,2,3]);const{skills,templates}=restrictionTables(dat);for(let id=0;id<skills.count;id++)groups.add(skills.row(id)[0x65]);for(let id=0;id<templates.count;id++)groups.add(templates.row(id)[0x53]);return groups;}
export function nextRestrictionGroup(dat,reserved=[]){const used=usedRestrictionGroups(dat);for(const id of reserved)used.add(id);for(let id=4;id<=255;id++)if(!used.has(id))return id;return null;}
export function applyRestrictionAssignments(dat,changes){const tables=restrictionTables(dat),batches=[];for(const[kind,offset]of[['skills',0x65],['templates',0x53]]){const entries=[...(changes[kind]??[])],t=tables[kind];for(const[id,group]of entries)if(!Number.isInteger(id)||id<1||id>=t.count||!Number.isInteger(group)||group<0||group>255)throw new Error(`Invalid ${kind==='skills'?'skill':'template'} or restriction group`);batches.push({entries,t,offset});}let changed=0;for(const{entries,t,offset}of batches)for(const[id,group]of entries){const row=t.row(id);if(row[offset]!==group){row[offset]=group;changed++;}}return changed;}
export function applySkillRestrictions(dat,changes){return applyRestrictionAssignments(dat,{skills:changes});}
// Identify the named four-sheet generic pools without sweeping story/NPC templates into a race edit.
export function genericRestrictionPools(dat,labels){
 const {templates}=restrictionTables(dat);
 const pools=new Set(templateFamilies(labels,templates).values());
 return [...pools].filter(({ids})=>ids.length===4&&new Set(ids.map(id=>templates.row(id)[0x39])).size===1);
}

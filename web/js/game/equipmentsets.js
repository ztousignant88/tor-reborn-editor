import{parseXlce}from'../lib/pakd.js';
export const EQUIPMENT_SET_OFFSET=0x77;
export const EQUIPMENT_SET_SKILLS=[0,190,195,277,200,675,169];
export function equipmentTable(dat){const t=parseXlce(dat.pakd.entries[11].data);if(t.rowSize!==152)throw new Error('Unsupported equipment table');return t;}
export function equipmentSetMembers(dat,set){return Array.from({length:equipmentTable(dat).count-1},(_,i)=>i+1).filter(id=>equipmentTable(dat).row(id)[EQUIPMENT_SET_OFFSET]===set);}
export function applyEquipmentSet(dat,set,ids){
 if(!Number.isInteger(set)||set<1||set>6)throw new Error('The native game supports set IDs 1–6');const t=equipmentTable(dat),members=new Set(ids);
 for(const id of members)if(!Number.isInteger(id)||id<1||id>=t.count)throw new Error('Equipment ID is out of range');
 let changed=0;for(let id=1;id<t.count;id++){const row=t.row(id),before=row[EQUIPMENT_SET_OFFSET],after=members.has(id)?set:before===set?0:before;if(before!==after){row[EQUIPMENT_SET_OFFSET]=after;changed++;}}return changed;
}

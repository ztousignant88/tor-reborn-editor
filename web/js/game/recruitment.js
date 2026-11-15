import {parseXlce,view} from '../lib/pakd.js';
import {appendRow,copyRow} from './unitcopies.js';
import {FIELD,UNIT_ROW_SIZE} from './entryunit.js';

const BASE_LEVEL=FIELD.levelBase.offset, TEAM=FIELD.team.offset, GUEST=FIELD.guest.offset;
export const needsRecruitmentRepair = row => row?.length === UNIT_ROW_SIZE && (!row[BASE_LEVEL] || row[TEAM] !== 1);
export const recruitNameId = row => view(row).getUint16(FIELD.name.offset,true);
export const recruitTemplateId = row => view(row).getUint16(FIELD.template.offset,true);

function templateRow(table,template){
  for(let i=0;i<table.count;i++){
    const row=table.row(i);
    if(recruitTemplateId(row)===template)return row;
  }
  return null;
}

export function recruitmentTarget(data,type,param){
  if(!data || type===4)return null;
  const table=parseXlce(data);
  if(table.rowSize!==UNIT_ROW_SIZE)return null;
  if(type===3)return param>0 && param<=table.count?{row:table.row(param-1),type,param}:null;
  // AddUnit/AddGuest search the embedded table by its template word at +0x02.
  const row=templateRow(table,param);
  if(row)return {row,type,param};
  // Earlier editor builds wrote the name word at +0x00 instead.
  const legacy=copyRow(data,param);
  if(!legacy)return null;
  const template=recruitTemplateId(legacy),first=templateRow(table,template);
  if(first?.byteOffset===legacy.byteOffset)return {row:legacy,type,param:template};
  if(type===2)return {row:legacy,type:3,param:1+(legacy.byteOffset-table.row(0).byteOffset)/UNIT_ROW_SIZE};
  return null;
}

export function recruitmentRow(row,{guest=false,level=1,levelLimit=50}={}){
  if(row?.length!==UNIT_ROW_SIZE)throw new Error('The selected character has no complete unit record');
  const donor=row.slice();
  if(!Number.isInteger(level)||level<1||level>levelLimit)throw new Error(`Choose a level between 1 and ${levelLimit}`);
  donor[TEAM]=1;
  donor[GUEST]=Number(guest);
  donor[BASE_LEVEL]=level;
  donor[FIELD.levelMod.offset]=0;
  return donor;
}

export function recruitmentCopy(table,row,{guest=false,level,levelLimit=50}={}){
  const donor=recruitmentRow(row,{guest,level,levelLimit});
  const name=recruitNameId(donor),template=recruitTemplateId(donor);
  if(!template)throw new Error('The selected character has no unit template');
  let out=table.slice();
  const existing=name&&templateRow(parseXlce(out),template);
  const named=name&&(!existing||recruitNameId(existing)===name);
  if(!named&&guest)throw new Error('This character needs a specific unit row. Choose Joins the army.');
  if(named&&existing)existing.set(donor);else out=appendRow(out,donor);
  // AddGeneralUnit selects a specific 1-based row when the template is shared.
  return {table:out,type:named?(guest?1:2):3,param:named?template:parseXlce(out).count};
}

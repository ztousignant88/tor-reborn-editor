import{parseXlce,view}from'../lib/pakd.js';
export function rewardRow(dat,id){const t=parseXlce(dat.pakd.entries[70].data);if(t.rowSize!==12||!Number.isInteger(id)||id<1||id>=t.count)throw new Error('Invalid bonus reward preset');return t.row(id);}
export function readBonusReward(row){const v=view(row),read=(type,id,quantity)=>({type:row[type],item:v.getUint16(id,true),amount:v.getUint16(id,true),quantity:v.getUint16(quantity,true)});return {mode:row[0],primary:read(1,2,4),alternate:read(6,8,10)};}
export function encodeBonusReward(row,data){
 const out=row.slice(),v=view(out),whole=(n,max,label)=>{if(!Number.isInteger(n)||n<0||n>max)throw new Error(`${label} must be a whole number from 0 to ${max}`);return n;};out[0]=whole(data.mode,2,'Reward rule');
 for(const [part,type,id,quantity]of [[data.primary,1,2,4],[data.alternate,6,8,10]]){out[type]=whole(part.type,2,'Reward type');v.setUint16(id,part.type===1?whole(part.item,65535,'Item ID'):part.type===2?whole(part.amount,65535,'Goth'):0,true);v.setUint16(quantity,part.type===1?whole(part.quantity,65535,'Quantity'):part.type===2?1:0,true);if(part.type===1&&(!part.item||!part.quantity))throw new Error('Choose an item and a quantity of at least 1');}
 return out;
}
export function duplicateBonusReward(dat,id){const old=dat.pakd.entries[70].data,t=parseXlce(old);if(t.count>=256)throw new Error('All 255 reward preset IDs are in use');const row=rewardRow(dat,id),head=view(old).getUint32(8,true),body=head+t.count*12,out=new Uint8Array((body+12+15)&~15);out.set(old.subarray(0,body));out.set(row,body);view(out).setUint32(4,t.count+1,true);return {data:out,id:t.count};}

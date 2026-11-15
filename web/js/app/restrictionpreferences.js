import{source}from'../game/source.js';
import{restrictionName}from'../game/skillrestrictions.js';
const pathKey=value=>String(value??'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
export class RestrictionPreferences{
 constructor(info,storage=globalThis.localStorage){this.storage=storage;this.info=info;this.migrated=false;this.key=`tor-editor:skill-restrictions:v1:${encodeURIComponent(JSON.stringify([pathKey(info.dataRoot),pathKey(info.projectRoot),pathKey(info.project)]))}`;this.groups={};let raw;try{raw=JSON.parse(storage?.getItem(this.key)??'null');}catch{}for(const[id,name]of Object.entries(raw?.groups??{}))if(/^\d+$/.test(id)&&Number(id)>=0&&Number(id)<=255&&typeof name==='string')this.groups[Number(id)]=name.slice(0,80);this.original=this.serialize();}
 static async load(info,storage=globalThis.localStorage){const prefs=new RestrictionPreferences(info,storage),saved=await source.restrictionGroups();if(saved.exists){prefs.groups={...saved.settings.groups};prefs.original=prefs.serialize();}else if(prefs.ids().length){prefs.migrated=true;prefs.original=JSON.stringify({version:1,groups:{}});}return prefs;}
 setScope(info){this.info=info;}
 ids(){return Object.keys(this.groups).map(Number);}
 name(id){return this.groups[id]||restrictionName(id);}
 serialize(){return JSON.stringify({version:1,groups:Object.fromEntries(this.ids().sort((a,b)=>a-b).map(id=>[id,this.groups[id]]))});}
 get dirty(){return this.serialize()!==this.original;}
 create(id){if(!Number.isInteger(id)||id<4||id>255)throw new Error('Custom groups must use IDs 4–255');this.groups[id]??='';}
 rename(id,name){if(!Number.isInteger(id)||id<0||id>255)throw new Error('Invalid group');const value=String(name).trim().slice(0,80);if(value&&value!==restrictionName(id))this.groups[id]=value;else if(id>=4)this.groups[id]='';else delete this.groups[id];}
 async save(){if(!this.dirty)return false;const bytes=this.serialize();await source.saveRestrictionGroups(this.info,JSON.parse(bytes));this.original=bytes;this.migrated=false;return true;}
}

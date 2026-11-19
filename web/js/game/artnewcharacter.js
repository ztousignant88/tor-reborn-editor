import {source} from './source.js';
import {readFileRegistry} from '../lib/filetable.js';
import {unpackArt,rebuildPakd,verifyArtCompression} from '../lib/artrebuild.js';
import {parsePakd,parseXlce,buildPakdWithIds,view} from '../lib/pakd.js';
import {zipSingle} from '../lib/zip.js';
import {encrypt} from '../lib/crypt.js';
import {sha256} from '../lib/artfiles.js';
import {scanArt,artFiles,readArtArchive,artArchiveFromBytes,artAnimationBank} from './artassets.js';
import {characterImportPlan} from './artcharacterimport.js';
import {actorNames} from './unitsprites.js';
import {poseGroup} from './actorposes.js';
import {renameObject,parseArc,buildArc,renameArcRecord,appendActor,appendTemplate} from './artregistry.js';

/**
 * Clone a saved appearance into new native IDs; do not edit its donor. Humanoids and
 * large monsters (Cyclops / golem family 8) are supported. With `art` ({bodyPNGs,
 * portraitPNG, colourMode, ...characterImportPlan options}) the new character takes that
 * artwork in the same plan, through the normal character import, so it never needs a
 * second replace step.
 */
// sheet bytes that describe how the body moves and animates: move type, class set, race,
// animation override, type byte, species. Tribe, aura (0x05, 0x11), the 0x0C-0x10 flags and
// innate weapons stay with the base sheet: the only sheets with large-monster sprites
// (506-510) are special ones with a boss aura, tribe 7 and innate attacks.
const BODY_FIELDS=[0x06,0x30,0x38,0x39,0x3c,0x3e,0x3f];  // 0x06 = undead
/** Default class for large monsters: Cyclops (43). Two stock Cyclops units use 253 (named Ifrit), which is also allowed. */
export const LARGE_MONSTER_CLASS=43;
/** The appearance's own character sheet: the chosen one if it uses this sprite, else the last one that does. */
function ownSheet(templates,spriteID,preferred){let found=null,plain=null;for(let i=0;i<templates.count;i++){const row=templates.row(i);if(view(row).getUint16(0x3a,true)!==spriteID)continue;if(i===preferred)return i;found=i;if(!row[0x11])plain=i;}return plain??found;}  // ordinary sheets first: boss / summon sheets have the aura flag +0x11
/** Sheets that use an appearance's sprite, for the dialog's defaults. */
export async function appearanceSheets(actor,read=path=>source.read(path).then(r=>r.bytes)){
 const table=readFileRegistry(await read('FileTable.bin')),entry=table.find(e=>e.directory===20&&e.path.toLowerCase()===`object/${actor}.dat`.toLowerCase());if(!entry)return [];
 const battle=await unpackArt(await read('battle/battle_data_release.dat')),templates=parseXlce(parsePakd(battle.pack).entries[23].data),out=[];
 for(let i=0;i<templates.count;i++)if(view(templates.row(i)).getUint16(0x3a,true)===entry.id)out.push(i);return out;
}
/**
 * What you can create. The game has two body layouts new characters can use: humanoid
 * (34 frames; humans, Hawkmen, Lizardmen etc. share it exactly) and large monster (31
 * frames; Cyclops and golems). Flying is not a different layout: it comes from the
 * character sheet (race 2, move type 5), and flyers also fill frames 28-33 (wingbeat
 * poses), which walkers leave empty. Each type brings its saved appearance (the
 * layout your PNGs are drawn for) and the game's own sheet for that body. Dorgalua XL
 * (family 24, 2048 x 1760 sheet) is a layout of its own and isn't supported here.
 */
export const CHARACTER_TYPES=[
 // humanoid layout (34 frames). sheet = the game's generic sheet for that race (race,
 // movement, undead, class set and stats); cls = the class the race's units use most
 {id:'human_m',label:'Human (male)',actor:'Warrior_m',sheet:160,cls:2},
 {id:'human_f',label:'Human (female)',actor:'Warrior_f',sheet:164,cls:2},
 {id:'winged',label:'Hawkman: flies (also draw flight frames 28–33)',actor:'Hawkman',sheet:170,cls:2},
 {id:'lizard',label:'Lizardman',actor:'Lizardman',sheet:174,cls:20},
 {id:'lamia',label:'Lamia',actor:'Lamia',sheet:178,cls:21},
 {id:'orc',label:'Orc',actor:'Orc',sheet:182,cls:7},
 {id:'skeleton',label:'Skeleton: undead (rises again unless exorcised)',actor:'Skeleton',sheet:190,cls:2},
 {id:'ghost',label:'Ghost: undead, floats',actor:'Ghost',sheet:198,cls:3},
 {id:'fairy',label:'Fairy: floats',actor:'Fairy',sheet:202,cls:22},
 {id:'gremlin',label:'Gremlin: floats',actor:'Gremlin',sheet:206,cls:12},
 {id:'pumpkin',label:'Pumpkinhead',actor:'Pumpkin',sheet:210,cls:22},
 // large monster layout (31 frames): body from Cyclops sheet 509, the rest from ordinary sheet 231
 {id:'large',label:'Large monster',actor:'Cyclops',sheet:231,cls:43},
 // large flying layout (family 7): body from the creature's own ordinary sheet (Obda 81 / Banga 128),
 // stats from the generic Gryphon 4 / Cockatrice 4 sheets
 {id:'gryphon',label:'Large flying monster (Gryphon body)',actor:'Gryphon',sheet:222,cls:40},
 {id:'cockatrice',label:'Large flying monster (Cockatrice body)',actor:'Cockatrice',sheet:226,cls:41},
 {id:'other',label:'Other: copy any saved appearance…'},
];
export const NEW_CHARACTER_FAMILIES={0:'humanoid',7:'large flying monster (Gryphon / Cockatrice)',8:'large monster (Cyclops / golems)'};
export async function newCharacterPlan({name,actor,baseTemplate=160,classId=1,palette=0,art=null,progress=()=>{},read=path=>source.read(path).then(r=>r.bytes)}={}){
 name=String(name??'').trim();if(!name||name.length>80)throw new Error('Enter a character name (up to 80 characters)');
 const family=poseGroup(actor);
 if(!(family in NEW_CHARACTER_FAMILIES))throw new Error('Independent character creation supports humanoid and large monster (Cyclops / golem) bases');
 const table=readFileRegistry(await read('FileTable.bin')),actorEntry=table.find(e=>e.directory===20&&e.path.toLowerCase()===`object/${actor}.dat`.toLowerCase());
 if(!actorEntry)throw new Error('The base appearance has no registered sprite ID');
 const next=directory=>Math.max(0,...table.filter(e=>e.directory===directory).map(e=>e.id))+1;
 const actorID=next(20),appearance=next(30);if(actorID>65535||appearance>65535)throw new Error('No unused character art IDs remain');
 const used=new Set(table.map(e=>e.path.toLowerCase()));let stem=name.replace(/[^A-Za-z_]/g,'').slice(0,18)||'Character';if(!/^[A-Za-z]/.test(stem))stem='C'+stem;
 const baseStem=stem;let suffix=0;while(used.has(`object/${stem}.dat`.toLowerCase())||used.has(`object/${stem}00.dat`.toLowerCase())){if(suffix>=26)throw new Error('Choose a different character name');stem=baseStem+String.fromCharCode(65+suffix++);}
 const files=[],registrations=[{directory:20,id:actorID,path:`object/${stem}.dat`},{directory:30,id:appearance,path:`object/${stem}00.dat`}];
 const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 async function emit(path,original,pack,entryName){
  verifyArtCompression(pack);const bytes=encrypt(await zipSingle(entryName,pack)),decoded=await unpackArt(bytes);if(!same(decoded.pack,pack))throw new Error('New character archive did not verify: '+path);
  files.push({path,bytes,expectedSHA256:original?await sha256(original):null});return bytes;
 }
 const replaceFile=(path,bytes)=>{const f=files.find(x=>x.path===path);if(f)f.bytes=bytes;else files.push({path,bytes,expectedSHA256:null});};
 progress('Copying body art into independent resources…');
 const bodyOriginal=await read(`object/${actor}.dat`),body=await unpackArt(bodyOriginal),unitOriginal=await read(`object/${actor}00.dat`),unit=await unpackArt(unitOriginal),unitRoot=parsePakd(unit.pack);
 const portraitEntry=unitRoot.entries.find(e=>e.id>=0x10000&&e.id<0x20000);if(!portraitEntry)throw new Error('The base appearance has no default portrait resource');
 const newBody=renameObject(body.pack,actor,stem),portrait=renameObject(portraitEntry.data,actor,stem);
 await emit(registrations[0].path,null,newBody,stem+'.pack');
 await emit(registrations[1].path,null,buildPakdWithIds([{id:actorID,data:newBody},{id:0x10000+appearance,data:portrait}]),unit.name);
 progress('Adding a character sheet and the native sprite lookup…');
 const battleOriginal=await read('battle/battle_data_release.dat'),battle=await unpackArt(battleOriginal),root=parsePakd(battle.pack),templates=parseXlce(root.entries[23].data),classes=parseXlce(root.entries[14].data),template=templates.count;
 if(!Number.isInteger(baseTemplate)||baseTemplate<0||baseTemplate>=template||template>=65535||!Number.isInteger(classId)||classId<1||classId>=classes.count&&classId!==253||!Number.isInteger(palette)||palette<0||palette>64)throw new Error('Choose a valid base character sheet, class and palette');
 const actors=appendActor(root.entries[74].data,actorEntry.id,actorID,stem.toLowerCase()),templateData=appendTemplate(root.entries[23].data,baseTemplate,{actor:actorID,portrait:appearance});
 templateData[view(templateData).getUint32(8,true)+template*84+0x3d]=palette;
 // the body comes from the appearance's own sheet (race, movement, animation type, innate weapons);
 // stats come from the chosen sheet. A humanoid sheet on a large monster plays humanoid motions.
 const own=ownSheet(templates,actorEntry.id,baseTemplate);let bodyNote=null;
 if(own!=null&&own!==baseTemplate){const head=view(templateData).getUint32(8,true),to=head+template*84,from=head+own*84;for(const at of BODY_FIELDS)templateData[to+at]=templateData[from+at];bodyNote=`Body settings (race, movement, animation type) come from ${actor}'s own character sheet ${own}; stats, growth, tribe and aura come from sheet ${baseTemplate}.`;}
 else if(own==null&&family!==0)throw new Error(`${actor} has no character sheet of its own to take its large-monster animation settings from`);
 await emit('battle/battle_data_release.dat',battleOriginal,rebuildPakd(battle.pack,new Map([[74,actors],[23,templateData]])),battle.name);
 progress('Adding menu faces and the independent portrait…');
 const menuPath='menu/texture_x4/com_unit.dat',menuOriginal=await read(menuPath),menu=await unpackArt(menuOriginal),menuRoot=parsePakd(menu.pack),arc=parseArc(menuRoot.entries[0].data),prefix=`com_unit_face_${actor.toLowerCase()}_`,heads=arc.records.filter(r=>r.name.toLowerCase().startsWith(prefix));
 if(!heads.length)throw new Error('This base has no mapped menu faces; choose another humanoid base appearance');
 arc.records.push(...heads.map(r=>renameArcRecord(r,r.name.replace(new RegExp(actor,'i'),stem.toLowerCase()))));
 await emit(menuPath,menuOriginal,rebuildPakd(menu.pack,new Map([[0,buildArc(arc)]])),menu.name);
 const portraitPath='menu/menu_classface.dat',portraitsOriginal=await read(portraitPath),portraits=await unpackArt(portraitsOriginal),entries=parsePakd(portraits.pack).entries;
 if(entries.some(e=>e.id===appearance))throw new Error('The next portrait ID is already in the menu archive');
 await emit(portraitPath,portraitsOriginal,buildPakdWithIds([...entries.map(e=>({id:e.id,data:e.data})),{id:appearance,data:portrait}]),portraits.name);
 const character={name,stem,template,actor:actorID,appearance,baseTemplate,classId,palette};
 const before=scanArt(body.pack).assets.find(a=>a.kind==='indexed'),after=scanArt(newBody).assets.find(a=>a.kind==='indexed');
 if(!before||!after||!same(before.sheet.indices,after.sheet.indices))throw new Error('Cloned body art did not verify');
 // art from the start: import it onto the new character's own files before anything is saved
 let imported=null;
 if(art&&(art.bodyPNGs?.some(Boolean)||art.portraitPNG||art.auraPNGs?.some(Boolean)||art.maskPNGs?.some(Boolean))){
  progress('Importing the new character\'s artwork…');
  const made=new Map(files.map(f=>[f.path,f.bytes])),gameFiles=await artFiles('characters');
  const readMade=async path=>made.has(path)?artArchiveFromBytes(path,made.get(path)):readArtArchive(path);
  const names=[...await actorNames()];names[actorID-1]=stem;
  imported=await characterImportPlan({...art,actor:stem,names,progress,files:[...gameFiles,{path:registrations[0].path},{path:registrations[1].path}],read:readMade,animation:()=>artAnimationBank(actor)});
  // the imported archives replace the plain copies; new files stay new, existing ones keep their source check
  for(const f of imported.files)replaceFile(f.path,f.bytes);
 }
 const familyNote=[...(bodyNote?[bodyNote]:[]),...(family===8?[`Large monster base (animation family 8). Give its units a large-monster class (Cyclops, 43, is the default); a humanoid or dragon class plays the wrong motions. Not yet tested in game.`]:[])];
 const artNotes=imported?[`Artwork imported from the start: ${imported.summary}`,...imported.notes]:[`Use Import character on ${stem} to change its body PNGs, portrait and helpers, or pick them here next time to start with your art.`];
 return {...(imported?{previews:imported.previews,motion:imported.motion,face:imported.face}:{}),title:'New project character: '+name,summary:`${name} has separate artwork${imported?' (your PNGs)':''} and a character sheet. ${files.length} archives rebuilt; the base character is preserved.`,notes:[...familyNote,...artNotes,`Sprite ID ${actorID}; appearance ${appearance}; character sheet ${template}. Existing IDs are unchanged.`,`Copies the base character sheet’s race, stats and class access. The chosen starting class stays an existing game class.`,`The name is an editor/project label. Battle units still use the game’s existing name or random-name settings.`,`Select this entry under Project characters in Battles and Cutscenes.`,`The selected class keeps its existing class-change/hiring representative picture. No new class or hiring rule is added.`,`Battle appearance has been tested with the wolf prototype. Recruiting, saving and custom story joins still need in-game testing.`,`Faction colours still follow the native palette rules; palette 0 inherits the normal class/faction choice.`],before,after,files,registrations,characters:[character]};
}

import {parseXlce,view} from '../lib/pakd.js';
import {AI_ENTRY,AI_ROW} from './aiprofiles.js';
export const STATUS_ENTRY=26,STATUS_ROW=126,AI_MAX_ID=255;
export const AI_WEIGHTS=[
 {offset:2,label:'Damage dealt',help:'Scores damage to an enemy, capped by remaining HP.'},
 {offset:6,label:'Damage as a share of target HP',help:'Rewards damage that removes a larger share of the target’s HP. This competes with status spells too.'},
 {offset:10,label:'Damage to allies',help:'Usually negative, penalizing friendly fire. Preserve the sign unless you intend to change that trade-off.'},
 {offset:18,defaultToggle:'aiDefaultBuffWeight',label:'Beneficial statuses on allies',help:'Values applying a status to the AI’s own side. Eligibility, current statuses and native special cases still apply.'},
 {offset:20,label:'Ailments on enemies',help:'Values applying a status to the opposing side. Raising it can make eligible status spells more competitive with damage.'},
 {offset:22,defaultToggle:'aiDefaultHealingWeights',label:'HP restored',help:'Values the amount of HP a healing action restores to a target that needs healing.'},
 {offset:24,defaultToggle:'aiDefaultHealingWeights',label:'Missing HP priority',help:'Gives healing more weight as the target loses a larger share of its maximum HP.'},
 {offset:26,label:'MP recovery',help:'Values MP restored to a unit with an equipped MP-cost spell or skill.'},
];
export const POSITION_WEIGHTS=[42,48,60,64,76];
// Read by the AI's tile scorer (0x3cbb20) against per-tile maps the think task builds.
export const POSITION_LABELS={
 54:{label:'Enemy threat on a tile',help:'Multiplied by the threat count of a tile hostile units can attack next turn (capped by the next value). Usually negative: the AI keeps away from tiles many enemies can reach. Stock: wizard −750, cleric −500, default −400.'},
 56:{label:'Enemy threat cap',help:'Highest threat count the previous value is multiplied by. Stock profiles use 10–12.'},
 58:{label:'Exposed tile penalty',help:'Only negative values count. Applied as a percentage of a 50 or 100 rating the think task gives exposed tiles; zero ignores exposure.'},
};
export function aiEditorTables(dat){
 const profiles=parseXlce(dat.pakd.entries[AI_ENTRY].data),statuses=parseXlce(dat.pakd.entries[STATUS_ENTRY].data);
 if(profiles.rowSize!==AI_ROW||statuses.rowSize!==STATUS_ROW)throw new Error('Unsupported AI or status table layout.');
 return{profiles,statuses};
}
function integer(n,min,max,label){if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${label} must be a whole number from ${min} to ${max}.`);return n;}
export function readAIProfile(dat,id){const{profiles}=aiEditorTables(dat);integer(id,0,profiles.count-1,'AI profile');const v=view(profiles.row(id));return Array.from({length:AI_ROW/2},(_,i)=>v.getInt16(i*2,true));}
export function applyAIWeights(dat,id,changes){
 const{profiles}=aiEditorTables(dat);integer(id,1,Math.min(AI_MAX_ID,profiles.count-1),'AI profile');
 const edits=[...changes].map(([offset,value])=>{integer(offset,0,AI_ROW-2,'Field offset');if(offset%2)throw new Error('AI fields start on even offsets.');return[offset,integer(value,-32768,32767,'AI value')];});
 const v=view(profiles.row(id));let changed=false;
 for(const[o,n]of edits)if(v.getInt16(o,true)!==n){v.setInt16(o,n,true);changed=true;}return changed;
}
export function applyStatusAIValue(dat,id,value){const{statuses}=aiEditorTables(dat);integer(id,1,statuses.count-1,'Status');integer(value,0,255,'Status AI value');const r=statuses.row(id),changed=r[0x70]!==value;r[0x70]=value;return changed;}
export function duplicateAIProfile(ed,id){const{profiles}=aiEditorTables(ed.dat);integer(id,1,Math.min(AI_MAX_ID,profiles.count-1),'Source AI profile');if(profiles.count>AI_MAX_ID)throw new Error('All 256 AI numbers are occupied. Battle units store one byte for their AI number.');return ed.appendEntryRow(AI_ENTRY,profiles.row(id).slice());}
export function canRemoveStatusBehaviours(table,matched){return table.count>113&&table.count<=115&&matched.size===table.count-113;}

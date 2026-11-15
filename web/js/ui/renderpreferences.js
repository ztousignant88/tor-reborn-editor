// Display choices shared by every 3D editor view; never stored in game files.
const KEY='tor-editor:rendering:v1',listeners=new Set();
let values={lighting:true,animatedTiles:true,spritesOverTerrain:true,effectGlow:0.35};
const glow=n=>Math.max(0,Math.min(1,n));
try{
  const saved=JSON.parse(localStorage.getItem(KEY));
  for(const k of Object.keys(values))if(typeof values[k]==='boolean'&&typeof saved?.[k]==='boolean')values[k]=saved[k];
  if(typeof saved?.effectGlow==='number'&&Number.isFinite(saved.effectGlow))values.effectGlow=glow(saved.effectGlow);
}catch{}
export const renderPreferences=()=>({...values});
export function setRenderPreferences(patch){
  for(const k of Object.keys(values))if(typeof values[k]==='boolean'&&typeof patch[k]==='boolean')values[k]=patch[k];
  if(typeof patch.effectGlow==='number'&&Number.isFinite(patch.effectGlow))values.effectGlow=glow(patch.effectGlow);
  try{localStorage.setItem(KEY,JSON.stringify(values));}catch{}
  for(const f of listeners)f(renderPreferences());
}
export function watchRenderPreferences(listener){listeners.add(listener);return()=>listeners.delete(listener);}

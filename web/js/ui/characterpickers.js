import {createPicker} from './picker.js';
// Keep native selects as the value/event source for existing editor actions.
export function installCharacterPickers(resolveLook,prepare){
  const selector='#add-character,#add-generic,#cs-cast select:not([data-side]):not([data-how]):not([data-where]),#cs-after select[data-character],#cs-stepedit select[data-field="actor"],#cs-stepedit select[data-add="actor"]';
  const tracked=new WeakMap();let queued=false;
  const options=s=>[...s.options].filter(o=>!o.disabled&&!o.hidden).map(o=>({id:o.value,name:o.textContent,group:o.parentElement.tagName==='OPTGROUP'?o.parentElement.label:undefined,look:()=>resolveLook(s,o.value)}));
  function scan(){
    queued=false;
    for(const s of document.querySelectorAll(selector)){
      const stamp=[s.value,s.disabled,...[...s.options].map(o=>`${o.value}:${o.textContent}:${o.hidden}`)].join('|'),old=tracked.get(s);
      if(old?.stamp===stamp&&old.button.isConnected)continue;
      if (old?.button.isConnected) {
        old.button.setOptions(options(s));
        old.button.setValue(s.value);
        old.button.disabled=s.disabled;
        old.stamp=stamp;
        continue;
      }
      old?.button.remove();s.classList.add('character-native-select');
      const button=createPicker({options:options(s),value:s.value,allowRaw:false,emptyLabel:'Choose character',beforeOpen:async()=>{await s.onfocus?.();await prepare?.();return options(s);},onChange:v=>{s.value=String(v);s.dispatchEvent(new Event('change',{bubbles:true}));schedule();}});
      button.classList.add('character-picker');button.disabled=s.disabled;button.setAttribute('aria-label',s.getAttribute('aria-label')||s.getAttribute('title')||'Choose character');
      s.after(button);tracked.set(s,{stamp,button});
    }
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(scan);}}
  for(const root of document.querySelectorAll('#battles-layout,#cutscenes-layout'))new MutationObserver(schedule).observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden']});
  schedule();
}

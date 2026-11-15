import {loadActorFrame} from '../game/unitsprites.js';
import {rgbaCanvas} from './texcanvas.js';
import {previewPalette} from '../game/tables.js';
// Searchable dropdown for long ID lists (classes, equipment, skills...).
// Accepts any raw number too, so unlisted IDs stay editable.

let popover = null;

function closePopover() {
  if (!popover) return;
  popover.artObserver.disconnect();
  popover.el.remove();
  document.removeEventListener('pointerdown', popover.outside, true);
  popover = null;
}

export function createPicker({ options, value, onChange, emptyLabel = '— none —', help = '', beforeOpen, allowRaw=true }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'picker';
  let byId = new Map(options.map((o) => [String(o.id), o]));

  const describe = (v) => {
    const o = byId.get(String(v));
    if (String(v) === '0' && !o?.name) return { name: emptyLabel, id: 0, muted: true };
    return { name: o?.name || 'Unknown', id: v, muted: !o?.name };
  };

  button.setValue = (v) => {
    button.value = v;
    const d = describe(v);
    button.innerHTML = '';
    const name = document.createElement('span');
    name.className = d.muted ? 'picker-name muted' : 'picker-name';
    name.textContent = d.name;
    const id = document.createElement('span');
    id.className = 'picker-id';
    id.textContent = /^\d+$/.test(String(v))?`#${v}`:'';
    addLook(button,byId.get(String(v)));
    button.append(name, id);
    button.title = [help, `${d.name} (#${v})`].filter(Boolean).join('\n\n');
  };
  button.setHelp = (text) => {
    help = text;
    button.title = [help, `${describe(button.value).name} (#${button.value})`].filter(Boolean).join('\n\n');
    button.setAttribute('aria-description', help);
  };
  button.setValue(value);
  button.setOptions = (next) => {
    options = next;
    byId = new Map(next.map(o => [String(o.id), o]));
    button.setValue(button.value);
  };

  button.addEventListener('click', async () => {
    if (popover?.anchor === button) { closePopover(); return; }
    const next = await beforeOpen?.();
    if (!button.isConnected) return;
    if (next) button.setOptions(next);
    open(button, options, emptyLabel, (v) => {
    button.setValue(v);
    onChange(v);
  },allowRaw);});
  return button;
}

function open(anchor, options, emptyLabel, choose,allowRaw=true) {
  closePopover();
  const el = document.createElement('div');
  el.className = 'picker-pop';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search by name or #id…';
  const list = document.createElement('div');
  list.className = 'picker-list';
  el.append(input, list);
  (anchor.closest('dialog[open]')??document.body).append(el);

  const rect = anchor.getBoundingClientRect();
  const width = Math.max(rect.width, 280);
  el.style.width = `${width}px`;
  el.style.left = `${Math.min(rect.left, window.innerWidth - width - 8)}px`;
  const below = window.innerHeight - rect.bottom;
  if (below < 320 && rect.top > below) el.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  else el.style.top = `${rect.bottom + 4}px`;

  let active = 0;
  let shown = [];
  let rows = [];
  const artObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !entry.target.isConnected) continue;
      artObserver.unobserve(entry.target);
      addLook(entry.target, shown[Number(entry.target.dataset.option)], entry.target.firstElementChild);
    }
  }, { root: list });
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const raw = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
    const terms = q.split(/\s+/);
    shown = options.filter((o) => {
      if (!q || String(o.id) === q.replace('#', '')) return true;
      if (raw !== null && q.startsWith('#')) return false;
      const label = `${o.name ?? ''} ${o.group ?? ''} #${o.id}`.toLowerCase();
      return terms.every((term) => label.includes(term));
    });
    if (allowRaw && Number.isSafeInteger(raw) && !shown.some((o) => String(o.id) === String(raw))) {
      shown.unshift({ id: raw, name: `Use raw value ${raw}`, raw: true });
    }
    active = Math.min(active, Math.max(0, shown.length - 1));
    artObserver.disconnect();
    list.replaceChildren();
    rows = [];
    let lastGroup;
    shown.forEach((o, i) => {
      if(o.group&&o.group!==lastGroup){const heading=document.createElement('div');heading.className='picker-group';heading.textContent=o.group;heading.setAttribute('role','presentation');list.append(heading);lastGroup=o.group;}
      const row = document.createElement('div');
      row.dataset.option = String(i);
      row.className = `picker-item${i === active ? ' active' : ''}${o.raw ? ' raw' : ''}`;
      const name = document.createElement('span');
      name.textContent = o.id === 0 && !o.name ? emptyLabel : o.name;
      const id = document.createElement('span');
      id.className = 'picker-id';
      id.textContent = /^\d+$/.test(String(o.id))?`#${o.id}`:'';
      if (o.art || o.look) {
        const slot = document.createElement('span');
        slot.className = 'picker-art';
        row.append(slot);
      }
      row.append(name, id);
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(o.id); });
      list.append(row);
      rows.push(row);
      if (o.art || o.look) artObserver.observe(row);
    });
    if (!shown.length) list.innerHTML = '<div class="picker-empty">No matches</div>';
  };
  const pick = (id) => { closePopover(); choose(id); anchor.focus(); };

  input.addEventListener('input', () => { active = 0; render(); });
  const move = (index) => {
    rows[active]?.classList.remove('active');
    active = Math.max(0, Math.min(index, rows.length - 1));
    rows[active]?.classList.add('active');
    rows[active]?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { move(active + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { move(active - 1); e.preventDefault(); }
    else if (e.key === 'Enter' && shown[active]) { pick(shown[active].id); e.preventDefault(); }
    else if (e.key === 'Escape') { closePopover(); anchor.focus(); }
  });

  const outside = (e) => { if (!el.contains(e.target) && e.target !== anchor) closePopover(); };
  document.addEventListener('pointerdown', outside, true);
  popover = { el, outside, artObserver, anchor };

  const current = options.findIndex((o) => String(o.id) === anchor.value);
  render();
  if (current >= 0) move(current);
  input.focus();
}

function addLook(host,option,slot){
  const artworkSlot = () => {
    if (slot) return slot;
    const created = document.createElement('span');
    created.className = 'picker-art';
    host.prepend(created);
    return created;
  };
  if(option?.art){
    const art=artworkSlot();
    Promise.resolve().then(option.art).then(c=>{if(c&&art.isConnected)art.append(c);}).catch(()=>{});return;
  }
  const look=option?.look?.();if(!look)return;
  const art=artworkSlot();
  loadActorFrame(look.actor,previewPalette(look.palette)??undefined).then(f=>{
    if(!f?.rgba||!art.isConnected)return;
    const c=rgbaCanvas(f.width,f.height,f.rgba,0.5);art.title=look.owner??'';art.append(c);
  }).catch(()=>{});
}

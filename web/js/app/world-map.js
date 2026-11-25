import { drawWorldMapArt } from '../game/world-map-art.js';
import { CHAPTERS } from '../game/cutscene.js';

const headers = { 'X-TOR-Editor': '1', 'Content-Type': 'application/json' };
const bounds = { left: -8, right: 8, top: -4.5, bottom: 4.5 };
const projectEndpoint = '/api/world-map';

async function request(body) {
  const response = await fetch(projectEndpoint, {
    headers, cache: 'no-store',
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not read the world map.');
  return result;
}

function titleArt(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 256;
  const ink = canvas.getContext('2d');
  ink.font = 'bold 145px Georgia, serif';
  ink.textAlign = 'center';
  ink.textBaseline = 'middle';
  ink.lineJoin = 'round';
  ink.lineWidth = 8;
  ink.strokeStyle = '#302014';
  ink.fillStyle = '#f9e8c4';
  ink.strokeText(title, 1024, 128, 1860);
  ink.fillText(title, 1024, 128, 1860);
  return canvas.toDataURL('image/png').split(',')[1];
}

export function installWorldMap(openers, refreshBattles) {
  const $ = (id) => document.getElementById('world-map' + id);
  const dialog = $('');
  const status = $('-status');
  const map = $('-plane');
  const newOneTime = $('-new-one-time');
  let data, draft, picked, artReady, drag, placing = false, busy = false;
  let enableExpansion = false;
  let chapter = CHAPTERS[0].prefix;
  const updated = () => data && (enableExpansion || JSON.stringify(draft) !== JSON.stringify(data.saved));
  const editable = () => data?.project && !data.readOnly && !busy;
  const expanded = () => enableExpansion || data.eventExpansionEnabled;
  const capacity = () => expanded() ? data.eventCapacity : data.baseEventCapacity;
  const nextSlot = (useExpanded = expanded()) =>
    Object.keys(draft.events).length < (useExpanded ? data.eventCapacity : data.baseEventCapacity) &&
    data.slots.find(slot => (useExpanded || slot.legacy) && !slot.builtIn && !draft.events[slot.key]);
  const offerExpansion = () => !expanded() && data.eventExpansionSupported && nextSlot(true);
  const routeFrom = (row, rows) => row.roadSource === undefined
    ? rows.find(candidate => candidate.key === row.parentSlot) ?? rows.find(candidate => candidate.id === row.anchor)
    : rows.find(candidate => candidate.id === row.roadSource);

  function locationRows() {
    const rows = data.locations.map(location => {
      const edit = draft.locations[location.id];
      return { ...location, key: String(location.id), name: edit?.title || location.name,
        position: edit?.position || location.position };
    });
    for (const slot of data.slots) {
      const event = draft.events[slot.key];
      if (event || slot.builtIn) rows.push({ ...slot, id: slot.node, event: true,
        name: event?.title || slot.builtIn,
        position: event?.position || draft.locations[slot.node]?.position || slot.position });
    }
    return rows;
  }

  const mapWidth = bounds.right - bounds.left;
  const mapHeight = bounds.bottom - bounds.top;
  const project = ([x, y]) => [(x - bounds.left) / mapWidth, (y - bounds.top) / mapHeight];

  function select(key) {
    picked = key;
    placing = false;
    render();
  }

  function drawRoads(rows) {
    const canvas = $('-roads');
    const canvasContext = canvas.getContext('2d');
    const { width, height } = canvas;
    canvasContext.clearRect(0, 0, width, height);
    const lookup = new Map(rows.map(row => [row.id, row]));
    const originals = new Map(data.locations.map(row => [row.id, row]));
    const point = (coords) => project(coords).map((n, index) => n * (index ? height : width));
    const draw = (points, custom) => {
      canvasContext.beginPath();
      canvasContext.moveTo(...point(points[0]));
      for (const coords of points.slice(1)) canvasContext.lineTo(...point(coords));
      canvasContext.lineCap = 'round';
      canvasContext.lineJoin = 'round';
      canvasContext.setLineDash([]);
      canvasContext.strokeStyle = '#102129';
      canvasContext.lineWidth = 7;
      canvasContext.stroke();
      canvasContext.setLineDash(custom ? [8, 8] : []);
      canvasContext.strokeStyle = custom ? '#f7ce86' : '#c4dfd2';
      canvasContext.lineWidth = 2.3;
      canvasContext.stroke();
    };
    for (const road of data.roads) {
      const from = lookup.get(road.from), to = lookup.get(road.to);
      if (!from || !to) continue;
      const oldFrom = originals.get(road.from);
      const oldTo = originals.get(road.to);
      if (!oldFrom || !oldTo) continue;
      const moved = road.points.map((coords, index) => {
        const t = index / (road.points.length - 1);
        return coords.map((n, axis) => n + (from.position[axis] - oldFrom.position[axis]) * (1 - t)
          + (to.position[axis] - oldTo.position[axis]) * t);
      });
      draw(moved, false);
    }
    const branch = data.roads.find(road => road.id === 39);
    const tynemouth = originals.get(19);
    const phorampa = originals.get(37);
    for (const row of rows.filter(row => row.event)) {
      const start = routeFrom(row, rows)?.position;
      if (!start) continue;
      if (!row.legacy || !branch || !tynemouth || !phorampa) {
        draw([start, row.position], true);
        continue;
      }
      const points = branch.points.map((coords, index) => {
        const t = index / (branch.points.length - 1);
        return coords.map((n, axis) => n + (start[axis] - tynemouth.position[axis]) * (1 - t)
          + (row.position[axis] - phorampa.position[axis]) * t);
      });
      draw(points, true);
    }
  }

  function moveMarker(marker, coords) {
    const [x, y] = project(coords);
    marker.style.left = 100 * x + '%';
    marker.style.top = 100 * y + '%';
  }

  function roundedPosition(x, y) {
    return [
      Number(Math.max(bounds.left, Math.min(bounds.right, x)).toFixed(3)),
      Number(Math.max(bounds.top, Math.min(bounds.bottom, y)).toFixed(3)),
    ];
  }

  function startDrag(event, row, marker) {
    if (!editable() || placing || drag || !event.isPrimary || event.button !== 0) return;
    drag = { row, marker, pointer: event.pointerId, startX: event.clientX, startY: event.clientY };
    marker.setPointerCapture(event.pointerId);
  }

  function previewDrag(event) {
    if (drag?.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.position && Math.hypot(dx, dy) < 4) return;
    const [x, y] = drag.row.position;
    drag.position = roundedPosition(x + dx * mapWidth / map.clientWidth, y + dy * mapHeight / map.clientHeight);
    map.classList.add('dragging');
    drag.marker.classList.add('dragged');
    moveMarker(drag.marker, drag.position);
    drawRoads(locationRows().map(row => row.key === drag.row.key ? { ...row, position: drag.position } : row));
  }

  function finishDrag(commit) {
    if (!drag) return;
    const { row, marker, pointer, position } = drag;
    drag = null;
    if (marker.hasPointerCapture(pointer)) marker.releasePointerCapture(pointer);
    map.classList.remove('dragging');
    if (!position) return;
    if (commit && editable()) {
      if (position.some((value, index) => value !== row.position[index])) field(row, 'position', position);
      picked = row.key;
    }
    render();
  }

  function mapDisplay(rows) {
    drawRoads(rows);
    $('-markers').replaceChildren(...rows.map(row => {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'world-map-marker';
      marker.classList.toggle('encounter', !!row.event);
      marker.classList.toggle('movable', !!editable());
      moveMarker(marker, row.position);
      marker.title = row.name;
      marker.setAttribute('aria-label', row.name);
      marker.setAttribute('aria-pressed', String(row.key === picked));
      marker.onclick = () => select(row.key);
      marker.onpointerdown = event => startDrag(event, row, marker);
      return marker;
    }));
    map.classList.toggle('placing', placing);
  }

  function input(label, field, value, options = {}) {
    const wrap = document.createElement('label');
    wrap.append(label);
    const element = document.createElement('input');
    element.type = options.type || 'text';
    if (options.type === 'number') Object.assign(element, { min: options.min, max: options.max, step: '0.001' });
    else element.maxLength = 42;
    element.value = value;
    element.disabled = !editable() || options.disabled;
    element.addEventListener('input', () => {
      const next = options.type === 'number' ? element.valueAsNumber : element.value.trim();
      if (next !== '' && element.checkValidity() && (typeof next !== 'number' || Number.isFinite(next))) {
        field(next);
        renderListAndMap();
      }
    });
    wrap.append(element);
    return wrap;
  }

  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.onclick = action;
    return element;
  }

  function field(row, key, value) {
    const target = row.event && !row.builtIn ? draft.events : draft.locations;
    const id = row.builtIn ? row.id : row.key;
    target[id] = { ...target[id], [key]: value };
    if (key === 'title') delete target[id].art;
  }

  function details(row) {
    const box = $('-details');
    box.replaceChildren();
    if (!row) return;
    const heading = document.createElement('h3');
    heading.textContent = row.name;
    box.append(heading);
    if (!row.builtIn) {
      box.append(input('Name', value => {
        field(row, 'title', value);
        heading.textContent = value;
        for (const link of box.querySelectorAll('.world-map-asset')) {
          link.querySelector('span').textContent = value;
          link.setAttribute('aria-label', 'Open ' + value + ' ' + link.dataset.kind);
        }
      }, row.name, { disabled: !row.event && !row.rename }));
    }
    const coords = document.createElement('div');
    coords.className = 'world-map-coordinates';
    ['X', 'Y'].forEach((axis, index) => coords.append(input(axis, value => {
      const pos = [...locationRows().find(item => item.key === row.key).position];
      pos[index] = value;
      field(row, 'position', pos);
    }, Number(row.position[index].toFixed(3)), { type: 'number', min: index ? bounds.top : bounds.left,
      max: index ? bounds.bottom : bounds.right })));
    box.append(coords);
    if (editable()) box.append(button(placing ? 'Cancel placement' : 'Place on map', () => {
      placing = !placing;
      map.classList.toggle('placing', placing);
      details(row);
    }));
    if (row.event) {
      const rows = locationRows();
      const unlockId = row.unlockLocation === undefined ? row.anchor : row.unlockLocation;
      const unlockLocation = rows.find(location => location.id === unlockId);
      const route = routeFrom(row, rows);
      const milestones = data.unlockMilestones ?? [];
      const defaultMilestone = milestones.find(milestone => milestone.flag === row.unlockFlag);
      const defaultLabel = unlockLocation ? `When ${unlockLocation.name} becomes available`
        : defaultMilestone?.label ?? (row.unlockFlag ? `When campaign flag ${row.unlockFlag} is set` : 'When the road is reachable');
      if (!row.builtIn && data.unlockLocations) {
        const label = document.createElement('label');
        label.textContent = 'Unlock condition';
        const picker = document.createElement('select');
        picker.setAttribute('aria-label', 'Unlock condition');
        picker.disabled = !editable();
        picker.add(new Option(`Use event default · ${defaultLabel}`, ''));
        const story = document.createElement('optgroup');
        story.label = 'Campaign milestones';
        const report = document.createElement('optgroup');
        report.label = 'Warren Report';
        for (const milestone of milestones) {
          if (!milestone.report) story.append(new Option(milestone.label, `milestone:${milestone.id}`));
        }
        for (const milestone of milestones.filter(milestone => milestone.report)
          .sort((a, b) => a.label.localeCompare(b.label))) {
          report.append(new Option(milestone.label, `milestone:${milestone.id}`));
        }
        const locations = document.createElement('optgroup');
        locations.label = 'Stock locations';
        const allowed = new Set(data.unlockLocations);
        for (const location of rows.filter(location => !location.event && allowed.has(location.id))
          .sort((a, b) => a.name.localeCompare(b.name))) {
          locations.append(new Option(`When ${location.name} becomes available`, `location:${location.id}`));
        }
        picker.append(story);
        if (report.children.length) picker.append(report);
        picker.append(locations);
        const event = draft.events[row.key];
        picker.value = event.unlock ? `${event.unlock.kind}:${event.unlock.id}` : '';
        picker.onchange = () => {
          const [kind, id] = picker.value.split(':');
          if (kind) field(row, 'unlock', {kind, id: kind === 'location' ? Number(id) : id});
          else delete event.unlock;
          render();
        };
        picker.title = 'Choose a campaign milestone, Warren Report read trigger, or stock location. The connecting roads also require both endpoints to be available.';
        label.append(picker);
        box.append(label);
      }
      const rules = document.createElement('dl');
      rules.className = 'world-map-access';
      const fields = [['Main road connects to', route?.name ?? 'Unknown location']];
      if (row.builtIn || !data.unlockLocations) fields.unshift(['Unlock condition', defaultLabel]);
      for (const [name, value] of fields) {
        const label = document.createElement('dt');
        label.textContent = name;
        const description = document.createElement('dd');
        description.textContent = value;
        rules.append(label, description);
      }
      box.append(rules);
    }
    if (row.builtIn) {
      box.append(button('Open battle roster', () => jump('battle', row.roster)));
    } else if (row.event) {
      const event = draft.events[row.key];
      const label = document.createElement('label');
      label.append('Battlefield template');
      const arenas = document.createElement('select');
      arenas.setAttribute('aria-label', 'Battlefield template');
      arenas.disabled = !editable();
      for (const arena of data.arenas) arenas.add(new Option(arena.name, arena.id));
      arenas.value = event.arena;
      arenas.onchange = () => {
        if (data.saved.events[row.key] && !confirm('Replace this event’s terrain and battle roster with copies from the new template?')) {
          arenas.value = event.arena;
          return;
        }
        field(row, 'arena', Number(arenas.value));
        render();
      };
      label.append(arenas);
      const deployment = document.createElement('label');
      deployment.append('Player deployment');
      const count = document.createElement('select');
      count.setAttribute('aria-label', 'Player deployment');
      count.disabled = !editable();
      for (let i = 1; i <= 12; i++) count.add(new Option(i, i));
      count.value = event.players;
      count.onchange = () => { field(row, 'players', Number(count.value)); render(); };
      deployment.append(count);
      const marker = document.createElement('label');
      marker.append('Marker art');
      const markers = document.createElement('select');
      markers.setAttribute('aria-label', 'Marker art');
      markers.disabled = !editable();
      markers.add(new Option('Default battle marker', ''));
      for (const location of data.locations) markers.add(new Option(location.name, location.id));
      markers.value = event.markerSource ?? '';
      markers.onchange = () => {
        if (markers.value) field(row, 'markerSource', Number(markers.value));
        else delete event.markerSource;
        renderListAndMap();
      };
      marker.append(markers);
      const completion = document.createElement('label');
      completion.className = 'world-map-toggle';
      const oneTime = document.createElement('input');
      oneTime.type = 'checkbox';
      oneTime.checked = !!event.oneTime;
      oneTime.disabled = !editable() || !data.oneTimeSupported;
      oneTime.onchange = () => {
        if (oneTime.checked) event.oneTime = true;
        else delete event.oneTime;
        renderListAndMap();
      };
      completion.append(oneTime, 'One-time battle');
      completion.title = data.oneTimeSupported
        ? 'A victory clears this battle and changes its map marker. The location and roads stay open.'
        : 'One-time battles require Steam 1.0.8.0.';
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Copies enemies from the selected battlefield. Win by defeating all enemies.';
      box.append(label, deployment, marker, completion, hint);
      const linked = document.createElement('div');
      linked.className = 'world-map-assets';
      const version = document.createElement('label');
      version.textContent = 'Cutscene chapter';
      const chapters = document.createElement('select');
      for (const entry of CHAPTERS) chapters.add(new Option(entry.label, entry.prefix));
      chapters.value = chapter;
      chapters.onchange = () => { chapter = chapters.value; };
      version.append(chapters);
      for (const [kind, label, target] of [
        ['battle', 'Battle roster', () => row.roster],
        ['map', 'Battlefield map', () => row.map],
        ['cutscene', 'Pre-battle cutscene', () => row.scenes[chapter]],
      ]) {
        const link = button('', () => jump(kind, target()));
        link.className = 'world-map-asset';
        link.dataset.kind = kind;
        link.setAttribute('aria-label', 'Open ' + row.name + ' ' + kind);
        const name = document.createElement('span');
        name.textContent = row.name;
        const type = document.createElement('small');
        type.textContent = label;
        link.append(name, type);
        linked.append(link);
      }
      box.append(linked, version);
      updateLinks();
    }
    const customEvent = row.event && !row.builtIn;
    const changes = customEvent ? draft.events : draft.locations;
    const changeKey = row.builtIn ? row.id : row.key;
    if (editable() && changes[changeKey]) box.append(button(customEvent ? 'Remove event' : 'Restore original location', () => {
      if (customEvent && data.saved.events[row.key] && !confirm('Remove this event and its linked battle, map and cutscenes from the project?')) return;
      delete changes[changeKey];
      if (customEvent) picked = '19';
      render();
    }));
  }

  function updateLinks() {
    for (const link of $('-details').querySelectorAll('.world-map-asset')) {
      link.disabled = busy || updated();
      link.title = link.disabled ? 'Save the world map to open this editor.' : '';
    }
  }

  async function jump(kind, id) {
    try {
      await openers[kind](id);
      dialog.close();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function renderListAndMap() {
    if (!data) return;
    const rows = locationRows();
    const query = $('-search').value.trim().toLowerCase();
    $('-locations').replaceChildren(...rows.filter(row => row.name.toLowerCase().includes(query)).map(row => {
      const location = button(row.name, () => select(row.key));
      location.setAttribute('aria-pressed', String(row.key === picked));
      return location;
    }));
    mapDisplay(rows);
    $('-save').disabled = !editable() || !updated();
    updateLinks();
    const available = nextSlot();
    const offer = offerExpansion();
    $('-add').disabled = !editable() || !(available || offer);
    newOneTime.disabled = $('-add').disabled || !data.oneTimeSupported;
    newOneTime.title = data.oneTimeSupported
      ? 'The next battle event can be won once per save.'
      : 'One-time battles require Steam 1.0.8.0.';
    $('-add').title = available ? '' : offer ? 'Enable World Map Event Expansion to add another event.'
      : !expanded() && !data.eventExpansionSupported ? 'World Map Event Expansion requires Steam 1.0.8.0.'
        : 'All custom event slots are in use.';
    $('-event-count').textContent = Object.keys(draft.events).length + ' / ' + capacity() + ' custom events';
    return rows;
  }

  function render() {
    const rows = renderListAndMap();
    if (rows) details(rows.find(row => row.key === picked));
  }

  map.addEventListener('pointermove', previewDrag);
  map.addEventListener('pointerup', event => {
    if (drag?.pointer !== event.pointerId) return;
    previewDrag(event);
    finishDrag(true);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    map.addEventListener(type, event => {
      if (drag?.pointer === event.pointerId) finishDrag(false);
    });
  }
  map.addEventListener('click', (event) => {
    if (!placing || !editable() || event.target.closest('button')) return;
    const rect = map.getBoundingClientRect();
    const x = bounds.left + (event.clientX - rect.left - map.clientLeft) / map.clientWidth * mapWidth;
    const y = bounds.top + (event.clientY - rect.top - map.clientTop) / map.clientHeight * mapHeight;
    const row = locationRows().find(item => item.key === picked);
    field(row, 'position', roundedPosition(x, y));
    placing = false;
    render();
  });
  $('-search').oninput = render;
  $('-add').onclick = () => {
    if (!editable()) return;
    let slot = nextSlot();
    if (!slot) {
      slot = offerExpansion();
      if (!slot || !confirm(`Enable World Map Event Expansion to add this event? It raises the project limit to ${data.eventCapacity} custom events.`)) return;
      enableExpansion = true;
    }
    const event = { title: 'New battle', position: slot.position, arena: data.arenas[0].id, players: 8 };
    if (data.oneTimeSupported && newOneTime.checked) event.oneTime = true;
    draft.events[slot.key] = event;
    newOneTime.checked = false;
    select(slot.key);
  };
  $('-close').onclick = () => {
    if (!busy && (!updated() || confirm('Discard unsaved world map changes?'))) {
      finishDrag(false);
      dialog.close();
    }
  };
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (drag) { finishDrag(false); return; }
    $('-close').click();
  });
  $('-save').onclick = async () => {
    if (!editable() || !updated()) return;
    busy = true;
    status.textContent = 'Building location titles and checking the routes…';
    render();
    try {
      for (const row of [...Object.values(draft.locations), ...Object.values(draft.events)]) {
        if (row.title && !row.art) row.art = titleArt(row.title);
      }
      const result = await request({ project: data.project, revision: data.revision, changes: draft, enableExpansion });
      data.revision = result.revision;
      data.eventExpansionEnabled = result.eventExpansionEnabled;
      enableExpansion = false;
      data.saved = structuredClone(draft);
      await refreshBattles(result);
      status.textContent = 'Saved to ' + data.project + '. Apply Project to use these changes in the game.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  };
  return async () => {
    dialog.showModal();
    newOneTime.checked = false;
    $('-content').hidden = true;
    $('-save').disabled = true;
    status.textContent = 'Loading locations and roads…';
    try {
      data = await request();
      draft = structuredClone(data.saved);
      enableExpansion = false;
      picked = '19';
      placing = false;
      $('-search').value = '';
      $('-content').hidden = false;
      status.textContent = data.readOnly ? 'The editor is in read-only mode.'
        : data.project ? data.project + ' • ' + data.limit + '-unit battle limit'
          : 'Open or create a project to edit the world map.';
      render();
      const art = $('-art');
      artReady ??= drawWorldMapArt(art).then(() => { art.hidden = false; }).catch(() => { artReady = null; });
    } catch (error) {
      status.textContent = error.message;
    }
  };
}

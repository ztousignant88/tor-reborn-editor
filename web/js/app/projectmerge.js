import { source } from '../game/source.js';

const esc = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const labels = { current: 'Keep current', incoming: 'Use incoming', both: 'Keep both' };

export async function mergeProjects(current, incoming) {
  const { projects } = await source.projects();
  const occupied = new Set(projects.map(project => project.name.toLowerCase()));
  const base = `Merged - ${current}`;
  let suggestion = base.slice(0, 60).trimEnd();
  for (let number = 2; occupied.has(suggestion.toLowerCase()); number++) {
    const suffix = ` ${number}`;
    suggestion = base.slice(0, 60 - suffix.length).trimEnd() + suffix;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'project-dialog merge-dialog';
  dialog.setAttribute('aria-labelledby', 'merge-title');
  dialog.innerHTML = `<form method="dialog">
    <h2 id="merge-title">Merge Projects</h2>
    <p class="hint"><b>${esc(current)}</b> receives changes from <b>${esc(incoming)}</b> in a new project.</p>
    <label class="merge-name">Merged project name <input name="project-name" maxlength="60" required value="${esc(suggestion)}"></label>
    <p data-merge-status class="hint" role="status"></p>
    <div class="merge-bulk" hidden>
      <button type="button" class="ghost" data-merge-fill="current">Keep current for unresolved conflicts</button>
      <button type="button" class="ghost" data-merge-fill="incoming">Use incoming for unresolved conflicts</button>
    </div>
    <div class="merge-review" data-merge-review></div>
    <div class="pd-actions">
      <button type="button" class="ghost" data-merge-cancel>Cancel</button>
      <button type="button" data-merge-preview>Review merge</button>
      <button type="submit" class="primary" data-merge-create disabled>Create merged project</button>
    </div>
  </form>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const name = $('[name="project-name"]');
  const status = $('[data-merge-status]');
  const review = $('[data-merge-review]');
  const create = $('[data-merge-create]');
  const inspect = $('[data-merge-preview]');
  const cancel = $('[data-merge-cancel]');
  const choices = Object.create(null);
  let plan;
  let busy = false;
  let reviewed = false;
  let created;

  const updateButtons = () => {
    inspect.disabled = busy;
    create.disabled = busy || !reviewed || !!plan?.pending;
    cancel.disabled = busy;
    name.disabled = busy;
    for (const control of dialog.querySelectorAll('[data-merge-choice], [data-merge-fill]')) control.disabled = busy;
  };
  const markChanged = () => {
    reviewed = false;
    status.textContent = 'Review the selected choices before creating the project.';
    status.classList.remove('warn');
    updateButtons();
  };

  function show(result) {
    plan = result;
    status.textContent = result.pending
      ? `${result.pending} conflict${result.pending === 1 ? '' : 's'} to resolve.`
      : `${result.files.length} project file${result.files.length === 1 ? '' : 's'} ready to merge.`;
    status.classList.remove('warn');
    $('.merge-bulk').hidden = !result.pending;
    const files = result.files.map(path => `<li>${esc(path)}</li>`).join('');
    const moved = result.renumbered?.length ? `<section class="merge-renumbered"><h3>Given new IDs</h3><p class="hint">These new records clashed with the current project's own new records, so the incoming ones take the next free IDs. Battles, shops, equipment and texts in the incoming changes follow them.</p><ul>${result.renumbered.map(note => `<li>${esc(note)}</li>`).join('')}</ul></section>` : '';
    const clash = result.conflicts.find(conflict => conflict.location[0] === 'Linked project changes' && /character or art ID/.test(conflict.reason));
    const copy = clash ? `<section class="merge-copy"><h3>Characters with the same IDs</h3><p class="hint">Both projects made characters with the same sprite, appearance or sheet numbers. Copy the incoming project's characters into <b>${esc(current)}</b> with new numbers first; the merge then leaves them out of the incoming side, so you don't have to keep one project's files whole. Choose <b>Keep current</b> for the character art files it still lists.</p><button type="button" data-merge-copy>Copy characters from ${esc(incoming)} into ${esc(current)}</button></section>` : '';
    const mods = result.mods.length ? `<p><b>Enabled mods</b> ${esc(result.mods.join(' · '))}</p>` : '';
    review.innerHTML = copy + moved + result.conflicts.map(conflict => `
      <section class="merge-conflict">
        <h3>${conflict.location.map(esc).join(' › ')}</h3>
        <p class="hint">${esc(conflict.reason)}</p>
        ${conflict.original === null ? '' : `<p class="hint"><b>Original</b> ${esc(conflict.original)}</p>`}
        <dl class="merge-values">${Object.entries(conflict.options).map(([side,value]) =>
          `<div><dt>${esc(labels[side])}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
        <label>Resolve conflict <select data-merge-choice="${esc(conflict.id)}">
          <option value="">Choose an option</option>
          ${Object.keys(conflict.options).map(side => `<option value="${esc(side)}" ${conflict.choice === side ? 'selected' : ''}>${esc(labels[side])}</option>`).join('')}
        </select></label>
      </section>`).join('') + mods + (files ? `<details><summary>Project files (${result.files.length})</summary><ul>${files}</ul></details>` : '')
      + (result.applyIssue ? `<p class="hint warn"><b>Apply preview</b> ${esc(result.applyIssue)}</p>` : '')
      + (result.apply?.changed.length ? `<p class="hint warn">Apply will flag ${result.apply.changed.length} file(s) that differ from the project’s original game data.</p>` : '');
    const copyButton = review.querySelector('[data-merge-copy]');
    if (copyButton) copyButton.onclick = () => copyCharacters();
    for (const select of review.querySelectorAll('[data-merge-choice]')) {
      select.onchange = () => {
        if (select.value) choices[select.dataset.mergeChoice] = select.value;
        else delete choices[select.dataset.mergeChoice];
        markChanged();
      };
    }
  }

  async function request(commit = false) {
    if (busy || (commit && !reviewed) || !name.reportValidity()) return;
    busy = true;
    updateButtons();
    status.classList.remove('warn');
    status.textContent = commit ? 'Creating the merged project…' : 'Comparing the saved projects…';
    try {
      const result = await source.project('merge', { current, incoming, name: name.value.trim(), choices,
        ...(commit ? { commit: true, token: plan.token } : {}) });
      if (commit) {
        created = result.project;
        dialog.close();
      } else {
        show(result);
        reviewed = true;
      }
    } catch (error) {
      reviewed = false;
      status.textContent = error.message;
      status.classList.add('warn');
    } finally {
      busy = false;
      updateButtons();
    }
  }

  async function copyCharacters() {
    if (busy) return;
    busy = true;
    updateButtons();
    status.classList.remove('warn');
    try {
      const [{ copyCharactersPlan }, { stageArtImport }] = await Promise.all([import('../game/artcopycharacter.js'), import('../game/artimport.js')]);
      const [theirs, ours, info] = await Promise.all([source.projectCharacters(incoming), source.projectCharacters(current), source.info()]);
      const done = new Set(ours.characters.filter(c => c.copiedFrom?.project === incoming).map(c => `${c.copiedFrom.stem.toLowerCase()}:${c.copiedFrom.template}`));
      const clashes = theirs.characters.filter(c => !done.has(`${c.stem.toLowerCase()}:${c.template}`)
        && ours.characters.some(o => o.template === c.template || o.actor === c.actor || o.appearance === c.appearance || o.stem.toLowerCase() === c.stem.toLowerCase()));
      if (!clashes.length) throw new Error('No incoming character shares an ID with this project.');
      const plan = await copyCharactersPlan({ from: incoming, characters: clashes, progress: text => { status.textContent = text; } });
      status.textContent = 'Adding the copied characters to the project…';
      if (info.project !== current) throw new Error(`Open “${current}” to copy characters into it.`);
      await stageArtImport(plan, { name: current, baseProject: current, dataRoot: info.dataRoot, intoOpen: true });
      status.textContent = plan.notes.slice(0, -1).join(' ');
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('warn');
      busy = false;
      updateButtons();
      return;
    }
    busy = false;
    const note = status.textContent;
    await request();
    status.textContent = `${note} ${status.textContent}`;
  }

  name.oninput = markChanged;
  inspect.onclick = () => request();
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('form').onsubmit = event => { event.preventDefault(); request(true); };
  for (const button of dialog.querySelectorAll('[data-merge-fill]')) {
    button.onclick = () => {
      for (const select of review.querySelectorAll('[data-merge-choice]')) {
        if (select.value) continue;
        select.value = button.dataset.mergeFill;
        choices[select.dataset.mergeChoice] = select.value;
      }
      markChanged();
    };
  }
  try {
    const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
    dialog.showModal();
    request();
    await closed;
    return created;
  } finally {
    dialog.remove();
  }
}

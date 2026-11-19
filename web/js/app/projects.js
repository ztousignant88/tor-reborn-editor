// The Files menu: projects. A project keeps edited game files apart from the
// game (serve.py: editor/projects/<name>/). While one is open, the editor reads
// its files over the game's and Save writes into it, so several projects can be
// worked on side by side. Apply project copies one into the game (originals
// backed up, FileTable.bin patched); applying another can first take the
// previous one's other files out (back to their originals). With no project
// open, Save writes straight to the game as before.

import { source } from '../game/source.js';
import { mergeProjects } from './projectmerge.js';
import { runProjectApply } from './projectapply.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const list = (paths, max = 12) => paths.slice(0, max).map((p) => `  ${p}`).join('\n') + (paths.length > max ? `\n  … and ${paths.length - max} more` : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class Projects {
  constructor(ctx) {
    // { info(), refreshInfo(), pending() -> {total}, save({quiet}) -> bool, restore(), leave(), toast, setStatus }
    this.ctx = ctx;
    this.dialog = document.querySelector('#project-dialog');
    for (const b of document.querySelectorAll('#files-menu [data-act]')) {
      b.onclick = () => {
        this.ctx.closeMenu();
        this.run(b.dataset.act).catch((err) => { console.error(err); this.ctx.toast(err.message, true); });
      };
    }
  }

  get open() { return this.ctx.info()?.project ?? null; }

  /** The project name in the top bar and at the top of the Files menu. */
  render() {
    const info = this.ctx.info();
    const name = document.querySelector('#project-name');
    name.textContent = info?.project ?? 'none';
    name.classList.toggle('none', !info?.project);
    name.title = info?.project ? `Saves go into the project "${info.project}" (${info.projectRoot}). Apply project puts it in the game.` : 'No project open: saves go straight to the game.';
    document.querySelector('#files-project').innerHTML = `${info?.project ? `Project: <b>${esc(info.project)}</b><br><span class="muted">Save writes into the project, not the game.</span>` : '<b>No project open</b><br><span class="muted">Save writes straight to the game.</span>'}${info?.applied ? `<br><span class="muted">In the game: ${esc(info.applied)}</span>` : ''}`;
    document.querySelector('#files-menu [data-act="save"]').textContent = info?.project ? 'Save project' : 'Save project…';
    const merge = document.querySelector('#files-menu [data-act="merge"]');
    merge.disabled = !info?.projectMergeVersion || !info.project || info.readOnly;
    merge.title = !info?.projectMergeVersion ? 'Restart the editor to merge projects' : !info.project ? 'Open the starting project' : '';
  }

  async run(act) {
    if (act !== 'load' && this.ctx.info()?.readOnly) { this.ctx.toast('Read-only mode: start the server without --readonly to change files.', true); return; }
    if (act === 'new') return this.newProject();
    if (act === 'save') return this.saveProject();
    if (act === 'saveas') return this.saveAs();
    if (act === 'load') return this.load();
    if (act === 'merge') return this.merge();
    if (act === 'apply') return this.apply();
    if (act === 'restore') return this.ctx.restore();
  }

  askName(question, suggestion = '') {
    const name = prompt(`${question}\n(letters, digits, spaces and - _ ( ) ', up to 60)`, suggestion);
    return name === null ? null : name.trim() || null;
  }

  reload(message) {
    this.ctx.toast(`${message} Reloading…`);
    this.ctx.leave();
    setTimeout(() => location.reload(), 600);
  }

  async newProject() {
    const name = this.askName('Name the new project:');
    if (!name) return;
    if (this.ctx.pending().total && !confirm(`Unsaved changes will be dropped. (To keep them in a new project, use Save project as.)\n\nStart the empty project "${name}"?`)) return;
    await source.project('new', { name });
    this.reload(`New project "${name}" opened with the game data from before project changes.`);
  }

  async saveProject() {
    if (!this.open) return this.saveAs();
    if (!this.ctx.pending().total) { this.ctx.toast(`Nothing to save: "${this.open}" has every change.`); return; }
    await this.ctx.save();
  }

  async saveAs() {
    const name = this.askName('Save the project as:', this.open ? `${this.open} copy` : '');
    if (!name) return;
    let includeGame = false;
    if (!this.open) {
      const changed = (await source.backups()).filter((f) => f !== 'FileTable.bin');
      if (changed.length) {
        includeGame = confirm(`The editor has already saved changes to ${plural(changed.length, 'file')} in the game:\n${list(changed)}\n\nPut those in "${name}" too?\nOK: include them. Cancel: leave them out (they stay in the game).`);
      }
    }
    const r = await source.project('saveas', { name, includeGame });
    await this.ctx.refreshInfo();
    const saved = this.ctx.pending().total ? await this.ctx.save({ quiet: true }) : true;
    this.ctx.toast(`Saved as "${name}"${r.files.length ? ` (${plural(r.files.length, 'file')} carried over)` : ''}${saved ? '' : ', but the unsaved changes were not saved'}. Saves now go into it.`, !saved);
  }

  async merge() {
    const current = this.open;
    if (!current) return;
    if (this.ctx.pending().total) {
      if (!confirm('Save changes to the open project before merging?')) return;
      if (!(await this.ctx.save({ quiet: true }))) return;
    }
    const incoming = await this.pick({ title: 'Choose a project to merge', ok: 'Compare', exclude: current,
      hint: `Review changes from another saved project and save the result as a new project based on “${current}”.` });
    if (!incoming) return;
    const result = await mergeProjects(current, incoming);
    if (!result) return;
    await source.project('open', { name: result });
    this.reload(`Merged project “${result}” is open.`);
  }

  async load() {
    const pick = await this.pick({ title: 'Load a project', ok: 'Load', none: 'No project: edit the game directly',
      hint: 'A project shows its own edits over the game data from before project changes. The installed game changes when you apply a project.' });
    if (pick === undefined || pick === this.open) return;
    if (this.ctx.pending().total && !confirm(`Unsaved changes will be dropped. Load ${pick ? `"${pick}"` : 'the game without a project'}?`)) return;
    await source.project('open', { name: pick });
    this.reload(pick ? `Project "${pick}" loaded.` : 'No project open: saves go straight to the game.');
  }

  async apply() {
    const { applied } = await source.projects();
    const pick = await this.pick({
      title: 'Apply a project to the game', ok: 'Next…',
      hint: 'Copies the project\'s files into the game. Originals are backed up the first time a file is changed, so Restore originals can always undo it.',
      option: applied?.name ? `Take "${applied.name}" out first: restore the files the chosen project leaves out to their pre-project versions` : null,
    });
    if (!pick) return;
    const revertOthers = !!this.dialog.querySelector('#pd-revert')?.checked;
    const saving = this.ctx.finishSave();
    if (saving && !(await saving)) return;
    if (pick === this.open && this.ctx.pending().total) {
      if (confirm(`"${pick}" has unsaved changes. Save them into the project first?\n\nOK: save, then apply. Cancel: apply what was saved last.`)) {
        if (!(await this.ctx.save({ quiet: true }))) return;
      }
    }
    const request = this.ctx.info().applyProgressVersion ? runProjectApply : body => source.project('apply', body);
    const plan = await request({ name: pick, dryRun: true, revertOthers });
    if (!plan) return;
    const write = plan.files.filter((f) => f.status !== 'same').map((f) => f.path);
    const same = plan.files.filter((f) => f.status === 'same').length;
    const others = revertOthers ? plan.others : [...new Set([...(plan.classRestore ?? []), ...(plan.weaponRestore ?? []), ...(plan.spellRestore ?? []), ...(plan.levelCapRestore ?? []), ...(plan.aiChoiceRestore ?? []), ...(plan.dorgaluaXLRestore ?? [])])];
    const runtimeFiles=plan.runtime?.changed??[];
    if (!write.length && !others.length && !runtimeFiles.length) { this.ctx.toast(`Everything in "${pick}" is already in the game.`); return; }
    const text = [
      `Apply "${pick}" to the game in:\n${this.ctx.info().dataRoot}`,
      write.length ? `Writes ${plural(write.length, 'file')}:\n${list(write)}` : 'Writes no files.',
      same ? `Already in the game: ${plural(same, 'file')}.` : '',
      plan.changed.length ? `Changed in the game since "${pick}" was saved (by another mod or a direct save). Applying replaces them:\n${list(plan.changed)}` : '',
      others.length ? `Restore ${plural(others.length, 'file')} to the pre-project game data:\n${list(others)}` : '',
      runtimeFiles.length ? `Updates menu runtime files beside the game executable: ${runtimeFiles.join(', ')}.\nEnabled: ${(plan.runtime.enabled??[]).join(', ')||'normal game behaviour'}. Close the game before applying; these changes take effect on the next launch.` : '',
      'Originals are backed up the first time a file is changed.',
    ].filter(Boolean).join('\n\n');
    if (!confirm(text)) return;
    const r = await request({ name: pick, revertOthers });
    if (!r) return;
    await this.ctx.refreshInfo();
    const message = `Applied "${pick}": ${plural(r.written.length, 'file')} written${r.reverted.length ? `, ${r.reverted.length} put back to the original` : ''}${r.runtimeFiles?.length ? `, ${r.runtimeFiles.length} menu runtime files updated` : ''}.`;
    this.ctx.setStatus(message);
    if (this.ctx.pending().total) this.ctx.toast(`${message} Reload the editor before editing those files.`);
    else this.reload(message);
  }

  /**
   * The project picker. Resolves to a project name, null for the "none" choice,
   * or undefined when cancelled. `option` adds a checkbox (ticked) under the list.
   */
  async pick({ title, ok, hint, none = null, option = null, exclude = null }) {
    const { projects, open, applied } = await source.projects();
    const d = this.dialog;
    d.querySelector('#pd-title').textContent = title;
    d.querySelector('#pd-hint').textContent = hint ?? '';
    d.querySelector('#pd-ok').textContent = ok;
    const rows = projects.filter(p => p.name !== exclude).map((p) => {
      const badges = [p.name === open && 'open', p.name === applied?.name && 'in the game', p.menuMods && 'menu controls'].filter(Boolean);
      return `<label class="pd-item"><input type="radio" name="pd-pick" value="${esc(p.name)}">
        <span class="pd-name">${esc(p.name)}${badges.map((b) => ` <span class="pd-badge">${b}</span>`).join('')}</span>
        <span class="pd-meta">${plural(p.files.length, 'file')}${p.saved ? ` · saved ${esc(p.saved)}` : ''}</span></label>`;
    });
    if (none) rows.push(`<label class="pd-item"><input type="radio" name="pd-pick" value=""><span class="pd-name">${esc(none)}${open ? '' : ' <span class="pd-badge">open</span>'}</span></label>`);
    const listBox = d.querySelector('#pd-list');
    listBox.innerHTML = rows.length ? rows.join('') : '<p class="muted">No projects yet. Make one with New project or Save project as.</p>';
    const radios = [...listBox.querySelectorAll('input[name="pd-pick"]')];
    const preferred = radios.find((r) => r.value === (open ?? '')) ?? radios[0];
    if (preferred) preferred.checked = true;
    d.querySelector('#pd-ok').disabled = !radios.length;
    d.querySelector('#pd-options').innerHTML = option ? `<label class="check"><input type="checkbox" id="pd-revert" checked> ${esc(option)}</label>` : '';
    d.returnValue = '';
    d.showModal();
    (preferred ?? d.querySelector('#pd-ok')).focus();
    await new Promise((resolve) => d.addEventListener('close', resolve, { once: true }));
    if (d.returnValue !== 'ok') return undefined;
    const chosen = radios.find((r) => r.checked);
    if (!chosen) return undefined;
    return chosen.value || null;
  }
}

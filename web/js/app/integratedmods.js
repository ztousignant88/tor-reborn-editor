import {renderEquipmentSetBonuses} from './equipmentsetbonuses.js';
import{canRemoveStatusBehaviours}from'../game/aieditor.js';
import { parseXlce } from '../lib/pakd.js';
import { AI_ENTRY, AI_PLUS_REMOVAL_DEFAULTS, BEHAVIOURS, STOCK_AI_ROWS, W, addedBehaviours, aiLabels, behaviourRow } from '../game/aiprofiles.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class IntegratedMods {
  constructor(ed) {
    this.ed = ed; // DataEditor (dat, original, races, ctx)
    this.mods = [{key:"menu-controls",title:"Menu controls",applied:()=>!!ed.menuMods?.enabledIn('menu'),changed:()=>!!ed.menuMods?.dirtyIn('menu'),render:(detail,onChange)=>ed.menuMods.render(detail,onChange,ed)},this.statusBehaviours()];
    this.mods.push({key:'expanded-loadout',title:'Expand Skill & Spell Slots',
      applied:()=>!!ed.menuMods?.value.expandedLoadout,
      changed:()=>!!ed.menuMods?.dirtyIn('expanded-loadout'),
      render:(detail,onChange)=>ed.menuMods.renderExpandedLoadout(detail,onChange,ed)});
    this.mods.push({key:'bug-fixes',title:'Bug Fixes',
      applied:()=>!!ed.menuMods?.enabledIn('bug-fixes'),
      changed:()=>!!ed.menuMods?.dirtyIn('bug-fixes'),
      render:(detail,onChange)=>ed.menuMods.renderBugFixes(detail,onChange,ed)});
    this.mods.push(this.classChange('modPreparation','Mod Preparation'));
    this.mods.push({key:'equipment-set-bonuses',title:'Equipment Set Bonuses',
      applied:()=>!!ed.menuMods?.value.equipmentSetBonuses,
      changed:()=>!!ed.menuMods&&(ed.menuMods.setsDirty||['equipmentSetBonuses','equipmentSetFreeSkills'].some(
        key=>!!ed.menuMods.value[key]!==!!JSON.parse(ed.menuMods.original)[key])),
      render:(detail,onChange)=>renderEquipmentSetBonuses(detail,ed.menuMods,ed,onChange)});
    this.mods.push(this.classChange('specialClassChange','Special Characters Can Change Class'));
    this.mods.push(this.weaponMod('proficiencyII','Proficiency II'));
    this.mods.push(this.weaponMod('throwReborn','Throw Reborn'));
    this.mods.push(this.weaponMod('rougesReborn','Rouges Reborn'));
    this.mods.push({
      key: 'versus', title: 'Versus Mode',
      applied: () => !!ed.menuMods?.value.versusEnabled,
      changed: () => !!ed.menuMods?.dirtyIn('versus'),
      render: (detail, onChange) => this.renderVersus(detail, onChange),
    });
    this.mods.push({key:'hard-mode',title:'Hard Mode',
      applied:()=>!!ed.menuMods?.value.enemyArcherRange||!!ed.menuMods?.value.enemyLevelScaling||ed.menuMods?.enemyLoadoutsEnabled||ed.menuMods?.startingCardsEnabled('enemyStartingCards')||ed.menuMods?.statusEnabled(true)||ed.menuMods?.overworldEncountersEnabled,
      changed:()=>!!ed.menuMods&&(!!ed.menuMods.value.enemyArcherRange!==!!JSON.parse(ed.menuMods.original).enemyArcherRange||ed.menuMods.startingCardsChanged('enemyStartingCards')||ed.menuMods.statusChanged(true)||ed.menuMods.enemyLevelsChanged||ed.menuMods.enemyLoadoutsChanged||ed.menuMods.overworldEncountersChanged),
      render:(detail,onChange)=>ed.menuMods.renderHardMode(detail,onChange,ed)});
    this.mods.push({key:'cheats',title:'Cheats',
      applied:()=>ed.menuMods?.cheatsEnabled,
      changed:()=>ed.menuMods?.cheatsChanged,
      render:(detail,onChange)=>ed.menuMods.renderCheats(detail,onChange,ed)});
    if(ed.pspSpells)this.mods.push({key:'psp-spells',title:'PSP spell restoration',applied:()=>ed.pspSpells.enabled,changed:()=>ed.pspSpells.dirty||ed.battleChanged()&&ed.pspSpells.count>0,render:(detail,onChange)=>ed.pspSpells.render(detail,onChange)});
  }

  /** The AI table (battle data entry 27) as it is now. */
  aiTable() { return parseXlce(this.ed.dat.pakd.entries[AI_ENTRY].data); }

  statusBehaviours() {
    const ed = this.ed;
    const mods = ed.menuMods;
    const ids = BEHAVIOURS.map((_, k) => STOCK_AI_ROWS + k);
    const profilesPresent = () => this.aiTable().count >= STOCK_AI_ROWS + BEHAVIOURS.length;
    const scoringEnabled = () => !!(mods?.value.aiStatus || mods?.value.aiStatusAll);
    const canRemove = () => {
      const table = this.aiTable();
      return table.count === STOCK_AI_ROWS || canRemoveStatusBehaviours(table, addedBehaviours(table));
    };
    const addProfiles = () => {
      const table = this.aiTable();
      if (profilesPresent()) return;
      if (table.count < STOCK_AI_ROWS) throw new Error('The game’s original AI profiles are missing.');
      const rows = BEHAVIOURS.slice(table.count - STOCK_AI_ROWS).map(preset => behaviourRow(table, preset));
      for (const row of rows) ed.appendEntryRow(AI_ENTRY, row);
    };
    return {
      key: 'status-ai',
      title: 'AI Plus',
      summary: `AI ${ids[0]} prioritizes buffs and AI ${ids[1]} prioritizes ailments. Assign the profiles under Battles → AI behaviour, or enable the Buff and Debuff choices below for player Auto Battle.`,
      untested: 'The native game scores status effects as zero during AI look-ahead. AI Plus corrects that scoring for the selected profiles.',
      applyLabel: () => profilesPresent() ? 'Enable AI status scoring' : 'Add AI Plus profiles',
      ready: () => mods?.value.aiPlusProfiles === 'remove'
        ? 'Save and apply to remove Support and Ailments. Apply Project checks for any remaining assignments.'
        : profilesPresent() ? 'Profiles 113 and 114 are present. Save and apply the project to install them.' : '',
      controls: (detail,onChange) => {
        mods?.renderOptions(detail,onChange,ed,'ai');
        this.renderTrapAI(detail,onChange);
      },
      applied: () => !!mods?.enabledIn('ai'),
      changed: () => this.aiTable().count !== ed.originalEntries[AI_ENTRY].count || !!mods?.dirtyIn('ai'),
      applyDisabled: () => profilesPresent() && scoringEnabled(),
      undoLabel: 'Remove AI Plus',
      undoChanged: () => !!mods?.info.project && canRemove() &&
        (mods.enabledIn('ai') || this.aiTable().count > STOCK_AI_ROWS || mods.value.aiPlusProfiles === 'remove'),
      undoHint: () => !canRemove() ? 'AI Plus rows can be removed when they have their original weights and no later profile uses a higher ID. Use the runtime switches to disable scoring while keeping custom profiles.' : '',
      apply: () => {
        if (mods?.info.project && mods.value.aiPlusProfiles === 'remove') mods.restoreAIPlusProfiles();
        else addProfiles();
        if (mods?.supported && !scoringEnabled()) mods.value.aiStatus = true;
      },
      undo: () => this.removeAIPlus(mods),
    };
  }

  async removeAIPlus(mods) {
    const dialog = document.createElement('dialog');
    dialog.className = 'project-dialog';
    dialog.innerHTML = `<form method="dialog">
      <h2>Remove AI Plus</h2>
      <p>Choose what to do with battle units and saved Versus fighters assigned to Support or Ailments.</p>
      <label><input type="checkbox" name="reassign" checked> Use replacement AI profiles</label>
      <fieldset>
        <label class="field">Support (Buff) <select name="support" aria-label="Replacement for Support"></select></label>
        <label class="field">Ailments (Debuff) <select name="ailments" aria-label="Replacement for Ailments"></select></label>
      </fieldset>
      <p class="hint">Affected battles use the replacements after you apply the project. Saved Versus teams use them when you queue a fight.</p>
      <div class="pd-actions"><button value="cancel" class="ghost">Cancel</button><button value="remove" class="primary">Remove AI Plus</button></div>
    </form>`;
    const table = this.aiTable();
    const labels = aiLabels(table).filter(({id}) => id > 0 && id < STOCK_AI_ROWS && table.row(id).some(Boolean));
    const defaults = mods.value.aiPlusReplacements ?? AI_PLUS_REMOVAL_DEFAULTS;
    const selects = [...dialog.querySelectorAll('select')];
    for (const [index, select] of selects.entries()) {
      select.replaceChildren(...labels.map(({id, name}) => new Option(`#${id} · ${name}`, id)));
      select.value = String(defaults[index]);
    }
    const reassign = dialog.querySelector('input');
    reassign.onchange = () => { dialog.querySelector('fieldset').disabled = !reassign.checked; };
    document.body.append(dialog);
    dialog.showModal();
    await new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
    const confirmed = dialog.returnValue === 'remove';
    if (confirmed) mods.removeAIPlus(reassign.checked ? selects.map(select => Number(select.value)) : []);
    dialog.remove();
    return confirmed;
  }

  renderTrapAI(detail,onChange) {
    const ed=this.ed, mods=ed.menuMods;
    const table=this.aiTable(), id=mods?.value.trapAiProfile??0;
    const first=STOCK_AI_ROWS+BEHAVIOURS.length;
    const added=id>=first && id<table.count;
    const disabled=!mods?.info.trapAiVersion||!mods.info.project||!mods.value.rougesReborn||ed.ctx.readOnly?.();
    const section=document.createElement('section');
    section.innerHTML=`<h3>Trap AI</h3>
      <p>Strongly prioritizes Booby Trap on valid ground near opponents. Units need the skill equipped and enough MP. Other turns use the preset’s melee priorities.</p>
      ${added?`<p>Assign <b>Trap AI (#${id})</b> in Battles → AI behaviour. ${mods.value.rougesReborn?'Save and apply the project to use it.':'Enable Rouges Reborn to use trap scoring.'}</p>`:
        `<p class="hint">${!mods?.info.project?'Open a project to add this preset.':!mods.value.rougesReborn?'Enable Rouges Reborn to add this preset.':table.count<first?'Apply AI Plus above to add the Buff and Debuff profiles first.':table.count>255?'All AI profile slots are occupied.':'Adds a new profile. Existing assignments stay as they are.'}</p>
         <button data-trap-ai ${disabled||table.count<first||table.count>255?'disabled':''}>Add Trap AI preset</button>`}`;
    detail.append(section);
    const button=section.querySelector('[data-trap-ai]');
    if(button)button.onclick=()=>{
      const latest=this.aiTable();
      if(disabled||latest.count<first||latest.count>255)return;
      const row=behaviourRow(latest,{base:11,set:{[W.friendlyDamage]:-2000}});
      const profile=ed.appendEntryRow(AI_ENTRY,row);
      mods.value.trapAiProfile=profile;
      ed.ctx.tables?.()?.updateProjectOptions(mods);
      onChange();
    };
  }

  classChange(key,title) {
    const options=this.ed.menuMods;
    return {key,title,applied:()=>!!options?.value[key],
      changed:()=>!!options&&(!!options.value[key]!==!!JSON.parse(options.original)[key]||
          (key==='modPreparation'&&(options.groupsDirty||options.spellSetsDirty||options.skillSetsDirty||options.equipmentPermissionsDirty))||
        (key==='specialClassChange'&&['advancedBeastFamilies','genericSpecialRecruitment'].some(
          field=>!!options.value[field]!==!!JSON.parse(options.original)[field]))),
      render:(detail,onChange)=>options.renderClassChange(detail,onChange,this.ed,key,title)};
  }

  weaponMod(key,title) {
    const options=this.ed.menuMods;
    return {key,title,applied:()=>!!options?.value[key],
      changed:()=>!!options&&!!options.value[key]!==!!JSON.parse(options.original)[key],
      render:(detail,onChange)=>options.renderWeaponMod(detail,onChange,this.ed,key,title)};
  }

  renderVersus(detail, onChange) {
    const mods = this.ed.menuMods;
    const supported = mods?.info.versusModsVersion && mods.info.expandedBattlesSupported;
    const writable = !!mods?.info.project && !this.ed.ctx.readOnly?.();
    const enabled = !!mods?.value.versusEnabled;
    const pending = mods?.dirtyIn('versus');
    const ready = supported && mods?.savedVersusEnabled;
    detail.innerHTML = `<div class="data-head"><div>
      <h1>Versus Mode</h1>
      <p>Watch two AI-controlled teams fight at Almorica Castle. Import fighters from saves, assign AI profiles, or generate themed teams for single matches and tournaments.</p>
      <label><input type="checkbox" data-versus-enable ${enabled ? 'checked' : ''}
        ${!supported || !writable || mods.saved?.versusLegacy ? 'disabled' : ''}> Enable Versus Mode</label>
      <p class="hint">${!supported ? 'Requires Steam 1.0.8.0.'
        : !mods.info.project ? 'Open or create a project to enable Versus.'
        : mods.saved?.versusLegacy ? 'This project includes a built-in Training fight.'
        : pending ? 'Save the project, then apply it and restart the game.'
        : !enabled ? 'Turn on Versus Mode and save the project to open Versus.'
        : 'Use the Versus button in the top bar to set up matches. Expanded Battle Limit supports 24 vs 24 fights and 30 vs 30 tournaments.'}</p>
      <div class="data-actions"><button type="button" data-versus-open ${ready ? '' : 'disabled'}>Open Versus</button></div>
    </div></div>`;
    detail.querySelector('[data-versus-enable]').onchange = event => {
      mods.value.versusEnabled = event.target.checked;
      onChange();
    };
    detail.querySelector('[data-versus-open]').onclick = () => document.getElementById('versus-btn').click();
  }

  renderList(list, selected, onSelect) {
    list.innerHTML = '';
    this.mods.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = `data-item${i === selected ? ' active' : ''}`;
      b.dataset.index = String(i);
      b.style.gridTemplateColumns = 'minmax(0, 1fr) auto';
      b.innerHTML = `<span class="data-name">${esc(m.title)}${m.changed() ? ' <span class="dirty">●</span>' : ''}</span><span class="picker-id">${m.applied() ? 'on' : 'off'}</span>`;
      b.onclick = () => onSelect(i);
      list.append(b);
    });
  }

  renderDetail(detail, i, onChange) {
    const m = this.mods[i];
    if(m.render){m.render(detail,onChange);return;}
    const on = m.applied();
    const canApply = !(m.applyDisabled?.() ?? on) && !this.ed.ctx.readOnly?.();
    detail.innerHTML = `
      <div class="data-head">
        <div>
          <h1>${esc(m.title)}</h1>
          <div class="meta">Integrated mod · ${on ? 'applied' : 'not applied'} · saved with the game data (battle_data_release.dat)</div>
          <p class="mod-summary">${esc(m.summary)}</p>
          <p class="hint warn">${esc(m.untested ?? 'Not tested in game yet: check a few special characters in different classes (sprite, skills, equipment) before relying on it.')}</p>
          <div class="data-actions">
            ${canApply ? `<button id="mod-apply">${esc(m.applyLabel?.() ?? 'Apply')}</button>` : ''}
            <button id="mod-undo" class="ghost" ${!this.ed.ctx.readOnly?.() && (m.undoChanged?.() ?? m.changed()) ? '' : 'disabled'}>${esc(m.undoLabel ?? 'Undo')}</button>
          </div>
          ${m.undoHint?.() ? `<p class="hint">${esc(m.undoHint())}</p>` : ''}
          ${m.ready?.() ? `<p class="hint">${esc(m.ready())}</p>` : ''}
        </div>
      </div>`;
    if(m.controls){const controls=document.createElement('div');controls.className='mod-details';detail.append(controls);m.controls(controls,onChange);}
    const guard = () => {
      if (!this.ed.ctx.readOnly?.()) return true;
      this.ed.ctx.toast('Read-only mode: start the server without --readonly to edit.', true);
      return false;
    };
    const progress = (text) => this.ed.ctx.setStatus(text);
    const apply = detail.querySelector('#mod-apply');
    if (apply) apply.onclick = async (e) => {
      if (!guard()) return;
      e.target.disabled = true;
      try {
        await m.apply(progress);
        this.ed.ctx.setStatus(`Applied: ${m.title}`);
      } catch (err) {
        console.error(err);
        this.ed.ctx.toast(err.message, true);
      }
      onChange();
    };
    detail.querySelector('#mod-undo').onclick = async () => { if (guard() && await m.undo()) onChange(); };
  }
}

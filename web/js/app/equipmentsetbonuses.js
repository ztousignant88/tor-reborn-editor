export function renderEquipmentSetBonuses(detail, mods, ed, onChange) {
  const slots = mods.saved?.equipmentSetSlots;
  const supported = !!mods.info.project && !!slots;
  const disabled = !supported || ed.ctx.readOnly?.();
  const value = mods.value;
  const remaining = slots ? slots.limit - slots.first - mods.equipmentSets.length : 0;
  detail.innerHTML = `<div class="data-head"><div><h1>Equipment Set Bonuses</h1><p class="muted">Integrated mods · Project settings</p></div></div>
    <label class="menu-mod-option"><input type="checkbox" data-set-bonuses ${value.equipmentSetBonuses ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span><b>Enable Equipment Set Bonuses</b><small>Use the custom equipment sets saved with this project. The bonus activates at three matching equipped pieces.</small></span></label>
    <label class="menu-mod-option"><input type="checkbox" data-set-slot-free ${value.equipmentSetFreeSkills ? 'checked' : ''} ${disabled || !value.equipmentSetBonuses ? 'disabled' : ''}>
      <span><b>Slot-free equipment set skills</b><small>Use active set skills directly in battle. This also applies to stock sets. Leave off to equip those skills in a regular slot.</small></span></label>
    <p class="hint">${supported ? `${remaining} custom set slots available. Save the project, then use Apply Project.` : 'Open a project to configure equipment set bonuses.'}</p>
    <button type="button" data-edit-sets>Edit equipment sets</button>`;
  const enable = detail.querySelector('[data-set-bonuses]');
  const slotFree = detail.querySelector('[data-set-slot-free]');
  enable.onchange = () => {
    if (enable.disabled) return;
    value.equipmentSetBonuses = enable.checked;
    if (!enable.checked) value.equipmentSetFreeSkills = false;
    onChange();
  };
  slotFree.onchange = () => {
    if (slotFree.disabled) return;
    value.equipmentSetFreeSkills = slotFree.checked;
    onChange();
  };
  detail.querySelector('[data-edit-sets]').onclick = () => ed.openOtherCategory(1001);
}

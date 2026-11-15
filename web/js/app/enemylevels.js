export function renderEnemyLevels(section, value, supported, readOnly, onChange) {
  const disabled = !supported || readOnly;
  section.innerHTML = `<h2>Enemy levels</h2>
    <label class="menu-mod-option"><input type="checkbox" data-enemy-levels ${value.enemyLevelScaling ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span><b>Scale enemy levels to your party</b><small>Sets every enemy to your highest deployed character’s original level plus the extra levels below, up to level 99. Enemy stats adjust. Equipment, spells and skills keep their assigned loadouts.</small></span></label>
    <label class="menu-mod-option"><input type="number" data-enemy-level-offset aria-label="Extra enemy levels" min="0" max="49" step="1" required style="width:6em;flex:0 0 6em" value="${value.enemyLevelOffset}" ${disabled || !value.enemyLevelScaling ? 'disabled' : ''}>
      <span><b>Extra enemy levels</b><small>Choose 0–49. Zero matches your highest deployed level. Friendly guests count toward the reference level.</small></span></label>
    <p class="hint">The reference locks when combat starts. All enemies use the same target level, so stronger bosses can be reduced to that level.</p>
    <p class="hint">After restarting the game and resuming a suspended battle, the reference is rebuilt from the deployed allies still present. If your highest-level ally has left, the target can change.</p>`;
  section.querySelector('[data-enemy-levels]').onchange = event => {
    if (disabled) return;
    value.enemyLevelScaling = event.target.checked;
    onChange();
  };
  const offset = section.querySelector('[data-enemy-level-offset]');
  offset.onchange = () => {
    if (disabled || !value.enemyLevelScaling) return;
    const next = Number(offset.value);
    if (!offset.value.trim() || !Number.isInteger(next) || next < 0 || next > 49) {
      offset.reportValidity();
      offset.value = String(value.enemyLevelOffset);
      return;
    }
    value.enemyLevelOffset = next;
    onChange();
  };
}

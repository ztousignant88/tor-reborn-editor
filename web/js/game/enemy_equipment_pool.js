// Mirrors the enemy auto-loadout rules in the game loader.
const heavenlyWeapons = new Set([24, 49, 77, 110, 137, 165, 188, 219, 243, 270, 312, 338]);
const forceCrest = 'enemyForceCrestOfFire';
export const enemyPoolOptions = ['enemyRandomEquipment', 'enemyAutoGear', 'enemyAutoRareGear',
  'enemyAutoAccessories', 'enemyAutoMovement', forceCrest, 'enemyAutoHeavenlyWeapons'];

export function enemyPoolRow(row, id, settings, override = {}) {
  const type = row[2], name = row[0x86] | (row[0x87] << 8);
  if (type === 29 && settings[forceCrest]) {
    return {allowed: id === 590, level: id === 590 ? 1 : row[0x60], locked: true,
      preset: 'Crest of Fire only'};
  }
  if (id === 386 || id === 394 || (id >= 661 && id <= 685))
    return {allowed: false, level: row[0x60], locked: true, preset: 'Excluded from enemy pool', note: 'Battle-specific variant'};
  if (row[0x60] === 255)
    return {allowed: false, level: override.level ?? 255, locked: true, preset: '', note: 'Excluded in base pool'};
  const stock = {allowed: type > 0 && type <= 28 && !row[0xe] && row[0x60] !== 255 && id < 761, level: row[0x60]};
  let {allowed, level} = stock;
  const movement = (type === 27 && name >= 524 && name <= 526) ||
    (type === 29 && ((name >= 584 && name <= 586) || name === 590));
  if (type === 29 && (settings.enemyAutoAccessories || settings.enemyAutoMovement)) {
    if (name === 590) level = 50;
    else if (movement) level = 33;
    else if (settings.enemyAutoAccessories) {
      if (name >= 535 && name <= 558) level = name <= 536 || (name & 1) ? 7 : 19;
      else if (name >= 559 && name <= 575) level = 45;
      else if (name >= 576 && name <= 588) level = 34;
    }
  }
  if (type > 0 && type <= 29 && row[0x60] !== 255 && level !== 255) {
    if (movement && (settings.enemyAutoGear || settings.enemyAutoRareGear ||
        settings.enemyAutoAccessories || settings.enemyAutoMovement)) {
      allowed = !!settings.enemyAutoMovement;
    } else if (type === 29) {
      allowed = !!settings.enemyAutoAccessories;
    } else if (heavenlyWeapons.has(id)) {
      allowed = !!settings.enemyAutoHeavenlyWeapons;
    } else if (settings.enemyAutoGear || settings.enemyAutoRareGear) {
      allowed = !(id >= 610 && id <= 660) && (!row[0x50] || !!settings.enemyAutoRareGear);
    } else if (id >= 761) {
      allowed = !!settings.modPreparation && !row[0xe] &&
        (enemyPoolOptions.some(key => key !== forceCrest && settings[key]) || Object.keys(settings.enemyEquipmentOverrides ?? {}).length > 0);
    }
  }
  if (id >= 761 && !settings.modPreparation) allowed = false;
  const preset = allowed !== stock.allowed || level !== stock.level ? 'Hard Mode preset' : '';
  level = override.level ?? level;
  allowed = (override.allowed ?? allowed) && level !== 255 && type > 0 && type <= 29 &&
    (id < 761 || !!settings.modPreparation);
  return {allowed, level, preset, locked: false};
}

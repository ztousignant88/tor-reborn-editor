// Editor settings (the ⚙ Settings menu), kept in this browser. The text
// language lives in main.js (it reloads the game's names); this holds the rest.

const HIDE_UNKNOWN_KEY = 'tor-editor:hide-unknown';

function stored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export const settings = {
  /** Hide fields nobody has worked out yet. On unless turned off. */
  hideUnknown: stored(HIDE_UNKNOWN_KEY, true),
};

export function setHideUnknown(on) {
  settings.hideUnknown = on;
  try { localStorage.setItem(HIDE_UNKNOWN_KEY, on ? '1' : '0'); } catch { /* private window: this session only */ }
}

/**
 * A field whose meaning is unknown: the community schemas label those "<unused> 41",
 * "<not used>", or start with "?" ("? Flag ?", "?? 06 Power ?"). Guesses that name
 * a meaning ("Recruitable?", "Class Role?") stay.
 */
export function isUnknownField(label) {
  return /<unused>|<not used>/i.test(label) || /^\s*\?/.test(label);
}

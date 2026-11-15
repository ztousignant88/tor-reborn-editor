// Preview choices belong to one game folder and one open editor project.
// Old unscoped keys stay untouched; a previous map can be adopted explicitly.
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const pathKey = (value) => String(value ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export class MapPreferences {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.scope = null;
    this.choices = {};
    this.contexts = {};
    this.labels = {};
  }

  read(key) {
    try { return object(JSON.parse(this.storage?.getItem(key) ?? 'null')); } catch { return {}; }
  }

  write(kind, value) {
    if (this.scope === null) return;
    try { this.storage?.setItem(this.key(kind), JSON.stringify(value)); } catch { /* Private/disabled storage. */ }
  }

  key(kind) { return `tor-editor:${kind}:v2:${encodeURIComponent(this.scope)}`; }

  setScope(info) {
    const scope = JSON.stringify([pathKey(info.dataRoot), pathKey(info.projectRoot), pathKey(info.project)]);
    if (scope === this.scope) return false;
    this.scope = scope;
    this.choices = this.read(this.key('mapchoice'));
    this.contexts = this.read(this.key('battlecontext'));
    this.labels = this.read(this.key('labels'));
    return true;
  }

  hasChoice(key) { return Object.hasOwn(this.choices, key); }
  setChoice(key, map) { this.choices[key] = map || null; this.write('mapchoice', this.choices); }
  clearChoice(key) { delete this.choices[key]; this.write('mapchoice', this.choices); }
  setContext(key, id) { this.contexts[key] = id; this.write('battlecontext', this.contexts); this.clearChoice(key); }
  setLabel(key, label) {
    if (label) this.labels[key] = label; else delete this.labels[key];
    this.write('labels', this.labels);
  }
  legacyChoice(key) { return this.read('tor-editor:mapchoice:v1')[key] || null; }
  legacyLabel(key) { return this.read('tor-editor:labels:v1')[key] || null; }
}

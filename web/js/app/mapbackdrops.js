import { parseBtx } from '../game/bgscene.js';
import { source } from '../game/source.js';
import { decrypt } from '../lib/crypt.js';
import { unzipSingle } from '../lib/zip.js';
import { textureCanvas } from '../ui/texcanvas.js';
import { attachHelp } from './fieldhelp.js';

export class MapBackdrops {
  constructor(editor) {
    this.editor = editor;
    this.changes = new Map();
  }

  invalidate() {
    this.request = null;
  }

  async load() {
    const request = this.request ??= source.mapBackdrops();
    try {
      return await request;
    } catch (error) {
      if (this.request === request) this.request = null;
      throw error;
    }
  }

  async render(box, id) {
    const panel = document.createElement('section');
    panel.className = 'mp-backdrop';
    const message = document.createElement('p');
    message.className = 'muted';
    message.textContent = 'Loading backdrops…';
    panel.append(message);
    box.replaceChildren(panel);
    try {
      const data = await this.load();
      if (!panel.isConnected) return;
      id = id.toLowerCase();
      if (!Object.hasOwn(data.defaults, id)) {
        message.textContent = 'This map has no battlefield backdrop entry.';
        return;
      }
      const saved = data.project ? data.saved[id] ?? null : data.defaults[id];
      const selection = () => this.changes.has(id) ? this.changes.get(id) : saved;
      const donor = data.templates[id];
      const inherited = donor ? (this.changes.has(donor) ? this.changes.get(donor) : data.saved[donor]) : null;
      const fallback = inherited ?? data.defaults[id];
      const label = document.createElement('label');
      label.textContent = 'Backdrop';
      const select = document.createElement('select');
      select.disabled = this.editor.ctx.readOnly();
      label.append(select);
      attachHelp(select, 'Sets the scenery shown around the battlefield in game.');
      const name = path => path ? path.split('/').at(-1).replace(/\.dat$/, '') : 'None (black)';
      if (data.project) select.add(new Option(donor ? 'Inherit battlefield template' : 'Use map default', ''));
      for (const choice of data.choices) {
        const places = [...new Set(choice.sampleMaps.map(map => this.editor.ctx.catalog.placeLabel(map)).filter(Boolean))];
        const detail = places[0] ? ` · ${places[0]}` : '';
        select.add(new Option(name(choice.path) + detail, choice.id));
      }
      const preview = document.createElement('div');
      preview.className = 'mp-backdrop-preview';
      panel.replaceChildren(label, preview, message);
      let previewVersion = 0;
      const show = async () => {
        const version = ++previewVersion;
        const ident = selection() ?? fallback;
        const choice = data.choices.find(row => row.id === ident);
        select.value = selection() ?? '';
        preview.replaceChildren();
        message.textContent = choice ? name(choice.path) : `Backdrop #${ident}`;
        if (!choice?.path) return;
        try {
          const {bytes} = await source.read(choice.path);
          const {data: texture} = await unzipSingle(decrypt(bytes));
          if (version !== previewVersion || !panel.isConnected) return;
          const canvas = textureCanvas(parseBtx(texture, 0), 0.125);
          canvas.setAttribute('aria-label', 'Backdrop texture preview');
          preview.replaceChildren(canvas);
        } catch (error) {
          if (version === previewVersion) message.textContent += ` · Preview unavailable (${error.message})`;
        }
      };
      select.onchange = () => {
        const ident = select.value === '' ? null : Number(select.value);
        if (ident === saved) this.changes.delete(id);
        else this.changes.set(id, ident);
        this.editor.renderList();
        this.editor.ctx.onChange();
        void show();
      };
      void show();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  async save() {
    const data = await this.load();
    const changes = Object.fromEntries([...this.changes].filter(([id]) => Object.hasOwn(data.defaults, id)));
    const result = Object.keys(changes).length
      ? await source.mapBackdrops({scope: data.scope, revision: data.revision, changes})
      : data;
    this.request = Promise.resolve(result);
    this.changes.clear();
    this.editor.renderList();
    if (this.editor.tab === 'backdrop') this.editor.renderSide();
  }
}

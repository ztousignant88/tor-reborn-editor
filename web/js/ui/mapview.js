// Isometric map renderer: tile columns with real elevation, destructible
// objects and unit tokens. Rotate in 90° steps, zoom, pan, drag units.

import { displayHeight } from '../game/bgmap.js';
import { drawToken } from './tokens.js';
const HEIGHT_RAMP = [[0, [38, 92, 120]], [0.25, [74, 128, 82]], [0.55, [154, 142, 92]], [0.8, [176, 160, 140]], [1, [236, 232, 222]]];

function rampColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEIGHT_RAMP.length; i++) {
    const [t1, c1] = HEIGHT_RAMP[i];
    if (t <= t1) {
      const [t0, c0] = HEIGHT_RAMP[i - 1];
      const k = (t - t0) / (t1 - t0);
      return c0.map((c, j) => Math.round(c + (c1[j] - c) * k));
    }
  }
  return HEIGHT_RAMP.at(-1)[1];
}

/** Stable, distinguishable colour per surface code. */
export function surfaceColor(code) {
  const hue = (code * 137.508 + 95) % 360;
  const sat = 30 + (code % 3) * 8;
  const light = 44 + (code % 4) * 5;
  return hslToRgb(hue / 360, sat / 100, light / 100);
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const rgb = (c, k = 1) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;

export class MapView {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = handlers;
    this.grid = null;
    this.units = [];
    this.selected = null;
    this.rotation = 0;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.colorMode = 'height';
    this.showHeights = false;
    this.unitsOnTop = true;
    this.hover = null;
    this.drag = null;
    this.userAdjusted = false; // once the user zooms or pans, stop auto-fitting
    this.bindEvents();
    new ResizeObserver(() => (this.userAdjusted ? this.render() : this.fitView())).observe(canvas);
  }

  // ---- data ----------------------------------------------------------
  setGrid(grid, fallbackSize) {
    this.grid = grid || flatGrid(fallbackSize);
    this.fitView();
  }

  setStartTiles(tiles) { this.startTiles = new Map(tiles.map(t => [`${t.x},${t.y}`,t])); }

  setUnits(units, selected) {
    this.units = units;
    this.selected = selected;
    this.render();
  }

  // ---- geometry ------------------------------------------------------
  get dims() { return { w: this.grid.width, d: this.grid.depth }; }

  toView(x, y) {
    const { w, d } = this.dims;
    switch (this.rotation) {
      case 1: return [d - 1 - y, x];
      case 2: return [w - 1 - x, d - 1 - y];
      case 3: return [y, w - 1 - x];
      default: return [x, y];
    }
  }

  metrics() {
    const hw = 24 * this.zoom;
    return { hw, hh: hw / 2, hs: hw / 4 };
  }

  project(x, y, h) {
    const [vx, vy] = this.toView(x, y);
    const { hw, hh, hs } = this.metrics();
    const o = this.frameOrigin || this.origin;
    return { x: o.x + (vx - vy) * hw, y: o.y + (vx + vy) * hh - h * hs, depth: vx + vy };
  }

  fitView() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !this.grid) return;
    const { w, d } = this.dims;
    const span = w + d;
    const maxH = Math.max(4, this.grid.maxHeight || 4);
    const zx = (rect.width - 40) / (span * 24);
    const zy = (rect.height - 40) / (span * 12 + maxH * 6 + 40);
    this.zoom = Math.max(0.3, Math.min(3, Math.min(zx, zy)));
    this.pan = { x: 0, y: 0 };
    this.userAdjusted = false;
    this.render();
  }

  get origin() {
    const rect = this.canvas.getBoundingClientRect();
    const { w, d } = this.dims;
    const [vw, vd] = this.rotation % 2 ? [d, w] : [w, d];
    const { hw, hh, hs } = this.metrics();
    const maxH = this.grid.maxHeight || 0;
    const mapHeight = (vw + vd) * hh + maxH * hs;
    return {
      x: rect.width / 2 + (vd - vw) * hw / 2 + this.pan.x,
      y: (rect.height - mapHeight) / 2 + maxH * hs + this.pan.y + hh,
    };
  }

  // ---- rendering -----------------------------------------------------
  render() {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!this.grid) return;

    this.frameOrigin = this.origin;
    const { hw, hh, hs } = this.metrics();
    const maxH = Math.max(1, this.grid.maxHeight || 1);
    const tiles = this.grid.tiles.map((t) => ({ t, p: this.project(t.x, t.y, t.height) }));
    tiles.sort((a, b) => a.p.depth - b.p.depth || a.t.height - b.t.height);
    this.drawList = tiles;

    const unitsByTile = new Map(this.units.map((u) => [`${u.x},${u.y}`, u]));
    const dropTarget = this.drag?.unit && this.hover?.tile;

    for (const { t, p } of tiles) {
      const base = this.grid.synthetic ? [70, 76, 86]
        : this.colorMode === 'height' ? rampColor(t.height / maxH) : surfaceColor(t.surface);
      const drop = (t.height + 1) * hs;
      // side faces
      ctx.fillStyle = rgb(base, 0.62);
      poly(ctx, [[p.x - hw, p.y], [p.x, p.y + hh], [p.x, p.y + hh + drop], [p.x - hw, p.y + drop]]);
      ctx.fill();
      ctx.fillStyle = rgb(base, 0.46);
      poly(ctx, [[p.x, p.y + hh], [p.x + hw, p.y], [p.x + hw, p.y + drop], [p.x, p.y + hh + drop]]);
      ctx.fill();
      // top
      ctx.fillStyle = rgb(base, this.grid.synthetic ? 1 : 0.92 + 0.18 * (t.height / maxH));
      poly(ctx, diamond(p, hw, hh));
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (this.startTiles?.has(`${t.x},${t.y}`)) {
        ctx.fillStyle = 'rgba(60,220,235,0.2)';
        poly(ctx,diamond(p,hw,hh));ctx.fill();
        ctx.strokeStyle = '#65e7f0';ctx.lineWidth = 2;ctx.stroke();
      }
      if (t.object !== null && t.object !== undefined) this.drawObject(ctx, p, hw, hh, hs);
      if (this.showHeights && this.zoom >= 0.7) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `${Math.round(9 * this.zoom + 2)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(displayHeight(t)), p.x, p.y + (t.object !== null ? -2 * hs : 0));
      }
      const isHover = this.hover?.tile === t;
      if (isHover || dropTarget === t) {
        ctx.strokeStyle = dropTarget === t ? '#f3c76b' : 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        poly(ctx, diamond(p, hw, hh));
        ctx.stroke();
      }
      if (!this.unitsOnTop) {
        const u = unitsByTile.get(`${t.x},${t.y}`);
        if (u) this.drawUnit(ctx, u, p, t);
      }
    }

    if (this.unitsOnTop) {
      const placed = this.units
        .map((u) => ({ u, t: this.grid.tileAt(u.x, u.y) }))
        .map(({ u, t }) => ({ u, t, p: this.project(u.x, u.y, t ? t.height : 0) }))
        .sort((a, b) => a.p.depth - b.p.depth);
      for (const { u, p, t } of placed) this.drawUnit(ctx, u, p, t);
    }

    if (this.drag?.unit && this.drag.moved) {
      const u = this.drag.unit;
      ctx.globalAlpha = 0.7;
      this.drawToken(ctx, u, this.drag.pos.x, this.drag.pos.y, false);
      ctx.globalAlpha = 1;
    }
  }

  drawObject(ctx, p, hw, hh, hs) {
    const s = 0.5;
    const top = { x: p.x, y: p.y - 2 * hs };
    ctx.fillStyle = '#5b4632';
    poly(ctx, [[p.x - hw * s, p.y], [p.x, p.y + hh * s], [p.x, top.y + hh * s], [p.x - hw * s, top.y]]);
    ctx.fill();
    ctx.fillStyle = '#463524';
    poly(ctx, [[p.x, p.y + hh * s], [p.x + hw * s, p.y], [p.x + hw * s, top.y], [p.x, top.y + hh * s]]);
    ctx.fill();
    ctx.fillStyle = '#7c6247';
    poly(ctx, diamond(top, hw * s, hh * s));
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
  }

  drawUnit(ctx, u, p, tile) {
    const { hh } = this.metrics();
    const lift = tile && tile.object !== null ? 2 * this.metrics().hs : 0;
    const cx = p.x, cy = p.y - lift;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, hh * 0.9, hh * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    const dragging = this.drag?.unit === u && this.drag.moved;
    if (dragging) ctx.globalAlpha = 0.35;
    this.drawToken(ctx, u, cx, cy - hh * 1.1, u.slot === this.selected);
    ctx.globalAlpha = 1;
    u.screen = { x: cx, y: cy - hh * 1.1, r: Math.max(8, hh * 0.85) };
  }

  drawToken(ctx, u, x, y, selected) {
    const r = Math.max(8, this.metrics().hh * 0.85);
    drawToken(ctx, u, x, y, r, { selected, hovered: this.hover?.unit === u });
  }

  // ---- interaction ---------------------------------------------------
  pick(mx, my) {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.screen && Math.hypot(mx - u.screen.x, my - u.screen.y) <= u.screen.r + 2) return { unit: u };
    }
    return { tile: this.tileAt(mx, my) };
  }

  tileAt(mx, my) {
    if (!this.drawList) return null;
    const { hw, hh } = this.metrics();
    for (let i = this.drawList.length - 1; i >= 0; i--) {
      const { t, p } = this.drawList[i];
      if (Math.abs(mx - p.x) / hw + Math.abs(my - p.y) / hh <= 1) return t;
    }
    return null;
  }

  bindEvents() {
    const c = this.canvas;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    c.addEventListener('pointerdown', (e) => {
      if (!this.grid) return;
      const m = pos(e);
      const hit = this.pick(m.x, m.y);
      c.setPointerCapture(e.pointerId);
      if (hit.unit) {
        this.drag = { unit: hit.unit, start: m, pos: m, moved: false };
        this.handlers.onSelectUnit?.(hit.unit.slot);
      } else {
        this.drag = { pan: true, start: m, origin: { ...this.pan }, moved: false, tile: hit.tile };
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.grid) return;
      const m = pos(e);
      if (this.drag) {
        const dist = Math.hypot(m.x - this.drag.start.x, m.y - this.drag.start.y);
        if (dist > 4) this.drag.moved = true;
        if (this.drag.pan && this.drag.moved) {
          this.userAdjusted = true;
          this.pan ={ x: this.drag.origin.x + m.x - this.drag.start.x, y: this.drag.origin.y + m.y - this.drag.start.y };
        }
        this.drag.pos = m;
      }
      const hit = this.drag?.unit ? { tile: this.tileAt(m.x, m.y) } : this.pick(m.x, m.y);
      this.hover = { tile: hit.tile || null, unit: hit.unit || null };
      c.style.cursor = this.drag?.unit ? 'grabbing' : hit.unit ? 'grab' : this.drag?.pan && this.drag.moved ? 'move' : 'default';
      this.handlers.onHover?.(this.hover);
      this.render();
    });

    const end = (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.unit && d.moved) {
        const t = this.tileAt(pos(e).x, pos(e).y);
        if (t && (t.x !== d.unit.x || t.y !== d.unit.y)) this.handlers.onMoveUnit?.(d.unit.slot, t.x, t.y);
      } else if (d.pan && !d.moved) {
        this.handlers.onSelectTile?.(d.tile);
      }
      this.render();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => { this.drag = null; this.render(); });
    c.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.handlers.onHover?.(null); this.render(); } });

    c.addEventListener('wheel', (e) => {
      if (!this.grid) return;
      e.preventDefault();
      const m = pos(e);
      const before = this.zoom;
      const o1 = this.origin;
      this.userAdjusted = true;
      this.zoom = Math.max(0.3, Math.min(4, this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const k = this.zoom / before;
      // keep the point under the cursor fixed: new origin = m - (m - o1) * k
      this.pan = { x: 0, y: 0 };
      const base = this.origin;
      this.pan = { x: m.x - (m.x - o1.x) * k - base.x, y: m.y - (m.y - o1.y) * k - base.y };
      this.render();
    }, { passive: false });
  }

  rotate(step) {
    this.rotation = (this.rotation + step + 4) % 4;
    this.pan = { x: 0, y: 0 };
    this.render();
  }
}

function flatGrid({ width, depth }) {
  const tiles = [];
  for (let y = 0; y < depth; y++) for (let x = 0; x < width; x++) tiles.push({ x, y, height: 0, surface: 0, object: null });
  return {
    synthetic: true, width, depth, maxHeight: 0, tiles,
    tileAt: (x, y) => (x >= 0 && y >= 0 && x < width && y < depth ? tiles[y * width + x] : null),
  };
}

const diamond = (p, hw, hh) => [[p.x, p.y - hh], [p.x + hw, p.y], [p.x, p.y + hh], [p.x - hw, p.y]];

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}


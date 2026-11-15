// Small pictures of tile looks for the map editor's Blocks palette: the tile's
// top, painted from its map's colour atlas, drawn as a little block (a diamond
// seen from the default camera angle with two shaded sides under it).

import { atlases } from '../game/lookimport.js';
import { rgbaCanvas, textureRGBA } from './texcanvas.js';

export const THUMB_W = 56, THUMB_H = 46;
const HALF_W = 24, HALF_H = 12, TOP = 6, SIDE = 10;
const RISE = 20; // pixels per world unit up (slopes)

/** The map's colour atlas as a canvas plus its pixels (kept on the MapFile). */
function atlas(map) {
  if (!map.atlasPicture) {
    const { color } = atlases(map.scene);
    const rgba = textureRGBA(color);
    map.atlasPicture = { canvas: rgbaCanvas(color.width, color.height, rgba), rgba, width: color.width, height: color.height };
  }
  return map.atlasPicture;
}

// tile-local (x, height above the top, z) -> thumbnail pixels
const project = ([x, y, z]) => [THUMB_W / 2 + (x - z) * HALF_W, TOP + (x + z) * HALF_H - y * RISE];

/** A canvas showing `tris` (tileTops of `map`) as a block. */
export function drawBlock(map, tris) {
  const a = atlas(map);
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  const ctx = c.getContext('2d');
  // the sides: the top's average colour, shaded
  let r = 0, g = 0, b = 0;
  for (const tri of tris) {
    const u = Math.min(a.width - 1, Math.floor(((tri[0].uv[0] + tri[1].uv[0] + tri[2].uv[0]) / 3) * a.width));
    const v = Math.min(a.height - 1, Math.floor(((tri[0].uv[1] + tri[1].uv[1] + tri[2].uv[1]) / 3) * a.height));
    const p = (v * a.width + u) * 4;
    r += a.rgba[p]; g += a.rgba[p + 1]; b += a.rgba[p + 2];
  }
  const n = Math.max(1, tris.length);
  const shade = (k) => `rgb(${Math.round((r / n) * k)}, ${Math.round((g / n) * k)}, ${Math.round((b / n) * k)})`;
  const [left, front, right] = [[0, 0, 1], [1, 0, 1], [1, 0, 0]].map(project);
  const face = (p, q, k) => {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(q[0], q[1] + SIDE); ctx.lineTo(p[0], p[1] + SIDE);
    ctx.closePath();
    ctx.fillStyle = shade(k);
    ctx.fill();
  };
  face(left, front, 0.55);
  face(front, right, 0.75);
  // the top: each triangle mapped from its atlas cell
  for (const tri of tris) {
    const d = tri.map((v) => project(v.pos));
    const s = tri.map((v) => [v.uv[0] * a.width, v.uv[1] * a.height]);
    const du1 = s[1][0] - s[0][0], dv1 = s[1][1] - s[0][1], du2 = s[2][0] - s[0][0], dv2 = s[2][1] - s[0][1];
    const den = du1 * dv2 - du2 * dv1;
    if (Math.abs(den) < 1e-6) continue;
    const dx1 = d[1][0] - d[0][0], dy1 = d[1][1] - d[0][1], dx2 = d[2][0] - d[0][0], dy2 = d[2][1] - d[0][1];
    const ma = (dx1 * dv2 - dx2 * dv1) / den, mc = (dx2 * du1 - dx1 * du2) / den;
    const mb = (dy1 * dv2 - dy2 * dv1) / den, md = (dy2 * du1 - dy1 * du2) / den;
    const me = d[0][0] - ma * s[0][0] - mc * s[0][1], mf = d[0][1] - mb * s[0][0] - md * s[0][1];
    // clip a hair outside the triangle so the two halves of a top meet without a seam
    const cx = (d[0][0] + d[1][0] + d[2][0]) / 3, cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
    ctx.save();
    ctx.beginPath();
    d.forEach(([x, y], i) => {
      const len = Math.hypot(x - cx, y - cy) || 1;
      const px = x + ((x - cx) / len) * 0.7, py = y + ((y - cy) / len) * 0.7;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(ma, mb, mc, md, me, mf);
    const x0 = Math.floor(Math.min(...s.map((q) => q[0]))) - 1, y0 = Math.floor(Math.min(...s.map((q) => q[1]))) - 1;
    const x1 = Math.ceil(Math.max(...s.map((q) => q[0]))) + 1, y1 = Math.ceil(Math.max(...s.map((q) => q[1]))) + 1;
    const sx = Math.max(0, x0), sy = Math.max(0, y0);
    const sw = Math.min(a.width, x1) - sx, sh = Math.min(a.height, y1) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(a.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
    ctx.restore();
  }
  return c;
}

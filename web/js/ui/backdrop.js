// Painted backdrops of indoor maps (bgscene.js readBackdrop): where the picture
// sits relative to the map. The painted mesh's UV/world pairs encode the
// camera projection (paintlayer.js), including raised floors and walls.
// If a custom map lacks that data, fit its image silhouette: the room is seen from the
// diagonal its walls face (indoor rooms are modelled as a cut-away: only the
// back walls exist), and its silhouette is matched against the picture's lit
// (non-black) pixels over a range of camera pitches and scales, keeping the
// best overlap (intersection over union). On the rooms that frame cleanly the
// world origin lands near the picture's centre, at about 65-78 px per tile.

const CELL = 8; // picture pixels per mask cell
const PITCHES = [0.49, 0.51, 0.53, 0.55, 0.57, 0.59, 0.61, 0.63, 0.65, 0.67];
const SCALES = [64, 66, 68, 70, 72, 74, 76, 78, 80];
const SEARCH = 6; // cells either side of the centred guess

/** Recover the picture's alignment from its own native painted mesh. */
export function nativeBackdropFit(scene, picture) {
  const fit=scene.paintLayer?.camera ?? scene.paintLayer?.projection;
  if(!fit || !['yaw','pitch','scale','ox','oy'].every(k=>Number.isFinite(fit[k])) || fit.scale<=0)return null;
  return {...fit,scale:fit.scale*picture.width,ox:fit.ox*picture.width,oy:fit.oy*picture.height};
}

// Flat boats and bg206 already used this camera. Other interiors previously
// stored adjustments against a different, approximate base fit. Keep those
// settings intact, but do not apply them to the newly corrected base.
export function backdropAlignmentVersion(scene) {
  return scene.paintLayer?.camera && !scene.paintLayer.flat && !/^bg206_01_c0_t00$/i.test(scene.name) ? 3 : 2;
}

export function paintedTerrainUnderlay(scene) {
  // bg009_03's painting contains only hanging details; its room is textured
  // terrain. The ships instead use animated water below their painted hulls.
  return /^bg009_03_/i.test(scene.name) || !!(scene.paintLayer?.flat && scene.mapAnimations?.some(a=>a.event===0));
}

/** Frame connected multi-page art as well as terrain, without changing placement. */
export function frameBackdropArtwork(bounds, points, fit, aspect) {
  const {right,up}=axes(fit.yaw,fit.pitch),eye=[Math.cos(fit.pitch)*Math.sin(fit.yaw),Math.sin(fit.pitch),Math.cos(fit.pitch)*Math.cos(fit.yaw)];
  const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),all=[...points];
  for(const x of [bounds.min[0],bounds.max[0]])for(const y of [bounds.min[1],bounds.max[1]])for(const z of [bounds.min[2],bounds.max[2]])all.push([x,y,z]);
  const xs=all.map(p=>dot(p,right)),ys=all.map(p=>dot(p,up));
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),depth=dot(bounds.min.map((v,k)=>(v+bounds.max[k])/2),eye);
  return {target:right.map((v,k)=>v*(x0+x1)/2+up[k]*(y0+y1)/2+eye[k]*depth),radius:1.25*1.06*Math.max((y1-y0)/2,(x1-x0)/(2*Math.max(0.01,aspect)))};
}

const axes = (yaw, pitch) => ({
  right: [Math.cos(yaw), 0, -Math.sin(yaw)],
  up: [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)],
});

/** Lit-pixel mask of a picture texture (already on the GPU): Uint8Array n*n, rows top-down. */
export function litMask(gl, texture, size) {
  const n = size / CELL;
  const fbTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fbTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n * 2, n * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
  const prog = program(gl);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(gl.getUniformLocation(prog, 's'), 0);
  gl.viewport(0, 0, n * 2, n * 2);
  gl.disable(gl.DEPTH_TEST);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const px = new Uint8Array(n * 2 * n * 2 * 4);
  gl.readPixels(0, 0, n * 2, n * 2, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);
  gl.deleteTexture(fbTex);
  gl.deleteFramebuffer(fb);
  gl.deleteBuffer(buf);
  gl.deleteVertexArray(vao);
  gl.deleteProgram(prog);
  // 2x2 samples per cell; the shader drew the picture upright, readPixels rows go bottom-up
  const mask = new Uint8Array(n * n);
  for (let y = 0; y < n * 2; y++) {
    for (let x = 0; x < n * 2; x++) {
      const p = (y * n * 2 + x) * 4;
      if (px[p + 3] > 128 && Math.max(px[p], px[p + 1], px[p + 2]) > 16) mask[(n - 1 - (y >> 1)) * n + (x >> 1)] = 1;
    }
  }
  return mask;
}

function program(gl) {
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, `#version 300 es
layout(location=0) in vec2 p; out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0, 1); }`));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, `#version 300 es
precision mediump float; in vec2 uv; uniform sampler2D s; out vec4 o;
void main() { o = texture(s, uv); }`));
  gl.linkProgram(p);
  return p;
}

/** The diagonal (yaw) whose camera the room's walls face. */
function facingYaw(f, count, stride) {
  const w = stride / 4;
  let best = Math.PI / 4, bestSum = -Infinity;
  for (let k = 0; k < 4; k++) {
    const yaw = Math.PI / 4 + k * Math.PI / 2;
    const ex = Math.sin(yaw), ez = Math.cos(yaw);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const o = i * w;
      if (Math.abs(f[o + 4]) > 0.5) continue; // floors and tops
      sum += f[o + 3] * ex + f[o + 5] * ez;
    }
    if (sum > bestSum) { bestSum = sum; best = yaw; }
  }
  return best;
}

/** Filled cells of the mesh's silhouette seen from (yaw, pitch): { cells: [x, y...], W, H, a0, b1 }. */
function silhouette(f, count, stride, yaw, pitch, perCell) {
  const { right, up } = axes(yaw, pitch);
  const w = stride / 4;
  const sx = new Float32Array(count), sy = new Float32Array(count);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * w;
    sx[i] = f[o] * right[0] + f[o + 1] * right[1] + f[o + 2] * right[2];
    sy[i] = f[o] * up[0] + f[o + 1] * up[1] + f[o + 2] * up[2];
    a0 = Math.min(a0, sx[i]); a1 = Math.max(a1, sx[i]); b0 = Math.min(b0, sy[i]); b1 = Math.max(b1, sy[i]);
  }
  const W = Math.ceil((a1 - a0) * perCell) + 1, H = Math.ceil((b1 - b0) * perCell) + 1;
  const grid = new Uint8Array(W * H);
  for (let t = 0; t + 2 < count; t += 3) {
    const xs = [0, 1, 2].map((j) => (sx[t + j] - a0) * perCell), ys = [0, 1, 2].map((j) => (b1 - sy[t + j]) * perCell);
    const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(area) < 1e-6) continue;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.ceil(Math.max(...ys)) && y < H; y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.ceil(Math.max(...xs)) && x < W; x++) {
        const px = x + 0.5, py = y + 0.5;
        let inside = true;
        for (let e = 0; e < 3 && inside; e++) {
          const i = e, j = (e + 1) % 3;
          inside = ((xs[j] - xs[i]) * (py - ys[i]) - (ys[j] - ys[i]) * (px - xs[i])) * area >= 0;
        }
        if (inside) grid[y * W + x] = 1;
      }
    }
  }
  const cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid[y * W + x]) cells.push(x, y);
  return { cells, W, H, a0, b1 };
}

/**
 * Where the picture sits: { yaw, pitch, scale (picture px per world unit), ox, oy
 * (picture px of the world origin), score (intersection over union, 0-1) }.
 */
export function fitBackdrop(mesh, stride, mask, size) {
  const n = size / CELL;
  const f = new Float32Array(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength / 4);
  let lit = 0, x0 = n, x1 = -1, y0 = n, y1 = -1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!mask[y * n + x]) continue;
      lit++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const yaw = facingYaw(f, mesh.count, stride);
  let best = null;
  for (const pitch of PITCHES) {
    for (const scale of SCALES) {
      const { cells, W, H, a0, b1 } = silhouette(f, mesh.count, stride, yaw, pitch, scale / CELL);
      const total = cells.length / 2;
      const cx = Math.round((x0 + x1 - W) / 2), cy = Math.round((y0 + y1 - H) / 2);
      for (let dy = -SEARCH; dy <= SEARCH; dy++) {
        for (let dx = -SEARCH; dx <= SEARCH; dx++) {
          const bx = cx + dx, by = cy + dy;
          let hit = 0;
          for (let c = 0; c < cells.length; c += 2) {
            const x = bx + cells[c], y = by + cells[c + 1];
            if (x >= 0 && y >= 0 && x < n && y < n && mask[y * n + x]) hit++;
          }
          const score = hit / (total + lit - hit);
          if (!best || score > best.score) best = { yaw, pitch, scale, ox: bx * CELL - a0 * scale, oy: by * CELL + b1 * scale, score };
        }
      }
    }
  }
  return best;
}

/** World-space corners of the picture as a plane facing the camera, far behind the map. */
export function backdropQuad(fit, size, eyeDir) {
  const { right, up } = axes(fit.yaw, fit.pitch);
  const back = 150;
  const at = (px, py) => {
    const sx = (px - fit.ox) / fit.scale, sy = (fit.oy - py) / fit.scale;
    return [0, 1, 2].map((i) => sx * right[i] + sy * up[i] - eyeDir[i] * back);
  };
  return { tl: at(0, 0), tr: at(size, 0), bl: at(0, size), br: at(size, size) };
}

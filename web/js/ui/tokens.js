// Unit tokens shared by the 2D grid view and the 3D map view.

export const TEAM_COLORS = { 1: '#4d8fe0', 2: '#d9544f', 3: '#4fae6a' };

/** Draw a unit token centred at (x, y). `r` is the token radius in CSS pixels. */
export function drawToken(ctx, u, x, y, r, { selected = false, hovered = false } = {}) {
  if (selected) {
    ctx.fillStyle = 'rgba(243,199,107,0.35)';
    ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = TEAM_COLORS[u.team] || '#9a9a9a';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.strokeStyle = selected ? '#f3c76b' : 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.round(r * 0.9)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(u.initials, x, y + 0.5);
  if (u.leader) {
    ctx.fillStyle = '#f3c76b';
    star(ctx, x + r * 0.8, y - r * 0.8, r * 0.45);
  }
  if (selected || hovered) {
    ctx.font = `500 ${Math.max(11, Math.round(r * 0.85))}px system-ui, sans-serif`;
    const w = ctx.measureText(u.label).width + 10;
    ctx.fillStyle = 'rgba(15,18,24,0.85)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - r - 22, w, 17, 4);
    ctx.fill();
    ctx.fillStyle = '#f2efe8';
    ctx.fillText(u.label, x, y - r - 13);
  }
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

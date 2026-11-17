// Track geometry report: length, minimum turn radius, closest approach between far-apart parts, ASCII plot.
import { TRACKS } from '../js/tracks.js';
const only = process.argv[2];
for (const t of TRACKS) {
  if (only && t.id !== only) continue;
  const S = t.samples, n = S.length;
  let len = 0; const cum = [0];
  for (let i = 1; i <= n; i++) { const a = S[i - 1], b = S[i % n]; len += Math.hypot(b.x - a.x, b.z - a.z); cum.push(len); }
  let minR = 1e9, minRAt = 0;
  for (let i = 0; i < n; i++) {
    const a = S[(i - 3 + n) % n], b = S[i], c = S[(i + 3) % n];
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    const R = area2 < 1e-9 ? 1e9 : (ab * bc * ca) / (2 * area2);
    if (R < minR) { minR = R; minRAt = i / n; }
  }
  let minSep = 1e9, at = [0, 0];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const arc = Math.min(cum[j] - cum[i], len - (cum[j] - cum[i]));
    if (arc < 70) continue;
    const d = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z);
    if (d < minSep) { minSep = d; at = [i / n, j / n]; }
  }
  const bins = 50; let prof = '';
  for (let b = 0; b < bins; b++) {
    let m = 1e9;
    for (let i = Math.floor(b * n / bins); i < Math.floor((b + 1) * n / bins); i++) {
      const a = S[(i - 3 + n) % n], bb = S[i], c = S[(i + 3) % n];
      const ab = Math.hypot(bb.x - a.x, bb.z - a.z), bc = Math.hypot(c.x - bb.x, c.z - bb.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
      const area2 = Math.abs((bb.x - a.x) * (c.z - a.z) - (bb.z - a.z) * (c.x - a.x));
      m = Math.min(m, area2 < 1e-9 ? 1e9 : (ab * bc * ca) / (2 * area2));
    }
    prof += m > 150 ? '-' : m > 60 ? 'c' : m > 25 ? 'C' : 'H';
  }
  console.log(`${t.id}: profile(2% bins, - straight c bend C tight H hairpin) ${prof}`);
  console.log(`${t.id}: length ${Math.round(len)} m, road ${t.roadWidth}, min radius ${minR.toFixed(1)} at s=${minRAt.toFixed(2)}, closest far-apart approach ${minSep.toFixed(1)} (s=${at.map((x) => x.toFixed(2))}), lap@29u/s ${(len / 29).toFixed(0)}s`);
  const xs = S.map((p) => p.x), zs = S.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const W = 90, H = Math.round(W * (z1 - z0) / (x1 - x0) * 0.5) + 1;
  const grid = Array.from({ length: H + 1 }, () => Array(W + 1).fill(' '));
  S.forEach((p, i) => { grid[Math.round((p.z - z0) / (z1 - z0) * H)][Math.round((p.x - x0) / (x1 - x0) * W)] = i === 0 ? 'S' : '#'; });
  if (process.argv[3] === 'plot') console.log(grid.map((r) => r.join('')).join('\n'));
}

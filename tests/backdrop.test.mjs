import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../js/tracks.js';

// Same geometry rules as Renderer._backdropRing / _buildSceneryProps (kept in sync by hand: the renderer needs WebGL).
function ring(track) {
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const s of track.samples) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
  const cx = (x0 + x1) / 2; const cz = (z0 + z1) / 2;
  let maxR = 0;
  for (const s of track.samples) maxR = Math.max(maxR, Math.hypot(s.x - cx, s.z - cz));
  return { cx, cz, ringBase: maxR + track.roadWidth / 2 + 145 };
}

test('No backdrop hill or mountain touches the road or the trackside on any circuit', () => {
  for (const track of TRACKS) {
    const { cx, cz, ringBase } = ring(track);
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2;
      const dist = ringBase + (i % 3) * 25;
      const items = [{ x: cx + Math.cos(ang) * dist, z: cz + Math.sin(ang) * dist, r: (26 + (i % 4) * 8) * 1.3, what: `hill ${i}` }];
      if (i % 2 === 0) {
        const mh = 55 + (i % 3) * 18;
        items.push({ x: cx + Math.cos(ang) * (dist + 70), z: cz + Math.sin(ang) * (dist + 70), r: mh * 0.65, what: `mountain ${i}` });
      }
      for (const it of items) {
        const nearest = Math.min(...track.samples.map((s) => Math.hypot(s.x - it.x, s.z - it.z)));
        const gap = nearest - it.r - track.roadWidth / 2;
        assert.ok(gap > 60, `${track.id}: ${it.what} is only ${gap.toFixed(0)} m from the road edge`);
      }
    }
  }
});

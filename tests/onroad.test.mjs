import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DRIVERS, DIFFICULTIES, RaceSimulation } from '../js/sim.js';
import { measure } from '../tools/onroad.mjs';
import { IDLE } from './harness.mjs';

test('The competent bot stays on the road: >= 97 % of racing frames inside half the road and never more than 1.5 m beyond it (every track x driver)', () => {
  for (const t of TRACKS) for (const d of DRIVERS) {
    const r = measure(t.id, d.id, 'bot');
    assert.ok(r.finished, `${t.id}/${d.id} must finish`);
    assert.ok(r.share >= 0.97, `${t.id}/${d.id}: on road ${(100 * r.share).toFixed(1)} %`);
    assert.ok(r.maxEx <= 1.5, `${t.id}/${d.id}: ${r.maxEx.toFixed(2)} m beyond the road edge`);
  }
});

test('The AI stays on the road at every difficulty: >= 97 % of frames, never more than 1.5 m beyond the edge (every track x driver x difficulty)', () => {
  for (const t of TRACKS) for (const d of DRIVERS) for (const diff of Object.keys(DIFFICULTIES)) {
    const r = measure(t.id, d.id, 'ai', diff, 7, 1);
    assert.ok(r.finished, `${t.id}/${d.id}/${diff} must finish`);
    assert.ok(r.share >= 0.97, `${t.id}/${d.id}/${diff}: on road ${(100 * r.share).toFixed(1)} %`);
    assert.ok(r.maxEx <= 1.5, `${t.id}/${d.id}/${diff}: ${r.maxEx.toFixed(2)} m beyond`);
  }
});

test('Full wheel lock on a straight visibly turns every driver (turn radius below 40 m at cruising speed), and off-road clearly slows a kart', () => {
  for (const d of DRIVERS) {
    const sim = new RaceSimulation({ trackId: 'temple', players: [{ id: 'p', driverId: d.id }], fillAI: false });
    sim.countdown = 0; sim.status = 'racing';
    const k = sim.karts[0]; k.speed = 20;
    let yaw = 0; let path = 0; let prev = k.heading; let px = k.x; let pz = k.z;
    for (let i = 0; i < 30; i++) {
      sim.step(1 / 60, { p: { ...IDLE, steer: 1 } });
      let dh = k.heading - prev; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      yaw += dh; prev = k.heading; path += Math.hypot(k.x - px, k.z - pz); px = k.x; pz = k.z;
    }
    assert.ok(yaw < 0, `${d.id}: positive steer turns right (heading decreases)`);
    assert.ok(path / Math.abs(yaw) < 40, `${d.id}: radius ${(path / Math.abs(yaw)).toFixed(1)} m`);
  }
  // beyond the kerb the top speed is clearly lower
  const sim = new RaceSimulation({ trackId: 'island', players: [{ id: 'p', driverId: 'rufus' }], fillAI: false });
  sim.countdown = 0; sim.status = 'racing';
  const k = sim.karts[0]; const n = sim.track.getPointAt(0.3);
  k.x = n.x + n.rx * (sim.track.roadWidth / 2 + 2.5); k.z = n.z + n.rz * (sim.track.roadWidth / 2 + 2.5); k.heading = Math.atan2(n.tx, n.tz); k.speed = 29;
  let minSpeed = 99;
  for (let i = 0; i < 90; i++) { sim.step(1 / 60, { p: IDLE }); if (sim._findNearestSample(k.x, k.z).dist > sim.track.roadWidth / 2 + 1.2) minSpeed = Math.min(minSpeed, k.speed); }
  assert.ok(minSpeed < 20, `off-road speed ${minSpeed.toFixed(1)}`);
});

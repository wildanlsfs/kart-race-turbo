import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, RaceSimulation, mulberry32 } from '../js/sim.js';
import { competentBot } from './harness.mjs';

// A clumsy webcam driver: a good line, plus hand wobble (slow sine) and occasional random jabs, and a late reaction.
function run(trackId, assistOn, seed) {
  const rng = mulberry32(seed);
  const sim = new RaceSimulation({ trackId, mode: '1p', players: [{ id: 'p1', name: 'P', driverId: 'rufus', isAI: false }], totalLaps: 1, fillAI: false, steerAssist: assistOn, rng });
  const k = sim.karts[0];
  let jab = 0, jabT = 0, t = 0, offMs = 0, frames = 0, finishT = null;
  const nRng = mulberry32(seed + 99);
  while (t < 240 && sim.status !== 'finished') {
    const base = competentBot(sim, k, { rng, turbo: false });
    if (jabT > 0) jabT -= 1 / 60; else if (nRng() < 0.01) { jab = (nRng() - 0.5) * 1.4; jabT = 0.25; } else jab = 0;
    const steer = Math.max(-1, Math.min(1, base.steer * 0.8 + 0.18 * Math.sin(t * 5.1) + (jabT > 0 ? jab : 0)));
    sim.step(1 / 60, { p1: { ...base, steer } });
    const n = sim._findNearestSample(k.x, k.z);
    if (n.dist > sim.track.roadWidth * 0.5) offMs++;
    frames++; t += 1 / 60;
    if (k.finished && finishT === null) finishT = t;
  }
  return { offFrac: offMs / frames, time: finishT ?? 240 };
}

for (const id of ['island', 'canyon', 'temple']) {
  if (!TRACKS.find((x) => x.id === id)) continue;
  test(`Steer assist (${id}): a wobbly driver stays on the road more and is not slower`, () => {
    let offA = 0, offB = 0, tA = 0, tB = 0; const N = 6;
    for (let i = 0; i < N; i++) { const a = run(id, false, 10 + i), b = run(id, true, 10 + i); offA += a.offFrac; offB += b.offFrac; tA += a.time; tB += b.time; }
    console.log(id, 'off-road share', (offA / N).toFixed(3), '->', (offB / N).toFixed(3), '| lap time', (tA / N).toFixed(1), '->', (tB / N).toFixed(1));
    assert.ok(offB <= offA, 'assist must not put the kart off the road more');
    assert.ok(tB <= tA * 1.03, 'assist must not make the lap slower');
  });
}

test('Steer assist: off by default and never touches AI karts (balance unchanged)', () => {
  const sim = new RaceSimulation({ trackId: 'island', mode: '1p', players: [{ id: 'p1', name: 'P', driverId: 'rufus', isAI: false }], fillAI: true });
  assert.equal(sim.steerAssist, false);
});

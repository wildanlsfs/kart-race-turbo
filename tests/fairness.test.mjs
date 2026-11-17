import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DRIVERS, RaceSimulation, DIFFICULTIES, DEFAULT_DIFFICULTY, normalizeDifficulty, mulberry32 } from '../js/sim.js';
import { IDLE, humanVsAI, runRace, competentBot } from './harness.mjs';

test('A kart with zero steering input is not driven round the track: it runs wide, loses speed and finishes last (every track x driver x 2 seeds)', () => {
  for (const t of TRACKS) {
    for (const d of DRIVERS) {
      for (const seed of [1, 2]) {
        const r = humanVsAI({ trackId: t.id, driverId: d.id, seed, mode: 'idle', humanSlot: seed === 1 ? 3 : 0 });
        assert.equal(r.rank, 4, `${t.id}/${d.id}/seed ${seed}: idle human ranked ${r.rank}`);
      }
    }
  }
});

test('Idle kart: heading never changes by itself on a straight, and a bend takes it to the wall where it scrubs speed', () => {
  const sim = new RaceSimulation({ trackId: 'canyon', players: [{ id: 'p', driverId: 'rufus' }], fillAI: false, rng: mulberry32(3) });
  sim.countdown = 0; sim.status = 'racing';
  const k = sim.karts[0];
  const h0 = k.heading;
  for (let i = 0; i < 30; i++) sim.step(1 / 60, { p: IDLE });
  assert.ok(Math.abs(k.heading - h0) < 0.02, 'no steering assist on the straight');
  let sawWall = false; let maxSpeed = 0; let speedAfterWall = 0;
  for (let i = 0; i < 60 * 30; i++) {
    sim.step(1 / 60, { p: IDLE });
    if (sim.events.some((e) => e.type === 'wall')) sawWall = true;
    if (!sawWall) maxSpeed = Math.max(maxSpeed, k.speed); else speedAfterWall = Math.max(speedAfterWall, k.speed);
  }
  assert.ok(sawWall, 'idle kart must reach the wall within 30 s');
  assert.ok(k.totalProgress < 0.6, `idle kart should have made little progress, got ${k.totalProgress.toFixed(2)} laps`);
});

test('A competent bot (look-ahead steering) is NOT punished: it finishes within the top half on every track vs Normal AI', () => {
  for (const t of TRACKS) {
    let sum = 0; let n = 0;
    for (const d of DRIVERS) for (const seed of [1, 2]) {
      const r = humanVsAI({ trackId: t.id, driverId: d.id, seed, mode: 'bot' });
      assert.ok(r.finished, `${t.id}/${d.id}: bot must finish`);
      sum += r.rank; n++;
    }
    assert.ok(sum / n <= 2.5, `${t.id}: competent bot mean rank ${(sum / n).toFixed(2)}`);
  }
});

test('AI pace has no human-relative rubber banding: it ignores where the human is, never slows for being ahead', () => {
  const mk = (humanProgress) => {
    const sim = new RaceSimulation({ trackId: 'island', players: [{ id: 'p', driverId: 'rufus' }], rng: mulberry32(1) });
    sim.countdown = 0; sim.status = 'racing';
    const human = sim.karts.find((k) => !k.isAI);
    human.totalProgress = humanProgress;
    const ai = sim.karts.filter((k) => k.isAI);
    ai.forEach((k, i) => { k.totalProgress = 1.0 + i * 0.01; }); // AI all around the same, humans far ahead or far behind
    return ai.map((k) => { sim._updateAIPace(k); return k.aiPace; });
  };
  const behind = mk(0);
  const ahead = mk(2.5);
  const diff = DIFFICULTIES[DEFAULT_DIFFICULTY];
  for (let i = 0; i < behind.length; i++) {
    assert.ok(Math.abs(behind[i] - ahead[i]) < 1e-9 || ahead[i] >= behind[i] - 1e-9, 'a human far ahead must not make an AI go slower or faster');
    assert.ok(behind[i] <= diff.topScale * 1.01 + 0.03 + 1e-9);
  }
  // leading AI is not slowed: pace equals difficulty scale x personality
  const sim = new RaceSimulation({ trackId: 'island', players: [], rng: mulberry32(1) });
  sim.karts.forEach((k, i) => { k.totalProgress = i === 0 ? 3 : 0.5; });
  sim._updateAIPace(sim.karts[0]);
  assert.ok(Math.abs(sim.karts[0].aiPace - diff.topScale * sim.karts[0].aiSkill) < 1e-9);
  // far-behind AI gets a small catch-up, capped at 3 %
  sim._updateAIPace(sim.karts[1]);
  assert.ok(sim.karts[1].aiPace > diff.topScale * sim.karts[1].aiSkill && sim.karts[1].aiPace <= diff.topScale * sim.karts[1].aiSkill + 0.0301);
});

test('AI skill no longer depends on the roster index, only on difficulty and a fixed per-driver personality', () => {
  const skills = (order) => {
    const sim = new RaceSimulation({ trackId: 'island', players: order.map((d, i) => ({ id: `a${i}`, driverId: d, isAI: true })), fillAI: false });
    return Object.fromEntries(sim.karts.map((k) => [k.driverId, k.aiSkill]));
  };
  const a = skills(['rufus', 'jet', 'maka', 'volt']);
  const b = skills(['volt', 'maka', 'jet', 'rufus']);
  assert.deepEqual(a, b);
  for (const d of DRIVERS) assert.ok(Math.abs(a[d.id] - 1) <= 0.02, 'personality is a small fixed offset');
});

test('Difficulty: Santai < Normal < Pro for the AI pack (AI-only race time), default Normal, unknown values fall back', () => {
  assert.equal(normalizeDifficulty('pro'), 'pro');
  assert.equal(normalizeDifficulty('nonsense'), 'normal');
  assert.equal(normalizeDifficulty(undefined), 'normal');
  assert.equal(new RaceSimulation({ trackId: 'island', players: [] }).difficulty, 'normal');
  const avgTime = (difficulty) => {
    let sum = 0; let n = 0;
    for (const t of TRACKS) {
      const r = runRace({ trackId: t.id, drivers: DRIVERS.map((d) => d.id), humans: [], seed: 5, difficulty, laps: 2 });
      for (const k of r.sim.karts) { assert.ok(k.finished, `${t.id}/${difficulty}: ${k.id} must finish`); sum += k.finishTimeSec; n++; }
    }
    return sum / n;
  };
  const s = avgTime('santai'); const nrm = avgTime('normal'); const p = avgTime('pro');
  assert.ok(s > nrm * 1.03 && nrm > p * 1.02, `AI times santai ${s.toFixed(1)} normal ${nrm.toFixed(1)} pro ${p.toFixed(1)}`);
});

test('Same seed gives the same race (injectable rng), different seeds differ', () => {
  const run = (seed) => runRace({ trackId: 'canyon', drivers: ['rufus', 'jet', 'maka', 'volt'], humans: [], seed, laps: 1 }).sim.karts.map((k) => k.finishTimeSec).join(',');
  assert.equal(run(4), run(4));
  assert.notEqual(run(4), run(5));
});

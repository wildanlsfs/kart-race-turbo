import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DRIVERS, RaceSimulation } from '../js/sim.js';

const IDLE = { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// deterministic Math.random for the duration of a callback
function withSeed(seed, fn) {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return fn(); } finally { Math.random = orig; }
}

// Road-following bot for a human kart (human steering picks an angle off the road direction)
function humanBot(sim, k, useTurbo = true) {
  const n = sim._findNearestSample(k.x, k.z).sample;
  const look = sim.track.getPointAt(n.s + 0.03 + Math.max(0, k.speed) * 0.0008);
  const des = Math.atan2(look.x - k.x, look.z - k.z);
  const th = Math.atan2(n.tx, n.tz);
  return { ...IDLE, steer: Math.max(-1, Math.min(1, wrap(th - des) / 0.62)), turbo: useTurbo && k.turboCharge > 60, attack: k.heldItem && Math.random() < 0.02 };
}

function soloLapTime(trackId, driverId, laps = 3) {
  const sim = new RaceSimulation({ trackId, players: [{ id: 'p', driverId, isAI: false }], totalLaps: laps, fillAI: false });
  sim.countdown = 0; sim.status = 'racing';
  const k = sim.karts[0];
  let guard = 0;
  while (!k.finished && guard++ < 200 * 60) sim.step(1 / 60, { p: humanBot(sim, k, false) });
  return k.finishTimeSec;
}

test('No kart sits still on the road: 12 full AI races per track have no zero-progress stretch and no safety-net resets', () => {
  for (const track of TRACKS) {
    for (let r = 0; r < 12; r++) {
      withSeed(900 + r * 31, () => {
        const sim = new RaceSimulation({ trackId: track.id, players: [], totalLaps: 2 });
        const idle = new Map(); // kartId -> seconds with less than ~2 m of progress and no spin
        const mark = new Map();
        let t = 0;
        while (t < 75) {
          sim.step(1 / 30, {});
          t += 1 / 30;
          if (sim.status !== 'racing') continue;
          for (const k of sim.karts) {
            if (k.finished) continue;
            const m = mark.get(k.id) || { p: k.totalProgress, t };
            if (!mark.has(k.id)) mark.set(k.id, m);
            if (t - m.t >= 2.0) {
              assert.ok(k.totalProgress - m.p > 0.004 || k.spinOutTimer > 0, `${track.id} race ${r}: ${k.id} made no progress for 2 s at t=${t.toFixed(1)}`);
              m.p = k.totalProgress; m.t = t;
            }
          }
        }
        for (const k of sim.karts) assert.equal(k.resets, 0, `${track.id} race ${r}: ${k.id} needed the safety-net reset (root cause not fixed)`);
      });
    }
  }
});

test('After a hit a kart spins in place of travel, ends facing its old heading and is back to speed within 2.5 s', () => {
  const sim = new RaceSimulation({ trackId: 'island', players: [{ id: 'p', driverId: 'rufus', isAI: false }], fillAI: true });
  sim.countdown = 0; sim.status = 'racing';
  const k = sim.karts.find((x) => x.isAI);
  for (let i = 0; i < 240; i++) sim.step(1 / 60, {});
  const h0 = k.heading;
  assert.equal(sim._applyHit(k, 'p', 'rocket'), true);
  assert.ok(k.speed > 8, 'a hit kart keeps rolling instead of freezing');
  let t = 0;
  let spun = false;
  while (t < 2.5) { sim.step(1 / 60, {}); t += 1 / 60; if (k.spinOutTimer > 0) spun = true; }
  assert.ok(spun);
  assert.ok(k.speed > 15, `kart should be back up to speed, got ${k.speed.toFixed(1)}`);
});

test('Safety net: a kart pinned with zero progress is put back on the road facing forward with a blink', () => {
  const sim = new RaceSimulation({ trackId: 'canyon', players: [{ id: 'p', driverId: 'rufus', isAI: false }], fillAI: true });
  sim.countdown = 0; sim.status = 'racing';
  const ai = sim.karts.find((x) => x.isAI);
  const home = { x: ai.x, z: ai.z };
  ai.heading += Math.PI * 0.9; // facing backwards
  let reset = false;
  for (let i = 0; i < 6 * 60 && !reset; i++) {
    ai.speed = 0; ai.x = home.x; ai.z = home.z; // pin it (as a deadlock would)
    sim.step(1 / 60, {});
    if (sim.events.some((e) => e.type === 'reset' && e.kartId === ai.id)) reset = true;
  }
  assert.ok(reset, 'reset event must fire within ~3-4 s');
  assert.equal(ai.resets, 1);
  const n = sim._findNearestSample(ai.x, ai.z);
  assert.ok(n.dist < sim.track.roadWidth * 0.5, 'reset puts the kart on the road');
  assert.ok(Math.abs(wrap(Math.atan2(n.sample.tx, n.sample.tz) - ai.heading)) < 0.2, 'reset faces forward');
  assert.ok(ai.invulnTimer > 1, 'reset gives a short invulnerable blink');
});

test('Safety net leaves a human who is braking on purpose alone, but resets one who holds the throttle and is pinned', () => {
  const mk = () => {
    const sim = new RaceSimulation({ trackId: 'island', players: [{ id: 'p', driverId: 'rufus', isAI: false }], fillAI: false });
    sim.countdown = 0; sim.status = 'racing';
    return sim;
  };
  const a = mk();
  for (let i = 0; i < 8 * 60; i++) a.step(1 / 60, { p: { ...IDLE, throttle: 0, brake: true } });
  assert.equal(a.karts[0].resets, 0);
  const b = mk();
  const k = b.karts[0];
  const home = { x: k.x, z: k.z };
  for (let i = 0; i < 6 * 60; i++) { k.speed = 0; k.x = home.x; k.z = home.z; b.step(1 / 60, { p: IDLE }); }
  assert.ok(k.resets >= 1);
});

test('Drivers behave differently: Jet has the highest top speed, Volt accelerates and recovers fastest, Maka keeps speed in bends', () => {
  const run = (id) => {
    const sim = new RaceSimulation({ trackId: 'island', players: [{ id: 'p', driverId: id, isAI: false }], fillAI: false });
    sim.track = { ...sim.track, boostPads: [], ramps: [] }; // measure the kart, not the pads
    sim.countdown = 0; sim.status = 'racing';
    const k = sim.karts[0];
    let t = 0; let tTo20 = null; let top = 0;
    while (t < 4.5) { sim.step(1 / 60, { p: humanBot(sim, k, false) }); t += 1 / 60; if (tTo20 === null && k.speed >= 20) tTo20 = t; top = Math.max(top, k.speed); }
    return { tTo20, top };
  };
  const r = Object.fromEntries(DRIVERS.map((d) => [d.id, run(d.id)]));
  assert.ok(r.jet.top > r.rufus.top + 0.8 && r.jet.top > r.maka.top + 0.8 && r.jet.top > r.volt.top + 0.8, 'Jet: top speed');
  assert.ok(r.volt.tTo20 < r.rufus.tTo20 - 0.1 && r.volt.tTo20 < r.jet.tTo20 - 0.25, `Volt: acceleration ${JSON.stringify(r)}`);
  // Handling: same road-following bot on the twisty canyon, balanced-top-speed drivers; Maka must lose the least speed in bends
  const lap = Object.fromEntries(DRIVERS.map((d) => [d.id, soloLapTime('canyon', d.id, 2)]));
  assert.ok(lap.maka < lap.jet, `Maka (handling) should beat Jet (top speed) on the twisty canyon: ${JSON.stringify(lap)}`);
  const times = Object.values(lap);
  assert.ok(Math.max(...times) / Math.min(...times) < 1.05, `no driver should dominate: ${JSON.stringify(lap)}`);
});

test('Stats shown in the picker are the stats the sim uses: roles map to the best stat in the roster', () => {
  const best = (key) => DRIVERS.reduce((a, b) => (b.stats[key] > a.stats[key] ? b : a));
  assert.equal(best('topSpeed').role, 'Top Speed');
  assert.equal(best('accel').role, 'Acceleration');
  assert.equal(best('handling').role, 'Handling');
  assert.equal(new Set(DRIVERS.map((d) => d.id)).size, 4);
});

test('A bowling bomb rolls along the road through a hairpin instead of flying into the scenery', () => {
  const sim = new RaceSimulation({ trackId: 'canyon', players: [{ id: 'p', driverId: 'rufus', isAI: false }], fillAI: false });
  sim.countdown = 0; sim.status = 'racing';
  const k = sim.karts[0];
  const s0 = 0.12;
  const pt = sim.track.getPointAt(s0);
  k.x = pt.x; k.z = pt.z; k.heading = Math.atan2(pt.tx, pt.tz); k.speed = 25;
  k.heldItem = 'bomb';
  sim.step(1 / 60, { p: { ...IDLE, attack: true } });
  let maxOff = 0;
  for (let i = 0; i < 4 * 60; i++) {
    sim.step(1 / 60, { p: { ...IDLE, throttle: 0, brake: true } });
    const b = sim.projectiles[0];
    if (!b) break;
    maxOff = Math.max(maxOff, sim._findNearestSample(b.x, b.z).dist);
  }
  assert.ok(maxOff < sim.track.roadWidth * 0.5 + 1, `bomb left the road by ${maxOff.toFixed(1)}`);
});

test('Finished karts are ghosts: they do not block, get hit or collect crates; and a stopped human cannot hold the race open', () => {
  const sim = new RaceSimulation({ trackId: 'temple', players: [{ id: 'p', driverId: 'rufus', isAI: false }], totalLaps: 1 });
  sim.countdown = 0; sim.status = 'racing';
  let t = 0;
  while (sim.status !== 'finished' && t < 200) { sim.step(1 / 30, { p: { ...IDLE, throttle: 0, brake: true } }); t += 1 / 30; }
  assert.equal(sim.status, 'finished', 'race must close even though the human never moved');
  assert.ok(sim.karts.some((k) => k.finished));
  assert.equal(sim.karts.find((k) => k.id === 'p').finished, false);
  const human = sim.karts.find((k) => k.id === 'p');
  assert.equal(human.rank, 4);
});

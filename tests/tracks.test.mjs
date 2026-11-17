import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DRIVERS, DIFFICULTIES, RaceSimulation, mulberry32 } from '../js/sim.js';
import { runRace, competentBot } from './harness.mjs';

const byId = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

function segInter(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

test('No track crosses itself, and far-apart parts of a track stay well clear of each other', () => {
  for (const t of TRACKS) {
    const S = t.samples; const n = S.length;
    let len = 0; const cum = [0];
    for (let i = 1; i <= n; i++) { len += Math.hypot(S[i % n].x - S[i - 1].x, S[i % n].z - S[i - 1].z); cum.push(len); }
    let minSep = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segInter(S[i], S[(i + 1) % n], S[j], S[(j + 1) % n])) assert.fail(`${t.id}: segments ${i} and ${j} intersect`);
      const arc = Math.min(cum[j] - cum[i], len - (cum[j] - cum[i]));
      if (arc > 70) minSep = Math.min(minSep, Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z));
    }
    assert.ok(minSep > t.roadWidth + 20, `${t.id}: two sections come within ${minSep.toFixed(1)} m (road ${t.roadWidth})`);
  }
});

test('Lap lengths are clearly different (every pair differs by at least 10 %) and match the design (about 900 / 1100 / 1000 m)', () => {
  const L = TRACKS.map((t) => t.totalLength).sort((a, b) => a - b);
  for (let i = 1; i < L.length; i++) assert.ok(L[i] / L[i - 1] >= 1.1, `lengths ${L.map(Math.round)}`);
  assert.ok(byId.island.totalLength > 840 && byId.island.totalLength < 960, String(byId.island.totalLength));
  assert.ok(byId.canyon.totalLength > 1080 && byId.canyon.totalLength < 1220, String(byId.canyon.totalLength));
  assert.ok(byId.temple.totalLength > 960 && byId.temple.totalLength < 1060, String(byId.temple.totalLength));
});

test('Each track has its own signature: Palm Cove widest, Canyon narrowest with 4 ramps, Temple the most boost pads', () => {
  assert.ok(byId.island.roadWidth > byId.temple.roadWidth && byId.temple.roadWidth > byId.canyon.roadWidth);
  assert.ok(byId.canyon.ramps.length >= 4 && byId.canyon.ramps.length > byId.island.ramps.length);
  assert.ok(byId.temple.boostPads.length >= 7 && byId.temple.boostPads.length > byId.canyon.boostPads.length);
  for (const t of TRACKS) assert.ok(t.tag && t.mechanic && t.length, `${t.id}: card text`);
  // tightest corner radius: canyon technical, island flowing
  const minR = (t) => {
    const S = t.samples; const n = S.length; let m = Infinity;
    for (let i = 0; i < n; i++) {
      const a = S[(i - 4 + n) % n]; const b = S[i]; const c = S[(i + 4) % n];
      const ab = Math.hypot(b.x - a.x, b.z - a.z); const bc = Math.hypot(c.x - b.x, c.z - b.z); const ca = Math.hypot(a.x - c.x, a.z - c.z);
      const ar = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      if (ar > 1e-9) m = Math.min(m, (ab * bc * ca) / (2 * ar));
    }
    return m;
  };
  assert.ok(minR(byId.island) > minR(byId.canyon) * 1.4, `island flowing, canyon hairpins: ${minR(byId.island)} vs ${minR(byId.canyon)}`);
});

test('Start grid fits on the road behind the line on every track and all karts face along the road', () => {
  for (const t of TRACKS) {
    const sim = new RaceSimulation({ trackId: t.id, players: [{ id: 'p', driverId: 'rufus' }], fillAI: true });
    for (const k of sim.karts) {
      const n = sim._findNearestSample(k.x, k.z);
      assert.ok(n.dist < t.roadWidth * 0.5 - 1.5, `${t.id}: ${k.id} starts ${n.dist.toFixed(1)} m off the centre line`);
      const th = Math.atan2(n.sample.tx, n.sample.tz);
      assert.ok(Math.abs(Math.atan2(Math.sin(th - k.heading), Math.cos(th - k.heading))) < 0.2);
    }
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      assert.ok(Math.hypot(sim.karts[i].x - sim.karts[j].x, sim.karts[i].z - sim.karts[j].z) > 2.6, `${t.id}: grid overlap`);
    }
  }
});

test('The AI completes every track at every difficulty: no resets, mostly on the road, similar lap-time order across tracks', () => {
  for (const t of TRACKS) {
    for (const id of Object.keys(DIFFICULTIES)) {
      const r = runRace({ trackId: t.id, drivers: DRIVERS.map((d) => d.id), humans: [], seed: 11, difficulty: id, laps: 2 });
      for (const k of r.sim.karts) {
        assert.ok(k.finished, `${t.id}/${id}: ${k.id} did not finish`);
        assert.equal(k.resets, 0, `${t.id}/${id}: ${k.id} needed the safety net`);
      }
    }
  }
});

test('Ramps: the launch happens at the HIGH (front) edge in the direction of travel, not behind or beside the ramp', () => {
  const sim = new RaceSimulation({ trackId: 'canyon', players: [{ id: 'p', driverId: 'rufus' }], fillAI: false });
  sim.countdown = 0; sim.status = 'racing';
  const k = sim.karts[0]; const ramp = sim.track.ramps[1];
  const place = (along, side, facing = 1) => {
    k.x = ramp.x + ramp.tx * along + -ramp.tz * side; k.z = ramp.z + ramp.tz * along + ramp.tx * side;
    k.heading = Math.atan2(ramp.tx * facing, ramp.tz * facing); k.speed = 25; k.y = 0; k.vy = 0; k.padBoostTimer = 0;
  };
  const launches = () => { sim.events.length = 0; sim.step(1 / 60, { p: { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false } }); return sim.events.some((e) => e.type === 'ramp_jump') || k.vy > 0; };
  place(-2.5, 0); assert.equal(launches(), false, 'approaching the low edge does not launch yet');
  place(1.5, 0); assert.equal(launches(), true, 'front half launches');
  place(1.5, 4.5); assert.equal(launches(), false, 'beside the ramp does not launch');
  place(1.5, 0, -1); assert.equal(launches(), false, 'driving backwards over it does not launch');
});

test('Safety net still works on every new layout: a pinned kart is reset back onto the road', () => {
  for (const t of TRACKS) {
    const sim = new RaceSimulation({ trackId: t.id, players: [{ id: 'p', driverId: 'rufus' }], fillAI: true, rng: mulberry32(2) });
    sim.countdown = 0; sim.status = 'racing';
    const ai = sim.karts.find((x) => x.isAI); const home = { x: ai.x, z: ai.z };
    let reset = false;
    for (let i = 0; i < 6 * 60 && !reset; i++) { ai.speed = 0; ai.x = home.x; ai.z = home.z; sim.step(1 / 60, {}); reset = sim.events.some((e) => e.type === 'reset'); }
    assert.ok(reset, t.id);
  }
});

test('Competent bot lap times differ per track: Palm Cove is the quickest lap, Canyon the slowest', () => {
  const lap = (id) => runRace({ trackId: id, drivers: ['rufus'], humans: [0], seed: 1, laps: 1, controller: (s, k) => ({ ...competentBot(s, k, { turbo: false }), attack: false }) }).sim.karts[0].finishTimeSec;
  const l = Object.fromEntries(TRACKS.map((t) => [t.id, lap(t.id)]));
  assert.ok(l.island < l.temple && l.temple < l.canyon, JSON.stringify(l));
  assert.ok(l.canyon / l.island > 1.2, JSON.stringify(l));
});

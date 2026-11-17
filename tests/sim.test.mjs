import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DRIVERS, RaceSimulation } from '../js/sim.js';
import { MotionController, makeSyntheticPose } from '../js/motion.js';
import { competentBot } from './harness.mjs';

test('Tracks provide closed loop splines, checkpoints, crates, and boost pads for 3 circuits', () => {
  assert.equal(TRACKS.length, 3);
  for (const t of TRACKS) {
    assert.ok(t.waypoints.length >= 12);
    assert.ok(t.crateSpawns.length >= 6);
    assert.ok(t.boostPads.length >= 3);
  }
  assert.equal(DRIVERS.length, 4);
});

test('Kart physics accelerates, steers, charges and fires turbo, and prevents lap skipping when reversing', () => {
  const sim = new RaceSimulation({
    trackId: 'island',
    mode: '1p',
    players: [{ id: 'p1', name: 'P1', driverId: 'rufus', isAI: false }],
    totalLaps: 3,
  });

  // Skip countdown for physics test
  sim.countdown = 0;
  sim.status = 'racing';

  // Reversing across start line must NOT increment lap
  for (let i = 0; i < 60; i++) {
    sim.step(1 / 60, { p1: { throttle: 0, brake: true, reverse: true, steer: 0, turbo: false, attack: false, hop: false } });
  }
  assert.equal(sim.karts[0].lap, 1);

  // Driving forward increases speed; turbo boost increases speed above base topSpeed
  sim.karts[0].turboCharge = 100;
  for (let i = 0; i < 90; i++) {
    sim.step(1 / 60, { p1: { throttle: 1, brake: false, reverse: false, steer: 0, turbo: true, attack: false, hop: false } });
  }
  assert.ok(sim.karts[0].speed > sim.karts[0].baseTopSpeed);
  assert.ok(sim.karts[0].turboCharge < 100);
});

test('Smashing an item crate grants a weapon and punching fires a projectile or hazard', () => {
  const sim = new RaceSimulation({
    trackId: 'island',
    mode: '1p',
    players: [
      { id: 'p1', name: 'P1', driverId: 'rufus', isAI: false },
      { id: 'ai1', name: 'Bot 1', driverId: 'jet', isAI: true },
    ],
    totalLaps: 3,
  });
  sim.countdown = 0;
  sim.status = 'racing';

  const kart = sim.karts[0];
  const crate = sim.crates[0];
  kart.x = crate.x;
  kart.z = crate.z;
  sim.step(1 / 60, { p1: { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false } });
  assert.equal(crate.active, false);
  assert.ok(['rocket', 'bomb', 'tnt', 'shield'].includes(kart.heldItem));

  // Punching fires the held item
  kart.heldItem = 'rocket';
  sim.step(1 / 60, { p1: { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: true, hop: false } });
  assert.equal(kart.heldItem, null);
  assert.equal(sim.projectiles.length, 1);
  assert.equal(sim.projectiles[0].type, 'rocket');
});

test('Kart approaching outer track edge deflects heading smoothly along track tangent instead of getting stuck', () => {
  const sim = new RaceSimulation({
    trackId: 'island',
    mode: '1p',
    players: [{ id: 'p1', name: 'P1', driverId: 'rufus', isAI: false }],
    totalLaps: 3,
  });
  sim.countdown = 0;
  sim.status = 'racing';

  const kart = sim.karts[0];
  const sample = sim.track.getPointAt(0.05);
  const trackHeading = Math.atan2(sample.tx, sample.tz);
  // Place kart near outer edge pointing outward at ~0.8 rad angle away from track tangent
  const halfW = sim.track.roadWidth * 0.5;
  kart.x = sample.x + sample.rx * (halfW + 1.5);
  kart.z = sample.z + sample.rz * (halfW + 1.5);
  kart.heading = trackHeading - 0.8;
  kart.speed = 24;

  const initialDiff = Math.abs(Math.atan2(Math.sin(trackHeading - kart.heading), Math.cos(trackHeading - kart.heading)));
  for (let i = 0; i < 30; i++) {
    sim.step(1 / 60, { p1: { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false } });
  }
  const sampleAfter = sim._findNearestSample(kart.x, kart.z).sample;
  const trackHeadingAfter = Math.atan2(sampleAfter.tx, sampleAfter.tz);
  const finalDiff = Math.abs(Math.atan2(Math.sin(trackHeadingAfter - kart.heading), Math.cos(trackHeadingAfter - kart.heading)));
  assert.ok(finalDiff < initialDiff * 0.65, `Expected heading diff to reduce significantly (${initialDiff.toFixed(3)} -> ${finalDiff.toFixed(3)})`);
});

test('Simulated human webcam player (with jitter and body-lean inertia) stays on road and carves left/right smoothly for 25s', () => {
  const ctrl = new MotionController({ autoGas: true });
  ctrl.calibrate([makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2 })], 1);

  const sim = new RaceSimulation({
    trackId: 'canyon',
    mode: '1p',
    players: [{ id: 'p1', name: 'HumanSim', driverId: 'rufus', isAI: false }],
    totalLaps: 3,
    fillAI: false,
  });
  sim.countdown = 0;
  sim.status = 'racing';

  const kart = sim.karts[0];
  const halfRoad = sim.track.roadWidth * 0.5;
  let minLateral = Infinity;
  let maxLateral = -Infinity;
  let maxHeadingErr = 0;
  let maxDist = 0;

  // The kart now turns only when the player steers (no auto road-following), so this player watches
  // the road: the lean is a feedback loop that adds a slow weave to what a competent driver would
  // steer, and the webcam mapping (filters, curve, dead zone) turns that lean into steering.
  let lean = 0;
  let lastSteer = 0;
  for (let frame = 0; frame < 1500; frame++) {
    const tSec = frame / 60;
    const bot = competentBot(sim, kart, { turbo: false, rng: () => 1 });
    const weave = Math.sin(tSec * 0.7) * 0.3;
    const wanted = Math.max(-1, Math.min(1, bot.steer + weave));
    lean = Math.max(-1, Math.min(1, lean + (wanted - lastSteer) * 0.05));
    const jitter = Math.sin(frame * 13.7) * 0.008;
    const leanWave = lean;
    const pose = makeSyntheticPose({
      centerX: 0.5 - leanWave * 0.06 + jitter,
      shoulderWidth: 0.2,
      leanRight: leanWave,
      wheelTiltRight: leanWave * 0.6,
      handsUp: frame > 300 && frame < 340,
      rightPunch: frame === 500,
    });
    const [p1In] = ctrl.update([pose], frame * (1000 / 60), 1);
    lastSteer = p1In.steer;
    sim.step(1 / 60, { p1: p1In });

    const near = sim._findNearestSample(kart.x, kart.z);
    const s = near.sample;
    const lateral = (kart.x - s.x) * s.rx + (kart.z - s.z) * s.rz;
    const trackHeading = Math.atan2(s.tx, s.tz);
    const headingErr = Math.abs(Math.atan2(Math.sin(trackHeading - kart.heading), Math.cos(trackHeading - kart.heading)));

    if (near.dist > maxDist) maxDist = near.dist;
    if (headingErr > maxHeadingErr) maxHeadingErr = headingErr;
    if (lateral < minLateral) minLateral = lateral;
    if (lateral > maxLateral) maxLateral = lateral;
  }

  assert.ok(maxDist <= halfRoad + 1.2, `Kart drifted off-road: maxDist=${maxDist.toFixed(2)} vs limit=${(halfRoad + 1.2).toFixed(2)}`);
  assert.ok(maxHeadingErr < 0.75, `Kart heading diverged too far from track: ${maxHeadingErr.toFixed(2)} rad`);
  assert.ok(minLateral < -2.0, `Expected human lean left to carve left (< -2.0m), got minLateral=${minLateral.toFixed(2)}`);
  assert.ok(maxLateral > 2.0, `Expected human lean right to carve right (> +2.0m), got maxLateral=${maxLateral.toFixed(2)}`);
  assert.ok(kart.totalProgress > 0.5, `Expected kart to advance smoothly along track, got progress=${kart.totalProgress.toFixed(2)}`);
});

const IDLE = { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false };

function steerToRoad(sim, k, extra = {}) {
  const tp = sim.track.getPointAt(k.trackS + 0.03);
  let d = Math.atan2(tp.x - k.x, tp.z - k.z) - k.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return { ...IDLE, steer: Math.max(-1, Math.min(1, -d * 2)), ...extra };
}

test('AI-only races on every track: all karts finish close together and stay on the road', () => {
  for (const t of TRACKS) {
    const sim = new RaceSimulation({ trackId: t.id, players: [], totalLaps: 3, fillAI: true });
    sim.karts.forEach((k) => { k.isAI = true; });
    sim.countdown = 0;
    sim.status = 'racing';
    const offFrames = sim.karts.map(() => 0);
    let frames = 0;
    while (!sim.karts.every((k) => k.finished) && frames < 60 * 150) {
      sim.step(1 / 60, {});
      frames++;
      sim.karts.forEach((k, i) => {
        if (sim._findNearestSample(k.x, k.z).dist > t.roadWidth * 0.5 + 1.2) offFrames[i]++;
      });
    }
    const times = sim.karts.map((k) => k.finishTimeSec);
    assert.ok(times.every((x) => x !== null), `${t.id}: every AI should finish within 150s`);
    const lo = Math.min(...times);
    const hi = Math.max(...times);
    assert.ok(hi / lo < 1.25, `${t.id}: AI spread too wide (${lo}s..${hi}s)`);
    assert.ok(Math.max(...offFrames) < frames * 0.08, `${t.id}: an AI spent too long off-road (${Math.max(...offFrames)}/${frames})`);
  }
});

test('Reverse input first brakes a moving kart; it only drives backwards once stopped', () => {
  const sim = new RaceSimulation({ trackId: 'island', players: [{ id: 'p1', name: 'P', driverId: 'rufus' }], fillAI: false });
  sim.countdown = 0;
  sim.status = 'racing';
  const k = sim.karts[0];
  k.speed = 25;
  for (let i = 0; i < 10; i++) sim.step(1 / 60, { p1: { ...IDLE, throttle: 0, brake: true, reverse: true } });
  assert.ok(k.speed > 0, `Kart should still be moving forward after 10 frames of brake, speed=${k.speed}`);
  for (let i = 0; i < 180; i++) sim.step(1 / 60, { p1: { ...IDLE, throttle: 0, brake: true, reverse: true } });
  assert.ok(k.speed < 0, 'Kart should be reversing after holding brake until stopped');
});

test('Homing rocket ignores karts behind it', () => {
  const sim = new RaceSimulation({
    trackId: 'island',
    players: [{ id: 'p1', name: 'P', driverId: 'rufus' }, { id: 'ai1', name: 'B', driverId: 'jet', isAI: true }],
    fillAI: false,
  });
  sim.countdown = 0;
  sim.status = 'racing';
  const [me, bot] = sim.karts;
  bot.x = me.x - Math.sin(me.heading) * 12;
  bot.z = me.z - Math.cos(me.heading) * 12;
  me.heldItem = 'rocket';
  sim.step(1 / 60, { p1: { ...IDLE, attack: true } });
  const proj = sim.projectiles[0];
  const h0 = proj.heading;
  for (let i = 0; i < 20; i++) sim.step(1 / 60, { p1: IDLE });
  const p = sim.projectiles[0];
  if (p) assert.ok(Math.abs(p.heading - h0) < 0.01, 'rocket must not turn around to chase a kart behind it');
  assert.equal(bot.spinOutTimer, 0, 'kart behind should not be hit by a forward rocket');
});

test('A kart that was just hit cannot be chain-spun, and turbo cannot be held on forever', () => {
  const sim = new RaceSimulation({ trackId: 'island', players: [{ id: 'p1', name: 'P', driverId: 'rufus' }], fillAI: false });
  sim.countdown = 0;
  sim.status = 'racing';
  const k = sim.karts[0];
  assert.equal(sim._applyHit(k, 'x'), true);
  const t = k.spinOutTimer;
  assert.equal(sim._applyHit(k, 'x'), false, 'second hit during spin-out/invulnerability must be ignored');
  assert.equal(k.spinOutTimer, t);

  const sim2 = new RaceSimulation({ trackId: 'island', players: [{ id: 'p1', name: 'P', driverId: 'rufus' }], fillAI: false });
  sim2.countdown = 0;
  sim2.status = 'racing';
  const k2 = sim2.karts[0];
  k2.turboCharge = 100;
  for (let i = 0; i < 60 * 10; i++) sim2.step(1 / 60, { p1: steerToRoad(sim2, k2, { turbo: true }) });
  assert.ok(k2.statsSummary.turbosUsed <= 4, `turbo used ${k2.statsSummary.turbosUsed} times in 10s; should be limited by charge`);
});

test('Race stays live for ~3s after the last human finishes, then ends; humans start at the back of the grid', () => {
  const sim = new RaceSimulation({ trackId: 'island', players: [{ id: 'p1', name: 'P', driverId: 'rufus' }], totalLaps: 3 });
  const me = sim.karts[0];
  for (const o of sim.karts.slice(1)) {
    const along = (o.x - me.x) * Math.sin(me.heading) + (o.z - me.z) * Math.cos(me.heading);
    assert.ok(along > -1, 'no AI kart should start behind the human (it would sit in the chase camera)');
  }
  sim.countdown = 0;
  sim.status = 'racing';
  me.finished = true;
  me.finishTimeSec = 1;
  sim.step(1 / 60, {});
  assert.equal(sim.status, 'racing');
  for (let i = 0; i < 60 * 3.2; i++) sim.step(1 / 60, {});
  assert.equal(sim.status, 'finished');
});

test('Keeping a road-following keyboard player vs 3 AI: player finishes within 15% of the AI pack on all tracks', () => {
  for (const t of TRACKS) {
    const sim = new RaceSimulation({ trackId: t.id, players: [{ id: 'p1', name: 'P', driverId: 'rufus' }], totalLaps: 3 });
    sim.countdown = 0;
    sim.status = 'racing';
    const k = sim.karts[0];
    let frames = 0;
    while (sim.status !== 'finished' && frames < 60 * 200) {
      sim.step(1 / 60, { p1: steerToRoad(sim, k) });
      frames++;
    }
    const aiTimes = sim.karts.slice(1).map((x) => x.finishTimeSec).filter(Boolean);
    assert.ok(k.finished, `${t.id}: player must finish`);
    const best = aiTimes.length ? Math.min(...aiTimes) : k.finishTimeSec;
    assert.ok(k.finishTimeSec < best * 1.15, `${t.id}: player ${k.finishTimeSec}s vs best AI ${best}s is not competitive`);
  }
});

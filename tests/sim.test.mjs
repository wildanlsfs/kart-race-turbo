import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DRIVERS, RaceSimulation } from '../js/sim.js';
import { MotionController, makeSyntheticPose } from '../js/motion.js';

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
    players: [{ id: 'p1', name: 'P1', driverId: 'bandi', isAI: false }],
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
      { id: 'p1', name: 'P1', driverId: 'bandi', isAI: false },
      { id: 'ai1', name: 'Bot 1', driverId: 'nitro', isAI: true },
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
    players: [{ id: 'p1', name: 'P1', driverId: 'bandi', isAI: false }],
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
    players: [{ id: 'p1', name: 'HumanSim', driverId: 'bandi', isAI: false }],
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

  for (let frame = 0; frame < 1500; frame++) {
    const tSec = frame / 60;
    // Simulate realistic human: slow sinusoidal leans left/right + deterministic camera jitter + turbo handsUp bursts
    const leanWave = Math.sin(tSec * 0.7) * 0.75;
    const jitter = Math.sin(frame * 13.7) * 0.008;
    const pose = makeSyntheticPose({
      centerX: 0.5 - leanWave * 0.06 + jitter,
      shoulderWidth: 0.2,
      leanRight: leanWave,
      wheelTiltRight: leanWave * 0.6,
      handsUp: frame > 300 && frame < 340,
      rightPunch: frame === 500,
    });
    const [p1In] = ctrl.update([pose], frame * (1000 / 60), 1);
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

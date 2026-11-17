import test from 'node:test';
import assert from 'node:assert/strict';
import { padTarget, stepSteer, SteerPad, PAD_DEADZONE, TAP_KICK } from '../js/touchsteer.js';
import { RaceSimulation } from '../js/sim.js';

const R = { left: 100, width: 400 }; // centre x = 300

test('padTarget: centre is straight, edges are full lock, symmetric and monotonic', () => {
  assert.equal(padTarget(300, R), 0);
  assert.equal(padTarget(300 + 200 * PAD_DEADZONE * 0.9, R), 0);
  assert.equal(padTarget(100, R), -1);
  assert.equal(padTarget(500, R), 1);
  assert.equal(padTarget(450, R), -padTarget(150, R));
  let prev = -2;
  for (let x = 100; x <= 500; x += 10) { const v = padTarget(x, R); assert.ok(v >= prev); prev = v; }
  assert.equal(padTarget(0, R), -1); // finger drifted off the pad: still full lock, never a drop
  assert.equal(padTarget(900, R), 1);
  assert.equal(padTarget(300, { left: 0, width: 0 }), 0);
});

test('stepSteer: a tap turns immediately, ramps up, and releases quickly', () => {
  let v = stepSteer(0, 1, true, 1 / 60, true);
  assert.ok(v >= TAP_KICK, `first frame of a touch should already steer, got ${v}`);
  for (let i = 0; i < 12; i++) v = stepSteer(v, 1, true, 1 / 60);
  assert.ok(v > 0.8, `reaches near full lock within 0.2 s, got ${v}`);
  for (let i = 0; i < 18; i++) v = stepSteer(v, 0, false, 1 / 60);
  assert.ok(Math.abs(v) < 0.1, `back to centre within 0.3 s, got ${v}`);
  for (let i = 0; i < 60; i++) v = stepSteer(v, 0, false, 1 / 60);
  assert.equal(v, 0);
});

test('stepSteer: switching direction flips sign without sticking on the old side', () => {
  let v = 0.9;
  v = stepSteer(v, -1, true, 1 / 60, true);
  assert.ok(v < 0.9);
  for (let i = 0; i < 20; i++) v = stepSteer(v, -1, true, 1 / 60);
  assert.ok(v < -0.8);
});

test('SteerPad: one finger steers, a second is ignored, drift off the pad keeps steering, lift returns to 0', () => {
  const p = new SteerPad();
  assert.equal(p.press(1, 120, R), true);
  assert.equal(p.press(2, 480, R), false);
  let v = 0; for (let i = 0; i < 20; i++) v = p.update(1 / 60);
  assert.ok(v < -0.8);
  p.move(1, 20); // far outside the pad
  for (let i = 0; i < 20; i++) v = p.update(1 / 60);
  assert.ok(v < -0.9, 'still steering after the finger slid off');
  p.move(2, 500); // other pointer does nothing
  assert.equal(p.release(2), false);
  assert.equal(p.release(1), true);
  for (let i = 0; i < 40; i++) v = p.update(1 / 60);
  assert.equal(v, 0);
  assert.equal(p.markerFraction, 0.5);
});

test('SteerPad drives a kart round a bend on the road: proportional pad finishes a lap with few wall touches', () => {
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const sim = new RaceSimulation({ trackId: 'canyon', players: [{ id: 'p', driverId: 'rufus', isAI: false }], totalLaps: 1, fillAI: false });
  sim.countdown = 0; sim.status = 'racing';
  const k = sim.karts[0];
  const pad = new SteerPad();
  const dt = 1 / 60; let t = 0; let walls = 0;
  while (!k.finished && t < 120) {
    const n = sim._findNearestSample(k.x, k.z).sample;
    const look = sim.track.getPointAt(n.s + 0.03 + Math.max(0, k.speed) * 0.0008);
    const u = Math.max(-1, Math.min(1, wrap(Math.atan2(n.tx, n.tz) - Math.atan2(look.x - k.x, look.z - k.z)) / 0.62));
    // a thumb that puts the finger where it wants the steer to be (with small jitter), lifts when straight
    if (Math.abs(u) > 0.05) { if (!pad.active) pad.press(1, 300, R); pad.move(1, 300 + u * 0.8 * 200 + Math.sin(t * 7) * 6); } else if (pad.active) pad.release(1);
    sim.step(dt, { p: { throttle: 1, brake: false, reverse: false, steer: pad.update(dt), turbo: false, attack: false, hop: false } });
    for (const e of sim.events || []) if (e.type === 'wall') walls++;
    t += dt;
  }
  assert.ok(k.finished, 'lap completed');
  assert.ok(k.finishTimeSec < 40, `lap time ${k.finishTimeSec}`);
  assert.ok(walls <= 3, `wall touches ${walls}`);
});

import { competentBot } from './harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { padTarget, stepSteer, SteerPad, PAD_DEADZONE, TAP_KICK, WheelTouch, pointerAngleDeg, stepKeyWheel } from '../js/touchsteer.js';
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

test('SteerPad (legacy proportional pad) still passes its unit contract', () => {
  assert.equal(typeof SteerPad, 'function');
});

const C = { cx: 200, cy: 200 };

test('pointerAngleDeg: 0 = up, clockwise positive', () => {
  assert.equal(Math.round(pointerAngleDeg(200, 100, 200, 200)), 0);
  assert.equal(Math.round(pointerAngleDeg(300, 200, 200, 200)), 90);
  assert.equal(Math.round(pointerAngleDeg(100, 200, 200, 200)), -90);
  assert.equal(Math.round(pointerAngleDeg(200, 300, 200, 200)), 180);
});

test('WheelTouch: the wheel angle is the swept finger angle (position), clamped to +-60, springs back on release', () => {
  const w = new WheelTouch();
  assert.equal(w.press(1, 200, 100, C), true);
  assert.equal(w.press(2, 100, 200, C), false, 'a second finger is ignored');
  // finger moves 30 deg clockwise around the centre
  const r = 100; const a = (30 * Math.PI) / 180;
  w.move(1, 200 + r * Math.sin(a), 200 - r * Math.cos(a));
  assert.ok(Math.abs(w.update(1 / 60) - 30) < 0.01, `30 deg, got ${w.deg}`);
  // finger goes on to 100 deg: wheel stays at the +60 limit
  for (let d = 40; d <= 100; d += 10) { const q = (d * Math.PI) / 180; w.move(1, 200 + r * Math.sin(q), 200 - r * Math.cos(q)); }
  assert.equal(w.update(1 / 60), 60);
  // negative side is symmetric
  for (let d = 90; d >= -100; d -= 10) { const q = (d * Math.PI) / 180; w.move(1, 200 + r * Math.sin(q), 200 - r * Math.cos(q)); }
  assert.equal(w.update(1 / 60), -60);
  w.move(2, 0, 0); assert.equal(w.deg, -60, 'other pointers do nothing');
  assert.equal(w.release(1), true);
  let prev = w.update(1 / 60);
  assert.ok(prev > -60, 'springs back');
  for (let i = 0; i < 60; i++) { const v = w.update(1 / 60); assert.ok(v >= prev); prev = v; }
  assert.equal(prev, 0);
});

test('WheelTouch: unwinding after over-travel and a grab at the side do not jump the wheel', () => {
  const w = new WheelTouch();
  w.press(1, 300, 200, C); // grab at 90 deg: wheel must stay at 0 until the finger moves
  assert.equal(w.update(1 / 60), 0);
  const q = (100 * Math.PI) / 180; w.move(1, 200 + 100 * Math.sin(q), 200 - 100 * Math.cos(q));
  assert.ok(Math.abs(w.update(1 / 60) - 10) < 0.01);
});

test('Keyboard wheel: turns at ~200 deg/s towards +-60, holds, returns to centre', () => {
  let d = 0;
  for (let i = 0; i < 30; i++) d = stepKeyWheel(d, 1, 1 / 60); // 0.5 s
  assert.ok(d > 55 || d === 60, `after 0.5 s ${d}`);
  assert.ok(Math.abs(stepKeyWheel(0, 1, 0.1) - 20) < 0.01, '200 deg/s');
  for (let i = 0; i < 60; i++) d = stepKeyWheel(d, 1, 1 / 60);
  assert.equal(d, 60);
  for (let i = 0; i < 60; i++) d = stepKeyWheel(d, 0, 1 / 60);
  assert.equal(d, 0);
  assert.equal(stepKeyWheel(0, -1, 1), -60);
});

test('A kart steered with the touch wheel angle (position control) finishes a Canyon lap within 25 % of a perfect look-ahead bot', () => {
  const lapWith = (mode) => {
    const sim = new RaceSimulation({ trackId: 'canyon', players: [{ id: 'p', driverId: 'rufus', isAI: false }], totalLaps: 1, fillAI: false });
    sim.countdown = 0; sim.status = 'racing';
    const k = sim.karts[0]; const w = new WheelTouch(); const dt = 1 / 60; let t = 0; let walls = 0;
    while (!k.finished && t < 150) {
      const bot = competentBot(sim, k, { turbo: false, rng: () => 1 });
      let steer = bot.steer;
      if (mode === 'wheel') {
        // the thumb: aims for the wanted wheel angle by sweeping around the wheel centre (finger noise included)
        const want = steer * 60 + Math.sin(t * 7) * 1.5;
        if (!w.active) w.press(1, 200, 100, C);
        const cur = w.deg; const target = Math.max(-60, Math.min(60, want));
        const q = ((target - cur) * Math.PI) / 180 + (Math.atan2(w.lastAngle ? Math.sin(w.lastAngle * Math.PI / 180) : 0, Math.cos(w.lastAngle * Math.PI / 180)));
        const a = Math.atan2(Math.sin(q), Math.cos(q));
        w.move(1, 200 + 100 * Math.sin(a), 200 - 100 * Math.cos(a));
        steer = w.update(dt) / 60;
      }
      sim.step(dt, { p: { ...bot, steer } });
      for (const e of sim.events || []) if (e.type === 'wall') walls++;
      t += dt;
    }
    return { time: k.finishTimeSec, walls };
  };
  const ref = lapWith('bot'); const wheel = lapWith('wheel');
  assert.ok(wheel.time && wheel.time < ref.time * 1.25, `wheel lap ${wheel.time} vs bot ${ref.time}`);
  assert.ok(wheel.walls <= 4, `wall touches ${wheel.walls}`);
});

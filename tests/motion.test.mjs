import test from 'node:test';
import assert from 'node:assert/strict';
import { OneEuroFilter, MotionController, makeSyntheticPose } from '../js/motion.js';
import { wheelButtons } from '../js/wheelgeom.js';

test('OneEuroFilter smooths jitter while tracking step changes', () => {
  const f = new OneEuroFilter(1.2, 0.05);
  assert.equal(f.filter(0, 0.0), 0);
  const v1 = f.filter(1, 0.016);
  assert.ok(v1 > 0 && v1 < 1);
  const v2 = f.filter(1, 0.5);
  assert.ok(v2 > 0.85);
});

// Real rotation of an imaginary wheel: both hands grip it and the hand line turns about its centre.
function wheelPose(thetaDeg, radiusSw, { sw = 0.2, cx = 0.5, sy = 0.42, tilt = 0 } = {}) {
  const p = makeSyntheticPose({ centerX: cx, shoulderY: sy, shoulderWidth: sw });
  const th = (thetaDeg * Math.PI) / 180;
  const r = radiusSw * sw;
  const wy = sy + sw * 0.9;
  p.landmarks[15] = { x: cx + r * Math.cos(th), y: wy - r * Math.sin(th), z: -0.12, visibility: 0.99 };
  p.landmarks[16] = { x: cx - r * Math.cos(th), y: wy + r * Math.sin(th), z: -0.12, visibility: 0.99 };
  if (tilt) rotateAbout(p, cx, sy, tilt);
  return p;
}
// A camera that is not level turns the whole picture about a point: shoulders and hands alike.
function rotateAbout(p, cx, cy, deg) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  for (const i of [0, 11, 12, 15, 16, 23, 24]) { const q = p.landmarks[i]; const dx = q.x - cx, dy = q.y - cy; q.x = cx + dx * c - dy * s; q.y = cy + dx * s + dy * c; }
}
const run = (ctrl, mk, frames, t0 = 1000) => { let o; for (let i = 0; i < frames; i++) o = ctrl.update([typeof mk === 'function' ? mk(i) : mk], t0 + i * 33, 1)[0]; return o; };

test('No calibration is needed: hands level on the wheel are straight, a driving kart is auto-gassed, and NOS/FIRE are off', () => {
  const ctrl = new MotionController({ autoGas: true });
  const o = run(ctrl, wheelPose(0, 0.75), 30);
  assert.equal(o.throttle, 1);
  assert.equal(o.steer, 0);
  assert.equal(o.turbo, false);
  assert.equal(o.attack, false);
});

test('NOS: the player\'s right hand on the right-hand button holds turbo, only after a short press, and releases with the hand', () => {
  const ctrl = new MotionController({ autoGas: true });
  run(ctrl, wheelPose(0, 0.75), 10);
  const first = ctrl.update([makeSyntheticPose({ nosPress: true })], 1400, 1)[0];
  assert.equal(first.turbo, false, 'a brush of the button (first frame) must not trigger');
  const held = run(ctrl, makeSyntheticPose({ nosPress: true }), 8, 1433);
  assert.equal(held.turbo, true);
  const off = run(ctrl, wheelPose(0, 0.75), 3, 1800);
  assert.equal(off.turbo, false);
});

test('FIRE: the left hand on the left-hand button fires once per press, not continuously', () => {
  const ctrl = new MotionController({ autoGas: true });
  run(ctrl, wheelPose(0, 0.75), 10);
  let fired = 0;
  for (let i = 0; i < 30; i++) { const o = ctrl.update([makeSyntheticPose({ firePress: true })], 1400 + i * 33, 1)[0]; if (o.attack) fired++; }
  assert.equal(fired, 1);
  run(ctrl, wheelPose(0, 0.75), 6, 2500);
  let again = 0;
  for (let i = 0; i < 30; i++) { const o = ctrl.update([makeSyntheticPose({ firePress: true })], 3000 + i * 33, 1)[0]; if (o.attack) again++; }
  assert.equal(again, 1, 'a second press fires again');
});

test('NOS and FIRE are pressed by the hand nearest to them, and turning the wheel to its limit never presses either', () => {
  for (const radius of [0.5, 0.75, 1.0, 1.4]) {
    for (const deg of [-90, -60, -30, 0, 30, 60, 90]) {
      const ctrl = new MotionController({ autoGas: true });
      for (let i = 0; i < 40; i++) {
        const o = ctrl.update([wheelPose(deg, radius)], 1000 + i * 33, 1)[0];
        assert.equal(o.turbo, false, `radius ${radius} wheel ${deg}: NOS pressed by turning the wheel`);
        assert.equal(o.attack, false, `radius ${radius} wheel ${deg}: FIRE pressed by turning the wheel`);
      }
    }
  }
});

test('Steering while pressing: with the right hand on NOS the wheel is still read from the left hand alone', () => {
  const ctrl = new MotionController({ autoGas: true });
  run(ctrl, wheelPose(0, 0.75), 30); // learns the wheel centre and radius from the two-hand grip
  // left hand turns the wheel 30 deg while the right hand sits on NOS
  const mk = () => { const p = wheelPose(30, 0.75); const b = wheelButtons(0.5, 0.42, 0.2); p.landmarks[16] = { x: b.nos.x, y: b.nos.y, z: -0.1, visibility: 0.99 }; return p; };
  const o = run(ctrl, mk, 40, 3000);
  assert.equal(o.turbo, true);
  assert.ok(o.steer * 90 > 18 && o.steer * 90 < 40, `one-hand wheel read ${(o.steer * 90).toFixed(1)} deg for a 30 deg turn`);
});

test('A wheel the player lets go of (hands gone, or no valid wrist for 0.4 s) returns to straight', () => {
  const ctrl = new MotionController({ autoGas: true });
  const turning = run(ctrl, wheelPose(45, 0.75), 40);
  assert.ok(turning.steer * 90 > 30);
  const lost = (i) => { const p = wheelPose(45, 0.75); p.landmarks[15] = { ...p.landmarks[15], y: 1.4 }; p.landmarks[16] = { ...p.landmarks[16], y: 1.4 }; return p; }; // both wrists below the picture
  const o = run(ctrl, lost, 40, 5000);
  assert.ok(Math.abs(o.steer * 90) < 3, `wheel still ${(o.steer * 90).toFixed(1)} deg after the hands were lost`);
});

test('A wrist the model puts outside the picture is not believed, even with a high visibility score', () => {
  const ctrl = new MotionController({ autoGas: true });
  run(ctrl, wheelPose(0, 0.75), 30);
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    const p = wheelPose(0, 0.75);
    if (i >= 10 && i < 22) p.landmarks[15] = { x: 0.9, y: 1.34, z: -0.1, visibility: 0.93 }; // real log sample: wrist far below the frame
    peak = Math.max(peak, Math.abs(ctrl.update([p], 8000 + i * 33, 1)[0].steer * 90));
  }
  assert.ok(peak <= 3, `wheel moved ${peak.toFixed(1)} deg on an out-of-frame wrist`);
});

test('A tilted camera does not turn the kart: 0 degrees is measured against the player\'s own shoulder line', () => {
  for (const tilt of [-10, -5, 5, 10]) {
    const ctrl = new MotionController({ autoGas: true });
    const o = run(ctrl, wheelPose(0, 0.75, { tilt }), 150);
    assert.ok(Math.abs(o.steer * 90) <= 3, `camera tilted ${tilt} deg: wheel reads ${(o.steer * 90).toFixed(1)} deg`);
  }
});

test('Body lean no longer steers while a hand is on the wheel (it used to add a constant bias)', () => {
  const ctrl = new MotionController({ autoGas: true });
  const mk = () => { const p = wheelPose(0, 0.75, { cx: 0.44 }); return p; }; // whole upper body shifted: a lean, with level hands
  const o = run(ctrl, mk, 60);
  assert.ok(Math.abs(o.steer) < 0.05, `lean steered ${o.steer}`);
});

test('2-player webcam mode keeps P1 (screen-left) and P2 (screen-right) locked across <400ms dropout, each steering on their own wheel', () => {
  const ctrl = new MotionController({ autoGas: true });
  const left = (deg) => wheelPose(deg, 0.75, { cx: 0.70, sw: 0.16 });
  const right = (deg) => wheelPose(deg, 0.75, { cx: 0.30, sw: 0.18 });
  ctrl.calibrate([left(0), right(0)], 2);
  let in1, in2;
  for (let i = 0; i < 30; i++) [in1, in2] = ctrl.update([left(-40), right(40)], 100 + i * 33, 2);
  assert.ok(in1.steer < -0.25, `P1 ${in1.steer}`);
  assert.ok(in2.steer > 0.25, `P2 ${in2.steer}`);
  // P1 drops out for 200ms (< 400ms persistence window); P2 must stay P2
  const [drop1, drop2] = ctrl.update([right(40)], 100 + 31 * 33, 2);
  assert.equal(drop1.visible, true);
  assert.ok(drop2.steer > 0.25);
});

test('Brake: crouching brakes, and holding it turns into reverse', () => {
  const ctrl = new MotionController({ autoGas: true });
  ctrl.calibrate([makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2 })]);
  let [p1] = ctrl.update([makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, crouch: true })], 600, 1);
  assert.equal(p1.brake, true);
  [p1] = ctrl.update([makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, crouch: true })], 1100, 1);
  assert.equal(p1.reverse, true);
});

test('Turning an imaginary steering wheel steers 1:1 up to 90 degrees, for any hand spacing, both ways', () => {
  for (const radius of [0.5, 0.75, 1.0, 1.4]) {
    for (const deg of [-75, -60, -45, -30, -15, 15, 30, 45, 60, 75]) {
      if (radius > 1.2 && Math.abs(deg) > 60) continue; // such a wide grip at that angle puts the hands below the wheel zone
      const ctrl = new MotionController({ autoGas: true });
      ctrl.calibrate([wheelPose(0, radius)], 1);
      let out;
      for (let i = 0; i < 40; i++) out = ctrl.update([wheelPose(deg, radius)], 1000 + i * 33, 1)[0];
      const wheel = out.steer * 90;
      assert.ok(Math.sign(wheel) === Math.sign(deg), `radius ${radius} deg ${deg}: wrong direction (${wheel})`);
      // within the dead zone plus filter slack of the real angle, never beyond +-90
      assert.ok(Math.abs(wheel - deg) <= 8, `radius ${radius} deg ${deg}: wheel read ${wheel.toFixed(1)}`);
      assert.ok(Math.abs(wheel) <= 90.001);
    }
  }
});

test('Hands held at the calibrated spot (any height from chest to belly) read as straight', () => {
  const ctrl = new MotionController({ autoGas: true });
  ctrl.calibrate([wheelPose(0, 0.75)], 1);
  let out;
  for (let i = 0; i < 30; i++) out = ctrl.update([wheelPose(0, 0.75)], 1000 + i * 33, 1)[0];
  assert.equal(out.steer, 0);
});

test('A turned wheel stays turned: the angle is read against the shoulder line and never drifts away', () => {
  for (const offset of [-12, -8, 8, 12]) {
    const ctrl = new MotionController({ autoGas: true });
    const o = run(ctrl, wheelPose(offset, 0.75), 150); // ~5 s
    const deg = o.steer * 90;
    assert.ok(Math.sign(deg) === Math.sign(offset) && Math.abs(deg - offset) <= 7, `held at ${offset} deg: reads ${deg.toFixed(1)} deg after 5 s`);
  }
});

test('A deliberate 30 degree turn held for 4 seconds is not drifted away', () => {
  const ctrl = new MotionController({ autoGas: true });
  ctrl.calibrate([wheelPose(0, 0.75)], 1);
  let out;
  for (let i = 0; i < 120; i++) out = ctrl.update([wheelPose(30, 0.75)], 1000 + i * 33, 1)[0];
  assert.ok(out.steer * 90 >= 22, `a held 30 deg turn faded to ${(out.steer * 90).toFixed(1)} deg`);
});

test('A landmark glitch of a few frames (a wrist jumping or leaving the wheel) does not turn the kart', () => {
  const glitches = {
    'one wrist jumps up': (p) => { p.landmarks[16].y -= 0.10; },
    'one wrist drops to the lap': (p) => { p.landmarks[15].y += 0.25; },
    'wrists swap': (p) => { const a = p.landmarks[15]; p.landmarks[15] = p.landmarks[16]; p.landmarks[16] = a; },
    'one wrist faintly detected, far off': (p) => { p.landmarks[15] = { ...p.landmarks[15], y: p.landmarks[15].y + 0.3, visibility: 0.4 }; },
  };
  for (const [label, glitch] of Object.entries(glitches)) {
    for (const frames of [1, 2, 3, 6]) {
      // 1-2 frame glitches are removed completely (median of 5). A 3+ frame glitch of this small a jump
      // (0.10 of the frame) is indistinguishable from a real small turn, so it may show as a small wheel
      // movement (under ~12 deg), but never as a turn that takes the kart off the road (it was 33 deg).
      const ctrl = new MotionController({ autoGas: true });
      ctrl.calibrate([wheelPose(0, 0.75)], 1);
      let peak = 0;
      for (let i = 0; i < 120; i++) {
        const p = wheelPose(0, 0.75);
        if (i >= 40 && i < 40 + frames) glitch(p);
        const out = ctrl.update([p], 1000 + i * 33, 1)[0];
        peak = Math.max(peak, Math.abs(out.steer * 90));
      }
      // Big glitches (wrist far off, swapped, faintly detected) are rejected at any length up to 6 frames. The small
      // 'wrist jumps up 0.10' one equals a real 18 deg turn, so beyond 2 frames it may show as at most that angle.
      const small = label === 'one wrist jumps up';
      const limit = frames <= 2 ? 1 : (small ? 18 : 3);
      assert.ok(peak <= limit, `${label}, ${frames} frame(s): wheel jumped to ${peak.toFixed(1)} deg (limit ${limit})`);
    }
  }
});

test('A real turn is still followed quickly (a glitch filter must not make the wheel lag)', () => {
  const ctrl = new MotionController({ autoGas: true });
  ctrl.calibrate([wheelPose(0, 0.75)], 1);
  let out; let reached = -1;
  for (let i = 0; i < 40; i++) {
    out = ctrl.update([wheelPose(i < 10 ? 0 : -45, 0.75)], 1000 + i * 33, 1)[0];
    if (reached < 0 && i >= 10 && out.steer * 90 <= -30) reached = i - 10;
  }
  assert.ok(reached >= 0 && reached <= 6, `wheel took ${reached} frames (${reached * 33} ms) to reach 30 deg of a 45 deg turn`);
});

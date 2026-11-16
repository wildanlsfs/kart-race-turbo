import test from 'node:test';
import assert from 'node:assert/strict';
import { OneEuroFilter, MotionController, makeSyntheticPose } from '../js/motion.js';

test('OneEuroFilter smooths jitter while tracking step changes', () => {
  const f = new OneEuroFilter(1.2, 0.05);
  assert.equal(f.filter(0, 0.0), 0);
  const v1 = f.filter(1, 0.016);
  assert.ok(v1 > 0 && v1 < 1);
  const v2 = f.filter(1, 0.5);
  assert.ok(v2 > 0.85);
});

test('MotionController maps mirrored lean/wheel-tilt, brake crouch, hands-up turbo, and punch attack without cross-triggering', () => {
  const ctrl = new MotionController({ autoGas: true });
  const neutral = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2 });
  ctrl.calibrate([neutral]);

  // Neutral auto-gas drives forward straight
  let [p1] = ctrl.update([neutral], 100, 1);
  assert.equal(p1.throttle, 1);
  assert.ok(Math.abs(p1.steer) < 0.05);

  // Player leans right in real life (mirrored camera raw x moves toward 0.42)
  const rightTurn = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, leanRight: 0.6, wheelTiltRight: 0.5 });
  [p1] = ctrl.update([rightTurn], 200, 1);
  assert.ok(p1.steer > 0.35, `Expected positive right steer, got ${p1.steer}`);

  // Punch forward triggers attack without triggering brake or wild steering
  const punch = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, rightPunch: true });
  [p1] = ctrl.update([punch], 300, 1);
  assert.equal(p1.attack, true);
  assert.equal(p1.brake, false);
  assert.ok(Math.abs(p1.steer) < 0.35);

  // Both hands overhead triggers turbo
  const handsUp = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, handsUp: true });
  [p1] = ctrl.update([handsUp], 450, 1);
  assert.equal(p1.turbo, true);

  // Pull hands to chest / crouch triggers brake, and after holding triggers reverse
  const brakePose = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, crouch: true });
  [p1] = ctrl.update([brakePose], 600, 1);
  assert.equal(p1.brake, true);
  [p1] = ctrl.update([brakePose], 1100, 1);
  assert.equal(p1.reverse, true);
});

test('2-player webcam mode keeps P1 (screen-left) and P2 (screen-right) locked across <400ms dropout', () => {
  const ctrl = new MotionController({ autoGas: true });
  // Screen-left in mirrored view has larger raw camera X (~0.70); screen-right has smaller raw X (~0.30)
  const poseLeft = makeSyntheticPose({ centerX: 0.70, shoulderWidth: 0.16 });
  const poseRight = makeSyntheticPose({ centerX: 0.30, shoulderWidth: 0.18 });
  ctrl.calibrate([poseLeft, poseRight], 2);

  const [in1, in2] = ctrl.update([
    makeSyntheticPose({ centerX: 0.70, shoulderWidth: 0.16, leanRight: -0.7 }),
    makeSyntheticPose({ centerX: 0.30, shoulderWidth: 0.18, leanRight: 0.7 }),
  ], 100, 2);
  assert.ok(in1.steer < -0.25);
  assert.ok(in2.steer > 0.25);

  // P1 drops out for 200ms (< 400ms persistence window); P2 must stay P2
  const [drop1, drop2] = ctrl.update([
    makeSyntheticPose({ centerX: 0.30, shoulderWidth: 0.18, leanRight: 0.7 }),
  ], 300, 2);
  assert.equal(drop1.visible, true);
  assert.ok(drop2.steer > 0.25);
});

test('Upper-body laptop webcam steering works even when hips move with shoulders (hips out of frame)', () => {
  const ctrl = new MotionController({ autoGas: true });
  const neutral = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2 });
  ctrl.calibrate([neutral], 1);

  // Simulate laptop webcam where player shifts upper body right (raw camera centerX moves from 0.50 to 0.41)
  // and MediaPipe places hips directly under shoulders (leanRight: 0)
  const shiftedRight = makeSyntheticPose({ centerX: 0.41, shoulderWidth: 0.2, leanRight: 0, wheelTiltRight: 0 });
  const [p1] = ctrl.update([shiftedRight], 200, 1);
  assert.ok(p1.steer > 0.35, `Expected upper-body shift right to steer right (>0.35), got ${p1.steer}`);
});

test('Comfort deadzone filters micro-jitter while deliberate leans produce smooth progressive steering', () => {
  const ctrl = new MotionController({ autoGas: true });
  const neutral = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2 });
  ctrl.calibrate([neutral], 1);

  // Micro-movement / webcam jitter (0.50 -> 0.494) stays dead-center (steer === 0)
  const microJitter = makeSyntheticPose({ centerX: 0.494, shoulderWidth: 0.2, leanRight: 0, wheelTiltRight: 0 });
  let [p1] = ctrl.update([microJitter], 150, 1);
  assert.equal(p1.steer, 0, `Expected webcam micro-jitter to stay 0 steer, got ${p1.steer}`);

  // Moderate deliberate lean gives controlled medium steering (not twitchy max)
  const moderateRight = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, leanRight: 0.45, wheelTiltRight: 0.2 });
  [p1] = ctrl.update([moderateRight], 300, 1);
  assert.ok(p1.steer > 0.20 && p1.steer < 0.75, `Expected controlled medium steer (0.20..0.75), got ${p1.steer}`);

  // Full lean + wheel tilt gives strong steering
  const fullRight = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, leanRight: 0.85, wheelTiltRight: 0.75 });
  [p1] = ctrl.update([fullRight], 500, 1);
  assert.ok(p1.steer > 0.65, `Expected full lean + wheel tilt to give >0.65 steer, got ${p1.steer}`);
});

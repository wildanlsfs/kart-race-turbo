// Touch steering helpers (pure functions, unit-tested in Node).
// The steering pad maps the finger's horizontal position to a steer value in [-1, 1] and a
// smoother moves the steer value towards it, so a touch is proportional and not all-or-nothing.

export const PAD_DEADZONE = 0.08; // fraction of the half-width around the centre that means "straight"
export const PAD_FULL = 0.8; // finger this far from the centre (fraction of half-width) = full lock
export const RAMP_UP_RATE = 9; // 1/s: how fast steer follows a finger (about 0.1 s to 90 %)
export const RELEASE_RATE = 14; // 1/s: how fast steer returns to centre after lift (about 0.17 s to 90 %)
export const TAP_KICK = 0.35; // minimum |steer| in the first frame of a touch, so a quick tap still turns

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// x: finger x, rect: {left, width}. Returns target steer in [-1, 1].
export function padTarget(x, rect) {
  const half = rect.width / 2;
  if (!(half > 0)) return 0;
  const u = (x - (rect.left + half)) / half; // -1 .. 1 across the pad
  const a = Math.abs(u);
  if (a <= PAD_DEADZONE) return 0;
  const k = clamp((a - PAD_DEADZONE) / (PAD_FULL - PAD_DEADZONE), 0, 1);
  return Math.sign(u) * k;
}

// One smoothing step. active=false means no finger; target is ignored then.
// justPressed gives the tap kick so a tap is felt immediately.
export function stepSteer(value, target, active, dt, justPressed = false) {
  let v = value;
  if (active) {
    if (justPressed && target !== 0) {
      const kick = Math.sign(target) * Math.min(Math.abs(target), TAP_KICK);
      if (Math.abs(kick) > Math.abs(v) || Math.sign(kick) !== Math.sign(v)) v = kick;
    }
    v += (target - v) * Math.min(1, RAMP_UP_RATE * dt);
  } else {
    v += (0 - v) * Math.min(1, RELEASE_RATE * dt);
    if (Math.abs(v) < 0.01) v = 0;
  }
  return clamp(v, -1, 1);
}

// Full pad state machine used by main.js: pointer bookkeeping without DOM so it can be tested.
export class SteerPad {
  constructor() { this.pointerId = null; this.x = 0; this.rect = { left: 0, width: 1 }; this.value = 0; this.fresh = false; }
  press(id, x, rect) {
    if (this.pointerId !== null) return false; // one finger steers; extra fingers on the pad are ignored
    this.pointerId = id; this.x = x; this.rect = rect; this.fresh = true; return true;
  }
  move(id, x) { if (id === this.pointerId) this.x = x; }
  release(id) { if (id === this.pointerId) { this.pointerId = null; return true; } return false; }
  clear() { this.pointerId = null; this.value = 0; this.fresh = false; }
  get active() { return this.pointerId !== null; }
  // call once per frame
  update(dt) {
    const target = this.active ? padTarget(this.x, this.rect) : 0;
    this.value = stepSteer(this.value, target, this.active, dt, this.fresh);
    this.fresh = false;
    return this.value;
  }
  // 0..1 offset of the finger across the pad, for drawing the thumb marker
  get markerFraction() { return this.active ? clamp((this.x - this.rect.left) / this.rect.width, 0, 1) : 0.5; }
}

// ===== Virtual steering wheel (position control, +-60 deg) =====
export const WHEEL_LIMIT_DEG = 60;
export const WHEEL_RETURN_DEG_S = 320; // spring-back speed after release
export const KEY_TURN_DEG_S = 200; // keyboard: wheel turn speed towards +-60
export const KEY_RETURN_DEG_S = 320; // keyboard: return to centre on release

export const clampWheel = (deg) => clamp(deg, -WHEEL_LIMIT_DEG, WHEEL_LIMIT_DEG);
const wrapDeg = (d) => { while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

// Angle of a point around the wheel centre in degrees, 0 = straight up, clockwise positive (right turn).
export function pointerAngleDeg(x, y, cx, cy) {
  return (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
}

// Move `value` towards `target` by at most rate*dt (no overshoot).
export function approach(value, target, rate, dt) {
  const d = target - value;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : value + Math.sign(d) * step;
}

// Keyboard wheel: held direction turns the wheel at KEY_TURN_DEG_S up to the limit, release returns to centre.
export function stepKeyWheel(deg, dir, dt) {
  if (dir !== 0) return clampWheel(approach(deg, dir * WHEEL_LIMIT_DEG, KEY_TURN_DEG_S, dt));
  return approach(deg, 0, KEY_RETURN_DEG_S, dt);
}

// One finger drags the wheel around its centre: the wheel turns by the angle the finger sweeps (grab point stays
// under the finger), clamped to +-60 deg. A finger that goes on turning past the limit keeps the wheel at the limit;
// coming back unwinds it. Lift = the wheel springs back to centre. Pointer capture is handled by the caller.
export class WheelTouch {
  constructor() { this.pointerId = null; this.deg = 0; this.grabAngle = 0; this.grabDeg = 0; this.c = { cx: 0, cy: 0 }; this.lastAngle = 0; this.accum = 0; }
  press(id, x, y, c) {
    if (this.pointerId !== null) return false;
    this.pointerId = id; this.c = c;
    this.lastAngle = pointerAngleDeg(x, y, c.cx, c.cy);
    this.accum = this.deg; // continuous (unwrapped) wheel angle before clamping
    return true;
  }
  move(id, x, y) {
    if (id !== this.pointerId) return;
    const a = pointerAngleDeg(x, y, this.c.cx, this.c.cy);
    const d = wrapDeg(a - this.lastAngle);
    this.lastAngle = a;
    this.accum = clamp(this.accum + d, -WHEEL_LIMIT_DEG - 90, WHEEL_LIMIT_DEG + 90); // allow a little over-travel for unwinding
    this.deg = clampWheel(this.accum);
  }
  release(id) { if (id === this.pointerId) { this.pointerId = null; return true; } return false; }
  clear() { this.pointerId = null; this.deg = 0; this.accum = 0; }
  get active() { return this.pointerId !== null; }
  update(dt) {
    if (!this.active) this.deg = approach(this.deg, 0, WHEEL_RETURN_DEG_S, dt);
    else this.deg = clampWheel(this.deg);
    return this.deg;
  }
}

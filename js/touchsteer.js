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

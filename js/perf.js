// Pure performance helpers (no DOM, no three): unit-tested in Node.

export function median(values) {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Spatial cell key used to chunk static scenery so frustum culling still works on merged meshes.
export function cellKey(x, z, size) {
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

// Dynamic-resolution controller. Feed it every racing frame's raw frame time; it returns a new
// render scale when it wants a change, otherwise null.
//  - fps comes from the MEDIAN frame time of a sliding window (robust to hitches, unbiased by
//    the 1/dt averaging that skewed high before);
//  - steps down below downFps, up from upFps (gap = hysteresis, tablets at 50-56 fps recover);
//  - at most one change per cooldownMs, so the picture does not hunt;
//  - anti-hunt memory: if a step down follows a step up within huntMs, the scale we just left
//    becomes a ceiling for ceilingMs (resolution is not what limits fps there).
export class AdaptiveScale {
  constructor(opts = {}) {
    this.min = opts.min ?? 0.65;
    this.max = opts.max ?? 1;
    this.downFps = opts.downFps ?? 46;
    this.upFps = opts.upFps ?? 52;
    this.stepDown = opts.stepDown ?? 0.08;
    this.stepUp = opts.stepUp ?? 0.04;
    this.cooldownMs = opts.cooldownMs ?? 3000;
    this.windowSize = opts.windowSize ?? 45;
    this.warmupMs = opts.warmupMs ?? 1500;
    this.huntMs = opts.huntMs ?? 8000;
    this.ceilingMs = opts.ceilingMs ?? 30000;
    this.scale = opts.initial ?? this.max;
    this.reset();
  }

  reset() {
    this.frames = [];
    this.startMs = null;
    this.lastChangeMs = -Infinity;
    this.lastUpMs = -Infinity;
    this.ceiling = this.max;
    this.ceilingUntil = 0;
    this.holdMs = this.ceilingMs;
  }

  get fps() {
    const m = median(this.frames);
    return m > 0 ? 1000 / m : 0;
  }

  update(dtMs, nowMs) {
    if (this.startMs === null) this.startMs = nowMs;
    // ignore absurd pauses (tab hidden, debugger) rather than treating them as slow frames
    if (dtMs > 0 && dtMs < 500) {
      this.frames.push(dtMs);
      if (this.frames.length > this.windowSize) this.frames.shift();
    }
    if (nowMs - this.startMs < this.warmupMs || this.frames.length < this.windowSize * 0.6) return null;
    if (nowMs - this.lastChangeMs < this.cooldownMs) return null;
    if (nowMs > this.ceilingUntil) this.ceiling = this.max;

    const fps = this.fps;
    let next = this.scale;
    if (fps < this.downFps && this.scale > this.min) {
      next = Math.max(this.min, this.scale - this.stepDown);
      if (nowMs - this.lastUpMs < this.huntMs) {
        this.ceiling = next;
        this.ceilingUntil = nowMs + this.holdMs;
        this.holdMs = Math.min(this.holdMs * 2, 300000); // repeated hunting backs off exponentially
      }
    } else if (fps >= this.upFps && this.scale < this.ceiling) {
      next = Math.min(this.ceiling, this.scale + this.stepUp);
      this.lastUpMs = nowMs;
    }
    next = Math.round(next * 100) / 100;
    if (next === this.scale) return null;
    this.scale = next;
    this.lastChangeMs = nowMs;
    this.frames.length = 0; // measure the new setting from scratch
    return next;
  }
}

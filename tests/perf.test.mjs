import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveScale, median, cellKey } from '../js/perf.js';

// Drive the controller with a frame-time model; returns the trace of [timeMs, scale] changes.
function run(ctrl, ms, frameMsFn, t0 = 0) {
  const trace = [];
  let t = t0;
  const end = t0 + ms;
  while (t < end) {
    const dt = frameMsFn(t, ctrl.scale);
    t += dt;
    const s = ctrl.update(dt, t);
    if (s !== null) trace.push([Math.round(t), s]);
  }
  return { trace, t };
}

test('median and cellKey basics', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(cellKey(0, 0, 100), '0,0');
  assert.equal(cellKey(-1, 250, 100), '-1,2');
});

test('steady 60 fps never changes the scale', () => {
  const c = new AdaptiveScale();
  const { trace } = run(c, 30000, () => 16.7);
  assert.equal(trace.length, 0);
  assert.equal(c.scale, 1);
});

test('slow frames step down, at most one step per cooldown, never below the floor', () => {
  const c = new AdaptiveScale();
  const { trace } = run(c, 40000, () => 33); // 30 fps regardless of scale
  assert.ok(trace.length >= 3);
  for (let i = 1; i < trace.length; i++) assert.ok(trace[i][0] - trace[i - 1][0] >= 3000, 'cooldown respected');
  assert.equal(c.scale, 0.65);
  assert.ok(trace.every(([, s]) => s >= 0.65));
});

test('a tablet at 50-56 fps recovers resolution (old rule needed > 57)', () => {
  const c = new AdaptiveScale({ initial: 0.73 });
  run(c, 30000, () => 1000 / 54);
  assert.equal(c.scale, 1);
});

test('inside the hysteresis band (46-52 fps) the scale holds', () => {
  const c = new AdaptiveScale({ initial: 0.81 });
  const { trace } = run(c, 30000, () => 1000 / 49);
  assert.equal(trace.length, 0);
});

test('fps that scales with resolution settles without hunting, then recovers when load drops', () => {
  const c = new AdaptiveScale();
  const heavy = (t, s) => 8 + 22 * s * s; // 1.0 -> 30 ms, 0.65 -> 17.3 ms
  const a = run(c, 30000, heavy);
  assert.ok(c.scale < 1 && c.scale >= 0.65);
  const late = a.trace.filter(([t]) => t > 15000);
  assert.ok(late.length <= 2, 'no hunting once settled: ' + JSON.stringify(a.trace));
  const b = run(c, 40000, (t, s) => 4 + 10 * s * s, a.t); // load drops
  assert.equal(c.scale, 1, JSON.stringify(b.trace));
});

test('cpu-bound case (resolution does not help) does not oscillate: ceiling is learned', () => {
  const c = new AdaptiveScale();
  const model = (t, s) => (t < 20000 ? 25 : s > 0.8 ? 25 : 1000 / 55);
  const { trace } = run(c, 120000, model);
  const late = trace.filter(([t]) => t > 60000);
  assert.ok(late.length <= 4, 'few changes late in the run: ' + JSON.stringify(trace));
});

test('a game that drops every third frame (stutter) counts as slow even though the median frame is fast', () => {
  const c = new AdaptiveScale();
  let n = 0;
  const { trace } = run(c, 15000, () => (++n % 3 === 0 ? 50 : 16.7)); // mean 27.8 ms = 36 fps
  assert.ok(trace.length >= 1 && trace[0][1] < 1);
});

test('hitches (single long frames) do not move the scale', () => {
  const c = new AdaptiveScale();
  let n = 0;
  const { trace } = run(c, 30000, () => (++n % 40 === 0 ? 300 : 16.7));
  assert.equal(trace.length, 0);
});

test('reset clears the window (new race starts clean)', () => {
  const c = new AdaptiveScale();
  run(c, 10000, () => 33);
  c.reset();
  assert.equal(c.fps, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFraming, checkAllFraming, guideFor, FRAMING } from '../js/framing.js';
import { makeSyntheticPose } from '../js/motion.js';

// A player at display x `dx` (preview, mirrored), shoulder width sw, shoulders at shY, hands gripping a wheel.
function person(dx, sw, shY, { hands = true } = {}) {
  const p = makeSyntheticPose({ centerX: 1 - dx, shoulderY: shY, shoulderWidth: sw });
  const wy = shY + sw * 0.9;
  p.landmarks[15] = { x: 1 - dx + sw * 0.6, y: hands ? wy : 0.99, z: -0.1, visibility: 0.99 };
  p.landmarks[16] = { x: 1 - dx - sw * 0.6, y: hands ? wy : 0.99, z: -0.1, visibility: 0.99 };
  return p;
}
const codes = (r) => r.issues.map((i) => i.code);

test('Framing 1P: the guide silhouette itself is a pass (the frame is achievable)', () => {
  const g = guideFor(1);
  assert.deepEqual(checkFraming(person(g.cx, g.sw, g.shY), 1, 0, 120).issues, []);
});
test('Framing 1P: the real play-log posture (shoulders 0.37 wide) is told to move back', () => {
  const r = checkFraming(person(0.5, 0.37, 0.42), 1, 0);
  assert.ok(codes(r).includes('close'), codes(r).join());
});
test('Framing 1P: too far, off-centre both ways, hands missing, too dark', () => {
  assert.ok(codes(checkFraming(person(0.5, 0.12, 0.36), 1)).includes('far'));
  assert.ok(codes(checkFraming(person(0.25, 0.27, 0.36), 1)).includes('left'));
  assert.ok(codes(checkFraming(person(0.75, 0.27, 0.36), 1)).includes('right'));
  assert.ok(codes(checkFraming(person(0.5, 0.27, 0.36, { hands: false }), 1)).includes('hands'));
  assert.ok(codes(checkFraming(person(0.5, 0.27, 0.36), 1, 0, 30)).includes('dark'));
  assert.ok(codes(checkFraming(null, 1)).includes('missing'));
});
test('Framing 2P: both guide silhouettes pass together, and each player is judged on their own half', () => {
  const g1 = guideFor(2, 0), g2 = guideFor(2, 1);
  assert.ok(g1.cx < 0.5 && g2.cx > 0.5, 'player 1 left, player 2 right on the preview');
  const ok = checkAllFraming([person(g2.cx, g2.sw, g2.shY), person(g1.cx, g1.sw, g1.shY)], 2, 120);
  assert.equal(ok.ok, true, ok.issues.map((i) => i.text).join('; '));
  // player 2 sitting too close and player 1 fine: only player 2 is flagged, by name
  const bad = checkAllFraming([person(g1.cx, g1.sw, g1.shY), person(g2.cx, 0.3, g2.shY)], 2);
  assert.equal(bad.perSlot[0].ok, true);
  assert.ok(bad.perSlot[1].issues.some((i) => i.code === 'close' && i.text.startsWith('Player 2')));
});
test('Framing 2P: one player missing names the missing seat; both standing in the middle are told to separate', () => {
  const g1 = guideFor(2, 0);
  const one = checkAllFraming([person(g1.cx, g1.sw, g1.shY)], 2);
  assert.equal(one.ok, false);
  assert.ok(one.issues.some((i) => i.code === 'missing' && i.text.startsWith('Player 2')));
  const mid = checkAllFraming([person(0.42, 0.18, 0.4), person(0.58, 0.18, 0.4)], 2);
  assert.equal(mid.ok, false);
});
test('Framing: ideal widths leave room for the hands below the shoulders in both modes', () => {
  for (const n of [1, 2]) { const g = guideFor(n); assert.ok(g.shY + g.sw * 1.7 < 0.98, `mode ${n}`); assert.ok(g.sw >= FRAMING[n].swMin && g.sw <= FRAMING[n].swMax); }
});

import { wheelButtons } from '../js/wheelgeom.js';
test('Imaginary buttons: in 2P the neighbours\' NOS and FIRE never touch, and each button stays inside the picture, in both modes', () => {
  const g1 = guideFor(2, 0), g2 = guideFor(2, 1);
  const b1 = wheelButtons(1 - g1.cx, g1.shY, g1.sw), b2 = wheelButtons(1 - g2.cx, g2.shY, g2.sw);
  // image space: P1 is on the image's right (mirrored preview), so the pair that faces each other is P1.nos / P2.fire in display terms
  const pairs = [[b1.nos, b2.fire], [b1.fire, b2.nos]];
  for (const [a, b] of pairs) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > (a.r + b.r) * 1.2, 'neighbouring buttons overlap');
  for (const [n, slots] of [[1, [0]], [2, [0, 1]]]) for (const s of slots) {
    const g = guideFor(n, s), b = wheelButtons(1 - g.cx, g.shY, g.sw);
    for (const k of [b.nos, b.fire]) assert.ok(k.x - k.r > 0 && k.x + k.r < 1 && k.y - k.r > 0 && k.y + k.r < 1, `mode ${n} slot ${s}: button off the picture`);
  }
});

import { LIGHT } from '../js/cam-light.js';
test('Framing: dim light gives a soft hint that never blocks "ok"; dark stays a blocking issue', () => {
  const g = guideFor(1);
  const p = person(g.cx, g.sw, g.shY);
  const dim = checkAllFraming([p], 1, LIGHT.dim - 5);
  assert.equal(dim.ok, true);
  assert.ok(dim.hints.some((h) => h.code === 'dim' && h.soft));
  assert.ok(!dim.issues.some((i) => i.code === 'dark'));
  const dark = checkAllFraming([p], 1, 40);
  assert.equal(dark.ok, false);
  assert.ok(dark.issues.some((i) => i.code === 'dark'));
  assert.equal(dark.hints.length, 0, 'dark replaces dim');
  assert.equal(checkAllFraming([p], 1, LIGHT.dim + 5).hints.length, 0);
  assert.equal(checkAllFraming([p], 1, null).hints.length, 0);
});
test('Framing 2P: dim hint appears once, without a player prefix', () => {
  const g1 = guideFor(2, 0), g2 = guideFor(2, 1);
  const r = checkAllFraming([person(g1.cx, g1.sw, g1.shY), person(g2.cx, g2.sw, g2.shY)], 2, 70);
  assert.equal(r.ok, true);
  assert.equal(r.hints.filter((h) => h.code === 'dim').length, 1);
  assert.ok(!/^Player/.test(r.hints[0].text));
});

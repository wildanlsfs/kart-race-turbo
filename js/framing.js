// Ideal camera framing for webcam steering. Pure functions (no DOM) so the rules are unit-tested.
// Coordinates: MediaPipe image space (x,y in 0..1, NOT mirrored). The preview is mirrored, so "display x" = 1 - x and
// all left/right wording below is in what the player sees on the preview.
//
// Why these numbers (measured from a real play log): shoulders ~0.37 of the frame wide put the hands below the
// bottom edge for 7 % of the frames, and an out-of-frame wrist keeps a high visibility score while its position is
// a guess (it jumped 1.0 shoulder-widths in one frame). So the rule is "everything needed to grip a wheel fits".

export const FRAMING = {
  1: { // one player, centred
    zones: [{ cx: 0.5, tolX: 0.13 }],
    swMin: 0.18, swMax: 0.34, shYMin: 0.16, shYMax: 0.5, guideSw: 0.27, guideShY: 0.40,
  },
  2: { // two players side by side, each in their half (P1 left on the preview, P2 right)
    zones: [{ cx: 0.27, tolX: 0.11 }, { cx: 0.73, tolX: 0.11 }],
    swMin: 0.12, swMax: 0.24, shYMin: 0.16, shYMax: 0.55, guideSw: 0.18, guideShY: 0.40,
  },
};
const HANDS_BELOW_SHOULDERS = 1.7; // wheel grip sits ~0.9 shoulder-widths below the shoulders; keep margin to the edge
const EDGE = 0.98;
const wristSeen = (w) => w && (w.visibility === undefined || w.visibility > 0.5);
const inFrame = (w) => w.x > 0.02 && w.x < 0.98 && w.y > 0.02 && w.y < EDGE;

// The target silhouette for a slot, in display coordinates: where head, shoulders and the two wheel-grip hands go.
export function guideFor(playerCount, slot = 0) {
  const f = FRAMING[playerCount === 2 ? 2 : 1];
  const z = f.zones[slot] || f.zones[0];
  const sw = f.guideSw, shY = f.guideShY;
  return {
    cx: z.cx, shY, sw,
    head: { x: z.cx, y: shY - sw * 0.75, r: sw * 0.48 },
    leftShoulder: { x: z.cx - sw / 2, y: shY }, rightShoulder: { x: z.cx + sw / 2, y: shY },
    leftHand: { x: z.cx - sw * 0.62, y: shY + sw * 0.9 }, rightHand: { x: z.cx + sw * 0.62, y: shY + sw * 0.9 },
    box: { x0: z.cx - sw * 1.15, x1: z.cx + sw * 1.15, y0: shY - sw * 1.2, y1: shY + sw * 1.45 },
  };
}

// Judge one player's pose for a slot. Returns { ok, issues: [{ code, text }] }. `pose` is a landmark array (or {landmarks}).
export function checkFraming(pose, playerCount = 1, slot = 0, brightness = null) {
  const f = FRAMING[playerCount === 2 ? 2 : 1];
  const who = playerCount === 2 ? `Player ${slot + 1}: ` : '';
  const issues = [];
  const add = (code, text) => issues.push({ code, text: who + text });
  const lm = pose && (Array.isArray(pose) ? pose : pose.landmarks);
  if (!lm || lm.length < 17 || !lm[11] || !lm[12]) {
    add('missing', playerCount === 2 ? 'step into your side of the picture' : 'step in front of the camera');
    return { ok: false, issues };
  }
  const ls = lm[11], rs = lm[12], lw = lm[15], rw = lm[16];
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const dispCx = 1 - (ls.x + rs.x) / 2;
  const shY = (ls.y + rs.y) / 2;
  const z = f.zones[slot] || f.zones[0];

  if (brightness !== null && brightness < 55) add('dark', 'too dark, face a lamp or window');
  if (sw < f.swMin) add('far', 'move closer to the camera');
  else if (sw > f.swMax || shY + HANDS_BELOW_SHOULDERS * sw > EDGE + 0.04) add('close', 'move back a little so your hands fit');
  if (dispCx < z.cx - z.tolX) add('left', 'move to the right on the preview');
  else if (dispCx > z.cx + z.tolX) add('right', 'move to the left on the preview');
  if (shY < f.shYMin) add('high', 'tilt the camera up or sit lower');
  else if (shY > f.shYMax) add('low', 'tilt the camera down or sit higher');
  if (!wristSeen(lw) || !wristSeen(rw) || !inFrame(lw) || !inFrame(rw)) add('hands', 'hold both hands up in front of you, as if gripping a wheel');
  return { ok: issues.length === 0, issues };
}

// Judge everyone needed for the mode. Poses are assigned to slots by position (left on the preview = slot 0 = player 1).
export function checkAllFraming(poses, playerCount = 1, brightness = null) {
  const lmOf = (p) => (p && (Array.isArray(p) ? p : p.landmarks)) || null;
  const list = (poses || []).map(lmOf).filter((l) => l && l[11] && l[12]);
  if (playerCount !== 2) {
    if (!list.length) return { ok: false, perSlot: [checkFraming(null, 1, 0, brightness)], issues: checkFraming(null, 1, 0).issues };
    // the player closest to the middle with the widest shoulders is the driver
    const best = [...list].sort((a, b) => score(b) - score(a))[0];
    const r = checkFraming(best, 1, 0, brightness);
    return { ok: r.ok, perSlot: [r], issues: r.issues };
  }
  const byX = [...list].sort((a, b) => (1 - (a[11].x + a[12].x) / 2) - (1 - (b[11].x + b[12].x) / 2)); // left to right on the preview
  let slots = [null, null];
  if (byX.length >= 2) slots = [byX[0], byX[byX.length - 1]];
  else if (byX.length === 1) { const d = 1 - (byX[0][11].x + byX[0][12].x) / 2; slots[d < 0.5 ? 0 : 1] = byX[0]; }
  const perSlot = slots.map((p, i) => checkFraming(p, 2, i, brightness));
  return { ok: perSlot.every((r) => r.ok), perSlot, issues: perSlot.flatMap((r) => r.issues) };
}
const score = (l) => Math.hypot(l[11].x - l[12].x, l[11].y - l[12].y) - Math.abs(1 - (l[11].x + l[12].x) / 2 - 0.5) * 0.35;

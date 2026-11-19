// Geometry of the imaginary controls, shared by the motion reader (what counts as a press) and the drawing code
// (what the player sees). Everything is relative to the player's own shoulders, in image space (x,y in 0..1, NOT
// mirrored), so sitting nearer, further or off-centre never moves a button away from the body.
//
// Image space is what the camera sees: the player's RIGHT hand (landmark 16) is on the image's left (smaller x).
// NOS is on the player's right, FIRE on the player's left, so each is pressed by the hand that is closest to it.
export const BTN_DX = 0.95;   // sideways from the shoulder midpoint, in shoulder-widths: in 2P one player's NOS and the neighbour's FIRE must not touch
export const BTN_DY = -0.45;  // ABOVE the shoulder line: a wheel grip (hands on a circle below the chest) never reaches it
export const BTN_R = 0.25;    // button radius in shoulder-widths
export const BTN_HOLD_MS = 150; // a hand must stay on a button this long (no accidental triggers)
export const WHEEL_DEFAULT = { dx: 0, dy: 0.9, r: 0.6 }; // wheel centre / radius (shoulder-widths) before the hands show them

export function wheelButtons(shMidX, shMidY, sw) {
  const y = shMidY + sw * BTN_DY, r = sw * BTN_R, dx = sw * BTN_DX;
  return { nos: { x: shMidX - dx, y, r }, fire: { x: shMidX + dx, y, r } };
}

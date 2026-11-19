import { BTN_HOLD_MS, WHEEL_DEFAULT, wheelButtons } from './wheelgeom.js';
// One-Euro Filter + Webcam Pose-to-Kart Motion Controller
// Works with laptop webcams where only upper body (head, shoulders, hands) is visible,
// as well as full-body standing play, for both 1-Player and 2-Player Split-Screen.

export class OneEuroFilter {
  constructor(minCutoff = 1.4, beta = 0.04, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / Math.max(dt, 1e-4));
  }

  filter(x, tSec) {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(1e-4, tSec - this.tPrev);
    this.tPrev = tSec;

    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = this.dxPrev === null ? dx : aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const aX = this.alpha(cutoff, dt);
    const xHat = aX * x + (1 - aX) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }
}

const WHEEL_MAX_DEG = 90;
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Angle (degrees) of the line through the two hands, positive when the driver's right hand is lower
// (= wheel turned clockwise = right turn). The horizontal span is the real one (it shrinks as the wheel
// turns); it is floored only to stop two hands held on top of each other from producing noise.
function handLineDeg(lw, rw, sw) {
  const spanX = Math.max(Math.abs(rw.x - lw.x), sw * 0.25);
  return (Math.atan2(rw.y - lw.y, spanX) * 180) / Math.PI;
}

function createSlotState() {
  return {
    calibrated: false,
    autoCalibSamples: [],
    neutralX: 0.5,
    neutralNoseX: 0.5,
    neutralShoulderY: 0.44,
    neutralWheelDeg: 0,
    rawHist: [], // last raw hand-line angles (median-of-5 rejects 1-2 frame landmark glitches)
    lastRawM: null,
    spanRef: null, // wrist-to-wrist distance while holding the wheel (constant for a rigid wheel)
    spanBad: 0,
    lastWheelTilt: 0,
    slewRaw: null,
    shDeg: null, // slow estimate of the shoulder-line angle (camera tilt); 0 deg of the wheel is measured against it
    wheelC: { ...WHEEL_DEFAULT }, // wheel centre/radius in shoulder-widths, learned from the grip
    mode: 0, badMs: 0, nosMs: 0, fireMs: 0, fireHeld: false, hud: null,
    shoulderWidth: 0.18,
    lastSeenMs: -9999,
    lastSteer: 0,
    lastEvalSec: null,
    lastThrottle: 0,
    brakeStartMs: null,
    lastPunchMs: -9999,
    prevLeftReach: 0,
    prevRightReach: 0,
    prevLeftWrist: null,
    prevRightWrist: null,
    // Responsive but steady: a deliberate wheel turn must show within ~100 ms (a low beta made the
    // wheel crawl for ~0.4 s), while jitter on a held hand is still smoothed by the low cutoff.
    steerFilter: new OneEuroFilter(1.6, 0.9),
    yFilter: new OneEuroFilter(1.5, 0.05),
    wheelAngleDeg: 0,
    poseLabel: 'READY',
  };
}

export function makeSyntheticPose({
  centerX = 0.5,
  shoulderY = 0.42,
  shoulderWidth = 0.2,
  leanRight = 0,
  wheelTiltRight = 0,
  handsUp = false,
  crouch = false,
  jump = false,
  rightPunch = false,
  leftPunch = false,
  handsDown = false,
  nosPress = false, // player's right hand on the NOS button
  firePress = false, // player's left hand on the FIRE button
} = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: centerX, y: 0.5, z: 0, visibility: 0.99 }));
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.99 }));

  const yOffset = crouch ? shoulderWidth * 0.52 : jump ? -shoulderWidth * 0.52 : 0;
  const leanShiftRawX = -leanRight * shoulderWidth * 0.45;
  const shMidX = centerX + leanShiftRawX;
  const shMidY = shoulderY + yOffset;

  lm[0] = { x: shMidX, y: shMidY - shoulderWidth * 0.75, z: -0.05, visibility: 0.99 };
  lm[11] = { x: shMidX + shoulderWidth * 0.5, y: shMidY, z: 0, visibility: 0.99 };
  lm[12] = { x: shMidX - shoulderWidth * 0.5, y: shMidY, z: 0, visibility: 0.99 };
  lm[23] = { x: centerX + shoulderWidth * 0.35, y: shoulderY + shoulderWidth * 1.35 + (crouch ? shoulderWidth * 0.3 : 0), z: 0, visibility: 0.99 };
  lm[24] = { x: centerX - shoulderWidth * 0.35, y: shoulderY + shoulderWidth * 1.35 + (crouch ? shoulderWidth * 0.3 : 0), z: 0, visibility: 0.99 };

  const tiltDeltaY = wheelTiltRight * shoulderWidth * 0.45;
  let lwX = shMidX + shoulderWidth * 0.55;
  let rwX = shMidX - shoulderWidth * 0.55;
  let lwY = shMidY + shoulderWidth * 0.15 - tiltDeltaY;
  let rwY = shMidY + shoulderWidth * 0.15 + tiltDeltaY;
  let lwZ = -0.12;
  let rwZ = -0.12;

  if (handsUp) {
    lwY = shMidY - shoulderWidth * 0.95;
    rwY = shMidY - shoulderWidth * 0.95;
  } else if (crouch) {
    lwX = shMidX + shoulderWidth * 0.14;
    rwX = shMidX - shoulderWidth * 0.14;
    lwY = shMidY + shoulderWidth * 0.18;
    rwY = shMidY + shoulderWidth * 0.18;
  } else if (handsDown) {
    lwY = shMidY + shoulderWidth * 1.3;
    rwY = shMidY + shoulderWidth * 1.3;
  }

  if (rightPunch) {
    rwZ = -0.48;
    rwY = shMidY + shoulderWidth * 0.05;
    lwY = shMidY + shoulderWidth * 0.12;
  }
  if (leftPunch) {
    lwZ = -0.48;
    lwY = shMidY + shoulderWidth * 0.05;
    rwY = shMidY + shoulderWidth * 0.12;
  }

  if (nosPress || firePress) {
    const b = wheelButtons(shMidX, shMidY, shoulderWidth);
    if (nosPress) { rwX = b.nos.x; rwY = b.nos.y; }
    if (firePress) { lwX = b.fire.x; lwY = b.fire.y; }
  }
  lm[15] = { x: lwX, y: lwY, z: lwZ, visibility: 0.99 };
  lm[16] = { x: rwX, y: rwY, z: rwZ, visibility: 0.99 };

  world[11] = { x: 0.18, y: 0, z: 0, visibility: 0.99 };
  world[12] = { x: -0.18, y: 0, z: 0, visibility: 0.99 };
  world[15] = { x: 0.2, y: -0.05, z: leftPunch ? -0.48 : -0.15, visibility: 0.99 };
  world[16] = { x: -0.2, y: -0.05, z: rightPunch ? -0.48 : -0.15, visibility: 0.99 };

  return { landmarks: lm, worldLandmarks: world };
}

function normalizePoseObj(raw) {
  if (!raw) return null;
  const lm = Array.isArray(raw) ? raw : raw.landmarks;
  if (!lm || lm.length < 17) return null;
  const ls = lm[11];
  const rs = lm[12];
  if (!ls || !rs) return null;
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (sw < 0.03) return null;
  return {
    landmarks: lm,
    worldLandmarks: raw.worldLandmarks || null,
    centerX: (ls.x + rs.x) * 0.5,
    shoulderY: (ls.y + rs.y) * 0.5,
    shoulderWidth: sw,
  };
}

export class MotionController {
  constructor({ autoGas = true, dropoutMs = 400 } = {}) {
    this.autoGas = autoGas;
    this.dropoutMs = dropoutMs;
    this.slots = [createSlotState(), createSlotState()];
  }

  setAutoGas(enabled) {
    this.autoGas = Boolean(enabled);
  }

  calibrate(rawPoses = [], playerCount = 1) {
    const valid = rawPoses.map(normalizePoseObj).filter(Boolean);
    if (valid.length === 0) return false;

    if (playerCount === 1) {
      valid.sort((a, b) => {
        const scoreA = a.shoulderWidth - Math.abs(a.centerX - 0.5) * 0.35;
        const scoreB = b.shoulderWidth - Math.abs(b.centerX - 0.5) * 0.35;
        return scoreB - scoreA;
      });
      this._calibrateSlot(this.slots[0], valid[0]);
      return true;
    }

    if (valid.length >= 2) {
      valid.sort((a, b) => b.centerX - a.centerX);
      this._calibrateSlot(this.slots[0], valid[0]);
      this._calibrateSlot(this.slots[1], valid[1]);
      return true;
    }

    const p = valid[0];
    if (p.centerX >= 0.5) {
      this._calibrateSlot(this.slots[0], p);
    } else {
      this._calibrateSlot(this.slots[1], p);
    }
    return true;
  }

  _calibrateSlot(slot, pose) {
    slot.calibrated = true;
    slot.autoCalibSamples = [];
    slot.neutralX = pose.centerX;
    slot.neutralNoseX = pose.landmarks?.[0]?.x ?? pose.centerX;
    slot.neutralShoulderY = pose.shoulderY;
    slot.shoulderWidth = Math.max(0.08, pose.shoulderWidth);
    {
      const w1 = pose.landmarks?.[15];
      const w2 = pose.landmarks?.[16];
      const ok = (w) => w && (w.visibility === undefined || w.visibility > 0.35);
      // The hands' angle at calibration is the straight-ahead position of the wheel.
      // Calibration usually happens while the hands are still resting, so that angle is only a hint: trusted up to
      // +-10 deg and then corrected continuously while playing (see the drift below).
      const a0 = ok(w1) && ok(w2) ? handLineDeg(w1, w2, Math.max(0.08, pose.shoulderWidth)) : 0;
      slot.neutralWheelDeg = clamp(a0, -10, 10);
    }
    slot.steerFilter.reset();
    slot.rawHist = []; slot.lastRawM = null; slot.spanRef = null; slot.spanBad = 0; slot.lastWheelTilt = 0; slot.slewRaw = null; slot.shDeg = null; slot.mode = 0; slot.badMs = 0; slot.wheelC = { ...WHEEL_DEFAULT };
    slot.yFilter.reset();
    slot.brakeStartMs = null;
  }

  _matchPosesToSlots(validPoses, playerCount) {
    if (playerCount === 1) {
      if (validPoses.length === 0) return [null];
      const slot = this.slots[0];
      if (!slot.calibrated) {
        this._calibrateSlot(slot, validPoses[0]);
        return [validPoses[0]];
      }
      let best = null;
      let bestDist = Infinity;
      for (const p of validPoses) {
        const d = Math.abs(p.centerX - slot.neutralX);
        if (d < bestDist && d < 0.44) {
          bestDist = d;
          best = p;
        }
      }
      return [best || validPoses[0]];
    }

    const anchors = [
      this.slots[0].calibrated ? this.slots[0].neutralX : 0.70,
      this.slots[1].calibrated ? this.slots[1].neutralX : 0.30,
    ];
    const matched = [null, null];
    const used = new Set();

    for (let s = 0; s < 2; s++) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < validPoses.length; i++) {
        if (used.has(i)) continue;
        const d = Math.abs(validPoses[i].centerX - anchors[s]);
        if (d < bestDist && d < 0.36) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx !== -1) {
        used.add(bestIdx);
        matched[s] = validPoses[bestIdx];
        if (!this.slots[s].calibrated) {
          this._calibrateSlot(this.slots[s], validPoses[bestIdx]);
        }
      }
    }
    return matched;
  }

  update(rawPoses = [], nowMs = performance.now(), playerCount = 1) {
    const valid = rawPoses.map(normalizePoseObj).filter(Boolean);
    const matched = this._matchPosesToSlots(valid, playerCount);
    const out = [];
    const count = playerCount === 2 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      out.push(this._evalSlot(this.slots[i], matched[i], nowMs));
    }
    return out;
  }

  _evalSlot(slot, pose, nowMs) {
    const tSec = nowMs / 1000;
    if (!pose) {
      slot.dbg = { pose: 0 }; slot.hud = null; slot.nosMs = 0; slot.fireMs = 0;
      const alive = (nowMs - slot.lastSeenMs) <= this.dropoutMs;
      return {
        throttle: alive ? slot.lastThrottle : 0,
        brake: false,
        reverse: false,
        steer: alive ? slot.lastSteer : 0,
        turbo: false,
        attack: false,
        hop: false,
        calibrated: slot.calibrated,
        visible: alive,
        wheelAngleDeg: alive ? slot.wheelAngleDeg : 0,
        poseLabel: alive ? 'HOLD' : 'NO PLAYER',
      };
    }

    slot.lastSeenMs = nowMs;
    const dbg = slot.dbg = { pose: 1 }; // per-frame decision record for the camera log (?debug)
    const lm = pose.landmarks;
    const sw = Math.max(0.08, pose.shoulderWidth);
    const shMidX = pose.centerX;
    const shMidY = slot.yFilter.filter(pose.shoulderY, tSec);

    const ls = lm[11];
    const rs = lm[12];
    const lw = lm[15];
    const rw = lm[16];
    const lh = lm[23];
    const rh = lm[24];
    const nose = lm[0];

    // Wrists must be seen AND inside the picture: a wrist the model places below the frame keeps a high visibility
    // score while its position is a guess (log: it jumped a full shoulder-width in one frame).
    const inFrame = (w) => w.x > 0.02 && w.x < 0.98 && w.y > 0.02 && w.y < 0.98;
    const wristVis = (w) => w && (w.visibility === undefined || w.visibility > 0.35) && inFrame(w);
    const lwOk = wristVis(lw);
    const rwOk = wristVis(rw);
    const dtAdapt = Math.min(0.1, Math.max(0.001, slot.lastEvalSec == null ? 0.033 : tSec - slot.lastEvalSec));

    // Body lean (fallback only, used when both wrists are lost): shoulder shift against the calibrated centre + head + shoulder tilt.
    if (Math.abs(slot.lastSteer) < 0.05 && Math.abs(slot.neutralX - shMidX) < sw * 0.10) {
      const k = Math.min(1, 0.25 * dtAdapt);
      slot.neutralX += (shMidX - slot.neutralX) * k;
      if (nose) slot.neutralNoseX = (slot.neutralNoseX ?? slot.neutralX) + (nose.x - (slot.neutralNoseX ?? slot.neutralX)) * k;
    }
    const shoulderShiftRight = clamp((slot.neutralX - shMidX) / (sw * 0.36), -1, 1);
    const headShiftRight = nose ? clamp(((slot.neutralNoseX ?? slot.neutralX) - nose.x) / (sw * 0.40), -1, 1) : shoulderShiftRight;
    const hipMidX = (lh && rh) ? (lh.x + rh.x) * 0.5 : shMidX;
    const torsoLeanRight = clamp((hipMidX - shMidX) / (sw * 0.34), -1, 1);
    const shoulderTiltRight = clamp((rs.y - ls.y) / (sw * 0.28), -1, 1);
    const upperLean = Math.abs(shoulderShiftRight) >= Math.abs(torsoLeanRight) ? shoulderShiftRight : torsoLeanRight;
    const bodyLeanRight = clamp(upperLean * 0.62 + headShiftRight * 0.25 + shoulderTiltRight * 0.25, -1, 1);

    // 1. IMAGINARY BUTTONS: NOS (player's right) and FIRE (player's left). A hand that stays on a button for
    // BTN_HOLD_MS presses it; the other hand keeps steering. NOS is held; FIRE fires once per press.
    const btn = wheelButtons(shMidX, shMidY, sw);
    const onBtn = (w, b) => Math.hypot(w.x - b.x, w.y - b.y) < b.r;
    const rOnNos = rwOk && onBtn(rw, btn.nos);
    const lOnFire = lwOk && onBtn(lw, btn.fire);
    slot.nosMs = rOnNos ? slot.nosMs + dtAdapt * 1000 : 0;
    slot.fireMs = lOnFire ? slot.fireMs + dtAdapt * 1000 : 0;
    const turbo = slot.nosMs >= BTN_HOLD_MS;
    const fireDown = slot.fireMs >= BTN_HOLD_MS;
    let attack = false;
    if (fireDown && !slot.fireHeld && nowMs - slot.lastPunchMs > 320) { attack = true; slot.lastPunchMs = nowMs; }
    slot.fireHeld = fireDown;
    const jumped = (slot.neutralShoulderY - shMidY) > sw * 0.28;
    const hop = Boolean(jumped);

    // 2. BRAKE / REVERSE: crouch (shoulders drop) OR both hands pulled tight to the chest
    const crouched = (shMidY - slot.neutralShoulderY) > sw * 0.32;
    const wristsDistance = (lwOk && rwOk) ? Math.hypot(lw.x - rw.x, lw.y - rw.y) : sw;
    const handsPulledChest = !turbo && !attack && lwOk && rwOk &&
      wristsDistance < sw * 0.42 &&
      Math.abs(((lw.y + rw.y) * 0.5) - (shMidY + sw * 0.18)) < sw * 0.36;
    const brake = Boolean(!attack && !turbo && (crouched || handsPulledChest));
    if (brake) {
      if (slot.brakeStartMs === null) slot.brakeStartMs = nowMs;
    } else {
      slot.brakeStartMs = null;
    }
    const reverse = Boolean(brake && slot.brakeStartMs !== null && (nowMs - slot.brakeStartMs >= 380));

    // 3. STEERING. Straight ahead is 0 degrees measured against the player's own shoulder line (so a tilted laptop
    // never matters and there is nothing to calibrate). The wheel is read from the hands that are gripping it:
    //   two hands  -> angle of the line between them;
    //   one hand   -> angle of that hand around the wheel centre remembered from when both were on it
    //                 (the other hand is pressing NOS/FIRE, or was lost);
    //   no hands   -> the wheel is let go: it returns to 0.
    const inZone = (w) => w.y > shMidY - sw * 0.6 && w.y < shMidY + sw * 2.2;
    const lGrip = lwOk && !lOnFire && inZone(lw);
    const rGrip = rwOk && !rOnNos && inZone(rw);
    const mode = lGrip && rGrip ? 2 : (lGrip || rGrip ? 1 : 0);
    const shDegNow = clamp(handLineDeg(ls, rs, sw), -15, 15);
    slot.shDeg = slot.shDeg === null ? shDegNow : slot.shDeg + (shDegNow - slot.shDeg) * Math.min(1, 0.7 * dtAdapt); // slow: a camera tilt, not a lean
    slot.lastEvalSec = tSec;
    const wc = slot.wheelC;
    const cx = shMidX + wc.dx * sw, cy = shMidY + wc.dy * sw, cr = wc.r * sw;
    const wheelVis = (w) => w.visibility === undefined || w.visibility > 0.5;
    let wheelTiltRight = 0;
    let holding = false;
    let rawNow = null;
    let trusted = false;
    if (mode !== slot.mode) { slot.rawHist = []; slot.lastRawM = null; slot.spanRef = null; slot.spanBad = 0; slot.badMs = 0; slot.mode = mode; }
    if (mode === 2) {
      const span = Math.hypot(rw.x - lw.x, rw.y - lw.y);
      if (slot.spanRef === null) slot.spanRef = span;
      // Hands on a rigid wheel keep the same distance whatever the angle; a frame where it jumps is a landmark glitch.
      const spanOk = Math.abs(span - slot.spanRef) <= 0.12 * slot.spanRef;
      trusted = wheelVis(lw) && wheelVis(rw) && spanOk;
      if (spanOk) { slot.spanRef += (span - slot.spanRef) * 0.05; slot.spanBad = 0; }
      else if (++slot.spanBad > 15) { slot.spanRef = span; slot.spanBad = 0; } // the grip really changed (0.5 s): re-learn it
      if (trusted) {
        rawNow = handLineDeg(lw, rw, sw);
        const k = 0.08; // wheel centre and radius follow the grip, relative to the body
        wc.dx += (((lw.x + rw.x) / 2 - shMidX) / sw - wc.dx) * k;
        wc.dy += (((lw.y + rw.y) / 2 - shMidY) / sw - wc.dy) * k;
        wc.r += ((span / 2) / sw - wc.r) * k;
      }
      dbg.span = span; dbg.spanRef = slot.spanRef; dbg.spanOk = spanOk ? 1 : 0;
    } else if (mode === 1) {
      const w = lGrip ? lw : rw;
      const d = Math.hypot(w.x - cx, w.y - cy);
      trusted = wheelVis(w) && d > 0.5 * cr && d < 1.8 * cr;
      if (trusted) {
        rawNow = lGrip
          ? (Math.atan2(cy - lw.y, lw.x - cx) * 180) / Math.PI
          : (Math.atan2(rw.y - cy, cx - rw.x) * 180) / Math.PI;
      }
    }
    if (mode > 0) {
      slot.badMs = trusted ? 0 : slot.badMs + dtAdapt * 1000;
      if (trusted && rawNow !== null) {
        slot.rawHist.push(rawNow);
        if (slot.rawHist.length > 5) slot.rawHist.shift();
        const sorted = [...slot.rawHist].sort((x, y) => x - y);
        slot.lastRawM = sorted[sorted.length >> 1]; // median: a 1-2 frame outlier never reaches the wheel
      }
    }
    if (mode > 0 && slot.lastRawM !== null && slot.badMs < 400) {
      // Slew limit on the reading itself: a hand turns a wheel at most ~450 deg/s; anything faster between two
      // frames is a glitch and only moves the reading that far per frame.
      let raw = slot.lastRawM;
      if (slot.slewRaw !== null) raw = slot.slewRaw + clamp(raw - slot.slewRaw, -450 * dtAdapt, 450 * dtAdapt);
      slot.slewRaw = raw;
      wheelTiltRight = clamp((raw - slot.shDeg) / WHEEL_MAX_DEG, -1, 1);
      holding = true;
      dbg.median = slot.lastRawM; dbg.slew = raw;
    } else {
      // Let go (hands away, or no valid point for 0.4 s): back to straight; re-gripping rises smoothly from 0.
      slot.slewRaw = slot.shDeg; slot.lastRawM = null; slot.rawHist = [];
    }
    slot.lastWheelTilt = wheelTiltRight;

    // Body lean is only a fallback while both wrists are lost; a small lean never counts (log: a constant +0.14 bias).
    const handsLost = !lwOk && !rwOk;
    const leanFb = Math.abs(bodyLeanRight) > 0.2 ? Math.sign(bodyLeanRight) * (Math.abs(bodyLeanRight) - 0.2) / 0.8 : 0;
    const rawSteer = holding ? wheelTiltRight : (handsLost ? leanFb : 0);

    dbg.zone = holding ? 1 : 0; dbg.lwOk = lwOk ? 1 : 0; dbg.rwOk = rwOk ? 1 : 0;
    dbg.lwx = lw.x; dbg.lwy = lw.y; dbg.lwv = lw.visibility; dbg.rwx = rw.x; dbg.rwy = rw.y; dbg.rwv = rw.visibility;
    dbg.sw = sw; dbg.shY = shMidY; dbg.attack = attack ? 1 : 0; dbg.nos = turbo ? 1 : 0; dbg.mode = mode; dbg.trusted = trusted ? 1 : 0;
    dbg.rawAngle = rawNow; dbg.neutral = slot.shDeg;

    const deadzone = 0.067; // ~6 deg of wheel
    const dzSteer = Math.abs(rawSteer) < deadzone
      ? 0
      : Math.sign(rawSteer) * ((Math.abs(rawSteer) - deadzone) / (1 - deadzone));
    const filteredSteer = slot.steerFilter.filter(dzSteer, tSec);
    const steer = Math.abs(filteredSteer) < 0.01 ? 0 : clamp(filteredSteer, -1, 1);
    slot.wheelAngleDeg = Math.round(steer * WHEEL_MAX_DEG);
    dbg.bodyLean = bodyLeanRight; dbg.wheelTilt = wheelTiltRight; dbg.rawSteer = rawSteer; dbg.steer = steer;
    slot.hud = {
      wheel: { x: cx, y: cy, r: cr, deg: slot.wheelAngleDeg, held: holding },
      nos: { ...btn.nos, down: turbo, hover: rOnNos },
      fire: { ...btn.fire, down: fireDown, hover: lOnFire },
    };

    // Gently adapt neutralShoulderY when standing upright (like body-runner line 331)
    if (!jumped && !crouched) {
      slot.neutralShoulderY += (shMidY - slot.neutralShoulderY) * 0.008;
    }

    // 5. THROTTLE (Forward):
    let throttle = 0;
    if (!brake) {
      if (this.autoGas) {
        throttle = 1;
      } else {
        throttle = (holding || turbo) ? 1 : 0;
      }
    }

    slot.lastSteer = steer;
    slot.lastThrottle = throttle;

    let poseLabel = 'DRIVE 🙂';
    if (attack) poseLabel = 'FIRE! 💥';
    else if (turbo) poseLabel = 'NOS! 🚀';
    else if (reverse) poseLabel = 'REVERSE ⏪';
    else if (brake) poseLabel = 'BRAKE 🛑';
    else if (steer < -0.20) poseLabel = 'LEFT ⬅️';
    else if (steer > 0.20) poseLabel = 'RIGHT ➡️';

    slot.poseLabel = poseLabel;

    slot.dbg.label = poseLabel; slot.dbg.brake = brake ? 1 : 0;
    return {
      throttle,
      brake,
      reverse,
      steer,
      turbo,
      attack,
      hop,
      calibrated: slot.calibrated,
      visible: true,
      wheelAngleDeg: slot.wheelAngleDeg,
      poseLabel,
    };
  }
}

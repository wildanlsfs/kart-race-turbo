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

const WHEEL_MAX_DEG = 60;
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

    const wristVis = (w) => w && (w.visibility === undefined || w.visibility > 0.35);
    const lwOk = wristVis(lw);
    const rwOk = wristVis(rw);

    // 1. PUNCH / ATTACK detection (3D depth OR fast 2D wrist jab away from shoulder)
    let attack = false;
    const leftDepth = lwOk ? (ls.z - lw.z) : 0;
    const rightDepth = rwOk ? (rs.z - rw.z) : 0;
    const leftChestLevel = lwOk && Math.abs(lw.y - shMidY) < sw * 0.75;
    const rightChestLevel = rwOk && Math.abs(rw.y - shMidY) < sw * 0.75;

    let fast2DJab = false;
    if (lwOk && slot.prevLeftWrist) {
      const v2d = Math.hypot(lw.x - slot.prevLeftWrist.x, lw.y - slot.prevLeftWrist.y) / sw;
      if (leftChestLevel && v2d > 0.55) fast2DJab = true;
    }
    if (rwOk && slot.prevRightWrist) {
      const v2d = Math.hypot(rw.x - slot.prevRightWrist.x, rw.y - slot.prevRightWrist.y) / sw;
      if (rightChestLevel && v2d > 0.55) fast2DJab = true;
    }
    slot.prevLeftWrist = lwOk ? { x: lw.x, y: lw.y } : null;
    slot.prevRightWrist = rwOk ? { x: rw.x, y: rw.y } : null;

    const leftJab = leftChestLevel && (leftDepth > 0.25 || (leftDepth - slot.prevLeftReach) > 0.15);
    const rightJab = rightChestLevel && (rightDepth > 0.25 || (rightDepth - slot.prevRightReach) > 0.15);
    slot.prevLeftReach = leftDepth;
    slot.prevRightReach = rightDepth;

    if ((leftJab || rightJab || fast2DJab) && (nowMs - slot.lastPunchMs > 320)) {
      attack = true;
      slot.lastPunchMs = nowMs;
    }

    // 2. TURBO / HOP detection: Both hands raised above shoulders/nose OR real jump (shoulders rise)
    const noseY = nose ? nose.y : shMidY - sw * 0.6;
    const handsOverhead = lwOk && rwOk &&
      lw.y < (shMidY - sw * 0.35) &&
      rw.y < (shMidY - sw * 0.35) &&
      (lw.y < noseY + sw * 0.25 || rw.y < noseY + sw * 0.25);
    const jumped = (slot.neutralShoulderY - shMidY) > sw * 0.28;
    const turbo = Boolean(handsOverhead || jumped);
    const hop = Boolean(jumped);

    // 3. BRAKE / REVERSE detection: Crouch (shoulders drop) OR both hands pulled tight to chest
    const crouched = (shMidY - slot.neutralShoulderY) > sw * 0.32;
    const wristsDistance = (lwOk && rwOk) ? Math.hypot(lw.x - rw.x, lw.y - rw.y) : sw;
    const handsPulledChest = !attack && !handsOverhead && lwOk && rwOk &&
      wristsDistance < sw * 0.42 &&
      Math.abs(((lw.y + rw.y) * 0.5) - (shMidY + sw * 0.18)) < sw * 0.36;

    const brake = Boolean(!attack && !turbo && (crouched || handsPulledChest));
    if (brake) {
      if (slot.brakeStartMs === null) slot.brakeStartMs = nowMs;
    } else {
      slot.brakeStartMs = null;
    }
    const reverse = Boolean(brake && slot.brakeStartMs !== null && (nowMs - slot.brakeStartMs >= 380));

    // 4. STEERING (Mirrored camera):
    // Balanced for comfortable webcam play with 12% deadzone, S-curve response, and adaptive neutral center
    // Only drift the neutral point while the player is clearly NOT steering (previous steer ~0),
    // and slowly, so holding a lean through a long corner does not fade the steering away.
    const dtAdapt = Math.min(0.1, Math.max(0.001, slot.lastEvalSec == null ? 0.033 : tSec - slot.lastEvalSec));
    if (!attack && !crouched && Math.abs(slot.lastSteer) < 0.05 && Math.abs(slot.neutralX - shMidX) < sw * 0.10) {
      const k = Math.min(1, 0.25 * dtAdapt);
      slot.neutralX += (shMidX - slot.neutralX) * k;
      if (nose) {
        slot.neutralNoseX = (slot.neutralNoseX ?? slot.neutralX) + (nose.x - (slot.neutralNoseX ?? slot.neutralX)) * k;
      }
    }
    slot.lastEvalSec = tSec;

    // (a) Upper-body displacement relative to calibrated neutralX
    const shoulderShiftRight = clamp((slot.neutralX - shMidX) / (sw * 0.36), -1, 1);

    // (b) Head shift relative to calibrated neutralNoseX
    const headShiftRight = nose
      ? clamp(((slot.neutralNoseX ?? slot.neutralX) - nose.x) / (sw * 0.40), -1, 1)
      : shoulderShiftRight;

    // (c) Torso lean relative to hips (if hips are visible and didn't just move identically with shoulders)
    const hipMidX = (lh && rh) ? (lh.x + rh.x) * 0.5 : shMidX;
    const torsoLeanRight = clamp((hipMidX - shMidX) / (sw * 0.34), -1, 1);

    // (d) Shoulder tilt angle (leaning right tilts right shoulder down -> larger y than left shoulder)
    const shoulderTiltRight = clamp((rs.y - ls.y) / (sw * 0.28), -1, 1);

    const upperLean = Math.abs(shoulderShiftRight) >= Math.abs(torsoLeanRight)
      ? shoulderShiftRight
      : torsoLeanRight;
    const bodyLeanRight = clamp(upperLean * 0.62 + headShiftRight * 0.25 + shoulderTiltRight * 0.25, -1, 1);

    // (e) Invisible steering wheel: the angle the hands' line has turned from where it was at
    // calibration is the wheel angle, 1:1, clamped to +-WHEEL_MAX_DEG. The hands may sit anywhere from
    // above the chest down to the belly: turning the wheel moves one hand up and the other down.
    let wheelTiltRight = 0;
    const handsInWheelZone = lwOk && rwOk && !handsOverhead && !attack &&
      lw.y > shMidY - sw * 0.6 && lw.y < shMidY + sw * 2.2 &&
      rw.y > shMidY - sw * 0.6 && rw.y < shMidY + sw * 2.2;

    if (handsInWheelZone) {
      const raw = handLineDeg(lw, rw, sw);
      if (Math.abs(raw - slot.neutralWheelDeg) < 12) {
        // The straight-ahead angle follows the hands while they stay within 12 deg of it, so a calibration taken
        // in another posture (or a slowly sagging wheel) never leaves a permanent pull to one side. Deliberate
        // turns (more than 12 deg off) never drift away. It used to wait for steer ~ 0, which a pulled wheel never reaches.
        slot.neutralWheelDeg += (raw - slot.neutralWheelDeg) * Math.min(1, 0.5 * dtAdapt);
      }
      wheelTiltRight = clamp((raw - slot.neutralWheelDeg) / WHEEL_MAX_DEG, -1, 1);
    }

    // Wheel angle (exact, 1:1) plus body lean (for players who also lean into the bend).
    const rawSteer = attack
      ? 0
      : clamp(bodyLeanRight + wheelTiltRight, -1, 1);

    const deadzone = 0.10;
    const dzSteer = Math.abs(rawSteer) < deadzone
      ? 0
      : Math.sign(rawSteer) * ((Math.abs(rawSteer) - deadzone) / (1 - deadzone));
    // 1:1 (linear) after the dead zone: the steering wheel angle is exactly what the player's hands show.
    const curvedSteer = dzSteer;

    const filteredSteer = slot.steerFilter.filter(curvedSteer, tSec);
    const steer = Math.abs(filteredSteer) < 0.01 ? 0 : clamp(filteredSteer, -1, 1);
    slot.wheelAngleDeg = Math.round(steer * WHEEL_MAX_DEG);

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
        throttle = (handsInWheelZone || handsOverhead) ? 1 : 0;
      }
    }

    slot.lastSteer = steer;
    slot.lastThrottle = throttle;

    let poseLabel = 'DRIVE 🙂';
    if (attack) poseLabel = 'PUNCH! 💥';
    else if (turbo) poseLabel = 'TURBO! 🚀';
    else if (reverse) poseLabel = 'REVERSE ⏪';
    else if (brake) poseLabel = 'BRAKE 🛑';
    else if (steer < -0.20) poseLabel = 'LEFT ⬅️';
    else if (steer > 0.20) poseLabel = 'RIGHT ➡️';

    slot.poseLabel = poseLabel;

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

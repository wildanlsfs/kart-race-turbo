// Core Kart Physics, Track Spline Progress, Checkpoint Validation, Crates, Projectiles & AI Bots.

import { TRACKS, DRIVERS, ITEMS, getTrackById } from './tracks.js';

export { TRACKS, DRIVERS, ITEMS, getTrackById };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Difficulty: only the AI changes (top-speed scale, how often it uses items, how often it slips up).
export const DIFFICULTIES = {
  santai: { id: 'santai', name: 'Santai', topScale: 0.93, itemUse: 0.45, itemDelay: 1.8, mistakeRate: 0.08 },
  normal: { id: 'normal', name: 'Normal', topScale: 0.99, itemUse: 0.8, itemDelay: 1.0, mistakeRate: 0.03 },
  pro: { id: 'pro', name: 'Pro', topScale: 1.04, itemUse: 1.0, itemDelay: 0.5, mistakeRate: 0.006 },
};
export const DEFAULT_DIFFICULTY = 'normal';
export function normalizeDifficulty(d) {
  return Object.prototype.hasOwnProperty.call(DIFFICULTIES, d) ? d : DEFAULT_DIFFICULTY;
}

// Small deterministic PRNG (mulberry32) for tests and balance runs; the browser uses Math.random.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPIN_TIME = 0.9;
const GRIP_REF = 4.0; // handling value of the balanced driver
const CORNER_DRAG = 0.014; // speed scrubbed per unit of lateral acceleration (balanced driver)
// Steering model: the input is a wheel POSITION (steer = wheel angle / 60 deg, so +-1 = +-60 deg). The front tyres
// turn by TIRE_MAX at full wheel lock and the yaw rate follows a bicycle model (yaw = v / wheelbase * tan(tyre)),
// limited by grip (lateral acceleration <= GRIP_LAT x handling stat). Asking for more than the grip gives
// understeer: the kart turns less than asked and scrubs speed. Zero wheel = straight.
export const WHEEL_MAX_DEG = 60;
export const TIRE_MAX = (28 * Math.PI) / 180;
export const WHEELBASE = 2.4;
const GRIP_LAT = 24;
const UNDERSTEER_SCRUB = 0.9;
// Steer value (-1..1) that yields a wanted yaw rate (rad/s, positive = heading decreasing = turning right) at the kart's speed.
export function steerForYaw(kart, yawWanted) {
  const v = Math.max(3, Math.abs(kart.speed));
  const tire = Math.atan((yawWanted * WHEELBASE) / v);
  return clamp(tire / TIRE_MAX, -1, 1);
}
const BARRIER_SCRUB = 1.6; // speed fraction lost per radian the soft barrier has to turn a kart
const OFFROAD_SPEED = 0.55; // top-speed factor beyond the kerb (grass / sand)
const CLOSE_AFTER = 60; // seconds the race stays open after the first kart finishes
const STUCK_WINDOW = 3.0; // seconds without progress before the safety net resets a kart
const STUCK_MIN_PROGRESS = 0.008; // lap fraction (about 4 m) that counts as moving

export class RaceSimulation {
  constructor({ trackId = 'island', mode = '1p', players = [], totalLaps = 3, fillAI = true, difficulty = DEFAULT_DIFFICULTY, rng = Math.random } = {}) {
    this.rng = rng;
    this.idSeq = 0;
    this.difficulty = normalizeDifficulty(difficulty);
    this.diff = DIFFICULTIES[this.difficulty];
    this.track = getTrackById(trackId);
    this.mode = mode;
    this.totalLaps = totalLaps;
    this.status = 'countdown'; // 'countdown' | 'racing' | 'finished'
    this.countdown = 3.0;
    this.elapsedSec = 0;
    this.events = []; // transient events for audio/particles

    const roster = [...players];
    if (fillAI) {
      const usedDrivers = new Set(roster.map((p) => p.driverId));
      let botIdx = 1;
      while (roster.length < 4) {
        const avail = DRIVERS.find((d) => !usedDrivers.has(d.id)) || DRIVERS[roster.length % DRIVERS.length];
        usedDrivers.add(avail.id);
        roster.push({
          id: `ai_${botIdx}`,
          name: `CPU ${avail.name.split(' ')[0]}`,
          driverId: avail.id,
          isAI: true,
        });
        botIdx++;
      }
    }

    const startPt = this.track.getPointAt(0.985);
    const startHeading = Math.atan2(startPt.tx, startPt.tz);

    // Starting grid: AI karts take the front rows, human players the back row, so no kart sits
    // between a player's chase camera and the road ahead.
    const slotOf = new Map();
    {
      const ais = roster.filter((p) => p.isAI);
      const humans = roster.filter((p) => !p.isAI);
      ais.forEach((p, i) => slotOf.set(p, i));
      humans.forEach((p, i) => slotOf.set(p, ais.length + i));
    }

    this.karts = roster.map((p, idx) => {
      const driver = DRIVERS.find((d) => d.id === p.driverId) || DRIVERS[idx % DRIVERS.length];
      const slot = slotOf.get(p);
      const rowBack = Math.floor(slot / 2) * 3.2;
      const laneOffset = (slot % 2 === 0 ? -1 : 1) * 2.6;
      const x = startPt.x + startPt.rx * laneOffset - startPt.tx * rowBack;
      const z = startPt.z + startPt.rz * laneOffset - startPt.tz * rowBack;

      return {
        id: p.id,
        name: p.name || driver.name,
        driverId: driver.id,
        driver,
        isAI: Boolean(p.isAI),
        x,
        y: 0,
        z,
        vy: 0,
        heading: startHeading,
        speed: 0,
        baseTopSpeed: driver.stats.topSpeed,
        steerAngle: 0,
        lap: 1,
        checkpoint: 0, // must visit 1 -> 2 -> 3 before crossing 0 increments lap
        trackS: 0.985,
        totalProgress: 0,
        rank: slotOf.get(p) + 1,
        mango: 0,
        turboCharge: 45, // start with 45% turbo so players can test boost early
        turboActiveTimer: 0,
        padBoostTimer: 0,
        spinOutTimer: 0,
        shieldTimer: 0,
        heldItem: null,
        punchAnimTimer: 0,
        driftCharge: 0,
        finished: false,
        finishTimeSec: null,
        wheelDeg: 0,
        aiTargetOffset: (driver.ai ? driver.ai.lane : 0) * 2.2,
        aiPace: 1,
        aiSkill: driver.ai ? driver.ai.skill : 1,
        aiItemTimer: 0,
        aiNoUse: false,
        aiMistakeT: 0,
        aiMistakeDir: 0,
        aiWander: this.rng() * Math.PI * 2,
        steerCmd: 0,
        invulnTimer: 0,
        wallCooldown: 0,
        resets: 0,
        stuckT: 0,
        stuckMark: 0,
        wantsGo: true,
        spinBase: 0,
        statsSummary: { cratesSmashed: 0, turbosUsed: 0, attacksFired: 0, hitsLanded: 0 },
      };
    });

    this.crates = this.track.crateSpawns.map((c) => ({
      ...c,
      active: true,
      respawnTimer: 0,
    }));

    this.fruits = this.track.fruitSpawns.map((f) => ({
      ...f,
      active: true,
      respawnTimer: 0,
      cool: {},
    }));

    this.projectiles = [];
    this.hazards = [];
    this.finishDelay = 0;
    this.closeTimer = 0;
  }

  _findNearestSample(x, z) {
    const samples = this.track.samples;
    let bestIdx = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const dx = x - samples[i].x;
      const dz = z - samples[i].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    return { sample: samples[bestIdx], dist: Math.sqrt(bestD2), index: bestIdx };
  }

  // Curvature of the road ahead (radians of tangent change over ~0.07 of a lap)
  _roadBend(s) {
    const a = this.track.getPointAt(s);
    const b = this.track.getPointAt(s + 0.07);
    return Math.abs(wrapAngle(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)));
  }

  // AI pace comes from the difficulty and the driver's fixed personality only. The one exception is a
  // small catch-up for AI karts that are far behind the leader; nobody is ever slowed down for being ahead
  // and nothing depends on where a human is.
  _updateAIPace(kart) {
    const lead = Math.max(...this.karts.map((k) => k.totalProgress));
    const gap = lead - kart.totalProgress; // laps behind the leader
    const catchUp = clamp((gap - 0.12) * 0.25, 0, 0.03);
    kart.aiPace = this.diff.topScale * kart.aiSkill + catchUp;
  }

  _computeAIInput(kart, dt) {
    const halfRoad = this.track.roadWidth * 0.5;
    const look = (5 + Math.max(0, kart.speed) * 0.45) / this.track.totalLength; // metres ahead
    const targetPt = this.track.getPointAt(kart.trackS + look);
    const off = clamp(kart.aiTargetOffset + Math.sin(this.elapsedSec * 0.35 + kart.aiWander) * 1.2, -(halfRoad - 3.2), halfRoad - 3.2);
    const tx = targetPt.x + targetPt.rx * off;
    const tz = targetPt.z + targetPt.rz * off;
    const desiredHeading = Math.atan2(tx - kart.x, tz - kart.z);
    const diff = wrapAngle(desiredHeading - kart.heading);
    // Slow lane wander (per-kart phase, deterministic from the rng) so karts do not all take one line.
    let steer = steerForYaw(kart, -diff * 2.4);
    if (this.diff.mistakeRate > 0) {
      if (kart.aiMistakeT > 0) {
        kart.aiMistakeT -= dt;
        steer = clamp(steer + kart.aiMistakeDir * 0.3, -1, 1);
      } else if (this.rng() < this.diff.mistakeRate * dt && kart.speed > 12) {
        kart.aiMistakeT = 0.5 + this.rng() * 0.5;
        kart.aiMistakeDir = this.rng() < 0.5 ? -1 : 1;
      }
    }

    // Lift off before tight bends so AI karts stay on the road instead of scraping walls.
    const bend = this._roadBend(kart.trackS);
    const cornerSpeed = clamp(40 - bend * 13, 22, 40);
    const throttle = kart.speed > cornerSpeed * kart.aiPace ? 0 : 1;

    const straight = bend < 0.35 && Math.abs(steer) < 0.25;
    const turbo = kart.turboCharge >= 55 && straight && kart.spinOutTimer <= 0;

    // Item use: wait a beat after pickup, then fire when it makes sense.
    let attack = false;
    if (kart.heldItem) {
      kart.aiItemTimer -= dt;
      if (kart.aiItemTimer <= 0 && !kart.aiNoUse) {
        const fwdX = Math.sin(kart.heading);
        const fwdZ = Math.cos(kart.heading);
        let ahead = null;
        let behind = null;
        for (const o of this.karts) {
          if (o === kart) continue;
          const dx = o.x - kart.x;
          const dz = o.z - kart.z;
          const along = dx * fwdX + dz * fwdZ;
          const side = Math.abs(dx * fwdZ - dz * fwdX);
          if (along > 4 && along < 60 && side < 12 && (!ahead || along < ahead.along)) ahead = { along, side };
          if (along < -3 && along > -26 && side < 6) behind = { along, side };
        }
        if (kart.heldItem === 'rocket') attack = Boolean(ahead);
        else if (kart.heldItem === 'bomb') attack = Boolean(ahead && ahead.side < 4 && ahead.along < 40);
        else if (kart.heldItem === 'tnt') attack = Boolean(behind);
        else if (kart.heldItem === 'shield') attack = kart.aiItemTimer < -4 || Boolean(ahead && ahead.along < 25);
        if (!attack && kart.aiItemTimer < -9) attack = true;
      }
    }

    return { throttle, brake: false, reverse: false, steer, turbo, attack, hop: false };
  }

  _chooseItemForRank(rank) {
    if (rank === 1) {
      return this.rng() < 0.55 ? 'tnt' : (this.rng() < 0.5 ? 'shield' : 'bomb');
    }
    if (rank === 2) {
      return ITEMS[Math.floor(this.rng() * ITEMS.length)];
    }
    return this.rng() < 0.6 ? 'rocket' : (this.rng() < 0.5 ? 'shield' : 'bomb');
  }

  _fireItem(kart) {
    const item = kart.heldItem;
    if (!item) return;
    kart.heldItem = null;
    kart.punchAnimTimer = 0.35;
    kart.statsSummary.attacksFired++;
    this.events.push({ type: 'attack', kartId: kart.id, item });

    const fwdX = Math.sin(kart.heading);
    const fwdZ = Math.cos(kart.heading);

    if (item === 'shield') {
      kart.shieldTimer = 8.0;
      return;
    }

    if (item === 'tnt') {
      this.hazards.push({
        id: `tnt_${this.idSeq++}`,
        ownerId: kart.id,
        type: 'tnt',
        x: kart.x - fwdX * 2.6,
        y: 0.5,
        z: kart.z - fwdZ * 2.6,
        ttl: 18.0,
      });
      return;
    }

    // Rocket or Bowling Bomb projectile
    this.projectiles.push({
      id: `proj_${this.idSeq++}`,
      ownerId: kart.id,
      type: item, // 'rocket' | 'bomb'
      x: kart.x + fwdX * 2.5,
      y: 0.7,
      z: kart.z + fwdZ * 2.5,
      vx: fwdX * (item === 'rocket' ? 52 : 44),
      vz: fwdZ * (item === 'rocket' ? 52 : 44),
      heading: kart.heading,
      ttl: item === 'rocket' ? 4.5 : 6.0,
    });
  }

  step(dtSec, inputsById = {}) {
    const dt = clamp(dtSec, 0.001, 0.05);
    this.events.length = 0;

    if (this.status === 'countdown') {
      const prevFloor = Math.ceil(this.countdown);
      this.countdown -= dt;
      const nextFloor = Math.ceil(this.countdown);
      if (nextFloor !== prevFloor && nextFloor >= 0) {
        this.events.push({ type: 'countdown', count: nextFloor });
      }
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.status = 'racing';
      }
      return this.getSnapshot();
    }

    this.elapsedSec += dt;

    // Respawn crates & fruits
    for (const c of this.crates) {
      if (!c.active) {
        c.respawnTimer -= dt;
        if (c.respawnTimer <= 0) c.active = true;
      }
    }
    // Mango is per kart: each kart collects its own copy (and waits 8 s for the next), so the kart that
    // happens to be in front cannot snowball a top-speed bonus. A mango disappears from the scene
    // once every human (or every kart, in an AI-only race) has taken it.
    for (const f of this.fruits) {
      for (const id of Object.keys(f.cool)) {
        f.cool[id] -= dt;
        if (f.cool[id] <= 0) delete f.cool[id];
      }
      const viewers = this.karts.some((k) => !k.isAI) ? this.karts.filter((k) => !k.isAI) : this.karts;
      f.active = viewers.some((k) => !(f.cool[k.id] > 0));
    }

    // Update each kart
    for (const kart of this.karts) {
      if (kart.isAI || kart.finished) this._updateAIPace(kart);
      const rawInput = (kart.isAI || kart.finished)
        ? this._computeAIInput(kart, dt)
        : (inputsById[kart.id] || { throttle: 0, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false });

      if (kart.invulnTimer > 0) kart.invulnTimer = Math.max(0, kart.invulnTimer - dt);
      if (kart.wallCooldown > 0) kart.wallCooldown = Math.max(0, kart.wallCooldown - dt);
      if (kart.punchAnimTimer > 0) kart.punchAnimTimer = Math.max(0, kart.punchAnimTimer - dt);
      if (kart.shieldTimer > 0) kart.shieldTimer = Math.max(0, kart.shieldTimer - dt);
      if (kart.turboActiveTimer > 0) kart.turboActiveTimer = Math.max(0, kart.turboActiveTimer - dt);
      if (kart.padBoostTimer > 0) kart.padBoostTimer = Math.max(0, kart.padBoostTimer - dt);

      if (kart.spinOutTimer > 0) {
        // Two full turns over SPIN_TIME that end exactly on the original heading (so the kart
        // never comes out of a spin facing the wrong way), while it keeps rolling forward.
        kart.spinOutTimer = Math.max(0, kart.spinOutTimer - dt);
        kart.speed *= Math.max(0, 1 - 1.4 * dt);
        kart.heading = wrapAngle(kart.spinBase + (1 - kart.spinOutTimer / SPIN_TIME) * Math.PI * 4);
      } else {
        // Hop / ramp jump
        if (rawInput.hop && kart.y <= 0.01) {
          kart.vy = 7.5;
          kart.turboCharge = Math.min(100, kart.turboCharge + 6);
          this.events.push({ type: 'hop', kartId: kart.id });
        }

        // Trigger Turbo if charged >= 40%; costs 40% so it cannot be held down forever.
        if (rawInput.turbo && kart.turboCharge >= 40 && kart.turboActiveTimer <= 0.05) {
          kart.turboActiveTimer = 1.5;
          kart.turboCharge = Math.max(0, kart.turboCharge - 40);
          kart.statsSummary.turbosUsed++;
          this.events.push({ type: 'turbo', kartId: kart.id });
        }

        // Fire item on punch/attack
        if (rawInput.attack && kart.heldItem) {
          this._fireItem(kart);
        }

        // Nearest track check for off-road slowdown & gentle boundary push
        const nearest = this._findNearestSample(kart.x, kart.z);
        const halfRoad = this.track.roadWidth * 0.5;
        const offRoad = nearest.dist > halfRoad + 1.2;

        const mangoBonus = Math.min(10, kart.mango) * 0.25;
        const boostBonus = (kart.turboActiveTimer > 0 ? kart.driver.stats.boostBonus : 0) + (kart.padBoostTimer > 0 ? 11 : 0);
        const effectiveTopSpeed = (kart.baseTopSpeed + mangoBonus + boostBonus) * (offRoad && kart.turboActiveTimer <= 0 ? OFFROAD_SPEED : 1.0);

        const topScale = kart.finished ? 0.7 : (kart.isAI ? kart.aiPace : 1);
        const topSpeed = effectiveTopSpeed * topScale;
        if (rawInput.reverse && kart.speed <= 1.5) {
          // Reverse only once nearly stopped; before that "reverse" is just a brake.
          kart.speed = Math.max(-12, kart.speed - 22 * dt);
        } else if (rawInput.reverse || rawInput.brake) {
          kart.speed = kart.speed > 0 ? Math.max(0, kart.speed - 38 * dt) : Math.min(0, kart.speed + 30 * dt);
        } else if (rawInput.throttle > 0 || kart.turboActiveTimer > 0 || kart.padBoostTimer > 0) {
          // Acceleration tapers off near top speed, so a driver with strong acceleration gets back
          // to speed quicker after a hit, a wall scrape or a tight bend.
          const accel = kart.driver.stats.accel + (kart.turboActiveTimer > 0 ? 22 : 0);
          const taper = 0.35 + 0.65 * clamp(1 - Math.max(0, kart.speed) / Math.max(1, topSpeed), 0, 1);
          kart.speed = Math.min(topSpeed, kart.speed + accel * taper * dt);
        } else {
          // Natural coasting drag
          kart.speed *= Math.max(0, 1 - 1.8 * dt);
        }
        if (kart.speed > topSpeed) {
          kart.speed = Math.max(topSpeed, kart.speed - 18 * dt);
        }

        // Steering: real turning proportional to input, plus a light road assist that
        // self-centres when hands are neutral and nudges away from the barrier.
        const headBefore = kart.heading;
        const steerInput = clamp(rawInput.steer || 0, -1, 1);
        kart.steerAngle = steerInput;
        const s = nearest.sample;
        const trackHeading = Math.atan2(s.tx, s.tz);
        const lateralOffset = (kart.x - s.x) * s.rx + (kart.z - s.z) * s.rz;
        let steerEff = steerInput;
        const softMargin = halfRoad - 1.4;
        const excess = Math.abs(lateralOffset) - softMargin;
        if (excess > 0 && Math.sign(steerInput) === Math.sign(lateralOffset)) {
          // steering toward the barrier is progressively damped
          steerEff *= clamp(1 - excess / 1.6, 0, 1);
        }
        kart.wheelDeg = steerInput * WHEEL_MAX_DEG;
        // Bicycle model. Positive steer = right = heading decreases.
        const tire = steerEff * TIRE_MAX;
        const yawDemand = (kart.speed / WHEELBASE) * Math.tan(tire);
        const gripLimit = (kart.driver.stats.handling * GRIP_LAT) / Math.max(4, Math.abs(kart.speed));
        const yaw = clamp(yawDemand, -gripLimit, gripLimit);
        if (Math.abs(yawDemand) > gripLimit) {
          const over = 1 - gripLimit / Math.abs(yawDemand);
          kart.speed -= kart.speed * over * UNDERSTEER_SCRUB * dt;
        }
        kart.heading = wrapAngle(kart.heading - yaw * dt);

        if (kart.speed > 1) {
          // Soft barrier: near the kerb the nose may only point away from the road centre by an angle
          // that shrinks to zero at the kerb. The rescue is paid for with speed, so riding the edge or
          // leaning on it is slow, and a kart nobody steers does not get driven round the track by it.
          const err = wrapAngle(trackHeading - kart.heading);
          const latSign = Math.sign(lateralOffset) || 1;
          const outAngle = latSign * err;
          const allowed = 0.9 * clamp((halfRoad + 0.2 - Math.abs(lateralOffset)) / 1.8, 0, 1);
          if (outAngle > allowed) {
            const fixed = trackHeading - latSign * allowed;
            const before = kart.heading;
            kart.heading = wrapAngle(kart.heading + wrapAngle(fixed - kart.heading) * Math.min(1, 12 * dt));
            const turned = Math.abs(wrapAngle(kart.heading - before));
            kart.speed = Math.max(0, kart.speed * (1 - Math.min(0.6, turned * BARRIER_SCRUB)));
          }
        }

        // Cornering drag: the harder the kart is being turned at speed, the more it scrubs speed.
        // A high Handling stat keeps the speed through bends; low Handling drags (and a strong
        // Acceleration stat claws the speed back). Straights are unaffected.
        if (kart.speed > 1) {
          const lateralAccel = (Math.abs(wrapAngle(kart.heading - headBefore)) / dt) * kart.speed;
          const gripRatio = GRIP_REF / kart.driver.stats.handling;
          kart.speed = Math.max(0, kart.speed - kart.speed * lateralAccel * CORNER_DRAG * gripRatio * gripRatio * dt);
        }

        // Charge turbo gradually from hard cornering / drifting at speed
        if (Math.abs(steerInput) > 0.45 && kart.speed > 18) {
          kart.turboCharge = Math.min(100, kart.turboCharge + 12 * dt);
        } else {
          kart.turboCharge = Math.min(100, kart.turboCharge + 2.5 * dt);
        }
      }

      // Integrate XZ motion
      kart.x += Math.sin(kart.heading) * kart.speed * dt;
      kart.z += Math.cos(kart.heading) * kart.speed * dt;

      // Vertical hop / ramp physics
      if (kart.y > 0 || kart.vy !== 0) {
        kart.y += kart.vy * dt;
        kart.vy -= 22.0 * dt;
        if (kart.y <= 0) {
          kart.y = 0;
          kart.vy = 0;
        }
      }

      // Barrier at the outer edge: slide along it, scrub some speed (once per contact), never teleport far.
      const nearestAfter = this._findNearestSample(kart.x, kart.z);
      const maxDist = this.track.roadWidth * 0.5 + 3.5;
      if (nearestAfter.dist > maxDist - 0.4 && kart.speed > 0) {
        kart.speed *= Math.max(0, 1 - 5 * dt); // leaning on the wall keeps scrubbing speed
      }
      if (nearestAfter.dist > maxDist) {
        const s = nearestAfter.sample;
        const dx = kart.x - s.x;
        const dz = kart.z - s.z;
        const len = Math.hypot(dx, dz) || 1;
        kart.x = s.x + (dx / len) * maxDist;
        kart.z = s.z + (dz / len) * maxDist;
        const tangent = Math.atan2(s.tx, s.tz);
        const err = wrapAngle(tangent - kart.heading);
        kart.heading = wrapAngle(kart.heading + err * 0.12);
        if (kart.wallCooldown <= 0) {
          kart.speed *= 0.6;
          kart.wallCooldown = 0.35;
          this.events.push({ type: 'wall', kartId: kart.id, x: kart.x, z: kart.z });
        }
      }

      // Update track spline progress & ordered checkpoints (0 -> 1 -> 2 -> 3 -> finish)
      const newS = nearestAfter.sample.s;
      const sector = Math.min(3, Math.floor(newS * 4)); // 0, 1, 2, 3
      if (sector === kart.checkpoint + 1) {
        kart.checkpoint = sector;
      }
      // Crossing finish line (from sector 3 into sector 0)
      if (kart.checkpoint === 3 && newS < 0.15 && kart.trackS > 0.80) {
        kart.lap += 1;
        kart.checkpoint = 0;
        this.events.push({ type: 'lap', kartId: kart.id, lap: kart.lap });
        if (kart.lap > this.totalLaps && !kart.finished) {
          kart.finished = true;
          kart.finishTimeSec = Number(this.elapsedSec.toFixed(2));
          this.events.push({ type: 'finish', kartId: kart.id });
        }
      }
      kart.trackS = newS;
      const effectiveLap = kart.lap - 1;
      // Handle start line where karts begin at s ~ 0.985 on lap 1 with checkpoint 0
      const lapFraction = (kart.checkpoint === 0 && newS > 0.85) ? (newS - 1.0) : newS;
      kart.totalProgress = effectiveLap + lapFraction;

      this._stuckWatch(kart, rawInput, dt);

      // Check boost pads
      for (const pad of this.track.boostPads) {
        if (Math.hypot(kart.x - pad.x, kart.z - pad.z) < pad.radius) {
          if (kart.padBoostTimer <= 0.1) {
            this.events.push({ type: 'pad_boost', kartId: kart.id });
          }
          kart.padBoostTimer = 1.25;
          kart.turboCharge = Math.min(100, kart.turboCharge + 8 * dt);
        }
      }

      // Check jump ramps. The ramp is drawn as a 5.2 x 4.6 wedge whose high edge faces the driving
      // direction (renderer: rotation order YXZ, front rises), so the launch zone is the front half of
      // that footprint, in the ramp's own frame, for karts travelling roughly along it.
      for (const ramp of this.track.ramps) {
        if (kart.y > 0.1 || kart.speed <= 12) continue;
        const rx = kart.x - ramp.x;
        const rz = kart.z - ramp.z;
        const along = rx * ramp.tx + rz * ramp.tz;
        const side = rx * -ramp.tz + rz * ramp.tx;
        const facing = Math.sin(kart.heading) * ramp.tx + Math.cos(kart.heading) * ramp.tz;
        if (along > 0.4 && along < 3.2 && Math.abs(side) < 2.9 && facing > 0.3) {
          kart.vy = 9.5;
          kart.padBoostTimer = Math.max(kart.padBoostTimer, 0.9);
          kart.turboCharge = Math.min(100, kart.turboCharge + 8);
          this.events.push({ type: 'ramp_jump', kartId: kart.id });
        }
      }

      // Check wooden `?` item crates
      for (const crate of this.crates) {
        if (!crate.active || kart.finished) continue;
        if (Math.hypot(kart.x - crate.x, kart.z - crate.z) < 2.2) {
          crate.active = false;
          crate.respawnTimer = 6.0;
          kart.statsSummary.cratesSmashed++;
          kart.turboCharge = Math.min(100, kart.turboCharge + 8);
          if (!kart.heldItem) {
            kart.heldItem = this._chooseItemForRank(kart.rank);
            kart.aiItemTimer = (1.2 + this.rng() * 1.5) * this.diff.itemDelay;
            kart.aiNoUse = kart.isAI && this.rng() > this.diff.itemUse;
          }
          this.events.push({ type: 'crate_smash', kartId: kart.id, item: kart.heldItem, x: crate.x, z: crate.z });
        }
      }

      // Check Mango fruits
      for (const fruit of this.fruits) {
        if (kart.finished || fruit.cool[kart.id] > 0) continue;
        if (Math.hypot(kart.x - fruit.x, kart.z - fruit.z) < 2.0) {
          fruit.cool[kart.id] = 8.0;
          kart.mango = Math.min(10, kart.mango + 1);
          kart.turboCharge = Math.min(100, kart.turboCharge + 4);
          this.events.push({ type: 'fruit_pickup', kartId: kart.id });
        }
      }
    }

    // Kart-to-kart gentle bump separation
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i];
        const b = this.karts[j];
        if (a.finished || b.finished) continue; // finished karts cruise on as ghosts and never block
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minDist = 2.2;
        if (dist > 0.001 && dist < minDist) {
          // Karts slide off each other sideways. Pushing along the line of travel would teleport the
          // follower backwards and the leader forwards, which hands the front-runner a free advantage.
          const hx = Math.sin(a.heading) + Math.sin(b.heading);
          const hz = Math.cos(a.heading) + Math.cos(b.heading);
          const hl = Math.hypot(hx, hz) || 1;
          const fx = hx / hl;
          const fz = hz / hl;
          const rx = fz;
          const rz = -fx;
          const along = dx * fx + dz * fz;
          let lat = dx * rx + dz * rz;
          if (Math.abs(lat) < 0.05) lat = (i + j) % 2 === 0 ? 0.05 : -0.05;
          const overlap = minDist - dist;
          const sl = Math.sign(lat);
          const sa = Math.sign(along) || 1;
          const pl = overlap * 0.5 * 0.9;
          const pa = overlap * 0.5 * 0.1;
          a.x -= (rx * sl * pl + fx * sa * pa);
          a.z -= (rz * sl * pl + fz * sa * pa);
          b.x += (rx * sl * pl + fx * sa * pa);
          b.z += (rz * sl * pl + fz * sa * pa);
        }
      }
    }

    // Update projectiles (Homing Rocket & Bowling Bomb)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.type === 'rocket') {
        // Home toward nearest opponent ahead
        let target = null;
        let bestD = 60;
        for (const k of this.karts) {
          if (k.id === p.ownerId || k.spinOutTimer > 0 || k.finished) continue;
          const ddx = k.x - p.x;
          const ddz = k.z - p.z;
          // only chase karts in front of the rocket
          if (ddx * Math.sin(p.heading) + ddz * Math.cos(p.heading) < 0) continue;
          const d = Math.hypot(ddx, ddz);
          if (d < bestD) {
            bestD = d;
            target = k;
          }
        }
        if (target) {
          const desired = Math.atan2(target.x - p.x, target.z - p.z);
          const diff = wrapAngle(desired - p.heading);
          p.heading = wrapAngle(p.heading + clamp(diff, -3.2 * dt, 3.2 * dt));
          p.vx = Math.sin(p.heading) * 52;
          p.vz = Math.cos(p.heading) * 52;
        }
      }

      if (p.type === 'bomb') {
        // A bowling bomb rolls along the road in its own lane instead of sailing off into the
        // scenery at the first bend.
        const n = this._findNearestSample(p.x, p.z);
        const ahead = this.track.getPointAt(n.sample.s + 0.012);
        const lane = clamp((p.x - n.sample.x) * n.sample.rx + (p.z - n.sample.z) * n.sample.rz, -this.track.roadWidth * 0.5 + 2, this.track.roadWidth * 0.5 - 2);
        const aimX = ahead.x + ahead.rx * lane;
        const aimZ = ahead.z + ahead.rz * lane;
        const want = Math.atan2(aimX - p.x, aimZ - p.z);
        p.heading = wrapAngle(p.heading + clamp(wrapAngle(want - p.heading), -4.5 * dt, 4.5 * dt));
        p.vx = Math.sin(p.heading) * 44;
        p.vz = Math.cos(p.heading) * 44;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;

      // Check collision with karts
      let hit = false;
      for (const k of this.karts) {
        if (k.id === p.ownerId || k.finished) continue;
        if (Math.hypot(k.x - p.x, k.z - p.z) < 2.2) {
          if (this._applyHit(k, p.ownerId, p.type)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        this.projectiles.splice(i, 1);
      }
    }

    // Update TNT hazards on track
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.ttl -= dt;
      if (h.ttl <= 0) {
        this.hazards.splice(i, 1);
        continue;
      }
      for (const k of this.karts) {
        if (k.finished || (k.id === h.ownerId && h.ttl > 17.2)) continue; // grace period for dropper
        if (Math.hypot(k.x - h.x, k.z - h.z) < 2.1 && k.y < 1.2) {
          if (this._applyHit(k, h.ownerId, 'tnt')) {
            this.hazards.splice(i, 1);
            break;
          }
        }
      }
    }

    // Compute rankings 1..N
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTimeSec - b.finishTimeSec;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
    sorted.forEach((k, idx) => {
      k.rank = idx + 1;
    });

    // End race when all human players finish, or CLOSE_AFTER seconds after the first kart
    // finished (so a human who is far behind or has stopped does not hold the race open forever).
    const humans = this.karts.filter((k) => !k.isAI);
    if (humans.length > 0 && humans.every((h) => h.finished)) {
      this.finishDelay += dt;
      if (this.finishDelay >= 3.0) this.status = 'finished';
    }
    if (this.status === 'racing' && this.karts.some((k) => k.finished)) {
      const before = this.closeTimer;
      this.closeTimer += dt;
      for (const mark of [30, 10]) {
        if (CLOSE_AFTER - before > mark && CLOSE_AFTER - this.closeTimer <= mark) this.events.push({ type: 'closing', secs: mark });
      }
      if (this.closeTimer >= CLOSE_AFTER) this.status = 'finished';
    }

    return this.getSnapshot();
  }

  // Safety net: a kart that wants to move but has made no progress along the track for
  // STUCK_WINDOW seconds is put back on the road, facing forward, with a short blink.
  // (Humans who deliberately brake or reverse are left alone.)
  _stuckWatch(kart, input, dt) {
    if (kart.finished || kart.spinOutTimer > 0 || kart.y > 0.1) {
      kart.stuckT = 0;
      kart.stuckMark = kart.totalProgress;
      kart.wantsGo = true;
      return;
    }
    const wants = kart.isAI || (input.throttle > 0 && !input.brake && !input.reverse);
    kart.wantsGo = kart.wantsGo && wants;
    kart.stuckT += dt;
    if (kart.stuckT < STUCK_WINDOW) return;
    const moved = kart.totalProgress - kart.stuckMark;
    const stuck = kart.wantsGo && moved < STUCK_MIN_PROGRESS;
    kart.stuckT = 0;
    kart.stuckMark = kart.totalProgress;
    kart.wantsGo = true;
    if (stuck) this._resetKart(kart);
  }

  _resetKart(kart) {
    const n = this._findNearestSample(kart.x, kart.z).sample;
    const half = this.track.roadWidth * 0.5 - 3;
    const lat = clamp((kart.x - n.x) * n.rx + (kart.z - n.z) * n.rz, -half, half);
    kart.x = n.x + n.rx * lat;
    kart.z = n.z + n.rz * lat;
    kart.heading = Math.atan2(n.tx, n.tz);
    kart.speed = 10;
    kart.y = 0;
    kart.vy = 0;
    kart.invulnTimer = Math.max(kart.invulnTimer, 1.5);
    kart.resets++;
    this.events.push({ type: 'reset', kartId: kart.id, x: kart.x, z: kart.z });
  }

  _applyHit(targetKart, attackerId, item = null) {
    if (targetKart.invulnTimer > 0 || targetKart.spinOutTimer > 0) return false;
    if (targetKart.shieldTimer > 0) {
      targetKart.shieldTimer = 0;
      targetKart.invulnTimer = 0.6;
      this.events.push({ type: 'shield_block', kartId: targetKart.id, x: targetKart.x, z: targetKart.z });
      return true;
    }
    targetKart.spinOutTimer = SPIN_TIME;
    targetKart.spinBase = targetKart.heading;
    targetKart.invulnTimer = 2.4;
    targetKart.speed *= 0.55;
    targetKart.mango = Math.max(0, targetKart.mango - 2);
    const attacker = this.karts.find((k) => k.id === attackerId);
    if (attacker) attacker.statsSummary.hitsLanded++;
    this.events.push({ type: 'explosion', kartId: targetKart.id, attackerId, item, x: targetKart.x, z: targetKart.z });
    return true;
  }

  getSnapshot() {
    return {
      trackId: this.track.id,
      status: this.status,
      countdown: Number(this.countdown.toFixed(2)),
      elapsedSec: Number(this.elapsedSec.toFixed(2)),
      totalLaps: this.totalLaps,
      karts: this.karts.map((k) => ({
        id: k.id,
        name: k.name,
        driverId: k.driverId,
        isAI: k.isAI,
        x: Number(k.x.toFixed(2)),
        y: Number(k.y.toFixed(2)),
        z: Number(k.z.toFixed(2)),
        heading: Number(k.heading.toFixed(3)),
        speed: Number(k.speed.toFixed(2)),
        steerAngle: Number(k.steerAngle.toFixed(2)),
        lap: Math.min(this.totalLaps, k.lap),
        rank: k.rank,
        mango: k.mango,
        turboCharge: Math.round(k.turboCharge),
        turboActive: k.turboActiveTimer > 0 || k.padBoostTimer > 0,
        spinOut: k.spinOutTimer > 0,
        shieldActive: k.shieldTimer > 0,
        invuln: k.invulnTimer > 0,
        heldItem: k.heldItem,
        punching: k.punchAnimTimer > 0,
        finished: k.finished,
        finishTimeSec: k.finishTimeSec,
        statsSummary: k.statsSummary,
        resets: k.resets,
      })),
      crates: this.crates.map((c) => ({ id: c.id, x: c.x, y: c.y, z: c.z, active: c.active })),
      fruits: this.fruits.map((f) => ({ id: f.id, x: f.x, y: f.y, z: f.z, active: f.active })),
      projectiles: this.projectiles.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z, heading: p.heading })),
      hazards: this.hazards.map((h) => ({ id: h.id, type: h.type, x: h.x, y: h.y, z: h.z })),
      closeIn: this.closeTimer > 0 ? Number(Math.max(0, CLOSE_AFTER - this.closeTimer).toFixed(1)) : null,
      events: [...this.events],
    };
  }
}

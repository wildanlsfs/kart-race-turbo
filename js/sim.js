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

export class RaceSimulation {
  constructor({ trackId = 'island', mode = '1p', players = [], totalLaps = 3, fillAI = true } = {}) {
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

    this.karts = roster.map((p, idx) => {
      const driver = DRIVERS.find((d) => d.id === p.driverId) || DRIVERS[idx % DRIVERS.length];
      const laneOffset = ((idx % 2 === 0 ? -1 : 1) * 2.6) + (idx >= 2 ? 0.5 : -0.5);
      const rowBack = Math.floor(idx / 2) * 4.2;
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
        rank: idx + 1,
        wumpa: 0,
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
        aiTargetOffset: (idx - 1.5) * 1.4,
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
    }));

    this.projectiles = [];
    this.hazards = [];
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

  _computeAIInput(kart) {
    const lookAheadS = (kart.trackS + 0.045) % 1;
    const targetPt = this.track.getPointAt(lookAheadS);
    const tx = targetPt.x + targetPt.rx * kart.aiTargetOffset;
    const tz = targetPt.z + targetPt.rz * kart.aiTargetOffset;
    const desiredHeading = Math.atan2(tx - kart.x, tz - kart.z);
    const diff = wrapAngle(desiredHeading - kart.heading);
    const steer = clamp(-diff * 1.9, -1, 1);

    const turbo = kart.turboCharge >= 65 && Math.abs(steer) < 0.25;
    const attack = Boolean(kart.heldItem && Math.random() < 0.08);
    return {
      throttle: 1,
      brake: false,
      reverse: false,
      steer,
      turbo,
      attack,
      hop: false,
    };
  }

  _chooseItemForRank(rank) {
    if (rank === 1) {
      return Math.random() < 0.55 ? 'tnt' : (Math.random() < 0.5 ? 'shield' : 'bomb');
    }
    if (rank === 2) {
      return ITEMS[Math.floor(Math.random() * ITEMS.length)];
    }
    return Math.random() < 0.6 ? 'rocket' : (Math.random() < 0.5 ? 'shield' : 'bomb');
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
        id: `tnt_${Date.now()}_${Math.random()}`,
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
      id: `proj_${Date.now()}_${Math.random()}`,
      ownerId: kart.id,
      type: item, // 'rocket' | 'bomb'
      x: kart.x + fwdX * 2.5,
      y: 0.7,
      z: kart.z + fwdZ * 2.5,
      vx: fwdX * (item === 'rocket' ? 52 : 46),
      vz: fwdZ * (item === 'rocket' ? 52 : 46),
      heading: kart.heading,
      ttl: 4.5,
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
    for (const f of this.fruits) {
      if (!f.active) {
        f.respawnTimer -= dt;
        if (f.respawnTimer <= 0) f.active = true;
      }
    }

    // Update each kart
    for (const kart of this.karts) {
      const rawInput = (kart.isAI || kart.finished)
        ? this._computeAIInput(kart)
        : (inputsById[kart.id] || { throttle: 0, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false });

      if (kart.punchAnimTimer > 0) kart.punchAnimTimer = Math.max(0, kart.punchAnimTimer - dt);
      if (kart.shieldTimer > 0) kart.shieldTimer = Math.max(0, kart.shieldTimer - dt);
      if (kart.turboActiveTimer > 0) kart.turboActiveTimer = Math.max(0, kart.turboActiveTimer - dt);
      if (kart.padBoostTimer > 0) kart.padBoostTimer = Math.max(0, kart.padBoostTimer - dt);

      if (kart.spinOutTimer > 0) {
        kart.spinOutTimer = Math.max(0, kart.spinOutTimer - dt);
        kart.speed *= Math.max(0, 1 - 4.0 * dt);
        kart.heading = wrapAngle(kart.heading + 11.0 * dt);
      } else {
        // Hop / ramp jump
        if (rawInput.hop && kart.y <= 0.01) {
          kart.vy = 7.5;
          kart.turboCharge = Math.min(100, kart.turboCharge + 6);
          this.events.push({ type: 'hop', kartId: kart.id });
        }

        // Trigger Turbo if charged >= 25%
        if (rawInput.turbo && kart.turboCharge >= 25 && kart.turboActiveTimer <= 0.05) {
          kart.turboActiveTimer = 1.65;
          kart.turboCharge = Math.max(0, kart.turboCharge - 35);
          kart.statsSummary.turbosUsed++;
          this.events.push({ type: 'turbo', kartId: kart.id });
        }

        if (kart.turboActiveTimer > 0) {
          kart.turboCharge = Math.max(0, kart.turboCharge - 12 * dt);
        }

        // Fire item on punch/attack
        if (rawInput.attack && kart.heldItem) {
          this._fireItem(kart);
        }

        // Nearest track check for off-road slowdown & gentle boundary push
        const nearest = this._findNearestSample(kart.x, kart.z);
        const halfRoad = this.track.roadWidth * 0.5;
        const offRoad = nearest.dist > halfRoad + 1.2;

        const wumpaBonus = Math.min(10, kart.wumpa) * 0.25;
        const boostBonus = (kart.turboActiveTimer > 0 ? kart.driver.stats.boostBonus : 0) + (kart.padBoostTimer > 0 ? 11 : 0);
        const effectiveTopSpeed = (kart.baseTopSpeed + wumpaBonus + boostBonus) * (offRoad && kart.turboActiveTimer <= 0 ? 0.72 : 1.0);

        if (rawInput.reverse) {
          kart.speed = Math.max(-12, kart.speed - 28 * dt);
        } else if (rawInput.brake) {
          kart.speed = Math.max(0, kart.speed - 38 * dt);
        } else if (rawInput.throttle > 0 || kart.turboActiveTimer > 0 || kart.padBoostTimer > 0) {
          const accel = kart.driver.stats.accel + (kart.turboActiveTimer > 0 ? 22 : 0);
          kart.speed = Math.min(effectiveTopSpeed, kart.speed + accel * dt);
        } else {
          // Natural coasting drag
          kart.speed *= Math.max(0, 1 - 1.8 * dt);
        }

        // Clamp down gently if above effectiveTopSpeed
        if (kart.speed > effectiveTopSpeed) {
          kart.speed = Math.max(effectiveTopSpeed, kart.speed - 18 * dt);
        }

        // Track-Aligned Arcade Steering for smooth webcam play + boundary safety
        const steerInput = clamp(rawInput.steer || 0, -1, 1);
        kart.steerAngle = steerInput;
        const speedFactor = Math.min(1, Math.abs(kart.speed) / 8 + 0.25);
        const reverseFlip = kart.speed < -0.5 ? -1 : 1;

        if (!kart.isAI && !rawInput.reverse && kart.speed >= -0.2) {
          const s = nearest.sample;
          const trackHeading = Math.atan2(s.tx, s.tz);
          const lateralOffset = (kart.x - s.x) * s.rx + (kart.z - s.z) * s.rz;
          const softMargin = halfRoad - 1.6;
          let effectiveSteer = steerInput;
          let edgePush = 0;
          if (Math.abs(lateralOffset) > softMargin) {
            const excess = Math.abs(lateralOffset) - softMargin;
            if (Math.sign(steerInput) === Math.sign(lateralOffset)) {
              effectiveSteer *= clamp(1 - excess / 1.4, 0, 1);
            }
            edgePush = Math.sign(lateralOffset) * clamp(excess * 0.28, 0, 0.42);
          }
          const desiredHeading = wrapAngle(trackHeading - effectiveSteer * 0.58 + edgePush);
          const headingErr = wrapAngle(desiredHeading - kart.heading);
          const alignRate = (Math.abs(effectiveSteer) > 0.05 ? kart.driver.stats.handling * 1.55 : 5.2) * speedFactor;
          kart.heading = wrapAngle(kart.heading + headingErr * Math.min(1, alignRate * dt));
        } else {
          const turnRate = kart.driver.stats.handling * (Math.abs(steerInput) > 0.6 ? 1.15 : 1.0);
          kart.heading = wrapAngle(kart.heading - steerInput * turnRate * speedFactor * reverseFlip * dt);
        }

        // Charge turbo gradually from hard cornering / drifting at speed
        if (Math.abs(steerInput) > 0.45 && kart.speed > 18) {
          kart.turboCharge = Math.min(100, kart.turboCharge + 14 * dt);
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

      // Soft guardrail at outer track edge so players never get lost off the map
      const nearestAfter = this._findNearestSample(kart.x, kart.z);
      const maxDist = this.track.roadWidth * 0.5 + 3.5;
      if (nearestAfter.dist > maxDist) {
        const s = nearestAfter.sample;
        const dx = kart.x - s.x;
        const dz = kart.z - s.z;
        const len = Math.hypot(dx, dz) || 1;
        kart.x = s.x + (dx / len) * maxDist;
        kart.z = s.z + (dz / len) * maxDist;
        kart.heading = wrapAngle(kart.heading + wrapAngle(Math.atan2(s.tx, s.tz) - kart.heading) * 0.45);
        kart.speed *= 0.88;
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

      // Check boost pads
      for (const pad of this.track.boostPads) {
        if (Math.hypot(kart.x - pad.x, kart.z - pad.z) < pad.radius) {
          if (kart.padBoostTimer <= 0.1) {
            this.events.push({ type: 'pad_boost', kartId: kart.id });
          }
          kart.padBoostTimer = 1.25;
          kart.turboCharge = Math.min(100, kart.turboCharge + 18 * dt);
        }
      }

      // Check jump ramps
      for (const ramp of this.track.ramps) {
        if (kart.y <= 0.1 && Math.hypot(kart.x - ramp.x, kart.z - ramp.z) < ramp.radius && kart.speed > 12) {
          kart.vy = 9.5;
          kart.padBoostTimer = Math.max(kart.padBoostTimer, 0.9);
          kart.turboCharge = Math.min(100, kart.turboCharge + 15);
          this.events.push({ type: 'ramp_jump', kartId: kart.id });
        }
      }

      // Check wooden `?` item crates
      for (const crate of this.crates) {
        if (!crate.active) continue;
        if (Math.hypot(kart.x - crate.x, kart.z - crate.z) < 2.2) {
          crate.active = false;
          crate.respawnTimer = 6.0;
          kart.statsSummary.cratesSmashed++;
          kart.turboCharge = Math.min(100, kart.turboCharge + 15);
          if (!kart.heldItem) {
            kart.heldItem = this._chooseItemForRank(kart.rank);
          }
          this.events.push({ type: 'crate_smash', kartId: kart.id, item: kart.heldItem, x: crate.x, z: crate.z });
        }
      }

      // Check Wumpa fruits
      for (const fruit of this.fruits) {
        if (!fruit.active) continue;
        if (Math.hypot(kart.x - fruit.x, kart.z - fruit.z) < 2.0) {
          fruit.active = false;
          fruit.respawnTimer = 8.0;
          kart.wumpa = Math.min(10, kart.wumpa + 1);
          kart.turboCharge = Math.min(100, kart.turboCharge + 10);
          this.events.push({ type: 'fruit_pickup', kartId: kart.id });
        }
      }
    }

    // Kart-to-kart gentle bump separation
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i];
        const b = this.karts[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minDist = 2.2;
        if (dist > 0.001 && dist < minDist) {
          const push = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
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
        let bestD = 45;
        for (const k of this.karts) {
          if (k.id === p.ownerId || k.spinOutTimer > 0) continue;
          const d = Math.hypot(k.x - p.x, k.z - p.z);
          if (d < bestD) {
            bestD = d;
            target = k;
          }
        }
        if (target) {
          const desired = Math.atan2(target.x - p.x, target.z - p.z);
          const diff = wrapAngle(desired - p.heading);
          p.heading = wrapAngle(p.heading + clamp(diff, -4.5 * dt, 4.5 * dt));
          p.vx = Math.sin(p.heading) * 52;
          p.vz = Math.cos(p.heading) * 52;
        }
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      // Check collision with karts
      let hit = false;
      for (const k of this.karts) {
        if (k.id === p.ownerId) continue;
        if (Math.hypot(k.x - p.x, k.z - p.z) < 2.2) {
          this._applyHit(k, p.ownerId);
          hit = true;
          break;
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
        if (k.id === h.ownerId && h.ttl > 17.2) continue; // grace period for dropper
        if (Math.hypot(k.x - h.x, k.z - h.z) < 2.1 && k.y < 1.2) {
          this._applyHit(k, h.ownerId);
          this.hazards.splice(i, 1);
          break;
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

    // End race when all human players finish
    const humans = this.karts.filter((k) => !k.isAI);
    if (humans.length > 0 && humans.every((h) => h.finished)) {
      this.status = 'finished';
    }

    return this.getSnapshot();
  }

  _applyHit(targetKart, attackerId) {
    if (targetKart.shieldTimer > 0) {
      targetKart.shieldTimer = 0;
      this.events.push({ type: 'shield_block', kartId: targetKart.id, x: targetKart.x, z: targetKart.z });
      return;
    }
    targetKart.spinOutTimer = 1.15;
    targetKart.speed *= 0.25;
    targetKart.wumpa = Math.max(0, targetKart.wumpa - 2);
    const attacker = this.karts.find((k) => k.id === attackerId);
    if (attacker) attacker.statsSummary.hitsLanded++;
    this.events.push({ type: 'explosion', kartId: targetKart.id, x: targetKart.x, z: targetKart.z });
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
        wumpa: k.wumpa,
        turboCharge: Math.round(k.turboCharge),
        turboActive: k.turboActiveTimer > 0 || k.padBoostTimer > 0,
        spinOut: k.spinOutTimer > 0,
        shieldActive: k.shieldTimer > 0,
        heldItem: k.heldItem,
        punching: k.punchAnimTimer > 0,
        finished: k.finished,
        finishTimeSec: k.finishTimeSec,
        statsSummary: k.statsSummary,
      })),
      crates: this.crates.map((c) => ({ id: c.id, x: c.x, y: c.y, z: c.z, active: c.active })),
      fruits: this.fruits.map((f) => ({ id: f.id, x: f.x, y: f.y, z: f.z, active: f.active })),
      projectiles: this.projectiles.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z, heading: p.heading })),
      hazards: this.hazards.map((h) => ({ id: h.id, type: h.type, x: h.x, y: h.y, z: h.z })),
      events: [...this.events],
    };
  }
}

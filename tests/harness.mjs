// Shared helpers for deterministic balance / fairness runs (used by tests and tools/balance.mjs).
import { RaceSimulation, TRACKS, DRIVERS, mulberry32 } from '../js/sim.js';

export { TRACKS, DRIVERS, mulberry32, RaceSimulation };

export const IDLE = { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false };
export const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A competent human: auto-gas, steers towards a look-ahead point on the centre line with a proportional
// controller (what a good player does with the pad), uses turbo on straights, fires items now and then.
// `lane` shifts the aimed line (metres, right positive), `lift` lets it brake for very sharp bends.
export function competentBot(sim, k, { rng = Math.random, turbo = true, lane = 0, lift = false } = {}) {
  const look = 0.028 + Math.max(0, k.speed) * 0.0011;
  const tp = sim.track.getPointAt(k.trackS + look);
  const tx = tp.x + tp.rx * lane;
  const tz = tp.z + tp.rz * lane;
  const diff = wrap(Math.atan2(tx - k.x, tz - k.z) - k.heading);
  const steer = clamp(-diff * 2.2, -1, 1);
  let brake = false;
  if (lift) {
    const a = sim.track.getPointAt(k.trackS);
    const b = sim.track.getPointAt(k.trackS + 0.07);
    const bend = Math.abs(wrap(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)));
    brake = k.speed > clamp(40 - bend * 13, 22, 40) + 6;
  }
  return {
    ...IDLE, steer, brake, throttle: brake ? 0 : 1,
    turbo: turbo && k.turboCharge >= 55 && Math.abs(steer) < 0.25,
    attack: Boolean(k.heldItem) && rng() < 0.03,
  };
}

function finishOrder(sim) {
  return [...sim.karts].sort((a, b) => (a.finished ? a.finishTimeSec : 1e9) - (b.finished ? b.finishTimeSec : 1e9) || b.totalProgress - a.totalProgress);
}

// Race with a given roster. `controller(sim, kart, rng)` returns the input for human karts
// (null = leave to the sim). Returns finishing order (driver ids), per-kart info.
export function runRace({ trackId, drivers, humans = [], seed = 1, difficulty = 'normal', laps = 3, controller = competentBot, maxSec = 260, dt = 1 / 30 }) {
  const rng = mulberry32(seed * 7919 + 13);
  const players = drivers.map((d, i) => ({ id: `k${i}`, name: d, driverId: d, isAI: !humans.includes(i) }));
  const sim = new RaceSimulation({ trackId, players, totalLaps: laps, fillAI: false, difficulty, rng });
  sim.countdown = 0; sim.status = 'racing';
  let t = 0;
  while (sim.status !== 'finished' && t < maxSec) {
    const inputs = {};
    for (const i of humans) {
      const k = sim.karts[i];
      if (!k.finished) inputs[k.id] = controller(sim, k, rng);
    }
    sim.step(dt, inputs);
    t += dt;
  }
  const order = finishOrder(sim);
  return { sim, order, ids: order.map((k) => k.id), drivers: order.map((k) => k.driverId), time: t };
}

// Fisher-Yates with the seeded rng so start slots are randomised per seed.
export function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Field of all four drivers, all driven by the same controller (or all AI when humans = false), random slots.
export function equalsField({ trackId, seed, mode = 'bot', difficulty = 'normal', laps = 3, controller }) {
  const r = mulberry32(seed * 104729 + 5);
  const drivers = shuffled(DRIVERS.map((d) => d.id), r);
  const humans = mode === 'bot' ? [0, 1, 2, 3] : [];
  const res = runRace({ trackId, drivers, humans, seed, difficulty, laps, controller });
  return { winner: res.drivers[0], slotOfWinner: drivers.indexOf(res.drivers[0]), drivers, res };
}

// One human (idle or bot) of driver `driverId` in a field with 3 AI. Returns the human's final rank 1..4.
export function humanVsAI({ trackId, driverId, seed, mode = 'idle', difficulty = 'normal', laps = 3, humanSlot = 3 }) {
  const rng = mulberry32(seed * 31337 + 1);
  const others = shuffled(DRIVERS.map((d) => d.id).filter((d) => d !== driverId), rng);
  const drivers = [...others];
  drivers.splice(humanSlot, 0, driverId);
  const ctl = mode === 'idle' ? () => IDLE : competentBot;
  const res = runRace({ trackId, drivers, humans: [humanSlot], seed, difficulty, laps, controller: ctl });
  const me = res.sim.karts[humanSlot];
  return { rank: res.order.indexOf(me) + 1, finished: me.finished, time: me.finishTimeSec, res };
}

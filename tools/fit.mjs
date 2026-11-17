// Grid-fits (accel, handling) of one driver so its solo bot lap times match Rufus on every track.
// node tools/fit.mjs jet 30.4   (top speed fixed by identity)
import { TRACKS, DRIVERS, runRace, competentBot } from '../tests/harness.mjs';
const [id, top] = [process.argv[2], Number(process.argv[3])];
const HIT = Number(process.env.HIT || 0); // seconds between artificial hits (what a pack does to a kart)
let nextHit = HIT;
const bot = (s, k, rg) => { if (HIT && s.elapsedSec >= nextHit) { nextHit += HIT; s._applyHit(k, 'x'); } return { ...competentBot(s, k, { rng: rg }), attack: false }; };
const time = (drv, t) => { nextHit = HIT; return runRace({ trackId: t.id, drivers: [drv], humans: [0], seed: 1, laps: 2, dt: 1 / 30, controller: bot }).sim.karts[0].finishTimeSec; };
const ref = {}; for (const t of TRACKS) ref[t.id] = time('rufus', t);
const d = DRIVERS.find((x) => x.id === id);
const res = [];
for (let acc = 18; acc <= 36; acc += 2) for (let h = 3.4; h <= 5.21; h += 0.2) {
  Object.assign(d.stats, { topSpeed: top, accel: acc, handling: Number(h.toFixed(2)) });
  const dev = TRACKS.map((t) => time(id, t) / ref[t.id] - 1);
  res.push({ acc, h: Number(h.toFixed(2)), dev, score: Math.max(...dev.map(Math.abs)) });
}
res.sort((a, b) => a.score - b.score);
for (const r of res.slice(0, 6)) console.log(id, top, 'accel', r.acc, 'handling', r.h, r.dev.map((x) => (x * 100).toFixed(2) + '%').join(' '));

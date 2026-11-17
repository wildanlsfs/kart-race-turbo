// node tools/sweep.mjs  -> solo bot lap times (3 laps, turbo on, no items) with the current DRIVERS stats
import { TRACKS, DRIVERS, runRace, competentBot } from '../tests/harness.mjs';
const rows = {};
for (const t of TRACKS) {
  const times = DRIVERS.map((d) => runRace({ trackId: t.id, drivers: [d.id], humans: [0], seed: 1, laps: 3, dt: 1 / 60,
    controller: (s, k, rg) => ({ ...competentBot(s, k, { rng: rg }), attack: false }) }).sim.karts[0].finishTimeSec);
  const best = Math.min(...times);
  console.log(t.id.padEnd(7), DRIVERS.map((d, i) => `${d.id} ${times[i].toFixed(1)} (+${((times[i] / best - 1) * 100).toFixed(1)}%)`).join('  '));
}

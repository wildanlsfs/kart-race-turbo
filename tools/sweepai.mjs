import { TRACKS, DRIVERS, runRace } from '../tests/harness.mjs';
for (const t of TRACKS) {
  const times = DRIVERS.map((d) => { let s = 0; for (const seed of [1, 2, 3]) s += runRace({ trackId: t.id, drivers: [d.id], humans: [], seed, laps: 3, dt: 1 / 60 }).sim.karts[0].finishTimeSec; return s / 3; });
  const best = Math.min(...times);
  console.log(t.id.padEnd(7), DRIVERS.map((d, i) => `${d.id} ${times[i].toFixed(1)} (+${((times[i] / best - 1) * 100).toFixed(1)}%)`).join('  '));
}

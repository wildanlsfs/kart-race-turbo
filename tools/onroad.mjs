// Share of racing frames each kart centre is within half the road, and the worst excess, per track x driver.
// node tools/onroad.mjs bot|ai [difficulty]
import { TRACKS, DRIVERS, RaceSimulation, competentBot, mulberry32 } from '../tests/harness.mjs';
export function measure(trackId, driverId, mode, difficulty = 'normal', seed = 5, laps = 2) {
  const rng = mulberry32(seed);
  const t = TRACKS.find((x) => x.id === trackId);
  const sim = new RaceSimulation({ trackId, players: [{ id: 'k0', driverId, isAI: mode === 'ai' }], fillAI: false, totalLaps: laps, difficulty, rng });
  sim.countdown = 0; sim.status = 'racing';
  const k = sim.karts[0]; let frames = 0; let inside = 0; let maxEx = 0; let time = 0;
  while (!k.finished && time < 300) {
    sim.step(1 / 30, mode === 'bot' ? { k0: { ...competentBot(sim, k, { rng, turbo: true }), attack: false } } : {});
    time += 1 / 30; frames++;
    const d = sim._findNearestSample(k.x, k.z).dist - t.roadWidth / 2;
    if (d <= 0) inside++; maxEx = Math.max(maxEx, d);
  }
  return { share: inside / frames, maxEx, finished: k.finished };
}
if ((process.argv[1] || '').endsWith('onroad.mjs')) {
  const mode = process.argv[2] || 'bot'; const diff = process.argv[3] || 'normal';
  for (const t of TRACKS) console.log(t.id.padEnd(7), 'road', t.roadWidth, DRIVERS.map((d) => { const r = measure(t.id, d.id, mode, diff); return `${d.id} ${(100 * r.share).toFixed(0)}% max+${r.maxEx.toFixed(1)}`; }).join('  '));
}

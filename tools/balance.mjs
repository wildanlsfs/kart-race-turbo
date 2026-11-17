// Prints the balance and fairness tables used in docs/AUDIT.md.  node tools/balance.mjs [seeds]
import { TRACKS, DRIVERS, equalsField, humanVsAI } from '../tests/harness.mjs';
const N = Number(process.argv[2]) || 40;
const pct = (n) => `${Math.round((100 * n) / N)}%`;
for (const mode of ['bot', 'ai']) {
  console.log(`\n== equal field, all four drivers driven by ${mode === 'bot' ? 'the competent bot' : 'the AI'} (${N} seeds, random slots, Normal) ==`);
  const total = Object.fromEntries(DRIVERS.map((d) => [d.id, 0]));
  const slot = [0, 0, 0, 0];
  for (const t of TRACKS) {
    const w = Object.fromEntries(DRIVERS.map((d) => [d.id, 0]));
    for (let s = 1; s <= N; s++) { const r = equalsField({ trackId: t.id, seed: s, mode }); w[r.winner]++; total[r.winner]++; slot[r.slotOfWinner]++; }
    console.log(t.id.padEnd(8), DRIVERS.map((d) => `${d.id} ${pct(w[d.id])}`).join('  '));
  }
  console.log('overall '.padEnd(8), DRIVERS.map((d) => `${d.id} ${Math.round((100 * total[d.id]) / (N * 3))}%`).join('  '), ' winner by start slot', slot.map((x) => Math.round((100 * x) / (N * 3)) + '%').join('/'));
}
console.log('\n== human rank vs 3 AI (Normal), idle = auto-gas + zero steer; bot = competent bot ==');
for (const mode of ['idle', 'bot']) {
  for (const t of TRACKS) {
    const row = DRIVERS.map((d) => {
      const rs = []; const fin = [];
      for (let s = 1; s <= 8; s++) { const r = humanVsAI({ trackId: t.id, driverId: d.id, seed: s, mode }); rs.push(r.rank); fin.push(r.finished ? 'F' : '-'); }
      return `${d.id}:${rs.join('')}`;
    });
    console.log(mode.padEnd(5), t.id.padEnd(8), row.join('  '));
  }
}

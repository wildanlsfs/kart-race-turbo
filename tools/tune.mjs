// Parallel balance evaluator / tuner (worker threads).
//   node tools/tune.mjs eval '<stats json>' [seedFrom] [seedTo]   -> win-share tables for bot and AI fields
//   node tools/tune.mjs tune [iterations]                         -> random hill-climb on stats (seeds 1..48)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { TRACKS, DRIVERS, equalsField } from '../tests/harness.mjs';

const ids = DRIVERS.map((d) => d.id);
function apply(stats) { for (const [id, v] of Object.entries(stats)) Object.assign(DRIVERS.find((d) => d.id === id).stats, { topSpeed: v[0], accel: v[1], handling: v[2] }); }

if (!isMainThread) {
  const { stats, jobs } = workerData;
  apply(stats);
  const out = jobs.map(([trackId, seed, mode]) => { const r = equalsField({ trackId, seed, mode }); return [trackId, mode, r.winner, r.slotOfWinner]; });
  parentPort.postMessage(out);
} else {
  const self = fileURLToPath(import.meta.url);
  const NW = Math.max(2, Math.min(14, os.cpus().length - 2));
  const evalStats = async (stats, from, to) => {
    const jobs = [];
    for (const t of TRACKS) for (let s = from; s <= to; s++) for (const m of ['bot', 'ai']) jobs.push([t.id, s, m]);
    const chunks = Array.from({ length: NW }, () => []);
    jobs.forEach((j, i) => chunks[i % NW].push(j));
    const parts = await Promise.all(chunks.map((c) => new Promise((res, rej) => { const w = new Worker(self, { workerData: { stats, jobs: c } }); w.on('message', res); w.on('error', rej); })));
    const win = {}; const slot = { bot: [0, 0, 0, 0], ai: [0, 0, 0, 0] }; const n = to - from + 1;
    for (const p of parts) for (const [t, m, w, sl] of p) { win[`${m}/${t}/${w}`] = (win[`${m}/${t}/${w}`] || 0) + 1; slot[m][sl]++; }
    return { win, slot, n };
  };
  const share = (r, m, t, d) => (r.win[`${m}/${t}/${d}`] || 0) / r.n;
  const overall = (r, m, d) => TRACKS.reduce((a, t) => a + share(r, m, t.id, d), 0) / TRACKS.length;
  const print = (r) => {
    for (const m of ['bot', 'ai']) {
      console.log(`-- ${m === 'bot' ? 'competent bot x4' : 'AI x4'} (${r.n} seeds per track, random slots, Normal)`);
      for (const t of TRACKS) console.log('  ', t.id.padEnd(7), ids.map((d) => `${d} ${Math.round(100 * share(r, m, t.id, d))}%`).join('  '));
      console.log('   overall', ids.map((d) => `${d} ${Math.round(100 * overall(r, m, d))}%`).join('  '), '  winner by slot', r.slot[m].map((x) => Math.round(100 * x / (r.n * 3)) + '%').join('/'));
    }
  };
  const score = (r) => {
    // hinge penalties on the gates (per track 17..38 %, overall 19..32 %) plus a mild pull to 25 %
    let s = 0;
    for (const m of ['bot', 'ai']) {
      for (const t of TRACKS) for (const d of ids) { const x = share(r, m, t.id, d); s += (x - 0.25) ** 2 * 0.3; if (x < 0.19) s += (0.19 - x) ** 2 * 10; if (x > 0.37) s += (x - 0.37) ** 2 * 10; }
      for (const d of ids) { const x = overall(r, m, d); if (x > 0.31) s += (x - 0.31) ** 2 * 30; if (x < 0.19) s += (0.19 - x) ** 2 * 30; }
      for (let i = 0; i < 4; i++) { const x = r.slot[m][i] / (r.n * 3); if (x > 0.36) s += (x - 0.36) ** 2 * 20; }
    }
    return s;
  };
  const SEEDS = Number(process.env.SEEDS || 48);
  const cmd = process.argv[2];
  if (cmd === 'eval') {
    const stats = JSON.parse(process.argv[3] || '{}');
    const r = await evalStats(stats, Number(process.argv[4] || 1), Number(process.argv[5] || 48));
    print(r); console.log('score', score(r).toFixed(3));
  } else if (cmd === 'tune') {
    let best = Object.fromEntries(DRIVERS.map((d) => [d.id, [d.stats.topSpeed, d.stats.accel, d.stats.handling]]));
    const legal = (s) => {
      const tops = ids.map((i) => s[i][0]);
      const jetOk = s.jet[0] >= Math.max(s.rufus[0], s.maka[0], s.volt[0]) + 0.85;
      const volt = s.volt[1] >= Math.max(s.rufus[1], s.jet[1], s.maka[1]) + 3;
      const maka = s.maka[2] >= Math.max(s.rufus[2], s.jet[2], s.volt[2]) + 0.15;
      const bounds = ids.every((i) => s[i][0] > 27.5 && s[i][0] < 31.5 && s[i][1] >= 18 && s[i][1] <= 38 && s[i][2] >= 3.4 && s[i][2] <= 5.2);
      const hs = ids.map((i) => s[i][2]); const spread = Math.max(...hs) / Math.min(...hs) < 1.28;
      const accGap = s.volt[1] >= Math.max(s.rufus[1], s.jet[1], s.maka[1]) + 3;
      return jetOk && volt && maka && bounds && spread && accGap;
    };
    let bestScore = score(await evalStats(best, 1, SEEDS));
    console.log('start', bestScore.toFixed(3), JSON.stringify(best));
    const iters = Number(process.argv[3] || 30);
    for (let it = 0; it < iters; it++) {
      const cand = JSON.parse(JSON.stringify(best));
      const k = 1 + Math.floor(Math.random() * 2);
      for (let q = 0; q < k; q++) {
        const id = ids[Math.floor(Math.random() * 4)]; const p = Math.floor(Math.random() * 3);
        const step = [0.35, 2, 0.25][p];
        cand[id][p] = Number((cand[id][p] + (Math.random() * 2 - 1) * step * 2).toFixed(2));
      }
      if (!legal(cand)) continue;
      const sc = score(await evalStats(cand, 1, SEEDS));
      if (sc < bestScore) { best = cand; bestScore = sc; console.log('it', it, 'score', sc.toFixed(3), JSON.stringify(best)); }
    }
    console.log('FINAL', bestScore.toFixed(3), JSON.stringify(best));
  }
}

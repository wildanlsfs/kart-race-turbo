import { TRACKS, DRIVERS, runRace, competentBot, mulberry32 } from '../tests/harness.mjs';
const noItems = (sim,k,rng)=>({...competentBot(sim,k,{rng}),attack:false});
const lift = process.argv[2]==='lift';
for (const t of TRACKS) {
  const row=[];
  for (const d of DRIVERS) {
    const r = runRace({trackId:t.id, drivers:[d.id], humans:[0], seed:1, laps:3, controller:(s,k,rg)=>({...competentBot(s,k,{rng:rg,lift}),attack:false}), dt:1/60});
    row.push(`${d.id} ${r.sim.karts[0].finishTimeSec}`);
  }
  console.log(t.id.padEnd(8), row.join('  '), ' len', Math.round(t.totalLength));
}

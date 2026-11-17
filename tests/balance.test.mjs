import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DRIVERS } from '../js/sim.js';
import { equalsField } from './harness.mjs';

// Deterministic balance gates (seeded rng, random start slots, Normal difficulty).
// Every driver is driven by the SAME competent bot (look-ahead steering, turbo on straights, sensible item use),
// or by the AI brain, so only the driver stats differ. Seeds 1..SEEDS per track.
const SEEDS = 40;
const ids = DRIVERS.map((d) => d.id);

function table(mode) {
  const win = {}; const slot = [0, 0, 0, 0];
  for (const t of TRACKS) {
    win[t.id] = Object.fromEntries(ids.map((i) => [i, 0]));
    for (let s = 1; s <= SEEDS; s++) { const r = equalsField({ trackId: t.id, seed: s, mode }); win[t.id][r.winner]++; slot[r.slotOfWinner]++; }
  }
  return { win, slot };
}

for (const mode of ['bot', 'ai']) {
  test(`Balance (${mode === 'bot' ? 'competent bot' : 'AI'} drives all four): no driver wins more than 35 % overall or less than 15 % on any track, and the start slot does not decide the race`, () => {
    const { win, slot } = table(mode);
    const n = SEEDS * TRACKS.length;
    for (const id of ids) {
      const total = TRACKS.reduce((a, t) => a + win[t.id][id], 0) / n;
      assert.ok(total <= 0.35, `${id} wins ${(total * 100).toFixed(0)} % overall`);
      assert.ok(total >= 0.15, `${id} wins only ${(total * 100).toFixed(0)} % overall`);
      for (const t of TRACKS) assert.ok(win[t.id][id] / SEEDS >= 0.15, `${mode}/${t.id}: ${id} wins only ${Math.round((100 * win[t.id][id]) / SEEDS)} %`);
    }
    // grid slot of the winner: nobody may win more than 40 % from one slot, and the front row (slots 0-1) must not take over 60 %
    for (let i = 0; i < 4; i++) assert.ok(slot[i] / n <= 0.40, `slot ${i} wins ${(100 * slot[i] / n).toFixed(0)} %: ${slot}`);
    assert.ok((slot[0] + slot[1]) / n <= 0.6, `front row wins ${(100 * (slot[0] + slot[1]) / n).toFixed(0)} %: ${slot}`);
  });
}

test('Each driver keeps a distinct identity: Jet tops the speed stat, Volt the acceleration, Maka the handling, and the roles are different', () => {
  const best = (k) => DRIVERS.reduce((a, b) => (b.stats[k] > a.stats[k] ? b : a)).id;
  assert.equal(best('topSpeed'), 'jet');
  assert.equal(best('accel'), 'volt');
  assert.equal(best('handling'), 'maka');
  assert.equal(new Set(DRIVERS.map((d) => d.role)).size, 4);
  const spread = (k) => Math.max(...DRIVERS.map((d) => d.stats[k])) / Math.min(...DRIVERS.map((d) => d.stats[k]));
  assert.ok(spread('topSpeed') < 1.08 && spread('accel') < 1.5 && spread('handling') < 1.3, 'stats stay inside a fair band');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../js/vendor/three.module.min.js';
import { TRACKS } from '../js/sim.js';

// Same recipe as renderer.js buildTrack(): heading about Y first, then tilt about the ramp's own X axis.
function rampMatrix(r) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.95, 4.6));
  m.position.set(r.x, 0.32, r.z);
  m.rotation.order = 'YXZ';
  m.rotation.y = Math.atan2(r.tx, r.tz);
  m.rotation.x = -0.22;
  m.updateMatrixWorld(true);
  return m.matrixWorld;
}

test('Every ramp on every track rises toward the direction of travel with no sideways tilt (the sim launches at that high edge)', () => {
  for (const t of TRACKS) {
    for (const r of t.ramps) {
      const M = rampMatrix(r);
      const p = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
      const front = p(0, 0.475, 2.3); const back = p(0, 0.475, -2.3);
      const left = p(-2.6, 0.475, 0); const right = p(2.6, 0.475, 0);
      assert.ok(front.y > back.y + 1, `${t.id} ${r.id}: front ${front.y.toFixed(2)} must be higher than back ${back.y.toFixed(2)}`);
      assert.ok(Math.abs(left.y - right.y) < 1e-6, `${t.id} ${r.id}: no sideways tilt`);
      const fwd = (front.x - back.x) * r.tx + (front.z - back.z) * r.tz;
      assert.ok(fwd > 4, `${t.id} ${r.id}: the high edge is ahead along the road tangent (${fwd.toFixed(2)})`);
      // sim launch zone = front half in the road frame
      const along = (front.x - r.x) * r.tx + (front.z - r.z) * r.tz;
      assert.ok(along > 0.4 && along < 3.2);
    }
  }
});

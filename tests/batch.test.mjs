import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Resolve the importmap's "three" to the vendored build (the game does this in index.html).
const vendor = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '../js/vendor/three.module.min.js')).href;
registerHooks({
  resolve(spec, ctx, next) {
    return spec === 'three' ? { url: vendor, shortCircuit: true } : next(spec, ctx);
  },
});
const THREE = await import('three');
const { bakeFrame, StaticBatcher } = await import('../js/batch.js');

const toon = (hex) => new THREE.MeshToonMaterial({ color: hex });
function part(geo, hex, outline, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, toon(hex));
  m.position.set(...pos);
  m.userData.part = true;
  m.userData.outline = outline;
  m.castShadow = true;
  if (outline > 0) m.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide })));
  return m;
}

test('bakeFrame merges parts, keeps vertex colours and bakes the ink shell exactly', () => {
  const root = new THREE.Group();
  const g = new THREE.BoxGeometry(1, 1, 1);
  const a = part(g, '#ff0000', 0.1, [0, 0, 0]);
  const b = part(g, '#00ff00', 0.2, [5, 0, 0]);
  b.scale.set(2, 1, 1); // non-uniform scale: extrusion must happen before the scale
  root.add(a, b);
  const out = bakeFrame(root);
  assert.equal(out.geo.attributes.position.count, 48);
  assert.equal(out.inkGeo.attributes.position.count, 48);
  assert.equal(a.parent, null, 'consumed parts are detached');
  // colour attribute equals the material's (linear) colour
  const c0 = new THREE.Color('#ff0000');
  assert.ok(Math.abs(out.geo.attributes.color.getX(0) - c0.r) < 1e-6);
  // shell vertex of the scaled box: object-space (x +- 0.5, ..) pushed 0.2 along the unit normal, then scaled by 2 in x
  const ref = new THREE.Vector3();
  const src = g.attributes;
  const idx = 24 + 0; // first vertex of part b in the shell
  const p = new THREE.Vector3().fromBufferAttribute(src.position, 0);
  const n = new THREE.Vector3().fromBufferAttribute(src.normal, 0).normalize();
  ref.copy(p).addScaledVector(n, 0.2).multiply(new THREE.Vector3(2, 1, 1)).add(new THREE.Vector3(5, 0, 0));
  const got = new THREE.Vector3().fromBufferAttribute(out.inkGeo.attributes.position, idx);
  assert.ok(got.distanceTo(ref) < 1e-5, `${got.toArray()} vs ${ref.toArray()}`);
});

test('bakeFrame leaves animated sub-frames alone and ignores textured materials', () => {
  const root = new THREE.Group();
  const sub = new THREE.Group();
  sub.userData.frame = true;
  const g = new THREE.BoxGeometry(1, 1, 1);
  sub.add(part(g, '#ffffff', 0.05));
  const textured = part(g, '#ffffff', 0.05);
  textured.material.map = new THREE.Texture();
  root.add(part(g, '#123456', 0), sub, textured);
  const out = bakeFrame(root);
  assert.equal(out.geo.attributes.position.count, 24);
  assert.equal(out.inkGeo, null); // the only baked part has no outline
  assert.equal(sub.children.length, 1);
  assert.equal(textured.parent, root);
});

test('StaticBatcher chunks by cell, splits shadow flags, one ink mesh per cell', () => {
  const batch = new StaticBatcher();
  const g = new THREE.BoxGeometry(1, 1, 1);
  const place = (x, z, cast, receive) => {
    const m = part(g, '#ff8800', 0.03, [x, 0, z]);
    m.castShadow = cast;
    m.receiveShadow = receive;
    batch.collect(m);
  };
  place(5, 5, false, true);
  place(10, 8, false, true);
  place(15, 9, true, false); // same cell, other shadow flags
  place(200, 5, false, true); // other cell
  const group = new THREE.Group();
  const toonMat = new THREE.MeshToonMaterial({ vertexColors: true });
  const inkMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  batch.emit(group, { cell: 90, toonMat, inkMaterial });
  const toons = group.children.filter((m) => m.material === toonMat);
  const inks = group.children.filter((m) => m.material === inkMaterial);
  assert.equal(toons.length, 3);
  assert.equal(inks.length, 2);
  assert.equal(group.children.length, 5);
  const big = toons.find((m) => m.geometry.attributes.position.count === 48);
  assert.ok(big && big.receiveShadow && !big.castShadow);
  // merged chunk has its own bounding sphere so frustum culling works per chunk
  assert.ok(inks[0].geometry.boundingSphere.radius > 0);
});

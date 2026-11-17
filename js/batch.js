// Geometry baking helpers for the toon renderer. Many small "part" meshes (each with an ink
// outline twin) are merged into a few meshes to cut draw calls, without changing the picture:
//  - colours move into a vertex colour attribute (same linear values the material colour had);
//  - the ink outline is baked: every vertex is pushed out along its (normalised) normal by the
//    outline thickness in the part's own space, then the part's transform is applied. This is
//    exactly what the shader extrusion did, even under non-uniform scale, so the baked outline
//    can be drawn with a plain back-face material and one mesh can mix any thicknesses.
import * as THREE from 'three';
import { cellKey } from './perf.js';

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _nv = new THREE.Vector3();

// Accumulates transformed parts and builds one indexed BufferGeometry.
class GeoBuilder {
  constructor(withColor) {
    this.withColor = withColor;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
    this.vertCount = 0;
  }

  // thick > 0 builds the outline shell: positions displaced along the normal before transform.
  addPart(geo, matrix, color, thick = 0) {
    const p = geo.attributes.position;
    const nrm = geo.attributes.normal;
    _n.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      if (nrm) _nv.fromBufferAttribute(nrm, i);
      if (thick > 0) _v.addScaledVector(_nv.normalize(), thick);
      _v.applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      if (this.withColor) {
        _nv.fromBufferAttribute(nrm, i).applyMatrix3(_n).normalize();
        this.nor.push(_nv.x, _nv.y, _nv.z);
        this.col.push(color.r, color.g, color.b);
      }
    }
    const base = this.vertCount;
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    this.vertCount += p.count;
  }

  build() {
    if (!this.vertCount) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.withColor) {
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    }
    g.setIndex(this.vertCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// A part mesh is bakeable when it was made by renderer.part(): flagged userData.part, plain
// toon material without a texture.
function bakeable(o) {
  return o.isMesh && o.userData.part && o.material && o.material.isMeshToonMaterial && !o.material.map;
}

// Bake all bakeable parts under `root` into root-local geometry: { geo, inkGeo, castShadow }.
// Sub-trees whose root has userData.frame are left alone (they animate on their own).
// Consumed meshes are detached from the tree. Returns null when nothing was baked.
export function bakeFrame(root) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const body = new GeoBuilder(true);
  const ink = new GeoBuilder(false);
  const consumed = [];
  const walk = (o) => {
    if (o !== root && o.userData.frame) return;
    if (bakeable(o)) {
      _m.multiplyMatrices(inv, o.matrixWorld);
      body.addPart(o.geometry, _m, o.material.color);
      if (o.userData.outline > 0) ink.addPart(o.geometry, _m, null, o.userData.outline);
      consumed.push(o);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  for (const o of consumed) o.removeFromParent();
  const geo = body.build();
  return geo ? { geo, inkGeo: ink.build() } : null;
}

// Collects parts with world transforms, then emits chunked merged meshes (one toon mesh per
// shadow-flag combination and one ink mesh per chunk) so frustum culling still culls per chunk.
export class StaticBatcher {
  constructor() {
    this.items = [];
  }

  // Add a bakeable part mesh (and its descendants) in world space, detaching them.
  collect(root) {
    root.updateWorldMatrix(true, true);
    const consumed = [];
    root.traverse((o) => {
      if (!bakeable(o)) return;
      this.items.push({
        geo: o.geometry,
        matrix: o.matrixWorld.clone(),
        color: o.material.color.clone(),
        outline: o.userData.outline || 0,
        cast: o.castShadow,
        receive: o.receiveShadow,
      });
      consumed.push(o);
    });
    for (const o of consumed) o.removeFromParent();
  }

  // Emit meshes into `group`. toonMat must be a shared vertexColors toon material, inkMaterial a
  // shared plain back-face material. cell is the chunk size in world units.
  emit(group, { cell, toonMat, inkMaterial, cat = 'static' }) {
    const toon = new Map();
    const ink = new Map();
    for (const it of this.items) {
      const x = it.matrix.elements[12];
      const z = it.matrix.elements[14];
      const key = cellKey(x, z, cell);
      const tk = `${key}|${it.cast ? 1 : 0}${it.receive ? 1 : 0}`;
      if (!toon.has(tk)) toon.set(tk, { b: new GeoBuilder(true), cast: it.cast, receive: it.receive });
      toon.get(tk).b.addPart(it.geo, it.matrix, it.color);
      if (it.outline > 0) {
        if (!ink.has(key)) ink.set(key, new GeoBuilder(false));
        ink.get(key).addPart(it.geo, it.matrix, null, it.outline);
      }
    }
    for (const { b, cast, receive } of toon.values()) {
      const g = b.build();
      const m = new THREE.Mesh(g, toonMat);
      m.castShadow = cast;
      m.receiveShadow = receive;
      m.userData.cat = cat;
      group.add(m);
    }
    for (const b of ink.values()) {
      const m = new THREE.Mesh(b.build(), inkMaterial);
      m.raycast = () => {};
      m.userData.cat = cat;
      group.add(m);
    }
    // source geometries were only templates: free them (never uploaded, so this is cheap)
    for (const it of this.items) if (!it.geo.userData.shared) it.geo.dispose();
    this.items = [];
  }
}

// 3D Cartoon Toon World & Articulated Faceless Kart Renderer
// Inspired by body-runner & jagoan-kotak:
// - Normal-extruded #3b2347 ink outlines (onBeforeCompile)
// - Shader sky dome + sun glow sprite + distant mountains + procedural canvas textures (grass, road, curbs)
// - Rich composite scenery props (round fruit trees, pine trees, flowering bushes, tiki pillars, rocks)
// - Detailed racing kart (front wing, sidepods, rear spoiler, steering wheel, white-rimmed tires, dual exhaust flames)
// - Articulated faceless driver (torso lean, arms gripping wheel, hands-up turbo celebration, forward punch + spinning dizzy stars)

import * as THREE from 'three';
import { TRACKS, DRIVERS, getTrackById } from './tracks.js';

const MAX_PIXELS = 2_150_000;
const INK = '#3b2347';

const toonRamp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([115, 195, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

const matCache = new Map();
function toon(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, ...extra }));
  }
  return matCache.get(key);
}

const inkCache = new Map();
function inkMat(thick = 0.04) {
  if (!inkCache.has(thick)) {
    const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    m.onBeforeCompile = (s) => {
      s.uniforms.thick = { value: thick };
      s.vertexShader = 'uniform float thick;\n' +
        s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * thick;');
    };
    m.customProgramCacheKey = () => `ink_${thick}`;
    inkCache.set(thick, m);
  }
  return inkCache.get(thick);
}

function part(geo, colorOrMat, { outline = 0.04, cast = true, receive = false } = {}) {
  const mat = typeof colorOrMat === 'string' ? toon(colorOrMat) : colorOrMat;
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  if (outline > 0) {
    const o = new THREE.Mesh(geo, inkMat(outline));
    o.raycast = () => {};
    m.add(o);
  }
  return m;
}

function canvasTex(w, h, drawFn, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawFn(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}

function makeCrateTexture(label = '?', bg = '#ff9f43', border = '#9a4d12', textColor = '#fffdf7') {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = border;
    g.lineWidth = 14;
    g.strokeRect(7, 7, 114, 114);
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(14, 42); g.lineTo(114, 42);
    g.moveTo(14, 86); g.lineTo(114, 86);
    g.stroke();
    g.fillStyle = INK;
    g.font = '900 66px Fredoka, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 66, 70);
    g.fillStyle = textColor;
    g.fillText(label, 64, 66);
  });
}

function makeChevronTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#1fa84a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d9ffe0';
    g.lineWidth = 16;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < 2; i++) {
      const y = 22 + i * 56;
      g.beginPath();
      g.moveTo(22, y + 36);
      g.lineTo(64, y);
      g.lineTo(106, y + 36);
      g.stroke();
    }
  });
}

function makeCheckerTexture() {
  return canvasTex(128, 128, (g) => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 2 === 0 ? INK : '#fffdf7';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  }, [2, 1]);
}

function makeRoadTexture(roadHex, lineHex = '#fffdf7') {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = roadHex;
    g.fillRect(0, 0, 256, 256);
    // Subtle cobblestone / track surface blocks
    g.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 6; c++) {
        const x = c * 42 + (r % 2) * 20;
        const y = r * 32 + 4;
        g.beginPath();
        g.roundRect(x, y, 34, 24, 6);
        g.fill();
      }
    }
    // Center dashed racing lines
    g.fillStyle = lineHex;
    for (let y = 16; y < 256; y += 64) {
      g.beginPath();
      g.roundRect(122, y, 12, 34, 5);
      g.fill();
    }
    // Edge highlight strips
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(10, 0, 6, 256);
    g.fillRect(240, 0, 6, 256);
  }, [1, 42]);
}

function makeGrassTexture(baseHex, accentHex, style = 'meadow') {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = baseHex;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 180; i++) {
      g.fillStyle = i % 2 === 0 ? accentHex : 'rgba(255,255,255,0.12)';
      const x = (i * 73) % 256;
      const y = (i * 137) % 256;
      g.beginPath();
      g.ellipse(x, y, 6, 3, (i % 5) * 0.5, 0, Math.PI * 2);
      g.fill();
    }
    if (style === 'rock') {
      // dry rocky ground: pebbles and cracks, no flowers
      g.strokeStyle = 'rgba(90, 30, 10, 0.18)';
      g.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const x = (i * 83 + 17) % 256;
        const y = (i * 151 + 9) % 256;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 26, y + 9);
        g.lineTo(x + 40, y - 6);
        g.stroke();
      }
      for (let i = 0; i < 26; i++) {
        g.fillStyle = i % 2 ? 'rgba(120, 50, 20, 0.22)' : 'rgba(255, 220, 170, 0.22)';
        g.beginPath();
        g.ellipse((i * 71) % 256, (i * 113) % 256, 4, 2.6, i * 0.7, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    // Little flowers (meadow only)
    const flowerCols = ['#fffdf7', '#ffd166', '#ff8fab'];
    for (let i = 0; i < 12; i++) {
      const x = (i * 59 + 20) % 240;
      const y = (i * 97 + 20) % 240;
      g.fillStyle = flowerCols[i % 3];
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        g.arc(x + Math.cos(k * 1.25) * 3.2, y + Math.sin(k * 1.25) * 3.2, 2.4, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ff9f43';
      g.beginPath();
      g.arc(x, y, 1.8, 0, Math.PI * 2);
      g.fill();
    }
  }, [32, 32]);
}

export class RaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    this.webglAvailable = Boolean(gl);

    if (this.webglAvailable) {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
    } else {
      this.ctx2d = canvas.getContext('2d');
      this.renderer = {
        shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false },
        setPixelRatio: () => {},
        setSize: (w, h) => {
          canvas.width = w;
          canvas.height = h;
        },
        setScissorTest: () => {},
        setViewport: () => {},
        setScissor: () => {},
        render: () => {},
      };
    }

    this.scene = new THREE.Scene();
    this.cameras = [
      new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 480),
      new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 480),
    ];
    this.camStates = [
      { x: 0, y: 4.5, z: 10, yaw: 0, initialized: false },
      { x: 0, y: 4.5, z: 10, yaw: 0, initialized: false },
    ];

    this.comfortMode = true;
    this.adaptiveScale = 1.0;
    this.pixelCount = 0;
    this.menuOrbitAngle = 0;

    // Shared geometries & materials
    this.shared = {
      crateGeo: new THREE.BoxGeometry(1.55, 1.55, 1.55),
      crateMat: new THREE.MeshToonMaterial({ map: makeCrateTexture('?', '#ff9f43', '#9a4d12', '#fffdf7'), gradientMap: toonRamp }),
      tntMat: new THREE.MeshToonMaterial({ map: makeCrateTexture('TNT', '#ff4d6d', '#800f2f', '#ffd166'), gradientMap: toonRamp }),
      fruitGeo: new THREE.SphereGeometry(0.52, 14, 12),
      fruitLeafGeo: new THREE.ConeGeometry(0.22, 0.38, 6),
      rocketGeo: new THREE.ConeGeometry(0.42, 1.55, 10),
      bombGeo: new THREE.SphereGeometry(0.62, 14, 12),
      blobGeo: new THREE.CircleGeometry(1.6, 20),
      blobMat: new THREE.MeshBasicMaterial({ color: 0x2a1a3a, transparent: true, opacity: 0.28, depthWrite: false }),
      shieldGeo: new THREE.SphereGeometry(1.85, 18, 14),
      shieldMat: new THREE.MeshBasicMaterial({ color: 0x5ef0ff, transparent: true, opacity: 0.34 }),
      flameGeo: new THREE.ConeGeometry(0.28, 1.15, 8),
      flameMat: new THREE.MeshBasicMaterial({ color: 0xffd166 }),
      flameInnerMat: new THREE.MeshBasicMaterial({ color: 0xff4d6d }),
      starGeo: new THREE.OctahedronGeometry(0.22, 0),
    };
    this.shared.rocketGeo.rotateX(Math.PI * 0.5);
    this.shared.blobGeo.rotateX(-Math.PI * 0.5);
    this.shared.flameGeo.rotateX(-Math.PI * 0.5);

    this.trackGroup = new THREE.Group();
    this.entitiesGroup = new THREE.Group();
    this.scene.add(this.trackGroup);
    this.scene.add(this.entitiesGroup);

    this.kartMeshes = new Map();
    this.crateMeshes = new Map();
    this.fruitMeshes = new Map();
    this.projectileMeshes = new Map();
    this.hazardMeshes = new Map();
    this.currentTrackId = null;
    this.bursts = [];
    this.burstGeo = new THREE.IcosahedronGeometry(0.28, 0);
    this.burstMats = new Map();
    this.fov = 58;

    this._setupLights();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    this.hemiLight = new THREE.HemisphereLight('#ffffff', '#8fd18a', 1.45);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight('#fff4d6', 2.1);
    this.dirLight.position.set(65, 110, 55);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    const d = 145;
    Object.assign(this.dirLight.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 10, far: 290 });
    this.dirLight.shadow.bias = -0.0008;
    this.scene.add(this.dirLight);
  }

  resize() {
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(240, window.innerHeight);
    const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxDprForBudget = Math.sqrt(MAX_PIXELS / (w * h));
    const dpr = Math.min(baseDpr, maxDprForBudget) * this.adaptiveScale;

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.pixelCount = Math.round(w * dpr * h * dpr);
  }

  // GPU resource counters (three's renderer.info): used by getMetrics() and the leak tests.
  getInfo() {
    const i = this.renderer.info;
    if (!i) return {};
    return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, triangles: i.render.triangles };
  }

  adjustResolutionForFps(fps) {
    if (fps < 46 && this.adaptiveScale > 0.65) {
      this.adaptiveScale = Math.max(0.65, this.adaptiveScale - 0.08);
      this.resize();
    } else if (fps > 57 && this.adaptiveScale < 1.0) {
      this.adaptiveScale = Math.min(1.0, this.adaptiveScale + 0.04);
      this.resize();
    }
  }

  buildTrack(trackId) {
    if (this.currentTrackId === trackId) return;
    this.currentTrackId = trackId;
    const track = getTrackById(trackId);

    this.trackGroup.clear();
    this.entitiesGroup.clear();
    this.kartMeshes.clear();
    this.crateMeshes.clear();
    this.fruitMeshes.clear();
    this.projectileMeshes.clear();
    this.hazardMeshes.clear();

    const palette = track.id === 'canyon'
      ? { skyTop: '#ff7b54', skyHor: '#ffe5b4', grassA: '#f4a261', grassB: '#e76f51', road: '#b5654d', hillA: '#e07a5f', hillB: '#d65f47' }
      : track.id === 'temple'
        ? { skyTop: '#4cc9f0', skyHor: '#d8f3dc', grassA: '#52b788', grassB: '#40916c', road: '#8d99ae', hillA: '#74c69d', hillB: '#52b788' }
        : { skyTop: '#3aa8ff', skyHor: '#d4f3ff', grassA: '#7ae582', grassB: '#5bc768', road: '#e9c99a', hillA: '#7fd97a', hillB: '#93e08a' };

    this.scene.background = new THREE.Color(palette.skyHor);
    this.scene.fog = new THREE.FogExp2(palette.skyHor, 0.0024);

    // 1. Gradient Sky Dome + Sun Glow Sprite
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(360, 28, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(palette.skyTop) },
          hor: { value: new THREE.Color(palette.skyHor) },
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y * 2.0, 0.0, 1.0); gl_FragColor = vec4(mix(hor, top, pow(h, 0.65)), 1.0); }',
      })
    );
    skyDome.renderOrder = -1;
    this.trackGroup.add(skyDome);

    // 2. Textured Ground Plane
    const grassTex = makeGrassTexture(palette.grassA, palette.grassB, track.id === 'canyon' ? 'rock' : 'meadow');
    const groundGeo = new THREE.PlaneGeometry(680, 680);
    groundGeo.rotateX(-Math.PI * 0.5);
    const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ map: grassTex, gradientMap: toonRamp }));
    groundMesh.position.set(60, -0.06, 0);
    groundMesh.receiveShadow = true;
    this.trackGroup.add(groundMesh);

    // 3. Textured Road Ribbon with UV mapping along spline
    const samples = track.samples;
    const n = samples.length;
    const halfW = track.roadWidth * 0.5;
    const roadPositions = [];
    const roadUvs = [];
    const roadIndices = [];

    for (let i = 0; i <= n; i++) {
      const s = samples[i % n];
      const lx = s.x - s.rx * halfW;
      const lz = s.z - s.rz * halfW;
      const rx = s.x + s.rx * halfW;
      const rz = s.z + s.rz * halfW;
      roadPositions.push(lx, 0.03, lz, rx, 0.03, rz);
      const v = (i / n) * 42;
      roadUvs.push(0, v, 1, v);
      if (i < n) {
        const base = i * 2;
        roadIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();
    const roadTex = makeRoadTexture(palette.road);
    roadTex.repeat.set(1, 1);
    const roadMesh = new THREE.Mesh(roadGeo, new THREE.MeshToonMaterial({ map: roadTex, gradientMap: toonRamp }));
    roadMesh.receiveShadow = true;
    this.trackGroup.add(roadMesh);

    // 4. Candy-Striped Curbs with Ink Outlines
    const curbGeo = new THREE.BoxGeometry(0.95, 0.26, 2.8);
    const curbMatA = toon(track.theme.curbA);
    const curbMatB = toon(track.theme.curbB);
    for (let i = 0; i < n; i += 2) {
      const s = samples[i];
      const yaw = Math.atan2(s.tx, s.tz);
      const mat = (i / 2) % 2 === 0 ? curbMatA : curbMatB;
      for (const side of [-1, 1]) {
        const curb = part(curbGeo, mat, { outline: 0.03, cast: false, receive: true });
        curb.position.set(s.x + s.rx * (halfW + 0.5) * side, 0.13, s.z + s.rz * (halfW + 0.5) * side);
        curb.rotation.y = yaw;
        this.trackGroup.add(curb);
      }
    }

    // 5. Grand Start/Finish Gate with Checkered Banner & Pennants
    const s0 = track.getPointAt(0);
    const startYaw = Math.atan2(s0.tx, s0.tz);
    const startGate = new THREE.Group();
    startGate.position.set(s0.x, 0, s0.z);
    startGate.rotation.y = startYaw;

    const checkerTex = makeCheckerTexture();
    const lineGeo = new THREE.PlaneGeometry(track.roadWidth, 2.8);
    lineGeo.rotateX(-Math.PI * 0.5);
    const lineMesh = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ map: checkerTex }));
    lineMesh.position.y = 0.06;
    startGate.add(lineMesh);

    const pillarGeo = new THREE.CylinderGeometry(0.6, 0.72, 8.2, 12);
    for (const side of [-1, 1]) {
      const p = part(pillarGeo, '#ff9f43', { outline: 0.05 });
      p.position.set(side * (halfW + 0.9), 4.1, 0);
      startGate.add(p);

      const cap = part(new THREE.SphereGeometry(0.9, 14, 12), '#ffd166', { outline: 0.05 });
      cap.position.set(side * (halfW + 0.9), 8.4, 0);
      startGate.add(cap);
    }
    const bannerGeo = new THREE.BoxGeometry(track.roadWidth + 2.8, 1.7, 0.9);
    const banner = part(bannerGeo, new THREE.MeshBasicMaterial({ map: checkerTex }), { outline: 0.05 });
    banner.position.set(0, 7.2, 0);
    startGate.add(banner);
    this.trackGroup.add(startGate);

    // 6. Glowing Chevron Boost Pads & Jump Ramps
    const padGeo = new THREE.BoxGeometry(4.4, 0.14, 5.4);
    this.padTex = makeChevronTexture();
    this.padTex.repeat.set(1, 1);
    const padMat = new THREE.MeshBasicMaterial({ map: this.padTex });
    for (const pad of track.boostPads) {
      const m = part(padGeo, padMat, { outline: 0.03, cast: false });
      m.position.set(pad.x, 0.08, pad.z);
      m.rotation.y = Math.atan2(pad.tx, pad.tz);
      this.trackGroup.add(m);
    }

    const rampGeo = new THREE.BoxGeometry(5.2, 0.95, 4.6);
    for (const r of track.ramps) {
      const m = part(rampGeo, '#ffd166', { outline: 0.05 });
      m.position.set(r.x, 0.32, r.z);
      m.rotation.y = Math.atan2(r.tx, r.tz);
      m.rotation.x = -0.22;
      this.trackGroup.add(m);
    }

    // 7. Distant Hills, Mountains & Trackside Cartoon Scenery
    this._buildSceneryProps(track, palette);

    // 8. Item Crates & Mango Fruits with Leaves
    for (const c of track.crateSpawns) {
      const mesh = part(this.shared.crateGeo, this.shared.crateMat, { outline: 0.045 });
      mesh.position.set(c.x, c.y, c.z);
      this.crateMeshes.set(c.id, mesh);
      this.entitiesGroup.add(mesh);
    }
    for (const f of track.fruitSpawns) {
      const grp = new THREE.Group();
      const body = part(this.shared.fruitGeo, '#ff7a1a', { outline: 0.035 });
      const leaf = part(this.shared.fruitLeafGeo, '#40c057', { outline: 0.025 });
      leaf.position.y = 0.55;
      grp.add(body, leaf);
      grp.position.set(f.x, f.y, f.z);
      this.fruitMeshes.set(f.id, grp);
      this.entitiesGroup.add(grp);
    }

    this.renderer.shadowMap.needsUpdate = true;
  }

  _buildSceneryProps(track, palette) {
    // Distant hills & snow-capped peaks around perimeter
    const cx = 60;
    const cz = 5;
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2;
      const dist = 215 + (i % 3) * 25;
      const hx = cx + Math.cos(ang) * dist;
      const hz = cz + Math.sin(ang) * dist;
      const r = 26 + (i % 4) * 8;
      const hill = part(new THREE.SphereGeometry(r, 16, 12), i % 2 === 0 ? palette.hillA : palette.hillB, { outline: 0, cast: false });
      hill.scale.set(1.3, 0.65, 0.9);
      hill.position.set(hx, -r * 0.25, hz);
      this.trackGroup.add(hill);

      if (i % 2 === 0) {
        const mh = 55 + (i % 3) * 18;
        const mtn = new THREE.Group();
        mtn.position.set(hx * 1.12, 0, hz * 1.12);
        const cone = part(new THREE.ConeGeometry(mh * 0.65, mh, 7), '#a99be6', { outline: 0, cast: false });
        cone.position.y = mh * 0.5 - 4;
        const snow = part(new THREE.ConeGeometry(mh * 0.25, mh * 0.38, 7), '#fffdf7', { outline: 0, cast: false });
        snow.position.y = mh * 0.81 - 4;
        mtn.add(cone, snow);
        this.trackGroup.add(mtn);
      }
    }

    // Trackside trees, bushes, rocks & tiki pillars
    const samples = track.samples;
    for (let i = 0; i < samples.length; i += 4) {
      const s = samples[i];
      for (const side of [-1, 1]) {
        if ((i + (side > 0 ? 2 : 0)) % 8 !== 0) continue;
        const dist = track.roadWidth * 0.5 + 6.5 + ((i * 7) % 9);
        const px = s.x + s.rx * dist * side;
        const pz = s.z + s.rz * dist * side;

        const prop = new THREE.Group();
        prop.position.set(px, 0, pz);

        if (track.id === 'island') {
          // Multi-sphere cartoon fruit tree (like body-runner)
          const h = 2.4 + (i % 3) * 0.4;
          const trunk = part(new THREE.CylinderGeometry(0.32, 0.48, h, 8), '#9a6646', { outline: 0.05 });
          trunk.position.y = h * 0.5;
          const cMain = part(new THREE.SphereGeometry(1.75, 14, 10), '#5bc768', { outline: 0.05 });
          cMain.position.set(0, h + 1.0, 0);
          const cLeft = part(new THREE.SphereGeometry(1.25, 12, 10), '#4ab35c', { outline: 0.05 });
          cLeft.position.set(-1.05, h + 0.55, 0.2);
          const cRight = part(new THREE.SphereGeometry(1.3, 12, 10), '#72d67c', { outline: 0.05 });
          cRight.position.set(1.0, h + 0.65, -0.15);
          prop.add(trunk, cMain, cLeft, cRight);
        } else if (track.id === 'canyon') {
          // Layered red rock hoodoo + cactus
          const r1 = part(new THREE.DodecahedronGeometry(2.2, 0), '#d65f47', { outline: 0.05 });
          r1.position.y = 1.6;
          r1.scale.set(1.2, 1.5, 1.1);
          const r2 = part(new THREE.DodecahedronGeometry(1.3, 0), '#f4a261', { outline: 0.05 });
          r2.position.set(1.4, 0.9, 0.4);
          prop.add(r1, r2);
        } else {
          // Stepped temple pillar with glowing crystal top
          const pBase = part(new THREE.BoxGeometry(2.4, 5.2, 2.4), '#94a3b8', { outline: 0.05 });
          pBase.position.y = 2.6;
          const gem = part(new THREE.OctahedronGeometry(0.95, 0), '#5ef0ff', { outline: 0.04 });
          gem.position.y = 6.1;
          prop.add(pBase, gem);
        }
        this.trackGroup.add(prop);
      }
    }
  }

  _createFacelessKartMesh(kartState) {
    const driver = DRIVERS.find((d) => d.id === kartState.driverId) || DRIVERS[0];
    const root = new THREE.Group();

    // Soft blob shadow
    const blob = new THREE.Mesh(this.shared.blobGeo, this.shared.blobMat);
    blob.position.y = 0.04;
    root.add(blob);

    const rig = new THREE.Group(); // handles hop squash & stretch
    root.add(rig);

    const bodyGroup = new THREE.Group();
    rig.add(bodyGroup);

    // --- Sculpted Kart Chassis ---
    const mainDeck = part(new THREE.BoxGeometry(1.55, 0.38, 2.55), driver.kartColor, { outline: 0.045 });
    mainDeck.position.set(0, 0.42, 0);
    bodyGroup.add(mainDeck);

    // Side pods (left & right)
    for (const sx of [-1, 1]) {
      const pod = part(new THREE.BoxGeometry(0.36, 0.34, 1.65), driver.accent, { outline: 0.04 });
      pod.position.set(sx * 0.92, 0.42, -0.05);
      bodyGroup.add(pod);
    }

    // Sloped front nose cone & front bumper wing
    const nose = part(new THREE.BoxGeometry(1.15, 0.32, 0.95), driver.kartColor, { outline: 0.04 });
    nose.position.set(0, 0.44, 1.35);
    nose.rotation.x = 0.18;
    bodyGroup.add(nose);

    const frontBumper = part(new THREE.BoxGeometry(1.85, 0.22, 0.42), '#fffdf7', { outline: 0.04 });
    frontBumper.position.set(0, 0.32, 1.82);
    bodyGroup.add(frontBumper);

    // Steering column + Steering wheel
    const col = part(new THREE.CylinderGeometry(0.08, 0.08, 0.65, 8), '#475569', { outline: 0.025 });
    col.position.set(0, 0.82, 0.55);
    col.rotation.x = -0.55;
    bodyGroup.add(col);

    const steeringWheel = part(new THREE.TorusGeometry(0.24, 0.045, 8, 16), INK, { outline: 0.02 });
    steeringWheel.position.set(0, 1.02, 0.38);
    steeringWheel.rotation.x = -0.55;
    bodyGroup.add(steeringWheel);

    // Rear Engine Block + High Spoiler Wing + Dual Chrome Exhausts
    const engine = part(new THREE.BoxGeometry(1.05, 0.55, 0.72), '#475569', { outline: 0.04 });
    engine.position.set(0, 0.72, -1.08);
    bodyGroup.add(engine);

    for (const sx of [-1, 1]) {
      const strut = part(new THREE.BoxGeometry(0.1, 0.55, 0.18), INK, { outline: 0.02 });
      strut.position.set(sx * 0.48, 1.15, -1.28);
      bodyGroup.add(strut);

      const pipe = part(new THREE.CylinderGeometry(0.14, 0.18, 0.65, 10), '#cbd5e1', { outline: 0.03 });
      pipe.position.set(sx * 0.38, 0.82, -1.48);
      pipe.rotation.x = Math.PI * 0.42;
      bodyGroup.add(pipe);
    }

    const spoilerWing = part(new THREE.BoxGeometry(1.75, 0.12, 0.45), driver.accent, { outline: 0.04 });
    spoilerWing.position.set(0, 1.42, -1.32);
    spoilerWing.rotation.x = 0.18;
    bodyGroup.add(spoilerWing);

    // Dual Turbo Flames
    const flames = new THREE.Group();
    for (const sx of [-1, 1]) {
      const outer = new THREE.Mesh(this.shared.flameGeo, this.shared.flameMat);
      outer.position.set(sx * 0.38, 0.86, -2.05);
      const inner = new THREE.Mesh(this.shared.flameGeo, this.shared.flameInnerMat);
      inner.scale.setScalar(0.6);
      inner.position.set(sx * 0.38, 0.86, -1.9);
      flames.add(outer, inner);
    }
    flames.visible = false;
    bodyGroup.add(flames);

    // 4 Wide Racing Wheels with White Rims
    const tireGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.42, 16);
    tireGeo.rotateZ(Math.PI * 0.5);
    const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.45, 12);
    rimGeo.rotateZ(Math.PI * 0.5);
    const wheels = [];
    for (const [wx, wz, scale] of [[-1.06, 1.02, 0.92], [1.06, 1.02, 0.92], [-1.12, -0.96, 1.08], [1.12, -0.96, 1.08]]) {
      const wGrp = new THREE.Group();
      wGrp.position.set(wx, 0.44 * scale, wz);
      wGrp.scale.setScalar(scale);
      const tire = part(tireGeo, '#2b2d42', { outline: 0.04 });
      const rim = part(rimGeo, '#fffdf7', { outline: 0.02, cast: false });
      wGrp.add(tire, rim);
      bodyGroup.add(wGrp);
      wheels.push(wGrp);
    }

    // --- Articulated Faceless Driver (Head, Back Hair/Helmet, Torso, Pivoted Arms) ---
    const driverGroup = new THREE.Group();
    driverGroup.position.set(0, 0.65, -0.12);
    bodyGroup.add(driverGroup);

    const torso = part(new THREE.BoxGeometry(0.76, 0.66, 0.52), driver.suitColor, { outline: 0.04 });
    torso.position.y = 0.33;
    driverGroup.add(torso);

    // Collar / racing scarf
    const scarf = part(new THREE.BoxGeometry(0.82, 0.14, 0.58), driver.accent, { outline: 0.03 });
    scarf.position.y = 0.64;
    driverGroup.add(scarf);

    const head = part(new THREE.SphereGeometry(0.44, 18, 14), driver.color, { outline: 0.04 });
    head.position.y = 1.02;
    driverGroup.add(head);

    // Back hair / helmet shell so from behind (player camera) the character looks rich while front remains 100% faceless
    if (driver.headgear === 'ears') {
      const earGeo = new THREE.ConeGeometry(0.16, 0.52, 8);
      for (const sx of [-1, 1]) {
        const ear = part(earGeo, driver.color, { outline: 0.035 });
        ear.position.set(sx * 0.28, 0.46, -0.05);
        ear.rotation.z = -sx * 0.28;
        head.add(ear);
      }
      const tuft = part(new THREE.ConeGeometry(0.14, 0.35, 7), driver.accent, { outline: 0.03 });
      tuft.position.set(0, 0.48, -0.1);
      head.add(tuft);
    } else if (driver.headgear === 'helmet') {
      const helmetShell = part(new THREE.SphereGeometry(0.47, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.65), '#fffdf7', { outline: 0.04 });
      head.add(helmetShell);
      const fin = part(new THREE.BoxGeometry(0.12, 0.34, 0.68), driver.accent, { outline: 0.035 });
      fin.position.set(0, 0.42, -0.1);
      head.add(fin);
    } else if (driver.headgear === 'crown') {
      const band = part(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 14), '#9a4d12', { outline: 0.03 });
      band.position.y = 0.26;
      head.add(band);
      const featherGeo = new THREE.BoxGeometry(0.18, 0.55, 0.08);
      for (const [i, col] of [[-1, '#ff4d6d'], [0, '#ffd166'], [1, '#4cc9f0']]) {
        const f = part(featherGeo, col, { outline: 0.03 });
        f.position.set(i * 0.2, 0.55, -0.12);
        f.rotation.z = -i * 0.22;
        head.add(f);
      }
    } else if (driver.headgear === 'visor') {
      const dome = part(new THREE.CylinderGeometry(0.36, 0.44, 0.28, 12), driver.accent, { outline: 0.035 });
      dome.position.set(0, 0.34, 0);
      head.add(dome);
    }

    // Articulated Left & Right Arms with White Racing Gloves
    const makeArm = (sx) => {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.46, 0.56, 0.05);
      const sleeve = part(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), driver.suitColor, { outline: 0.03 });
      sleeve.rotation.x = Math.PI * 0.5;
      sleeve.position.z = 0.22;
      const glove = part(new THREE.SphereGeometry(0.15, 12, 10), '#fffdf7', { outline: 0.03 });
      glove.position.z = 0.46;
      pivot.add(sleeve, glove);
      driverGroup.add(pivot);
      return pivot;
    };
    const leftArm = makeArm(1);
    const rightArm = makeArm(-1);

    // Spinning Dizzy Stars overhead when hit (like body-runner)
    const dizzyGroup = new THREE.Group();
    dizzyGroup.position.y = 2.45;
    dizzyGroup.visible = false;
    bodyGroup.add(dizzyGroup);
    for (let i = 0; i < 3; i++) {
      const st = part(this.shared.starGeo, '#ffd166', { outline: 0.025, cast: false });
      const a = (i / 3) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.58, 0, Math.sin(a) * 0.58);
      dizzyGroup.add(st);
    }

    // Shield Bubble
    const shieldMesh = new THREE.Mesh(this.shared.shieldGeo, this.shared.shieldMat);
    shieldMesh.position.y = 0.95;
    shieldMesh.visible = false;
    bodyGroup.add(shieldMesh);

    this.entitiesGroup.add(root);
    const entry = {
      root,
      rig,
      bodyGroup,
      driverGroup,
      leftArm,
      rightArm,
      steeringWheel,
      wheels,
      flames,
      dizzyGroup,
      shieldMesh,
      wasAir: false,
      squash: 0,
    };
    entry.driverId = kartState.driverId;
    this.kartMeshes.set(kartState.id, entry);
    return entry;
  }

  // Short, calm particle puff (no screen shake): used for crate smash, hits, shield blocks.
  spawnBurst(x, y, z, color = '#ffffff', size = 1) {
    if (!this.webglAvailable) return;
    if (!this.burstMats.has(color)) this.burstMats.set(color, new THREE.MeshBasicMaterial({ color }));
    const mat = this.burstMats.get(color);
    const n = 7;
    for (let i = 0; i < n; i++) {
      if (this.bursts.length > 60) break;
      const m = new THREE.Mesh(this.burstGeo, mat);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const sp = (2.5 + Math.random() * 3) * size;
      m.position.set(x, y, z);
      m.scale.setScalar(size * (0.8 + Math.random() * 0.8));
      this.scene.add(m);
      this.bursts.push({ m, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 3.5, vz: Math.sin(a) * sp, life: 0.55 });
    }
  }

  _updateBursts(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.m);
        this.bursts.splice(i, 1);
        continue;
      }
      b.vy -= 12 * dt;
      b.m.position.x += b.vx * dt;
      b.m.position.y = Math.max(0.1, b.m.position.y + b.vy * dt);
      b.m.position.z += b.vz * dt;
      b.m.scale.multiplyScalar(Math.max(0.2, 1 - 1.6 * dt));
    }
  }

  _updateCameraForKart(camIdx, kart, dt = 1 / 60, isMenuShowcase = false) {
    const cam = this.cameras[camIdx];
    const st = this.camStates[camIdx];

    if (isMenuShowcase) {
      // Showcase camera angle on Menu: close angled 3/4 view showing kart on the right half of screen
      this.menuOrbitAngle += dt * 0.35;
      // On small landscape phones the menu panel covers more of the screen, so push the kart further right.
      const narrow = (this.canvas.clientWidth || window.innerWidth) < 900;
      const side = narrow ? 10 : 3.3;
      const lookY = narrow ? 0.4 : 1.05;
      const viewYaw = kart.heading + 0.38 + Math.sin(this.menuOrbitAngle) * 0.18;
      const dist = narrow ? 9.5 : 6.8;
      cam.position.set(
        kart.x - Math.sin(viewYaw) * dist + Math.cos(kart.heading) * 1.2,
        kart.y + 2.65,
        kart.z - Math.cos(viewYaw) * dist - Math.sin(kart.heading) * 1.2
      );
      cam.lookAt(
        kart.x + Math.sin(kart.heading) * 1.4 + Math.cos(kart.heading) * side,
        kart.y + lookY,
        kart.z + Math.cos(kart.heading) * 1.4 - Math.sin(kart.heading) * side
      );
      return;
    }

    if (!st.initialized) {
      st.yaw = kart.heading;
      st.x = kart.x - Math.sin(st.yaw) * 8.6;
      st.y = kart.y + 3.85;
      st.z = kart.z - Math.cos(st.yaw) * 8.6;
      st.initialized = true;
    }

    if (!kart.spinOut) {
      let diff = kart.heading - st.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const yawSpeed = this.comfortMode ? 6.0 : 9.0;
      st.yaw += diff * Math.min(1, yawSpeed * dt);
    }

    const distBack = kart.turboActive ? 9.4 : 8.4;
    const targetX = kart.x - Math.sin(st.yaw) * distBack;
    const targetY = kart.y + 3.85;
    const targetZ = kart.z - Math.cos(st.yaw) * distBack;

    const posLerp = Math.min(1, (this.comfortMode ? 11 : 15) * dt);
    st.x += (targetX - st.x) * posLerp;
    st.y += (targetY - st.y) * posLerp;
    st.z += (targetZ - st.z) * posLerp;

    const fovTarget = 58 + Math.min(1, Math.max(0, kart.speed) / 40) * (this.comfortMode ? 3 : 7) + (kart.turboActive ? (this.comfortMode ? 2 : 5) : 0);
    st.fov = (st.fov || 58) + (fovTarget - (st.fov || 58)) * Math.min(1, 4 * dt);
    if (Math.abs(cam.fov - st.fov) > 0.05) {
      cam.fov = st.fov;
      cam.updateProjectionMatrix();
    }
    cam.position.set(st.x, st.y, st.z);
    cam.lookAt(
      kart.x + Math.sin(st.yaw) * 6.5,
      kart.y + 1.25,
      kart.z + Math.cos(st.yaw) * 6.5
    );
  }

  render(snapshot, { mode = '1p', focusKartIds = ['p1'], dt = 1 / 60, isMenuShowcase = false } = {}) {
    if (!snapshot) return;
    this.buildTrack(snapshot.trackId);

    const nowSec = performance.now() * 0.001;
    this._updateBursts(dt);
    if (this.padTex) this.padTex.offset.y = -((nowSec * 1.6) % 1);

    // A kart mesh is tied to its driver look: drop meshes whose driver changed (new race, new
    // pick) or whose kart is no longer in the snapshot, so the chosen racer is what you see.
    const liveKarts = new Map(snapshot.karts.map((k) => [k.id, k.driverId]));
    for (const [id, m] of this.kartMeshes.entries()) {
      if (liveKarts.get(id) !== m.driverId) {
        m.root.parent?.remove(m.root);
        this.kartMeshes.delete(id);
      }
    }
    for (const k of snapshot.karts) {
      const m = this.kartMeshes.get(k.id) || this._createFacelessKartMesh(k);
      m.root.position.set(k.x, 0, k.z);
      m.bodyGroup.position.y = k.y + Math.abs(Math.sin(nowSec * 18)) * (k.speed > 5 ? 0.025 : 0);
      m.bodyGroup.rotation.y = k.heading;

      // Squash & stretch on landing from jumps
      const inAir = k.y > 0.12;
      if (m.wasAir && !inAir) m.squash = 0.22;
      m.wasAir = inAir;
      m.squash = Math.max(0, m.squash - dt * 1.4);
      const sy = 1 - m.squash + (inAir ? 0.08 : 0);
      const sxz = 1 + m.squash * 0.6 - (inAir ? 0.04 : 0);
      m.rig.scale.set(sxz, sy, sxz);

      // Chassis & driver lean into turns
      m.bodyGroup.rotation.z = k.steerAngle * 0.14;
      m.driverGroup.rotation.z = -k.steerAngle * 0.28;
      m.driverGroup.rotation.x = k.turboActive ? -0.18 : 0;
      m.steeringWheel.rotation.z = -k.steerAngle * 0.65;

      // Wheel steer & spin
      m.wheels[0].rotation.y = -k.steerAngle * 0.45;
      m.wheels[1].rotation.y = -k.steerAngle * 0.45;
      for (const w of m.wheels) {
        w.children[0].rotation.x += k.speed * dt * 1.6;
      }

      // Arm animations: Punch forward, Hands-Up Turbo celebration, or Gripping Steering Wheel
      if (k.punching) {
        m.rightArm.rotation.set(-0.25, 0, 0);
        m.rightArm.scale.z = 1.65;
        m.leftArm.rotation.set(0.15, 0.25, 0);
      } else if (k.turboActive) {
        m.rightArm.scale.z = 1;
        m.leftArm.rotation.set(-1.35, 0, -0.25);
        m.rightArm.rotation.set(-1.35, 0, 0.25);
      } else {
        m.rightArm.scale.z = 1;
        m.leftArm.rotation.set(0.2 + k.steerAngle * 0.25, -0.25, 0);
        m.rightArm.rotation.set(0.2 - k.steerAngle * 0.25, 0.25, 0);
      }

      m.flames.visible = Boolean(k.turboActive);
      if (k.turboActive) {
        m.flames.scale.z = 0.85 + Math.sin(nowSec * 38) * 0.28;
      }

      m.dizzyGroup.visible = Boolean(k.spinOut);
      if (k.spinOut) {
        m.dizzyGroup.rotation.y += dt * 6.5;
      }

      m.shieldMesh.visible = Boolean(k.shieldActive);
      // blink while briefly invulnerable after a hit (readable, no flashing faster than ~6 Hz)
      m.rig.visible = !(k.invuln && !k.spinOut && Math.floor(nowSec * 6) % 2 === 0);
    }

    for (const c of snapshot.crates) {
      const m = this.crateMeshes.get(c.id);
      if (m) {
        m.visible = c.active;
        if (c.active) {
          m.rotation.y = nowSec * 1.4;
          m.position.y = c.y + Math.sin(nowSec * 3 + c.x) * 0.12;
        }
      }
    }
    for (const f of snapshot.fruits) {
      const m = this.fruitMeshes.get(f.id);
      if (m) {
        m.visible = f.active;
        if (f.active) {
          m.rotation.y = nowSec * 2.0;
          m.position.y = f.y + Math.sin(nowSec * 4 + f.x) * 0.15;
        }
      }
    }

    // Projectiles
    const activeProjIds = new Set();
    for (const p of snapshot.projectiles) {
      activeProjIds.add(p.id);
      let m = this.projectileMeshes.get(p.id);
      if (!m) {
        const geo = p.type === 'rocket' ? this.shared.rocketGeo : this.shared.bombGeo;
        const col = p.type === 'rocket' ? '#ff4d6d' : '#2b2d42';
        m = part(geo, col, { outline: 0.04 });
        this.entitiesGroup.add(m);
        this.projectileMeshes.set(p.id, m);
      }
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = p.heading;
    }
    for (const [id, m] of this.projectileMeshes.entries()) {
      if (!activeProjIds.has(id)) {
        this.entitiesGroup.remove(m);
        this.projectileMeshes.delete(id);
      }
    }

    // TNT Hazards
    const activeHazIds = new Set();
    for (const h of snapshot.hazards) {
      activeHazIds.add(h.id);
      let m = this.hazardMeshes.get(h.id);
      if (!m) {
        m = part(this.shared.crateGeo, this.shared.tntMat, { outline: 0.04 });
        m.scale.setScalar(0.84);
        this.entitiesGroup.add(m);
        this.hazardMeshes.set(h.id, m);
      }
      m.position.set(h.x, h.y, h.z);
    }
    for (const [id, m] of this.hazardMeshes.entries()) {
      if (!activeHazIds.has(id)) {
        this.entitiesGroup.remove(m);
        this.hazardMeshes.delete(id);
      }
    }

    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;

    if (mode === '2p' && focusKartIds.length >= 2 && !isMenuShowcase) {
      const k1 = snapshot.karts.find((k) => k.id === focusKartIds[0]) || snapshot.karts[0];
      const k2 = snapshot.karts.find((k) => k.id === focusKartIds[1]) || snapshot.karts[1] || k1;
      const halfW = Math.floor(w * 0.5);

      this.renderer.setScissorTest(true);
      this.cameras[0].aspect = halfW / h;
      this.cameras[0].updateProjectionMatrix();
      this._updateCameraForKart(0, k1, dt, false);
      this.renderer.setViewport(0, 0, halfW, h);
      this.renderer.setScissor(0, 0, halfW, h);
      this.renderer.render(this.scene, this.cameras[0]);

      this.cameras[1].aspect = (w - halfW) / h;
      this.cameras[1].updateProjectionMatrix();
      this._updateCameraForKart(1, k2, dt, false);
      this.renderer.setViewport(halfW, 0, w - halfW, h);
      this.renderer.setScissor(halfW, 0, w - halfW, h);
      this.renderer.render(this.scene, this.cameras[1]);
      this.renderer.setScissorTest(false);
    } else {
      const k1 = snapshot.karts.find((k) => k.id === focusKartIds[0]) || snapshot.karts[0];
      this.renderer.setScissorTest(false);
      this.cameras[0].aspect = w / h;
      this.cameras[0].updateProjectionMatrix();
      this._updateCameraForKart(0, k1, dt, isMenuShowcase);
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.scene, this.cameras[0]);
    }

    if (!this.webglAvailable && this.ctx2d) {
      this._renderFallback2D(snapshot, mode, focusKartIds, w, h, isMenuShowcase);
    }
  }

  _renderFallback2D(snapshot, mode, focusKartIds, w, h, isMenuShowcase) {
    const ctx = this.ctx2d;
    const track = getTrackById(snapshot.trackId);
    const palette = track.id === 'canyon'
      ? { skyTop: '#ff7b54', skyHor: '#ffe5b4', grass: '#f4a261', road: '#b5654d', hill: '#e07a5f' }
      : track.id === 'temple'
        ? { skyTop: '#4cc9f0', skyHor: '#d8f3dc', grass: '#52b788', road: '#8d99ae', hill: '#74c69d' }
        : { skyTop: '#3aa8ff', skyHor: '#d4f3ff', grass: '#7ae582', road: '#e9c99a', hill: '#7fd97a' };

    const drawView = (vx, vy, vw, vh, kart) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(vx, vy, vw, vh);
      ctx.clip();

      const horizonY = vy + vh * 0.46;

      // Sky gradient + sun glow
      const sky = ctx.createLinearGradient(0, vy, 0, horizonY);
      sky.addColorStop(0, palette.skyTop);
      sky.addColorStop(1, palette.skyHor);
      ctx.fillStyle = sky;
      ctx.fillRect(vx, vy, vw, horizonY - vy);

      ctx.fillStyle = 'rgba(255, 244, 214, 0.85)';
      ctx.beginPath();
      ctx.arc(vx + vw * 0.78, vy + vh * 0.16, 44, 0, Math.PI * 2);
      ctx.fill();

      // Distant snow-capped mountains & rolling hills
      for (let i = 0; i < 5; i++) {
        const mx = vx + (i + 0.5) * (vw / 5);
        const mw = vw * 0.28;
        const mh = vh * (0.18 + (i % 2) * 0.06);
        ctx.fillStyle = '#a99be6';
        ctx.beginPath();
        ctx.moveTo(mx - mw * 0.5, horizonY);
        ctx.lineTo(mx, horizonY - mh);
        ctx.lineTo(mx + mw * 0.5, horizonY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fffdf7';
        ctx.beginPath();
        ctx.moveTo(mx - mw * 0.18, horizonY - mh * 0.64);
        ctx.lineTo(mx, horizonY - mh);
        ctx.lineTo(mx + mw * 0.18, horizonY - mh * 0.64);
        ctx.closePath();
        ctx.fill();
      }

      // Ground
      ctx.fillStyle = palette.grass;
      ctx.fillRect(vx, horizonY, vw, vh - horizonY);

      // Perspective Cobblestone Road + Candy Curbs + Dashed Lines
      const steerShift = (kart?.steerAngle || 0) * vw * 0.12;
      const roadCenterX = isMenuShowcase ? vx + vw * 0.64 : vx + vw * 0.5;
      const topX = roadCenterX - steerShift;

      ctx.fillStyle = palette.road;
      ctx.beginPath();
      ctx.moveTo(topX - vw * 0.07, horizonY);
      ctx.lineTo(topX + vw * 0.07, horizonY);
      ctx.lineTo(roadCenterX + vw * 0.44, vy + vh);
      ctx.lineTo(roadCenterX - vw * 0.44, vy + vh);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = INK;
      ctx.stroke();

      // Candy curbs along road edges
      for (let s = 0; s < 8; s++) {
        const t0 = s / 8;
        const t1 = (s + 1) / 8;
        ctx.strokeStyle = s % 2 === 0 ? track.theme.curbA : track.theme.curbB;
        ctx.lineWidth = 10;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(
            topX + side * (vw * 0.07 + (vw * 0.37) * t0) + steerShift * (1 - t0) * 0,
            horizonY + (vh - (horizonY - vy)) * t0
          );
          ctx.lineTo(
            topX + side * (vw * 0.07 + (vw * 0.37) * t1),
            horizonY + (vh - (horizonY - vy)) * t1
          );
          ctx.stroke();
        }
      }

      // Center white racing dashes
      ctx.strokeStyle = '#fffdf7';
      ctx.lineWidth = 5;
      ctx.setLineDash([18, 18]);
      ctx.beginPath();
      ctx.moveTo(topX, horizonY + 10);
      ctx.lineTo(roadCenterX, vy + vh);
      ctx.stroke();
      ctx.setLineDash([]);

      // Cartoon Trees on sides
      for (const side of [-1, 1]) {
        const tx = roadCenterX + side * vw * 0.36;
        const ty = horizonY + vh * 0.14;
        ctx.fillStyle = '#9a6646';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 4;
        ctx.fillRect(tx - 8, ty - 38, 16, 42);
        ctx.strokeRect(tx - 8, ty - 38, 16, 42);
        for (const [ox, oy, r, col] of [[-18, -46, 22, '#4ab35c'], [18, -46, 22, '#72d67c'], [0, -62, 28, '#5bc768']]) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(tx + ox, ty + oy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Wooden `?` Crate on road ahead
      const cx = topX + (roadCenterX - topX) * 0.45 + 34;
      const cy = horizonY + vh * 0.18;
      ctx.fillStyle = '#ff9f43';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.roundRect(cx - 18, cy - 18, 36, 36, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fffdf7';
      ctx.font = '900 22px Fredoka, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('?', cx, cy + 8);

      // Detailed Cartoon Kart & Faceless Driver
      const kx = roadCenterX;
      const ky = vy + vh * 0.77 - (kart?.y || 0) * 14;
      const drv = DRIVERS.find((d) => d.id === kart?.driverId) || DRIVERS[0];

      // Shadow
      ctx.fillStyle = 'rgba(42, 26, 58, 0.28)';
      ctx.beginPath();
      ctx.ellipse(kx, vy + vh * 0.84, 68, 18, 0, 0, Math.PI * 2);
      ctx.fill();

      // Rear Tires with White Rims
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      for (const sx of [-1, 1]) {
        ctx.fillStyle = '#2b2d42';
        ctx.beginPath();
        ctx.roundRect(kx + sx * 52 - 14, ky - 22, 28, 38, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fffdf7';
        ctx.beginPath();
        ctx.roundRect(kx + sx * 52 - 7, ky - 14, 14, 22, 4);
        ctx.fill();
      }

      // Kart Chassis & Sidepods
      ctx.fillStyle = drv.kartColor;
      ctx.beginPath();
      ctx.roundRect(kx - 46, ky - 16, 92, 30, 12);
      ctx.fill();
      ctx.stroke();

      // Rear Spoiler Wing & Chrome Exhausts
      ctx.fillStyle = drv.accent;
      ctx.beginPath();
      ctx.roundRect(kx - 42, ky - 36, 84, 10, 5);
      ctx.fill();
      ctx.stroke();

      // Driver Torso & Faceless Head + Ears/Headgear
      ctx.fillStyle = drv.suitColor;
      ctx.beginPath();
      ctx.roundRect(kx - 22, ky - 52, 44, 28, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = drv.color;
      ctx.beginPath();
      ctx.arc(kx, ky - 68, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Pointed Ears / Helmet Fin
      for (const sx of [-1, 1]) {
        ctx.fillStyle = drv.color;
        ctx.beginPath();
        ctx.moveTo(kx + sx * 10, ky - 84);
        ctx.lineTo(kx + sx * 22, ky - 104);
        ctx.lineTo(kx + sx * 20, ky - 78);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Turbo Exhaust Flames
      if (kart?.turboActive) {
        for (const sx of [-1, 1]) {
          ctx.fillStyle = '#ffd166';
          ctx.beginPath();
          ctx.arc(kx + sx * 20, ky + 14, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ff4d6d';
          ctx.beginPath();
          ctx.arc(kx + sx * 20, ky + 14, 7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    };

    if (mode === '2p' && focusKartIds.length >= 2 && !isMenuShowcase) {
      const k1 = snapshot.karts.find((k) => k.id === focusKartIds[0]) || snapshot.karts[0];
      const k2 = snapshot.karts.find((k) => k.id === focusKartIds[1]) || snapshot.karts[1];
      drawView(0, 0, w * 0.5, h, k1);
      drawView(w * 0.5, 0, w * 0.5, h, k2);
    } else {
      const k1 = snapshot.karts.find((k) => k.id === focusKartIds[0]) || snapshot.karts[0];
      drawView(0, 0, w, h, k1);
    }
  }
}

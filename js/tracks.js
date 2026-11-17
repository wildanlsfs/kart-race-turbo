// Closed Catmull-Rom circuit splines, original circuits, and faceless driver roster.

export const DRIVERS = [
  {
    id: 'rufus',
    name: 'Rufus Dash',
    role: 'Balanced',
    color: '#ff6f1e',
    suitColor: '#2563eb',
    kartColor: '#f97316',
    accent: '#facc15',
    headgear: 'ears', // Pointed fox ears (faceless)
    ai: { skill: 1.0, lane: -0.4 },
    stats: { topSpeed: 29.56, accel: 26.41, handling: 4.1, boostBonus: 12 },
  },
  {
    id: 'jet',
    name: 'Jet Mint',
    role: 'Top Speed',
    color: '#22c55e',
    suitColor: '#14532d',
    kartColor: '#10b981',
    accent: '#a3e635',
    headgear: 'helmet', // Aero racing helmet (faceless)
    ai: { skill: 1.0, lane: 0.3 },
    stats: { topSpeed: 30.68, accel: 22, handling: 4.09, boostBonus: 12 },
  },
  {
    id: 'maka',
    name: 'Maka Tiki',
    role: 'Handling',
    color: '#eab308',
    suitColor: '#78350f',
    kartColor: '#f59e0b',
    accent: '#ef4444',
    headgear: 'crown', // Wooden tiki feathers (faceless)
    ai: { skill: 1.0, lane: 0.5 },
    stats: { topSpeed: 29.4, accel: 25, handling: 4.7, boostBonus: 12 },
  },
  {
    id: 'volt',
    name: 'Neo Volt',
    role: 'Acceleration',
    color: '#a855f7',
    suitColor: '#3b0764',
    kartColor: '#8b5cf6',
    accent: '#38bdf8',
    headgear: 'visor', // Tech dome visor (faceless)
    ai: { skill: 1.0, lane: -0.2 },
    stats: { topSpeed: 29.15, accel: 32.58, handling: 3.91, boostBonus: 12 },
  },
];

export const ITEMS = ['rocket', 'bomb', 'tnt', 'shield'];

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

function buildTrackData(def) {
  const pts = def.controlPoints;
  const n = pts.length;
  const samplesCount = 480;
  // Dense Catmull-Rom curve first, then resampled at equal arc length so that s (0..1) is the fraction
  // of the lap in metres: sectors, pads, ramps and crates are then placed by real distance.
  const dense = [];
  const perSeg = 80;
  for (let i = 0; i < n * perSeg; i++) {
    const idx = Math.floor(i / perSeg) % n;
    const frac = (i % perSeg) / perSeg;
    dense.push(catmullRom(pts[(idx - 1 + n) % n], pts[idx], pts[(idx + 1) % n], pts[(idx + 2) % n], frac));
  }
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const denseLen = cum[cum.length - 1];
  const samples = [];
  let j = 0;
  for (let i = 0; i < samplesCount; i++) {
    const target = (i / samplesCount) * denseLen;
    while (cum[j + 1] < target) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const f = (target - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    samples.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
  }

  // Compute tangents, right vectors, and cumulative arc length
  let totalLength = 0;
  for (let i = 0; i < samplesCount; i++) {
    const prev = samples[(i - 1 + samplesCount) % samplesCount];
    const curr = samples[i];
    const next = samples[(i + 1) % samplesCount];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    curr.tx = dx / len;
    curr.tz = dz / len;
    // Right vector perpendicular to forward tangent (tx, tz) in XZ plane
    curr.rx = -curr.tz;
    curr.rz = curr.tx;
    curr.s = i / samplesCount;
    totalLength += Math.hypot(curr.x - prev.x, curr.z - prev.z);
  }

  const getPointAt = (normS) => {
    const wrapped = ((normS % 1) + 1) % 1;
    const f = wrapped * samplesCount;
    const i0 = Math.floor(f) % samplesCount;
    const i1 = (i0 + 1) % samplesCount;
    const a = f - Math.floor(f);
    const s0 = samples[i0];
    const s1 = samples[i1];
    return {
      x: s0.x + (s1.x - s0.x) * a,
      y: s0.y + (s1.y - s0.y) * a,
      z: s0.z + (s1.z - s0.z) * a,
      tx: s0.tx + (s1.tx - s0.tx) * a,
      tz: s0.tz + (s1.tz - s0.tz) * a,
      rx: s0.rx + (s1.rx - s0.rx) * a,
      rz: s0.rz + (s1.rz - s0.rz) * a,
      s: wrapped,
    };
  };

  // Place item crate rows, mango fruits, boost pads, and ramps along track fractions
  const crateSpawns = [];
  for (const rowS of def.crateRowFractions) {
    const pt = getPointAt(rowS);
    const half = def.roadWidth * 0.5;
    for (const laneOffset of [-half * 0.78, -half * 0.26, half * 0.26, half * 0.78]) {
      crateSpawns.push({
        id: `crate_${crateSpawns.length}`,
        s: rowS,
        x: pt.x + pt.rx * laneOffset,
        y: pt.y + 0.9,
        z: pt.z + pt.rz * laneOffset,
      });
    }
  }

  const fruitSpawns = [];
  for (let i = 0; i < 16; i++) {
    const s = ((i + 0.5) / 16) % 1;
    const pt = getPointAt(s);
    const side = ((i % 3) - 1) * 3.0;
    fruitSpawns.push({
      id: `fruit_${i}`,
      s,
      x: pt.x + pt.rx * side,
      y: pt.y + 0.7,
      z: pt.z + pt.rz * side,
    });
  }

  const boostPads = def.boostFractions.map((b, i) => {
    const pt = getPointAt(b.s);
    return {
      id: `boost_${i}`,
      s: b.s,
      x: pt.x + pt.rx * (b.offset || 0),
      y: pt.y + 0.08,
      z: pt.z + pt.rz * (b.offset || 0),
      tx: pt.tx,
      tz: pt.tz,
      radius: 3.6,
    };
  });

  const ramps = def.rampFractions.map((r, i) => {
    const pt = getPointAt(r.s);
    return {
      id: `ramp_${i}`,
      s: r.s,
      x: pt.x + pt.rx * (r.offset || 0),
      y: pt.y,
      z: pt.z + pt.rz * (r.offset || 0),
      tx: pt.tx,
      tz: pt.tz,
      radius: 3.8,
    };
  });

  return {
    ...def,
    waypoints: pts,
    samples,
    totalLength,
    getPointAt,
    crateSpawns,
    fruitSpawns,
    boostPads,
    ramps,
  };
}

const RAW_TRACKS = [
  {
    id: 'island',
    name: 'Palm Cove',
    subtitle: 'Sunny beach curves & wooden tiki bridges',
    tag: 'Beginner',
    length: 'Short',
    mechanic: 'Wide, flowing road: easy to learn, hard to lose',
    roadWidth: 16,
    theme: {
      skyTop: '#38bdf8',
      skyBottom: '#bae6fd',
      ground: '#22c55e',
      road: '#d97706',
      curbA: '#ef4444',
      curbB: '#fef08a',
      scenery: 'island',
    },
    controlPoints: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -72 },
      { x: 20, y: 0, z: -128 },
      { x: 68, y: 0, z: -160 },
      { x: 128, y: 0, z: -156 },
      { x: 172, y: 0, z: -120 },
      { x: 184, y: 0, z: -68 },
      { x: 160, y: 0, z: -20 },
      { x: 120, y: 0, z: 8 },
      { x: 104, y: 0, z: 48 },
      { x: 124, y: 0, z: 92 },
      { x: 120, y: 0, z: 140 },
      { x: 80, y: 0, z: 172 },
      { x: 32, y: 0, z: 160 },
      { x: 8, y: 0, z: 120 },
      { x: 0, y: 0, z: 64 },
    ],
    crateRowFractions: [0.10, 0.33, 0.58, 0.80],
    boostFractions: [
      { s: 0.12, offset: 0 },
      { s: 0.3, offset: -3.0 },
      { s: 0.52, offset: 3.0 },
      { s: 0.74, offset: 0 },
      { s: 0.9, offset: -3.0 },
    ],
    rampFractions: [
      { s: 0.47, offset: 0 },
      { s: 0.95, offset: 0 },
    ],
  },
  {
    id: 'canyon',
    name: 'Canyon Dash',
    subtitle: 'Red mesa hairpins & high-speed jump ramps',
    tag: 'Technical',
    length: 'Long',
    mechanic: 'Hairpins and 4 jump ramps on a narrow road',
    roadWidth: 13.5,
    theme: {
      skyTop: '#fb923c',
      skyBottom: '#fde68a',
      ground: '#ea580c',
      road: '#78350f',
      curbA: '#facc15',
      curbB: '#dc2626',
      scenery: 'canyon',
    },
    controlPoints: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -76 },
      { x: 7, y: 0, z: -131 },
      { x: 42, y: 0, z: -155 },
      { x: 76, y: 0, z: -138 },
      { x: 72, y: 0, z: -96 },
      { x: 42, y: 0, z: -76 },
      { x: 42, y: 0, z: -42 },
      { x: 83, y: 0, z: -21 },
      { x: 131, y: 0, z: -42 },
      { x: 148, y: 0, z: -86 },
      { x: 193, y: 0, z: -103 },
      { x: 228, y: 0, z: -76 },
      { x: 214, y: 0, z: -31 },
      { x: 172, y: 0, z: 0 },
      { x: 180, y: 0, z: 48 },
      { x: 214, y: 0, z: 83 },
      { x: 193, y: 0, z: 127 },
      { x: 138, y: 0, z: 138 },
      { x: 96, y: 0, z: 111 },
      { x: 55, y: 0, z: 90 },
      { x: 21, y: 0, z: 103 },
      { x: -14, y: 0, z: 76 },
      { x: -10, y: 0, z: 34 },
    ],
    crateRowFractions: [0.12, 0.30, 0.48, 0.66, 0.84],
    boostFractions: [
      { s: 0.09, offset: 0 },
      { s: 0.37, offset: 1.8 },
      { s: 0.62, offset: -1.8 },
      { s: 0.88, offset: 0 },
    ],
    rampFractions: [
      { s: 0.05, offset: 0 },
      { s: 0.22, offset: 0 },
      { s: 0.53, offset: 0 },
      { s: 0.75, offset: 0 },
    ],
  },
  {
    id: 'temple',
    name: 'Temple Ruins',
    subtitle: 'Ancient mossy stones, torches & turbo straights',
    tag: 'Speed',
    length: 'Medium',
    mechanic: 'Long straights, chicanes and 8 boost pads',
    roadWidth: 15.5,
    theme: {
      skyTop: '#1e1b4b',
      skyBottom: '#4338ca',
      ground: '#15803d',
      road: '#475569',
      curbA: '#10b981',
      curbB: '#f8fafc',
      scenery: 'temple',
    },
    controlPoints: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -41 },
      { x: -8, y: 0, z: -77 },
      { x: 8, y: 0, z: -114 },
      { x: 0, y: 0, z: -150 },
      { x: 0, y: 0, z: -168 },
      { x: 7, y: 0, z: -187 },
      { x: 27, y: 0, z: -200 },
      { x: 56, y: 0, z: -204 },
      { x: 91, y: 0, z: -204 },
      { x: 118, y: 0, z: -209 },
      { x: 146, y: 0, z: -199 },
      { x: 173, y: 0, z: -204 },
      { x: 200, y: 0, z: -201 },
      { x: 218, y: 0, z: -184 },
      { x: 222, y: 0, z: -155 },
      { x: 222, y: 0, z: -118 },
      { x: 214, y: 0, z: -86 },
      { x: 230, y: 0, z: -55 },
      { x: 222, y: 0, z: -23 },
      { x: 222, y: 0, z: 9 },
      { x: 220, y: 0, z: 41 },
      { x: 211, y: 0, z: 77 },
      { x: 187, y: 0, z: 98 },
      { x: 155, y: 0, z: 102 },
      { x: 135, y: 0, z: 102 },
      { x: 108, y: 0, z: 102 },
      { x: 82, y: 0, z: 102 },
      { x: 56, y: 0, z: 102 },
      { x: 25, y: 0, z: 100 },
      { x: -4, y: 0, z: 84 },
      { x: 0, y: 0, z: 50 },
    ],
    crateRowFractions: [0.10, 0.34, 0.58, 0.82],
    boostFractions: [
      { s: 0.03, offset: 0 },
      { s: 0.13, offset: -2.5 },
      { s: 0.285, offset: 2.5 },
      { s: 0.4, offset: 0 },
      { s: 0.52, offset: -2.5 },
      { s: 0.62, offset: 2.5 },
      { s: 0.72, offset: 0 },
      { s: 0.89, offset: 2.5 },
    ],
    rampFractions: [
      { s: 0.78, offset: 0 },
    ],
  },
];

export const TRACKS = RAW_TRACKS.map(buildTrackData);

export function getTrackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

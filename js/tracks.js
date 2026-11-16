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
    stats: { topSpeed: 29, accel: 26, handling: 4.0, boostBonus: 12 },
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
    stats: { topSpeed: 30, accel: 23, handling: 3.8, boostBonus: 12.5 },
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
    stats: { topSpeed: 28, accel: 27, handling: 4.4, boostBonus: 12 },
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
    stats: { topSpeed: 28.5, accel: 29, handling: 4.15, boostBonus: 12 },
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
  const samplesCount = 240;
  const samples = [];

  for (let i = 0; i < samplesCount; i++) {
    const u = (i / samplesCount) * n;
    const idx = Math.floor(u) % n;
    const frac = u - Math.floor(u);
    const p0 = pts[(idx - 1 + n) % n];
    const p1 = pts[idx];
    const p2 = pts[(idx + 1) % n];
    const p3 = pts[(idx + 2) % n];
    samples.push(catmullRom(p0, p1, p2, p3, frac));
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
    if (i > 0) {
      totalLength += Math.hypot(curr.x - prev.x, curr.z - prev.z);
    }
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
    for (const laneOffset of [-4.2, -1.4, 1.4, 4.2]) {
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
    roadWidth: 13.5,
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
      { x: 0, y: 0, z: -55 },
      { x: 25, y: 0, z: -105 },
      { x: 75, y: 0, z: -120 },
      { x: 125, y: 0, z: -95 },
      { x: 145, y: 0, z: -45 },
      { x: 125, y: 0, z: 10 },
      { x: 95, y: 0, z: 45 },
      { x: 115, y: 0, z: 95 },
      { x: 75, y: 0, z: 130 },
      { x: 20, y: 0, z: 115 },
      { x: -10, y: 0, z: 60 },
    ],
    crateRowFractions: [0.14, 0.38, 0.64, 0.86],
    boostFractions: [
      { s: 0.08, offset: 0 },
      { s: 0.28, offset: -2.5 },
      { s: 0.52, offset: 2.2 },
      { s: 0.78, offset: 0 },
    ],
    rampFractions: [
      { s: 0.44, offset: 0 },
      { s: 0.91, offset: 0 },
    ],
  },
  {
    id: 'canyon',
    name: 'Canyon Dash',
    subtitle: 'Red mesa hairpins & high-speed jump ramps',
    roadWidth: 13.0,
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
      { x: 0, y: 0, z: -65 },
      { x: 40, y: 0, z: -120 },
      { x: 100, y: 0, z: -125 },
      { x: 135, y: 0, z: -75 },
      { x: 90, y: 0, z: -30 },
      { x: 65, y: 0, z: 10 },
      { x: 120, y: 0, z: 55 },
      { x: 110, y: 0, z: 115 },
      { x: 55, y: 0, z: 135 },
      { x: 5, y: 0, z: 105 },
      { x: -12, y: 0, z: 55 },
    ],
    crateRowFractions: [0.16, 0.42, 0.68, 0.88],
    boostFractions: [
      { s: 0.10, offset: 0 },
      { s: 0.33, offset: 2.0 },
      { s: 0.58, offset: -2.0 },
      { s: 0.82, offset: 0 },
    ],
    rampFractions: [
      { s: 0.24, offset: 0 },
      { s: 0.62, offset: 0 },
      { s: 0.92, offset: 0 },
    ],
  },
  {
    id: 'temple',
    name: 'Temple Ruins',
    subtitle: 'Ancient mossy stones, torches & turbo straights',
    roadWidth: 14.0,
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
      { x: 0, y: 0, z: -60 },
      { x: -35, y: 0, z: -110 },
      { x: 15, y: 0, z: -145 },
      { x: 85, y: 0, z: -135 },
      { x: 130, y: 0, z: -85 },
      { x: 115, y: 0, z: -20 },
      { x: 75, y: 0, z: 25 },
      { x: 95, y: 0, z: 85 },
      { x: 55, y: 0, z: 130 },
      { x: 0, y: 0, z: 110 },
      { x: -15, y: 0, z: 55 },
    ],
    crateRowFractions: [0.12, 0.36, 0.60, 0.84],
    boostFractions: [
      { s: 0.07, offset: 0 },
      { s: 0.26, offset: -2.5 },
      { s: 0.48, offset: 2.5 },
      { s: 0.72, offset: 0 },
      { s: 0.90, offset: 0 },
    ],
    rampFractions: [
      { s: 0.31, offset: 0 },
      { s: 0.77, offset: 0 },
    ],
  },
];

export const TRACKS = RAW_TRACKS.map(buildTrackData);

export function getTrackById(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

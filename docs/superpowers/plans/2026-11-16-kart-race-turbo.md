# Kart Race Turbo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `kart-race-turbo`, a 3D minimalist arcade-inspired kart racing game controlled by webcam body motions (plus keyboard/gamepad/touch) supporting Single Player, 2-Player Same-Device Split-Screen, and 4-Player Wi-Fi/LAN Multiplayer.

**Architecture:** Static ES modules (`index.html`, `style.css`, `js/*.js`) rendering procedural toon-shaded 3D tracks and faceless karts via Three.js `0.160.0` (importmap), paired with a classic Web Worker (`js/pose-worker.js`) running MediaPipe Pose Landmarker `0.10.14` and a pure-logic motion & physics core testable with `node --test`. A zero-dependency Node.js HTTP + WebSocket server (`server.mjs`) serves the static app on `0.0.0.0:3000` and coordinates authoritative/synced LAN multiplayer rooms.

**Tech Stack:** Three.js `0.160.0` (ESM via CDN importmap), MediaPipe Tasks Vision `0.10.14` (Web Worker), Web Audio API (procedural SFX), Node.js `>=20` built-in `http` / `crypto` / `node:test` (for LAN server and unit tests).

**Spec:** `/Users/user/Documents/Development/projects/yolo-dev/kart-race-turbo/docs/superpowers/specs/2026-11-16-kart-race-turbo-design.md`

## Global Constraints

- Characters are strictly faceless: no eyes, mouths, or face lines anywhere on 3D models or UI icons.
- No background music; all sound effects are synthesized via Web Audio API.
- Cap WebGL drawing buffer to `<= 2,200,000` pixels and scale `devicePixelRatio` adaptively when FPS `< 50`.
- Cap menu/lobby rendering at `30` FPS; set `renderer.shadowMap.autoUpdate = false` and use blob shadows under moving karts/projectiles.
- Reuse geometries and materials across crates, particles, and projectiles; never use CSS `backdrop-filter` over the canvas, and keep hidden modals `visibility: hidden`.
- Run MediaPipe Pose Landmarker (`0.10.14` lite, `numPoses: 2`) in a classic Web Worker (`js/pose-worker.js`) loaded from `unpkg`, feeding ~480px wide `ImageBitmap` frames via `requestVideoFrameCallback`.
- Expose `window.__game` (`getMetrics()`, `getState()`, `startMode()`, `injectPose()`, `triggerAction()`) and `?debug` panel for headless verification.
- Do not run `git commit` unless explicitly asked by the user.

## Review Focus

1. **Mirrored webcam steering direction:** When a player tilts their hands or leans toward the right side of their own body in front of a mirrored webcam (`x` decreases in raw normalized camera coordinates), the kart must steer right (`steer > 0`), never inverted.
2. **2-Player webcam crossover / dropout:** When two players stand in front of one webcam or one player briefly drops out for `< 400 ms`, Player 1 (left side of screen) and Player 2 (right side of screen) must retain their respective tracks and calibrated shoulder widths without swapping karts.
3. **Punch vs. steering/brake false positives:** Punching one hand forward to fire an item must not simultaneously trigger a hard turn or a brake/reverse state.
4. **Track boundary & lap-skip prevention:** Reversing across the finish line or cutting across the inner grass must not increment the lap counter; laps only increment when crossing the finish line after passing checkpoint segments in order (`0 -> 1 -> 2 -> finish`).
5. **LAN room mid-race disconnect:** If a LAN client disconnects mid-race or a room has fewer than 4 human players, the race continues smoothly without crashing the room loop or freezing remaining players.

---

### Task 1: Motion Filter & Pose-to-Kart Controller (`js/motion.js` + `js/pose-worker.js`)

**Files:**
- Create: `package.json`
- Create: `js/motion.js`
- Create: `js/pose-worker.js`
- Test: `tests/motion.test.mjs`

**Interfaces:**
- Consumes: Raw MediaPipe Pose Landmarker 33-point normalized (`landmarks`) and metric (`worldLandmarks`) arrays.
- Produces:
  - `class OneEuroFilter { constructor(minCutoff, beta, dCutoff); filter(value, timestampSec): number }`
  - `class MotionController { constructor(options?: { autoGas?: boolean }); calibrate(poses: Array<Pose>): boolean; update(poses: Array<Pose>, nowMs: number, playerCount: 1 | 2): Array<KartInput> }`
  - `type KartInput = { throttle: number, brake: boolean, reverse: boolean, steer: number, turbo: boolean, attack: boolean, hop: boolean, calibrated: boolean, visible: boolean, poseLabel: string }`

- [ ] **Step 1: Write the failing test in `tests/motion.test.mjs`**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { OneEuroFilter, MotionController, makeSyntheticPose } from '../js/motion.js';

test('OneEuroFilter smooths jitter while tracking step changes', () => {
  const f = new OneEuroFilter(1.2, 0.05);
  assert.equal(f.filter(0, 0.0), 0);
  const v1 = f.filter(1, 0.016);
  assert.ok(v1 > 0 && v1 < 1);
  const v2 = f.filter(1, 0.5);
  assert.ok(v2 > 0.85);
});

test('MotionController maps mirrored lean/wheel-tilt, brake crouch, hands-up turbo, and punch attack without cross-triggering', () => {
  const ctrl = new MotionController({ autoGas: true });
  const neutral = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2 });
  ctrl.calibrate([neutral]);

  // Neutral auto-gas drives forward straight
  let [p1] = ctrl.update([neutral], 100, 1);
  assert.equal(p1.throttle, 1);
  assert.ok(Math.abs(p1.steer) < 0.05);

  // Player leans right in real life (mirrored camera raw x moves toward 0.42)
  const rightTurn = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, leanRight: 0.6, wheelTiltRight: 0.5 });
  [p1] = ctrl.update([rightTurn], 200, 1);
  assert.ok(p1.steer > 0.35, `Expected positive right steer, got ${p1.steer}`);

  // Punch forward triggers attack without triggering brake or wild steering
  const punch = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, rightPunch: true });
  [p1] = ctrl.update([punch], 300, 1);
  assert.equal(p1.attack, true);
  assert.equal(p1.brake, false);
  assert.ok(Math.abs(p1.steer) < 0.35);

  // Both hands overhead triggers turbo
  const handsUp = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, handsUp: true });
  [p1] = ctrl.update([handsUp], 450, 1);
  assert.equal(p1.turbo, true);

  // Pull hands to chest / crouch triggers brake, and after holding triggers reverse
  const brakePose = makeSyntheticPose({ centerX: 0.5, shoulderWidth: 0.2, crouch: true });
  [p1] = ctrl.update([brakePose], 600, 1);
  assert.equal(p1.brake, true);
  [p1] = ctrl.update([brakePose], 1100, 1);
  assert.equal(p1.reverse, true);
});

test('2-player webcam mode keeps P1 (screen-left) and P2 (screen-right) locked across <400ms dropout', () => {
  const ctrl = new MotionController({ autoGas: true });
  // Screen-left in mirrored view has larger raw camera X (~0.70); screen-right has smaller raw X (~0.30)
  const poseLeft = makeSyntheticPose({ centerX: 0.70, shoulderWidth: 0.16 });
  const poseRight = makeSyntheticPose({ centerX: 0.30, shoulderWidth: 0.18 });
  ctrl.calibrate([poseLeft, poseRight], 2);

  const [in1, in2] = ctrl.update([
    makeSyntheticPose({ centerX: 0.70, shoulderWidth: 0.16, leanRight: -0.7 }),
    makeSyntheticPose({ centerX: 0.30, shoulderWidth: 0.18, leanRight: 0.7 }),
  ], 100, 2);
  assert.ok(in1.steer < -0.25);
  assert.ok(in2.steer > 0.25);

  // P1 drops out for 200ms (< 400ms persistence window); P2 must stay P2
  const [drop1, drop2] = ctrl.update([
    makeSyntheticPose({ centerX: 0.30, shoulderWidth: 0.18, leanRight: 0.7 }),
  ], 300, 2);
  assert.equal(drop1.visible, true);
  assert.ok(drop2.steer > 0.25);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/motion.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../js/motion.js`

- [ ] **Step 3: Implement `package.json`, `js/motion.js`, and `js/pose-worker.js`**

Create `package.json` (`type: "module"`, scripts `test: "node --test tests/*.test.mjs"`, `server: "node server.mjs"`). Implement `OneEuroFilter`, `MotionController`, and `makeSyntheticPose` in `js/motion.js`, and implement the classic Web Worker `js/pose-worker.js` loading `@mediapipe/tasks-vision@0.10.14/vision_bundle.cjs` from `unpkg` with `numPoses: 2` and GPU->CPU fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/motion.test.mjs`
Expected: PASS (3/3 tests passing)

---

### Task 2: Track Splines, Kart Physics, Checkpoints & Items Core (`js/sim.js`)

**Files:**
- Create: `js/tracks.js`
- Create: `js/sim.js`
- Test: `tests/sim.test.mjs`

**Interfaces:**
- Consumes: `KartInput` from `js/motion.js`
- Produces:
  - `TRACKS`: array of 3 circuit definitions (`id: 'island' | 'canyon' | 'temple'`, `name`, `theme`, `roadWidth`, `waypoints`, `boostPads`, `crateSpawns`, `ramps`)
  - `DRIVERS`: array of 4 faceless driver definitions (`id`, `name`, `color`, `accent`, `headgear`, `stats: { topSpeed, accel, handling, boost }`)
  - `ITEMS`: `'rocket' | 'bomb' | 'tnt' | 'shield'`
  - `class RaceSimulation { constructor({ trackId, mode, players, totalLaps }); step(dtSec: number, inputsById: Record<string, KartInput>): RaceSnapshot; getSnapshot(): RaceSnapshot }`

- [ ] **Step 1: Write the failing test in `tests/sim.test.mjs`**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, DRIVERS, RaceSimulation } from '../js/sim.js';

test('Tracks provide closed loop splines, checkpoints, crates, and boost pads for 3 circuits', () => {
  assert.equal(TRACKS.length, 3);
  for (const t of TRACKS) {
    assert.ok(t.waypoints.length >= 12);
    assert.ok(t.crateSpawns.length >= 6);
    assert.ok(t.boostPads.length >= 3);
  }
  assert.equal(DRIVERS.length, 4);
});

test('Kart physics accelerates, steers, charges and fires turbo, and prevents lap skipping when reversing', () => {
  const sim = new RaceSimulation({
    trackId: 'island',
    mode: '1p',
    players: [{ id: 'p1', name: 'P1', driverId: 'rufus', isAI: false }],
    totalLaps: 3,
  });

  // Skip countdown for physics test
  sim.countdown = 0;
  sim.status = 'racing';

  // Reversing across start line must NOT increment lap
  for (let i = 0; i < 60; i++) {
    sim.step(1 / 60, { p1: { throttle: 0, brake: true, reverse: true, steer: 0, turbo: false, attack: false, hop: false } });
  }
  assert.equal(sim.karts[0].lap, 1);

  // Driving forward increases speed; turbo boost increases speed above base topSpeed
  sim.karts[0].turboCharge = 100;
  for (let i = 0; i < 90; i++) {
    sim.step(1 / 60, { p1: { throttle: 1, brake: false, reverse: false, steer: 0, turbo: true, attack: false, hop: false } });
  }
  assert.ok(sim.karts[0].speed > sim.karts[0].baseTopSpeed);
  assert.ok(sim.karts[0].turboCharge < 100);
});

test('Smashing an item crate grants a weapon and punching fires a projectile or hazard', () => {
  const sim = new RaceSimulation({
    trackId: 'island',
    mode: '1p',
    players: [
      { id: 'p1', name: 'P1', driverId: 'rufus', isAI: false },
      { id: 'ai1', name: 'Bot 1', driverId: 'jet', isAI: true },
    ],
    totalLaps: 3,
  });
  sim.countdown = 0;
  sim.status = 'racing';

  const kart = sim.karts[0];
  const crate = sim.crates[0];
  kart.x = crate.x;
  kart.z = crate.z;
  sim.step(1 / 60, { p1: { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: false, hop: false } });
  assert.equal(crate.active, false);
  assert.ok(['rocket', 'bomb', 'tnt', 'shield'].includes(kart.heldItem));

  // Punching fires the held item
  kart.heldItem = 'rocket';
  sim.step(1 / 60, { p1: { throttle: 1, brake: false, reverse: false, steer: 0, turbo: false, attack: true, hop: false } });
  assert.equal(kart.heldItem, null);
  assert.equal(sim.projectiles.length, 1);
  assert.equal(sim.projectiles[0].type, 'rocket');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sim.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../js/sim.js`

- [ ] **Step 3: Implement `js/tracks.js` and `js/sim.js`**

Implement Catmull-Rom closed track spline sampling (`getTrackPointAt(s)`, `getNearestTrackProgress(x, z)`), the 3 original circuits (*Palm Cove*, *Canyon Dash*, *Temple Ruins*), the 4 faceless driver presets, and `RaceSimulation` in `js/sim.js` (handling countdown, kart acceleration/braking/reverse, proportional steering + hop/drift boost charging, off-road grass slowdown, ordered checkpoint validation so reversing cannot increment laps, `?` item crates + Mango fruit pickups, 4 items, AI path-following + item usage, and race rankings).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sim.test.mjs`
Expected: PASS (3/3 tests passing)

---

### Task 3: LAN Multiplayer Server & Client Protocol (`server.mjs` + `js/net.js`)

**Files:**
- Create: `server.mjs`
- Create: `js/net.js`
- Test: `tests/lan.test.mjs`

**Interfaces:**
- Consumes: `RaceSimulation` from `js/sim.js`
- Produces:
  - `createLanServer({ port?: number, host?: string }): Promise<{ server, port, urls, close }>` in `server.mjs`
  - HTTP endpoints: `GET /api/lan-info` (`{ urls, rooms: Array<{ code, trackId, hostName, playerCount, status }> }`) and static file serving for the project root.
  - WebSocket protocol on `/ws`: messages `create_room`, `join_room`, `list_rooms`, `select_track`, `start_race`, `input`, `leave_room`; broadcasts `room_state`, `race_snapshot` (30 Hz), `race_over`.
  - `class LanClient` in `js/net.js` for browser room creation, room list polling, joining via 4-letter code, sending inputs, and receiving state snapshots.

- [ ] **Step 1: Write the failing test in `tests/lan.test.mjs`**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLanServer } from '../server.mjs';

test('LAN server creates room, lists rooms on /api/lan-info, syncs race snapshots, and handles mid-race disconnect', async () => {
  const srv = await createLanServer({ port: 0, host: '127.0.0.1' });
  try {
    const ws1 = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);

    const waitMsg = (ws, type) => new Promise((resolve) => {
      const handler = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === type) {
          ws.removeEventListener('message', handler);
          resolve(msg);
        }
      };
      ws.addEventListener('message', handler);
    });

    await Promise.all([
      new Promise((r) => ws1.addEventListener('open', r, { once: true })),
      new Promise((r) => ws2.addEventListener('open', r, { once: true })),
    ]);

    const roomCreatedP = waitMsg(ws1, 'room_state');
    ws1.send(JSON.stringify({ type: 'create_room', name: 'HostWildan', driverId: 'rufus', trackId: 'canyon' }));
    const created = await roomCreatedP;
    assert.equal(created.room.code.length, 4);

    // Check /api/lan-info exposes the room for one-tap join on same Wi-Fi
    const infoRes = await fetch(`http://127.0.0.1:${srv.port}/api/lan-info`);
    const info = await infoRes.json();
    assert.equal(info.rooms.length, 1);
    assert.equal(info.rooms[0].code, created.room.code);

    // Player 2 joins room
    const joinedP = waitMsg(ws2, 'room_state');
    ws2.send(JSON.stringify({ type: 'join_room', code: created.room.code, name: 'Guest2', driverId: 'jet' }));
    const joined = await joinedP;
    assert.equal(joined.room.players.length, 2);

    // Start race and verify snapshots stream at 30 Hz
    const snapP = waitMsg(ws2, 'race_snapshot');
    ws1.send(JSON.stringify({ type: 'start_race', fillAI: true }));
    const snap = await snapP;
    assert.equal(snap.snapshot.karts.length, 4);

    // Guest disconnects mid-race; host still receives snapshots without server crash
    ws2.close();
    const nextSnap = await waitMsg(ws1, 'race_snapshot');
    assert.equal(nextSnap.snapshot.karts.length, 4);
    ws1.close();
  } finally {
    await srv.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lan.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../server.mjs`

- [ ] **Step 3: Implement `server.mjs` and `js/net.js`**

Implement RFC 6455 WebSocket upgrade + frame parser/encoder and static file + `/api/lan-info` server in `server.mjs` (using only Node built-ins `node:http`, `node:crypto`, `node:fs`, `node:os`, `node:path`) running `RaceSimulation` on the server at 30 Hz per active room, plus `js/net.js` client wrapper.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/lan.test.mjs`
Expected: PASS

---

### Task 4: 3D Procedural Toon Renderer, Faceless Karts, Audio & Split-Screen Viewports (`js/renderer.js` + `js/audio.js`)

**Files:**
- Create: `js/audio.js`
- Create: `js/renderer.js`

**Interfaces:**
- Consumes: `TRACKS`, `DRIVERS`, `RaceSnapshot` from `js/sim.js`
- Produces:
  - `class SoundFX` in `js/audio.js`: WebAudio procedural sounds (`beep()`, `engineTick()`, `smashCrate()`, `pickupFruit()`, `turbo()`, `fireItem()`, `explosion()`, `lap()`, `victory()`) with mute toggle and zero audio files or background music.
  - `class RaceRenderer` in `js/renderer.js`:
    - Caps drawing buffer to `2,200,000` pixels with adaptive resolution scaling.
    - Builds procedural toon-shaded track ribbon with red/white curbs, checkered start arch, boost pads, wooden `?` crates, Mango fruits, ramps, and themed environment props (palms/water for Island, sandstone arches/cacti for Canyon, stepped stone pillars/torches for Temple).
    - Builds procedural faceless driver + kart meshes with inverted-hull outlines, spinning wheels, steering wheel tilt, arm punch animation, turbo exhaust flames, shield bubble, and blob shadows.
    - Renders either single full-screen camera (`1p` / `lan`) or dual split-screen viewports (`2p` via `renderer.setViewport` / `renderer.setScissor`) with smooth anti-nausea damped spring cameras.

- [ ] **Step 1: Implement `js/audio.js` and `js/renderer.js`**

Follow `web-game-perf` rules: reuse shared geometries and toon materials, set `renderer.shadowMap.autoUpdate = false` (update once when track builds), use blob shadows on karts, and keep driver heads strictly faceless (`headgear`: Fox Ears, Jet Helmet, Tiki Feather Crown, Volt Visor).

- [ ] **Step 2: Verify module syntax and exports**

Run: `node --check js/audio.js && node --check js/renderer.js`
Expected: Exit code 0 with no syntax errors.

---

### Task 5: UI Shell, Calibration Overlay, Split-Screen / LAN HUD & Main Loop (`index.html`, `style.css`, `js/main.js`, `README.md`)

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `favicon.svg`
- Create: `js/main.js`
- Create: `README.md`

**Interfaces:**
- Consumes: `MotionController`, `makeSyntheticPose` (`js/motion.js`), `RaceSimulation`, `TRACKS`, `DRIVERS` (`js/sim.js`), `LanClient` (`js/net.js`), `RaceRenderer` (`js/renderer.js`), `SoundFX` (`js/audio.js`)
- Produces:
  - Complete playable game with Main Menu (1P Race, 2P Same-Device Split-Screen, Wi-Fi/LAN Multiplayer), Track & Driver selector, Controls & Webcam guide, 3-second Webcam Calibration modal (with Skip / Keyboard Mode option), Live PiP Webcam Skeleton & Steering Wheel Indicator, P1/P2 Split-Screen HUDs, LAN Room Lobby (Create Room, active LAN rooms list for one-tap join, 4-letter room code input, LAN IP banner), Post-Race Podium & Activity Summary, and `window.__game` + `?debug` overlay.

- [ ] **Step 1: Create `favicon.svg`, `index.html`, `style.css`, `js/main.js`, and `README.md`**

Ensure CSS uses zero `backdrop-filter`, hidden modals use `visibility: hidden`, menus cap at 30 FPS, and `window.__game` exposes `{ getMetrics, getState, startMode, injectPose, setAutoGas, calibrateNow }`.

- [ ] **Step 2: Run all unit and integration tests**

Run: `npm test`
Expected: PASS (all motion, simulation, and LAN server tests pass)

- [ ] **Step 3: Verify in real browser via Chrome DevTools / Playwright at 360px mobile and desktop widths**

Start `node server.mjs`, open `http://127.0.0.1:3000/?debug`, inspect console for zero errors, verify 1P, 2P Split-Screen, and LAN Lobby UI at both desktop (`1280x800`) and mobile (`360x640`) widths, drive karts via synthetic pose injection (`window.__game.injectPose(...)`), check FPS (`>= 50`) and pixel cap (`<= 2.2M`), and stop the server when done.

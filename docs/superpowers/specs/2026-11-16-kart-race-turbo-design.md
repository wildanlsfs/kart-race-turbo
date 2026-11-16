# Kart Race Turbo — Design Specification

**Date:** 2026-11-16  
**Project Folder:** `/Users/user/Documents/Development/projects/yolo-dev/kart-race-turbo`

---

## 1. Intent & Why

Build **Kart Race Turbo**, a clean, smooth 3D minimalist multiplayer kart racing game inspired by *Crash Team Racing* (*Crash Bandicoot* series), controlled via **webcam body motions** (plus keyboard/gamepad/touch fallback). Players can play **Single Player** (vs. AI bots), **Same-Device 2-Player Split-Screen** (sharing one webcam or keyboard/gamepads), or **Wi-Fi / LAN Multiplayer** across devices on the same local network.

The goal is an energetic, physical party/arcade game that runs smoothly at 60 FPS in modern browsers without motion sickness, lag, or tiring players out.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **3 Game Modes:**
  1. **Single Player:** 1 human player + 3 AI karts on a 3-lap circuit race.
  2. **2-Player Same Device (Split-Screen):** 2 human players + 2 AI karts on horizontal/vertical split-screen. Supports 2-player simultaneous webcam tracking (left half of camera frame = Player 1, right half = Player 2) as well as P1/P2 keyboard & gamepad controls.
  3. **Wi-Fi / LAN Multiplayer (Same Network):** Up to 4 players across laptops/phones/tablets on the same Wi-Fi/LAN via a lightweight Node.js static + WebSocket server (`npm run server` binding to `0.0.0.0:3000` with 4-letter room code and LAN URL / QR display, remaining open slots filled by AI bots if desired).
- **Crash-Inspired Kart Mechanics:**
  - Responsive arcade kart physics: forward acceleration, braking/reversing, proportional left/right steering, hopping/drifting around corners, turbo boost pads on the track, and a rechargeable Turbo gauge.
  - Smashable wooden `?` Item Crates & Wumpa-style energy fruits scattered along the track.
  - 4 iconic Crash-style weapons/items triggered by punching forward:
    1. **Homing Rocket (Missile):** Locks onto and chases the kart ahead.
    2. **Bowling Bomb:** Rolls forward in a straight line and explodes on impact.
    3. **TNT / Hazard Crate:** Dropped behind the kart to spin out tailgaters.
    4. **Bubble Shield:** Temporary protection against 1 incoming hit (can also be launched forward as a shockwave on punch).
- **Ergonomic Webcam Motion Controls:**
  - **Forward (Gas):** Smart Auto-Drive by default once the race countdown ends (with a toggleable "Manual Wheel-Stance Gas" option in settings/HUD where holding hands up in driving posture accelerates).
  - **Turn Left / Right:** Tilt an "invisible steering wheel" (relative height of left vs. right wrist) combined with upper-body shoulder lean relative to hips. Proportional steering sensitivity normalized by shoulder width.
  - **Brake / Reverse:** Pull both hands inward/close to chest or crouch (shoulders drop relative to calibrated neutral). Holding brake once stopped reverses the kart.
  - **Turbo Boost:** Raise both hands above shoulders/nose (or jump/hop) when the Turbo gauge has >= 30% charge.
  - **Attack / Use Item:** Punch forward with either left or right hand (rapid wrist velocity/extension toward camera or away from shoulder).
- **Clean Minimalist 3D Visuals & Audio:**
  - Procedural 3D toon-shaded karts, faceless drivers (no eyes, mouths, or face lines), crisp inverted-hull outlines, vibrant canyon/jungle/island track aesthetics (Crash Bandicoot inspired colors: warm sandstone, emerald grass, striped red-white curbs, wooden crates, green boost pads, checkered arches).
  - Synthesized WebAudio sound effects (engine hum, drift skid, crate smash, turbo whoosh, missile launch, explosion, countdown beeps, lap fanfare) with **no background music**.

### Non-Goals
- No external 3D `.glb`/`.gltf` model asset pipeline or heavy build step required for the client; all 3D meshes and textures are procedurally generated in code (like `body-runner` and `jagoan-kotak`).
- No internet-wide matchmaking server or user accounts/databases.
- No VR headset support.

### Anti-Goals (What Would Make This a Failure)
- **Motion sickness or erratic camera:** Never require the player to turn their head away from the screen to steer, and never whip the camera violently. Camera follows smoothly behind the kart with damped spring yaw and optional Comfort Mode (`🌀` anti-nausea toggle).
- **Webcam lag starving frame rate:** Rendering at uncapped Retina resolution or running MediaPipe on the main UI thread causing sub-30 FPS stutter.
- **Exhausting controls:** Requiring players to jog in place continuously just to keep a kart moving forward.
- **Faces on characters or background music:** Strictly prohibited by user preferences.

---

## 3. Technical & Performance Constraints (`web-game-perf`)

1. **Architecture *(Builder's Call)*:**
   - Zero-build static ES modules (`index.html`, `style.css`, `js/*.js`) using Three.js `0.160.0` via CDN `importmap` so the client runs directly from any static server (`python3 -m http.server`) or GitHub Pages for Single Player & Split-Screen.
   - Included `package.json` + lightweight Node.js (`server.mjs` using `ws` or built-in Node HTTP + WebSocket frame handler with zero or minimal dependencies) so `npm run server` (or `node server.mjs`) serves the game on `0.0.0.0:3000` with LAN IP printout and hosts authoritative/room-synced Wi-Fi/LAN multiplayer rooms.
2. **Performance Rules:**
   - Cap WebGL drawing buffer to **<= 2.2 million pixels** and adaptively scale `devicePixelRatio` if FPS drops below 50.
   - Cap menu/lobby screens at 30 FPS.
   - Static environment shadow map (`renderer.shadowMap.autoUpdate = false`, updated once per track load) + lightweight blob shadows under karts and projectiles.
   - Reuse geometries and materials across all crates, projectiles, particles, and track props (no per-frame geometry allocation without disposal).
   - Never use `backdrop-filter: blur()` over the WebGL canvas; keep hidden modals `visibility: hidden`.
   - Expose performance metrics (`fps`, `poseMs`, `pixelCount`, synthetic landmark injection, and game state) on `window.__game` and a `?debug` overlay.
3. **MediaPipe Pose Landmarker in Web Worker:**
   - Run MediaPipe Pose Landmarker (`0.10.14` lite model, `numPoses: 2` so 1P and 2P split-screen both work from a single camera) inside a classic Web Worker (`js/pose-worker.js`) loaded from `unpkg`.
   - Use `requestVideoFrameCallback` (with timer fallback) to send a downscaled `ImageBitmap` (~480 px wide) once per camera frame.
   - Smooth landmarks with a **One-Euro Filter** (`js/motion.js`).
   - Normalize all motion thresholds by each player's calibrated **shoulder width** during a 3-second calibration step before racing.
   - Track player lock by horizontal torso position so passersby don't hijack P1, and in 2-Player webcam mode assign left-side person to P1 and right-side person to P2 with ~400 ms dropout persistence.

---

## 4. User-Decided vs. Builder's Calls

### Decided by User
- **Genre & Inspiration:** 3D minimalist multiplayer racing game inspired by Crash Bandicoot (specifically driving vehicles/karts).
- **Game Modes:** Single Player, Same-Device Multiplayer, and Wireless Wi-Fi/LAN Multiplayer on the same network.
- **Core Actions & Motion Mapping:** Move Forward (Smart Auto-Drive default + optional manual stance), Backward/Brake (pull hands to chest / crouch), Turn Left / Right (invisible steering wheel tilt + body lean), Turbo (both hands up / hop), Attack (punch forward).
- **Project Name:** `kart-race-turbo`.

### Builder's Calls (Sensible Defaults)
- **Track Selection *(Builder's Call)*:** 3 distinct Crash-themed minimalist circuits selectable in Single Player, Split-Screen, and LAN Lobby:
  1. *N. Sanity Island* (sunny tropical beach, palm trees, wooden bridges, gentle curves)
  2. *Canyon Dash* (desert sandstone mesa, sharp hairpins, turbo jump ramps)
  3. *Temple Ruins* (ancient stone temple, wide split paths, extra item crates & boost pads)
- **Kart Roster *(Builder's Call)*:** 4 selectable faceless drivers & kart color/stat styles (Balanced, Speed, Turn, Accel) with distinct procedural helmets/ears/hats (e.g., Bandicoot Ears, Cortex Visor, Tiki Mask, Nitro Helmet—all strictly faceless).
- **LAN Protocol *(Builder's Call)*:** Host creates a 4-letter room code on the LAN server; any device opening `http://<LAN-IP>:3000` sees active LAN rooms on the same Wi-Fi (one-tap join or enter 4-letter code). Each player can use their own device's webcam, keyboard, or touch controls during the LAN race.
- **Verification & Debug Hooks *(Builder's Call)*:** Built-in `window.__game` test API (`injectPose`, `startMode`, `getState`, `getMetrics`) for automated headless verification alongside real webcam play.

---

## 5. What Is Left to the Builder

- Exact spline waypoints and track width/curb geometry for the 3 tracks.
- Exact tuning constants for kart acceleration, grip, drift boost charge rate, and AI rubber-banding so races feel fair and exciting.
- UI layout details for the HUD (speedometer, lap counter, 1st–4th position badge, item roulette slot, turbo bar, mini-map, and PiP webcam skeleton guide with live action indicators).

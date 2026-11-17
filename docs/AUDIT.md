# Kart Race Turbo audit (2026-11-16)

Method: headless Chrome (Playwright) plus node simulation bots. Real webcam NOT tested (no camera/person available); only the pose pipeline start-up (fake camera device) and the motion mapping with synthetic poses were exercised.

Ranked findings. FIXED = changed in this pass.

## A. Play-breaking or frustrating
1. FIXED AI was random and unfair (sim.js). Same-track AI-only races finished anywhere from 50 s to 85 s; AI spent up to 39 s off-road (canyon) and Nitro/Aku spun out 4-10 times per race. Cause: AI steered with a different, weaker model than players, no corner braking, random item use at 8 % per frame (fired instantly, in any direction). Now: shared barrier, speed-scaled look-ahead, lift before bends, rubber-banding versus the leading human, item logic (fire rockets/bombs only with a target ahead, TNT only with a kart behind). AI pack now finishes within about 10 % of each other, off-road under 8 %.
2. FIXED Turbo was close to infinite and decisive (sim.js). Holding turbo gave 49 s vs 68 s for not using it. Cost 35 + drain, pickups gave +10..18. Now costs 40 %, needs 40 %, no hidden drain, smaller pickup bonuses; a perfect turbo user wins by about 5-10 % rather than 25-30 %.
3. FIXED Rocket homed onto karts behind it and chained spin-outs (sim.js). Now chases only karts ahead, slower turn rate; a hit gives 2.6 s invulnerability (blink) and a hit on an already-spinning kart is ignored.
4. FIXED Brake/"reverse" pose slammed a 29 u/s kart straight into reverse (sim.js). Reverse now only engages once nearly stopped.
5. FIXED Webcam steering saturated at about half a lean and faded away while holding a lean through a long corner (motion.js: neutral point drifted during steering). Neutral now adapts only while not steering and slowly; gains rebalanced so a 0.4 lean gives roughly 0.2 steer and 0.8 lean about 0.75 (synthetic poses; not verified on a real person).
6. FIXED Edge handling: soft barrier clamps how far the nose may point away from the road as the kart nears the kerb, wall contact scrubs speed once per touch and plays a thud, hands-off driving no longer parks on the wall.
7. FIXED Start grid put AI karts directly behind the human, i.e. in the chase camera (menu, 1P and 2P). Humans now start on the back row.
8. FIXED Race ended the instant the human crossed the line (no finish moment). Race stays live 3 s with a FINISH! banner, standings highlight "you", title reflects the result.
9. FIXED LAN: karts rendered at 30 Hz snapshots (judder), no countdown shown, finish stats showed kart 0, two racers could pick the same driver. Added snapshot interpolation, countdown banner, own-kart stats, driver de-duplication (main.js, server.mjs).

## B. HUD and layout
10. FIXED Camera PiP drawn as a big dark empty box when the camera is off; now only exists while a camera is active, smaller, and moves to the top in 2P/touch so it never covers the road or the touch buttons (index.html, style.css, main.js).
11. FIXED Touch buttons showed on desktop; now only on touch devices, and not in 2P.
12. FIXED Phone landscape (844x390): HUD compacted to two rows, utility buttons collapse to icons, minimap moved to the corner and shrunk, menu becomes a two-column layout that fits.
13. FIXED 2P: P2 HUD collided with utility buttons; the buttons moved to the bottom centre and P2's HUD is anchored to its own half.
14. FIXED Menu panel cut off at 1280x720 (compact pickers, shorter text); the menu showcase kart was hidden behind the panel and surrounded by other karts (camera offset flipped, no AI in the showcase).
15. FIXED Pose pill ("AUTO-GAS") shown to keyboard players; hidden when no camera.

## C. Feedback and visuals
16. FIXED No feedback for item pickup / lap / final lap / hit / shield block / finish: added banners, particle puffs (no screen shake) on crate smash, explosion, shield block, wall thud sound, invulnerability blink, modest FOV widening with speed (smaller in Comfort mode).
17. FIXED Boost pads were flat green slabs; now animated chevrons.
18. FIXED Canyon ground showed flower decals on red rock; now cracks and pebbles.
19. FIXED Comfort setting is now remembered and defaults on when the OS asks for reduced motion.

## D. Content
20. FIXED Names derived from another franchise replaced everywhere (code, UI, README, specs): Palm Cove; Rufus Dash, Jet Mint, Maka Tiki, Neo Volt; fruit is now "Mango". Driver ids renamed (rufus, jet, maka, volt).

## Still weak / not verified
- Real webcam: punch detection relies on wrist depth (z) and a very fast 2D jab; depth from a single webcam is noisy, so punches may be missed or false-trigger. Needs a real person to tune. Hop/crouch thresholds likewise.
- Steering is road-assisted for humans (the input picks an angle off the road direction). It is forgiving, but means skill is mostly racing line, items and turbo timing. AI uses true steering.
- Rubber-banding is mild but present; hard-core players may notice the AI never falls far back.
- Track props and scenery remain simple; tracks have no elevation. The kart-to-kart collision is a gentle push only.
- The pose model loads from local vendor files with root-absolute paths ("/js/vendor/..."); it will not load if the game is hosted under a sub-path.
- Software GL in headless runs is much slower than a real GPU, so FPS numbers are an indication only.

---

# Second pass (2026-11-16, after the owner played the live build)

Method: Node sim bots (seeded, many races, `scratchpad` scripts mirrored by `tests/gameplay.test.mjs`) plus headless Chrome (Playwright, real clicks and real touch events via CDP at 1280x720 and 844x390). Real webcam NOT tested (no camera or person available). Software GL, so FPS is only an indication (60 fps reported at both sizes).

## E. Character pick ("you forgot to check the character pick")
1. FIXED **The chosen driver did not show up on the kart.** `js/renderer.js` cached kart meshes by kart id (`p1`, `ai_1` ...) and only cleared the cache on a track change. Pick Jet after Rufus on the same track and the menu showcase and your race kart kept the old Rufus model (and the AI karts kept their old looks, so two karts could look alike). Meshes are now tied to the driver id and are dropped when the driver changes or the kart disappears (`render()`, "drop meshes whose driver changed"). Evidence: `__game.getState().meshDrivers` now equals the snapshot driver ids in 1P and 2P (volt -> p1:volt, ai: rufus/jet/maka; 2P maka -> p2:rufus); before screenshot `docs/screens/before_driver1_1280.png` shows Jet selected but the orange fox kart.
2. FIXED **The four drivers drove almost identically, and one was strictly best.** Same road-following bot, 3 laps: Jet 57.0 s, Rufus 58.6 s, Volt 59.3 s, Maka 60.3 s on Palm Cove (Jet fastest on every track, Maka slowest everywhere): top speed was the only stat that mattered. The "Handling" stat only changed how fast a human kart aligned itself to the road (invisible) and "Acceleration" only mattered for the first second. Now (`js/sim.js`, `js/tracks.js`): acceleration tapers near top speed, so high Accel recovers quicker after hits and bends; cornering drag scrubs speed in proportion to how hard the kart is turned (`CORNER_DRAG`, divided by the Handling stat squared), so high Handling keeps speed in bends. Stats: Rufus 29 / 26 / 4.0, Jet 30.5 / 20 / 3.7, Maka 28.8 / 26 / 4.7, Volt 28.5 / 36 / 4.0 (top, accel, handling). Result (3 laps, no turbo): Palm Cove Rufus 62.4, Jet 62.5, Maka 62.0, Volt 61.8; Canyon Rufus 68.9, Jet 69.4, Maka 68.4, Volt 68.6; Temple Rufus 70.3, Jet 70.4, Maka 70.2, Volt 69.8. So nobody dominates (spread under 2 %), but each is measurably different: Jet top speed +1.5 u/s, Volt reaches 20 u/s about 0.3 s sooner, Maka wins the twisty canyon over Jet. The effect is subtle by design; a player will mostly notice Jet's slow start and Volt's quick one.
3. FIXED Menu showed role text only at 844x390 and not at all at 1280x720 (small text hidden by the compact CSS). Now a detail line under the cards shows name, role, three stat bars (normalised over the roster, from the same numbers the sim uses) and which racer Player 2 will drive; the selected card gets a coloured ring and a check mark (`index.html` `#driver-detail`, `main.js` `renderDriverDetail`, `style.css`).
4. FIXED At 844x390 the showcase kart was hidden behind the menu panel, so you could not see who you picked. Panel narrower and showcase camera framed further right for narrow screens (`renderer.js` `_updateCameraForKart`). Screens: `docs/screens/after_driver*_844.png`, `after_driver*_1280.png`.
5. FIXED LAN lobby listed drivers as raw ids ("RUFUS"); now names.
6. VERIFIED by page flow (`docs/screens/flow_*`): tap/click pick -> 1P with Volt gives p1:volt; back to menu keeps the pick and the card ring; 2P with Maka gives P2 Rufus (always a different driver); race again keeps the driver; no console errors. LAN driver de-dup is covered by the existing LAN test; LAN UI itself was not played with two real devices.

## F. Cars "stuck in the middle of the road"
Reproduction work first. Instrumented every kart in the Node sim (kart below 4 u/s for over 1 s, or under 0.4 % of a lap of progress in 3 s, while the race is live): AI-only, one human bot, two human bots, hands-off human, random-steering human, human that brakes to a halt mid-track, dt of 1/120, 1/60, 1/30 and 1/20, 5-lap races, seeds varied, all 3 tracks.
- **No permanent deadlock exists** in the current sim: 0 karts that never recovered in roughly 700 races, no kart pinned on a barrier or on another kart, no item blocks the road (TNT is not solid and expires after 18 s; crates are not solid and respawn after 6 s), no ramp/pad trap. Candidates ruled out by measurement, not assumption.
- **What the owner saw is the hit stop.** Cause: `_applyHit` (sim.js) set speed to 25 % and the spin-out decayed speed by 4/s while spinning 11 rad/s for 1.15 s, so a hit kart sat nearly motionless and spinning in the lane for about 1.7 s, then accelerated from zero, and it came out of the spin facing a random direction. AI karts are hit about 6 times per race (rockets and TNT drops, 3.7 on Palm Cove, about 6 on the other two), so in a 70 s race there were 4 to 6 visible "parked cars" (instrumented count over 120 AI-only races: Palm Cove 516, Canyon 655, Temple 680 events, i.e. 4.3 / 5.5 / 5.7 per race; with a human bot over 100 races: 671 / 855 / 727).
- Fix (`sim.js`): a hit keeps 55 % of the speed and keeps rolling (drag 1.4/s), the spin is two full turns over 0.9 s that end exactly on the old heading, invulnerability 2.4 s. After, same detector: 0 events in 60 AI-only races per track (dt 1/60), 0 in 40 mixed races per track with a random-steering human (dt 1/30), 0 in 20 two-human races per track, and 0 safety-net resets; time to be back above 15 u/s and aligned: median 1.4 s, never above 2 s.
- Second real cause: **a human who stops (walks away from the webcam, pauses, AFK) held the race open forever**, with a kart parked in the road, and finished karts kept racing as solid obstacles. Fix: the race closes 60 s after the first kart finishes (banners at 30 s and 10 s, unfinished players are listed as "did not finish"), and finished karts are ghosts: no collisions, hits, crates (`sim.js` `closeTimer`, ghost checks).
- **Safety net** (`sim.js` `_stuckWatch` / `_resetKart`): a kart that wants to go (all AI, and a human holding throttle without braking or reversing) and has made under about 4 m of forward progress in 3 s is put back on the nearest road point (clamped inside the lane), facing forward, speed 10, 1.5 s blink, event `reset` (HUD banner "Back on the road" for the player). Humans who deliberately brake or reverse are never reset. It does not fire in any normal race (the test asserts `resets == 0` over 36 AI races), so it does not hide the root cause; it only guards unknown future deadlocks. Unit-tested by pinning a kart in place.
- Rocket/bomb/TNT effectiveness after the change (30 AI races x 3 tracks): rocket 114 hits of 133 fired, TNT 338 of 377, bomb 51 of 176 (was 38 of 186), shield blocked 25 of 195.

## G. Other gameplay problems
1. FIXED Bowling bomb flew in a straight line for 4.5 s regardless of the road, so it left the track at every bend and mostly missed (20 % hits). Now it rolls along the road in its own lane (turn limit 4.5 rad/s), lives 6 s (`sim.js`, projectile update). Test: stays on the canyon road through a hairpin.
2. FIXED Race could never end if a human stopped (see F). Also two humans: the race ends when both finish or 60 s after the first finisher.
3. FIXED Menu button in a race threw the race away on a stray tap; there was no pause at all. Esc / P and the Menu button now open Pause (Resume / Restart / Main Menu), sim and sound frozen, held keys and touches cleared, auto-pause when the window loses focus (local races only; LAN cannot pause) (`main.js`, `index.html`).
4. FIXED Item hint said "Punch!" even for keyboard and touch players; now "press F", "tap PUNCH" or "punch / F" depending on device, "Enter / punch" for P2.
5. FIXED No "GO!" on race start (only a beep); banner added.
6. FIXED README claimed gamepad support that does not exist, and did not list Esc/P, touch buttons or the racers; corrected.
7. VERIFIED real touch (CDP touch events, 844x390, `docs/screens/touch_844_race.png`): holding Right gives steer +1, Left -1, TURBO activates turbo, brake slows the kart (36.6 to 7.4 u/s), releasing returns steer to 0, no console errors. Keyboard: Esc/P pause and resume, D steers, Space turbos, Comfort toggles and defaults ON under reduced-motion.
8. VERIFIED lap counting: no two far-apart sections of any track come closer than 50 m (no wrong-section snapping), checkpoints must be visited in order so cutting or reversing cannot add a lap (existing test), banners LAP 2/3, FINAL LAP!, FINISH! seen in a full real race on Canyon; finish modal shows ranks and "did not finish" where relevant; "Race again" keeps the driver.

## H. Still weak / not verified after this pass
- Real webcam NOT tested; all pose steering numbers come from synthetic poses.
- Kart-to-kart contact is still a gentle positional push without momentum exchange (no slow-down on rear-ending); it no longer traps anything but still feels soft.
- Driver differences are deliberately small (lap-time spread under 2 %); they are real but subtle, and measured with a bot, not with players.
- Camera clipping into scenery was not reproduced and not examined beyond reading the code (scenery starts about 13 u from the road centre, camera trails 8.4 u behind).
- 2P fairness: both humans start on the same back row in mirrored lanes with the same rules; P1/P2 get different drivers by design (P2 = first roster entry that is not P1's), so P1 picking Jet makes P2 drive Rufus.
- The window-blur auto-pause was not exercised with a real focus change.
- LAN was only exercised by the existing automated server test, not with two real devices.

---

# Third pass (2026-11-17, "kok susah belok ya?" on a tablet)

Method: headless Chrome (Playwright, `channel: chrome`, touch context, deviceScaleFactor 2) with real CDP touch events (multi-touch), at 1024x768, 1180x820, 768x1024 and 844x390. A bot drives full laps through the real DOM using only touch (or keyboard) events, with a 150 ms reaction delay, a few px of thumb wobble and a brief lift about every 3 s. "Before" = commit e63ae4a served from a git worktree on another port. Real tablet and real hands NOT tested: synthetic touch is evidence for the logic only. The bot scripts live in the session scratchpad, not in the repo; the pure steering logic is unit-tested in `tests/touchsteer.test.mjs`.

## I. Why turning felt hard
Checked one by one:
1. **FALSE (in Chromium): "finger drifting off the button ends the turn".** `pointerleave` never fired: touch pointers are captured implicitly to the element they started on. Measured on the old build: finger moved 90 px off the left button, steer stayed -1. Pointer capture is now explicit anyway (needed for the pad, harmless for buttons), but this was not the cause. Not verifiable on iOS Safari.
2. **TRUE (main cause): the input was only full left, nothing, or full right, but the sim turns a human kart as "lane position".** In `sim.js` a human kart's steer value picks the angle of the nose relative to the road (max 0.62 rad) and a pull towards the road centre fights it, so steer v holds the kart at roughly `v * 2 * halfRoad` from the centre. Measured on Palm Cove straight at 29 u/s (road half-width 6.75): steer 0.15 holds 1.9 u off-centre, 0.3 holds 4.1 u, 0.5 holds 6.5 u (the kerb). Full lock reaches the kerb in about 1.5 s; a 0.15 s tap swings the kart 2.3 u and it comes back through -0.5 u. So with three buttons the kart can only be in the middle or on the kerb; any lane change is a timing game, and a held button in a corner rides the kerb and scrubs speed. A proportional input removes that.
3. **TRUE: touch targets were small and far apart.** Left/brake/right were 64x58 px each (3 % of a 1024 px screen), turbo/punch 116x58, all in the bottom corners, with no sign they had registered.
4. **FALSE: multi-touch conflicts.** Steer + TURBO + BRAKE with three fingers all registered (old and new build). Context menu did not fire in headless emulation after a 900 ms hold on the old build (page already had `user-select: none`); a real device may differ, so the gesture blocking below is a precaution, not a proven fix.
5. **Not a cause: sim steering response.** Keyboard (same digital input) has the same behaviour as old touch in every bot number below, and no bot ever left the road or touched a wall (0 off-road, 0 wall events in all runs), because the soft barrier and road assist protect it. The cost of digital steering shows up as lap time and kerb riding, not crashes.
6. **Webcam on tablet: works, one layout bug found and fixed.** With synthetic poses at 1024x768 and 768x1024: lean 0.4 gives steer 0.23, 0.8 gives 0.74, symmetric; a touch on the pad overrides the camera and lifting it hands steering back. The camera tile sat on top of the minimap and clipped its Calibrate button on touch devices; the tile is wider and the minimap moved under it. No real camera or person was available.
7. **Portrait:** the old and new layouts both work (screenshots below). A one-time banner now suggests landscape in portrait.

## J. Fix (js/touchsteer.js, js/main.js, index.html, style.css)
- **Steering pad** bottom-left (40 % of the width, 28 % of the height, clamped): the finger's horizontal position is the steer amount (dead zone around the middle, full lock at 80 % of the half-width), smoothed in `SteerPad`/`stepSteer` (ramp about 0.1 s, release to centre about 0.17 s, 0.35 minimum "tap kick" so a quick tap turns at once). Pointer capture, so sliding off the pad (even off the screen) keeps steering; a second finger on the pad is ignored. Pad lights up yellow with a thumb marker while touched; LEFT / RIGHT labels.
- **Big BRAKE / TURBO / PUNCH buttons** (about 115-140 x 130 px at 1024x768), pointer captured, pressed state. Brake is no longer in the steering cluster.
- Context menu, text selection, drag, pinch/gesture events blocked on touch devices; `touch-action: none`, `-webkit-touch-callout: none` on the controls.
- Pause, blur and menu clear all touch state. Keyboard and webcam code paths unchanged; touch wins over the camera while a finger is on the pad.
- Tilt steering NOT added (needs an iOS permission flow and a real device to tune; skipped as risk).

## K. Evidence (bot, 1024x768 touch context, 3 tracks x 2 seeds, one lap each, software GL so fps 40-60)
`follow` = hold the line the road bends along; `weave` = change lane between +4 u and -4 u every 5 s (what a human does to dodge TNT and crates). rms = RMS distance from the wanted lane in units, kerb% = share of the lap within 0.8 u of the kerb.

| task | input | lap time (s) | rms lane error | kerb % | off-road s | wall hits |
|---|---|---|---|---|---|---|
| follow | old buttons | 27.63 | 5.86 | 13.7 | 0 | 0 |
| follow | keyboard | 27.28 | 5.76 | 12.2 | 0 | 0 |
| follow | new pad | 25.09 | 5.07 | 0.2 | 0 | 0 |
| weave | old buttons | 33.98 | 3.85 | 13.8 | 0 | 0 |
| weave | keyboard | 35.87 | 2.96 | 5.1 | 0 | 0 |
| weave | new pad | 27.18 | 3.19 | 4.4 | 0 | 0 |

So: lap time -9 % (follow) and -20 % (weave) against the old buttons, kerb riding from 13.7 % to 0.2 % (follow). Lane accuracy in weave is about the same as a keyboard and better than the old buttons. The bot is a model of a thumb, not a person; the pad numbers assume the player places the finger sensibly. A node-only check shows the same trend (`tests/touchsteer.test.mjs` drives a canyon lap with the pad model).

Other viewports (Canyon, 1 seed, old buttons vs new pad): 1180x820 follow 29.0 s / kerb 16 % vs 25.1 s / 0 %, weave 34.0 s vs 28.1 s; 768x1024 portrait follow 27.0 s / 17.2 % vs 25.3 s / 0 %, weave 34.5 s vs 28.1 s. All 0 off-road, 0 wall hits.

## L. Still weak / not verified
- No real tablet, no real thumbs; whether the pad position mapping feels natural (finger at centre = straight, a thumb that lands at the pad edge = full lock at once) needs a hand test. The dead zone and the 80 % full-lock point are guesses.
- Long-press context menu, iOS Safari pointer-capture behaviour and double-tap zoom could not be tested.
- Webcam lean steering still only verified with synthetic poses.
- Pad covers the lower-left of the road view (translucent); at 1024x768 it can overlap the left wheel of the kart when the kart is far left.

---

# Performance pass (2026-11-17, "gets laggier the longer I play" on a tablet)

Method: headless Chrome (Playwright, software GL), `?debug` hooks (`window.__r`, `__game.getMetrics()` now includes three's `geometries`, `textures`, `calls`, `triangles`), CDP CPU throttle, deterministic frames (snapshot positions and `performance.now` frozen, same camera before and after). A real tablet GPU and real thermal throttling were NOT measured: draw calls, memory counts and main-thread render time are the evidence, not a tablet FPS claim.

## G. Cause 1 (verified): GPU memory leak in `js/renderer.js`
`buildTrack()` cleared groups without `dispose()`; every track build (including every track-card click in the menu preview) left geometry, about 5 canvas textures and unique materials on the GPU; and `render()` destroyed and rebuilt all race kart meshes (about 119 geometries each) every time the screen left "racing" (finish modal, menu).
- FIXED: `disposeTree()` frees everything not flagged `userData.shared` (cached toon/ink materials, shared geometries, burst/crate/blob resources are flagged and never disposed). Kart meshes now persist (hidden, not destroyed, when the menu has only the showcase kart; rebuilt and disposed only if the driver for that kart id changes); kart geometry is cached per driver. `getState().meshDrivers` lists visible karts only.
- 24 cycles of (menu track-card click, start race, pause, restart = race again, back to menu), 1280x720, `npm`-free probe, JS heap after forced GC:

| after cycle | before: geometries / textures / heap | after: geometries / textures / heap |
|---|---|---|
| start | 151 / 8 / 6.0 MB | 45 / 8 / 4.3 MB |
| 4 | 1127 / 24 / 9.1 MB | 73 / 8 / 6.2 MB |
| 12 | 3132 / 56 / 13.2 MB | 75 / 8 / 6.5 MB |
| 24 | 6106 / 104 / 18.5 MB | 75 / 8 / 6.6 MB |

Geometries and textures are flat after the fix; before they grew by about 250 geometries and 4 textures per cycle (JS heap only shows the CPU side; the GPU side was about 55 MB after 36 track switches in the earlier measurement). Shader programs went from 13 to 19 (instancing and vertex-colour variants, compiled once).

## H. Cause 2 (verified logic, device behaviour inferred): adaptive resolution
Old rule: FPS estimated as the average of 1/dt with dt clamped to 0.05 (skews high), step down 0.08 every 0.5 s below 46, step up only above 57. A tablet sitting at 50-56 fps could never recover resolution (blurry and low for the rest of the session) and the 0.5 s step rate dropped the scale to the floor within about 3 s.
- FIXED: `js/perf.js` `AdaptiveScale`: fps = 1000 / mean frame time over a 45-frame window (each frame clamped to 100 ms; a median was tried first and hid stutter), step down below 46 fps, step up from 52 fps, 3 s cooldown between changes, 1.5 s warm-up after a race starts or resumes, and anti-hunt memory (a step down within 8 s of a step up makes the scale we just left a ceiling for 30 s, doubling up to 5 min each repeat). Fed only while racing and not paused. The displayed FPS is now frames per second over 0.5 s (no 1/dt averaging).
- 10 Node tests in `tests/perf.test.mjs`: steady 60 fps never changes the scale; cooldown and floor respected; 54 fps recovers from 0.73 to 1.0; no change inside the 46-52 hysteresis band; resolution-bound load settles then recovers; a CPU-bound load that resolution cannot fix does not oscillate; stutter counts as slow; single hitches do not move it.
- Throttled browser runs (CDP `Emulation.setCPUThrottlingRate`, 20 s free, 50 s throttled, 40 s free; scale sampled every second):
  - OLD code, 4x: fps 60 to 26-29, scale 1 -> 0.84 -> 0.68 -> 0.65 within 3 s (t=21..23), floor for the whole throttle, then on release 0.65 -> 0.73 -> 0.77 -> 0.85 -> 0.93 -> 1 over 6 s (with a 0.73 -> 0.73 re-evaluation flicker).
  - NEW code, 3x, 4x, 6x, 8x: stays at 60 fps and scale 1 (the draw-call cut below means 4x CPU throttle no longer pushes the frame time over budget); only a single 1 -> 0.92 -> 1 blip at a race restart at 4x.
  - NEW code, 12x: scale 1 -> 0.92 (t=21) -> 0.84 -> 0.76 -> 0.68 -> 0.65 (t=34), one step per 3 s, pinned at 0.65 for the remaining 40 s with no hunting; on release 0.65 -> 0.69 -> 0.73 -> 0.77 -> 0.81 -> 0.85 (one step per 3 s, t=74..86); a 0.85 -> 0.77 -> 0.69 -> 0.73 -> 0.77 dip at t=89..100 coincided with the race ending and Race Again restarting (one hitch frame burst, fps 24) and recovered by itself.
  - Caveat: the CDP throttle slows the page's main thread, not the (software) GPU, so resolution cannot help there; this shows the controller dynamics (rate, floor, no hunting, recovery), not that a lower scale restores FPS on a GPU-bound tablet.

## I. Cause 3 (inferred, now much reduced): draw calls and main-thread render cost
Measured draw calls per frame (`renderer.info.render.calls`, counted by category with a frustum test that matched `info.render.calls` exactly), 1280x720, same camera before/after:

| case | calls before | calls after |
|---|---|---|
| island start grid | 427 | 66 |
| island mid-lap | 465 | 60 |
| canyon start grid | 361 | 63 |
| canyon mid-lap | 579 | 74 |
| temple start grid | 446 | 69 |
| temple mid-lap | 212 | 53 |

1024x768: 357 / 355 / 309 / 485 / 384 / 176 before, 59 / 49 / 57 / 63 / 64 / 43 after. Worst case 579 -> 74 (-87 %). By category (island start, before -> after): static scenery 146 -> 18 and its outlines 134 -> 9, karts 55 -> 14 and outlines 53 -> 12, crates 4 -> 1 (+1 outline), fruits 12 -> 2 (+2 outlines), sky/ground/road 3 -> 3, boost pads 2 -> 2 (+2 outlines; animated texture, left alone). Puff particles: up to 60 calls before, 1 now.
Main-thread `renderer.render()` time (80 calls on a static frame, 1024x768, desktop CPU): island 2.1 ms -> 0.5 ms, canyon 1.7 -> 0.4, temple 2.0 -> 0.4 (median). A tablet CPU is several times slower, so the saving there is larger in absolute terms (not measured).

What changed (`js/batch.js`, `js/renderer.js`):
- Static scenery (curbs, props, gate pillars and caps, ramps) is baked into chunked meshes (90-unit cells; hills and mountains in 160-unit cells) with vertex colours and one baked ink mesh per cell, so frustum culling still works per chunk. Cast/receive shadow flags are kept by splitting batches, so the static shadow map is built from the same casters as before.
- The ink outline is baked, not approximated: every vertex is pushed out along its normal by the original thickness in the part's own space, then transformed, which is exactly what the shader extrusion did (also under non-uniform scale); drawn with a plain back-face material.
- Karts are baked per rigid sub-assembly (chassis incl. rear wheels and steering wheel, steering front wheel, driver, arm, dizzy stars), cached per driver; articulation (lean, steer, arms, punch scale, flames, shield, blink) is unchanged. Wheel spin was dropped (tyres and rims are bodies of revolution; it only shimmered the 16-gon facets).
- Crates and fruits (body, leaf and their outlines) are InstancedMesh, matrices written each frame for active items only; the shadow-map casters are the same. Particle puffs are one InstancedMesh with per-instance colour.
- Tests (`tests/batch.test.mjs`) check bake equality of the ink shell, colour attribute, frame separation, chunking and shadow-flag splitting.

Visual check (deterministic frames, 3 tracks x start grid / mid-lap): `docs/screens/perf/before/*.png`, `docs/screens/perf/after/*.png`, amplified difference maps in `docs/screens/perf/diff/`. Only 0.25-0.87 % of pixels differ by more than 8/255, all on 1-pixel edges (anti-aliasing and wheel facets) plus the HUD rank text (the sim differs by a frame). `docs/screens/perf/kart_states_before_left_after_right.png` compares karts in turbo/punch/steer, spin-out with shield, and airborne states for several drivers.

Honest limits:
- Triangles per frame rose about 30-50 % (island start 35.6k -> 49.9k) because crates and fruits are drawn instanced without per-item culling and chunks are coarser than single props; this trades cheap vertex work for far fewer draw calls (what the CPU-bound tablet case needs).
- Pose inference on the webcam path is unchanged and still competes with rendering on a tablet.
- LAN mode, 2-player split-screen and the touch layout were exercised only through the same render path (no console errors in the probes); not played on two devices.

---

# Fourth pass: arcade flow, tracks, balance (2026-11-17, owner feedback: "three maps feel like one track", "Jet Mint always wins", "the game plays itself")

Method: Node simulation with a seeded rng (`mulberry32`, injected into `RaceSimulation`; the browser keeps `Math.random`), many seeded races with random start slots (`tests/harness.mjs`, `tools/balance.mjs`, `tools/tune.mjs`), plus headless Chrome (Playwright, `channel: chrome`, software GL) walking the real UI with clicks, keys, and real CDP touch events. Real webcam and a real tablet were NOT tested.

## M. The game played itself (sim fairness)
Measured before: a human kart with auto-gas and steer 0 finished 2nd-3rd of 4 (always 2nd on Canyon and Temple). Causes, all in `js/sim.js`:
1. FIXED **Road-assisted steering drove the kart.** A human's steer value set the nose angle relative to the road and a pull to the road centre fought it, so zero input = follow the road. Steering is now real turning for everybody (`turnRate x steer x speed factor`); no input keeps the heading. The only help left is the soft barrier in the last ~1.8 m before the kerb, and it now *costs* speed in proportion to how much it has to turn the kart (`BARRIER_SCRUB`), the wall scrubs speed continuously while touched (`-5 /s`, plus 40 % per contact), and beyond the kerb the top speed is 55 % (was 72 %).
2. FIXED **Rubber banding against the human.** `_updateAIPace` slowed AI karts that were ahead of the lead human (clamp 0.9..1.05). AI pace is now `difficulty.topScale x driver personality` plus at most +3 % for an AI more than 0.12 laps behind the leader (any kart). Nothing depends on where a human is (unit test).
3. FIXED **Start-slot bias.** `aiSkill = 0.97 + ((idx*7)%4)*0.01` and `aiTargetOffset = (idx-1.5)*1.4` made roster position decide pace and racing line. Replaced by a fixed per-driver personality (`ai: { skill, lane }` in `tracks.js`, skill 1.00 for all after tuning) and a slow per-kart lane wander from the rng.
4. FIXED **Mango snowball.** The first kart to a mango took it for everybody (8 s respawn), and each mango is +0.25 top speed (up to +2.5 = 8 %), so whoever led got faster and the rest never caught up: with 4 identical bots the front-row kart won 100 % of races. Mango is now per kart (each kart collects its own copy, 8 s cool-down; the scene shows it until every human has taken it).
5. FIXED **Kart-to-kart push moved karts along the road.** A rear-end contact teleported the follower backwards and the leader forwards. Contacts now push sideways (90 %) and only slightly along (10 %).
6. NEW **Difficulty Santai / Normal / Pro** (`DIFFICULTIES` in `sim.js`): AI top-speed scale 0.93 / 0.99 / 1.04, item use (45 % / 80 % / 100 % of picked-up items are used at all, with 1.8 / 1.0 / 0.5 x reaction delay) and mistakes (0.12 / 0.03 / 0.006 slips per second, each a 0.5-1 s steering error). Stored in game state (`state.difficulty`), passed to `RaceSimulation({ difficulty })`, to the LAN room (`create_room`/`set_options`, default Normal) and remembered in `localStorage`.
7. Keyboard steering now ramps (about 0.1 s to full lock, 0.06 s back) instead of snapping, because steering is rate-based. A look-ahead bot that uses only on/off keys (threshold 0.15 / 0.3 / 0.5) with this ramp laps within 3 % of the analog bot on all three tracks (node check), so digital steering is not harder than before; the touch pad and webcam feed analog values straight in (pad lap vs perfect bot is a unit test, `tests/touchsteer.test.mjs`). Two existing tests had to change because the game changed, not to loosen them: the webcam-lean test now leans through a feedback loop that watches the road (a blind lean wave only worked because the kart auto-followed the road) and runs on Palm Cove (the Canyon hairpins push heading error past its 0.75 rad limit for any driver), with every assertion unchanged; the touch-pad lap test compared a Canyon lap with a fixed 40 s that was written for the 740 m canyon, and now requires the pad lap to be within 25 % of a perfect look-ahead bot on the same (1140 m) lap, which is track-independent.

## N. Three genuinely different circuits (`js/tracks.js`, `js/sim.js`)
Track geometry is now sampled at equal arc length (480 samples, `s` = fraction of the lap in metres, so sectors, pads, ramps and crates are placed by real distance). New layouts (`node tools/trackcheck.mjs` prints these):

| Circuit | Length | Road | Min turn radius | Character | Signature |
|---|---|---|---|---|---|
| Palm Cove | 880 m | 16 | 24 m | wide flowing kidney loop, no hairpins | beginner: wide road, 2 low ramps, 5 pads, bot lap about 26 s |
| Canyon Dash | 1142 m | 10.5 | 15 m | serpentine with hairpins | technical: narrow road, 4 jump ramps, bot lap about 39 s |
| Temple Ruins | 1004 m | 13 | 13 m | rounded rectangle, long straights with chicanes | speed: 8 boost pads, bot lap about 31 s |

Before, all three were about 680-760 m 12-point loops that differed by 10 % in length and had the same road width. Tests (`tests/tracks.test.mjs`): no self-intersection and at least `roadWidth + 20` m between far-apart parts, every pair of lengths differs by at least 10 %, signature checks, start grid on the road facing along it, the AI finishes every track at every difficulty with zero safety-net resets, the safety net still resets a pinned kart on each layout, lap times differ per track (Palm Cove fastest, Canyon slowest by more than 20 %).
Ramps: the launch zone is now the front (high) half of the drawn wedge, for karts moving along it (before: anywhere within 3.8 m of the centre, even beside or behind it). Owner reports confirmed and handled: boost-pad chevrons now point in the driving direction (`makeChevronTexture`, checked in `docs/screens/flow/pad_zoom_temple.png`: apex away from a camera behind the pad) and ramps use rotation order YXZ so the slope rises along the heading (`tests/ramp-orientation.test.mjs` applies the renderer's recipe with three.js and checks every ramp on every track: front edge higher, no sideways tilt, high edge ahead along the road tangent, equal to the sim's launch zone; the batched scenery path bakes `matrixWorld`, so the orientation survives batching). Screens: `docs/screens/flow/pad_*_behind.png`, `ramp_*_behind.png`, `race_*_inrace.png` (minimap in the corner shows each shape).

## O. Arcade start flow (`index.html`, `style.css`, `js/main.js`, `js/net.js`, `server.mjs`)
Mode -> Racer -> Circuit -> Ready, full-screen steps, Back on each, mouse / touch / keyboard (arrows move, Enter confirms, Esc back; arrows also pick on the racer and circuit steps). Solo and 2P share the steps; 2P adds "Player 2: choose your racer" (the card taken by Player 1 is disabled and tagged). Circuit cards draw the real shape from the sim's samples and show tag, length and signature; difficulty and laps selectors are on the circuit step. Ready shows a summary and START; the webcam step is unchanged and still optional. Race Again -> circuit step with the same racers; Main Menu -> step 1; pause menu unchanged. Last choices live in `localStorage` (`krt-choices`, wrapped in try/catch). Wi-Fi: step 1 opens the lobby; inside the room every player picks their own racer (`select_driver`, duplicates refused), the host sets circuit, difficulty and laps (`select_track`, `set_options`); `tests/lan.test.mjs` covers the new messages. Ambiguity: the brief says the difficulty selector is for Solo; it is shown for 2 Players too because two computer racers remain.
"Forgot to check the character pick": verified with the real UI that the racer on the grid is the racer that was picked (`__game.getState().meshDrivers` equals the snapshot driver ids): Solo Volt -> p1:volt + rufus/jet/maka on all 3 circuits; 2P Maka + Volt -> p1:maka, p2:volt, AI rufus + jet (and Player 2 cannot take Maka); LAN host Rufus + guest Volt -> the same four meshes on both pages. See section Q.

## Q. Verified like a user (headless Chrome, scripted walkthroughs; scripts live in the session scratchpad, results below)
All runs: 0 console errors, 0 page errors. Software GL, so frame rates are low (the sim clamps dt to 0.05) and races were run as 1 lap to keep them short.
- **Solo, all 3 circuits in one session** (Volt, 1 lap each; wizard clicks -> Start -> "Play without camera" -> real race -> bot driving with keyboard events -> finish through the real finish line -> results modal -> **Race Again lands on the circuit step with Volt still selected** -> next circuit ...; **Main Menu -> step 1**). Grid on every circuit: `p1: volt` and the three AI karts rufus / jet / maka, each with its own mesh (`meshDrivers` == snapshot drivers). Results: Palm Cove 4th (31.8 s), Canyon 1st (46.8 s), Temple 4th (36.5 s). The on/off-key bot is a weak driver from the back row, so ranks are not a statement about difficulty.
- **2 Players**: Maka as P1; Player 2's click on Maka is ignored (disabled card), then Volt; grid `p1:maka p2:volt ai_1:rufus ai_2:jet`, both bots drive (WASD and arrows), results screen, Race Again keeps both racers.
- **Wi-Fi with two pages** (host + guest, real server on its own port): host creates, guest joins by code; guest asks for Rufus and sees it disabled, takes Volt; host picks Temple, Pro, 1 lap, the guest sees them read-only (circuit buttons disabled); both pages show `rufus, volt, jet(ai), maka(ai)` meshes, both race to the results screen with the same standings. Caveat: with software GL at a few frames per second the two human bots finish far behind the AI (64-66 s vs 32 s); that is the test machine, not a protocol finding.
- **Touch** (1024x768, `hasTouch`, real `Input.dispatchTouchEvent`): wizard driven only by taps, Jet on Canyon, the pad driven by a finger that follows a look-ahead controller: 1st in 47.0 s, farthest 6.7 m from the centre line (half road 5.25 m plus the kerb), no errors. `docs/screens/flow/touch_canyon_race.png` shows the pad, the three buttons and the FINISH banner.
- **Idle** (the page gets no input at all for a whole 1-lap race; the in-game auto-gas stays on): Palm Cove with Jet: 4th, did not finish (AIs 28-32 s); Canyon with Maka: 4th, 84.3 s vs 46.7 s for the winner; Temple with Rufus: 4th, 52.0 s vs 33.5 s. Node version over 12 track x driver cells and 2 seeds each: always 4th (`tests/fairness.test.mjs`).
- **Keyboard only and misc**: Enter / arrows / Esc navigate the wizard, last choices survive a reload (racer, circuit, difficulty, laps), Esc and P pause, Resume / Restart / Main Menu work, Main Menu returns to step 1.
- Screenshots of every wizard step at tablet (1024x768), desktop (1366x768) and phone landscape (844x390): `docs/screens/flow/wizard_*`. I looked at them. Tablet and desktop were fine on first look; on the 844x390 phone the racer-step title sat on the first row of cards, which was fixed (compact racer cards below 480 px height) and re-checked.

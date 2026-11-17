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

## L. Still weak / not verified
- No real tablet, no real thumbs; whether the pad position mapping feels natural (finger at centre = straight, a thumb that lands at the pad edge = full lock at once) needs a hand test. The dead zone and the 80 % full-lock point are guesses.
- Long-press context menu, iOS Safari pointer-capture behaviour and double-tap zoom could not be tested.
- Webcam lean steering still only verified with synthetic poses.
- Pad covers the lower-left of the road view (translucent); at 1024x768 it can overlap the left wheel of the kart when the kart is far left.

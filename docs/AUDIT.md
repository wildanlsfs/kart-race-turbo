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

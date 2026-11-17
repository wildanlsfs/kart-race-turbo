# Kart Race Turbo 🏎️💨

A 3D minimalist multiplayer kart racing game inspired by classic arcade kart racers, controlled by **webcam body motions** (plus keyboard and touch fallback; there is no gamepad support).

## How a game starts (arcade flow)

Four full-screen steps, each with a **Back** button (or `Esc`). Mouse, touch and keyboard all work (arrows move between the big buttons, `Enter` confirms; on the racer and circuit steps the arrows also pick).

1. **Mode:** *Solo* (you against 3 computer racers), *2 Players* (split screen on this one device) or *Wi-Fi* (same network, 4-letter room codes).
2. **Racer:** pick a racer; the live 3D kart on the right is the one you will drive. In 2 Players, Player 1 picks, then Player 2 picks; the two cannot pick the same racer.
3. **Circuit:** three genuinely different tracks, each card shows the real track shape, length, a tag and its signature. Also choose the computer racers' level (**Santai / Normal / Pro**) and the number of laps (1 / 3 / 5, default 3).
4. **Start:** summary and a big START button. The webcam calibration step is optional and still comes before the race ("Play Without Camera" skips it).

After a race, **Race Again** goes back to the circuit step with the same racer(s); **Main Menu** goes back to step 1. Your last choices are remembered on this device.

**Wi-Fi:** step 1 opens the lobby. Everybody picks their own racer inside the room (no duplicates); the host picks the circuit, level and laps once players have joined.

## Circuits

| Circuit | Length | Road | Signature |
|---|---|---|---|
| Palm Cove (Beginner) | about 880 m | widest | flowing loop, gentle curves, 2 low ramps |
| Canyon Dash (Technical) | about 1140 m | narrowest | hairpins, 4 jump ramps |
| Temple Ruins (Speed) | about 1000 m | medium | long straights, chicanes, 8 boost pads |

## Steering and fairness

Steering is real turning: nothing drives the kart for you except a short soft barrier next to the kerb, and that costs speed. Auto-gas stays on (it is only the throttle), but a kart that is left alone runs wide, hits the wall and finishes last. Computer racers get their speed from the level and the racer's stats only; nobody slows down for being ahead of you.

## Webcam Motion Controls

| Body Motion | Action | P1 Keyboard | P2 Keyboard |
|---|---|---|---|
| **Auto-Drive (or hold hands in wheel zone)** | Accelerate forward | `W` / Auto | `↑` / Auto |
| **Tilt invisible steering wheel / Lean left or right** | Proportional steering | `A` / `D` | `←` / `→` |
| **Pull both hands to chest / Crouch** | Brake (hold to Reverse) | `S` | `↓` |
| **Raise both hands overhead (or hop)** | Fire Turbo Boost | `Space` | `Right Shift` |
| **Punch forward with either hand** | Fire Crate Weapon (Rocket, Bomb, TNT, Shield) | `F` / `E` | `Enter` / `K` |

### Other keys and touch

- `Esc` or `P` pauses a local race (Resume / Restart / Main Menu). The Menu button also pauses first. Pausing is not available in Wi-Fi/LAN races.
- On touch devices (tablet or phone) the bottom-left is a big steering pad: put a thumb on it and slide left or right; how far from the middle you are is how hard you steer (a light touch near the middle is a gentle turn, the edge is full lock; lift to go straight). Bottom-right has large BRAKE, TURBO and PUNCH buttons (PUNCH fires the held item). A finger that slides off a pad or button keeps holding it. Multi-touch works, so steer with one thumb while the other holds TURBO. Portrait works but landscape gives a wider view.
- Comfort mode (top bar) calms the camera: slower follow, smaller field-of-view change, no shake.

## Racers

Each racer has different numbers in `js/tracks.js` that the simulation really uses: **Rufus Dash** (balanced), **Jet Mint** (highest top speed, slow acceleration, loses more speed in tight bends), **Maka Tiki** (best handling: keeps its speed through bends), **Neo Volt** (fastest acceleration: recovers quickest from hits and bends). The racer step shows three bars per racer. In 2-player mode the two players always drive different racers.

## Running Locally & on Wi-Fi / LAN

```bash
# Start the local + Wi-Fi/LAN server (serves on 0.0.0.0:3080 (PORT=... to change) and prints your Wi-Fi IP)
npm run server

# Or static server for Single Player / Same-Device Split-Screen:
python3 -m http.server 8080 --bind 127.0.0.1

# Run automated unit, balance, track and LAN tests (about a minute):
npm test
```

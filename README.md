# Kart Race Turbo 🏎️💨

A 3D minimalist multiplayer kart racing game inspired by classic arcade kart racers, controlled by **webcam body motions** (plus keyboard and touch fallback; there is no gamepad support).

## Game Modes

1. **Single Player:** Race against 3 AI karts across 3 circuits (*Palm Cove*, *Canyon Dash*, *Temple Ruins*).
2. **2-Player Split-Screen (Same Device):** Two players stand or sit side-by-side in front of a single webcam (left half = Player 1, right half = Player 2) or share a keyboard (`WASD` + `Arrows`).
3. **Wi-Fi / LAN Multiplayer (Same Network):** Up to 4 players across laptops, tablets, or phones on the same Wi-Fi network race together in real time with 4-letter room codes and one-tap LAN room discovery.

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

Each racer has different numbers in `js/tracks.js` that the simulation really uses: **Rufus Dash** (balanced), **Jet Mint** (highest top speed, slow acceleration, loses more speed in tight bends), **Maka Tiki** (best handling: keeps its speed through bends), **Neo Volt** (fastest acceleration: recovers quickest from hits and bends). The menu shows the three bars for the picked racer. In 2-player mode Player 2 gets a different racer than Player 1.

## Running Locally & on Wi-Fi / LAN

```bash
# Start the local + Wi-Fi/LAN server (serves on 0.0.0.0:3000 and prints your Wi-Fi IP)
npm run server

# Or static server for Single Player / Same-Device Split-Screen:
python3 -m http.server 8080 --bind 127.0.0.1

# Run automated unit & LAN tests:
npm test
```

# Kart Race Turbo 🏎️💨

A 3D minimalist multiplayer kart racing game inspired by classic arcade kart racers, controlled by **webcam body motions** (plus keyboard, gamepad, and touch fallback).

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

## Running Locally & on Wi-Fi / LAN

```bash
# Start the local + Wi-Fi/LAN server (serves on 0.0.0.0:3000 and prints your Wi-Fi IP)
npm run server

# Or static server for Single Player / Same-Device Split-Screen:
python3 -m http.server 8080 --bind 127.0.0.1

# Run automated unit & LAN tests:
npm test
```

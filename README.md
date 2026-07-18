# 🏁 FableKart

A browser-based 3D kart racing game in the spirit of Mario Kart, built with
[Three.js](https://threejs.org/). **Everything is procedural** — tracks, kart
models, textures, sound effects and even the music are generated in code. No
external art assets.

![genre](https://img.shields.io/badge/genre-arcade%20racer-ff5f8f)
![tech](https://img.shields.io/badge/three.js-WebGL-049EF4)
![assets](https://img.shields.io/badge/external%20assets-0-2ed573)

## Running

**Easiest way:** double-click `run-game.command` (Mac/Linux) or `run-game.bat`
(Windows) in the project root — it installs dependencies on first run and
opens the game in your browser.

Or from a terminal:

```bash
npm install
npm run dev      # → http://localhost:5173
```

Production build: `npm run build` (output in `dist/`, servable from any static host).

## How to play

| Action | Keys |
| --- | --- |
| Accelerate / brake–reverse | `W`/`↑` · `S`/`↓` |
| Steer | `A`/`←` · `D`/`→` |
| Drift (hold, release for mini-turbo) | `Space` or `Shift` |
| Use item | `E` / `Enter` / `Ctrl` |
| Pause (in race) / Settings (at title) | `Esc` |
| Mute | `M` |

Hold a direction and press drift to hop into a slide — keep it going to charge
a blue then orange mini-turbo, release to boost. Grass is slow; the dashed
path on the minimap is a dirt shortcut. Boost pads and a rolling start boost
(hold accelerate at "GO!") help too.

## The game

- **3 laps, 8 racers** with live position tracking, countdown start, finish
  standings and per-track best times (localStorage).
- **4 characters** with real stat trade-offs (top speed / acceleration /
  handling / weight).
- **3 tracks** — Meadow Loop (rolling hills), Ember Caldera (lava geysers,
  ridge shortcut), Neon Vale (night city with a genuine overpass) — each with
  hazards, boost pads, barriers and a risk/reward shortcut.
- **6 items** from track item boxes, weighted by race position: speed boost,
  homing rocket, dropped mine, invincibility star, lightning bolt (shrinks
  everyone ahead) and a bubble shield that eats one hit.
- **AI with rubber-banding** so races stay close, plus per-driver skill,
  racing-line apexing, drifting and shortcut usage.
- **Audio**: generated clips for the engine loop, drift screech, boost,
  rocket fire, mine drop, explosion, lightning bolt, shield bubble,
  countdown/lap dings and spoken "3, 2, 1, GO!" (`public/audio/sfx/`) — the
  ding and voice line fire in the same tick so they overlap like the real
  thing. Synthesized WebAudio versions act as an automatic fallback for
  anything not (yet) recorded.
- **Music**: a real looping background track per race track (`public/audio/music/`)
  — Turbo Start (Meadow Loop), Lava Lap (Ember Caldera), Neon Lap (Neon Vale) —
  streamed and natively looped so it doesn't matter how long a race runs.
  Menu and results screens keep a fully generative chiptune sequencer.
- **Settings menu** (`Esc` at the title screen, or Settings from the pause
  menu mid-race): independent Music / SFX / Vocals volume sliders, persisted
  to localStorage.
- **Rendering**: dynamic shadows, per-theme sky shader (sun, stars, night),
  fog, canvas-painted PBR-ish textures, GPU point-sprite particles (drift
  sparks, boost flames, explosions, geysers), chase camera with FOV kick and
  screen shake.

## Code layout

```
src/
  main.js               entry point
  core/                 game shell, loop, input, procedural audio + music
  config/               characters, track definitions (data only)
  track/                spline sampling & spatial queries, road/wall meshes,
                        per-theme environments (sky, terrain, scenery)
  entities/             kart physics, player + AI controllers
  race/                 race orchestration (laps, ranks, hazards), item system
  render/               procedural textures, kart factory, particles, camera
  ui/                   HUD, minimap, menu screens, item icons
```

Design notes:

- The track is a closed Catmull-Rom spline sampled into a dense lookup table
  (`track/trackData.js`). Every gameplay question — ground height, surface
  type, lap progress, wall presence, AI targets, minimap shape — is answered
  by projecting onto that table, so track *data* stays tiny (a list of control
  points + feature fractions in `config/tracks.js`).
- Lap progress is a continuous arc-length accumulator rather than checkpoint
  flags, which makes shortcuts and the overpass "just work".
- Kart physics is an arcade model: forward speed + heading, with a lagging
  velocity direction for slides and drift.

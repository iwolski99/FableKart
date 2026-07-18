// Game shell: renderer, screen flow, race lifecycle, main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { input } from './input.js';
import { audio } from './audio.js';
import { clamp } from './rng.js';
import { CHARACTERS, AI_SKINS } from '../config/characters.js';
import { TRACKS, getTrack } from '../config/tracks.js';
import { getDifficulty, loadDifficultyId, saveDifficultyId } from '../config/difficulty.js';
import { TrackData } from '../track/trackData.js';
import { buildTrackMeshes } from '../track/trackMesh.js';
import { buildEnvironment } from '../track/environment.js';
import { buildKartMesh } from '../render/kartFactory.js';
import { Particles } from '../render/particles.js';
import { ChaseCamera } from '../render/camera.js';
import { Kart } from '../entities/kart.js';
import { PlayerController } from '../entities/playerController.js';
import { AIController } from '../entities/aiController.js';
import { ItemSystem } from '../race/itemSystem.js';
import { Race } from '../race/raceManager.js';
import { HUD } from '../ui/hud.js';
import { Minimap } from '../ui/minimap.js';
import { Screens } from '../ui/screens.js';

export class Game {
  constructor() {
    // antialias: false — the scene renders into the EffectComposer's render
    // target, which has no MSAA; canvas multisampling would only apply to the
    // final fullscreen blit, so it's pure memory/bandwidth cost with no
    // visible effect. Edge quality comes from the pixel-ratio supersampling.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    // Adaptive resolution: start at a 1.5 pixel-ratio cap and let the frame
    // governor in _loop() step it down (never below native 1.0) only if this
    // machine demonstrably can't hold 60fps — so capable hardware keeps full
    // quality and weak hardware gets smoothness instead of lag.
    this.pixelCaps = [1.5, 1.35, 1.2, 1.1, 1.0];
    this.pixelCapIdx = 0;
    this.perf = { slow: 0, total: 0, grace: 2, cleanWindows: 0, failedIdx: -1, failedAt: 0 };
    this._lastFrameT = 0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelCaps[0]));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    // PCFShadowMap instead of PCFSoftShadowMap — meaningfully cheaper per
    // shadowed fragment, the softer edge quality difference is subtle.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      72, window.innerWidth / window.innerHeight, 0.1, 2000);

    // ---- postprocessing: a tasteful, cheap bloom pass ----
    // Bloom resolution is deliberately well under full canvas size — it's a
    // low-frequency glow effect that doesn't need sharp detail, and the
    // mip-chain blur cost scales with it. Threshold is high so only genuinely
    // bright/emissive things (neon strips, lit windows, lamps, lava) bloom;
    // normal lit surfaces stay under it and are untouched.
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), this.camera);
    this.composer.addPass(this.renderPass);
    const bloomRes = new THREE.Vector2(
      Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
    this.bloomPass = new UnrealBloomPass(bloomRes, 0.45, 0.35, 0.86);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.hud = new HUD(document.getElementById('hud'));
    this.screens = new Screens(document.getElementById('ui'));
    this.minimap = new Minimap(this.hud.minimapCanvas);

    this.trackDataCache = new Map();
    this.bundle = null;        // current scene bundle (menu backdrop or race)
    this.race = null;
    this.paused = false;
    this.mode = 'boot';        // boot | menu | race
    this.menuOrbitT = 0;
    this.selectedChar = CHARACTERS[0].id;
    this.selectedTrack = TRACKS[0].id;
    this.difficulty = loadDifficultyId();
    this._clock = new THREE.Clock();

    window.addEventListener('resize', () => this._onResize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this._toggleMute();
    });
    window.addEventListener('blur', () => {
      if (this.mode === 'race' && !this.paused && this.race) this._pause();
    });

    this._buildChipRow();
  }

  getTrackData(id) {
    if (!this.trackDataCache.has(id)) {
      this.trackDataCache.set(id, new TrackData(getTrack(id)));
    }
    return this.trackDataCache.get(id);
  }

  start() {
    input.onFirstGesture(() => {
      audio.init();
      if (this.mode === 'menu') audio.playMusic('menu');
    });
    this._showTitle();
    this._loop();
    document.getElementById('boot').classList.add('hidden');
  }

  // ------------------------------------------------------------------
  // screen flow

  _showTitle() {
    this.mode = 'menu';
    this._buildMenuBackdrop();
    if (audio.ctx) audio.playMusic('menu');
    this.screens.showTitle(
      () => this._showCharSelect(),
      () => this._showSettings(() => this._showTitle()));
  }

  _showSettings(onBack) {
    this.screens.showSettings(
      audio.volumes, audio.engineMode, this.difficulty,
      (kind, v) => audio.setVolume(kind, v),
      (mode) => audio.setEngineMode(mode),
      (id) => { this.difficulty = id; saveDifficultyId(id); },
      onBack);
  }

  _showCharSelect() {
    this.mode = 'menu';
    if (!this.bundle) this._buildMenuBackdrop();
    this.screens.showCharacterSelect(
      (charId) => { this.selectedChar = charId; this._showTrackSelect(); },
      () => this._showTitle());
  }

  _showTrackSelect() {
    this.screens.showTrackSelect(
      (id) => this.getTrackData(id),
      (trackId) => { this.selectedTrack = trackId; this.startRace(); },
      () => this._showCharSelect());
  }

  // ------------------------------------------------------------------
  // scene bundles

  _disposeBundle() {
    if (!this.bundle) return;
    const b = this.bundle;
    b.race?.dispose();
    b.itemSystem?.dispose();
    b.particles?.dispose();
    b.env?.dispose();
    if (b.trackMeshes) { b.scene.remove(b.trackMeshes.group); b.trackMeshes.dispose(); }
    for (const k of b.karts || []) { b.scene.remove(k.visual.group); k.visual.dispose(); }
    this.bundle = null;
    this.race = null;
  }

  _buildMenuBackdrop() {
    this._disposeBundle();
    const track = this.getTrackData(this.selectedTrack);
    const scene = new THREE.Scene();
    const env = buildEnvironment(scene, track);
    const trackMeshes = buildTrackMeshes(track);
    scene.add(trackMeshes.group);
    this.bundle = { scene, env, trackMeshes, track, karts: [] };
    this.renderPass.scene = scene;
    this.perf.grace = 2; // fresh scene = shader compile spikes; not a perf signal
    // Nothing here ever moves except the orbiting camera, and shadow maps
    // are computed from the light's perspective (camera-independent) — so
    // the shadow pass can render once and be reused every frame instead of
    // re-rendering the whole shadow-casting scenery on every single frame.
    env.sun.shadow.autoUpdate = false;
    env.sun.shadow.needsUpdate = true;
  }

  // ------------------------------------------------------------------
  // race lifecycle

  startRace() {
    this._disposeBundle();
    this.hud.show();
    this.paused = false;

    const trackDef = getTrack(this.selectedTrack);
    const track = this.getTrackData(this.selectedTrack);
    const scene = new THREE.Scene();
    const env = buildEnvironment(scene, track);
    const trackMeshes = buildTrackMeshes(track);
    scene.add(trackMeshes.group);
    this.renderPass.scene = scene;
    env.sun.shadow.autoUpdate = true; // karts move during a race, shadows must follow
    this.perf.grace = 2; // fresh scene = shader compile spikes; not a perf signal

    const particles = new Particles(scene);
    const itemSystem = new ItemSystem(scene, track, particles);

    // ---- build the field: player + 7 AI ----
    const playerChar = CHARACTERS.find((c) => c.id === this.selectedChar) || CHARACTERS[0];
    const karts = [];
    const player = new Kart({ character: playerChar, track, isPlayer: true, name: playerChar.name });
    player.controller = new PlayerController(player);
    karts.push(player);

    const diff = getDifficulty(this.difficulty);
    const others = CHARACTERS.filter((c) => c.id !== playerChar.id);
    for (let i = 0; i < 7; i++) {
      const base = others[i % others.length];
      const skin = AI_SKINS[i % AI_SKINS.length];
      const character = {
        ...base,
        name: skin.name, color: skin.color, helmet: skin.helmet,
        // small stat jitter so clones don't drive identically
        speed: Math.min(1, Math.max(0, base.speed + (Math.random() - 0.5) * 0.14)),
        accel: Math.min(1, Math.max(0, base.accel + (Math.random() - 0.5) * 0.14)),
      };
      const kart = new Kart({ character, track, name: skin.name });
      kart.maxSpeed *= diff.speedMult;
      kart.accelRate *= diff.speedMult;
      const skill = clamp(
        diff.skillMin + (diff.skillMax - diff.skillMin) * (i / 6) + (Math.random() - 0.5) * 0.06, 0, 1);
      kart.controller = new AIController(kart, track, {
        skill,
        laneBias: (i / 6) * 2 - 1,
        usesShortcut: Math.random() < 0.25 + skill * 0.55,
      });
      karts.push(kart);
    }

    // grid: player starts 7th of 8 — earn your way forward
    const slots = [0, 1, 2, 3, 4, 5, 7];
    karts.forEach((k, i) => {
      if (k.isPlayer) k.placeAtStart(6);
      else k.placeAtStart(slots[i - 1]);
      k.visual = buildKartMesh(k.character);
      scene.add(k.visual.group);
      k.updateVisuals(0, 0);
    });

    this.minimap.setTrack(track);
    const chase = new ChaseCamera(this.camera);

    this.race = new Race({
      scene, track, karts, player, itemSystem, particles,
      hud: this.hud, minimap: this.minimap, camera: chase, env,
      laps: trackDef.laps,
      onFinish: (standings) => this.endRace(standings),
    });
    this.chase = chase;
    chase.snapTo(player);

    this.bundle = { scene, env, trackMeshes, track, karts, particles, itemSystem, race: this.race };
    this.mode = 'race';
    this.screens.hide();

    audio.startEngine();
    audio.playMusic(trackDef.theme.key);
  }

  endRace(standings) {
    const raceTime = this.race?.time ?? 0;
    audio.stopEngine();
    audio.playMusic('results');
    this.hud.hide();
    this.mode = 'menu-results';
    this.screens.showResults(standings, raceTime, this.selectedTrack, {
      onAgain: () => this.startRace(),
      onNewTrack: () => { this._disposeBundle(); this._buildMenuBackdrop(); this._showTrackSelect(); },
      onMenu: () => { this._disposeBundle(); this._showTitle(); },
    });
    // keep the finished race scene as backdrop behind the results panel
  }

  _quitRace() {
    audio.stopEngine();
    this.hud.hide();
    this._disposeBundle();
    this._showTitle();
  }

  // ------------------------------------------------------------------
  // pause

  _pause() {
    if (this.paused || !this.race) return;
    this.paused = true;
    audio.muteEngine();
    audio.stopMusic();
    this._openPauseMenu();
  }

  _openPauseMenu() {
    this.screens.showPause({
      onResume: () => this._resume(),
      onRestart: () => { this.paused = false; this.screens.hide(); this.startRace(); },
      onQuit: () => { this.paused = false; this.screens.hide(); this._quitRace(); },
      onSettings: () => this._showSettings(() => this._openPauseMenu()),
    });
  }

  _resume() {
    this.paused = false;
    this.screens.hide();
    audio.unmuteEngine();
    audio.playMusic(getTrack(this.selectedTrack).theme.key);
  }

  // ------------------------------------------------------------------
  // chrome

  _buildChipRow() {
    const row = document.createElement('div');
    row.className = 'chip-row';
    this.muteChip = document.createElement('button');
    this.muteChip.className = 'chip';
    this.muteChip.textContent = '🔊 sound';
    this.muteChip.addEventListener('click', () => this._toggleMute());
    row.appendChild(this.muteChip);
    document.body.appendChild(row);
  }

  _toggleMute() {
    audio.init();
    const muted = audio.toggleMuted();
    this.muteChip.textContent = muted ? '🔇 muted' : '🔊 sound';
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this._applyPixelCap();
  }

  _applyPixelCap() {
    const pr = Math.min(window.devicePixelRatio, this.pixelCaps[this.pixelCapIdx]);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    // Pin bloom's internal mip chain to half CSS resolution regardless of the
    // adaptive pixel ratio — its cost stays constant and its softness doesn't
    // visibly shift when the governor steps resolution up or down.
    this.bloomPass.setSize(window.innerWidth, window.innerHeight);
  }

  // Frame governor: watches real frame times and steps the resolution cap
  // down one notch when >half the frames in a window miss 60fps, back up
  // after a long clean streak. A level that failed isn't retried for 90s so
  // it can't oscillate. Huge deltas (tab switches) and the seconds right
  // after a scene build (shader compilation) are ignored as noise.
  _perfSample(rawMs) {
    const p = this.perf;
    if (p.grace > 0) { p.grace -= rawMs / 1000; return; }
    if (rawMs > 250) return;
    p.total++;
    if (rawMs > 18.5) p.slow++;
    if (p.total < 90) return;
    const frac = p.slow / p.total;
    p.slow = 0; p.total = 0;
    if (frac > 0.5 && this.pixelCapIdx < this.pixelCaps.length - 1) {
      p.failedIdx = this.pixelCapIdx;
      p.failedAt = performance.now();
      this.pixelCapIdx++;
      p.cleanWindows = 0; p.grace = 1;
      this._applyPixelCap();
    } else if (frac === 0 && this.pixelCapIdx > 0) {
      p.cleanWindows++;
      const retryOk = this.pixelCapIdx - 1 !== p.failedIdx ||
        performance.now() - p.failedAt > 90000;
      if (p.cleanWindows >= 8 && retryOk) {
        this.pixelCapIdx--;
        p.cleanWindows = 0; p.grace = 1;
        this._applyPixelCap();
      }
    } else {
      p.cleanWindows = 0;
    }
  }

  // ------------------------------------------------------------------
  // main loop

  _loop() {
    requestAnimationFrame(() => this._loop());
    const now = performance.now();
    if (this._lastFrameT) this._perfSample(now - this._lastFrameT);
    this._lastFrameT = now;
    let dt = Math.min(this._clock.getDelta(), 1 / 20);

    if (this.mode === 'race' && this.race && !this.paused) {
      if (input.justPressed('Escape')) {
        this._pause();
      } else {
        // Sub-step only for genuinely large frame drops (this game's speeds
        // and track feature sizes stay stable well below 45fps single-stepped).
        // Substepping below that threshold would double the physics/AI/item
        // workload on every already-slow frame — a feedback loop that makes
        // marginal hardware worse, not better.
        const steps = dt > 1 / 24 ? 2 : 1;
        const h = dt / steps;
        for (let i = 0; i < steps; i++) this.race?.update(h);
        if (this.race) {
          this.chase.update(dt, this.race.player, this.race);
        }
      }
      if (this.bundle) this.composer.render();
    } else if (this.mode === 'race' && this.bundle) {
      // paused: keep rendering the frozen frame from the chase camera
      this.composer.render();
    } else if (this.mode === 'menu-results' && this.bundle) {
      // slow orbit around the finished race
      if (this.race) {
        this.chase.update(dt, this.race.player, null);
        for (const k of this.bundle.karts) k.updateVisuals(dt, this.race.time);
      }
      this.bundle.env.update(dt, this.camera.position);
      this.composer.render();
    } else if (this.bundle) {
      // menu backdrop: lazy orbit over the track
      this.menuOrbitT += dt * 0.05;
      const track = this.bundle.track;
      const c = track.sampleAt(this.menuOrbitT * 60 * 4 % track.length);
      this.camera.position.set(
        c.pos.x + Math.sin(this.menuOrbitT) * 90,
        58,
        c.pos.z + Math.cos(this.menuOrbitT) * 90);
      this.camera.lookAt(c.pos.x, c.pos.y, c.pos.z);
      this.bundle.env.update(dt, this.camera.position);
      this.composer.render();
    }

    input.endFrame();
  }
}

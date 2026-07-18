// Game shell: renderer, screen flow, race lifecycle, main loop.
import * as THREE from 'three';
import { input } from './input.js';
import { audio } from './audio.js';
import { CHARACTERS, AI_SKINS } from '../config/characters.js';
import { TRACKS, getTrack } from '../config/tracks.js';
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      72, window.innerWidth / window.innerHeight, 0.1, 2000);

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
    this.screens.showSettings(audio.volumes, (kind, v) => audio.setVolume(kind, v), onBack);
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

    const particles = new Particles(scene);
    const itemSystem = new ItemSystem(scene, track, particles);

    // ---- build the field: player + 7 AI ----
    const playerChar = CHARACTERS.find((c) => c.id === this.selectedChar) || CHARACTERS[0];
    const karts = [];
    const player = new Kart({ character: playerChar, track, isPlayer: true, name: playerChar.name });
    player.controller = new PlayerController(player);
    karts.push(player);

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
      kart.controller = new AIController(kart, track, {
        skill: 0.5 + 0.4 * (i / 6) + Math.random() * 0.1,
        laneBias: (i / 6) * 2 - 1,
        usesShortcut: Math.random() < 0.5,
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
    audio.setEngine(0, 0, false);
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
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------------
  // main loop

  _loop() {
    requestAnimationFrame(() => this._loop());
    let dt = Math.min(this._clock.getDelta(), 1 / 20);

    if (this.mode === 'race' && this.race && !this.paused) {
      if (input.justPressed('Escape')) {
        this._pause();
      } else {
        // sub-step when frames get long so physics stays stable
        const steps = dt > 1 / 45 ? 2 : 1;
        const h = dt / steps;
        for (let i = 0; i < steps; i++) this.race?.update(h);
        if (this.race) {
          this.chase.update(dt, this.race.player, this.race);
        }
      }
      if (this.bundle) this.renderer.render(this.bundle.scene, this.camera);
    } else if (this.mode === 'race' && this.bundle) {
      // paused: keep rendering the frozen frame from the chase camera
      this.renderer.render(this.bundle.scene, this.camera);
    } else if (this.mode === 'menu-results' && this.bundle) {
      // slow orbit around the finished race
      if (this.race) {
        this.chase.update(dt, this.race.player, null);
        for (const k of this.bundle.karts) k.updateVisuals(dt, this.race.time);
      }
      this.bundle.env.update(dt);
      this.renderer.render(this.bundle.scene, this.camera);
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
      this.bundle.env.update(dt);
      this.renderer.render(this.bundle.scene, this.camera);
    }

    input.endFrame();
  }
}

// Race orchestration: countdown → racing → finished. Owns hazards, kart-kart
// collisions, rank/rubber-band logic, and turns kart events into audio +
// particles + HUD feedback.
import * as THREE from 'three';
import { clamp } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { AIController } from '../entities/aiController.js';

const DRIFT_COLORS = [0xffffff, 0x54c8ff, 0xffa030]; // charge tier → spark color

export class Race {
  constructor({ scene, track, karts, player, itemSystem, particles, hud, minimap, camera, env, laps, onFinish }) {
    this.scene = scene;
    this.track = track;
    this.karts = karts;
    this.player = player;
    this.items = itemSystem;
    this.particles = particles;
    this.hud = hud;
    this.minimap = minimap;
    this.camera = camera;
    this.env = env;
    this.laps = laps;
    this.onFinish = onFinish;

    this.state = 'countdown';
    this.countdownT = 4.4;
    this._lastCount = 4;
    this.time = 0;      // animation clock (runs from countdown start)
    this.raceTime = 0;  // scoring clock (starts at GO)
    this.finishT = 0;
    this._boltFlash = 0;

    this.hazards = this._buildHazards();
    this.computeRanks();
  }

  // ------------------------------------------------------------------
  _buildHazards() {
    const defs = this.track.def.hazards || [];
    const out = [];
    for (const h of defs) {
      const s = h.s * this.track.length;
      const smp = this.track.sampleAt(s);
      const group = new THREE.Group();
      const disposables = [];
      let style = h.style || 'hay';

      if (h.type === 'sweeper') {
        if (style === 'hay') {
          const geo = new THREE.CylinderGeometry(0.85, 0.85, 1.5, 12);
          const mat = new THREE.MeshStandardMaterial({ color: 0xd8b545, roughness: 1 });
          const roll = new THREE.Mesh(geo, mat);
          roll.rotation.z = Math.PI / 2;
          roll.castShadow = true;
          group.add(roll);
          disposables.push(geo, mat);
          out.push({ ...h, s, smp, group, spin: roll, kind: 'sweeper', y: 0.85, disposables });
        } else {
          const geo = new THREE.SphereGeometry(0.7, 12, 10);
          const mat = new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 0.4, metalness: 0.5 });
          const body = new THREE.Mesh(geo, mat);
          body.castShadow = true;
          const ringGeo = new THREE.TorusGeometry(1.0, 0.09, 8, 20);
          const ringMat = new THREE.MeshStandardMaterial({ emissive: 0xff3aa0, emissiveIntensity: 2, color: 0x111111 });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = Math.PI / 2;
          group.add(body, ring);
          disposables.push(geo, mat, ringGeo, ringMat);
          out.push({ ...h, s, smp, group, spin: ring, kind: 'sweeper', y: 1.5, disposables });
        }
      } else if (h.type === 'geyser') {
        const isSteam = style === 'steam';
        const baseGeo = new THREE.CircleGeometry(h.radius * 0.85, 20);
        baseGeo.rotateX(-Math.PI / 2);
        const baseMat = new THREE.MeshStandardMaterial({
          color: isSteam ? 0x27e0ff : 0xff6a1a,
          emissive: isSteam ? 0x27e0ff : 0xff6a1a,
          emissiveIntensity: 0.5, transparent: true, opacity: 0.55,
        });
        const base = new THREE.Mesh(baseGeo, baseMat);
        const colGeo = new THREE.CylinderGeometry(h.radius * 0.55, h.radius * 0.75, 1, 14, 1, true);
        const colMat = new THREE.MeshBasicMaterial({
          color: isSteam ? 0xbfefff : 0xffa860, transparent: true, opacity: 0.75,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const column = new THREE.Mesh(colGeo, colMat);
        column.visible = false;
        group.add(base, column);
        disposables.push(baseGeo, baseMat, colGeo, colMat);
        const lat = (h.lat ?? 0) * this.track.halfWidth;
        const pos = smp.pos.clone().addScaledVector(smp.left, lat);
        group.position.set(pos.x, pos.y + 0.06, pos.z);
        out.push({
          ...h, s, smp, group, column, baseMat, kind: 'geyser', isSteam,
          worldPos: pos, active: false, wasActive: false, disposables,
        });
      }
      this.scene.add(group);
    }
    return out;
  }

  _updateHazards(dt) {
    for (const h of this.hazards) {
      if (h.kind === 'sweeper') {
        const lat = Math.sin((this.time * Math.PI * 2) / h.period + h.phase) * h.range * this.track.halfWidth;
        const latVel = Math.cos((this.time * Math.PI * 2) / h.period + h.phase);
        h.group.position.copy(h.smp.pos).addScaledVector(h.smp.left, lat);
        h.group.position.y += h.y;
        if (h.style === 'drone') {
          h.group.position.y += 0.25 * Math.sin(this.time * 3 + h.phase);
          h.spin.rotation.z = this.time * 4;
        } else {
          h.spin.rotation.x += latVel * dt * 4;
        }
        // collision
        for (const k of this.karts) {
          const dx = k.pos.x - h.group.position.x;
          const dz = k.pos.z - h.group.position.z;
          if (dx * dx + dz * dz < (h.radius + k.radius) ** 2 && Math.abs(k.pos.y - h.group.position.y) < 2.2) {
            if (k.applySpin('hazard')) {
              this.particles.burst({
                pos: k.pos.clone().add(new THREE.Vector3(0, 1, 0)), count: 12, speed: 5,
                spread: 6, size: 1.8, life: 0.5, colors: [0xffe14a, 0xffffff], gravity: 8,
              });
            }
          }
        }
      } else {
        // geyser cycle: quiet → warn (bubbles) → erupt
        const tC = (this.time + h.phase) % h.period;
        const eruptStart = h.period - h.active;
        const warning = tC > eruptStart - h.warn && tC <= eruptStart;
        h.activeNow = tC > eruptStart;
        h.baseMat.emissiveIntensity = warning ? 1.6 + Math.sin(this.time * 18) : 0.5;
        h.column.visible = h.activeNow;
        if (h.activeNow) {
          const tE = (tC - eruptStart) / h.active;
          const height = 5.5 * Math.sin(Math.min(1, tE * 1.25) * Math.PI * 0.5) + 0.5;
          h.column.scale.set(1, height, 1);
          h.column.position.y = height / 2;
          if (Math.random() < 0.6) {
            this.particles.burst({
              pos: h.worldPos.clone().add(new THREE.Vector3(0, height, 0)),
              count: 3, speed: 3, spread: 3.5, size: 2.2, life: 0.55,
              colors: h.isSteam ? [0xbfefff, 0xffffff] : [0xff9d2e, 0xff5030, 0xffe14a],
              gravity: 10,
            });
          }
          if (!h.wasActive && this.player.pos.distanceTo(h.worldPos) < 70) audio.geyser();
          // collision only while erupting
          for (const k of this.karts) {
            const dx = k.pos.x - h.worldPos.x;
            const dz = k.pos.z - h.worldPos.z;
            if (dx * dx + dz * dz < (h.radius + k.radius * 0.5) ** 2 && k.pos.y < h.worldPos.y + height) {
              if (k.applySpin('hazard')) k.vy = 9; // launched!
            }
          }
        }
        h.wasActive = h.activeNow;
      }
    }
  }

  // ------------------------------------------------------------------
  computeRanks() {
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.raceDist - a.raceDist;
    });
    sorted.forEach((k, i) => { k.rank = i + 1; });
    return sorted;
  }

  _applyRubberBand() {
    const pd = this.player.raceDist;
    for (const k of this.karts) {
      if (k.isPlayer || k.finished) { k.aiSpeedScale = 1; continue; }
      const delta = pd - k.raceDist; // + means AI is behind the player
      let scale = 1 + clamp(delta * 0.0012, -0.10, 0.24);
      // never let the leader AI run away hard
      if (delta < -70) scale = Math.min(scale, 0.93);
      k.aiSpeedScale = scale;
    }
  }

  onBolt(user) {
    this._boltFlash = 0.35;
    audio.lightning();
    this.hud.flash('rgba(255,255,220,0.85)', 0.28);
    for (const o of this.karts) {
      if (o === user || o.finished || o.raceDist <= user.raceDist) continue;
      this.particles.burst({
        pos: o.pos.clone().add(new THREE.Vector3(0, 2.4, 0)), count: 14, speed: 6,
        spread: 5, size: 2, life: 0.4, colors: [0xffe14a, 0xffffff], gravity: -2,
      });
    }
  }

  // ------------------------------------------------------------------
  update(dt) {
    if (this.state === 'done') return;
    if (this.state === 'countdown') {
      this.countdownT -= dt;
      const count = Math.ceil(this.countdownT);
      if (count !== this._lastCount && count <= 3) {
        this._lastCount = count;
        if (count > 0) {
          this.hud.showCount(String(count));
          audio.countBeep(false);
          audio.countVoice(count);
        }
      }
      if (this.countdownT <= 0) {
        this.state = 'racing';
        this.hud.showCount('GO!');
        audio.countBeep(true);
        audio.countVoice('go');
        // launch boosts
        if (this.player.control.throttle > 0 || this.player.controlHeld) {
          this.player.applyBoost(1.38, 1.0, 'launch');
        }
        for (const k of this.karts) {
          if (!k.isPlayer && Math.random() < 0.55) k.applyBoost(1.3, 0.9, 'launch');
        }
      }
      // let the player rev (reads input but karts stay put)
      for (const k of this.karts) {
        k.controller.update(dt, this);
        k.updateVisuals(dt, this.time);
      }
      this.player.controlHeld = this.player.control.throttle > 0;
      this.time += dt; // hazards animate during countdown
      this._updateHazardVisualOnly(dt);
      this.items.update(dt, [], this, this.time);
      this.particles.update(dt);
      this.minimap.update(this.karts, this.player);
      audio.setEngine(this.player.control.throttle * 0.35, 0, false);
      return;
    }

    this.time += dt;
    this.raceTime += dt;

    // controllers + physics
    for (const k of this.karts) {
      k.controller.update(dt, this);
      if (k.control.useItem && k.item && !k.finished && k.rouletteT <= 0) {
        this.items.useItem(k, this);
      }
      k.update(dt);
      k.updateVisuals(dt, this.time);
    }

    this._collideKarts();
    this._updateHazards(dt);
    this.items.update(dt, this.karts, this, this.time);
    this._applyRubberBand();
    this.computeRanks();

    // finish detection
    const goal = this.laps * this.track.length;
    for (const k of this.karts) {
      if (!k.finished && k.raceDist >= goal) {
        k.finished = true;
        k.finishTime = this.raceTime;
        k.emit('finish');
        if (k.isPlayer) {
          this.state = 'finished';
          this.finishT = 3.2;
          this.hud.showBanner('FINISH!');
          audio.finish(k.rank <= 3);
          audio.stopMusic();
          // hand the kart to an AI chauffeur for the outro
          k.controller = new AIController(k, this.track, { skill: 0.55, usesShortcut: false });
          this.camera.setMode('orbit');
        }
      }
    }

    if (this.state === 'finished') {
      this.finishT -= dt;
      if (this.finishT <= 0) {
        this.state = 'done';
        this.onFinish(this.buildStandings());
        return;
      }
    }

    this._drainEvents();
    this._continuousEffects(dt);
    this.particles.update(dt);
    this.env.update(dt, this.player.pos);

    // player audio
    const p = this.player;
    audio.setEngine(
      clamp(Math.abs(p.speed) / p.maxSpeed, 0, 1.2),
      p.driftActive && p.grounded ? clamp(0.4 + p.driftCharge * 0.3, 0, 1) : 0,
      p.boostTimer > 0);

    // HUD + minimap
    this.hud.update(this, p);
    this.minimap.update(this.karts, p);
  }

  _updateHazardVisualOnly(dt) {
    // during countdown: animate, no collisions
    for (const h of this.hazards) {
      if (h.kind === 'sweeper') {
        const lat = Math.sin((this.time * Math.PI * 2) / h.period + h.phase) * h.range * this.track.halfWidth;
        h.group.position.copy(h.smp.pos).addScaledVector(h.smp.left, lat);
        h.group.position.y += h.y;
      }
    }
  }

  _collideKarts() {
    const n = this.karts.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.karts[i], b = this.karts[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const dy = Math.abs(b.pos.y - a.pos.y);
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || dy > 1.8 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const overlap = rr - d;
        const totalMass = a.mass + b.mass;
        const pushA = overlap * (b.mass / totalMass);
        const pushB = overlap * (a.mass / totalMass);
        a.pos.x -= nx * pushA; a.pos.z -= nz * pushA;
        b.pos.x += nx * pushB; b.pos.z += nz * pushB;

        // star karts wreck whoever they touch
        if (a.starTimer > 0 && b.starTimer <= 0) b.applySpin('star');
        if (b.starTimer > 0 && a.starTimer <= 0) a.applySpin('star');

        // relative approach speed → bump feedback
        const avx = Math.sin(a.velDir) * a.speed - Math.sin(b.velDir) * b.speed;
        const avz = Math.cos(a.velDir) * a.speed - Math.cos(b.velDir) * b.speed;
        const closing = avx * nx + avz * nz;
        if (closing > 5 && (a.isPlayer || b.isPlayer)) {
          audio.bumpKart();
          this.camera.shake(0.18);
        }
        a.speed *= 0.985; b.speed *= 0.985;
      }
    }
  }

  _drainEvents() {
    for (const k of this.karts) {
      for (const ev of k.events) {
        const near = k.isPlayer || k.pos.distanceTo(this.player.pos) < 60;
        switch (ev.type) {
          case 'boost':
            if (k.isPlayer) { audio.boost(ev.kind === 'pad' ? 1.25 : 1); this.camera.kick(); }
            this.particles.burst({
              pos: k.pos.clone().addScaledVector(k.forward, -1.4).add(new THREE.Vector3(0, 0.5, 0)),
              count: 16, dir: k.forward.clone().negate(), speed: 9, spread: 3,
              size: 2.2, life: 0.4, colors: [0xffb060, 0xff6030, 0xffe14a],
            });
            break;
          case 'driftTier':
            if (k.isPlayer) audio.driftTier(ev.tier);
            break;
          case 'spin':
            if (near) audio.spinOut();
            if (k.isPlayer) { this.camera.shake(0.5); this.hud.flash('rgba(255,60,60,0.25)', 0.3); }
            this.particles.burst({
              pos: k.pos.clone().add(new THREE.Vector3(0, 1, 0)), count: 16, speed: 6,
              spread: 7, size: 1.8, life: 0.5, colors: [0xffe14a, 0xff9d2e, 0xffffff], gravity: 9,
            });
            break;
          case 'rocketHit':
          case 'mineHit':
            if (near) audio.explosion();
            if (k.isPlayer) this.camera.shake(0.6);
            break;
          case 'wall':
            if (k.isPlayer && ev.impact > 4) {
              audio.bumpWall(ev.impact > 10);
              this.camera.shake(clamp(ev.impact * 0.03, 0.1, 0.5));
            }
            if (ev.impact > 4) {
              this.particles.burst({
                pos: k.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), count: 8, speed: 4,
                spread: 5, size: 1.4, life: 0.35, colors: [0xffe14a, 0xffffff],
              });
            }
            break;
          case 'land':
            this.particles.burst({
              pos: k.pos.clone(), count: 10, speed: 2, spread: 4, size: 1.6,
              life: 0.4, colors: [0xccbbaa, 0xffffff], gravity: 5,
            });
            break;
          case 'pickup': if (k.isPlayer) audio.itemBox(); break;
          case 'itemLand': if (k.isPlayer) audio.itemLand(); break;
          case 'useItem': break;
          case 'rocketFire': if (near) audio.rocketFire(); break;
          case 'mineDrop': if (near) audio.mineDrop(); break;
          case 'star': if (k.isPlayer) audio.star(); break;
          case 'shield': if (k.isPlayer) audio.shieldUp(); break;
          case 'shieldBlock': if (near) audio.shieldBlock(); break;
          case 'shrink': if (k.isPlayer) { audio.spinOut(); this.hud.flash('rgba(255,255,120,0.3)', 0.25); } break;
          case 'respawn': if (k.isPlayer) audio.respawn(); break;
          case 'lap':
            if (k.isPlayer && k.lap >= 1 && k.lap < this.laps) {
              const finalLap = k.lap === this.laps - 1;
              audio.lap(finalLap);
              this.hud.showBanner(finalLap ? 'FINAL LAP!' : `LAP ${k.lap + 1}/${this.laps}`);
            }
            break;
          case 'finish':
            if (!k.isPlayer && this.player.pos.distanceTo(k.pos) < 80) audio.lap(false);
            break;
        }
      }
      k.events.length = 0;
    }
  }

  _continuousEffects(dt) {
    // drift sparks + star sparkles
    for (const k of this.karts) {
      if (k.driftActive && k.grounded && Math.abs(k.speed) > 10) {
        const back = k.pos.clone().addScaledVector(k.forward, -1.1);
        back.y += 0.25;
        const side = new THREE.Vector3(Math.cos(k.heading), 0, -Math.sin(k.heading));
        for (const sgn of [1, -1]) {
          this.particles.burst({
            pos: back.clone().addScaledVector(side, sgn * 0.8),
            count: 2, dir: k.forward.clone().negate().add(new THREE.Vector3(0, 0.3, 0)),
            speed: 5, spread: 2.5, size: 1.1, life: 0.28,
            color: DRIFT_COLORS[k.driftTier], gravity: 4,
          });
        }
      }
      if (k.starTimer > 0 && Math.random() < 0.5) {
        this.particles.burst({
          pos: k.pos.clone().add(new THREE.Vector3(0, 1, 0)), count: 2, speed: 2,
          spread: 3, size: 1.6, life: 0.5,
          colors: [0xffe14a, 0xff7ce0, 0x7cf7ff, 0xffffff], gravity: -1,
        });
      }
      if (k.boostTimer > 0) {
        this.particles.burst({
          pos: k.pos.clone().addScaledVector(k.forward, -1.5).add(new THREE.Vector3(0, 0.5, 0)),
          count: 1, dir: k.forward.clone().negate(), speed: 7, spread: 1.6,
          size: 1.7, life: 0.3, colors: [0xffb060, 0xff6030],
        });
      }
    }
  }

  buildStandings() {
    const sorted = this.computeRanks();
    const goal = this.laps * this.track.length;
    return sorted.map((k) => {
      // karts still on track get a projected finish time (true stragglers DNF)
      const remaining = goal - k.raceDist;
      const projected = !k.finished && remaining < 400
        ? this.raceTime + remaining / 22 : null;
      return {
        name: k.name,
        color: k.character.color,
        isPlayer: k.isPlayer,
        finished: k.finished || projected != null,
        time: k.finished ? k.finishTime : projected,
      };
    });
  }

  dispose() {
    for (const h of this.hazards) {
      this.scene.remove(h.group);
      for (const d of h.disposables) d.dispose?.();
    }
  }
}

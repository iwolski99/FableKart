// Arcade kart physics: forward-speed + heading model with a lagging velocity
// direction for slide, MK-style hold-to-drift with tiered mini-turbos,
// boosts, spin-outs, shrink/star/shield status, wall + respawn handling.
import * as THREE from 'three';
import { clamp, lerp, dampFactor } from '../core/rng.js';

const TWO_PI = Math.PI * 2;

function wrapAngle(a) {
  a = a % TWO_PI;
  if (a < -Math.PI) a += TWO_PI;
  if (a >= Math.PI) a -= TWO_PI;
  return a;
}

export const DRIFT_TIER_TIMES = [1.0, 2.25];

export class Kart {
  constructor({ character, track, isPlayer = false, name }) {
    this.character = character;
    this.track = track;
    this.isPlayer = isPlayer;
    this.name = name ?? character.name;

    // stat mapping
    const st = character;
    this.maxSpeed = 34 + 7 * st.speed;
    this.accelRate = 15 + 13 * st.accel;
    this.steerRate = 1.75 + 1.0 * st.handling;
    this.mass = 1 + 1.2 * st.weight;
    this.radius = 1.15;

    // pose / motion
    this.pos = new THREE.Vector3();
    this.heading = 0;      // yaw, forward = (sin h, 0, cos h)
    this.velDir = 0;       // direction the kart actually travels
    this.speed = 0;        // signed forward speed (m/s)
    this.vy = 0;
    this.airborne = false;
    this.grounded = true;
    this.surface = 'road';

    // control set by a controller each frame
    this.control = { throttle: 0, brake: false, steer: 0, drift: false, useItem: false };

    // drift
    this.driftActive = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftTier = 0;

    // status
    this.boostTimer = 0;
    this.boostMult = 1;
    this.spinTimer = 0;
    this.shrinkTimer = 0;
    this.starTimer = 0;
    this.shieldTimer = 0;
    this.invulnTimer = 0;
    this.stunGrace = 0;    // brief protection after any hit
    this.visScale = 1;

    // items
    this.item = null;
    this.pendingItem = null;
    this.rouletteT = 0;
    this.lateral = 0;
    this._padCooldown = 0;

    // progress
    this.s = 0;
    this.raceDist = 0;
    this.lap = 0;
    this.hintIdx = -1;
    this.hintIdxShort = -1;
    this.rank = 1;
    this.finished = false;
    this.finishTime = 0;
    this.wrongWayTimer = 0;
    this.aiSpeedScale = 1; // rubber-band, set by race for AI

    this.events = [];
    this.controller = null;
    this.visual = null;    // set by race: result of buildKartMesh
    this._spinYaw = 0;
    this._slopePitch = 0;
    this._lean = 0;
  }

  emit(type, data) { this.events.push({ type, ...data }); }

  placeAtStart(slot) {
    const p = this.track.startPlacement(slot);
    this.pos.copy(p.pos);
    this.heading = p.heading;
    this.velDir = p.heading;
    this.s = p.s;
    this.hintIdx = -1;
    this.hintIdxShort = -1;
    this.raceDist = p.s - this.track.length; // negative: behind the line
    this.lap = 0;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get isProtected() { return this.starTimer > 0 || this.invulnTimer > 0 || this.stunGrace > 0; }

  // ---------------- status appliers ----------------

  applyBoost(mult, dur, kind = 'boost') {
    this.boostMult = Math.max(this.boostMult, mult);
    this.boostTimer = Math.max(this.boostTimer, dur);
    this.speed = Math.max(this.speed, this.maxSpeed * 0.75);
    this.emit('boost', { kind });
  }

  applySpin(cause = 'hit') {
    if (this.starTimer > 0 || this.invulnTimer > 0 || this.stunGrace > 0) return false;
    if (this.shieldTimer > 0) {
      this.shieldTimer = 0;
      this.stunGrace = 0.8;
      this.emit('shieldBlock');
      return false;
    }
    this.spinTimer = 1.15;
    this.stunGrace = 1.9;
    this.speed *= 0.4;
    this.driftActive = false;
    this.driftCharge = 0;
    this.emit('spin', { cause });
    return true;
  }

  applyShrink() {
    if (this.starTimer > 0) return false;
    if (this.shieldTimer > 0) { this.shieldTimer = 0; this.emit('shieldBlock'); return false; }
    this.shrinkTimer = 4.5;
    this.speed *= 0.55;
    this.emit('shrink');
    return true;
  }

  applyStar() {
    this.starTimer = 6.5;
    this.shrinkTimer = 0;
    this.emit('star');
  }

  applyShield() {
    this.shieldTimer = 9;
    this.emit('shield');
  }

  respawn() {
    const smp = this.track.sampleAt(this.s);
    this.pos.copy(smp.pos);
    this.pos.y += 0.4;
    this.heading = Math.atan2(smp.tan.x, smp.tan.z);
    this.velDir = this.heading;
    this.speed = 0;
    this.vy = 0;
    this.driftActive = false;
    this.driftCharge = 0;
    this.invulnTimer = 1.8;
    this.emit('respawn');
  }

  // ---------------- main update ----------------

  update(dt) {
    const c = this.control;
    const track = this.track;

    // timers
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.boostTimer === 0) this.boostMult = 1;
    this.spinTimer = Math.max(0, this.spinTimer - dt);
    this.shrinkTimer = Math.max(0, this.shrinkTimer - dt);
    this.starTimer = Math.max(0, this.starTimer - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.stunGrace = Math.max(0, this.stunGrace - dt);
    if (this.rouletteT > 0) this.rouletteT = Math.max(0, this.rouletteT - dt);

    const spinning = this.spinTimer > 0;
    const steer = spinning ? 0 : clamp(c.steer, -1, 1);
    const throttle = spinning ? 0 : (c.throttle > 0 ? 1 : 0);

    // ---------- surface / target speed ----------
    let surfMult = 1;
    if (this.surface === 'dirt') surfMult = 0.94;
    else if (this.surface === 'grass') surfMult = (this.boostTimer > 0 || this.starTimer > 0) ? 0.95 : 0.5;

    const statusMult = (this.starTimer > 0 ? 1.22 : 1) * (this.shrinkTimer > 0 ? 0.62 : 1);
    const topSpeed = this.maxSpeed * surfMult * statusMult * this.boostMult * this.aiSpeedScale;

    // ---------- longitudinal ----------
    if (spinning) {
      this.speed *= Math.pow(0.14, dt);
    } else if (c.brake && this.speed > 0.6) {
      this.speed = Math.max(0, this.speed - 36 * dt);
    } else if (c.brake) {
      // reverse
      this.speed = Math.max(-10, this.speed - 14 * dt);
    } else if (throttle > 0) {
      const accel = this.accelRate * (this.surface === 'grass' ? 0.55 : 1);
      if (this.speed < topSpeed) {
        this.speed = Math.min(topSpeed, this.speed + accel * dt);
      } else {
        this.speed = Math.max(topSpeed, this.speed - 18 * dt); // over top speed (boost fade)
      }
    } else {
      this.speed = this.speed > 0 ? Math.max(0, this.speed - 9 * dt) : Math.min(0, this.speed + 9 * dt);
    }

    // ---------- drift state machine ----------
    const speedFactor = clamp(Math.abs(this.speed) / 7, 0, 1);
    let steerEff = this.steerRate * speedFactor / (1 + Math.abs(this.speed) * 0.011);
    if (!this.grounded) steerEff *= 0.3;

    if (!this.driftActive) {
      if (c.drift && this.grounded && !spinning && this.speed > 13 && Math.abs(steer) > 0.15) {
        this.driftActive = true;
        this.driftDir = Math.sign(steer);
        this.driftCharge = 0;
        this.driftTier = 0;
        this.vy = 2.5; // hop
        this.pos.y += 0.06;
        this.grounded = false;
        this.emit('driftStart');
      }
    }

    if (this.driftActive) {
      const into = steer * this.driftDir; // 1 = tight, -1 = shallow
      const turn = this.driftDir * steerEff * (0.8 + 0.4 * into);
      this.heading += turn * dt;
      if (this.grounded) {
        this.driftCharge += dt * (1.05 + 0.85 * Math.abs(steer));
        const newTier = this.driftCharge >= DRIFT_TIER_TIMES[1] ? 2
          : this.driftCharge >= DRIFT_TIER_TIMES[0] ? 1 : 0;
        if (newTier !== this.driftTier) {
          this.driftTier = newTier;
          this.emit('driftTier', { tier: newTier });
        }
      }
      const end = !c.drift || this.speed < 9 || spinning;
      if (end) {
        if (this.driftTier === 1) this.applyBoost(1.28, 0.9, 'mini');
        else if (this.driftTier === 2) this.applyBoost(1.36, 1.55, 'turbo');
        this.driftActive = false;
        this.driftCharge = 0;
        this.driftTier = 0;
      }
    } else {
      this.heading += steer * steerEff * dt * (this.speed >= 0 ? 1 : -1);
    }
    this.heading = wrapAngle(this.heading);

    // velocity direction lags heading → slide
    const gripRate = this.driftActive ? 3.1 : (this.grounded ? 8.5 : 1.4);
    const targetVelDir = this.driftActive ? this.heading - this.driftDir * 0.24 : this.heading;
    this.velDir += wrapAngle(targetVelDir - this.velDir) * dampFactor(gripRate, dt);
    this.velDir = wrapAngle(this.velDir);

    // ---------- integrate ----------
    this.pos.x += Math.sin(this.velDir) * this.speed * dt;
    this.pos.z += Math.cos(this.velDir) * this.speed * dt;
    this.vy -= 26 * dt;
    this.pos.y += this.vy * dt;

    // ---------- ground / surfaces / walls ----------
    const gi = track.groundInfo(this.pos.x, this.pos.z, this.hintIdx, this.hintIdxShort);
    this.hintIdx = gi.main.index;
    this.hintIdxShort = gi.sc?.index ?? this.hintIdxShort;
    this.surface = gi.surface;
    this.lateral = gi.main.lateral;

    // wall collision (walls sit just past the curb)
    const latAbs = Math.abs(gi.main.lateral);
    const wallHere = gi.main.lateral > 0 ? gi.wallL : gi.wallR;
    const wallLimit = track.halfWidth + 0.7;
    if (wallHere && latAbs > wallLimit && latAbs < track.halfWidth + 6) {
      const sgn = Math.sign(gi.main.lateral);
      // pull back inside
      this.pos.x -= gi.main.left.x * (latAbs - wallLimit) * sgn;
      this.pos.z -= gi.main.left.z * (latAbs - wallLimit) * sgn;
      // reflect velocity off the wall plane
      const vx = Math.sin(this.velDir) * this.speed;
      const vz = Math.cos(this.velDir) * this.speed;
      const nx = -gi.main.left.x * sgn, nz = -gi.main.left.z * sgn;
      const vn = vx * nx + vz * nz;
      if (vn < 0) {
        const rx = vx - 1.7 * vn * nx;
        const rz = vz - 1.7 * vn * nz;
        const newSpeed = Math.hypot(rx, rz);
        const hard = -vn > 8;
        this.speed = Math.max(0, newSpeed * (hard ? 0.72 : 0.9)) * Math.sign(this.speed || 1);
        if (Math.abs(this.speed) > 0.5) {
          this.velDir = Math.atan2(rx, rz);
          this.heading += wrapAngle(this.velDir - this.heading) * 0.45;
        }
        this.emit('wall', { impact: -vn });
      }
    }

    // ground snap / airborne
    const groundY = gi.y;
    if (this.pos.y <= groundY + 0.02) {
      if (!this.grounded && this.vy < -7) this.emit('land', { hard: this.vy < -12 });
      this.pos.y = groundY;
      this.vy = Math.max(0, this.vy);
      if (this.vy === 0) this.grounded = true;
      else this.grounded = false; // hop frame
    } else {
      this.grounded = this.pos.y - groundY < 0.09;
      if (!this.grounded) this.airborne = true;
    }
    if (this.grounded) this.airborne = false;

    // boost pad
    if (gi.onPad && this.grounded && this._padCooldown <= 0) {
      this.applyBoost(1.45, 1.15, 'pad');
      this._padCooldown = 0.9;
    }
    this._padCooldown = (this._padCooldown ?? 0) - dt;

    // ---------- lap progress ----------
    const L = track.length;
    let ds = gi.main.s - this.s;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    if (Math.abs(ds) < 40) {
      const before = this.raceDist;
      this.raceDist += ds;
      const lapBefore = Math.floor(before / L);
      const lapAfter = Math.floor(this.raceDist / L);
      if (lapAfter > lapBefore && lapAfter > this.lap - 1) {
        this.lap = lapAfter;
        this.emit('lap', { lap: this.lap });
      }
    }
    this.s = gi.main.s;

    // wrong way
    const fwd = this.forward;
    const along = fwd.x * gi.main.tan.x + fwd.z * gi.main.tan.z;
    if (along < -0.25 && this.speed > 4 && !this.finished) this.wrongWayTimer += dt;
    else this.wrongWayTimer = 0;

    // ---------- respawn conditions ----------
    if (this.pos.y < -25 || latAbs - track.halfWidth > 55) this.respawn();

    // shrink scale animation
    const targetScale = this.shrinkTimer > 0 ? 0.55 : 1;
    this.visScale = lerp(this.visScale, targetScale, dampFactor(8, dt));
  }

  // ---------------- visuals ----------------

  updateVisuals(dt, time) {
    const v = this.visual;
    if (!v) return;
    v.group.position.copy(this.pos);

    // spin-out yaw animation
    if (this.spinTimer > 0) {
      this._spinYaw = (1.15 - this.spinTimer) / 1.15 * TWO_PI * 2;
    } else this._spinYaw = 0;

    const driftYaw = this.driftActive ? this.driftDir * 0.14 : 0;
    v.group.rotation.y = this.heading + this._spinYaw + driftYaw;

    // slope pitch from track tangent
    const smp = this.track.sampleAt(this.s);
    const targetPitch = -Math.asin(clamp(smp.tan.y, -0.6, 0.6));
    this._slopePitch = lerp(this._slopePitch, this.grounded ? targetPitch : this._slopePitch, dampFactor(6, dt));
    v.body.rotation.x = this._slopePitch;

    // lean/roll
    const targetLean = (this.driftActive ? this.driftDir * 0.16 : 0) + this.control.steer * 0.07 * clamp(this.speed / 20, 0, 1);
    this._lean = lerp(this._lean, targetLean, dampFactor(7, dt));
    v.body.rotation.z = -this._lean;

    v.group.scale.setScalar(this.visScale);

    // wheels
    const spinRate = this.speed / 0.34;
    for (const w of v.wheels) {
      w.spin.rotation.x += spinRate * dt;
      if (w.front) w.pivot.rotation.y = this.control.steer * 0.4;
    }

    // flames when boosting / starring
    const flaming = this.boostTimer > 0 || this.starTimer > 0;
    for (const f of v.flames) {
      f.visible = flaming;
      if (flaming) {
        const s = 0.8 + Math.random() * 0.7;
        f.scale.set(s, 1 + Math.random() * 0.9, s);
      }
    }

    // shield
    v.shield.visible = this.shieldTimer > 0;
    if (v.shield.visible) {
      v.shieldMat.opacity = 0.16 + 0.1 * Math.sin(time * 9) + (this.shieldTimer < 1.5 ? 0.1 * Math.sin(time * 30) : 0);
    }

    // star rainbow tint
    if (this.starTimer > 0) {
      const hue = (time * 1.6) % 1;
      for (const { m } of v.coloredMats) {
        m.emissive.setHSL(hue, 0.9, 0.55);
        m.emissiveIntensity = 0.85;
      }
    } else if (this.invulnTimer > 0) {
      const blink = Math.sin(time * 26) > 0 ? 0.45 : 0;
      for (const { m } of v.coloredMats) {
        m.emissive.setRGB(1, 1, 1);
        m.emissiveIntensity = blink;
      }
    } else {
      for (const { m } of v.coloredMats) m.emissiveIntensity = 0;
    }
  }
}

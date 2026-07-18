// AI driver: follows the racing line with a personal lane offset, cuts
// corner apexes, brakes for tight turns, drifts long corners, uses items,
// and optionally takes the shortcut. Rubber-band speed scaling is applied
// by the race manager via kart.aiSpeedScale.
import { clamp, angleDiff } from '../core/rng.js';

export class AIController {
  constructor(kart, track, opts = {}) {
    this.kart = kart;
    this.track = track;
    this.isPlayer = false;
    this.skill = opts.skill ?? 0.7;              // 0..1
    this.laneBias = opts.laneBias ?? 0;          // -1..1 preferred side
    this.usesShortcut = opts.usesShortcut ?? (Math.random() < 0.55);
    this.wobblePhase = Math.random() * 10;
    this.itemTimer = 0;
    this.stuckTimer = 0;
    this.stuckRespawns = 0;
    this.shortcutCooldown = 0;
    this.shortcutHint = -1;
    this.driftHold = 0;
    this.onShortcut = false;
    this.finishedCruise = false;
  }

  update(dt, race) {
    const k = this.kart;
    const t = this.track;
    const c = k.control;
    const time = race.time;

    // ----- stuck watchdog -----
    this.shortcutCooldown = Math.max(0, this.shortcutCooldown - dt);
    if (race.state === 'racing' && !k.finished && Math.abs(k.speed) < 3.5 && k.spinTimer <= 0) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.2) {
        // respawn a nudge ahead so we don't reappear in the same trap; if it
        // keeps happening, stop trying to be clever about the shortcut
        this.stuckRespawns++;
        if (this.stuckRespawns >= 2) this.usesShortcut = false;
        this.onShortcut = false;
        k.s = (k.s + 10) % this.track.length;
        k.respawn();
        this.stuckTimer = 0;
      }
    } else this.stuckTimer = 0;

    // ----- pick a target point -----
    const lookahead = clamp(Math.abs(k.speed) * 0.55, 10, 30);
    let target;

    const sc = t.shortcut;
    if (sc && this.usesShortcut && !this.onShortcut && !k.finished && this.shortcutCooldown <= 0) {
      // near the entry and on the road → commit to the shortcut
      let dEntry = sc.entryS - k.s;
      if (dEntry < -t.length / 2) dEntry += t.length;
      if (dEntry > 0 && dEntry < 26 && k.surface !== 'grass') this.onShortcut = true;
    }
    if (this.onShortcut && sc) {
      const proj = t.nearestOnShortcut(k.pos.x, k.pos.z, this.shortcutHint);
      this.shortcutHint = proj.index;
      const targetS = proj.s + lookahead;
      if (targetS >= sc.length * 0.96 || proj.dist > 24) {
        // done (or lost it) — don't immediately re-commit and ping-pong
        this.onShortcut = false;
        this.shortcutCooldown = 12;
        this.shortcutHint = -1;
      } else {
        const idx = clamp(Math.round(targetS / sc.spacing), 0, sc.n - 1);
        target = sc.samples[idx].pos;
      }
    }
    if (!target) {
      const ahead = t.sampleAt(k.s + lookahead);
      // lane offset: personal bias + slow wander + apex cut toward the inside
      const wander = Math.sin(time * 0.35 + this.wobblePhase) * 0.35;
      const curve = t.maxCurvAhead(k.s, lookahead + 12);
      const apex = clamp(curve * 260, -1, 1); // +curv = left turn → inside is left
      let lane = clamp(this.laneBias * 0.4 + wander + apex * 0.8, -1, 1);
      target = ahead.pos.clone().addScaledVector(ahead.left, lane * (t.halfWidth - 2.4));
    }

    // ----- steering -----
    const desired = Math.atan2(target.x - k.pos.x, target.z - k.pos.z);
    const diff = angleDiff(k.heading, desired);
    const noise = (1 - this.skill) * Math.sin(time * 2.2 + this.wobblePhase) * 0.08;
    c.steer = clamp(diff * 2.4 + noise, -1, 1);

    // ----- throttle / brake for corners -----
    c.throttle = 1;
    c.brake = false;
    const curvAhead = Math.abs(t.maxCurvAhead(k.s, Math.abs(k.speed) * 0.9 + 8));
    if (curvAhead > 1e-4) {
      const latGrip = 21 + this.skill * 14;
      const cornerSpeed = Math.sqrt(latGrip / curvAhead);
      if (k.speed > cornerSpeed * 1.18) { c.brake = true; c.throttle = 0; }
      else if (k.speed > cornerSpeed * 1.04) c.throttle = 0.0;
    }
    if (Math.abs(diff) > 1.15) { c.throttle = 0; c.brake = k.speed > 12; }

    // ----- drifting -----
    if (!k.driftActive) {
      const wantDrift = this.skill > 0.35 && k.speed > 19 && Math.abs(c.steer) > 0.6
        && curvAhead > 0.012 && k.grounded && !this.onShortcut;
      if (wantDrift) { c.drift = true; this.driftHold = 0.4; }
      else c.drift = false;
    } else {
      // hold the drift while the corner lasts
      this.driftHold -= dt;
      const stillTurning = Math.abs(c.steer) > 0.25 && curvAhead > 0.008;
      if (stillTurning) this.driftHold = 0.3;
      c.drift = this.driftHold > 0 && k.speed > 14;
    }

    // ----- items -----
    c.useItem = false;
    if (k.item && k.rouletteT <= 0 && race.state === 'racing') {
      this.itemTimer += dt;
      const fire = this._shouldUseItem(race);
      if (fire || this.itemTimer > 6.5) {
        c.useItem = true;
        this.itemTimer = 0;
      }
    }
  }

  _shouldUseItem(race) {
    const k = this.kart;
    if (this.itemTimer < 1.2) return false;
    switch (k.item) {
      case 'boost':
        return Math.abs(this.track.maxCurvAhead(k.s, 40)) < 0.012 && k.surface === 'road';
      case 'rocket': {
        // someone ahead within range?
        return race.karts.some((o) => o !== k && !o.finished &&
          o.raceDist > k.raceDist && o.raceDist - k.raceDist < 110);
      }
      case 'mine':
        return race.karts.some((o) => o !== k &&
          k.raceDist > o.raceDist && k.raceDist - o.raceDist < 30);
      case 'star':
      case 'shield':
        return true;
      case 'bolt':
        return k.rank > 3;
      default:
        return true;
    }
  }
}

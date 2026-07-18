// Chase camera with smoothing, boost FOV kick, drift offset, shake, and an
// orbit mode for the post-finish victory lap.
import * as THREE from 'three';
import { clamp, lerp, dampFactor } from '../core/rng.js';

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shakeMag = 0;
    this.fovKick = 0;
    this.orbitAngle = 0;
    this.initialized = false;
  }

  setMode(m) { this.mode = m; }
  shake(mag) { this.shakeMag = Math.max(this.shakeMag, mag); }
  kick() { this.fovKick = Math.max(this.fovKick, 1); }

  snapTo(kart) {
    this._computeChaseTarget(kart);
    this.pos.copy(this._targetPos);
    this.look.copy(this._targetLook);
    this.initialized = true;
    this._apply();
  }

  _computeChaseTarget(kart) {
    const fwd = new THREE.Vector3(Math.sin(kart.heading), 0, Math.cos(kart.heading));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const speedT = clamp(Math.abs(kart.speed) / kart.maxSpeed, 0, 1.3);
    const dist = 6.4 + speedT * 1.6;
    const height = 3.1 + speedT * 0.4;
    const driftOff = kart.driftActive ? kart.driftDir * 1.1 : 0;
    this._targetPos = kart.pos.clone()
      .addScaledVector(fwd, -dist)
      .addScaledVector(side, -driftOff)
      .add(new THREE.Vector3(0, height, 0));
    this._targetLook = kart.pos.clone()
      .addScaledVector(fwd, 5.5)
      .add(new THREE.Vector3(0, 1.1, 0));
  }

  update(dt, kart, race) {
    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.55;
      const r = 9;
      this._targetPos = kart.pos.clone().add(new THREE.Vector3(
        Math.sin(this.orbitAngle) * r, 4.2, Math.cos(this.orbitAngle) * r));
      this._targetLook = kart.pos.clone().add(new THREE.Vector3(0, 1, 0));
    } else if (race && race.state === 'countdown') {
      // low hero shot that pulls back as the countdown runs
      const fwd = new THREE.Vector3(Math.sin(kart.heading), 0, Math.cos(kart.heading));
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const t = clamp(race.countdownT / 4.4, 0, 1);
      this._targetPos = kart.pos.clone()
        .addScaledVector(fwd, 4.5 - (1 - t) * 10)
        .addScaledVector(side, 2.6 * t)
        .add(new THREE.Vector3(0, 1.6 + (1 - t) * 1.6, 0));
      this._targetLook = kart.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(fwd, 2);
    } else {
      this._computeChaseTarget(kart);
    }

    if (!this.initialized) {
      this.pos.copy(this._targetPos);
      this.look.copy(this._targetLook);
      this.initialized = true;
    } else {
      const rate = this.mode === 'orbit' ? 3.5 : 7.5;
      this.pos.lerp(this._targetPos, dampFactor(rate, dt));
      this.look.lerp(this._targetLook, dampFactor(11, dt));
    }

    // keep the camera above the ground
    if (race) {
      const gi = race.track.groundInfo(this.pos.x, this.pos.z, -1);
      if (this.pos.y < gi.y + 0.8) this.pos.y = gi.y + 0.8;
    }

    // shake decay
    this.shakeMag = Math.max(0, this.shakeMag - dt * 2.2);
    this.fovKick = Math.max(0, this.fovKick - dt * 1.6);

    this._apply(kart);
  }

  _apply(kart) {
    const shake = this.shakeMag;
    const jitter = new THREE.Vector3(
      (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.6,
      (Math.random() - 0.5) * shake);
    this.camera.position.copy(this.pos).add(jitter);
    this.camera.lookAt(this.look);
    const boosting = kart && (kart.boostTimer > 0 || kart.starTimer > 0);
    const targetFov = 72 + (boosting ? 11 : 0) + this.fovKick * 5;
    this.camera.fov = lerp(this.camera.fov, targetFov, 0.12);
    this.camera.updateProjectionMatrix();
  }
}

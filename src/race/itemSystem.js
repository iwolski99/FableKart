// Item boxes, the six items, and live projectiles (rockets / mines).
//
//   boost  — instant mushroom-style speed burst
//   rocket — track-following homing missile (hits the next kart ahead)
//   mine   — armed spike ball dropped behind the kart
//   star   — temporary invincibility + speed
//   bolt   — lightning: shrinks & slows everyone ahead of the user
//   shield — bubble that absorbs the next hit
import * as THREE from 'three';
import { clamp } from '../core/rng.js';
import { makeItemBoxTexture } from '../render/textures.js';

const ROCKET_SPEED = 58;

export class ItemSystem {
  constructor(scene, track, particles) {
    this.scene = scene;
    this.track = track;
    this.particles = particles;
    this.rockets = [];
    this.mines = [];
    this.disposables = [];

    // ---- item boxes ----
    this.boxGeo = new THREE.BoxGeometry(1.35, 1.35, 1.35);
    this.boxMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      roughness: 0.15, metalness: 0.3, emissive: 0x3355ff, emissiveIntensity: 0.6,
    });
    const qTex = makeItemBoxTexture();
    this.qMat = new THREE.SpriteMaterial({ map: qTex, depthWrite: false });
    this.disposables.push(this.boxGeo, this.boxMat, this.qMat, qTex);

    this.boxes = track.itemBoxSpots.map((spot) => {
      const group = new THREE.Group();
      const cube = new THREE.Mesh(this.boxGeo, this.boxMat);
      cube.castShadow = true;
      const q = new THREE.Sprite(this.qMat);
      q.scale.set(1.0, 1.0, 1);
      group.add(cube, q);
      group.position.copy(spot.pos);
      group.position.y += 1.15;
      scene.add(group);
      return { group, cube, basePos: group.position.clone(), respawnT: 0, phase: Math.random() * 6 };
    });

    // ---- projectile meshes ----
    this.rocketGeo = new THREE.ConeGeometry(0.3, 1.25, 10);
    this.rocketGeo.rotateX(Math.PI / 2); // point +z
    this.rocketMat = new THREE.MeshStandardMaterial({
      color: 0xe84545, emissive: 0xff5030, emissiveIntensity: 0.9, roughness: 0.4,
    });
    this.mineGeo = new THREE.IcosahedronGeometry(0.46, 0);
    this.mineMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3d, roughness: 0.6, flatShading: true });
    this.mineLightGeo = new THREE.SphereGeometry(0.14, 8, 6);
    this.mineLightMat = new THREE.MeshStandardMaterial({ emissive: 0xff3030, emissiveIntensity: 2, color: 0x220000 });
    this.disposables.push(this.rocketGeo, this.rocketMat, this.mineGeo, this.mineMat,
      this.mineLightGeo, this.mineLightMat);
  }

  /** Position-weighted random item. rank is 1-based, total = field size. */
  rollItem(rank, total) {
    const r = total > 1 ? (rank - 1) / (total - 1) : 0;
    const weights = [
      ['boost', 1.1 + 1.7 * r],
      ['rocket', 0.5 + 1.9 * r],
      ['mine', 1.4 - 0.9 * r],
      ['shield', 1.2 - 0.4 * r],
      ['star', 0.12 + 2.4 * r * r],
      ['bolt', 0.08 + 2.0 * r * r * r],
    ];
    let sum = 0;
    for (const [, w] of weights) sum += w;
    let pick = Math.random() * sum;
    for (const [item, w] of weights) {
      pick -= w;
      if (pick <= 0) return item;
    }
    return 'boost';
  }

  /** Called when a kart touches an active box. */
  grantItem(kart, rank, total) {
    kart.pendingItem = this.rollItem(rank, total);
    kart.rouletteT = 1.0;
    kart.emit('pickup');
  }

  useItem(kart, race) {
    const item = kart.item;
    if (!item) return;
    kart.item = null;
    kart.emit('useItem', { item });
    switch (item) {
      case 'boost':
        kart.applyBoost(1.5, 1.35, 'mushroom');
        break;
      case 'rocket':
        this._spawnRocket(kart);
        break;
      case 'mine':
        this._spawnMine(kart);
        break;
      case 'star':
        kart.applyStar();
        break;
      case 'shield':
        kart.applyShield();
        break;
      case 'bolt': {
        for (const o of race.karts) {
          if (o === kart || o.finished) continue;
          if (o.raceDist > kart.raceDist) o.applyShrink();
        }
        race.onBolt(kart);
        break;
      }
    }
  }

  _spawnRocket(kart) {
    const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
    this.scene.add(mesh);
    this.rockets.push({
      s: kart.s + 3.5,
      lat: clamp(kart.lateral ?? 0, -this.track.halfWidth + 1, this.track.halfWidth - 1),
      owner: kart,
      life: 6.5,
      mesh,
    });
    kart.emit('rocketFire');
  }

  _spawnMine(kart) {
    const fwd = kart.forward;
    const x = kart.pos.x - fwd.x * 2.7;
    const z = kart.pos.z - fwd.z * 2.7;
    const gi = this.track.groundInfo(x, z, kart.hintIdx);
    const group = new THREE.Group();
    const ball = new THREE.Mesh(this.mineGeo, this.mineMat);
    ball.castShadow = true;
    const light = new THREE.Mesh(this.mineLightGeo, this.mineLightMat);
    light.position.y = 0.4;
    group.add(ball, light);
    group.position.set(x, gi.y + 0.42, z);
    this.scene.add(group);
    this.mines.push({ pos: group.position, owner: kart, armT: 0.8, ownerGrace: 1.2, mesh: group, light });
    if (this.mines.length > 14) this._removeMine(0, false);
    kart.emit('mineDrop');
  }

  _removeMine(i, boom = true) {
    const m = this.mines[i];
    if (boom) {
      this.particles.burst({
        pos: m.pos, count: 26, speed: 7, spread: 9, size: 2.4, life: 0.55,
        colors: [0xff9d2e, 0xff5030, 0xffe14a], gravity: 8,
      });
    }
    this.scene.remove(m.mesh);
    this.mines.splice(i, 1);
  }

  _removeRocket(i, boom = true) {
    const r = this.rockets[i];
    if (boom) {
      this.particles.burst({
        pos: r.mesh.position, count: 30, speed: 8, spread: 10, size: 2.6, life: 0.6,
        colors: [0xff9d2e, 0xff5030, 0xffffff], gravity: 6,
      });
    }
    this.scene.remove(r.mesh);
    this.rockets.splice(i, 1);
  }

  update(dt, karts, race, time) {
    const track = this.track;

    // ---- boxes: spin, bob, respawn, pickups ----
    for (const b of this.boxes) {
      if (b.respawnT > 0) {
        b.respawnT -= dt;
        const grow = clamp(1 - b.respawnT / 0.4, 0, 1); // pop back in the last 0.4s
        b.group.visible = b.respawnT < 0.4;
        b.group.scale.setScalar(Math.max(0.001, grow));
        if (b.respawnT > 0.4) continue;
      } else {
        b.group.visible = true;
        b.group.scale.setScalar(1);
      }
      b.cube.rotation.y = time * 1.4 + b.phase;
      b.cube.rotation.x = time * 0.9 + b.phase;
      b.group.position.y = b.basePos.y + Math.sin(time * 2 + b.phase) * 0.12;
      this.boxMat.emissive.setHSL((time * 0.12 + b.phase * 0.05) % 1, 0.8, 0.5);

      if (b.respawnT <= 0) {
        for (const k of karts) {
          if (k.finished || k.item || k.pendingItem || k.rouletteT > 0) continue;
          const dx = k.pos.x - b.group.position.x;
          const dz = k.pos.z - b.group.position.z;
          const dy = Math.abs(k.pos.y + 0.8 - b.group.position.y);
          if (dx * dx + dz * dz < 3.6 && dy < 2.4) {
            b.respawnT = 3.5;
            this.grantItem(k, k.rank, karts.length);
            this.particles.burst({
              pos: b.group.position, count: 14, speed: 4, spread: 5, size: 1.6,
              life: 0.5, colors: [0x7cf7ff, 0xffe14a, 0xff7ce0], gravity: 3,
            });
            break;
          }
        }
      }
    }

    // ---- pending item lands after roulette ----
    for (const k of karts) {
      if (k.pendingItem && k.rouletteT <= 0) {
        k.item = k.pendingItem;
        k.pendingItem = null;
        k.emit('itemLand');
      }
    }

    // ---- rockets ----
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      if (r.life <= 0) { this._removeRocket(i); continue; }
      r.s = (r.s + ROCKET_SPEED * dt) % track.length;

      // home toward the nearest kart ahead on the track
      let target = null, bestAhead = Infinity;
      for (const k of karts) {
        if (k === r.owner || k.finished) continue;
        let ahead = k.s - r.s;
        if (ahead < -track.length / 2) ahead += track.length;
        if (ahead < 0 && ahead > -track.length / 2) continue;
        if (ahead >= 0 && ahead < bestAhead && ahead < 130) { bestAhead = ahead; target = k; }
      }
      if (target) {
        const tl = clamp(target.lateral ?? 0, -track.halfWidth + 0.8, track.halfWidth - 0.8);
        r.lat += (tl - r.lat) * Math.min(1, 3.2 * dt);
      } else {
        r.lat += (0 - r.lat) * Math.min(1, 1.5 * dt);
      }

      const smp = track.sampleAt(r.s);
      r.mesh.position.copy(smp.pos)
        .addScaledVector(smp.left, r.lat)
        .add(new THREE.Vector3(0, 0.75, 0));
      r.mesh.rotation.y = Math.atan2(smp.tan.x, smp.tan.z);

      // exhaust trail
      this.particles.burst({
        pos: r.mesh.position, count: 2, speed: 1, spread: 1.2, size: 1.3,
        life: 0.3, colors: [0xffb060, 0xff6030], gravity: -1,
      });

      // hit check
      let hit = false;
      for (const k of karts) {
        if (k === r.owner || k.finished) continue;
        if (k.pos.distanceToSquared(r.mesh.position) < 3.6) {
          k.applySpin('rocket');
          k.emit('rocketHit');
          hit = true;
          break;
        }
      }
      if (hit) this._removeRocket(i);
    }

    // ---- mines ----
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.armT -= dt;
      m.ownerGrace -= dt;
      m.light.material.emissiveIntensity = m.armT > 0 ? 0.6 : 1.6 + Math.sin(time * 12) * 1.2;
      let exploded = false;
      for (const k of karts) {
        if (k.finished) continue;
        if (k === m.owner && m.ownerGrace > 0) continue;
        if (m.armT > 0) continue;
        const dx = k.pos.x - m.pos.x, dz = k.pos.z - m.pos.z;
        if (dx * dx + dz * dz < 2.9 && Math.abs(k.pos.y - m.pos.y) < 2.4) {
          k.applySpin('mine');
          k.emit('mineHit');
          exploded = true;
          break;
        }
      }
      if (exploded) this._removeMine(i);
    }
  }

  dispose() {
    for (const b of this.boxes) this.scene.remove(b.group);
    for (let i = this.rockets.length - 1; i >= 0; i--) this._removeRocket(i, false);
    for (let i = this.mines.length - 1; i >= 0; i--) this._removeMine(i, false);
    for (const d of this.disposables) d.dispose?.();
  }
}

// Pooled GPU point-sprite particles with per-particle size/color/alpha.
// One additive system covers sparks, flames, explosions and sparkles.
import * as THREE from 'three';
import { makeParticleTexture } from './textures.js';

const VERT = /* glsl */`
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D map;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

const MAX = 3200;

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.count = 0;
    // struct-of-arrays CPU state
    this.px = new Float32Array(MAX); this.py = new Float32Array(MAX); this.pz = new Float32Array(MAX);
    this.vx = new Float32Array(MAX); this.vy = new Float32Array(MAX); this.vz = new Float32Array(MAX);
    this.life = new Float32Array(MAX); this.life0 = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.cr = new Float32Array(MAX); this.cg = new Float32Array(MAX); this.cb = new Float32Array(MAX);
    this.grav = new Float32Array(MAX); this.drag = new Float32Array(MAX);

    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MAX * 4), 4);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aColor', this.colAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setDrawRange(0, 0);

    this.tex = makeParticleTexture();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._color = new THREE.Color();
  }

  /**
   * Spawn a burst.
   * @param {object} o {pos, count, dir, speed, spread, size, sizeVar, life,
   *                    lifeVar, color|colors, gravity, drag}
   */
  burst(o) {
    const count = o.count ?? 8;
    const dir = o.dir ?? null;
    const speed = o.speed ?? 5;
    const spread = o.spread ?? 3;
    for (let k = 0; k < count; k++) {
      if (this.count >= MAX) return;
      const i = this.count++;
      this.px[i] = o.pos.x; this.py[i] = o.pos.y; this.pz[i] = o.pos.z;
      let vx = (Math.random() - 0.5) * spread;
      let vy = (Math.random() - 0.5) * spread;
      let vz = (Math.random() - 0.5) * spread;
      if (dir) { vx += dir.x * speed; vy += dir.y * speed; vz += dir.z * speed; }
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
      const life = (o.life ?? 0.6) * (1 - (o.lifeVar ?? 0.3) * Math.random());
      this.life[i] = life; this.life0[i] = life;
      this.size[i] = (o.size ?? 1) * (1 + (o.sizeVar ?? 0.4) * (Math.random() - 0.5));
      const c = o.colors ? o.colors[(Math.random() * o.colors.length) | 0] : (o.color ?? 0xffffff);
      this._color.set(c);
      this.cr[i] = this._color.r; this.cg[i] = this._color.g; this.cb[i] = this._color.b;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const j = --this.count;
        if (i !== j) {
          this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
          this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
          this.life[i] = this.life[j]; this.life0[i] = this.life0[j];
          this.size[i] = this.size[j];
          this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j];
          this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
        }
        continue;
      }
      this.vy[i] -= this.grav[i] * dt;
      const dragK = 1 - this.drag[i] * dt;
      this.vx[i] *= dragK; this.vy[i] *= dragK; this.vz[i] *= dragK;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      i++;
    }
    // write buffers
    const pa = this.posAttr.array, ca = this.colAttr.array, sa = this.sizeAttr.array;
    for (let k = 0; k < this.count; k++) {
      pa[k * 3] = this.px[k]; pa[k * 3 + 1] = this.py[k]; pa[k * 3 + 2] = this.pz[k];
      const a = Math.min(1, this.life[k] / (this.life0[k] * 0.55));
      ca[k * 4] = this.cr[k]; ca[k * 4 + 1] = this.cg[k]; ca[k * 4 + 2] = this.cb[k]; ca[k * 4 + 3] = a;
      sa[k] = this.size[k];
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

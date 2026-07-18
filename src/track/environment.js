// Per-theme world dressing: gradient sky (with sun / moon / stars), fog,
// lights, displaced terrain that hugs the road, and instanced scenery.
import * as THREE from 'three';
import { makeRng, clamp } from '../core/rng.js';
import { makeGrassTexture, makeWindowsTexture, makeLavaTexture, makeParticleTexture } from '../render/textures.js';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float night;
  varying vec3 vDir;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(bottomColor, topColor, pow(h, 0.55));
    // sun / moon disc + halo
    float sd = dot(d, normalize(sunDir));
    col += sunColor * smoothstep(0.9987, 0.9996, sd) * 2.2;
    col += sunColor * pow(clamp(sd, 0.0, 1.0), 24.0) * 0.32;
    // stars at night
    if (night > 0.5 && d.y > 0.02) {
      vec3 cell = floor(d * 160.0);
      float star = step(0.9982, hash(cell));
      float tw = 0.6 + 0.4 * sin(hash(cell.zyx) * 40.0 + d.x * 100.0);
      col += vec3(star) * tw * smoothstep(0.02, 0.2, d.y);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function buildEnvironment(scene, track, quality = 1) {
  const theme = track.def.theme;
  const group = new THREE.Group();
  const disposables = [];
  const animated = [];
  const reg = (...d) => disposables.push(...d);
  const rng = makeRng(1234 + track.def.id.length * 77);

  // track bounding box (horizontal)
  const bb = new THREE.Box2();
  for (const s of track.samples) bb.expandByPoint(new THREE.Vector2(s.pos.x, s.pos.z));
  const center = bb.getCenter(new THREE.Vector2());

  // quick approximate distance-to-road-edge for prop placement
  const edgeApprox = (x, z) => {
    let d2 = Infinity;
    for (let i = 0; i < track.n; i += 5) {
      const p = track.samples[i].pos;
      const dx = x - p.x, dz = z - p.z;
      const v = dx * dx + dz * dz;
      if (v < d2) d2 = v;
    }
    if (track.shortcut) {
      for (let i = 0; i < track.shortcut.n; i += 4) {
        const p = track.shortcut.samples[i].pos;
        const dx = x - p.x, dz = z - p.z;
        const v = dx * dx + dz * dz;
        if (v < d2) d2 = v;
      }
    }
    return Math.sqrt(d2) - track.halfWidth;
  };

  // ---------------- fog + lights ----------------
  scene.fog = new THREE.Fog(theme.fogColor, theme.fogNear, theme.fogFar);

  const hemi = new THREE.HemisphereLight(theme.skyTop, theme.terrainColor, theme.hemi);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
  const sd = new THREE.Vector3(...theme.sunDir).normalize();
  sun.position.copy(sd.clone().multiplyScalar(240));
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  const ext = 200;
  sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext;
  sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 560;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  sun.target.position.set(center.x, 0, center.y);
  group.add(sun, sun.target);

  if (theme.night) {
    const fill = new THREE.DirectionalLight(0x8fa8ff, 0.22);
    fill.position.set(-sd.x * 100, 80, -sd.z * 100);
    group.add(fill);
  }

  // ---------------- sky dome ----------------
  const skyGeo = new THREE.SphereGeometry(900, 24, 14);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: {
      topColor: { value: new THREE.Color(theme.skyTop) },
      bottomColor: { value: new THREE.Color(theme.skyBottom) },
      sunColor: { value: new THREE.Color(theme.sunColor) },
      sunDir: { value: sd },
      night: { value: theme.night ? 1 : 0 },
    },
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  group.add(sky);
  reg(skyGeo, skyMat);

  // ---------------- terrain ----------------
  const T = 900;
  const SEG = Math.round(110 * quality);
  const terrGeo = new THREE.PlaneGeometry(T, T, SEG, SEG);
  terrGeo.rotateX(-Math.PI / 2);
  const posAttr = terrGeo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const cA = new THREE.Color(theme.terrainColor);
  const cB = new THREE.Color(theme.terrainColorB);
  const tmpC = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i) + center.x;
    const z = posAttr.getZ(i) + center.y;
    const g = track.groundHeightGlobal(x, z);
    // dip terrain slightly wherever it's inside/near the road so the ribbon
    // always sits proud of the ground
    const dip = 0.55 * (1 - clamp(g.edge / 3, 0, 1));
    posAttr.setX(i, x);
    posAttr.setZ(i, z);
    posAttr.setY(i, g.y - 0.12 - dip);
    const n = 0.5 + 0.5 * Math.sin(x * 0.05 + Math.sin(z * 0.043) * 2);
    tmpC.copy(cA).lerp(cB, n);
    colors[i * 3] = tmpC.r; colors[i * 3 + 1] = tmpC.g; colors[i * 3 + 2] = tmpC.b;
  }
  terrGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrGeo.computeVertexNormals();
  const grassTex = makeGrassTexture(0xffffff, 0xcccccc);
  grassTex.repeat.set(70, 70);
  // Lambert (diffuse-only) instead of Standard (full PBR) — grass has no
  // meaningful specular highlight anyway, and this is the single biggest
  // fragment-shaded surface in the scene, so the cheaper shading model here
  // is one of the highest-leverage performance wins available.
  const terrMat = new THREE.MeshLambertMaterial({ map: grassTex, vertexColors: true });
  const terrain = new THREE.Mesh(terrGeo, terrMat);
  terrain.receiveShadow = true;
  group.add(terrain);
  reg(terrGeo, terrMat, grassTex);

  // ---------------- helpers for scenery ----------------
  const scatter = (count, minEdge, maxEdge, place) => {
    let placed = 0, attempts = 0;
    while (placed < count && attempts < count * 10) {
      attempts++;
      const x = center.x + rng.range(-T / 2 + 30, T / 2 - 30);
      const z = center.y + rng.range(-T / 2 + 30, T / 2 - 30);
      const e = edgeApprox(x, z);
      if (e < minEdge || e > maxEdge) continue;
      const y = track.groundHeightGlobal(x, z).y;
      place(x, y, z, placed);
      placed++;
    }
    return placed;
  };

  const instanced = (geo, mat, transforms, { shadow = true } = {}) => {
    if (!transforms.length) return null;
    const inst = new THREE.InstancedMesh(geo, mat, transforms.length);
    transforms.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = shadow;
    group.add(inst);
    reg(geo, mat);
    return inst;
  };

  const compose = (x, y, z, ry, s) => new THREE.Matrix4()
    .makeRotationY(ry).scale(new THREE.Vector3(s, s, s)).setPosition(x, y, z);

  // ---------------- theme scenery ----------------
  if (theme.key === 'meadow') buildMeadow();
  else if (theme.key === 'volcano') buildVolcano();
  else buildCity();

  function buildMeadow() {
    // trees: trunk + two foliage cones sharing transforms
    const trunkT = [], leafT = [];
    scatter(Math.round(120 * quality), 7, 300, (x, y, z) => {
      const s = rng.range(0.8, 1.7);
      const m = compose(x, y, z, rng() * 6.28, s);
      trunkT.push(m); leafT.push(m);
    });
    instanced(new THREE.CylinderGeometry(0.32, 0.45, 2.6, 6).translate(0, 1.3, 0),
      new THREE.MeshLambertMaterial({ color: 0x7a5230 }), trunkT);
    const leafGeo = new THREE.ConeGeometry(2.1, 3.4, 7).translate(0, 3.6, 0);
    const leafGeo2 = new THREE.ConeGeometry(1.5, 2.6, 7).translate(0, 5.4, 0);
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e8b45 });
    instanced(leafGeo, leafMat, leafT);
    instanced(leafGeo2, leafMat.clone(), leafT);

    // flowers
    const flowerT = [];
    scatter(180, 4, 60, (x, y, z) => {
      flowerT.push(compose(x, y + 0.25, z, rng() * 6.28, rng.range(0.7, 1.2)));
    });
    const flowerMat = new THREE.MeshLambertMaterial();
    const flowers = instanced(new THREE.OctahedronGeometry(0.3), flowerMat, flowerT, { shadow: false });
    if (flowers) {
      const petals = [0xff5f8f, 0xffce3a, 0xffffff, 0xbf6fff];
      for (let i = 0; i < flowerT.length; i++) {
        flowers.setColorAt(i, new THREE.Color(petals[i % petals.length]));
      }
    }

    // hay bales near the road
    const hayT = [];
    scatter(16, 5, 12, (x, y, z) => {
      hayT.push(compose(x, y + 0.7, z, rng() * 6.28, rng.range(0.9, 1.2)));
    });
    instanced(new THREE.CylinderGeometry(0.8, 0.8, 1.3, 10).rotateZ(Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xd8b545 }), hayT);

    // clouds
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
    const cloudGeo = new THREE.SphereGeometry(1, 8, 6);
    const clouds = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const cl = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const b = new THREE.Mesh(cloudGeo, cloudMat);
        b.position.set(rng.range(-9, 9), rng.range(-1.5, 1.5), rng.range(-4, 4));
        b.scale.set(rng.range(5, 9), rng.range(2.4, 3.4), rng.range(4, 6));
        cl.add(b);
      }
      cl.position.set(center.x + rng.range(-380, 380), rng.range(70, 120), center.y + rng.range(-380, 380));
      clouds.add(cl);
    }
    group.add(clouds);
    reg(cloudGeo, cloudMat);
    animated.push((dt) => {
      for (const cl of clouds.children) {
        cl.position.x += dt * 2.2;
        if (cl.position.x > center.x + 420) cl.position.x = center.x - 420;
      }
    });

    mountains(0x6fa7c9, 0x88b89a);
  }

  function buildVolcano() {
    // jagged rock spires
    const rockT = [];
    scatter(Math.round(110 * quality), 8, 300, (x, y, z) => {
      rockT.push(compose(x, y, z, rng() * 6.28, rng.range(0.7, 2.6)));
    });
    instanced(new THREE.ConeGeometry(1.6, 4.5, 5).translate(0, 2.2, 0),
      new THREE.MeshLambertMaterial({ color: 0x4a3c40, flatShading: true }), rockT);
    const boulderT = [];
    scatter(70, 6, 200, (x, y, z) => {
      boulderT.push(compose(x, y + 0.4, z, rng() * 6.28, rng.range(0.5, 1.8)));
    });
    instanced(new THREE.IcosahedronGeometry(0.9, 0),
      new THREE.MeshLambertMaterial({ color: 0x37292d, flatShading: true }), boulderT);

    // glowing lava pools
    const lavaTex = makeLavaTexture();
    const lavaMat = new THREE.MeshLambertMaterial({
      map: lavaTex, emissive: 0xff6a1a, emissiveMap: lavaTex, emissiveIntensity: 1.35,
    });
    const poolGeo = new THREE.CircleGeometry(1, 22);
    poolGeo.rotateX(-Math.PI / 2);
    scatter(12, 10, 130, (x, y, z) => {
      const pool = new THREE.Mesh(poolGeo, lavaMat);
      pool.position.set(x, y + 0.25, z);
      const s = rng.range(6, 17);
      pool.scale.set(s, 1, s);
      group.add(pool);
    });
    reg(poolGeo, lavaMat, lavaTex);
    animated.push((dt) => {
      lavaTex.offset.x += dt * 0.012;
      lavaTex.offset.y += dt * 0.007;
    });

    // ember glow lights near track (cheap: emissive rocks)
    mountains(0x54262a, 0x3c2026, true);
  }

  function buildCity() {
    // buildings — three window-texture variants
    const mats = [9, 23, 51].map((seed) => {
      const tx = makeWindowsTexture(seed);
      reg(tx);
      return new THREE.MeshLambertMaterial({
        color: 0x2c3244, map: tx, emissive: 0xffffff, emissiveMap: tx,
        emissiveIntensity: 0.85,
      });
    });
    mats.forEach((m) => reg(m));
    const buildGeo = new THREE.BoxGeometry(1, 1, 1);
    reg(buildGeo);
    const byMat = [[], [], []];
    scatter(Math.round(95 * quality), 10, 260, (x, y, z, i) => {
      const w = rng.range(10, 22);
      const hgt = rng.range(16, 64);
      const m = new THREE.Matrix4()
        .makeRotationY(Math.floor(rng() * 4) * (Math.PI / 2) + rng.range(-0.1, 0.1))
        .scale(new THREE.Vector3(w, hgt, rng.range(10, 22)))
        .setPosition(x, y + hgt / 2 - 1, z);
      byMat[i % 3].push(m);
    });
    byMat.forEach((list, i) => {
      if (!list.length) return;
      const inst = new THREE.InstancedMesh(buildGeo, mats[i], list.length);
      list.forEach((m, k) => inst.setMatrixAt(k, m));
      inst.castShadow = true;
      group.add(inst);
    });

    // neon slabs near the road
    const neonT = [];
    const neonColors = [0x27e0ff, 0xff3aa0, 0xffe14a, 0x7cff6a];
    scatter(26, 4, 16, (x, y, z) => {
      neonT.push(compose(x, y + rng.range(1.5, 4), z, rng() * 6.28, 1));
    });
    const neonGeo = new THREE.BoxGeometry(2.6, 0.9, 0.25);
    const neonMat = new THREE.MeshLambertMaterial({ emissive: 0xffffff, emissiveIntensity: 1.8, color: 0x111111 });
    const neon = instanced(neonGeo, neonMat, neonT, { shadow: false });
    if (neon) {
      neonT.forEach((_, i) => neon.setColorAt(i, new THREE.Color(neonColors[i % neonColors.length])));
    }

    // street lamps along the road
    const poleT = [], bulbT = [], poolT = [], lampPos = [];
    for (let i = 0; i < track.n; i += 16) {
      const f = track.samples[i];
      const side = (i / 16) % 2 === 0 ? 1 : -1;
      const lat = side * (track.halfWidth + 3.2);
      const x = f.pos.x + f.left.x * lat, z = f.pos.z + f.left.z * lat;
      const m = compose(x, f.pos.y, z, 0, 1);
      poleT.push(m);
      bulbT.push(new THREE.Matrix4().setPosition(x, f.pos.y + 4.3, z));
      poolT.push(new THREE.Matrix4()
        .makeScale(11, 1, 11).setPosition(x, f.pos.y + 0.07, z));
      lampPos.push(new THREE.Vector3(x, f.pos.y, z));
    }
    instanced(new THREE.CylinderGeometry(0.12, 0.16, 4.3, 6).translate(0, 2.15, 0),
      new THREE.MeshLambertMaterial({ color: 0x39415a }), poleT);
    instanced(new THREE.SphereGeometry(0.38, 10, 8),
      new THREE.MeshLambertMaterial({ emissive: 0xbfd8ff, emissiveIntensity: 2.4, color: 0x111111 }),
      bulbT, { shadow: false });

    // Every lamp gets an additive "light pool" decal on the ground — the lit
    // patch of road you'd expect under a street light, at zero real-lighting
    // cost. Real point lights here are ruinous: the forward renderer
    // evaluates every light in the scene for every lit fragment, so dozens
    // of static lamps multiply shading cost across the whole track.
    const poolTex = makeParticleTexture();
    reg(poolTex);
    const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      map: poolTex, color: 0x5a7db8, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    instanced(poolGeo, poolMat, poolT, { shadow: false });

    // ... plus a tiny pool of REAL lights that follow whichever lamps are
    // currently nearest the camera/player, so nearby karts and curbs still
    // pick up genuine dynamic light. Intensity fades with distance, so by
    // the time a light gets reassigned to another lamp it is already dark —
    // no visible popping.
    const liveLamps = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xbfd8ff, 0, 13, 2);
      group.add(l);
      liveLamps.push(l);
    }
    animated.push((dt, focus) => {
      if (!focus) return;
      const ranked = lampPos
        .map((p, i) => ({ i, d: (p.x - focus.x) ** 2 + (p.z - focus.z) ** 2 }))
        .sort((a, b) => a.d - b.d);
      for (let k = 0; k < liveLamps.length; k++) {
        const { i, d } = ranked[k];
        const p = lampPos[i];
        liveLamps[k].position.set(p.x, p.y + 4.1, p.z);
        liveLamps[k].intensity = 3.2 * clamp(1 - (Math.sqrt(d) - 16) / 26, 0, 1);
      }
    });

    mountains(0x141a33, 0x0d1128);
  }

  function mountains(colA, colB, glowTips = false) {
    const mats = [
      new THREE.MeshLambertMaterial({ color: colA, flatShading: true }),
      new THREE.MeshLambertMaterial({ color: colB, flatShading: true }),
    ];
    const geo = new THREE.ConeGeometry(1, 1, 7);
    reg(geo, ...mats);
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const r = rng.range(370, 430);
      const m = new THREE.Mesh(geo, mats[i % 2]);
      const w = rng.range(90, 190);
      const h = rng.range(55, 130);
      m.scale.set(w, h, w);
      m.position.set(center.x + Math.cos(ang) * r, h * 0.42, center.y + Math.sin(ang) * r);
      group.add(m);
      if (glowTips && i % 3 === 0) {
        const tip = new THREE.Mesh(
          new THREE.ConeGeometry(0.13, 0.2, 7),
          new THREE.MeshLambertMaterial({ emissive: 0xff5a1a, emissiveIntensity: 2.2, color: 0x220a04 }));
        tip.scale.copy(m.scale);
        tip.position.copy(m.position).add(new THREE.Vector3(0, h * 0.48, 0));
        group.add(tip);
      }
    }
  }

  scene.add(group);

  return {
    group,
    sunDir: sd,
    sun,
    // focus (optional Vector3): where the action is — used to decide which
    // lamps get the real dynamic lights on the night track.
    update(dt, focus) { for (const fn of animated) fn(dt, focus); },
    dispose() {
      scene.remove(group);
      scene.fog = null;
      for (const d of disposables) d.dispose?.();
    },
  };
}

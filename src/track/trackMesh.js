// Builds all static track geometry from a TrackData: road ribbon, dirt
// shortcut, curbs, barrier walls, support pillars, start gate and boost pads.
import * as THREE from 'three';
import {
  makeRoadTexture, makeDirtTexture, makeCurbTexture, makeCheckerTexture,
  makeBoostChevronTexture, makeBannerTexture,
} from '../render/textures.js';

function ribbonGeometry(frames, latA, latB, { closed, yLift = 0, vScale = 0.125 }) {
  // frames: [{pos, left}] — builds a strip between two lateral offsets
  const n = frames.length;
  const verts = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const ax = f.pos.x + f.left.x * latA, az = f.pos.z + f.left.z * latA;
    const bx = f.pos.x + f.left.x * latB, bz = f.pos.z + f.left.z * latB;
    verts.set([ax, f.pos.y + yLift, az, bx, f.pos.y + yLift, bz], i * 6);
    const v = i * vScale;
    uvs.set([0, v, 1, v], i * 4);
  }
  const segs = closed ? n : n - 1;
  const idx = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = i * 2 + 1;
    const c = ((i + 1) % n) * 2, d = ((i + 1) % n) * 2 + 1;
    // wound so the face normal points up (+y)
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildTrackMeshes(track) {
  const def = track.def;
  const theme = def.theme;
  const group = new THREE.Group();
  const disposables = [];
  const add = (mesh) => { group.add(mesh); return mesh; };
  const reg = (...items) => { disposables.push(...items); };

  const hw = track.halfWidth;
  const spacingV = track.spacing / 8; // road texture tiles every 8 m

  // ---------------- road ----------------
  const roadTex = makeRoadTexture(theme.roadTint);
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex, roughness: 0.94, metalness: 0.02,
  });
  const roadGeo = ribbonGeometry(track.samples, hw, -hw, { closed: true, yLift: 0.05, vScale: spacingV });
  const road = add(new THREE.Mesh(roadGeo, roadMat));
  road.receiveShadow = true;
  reg(roadGeo, roadMat, roadTex);

  // ---------------- shortcut (dirt) ----------------
  if (track.shortcut) {
    const sc = track.shortcut;
    const dirtTex = makeDirtTexture();
    dirtTex.repeat.set(1, 1);
    const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 });
    const dirtGeo = ribbonGeometry(sc.samples, sc.halfWidth, -sc.halfWidth,
      { closed: false, yLift: 0.04, vScale: sc.spacing / 6 });
    const dirt = add(new THREE.Mesh(dirtGeo, dirtMat));
    dirt.receiveShadow = true;
    reg(dirtGeo, dirtMat, dirtTex);
  }

  // ---------------- curbs ----------------
  const curbTex = makeCurbTexture(theme.curbA, theme.curbB);
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.85 });
  const curbL = ribbonGeometry(track.samples, hw + 1.1, hw, { closed: true, yLift: 0.09, vScale: track.spacing / 4 });
  const curbR = ribbonGeometry(track.samples, -hw, -(hw + 1.1), { closed: true, yLift: 0.09, vScale: track.spacing / 4 });
  add(new THREE.Mesh(curbL, curbMat)).receiveShadow = true;
  add(new THREE.Mesh(curbR, curbMat)).receiveShadow = true;
  reg(curbL, curbR, curbMat, curbTex);

  // ---------------- skirts (hide ribbon underside on elevated bits) -------
  const skirtMat = new THREE.MeshStandardMaterial({
    color: theme.terrainColorB, roughness: 1,
  });
  for (const side of [1, -1]) {
    const n = track.n;
    const verts = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const f = track.samples[i];
      const lat = side * (hw + 1.1);
      const x = f.pos.x + f.left.x * lat, z = f.pos.z + f.left.z * lat;
      const yTop = f.pos.y + 0.1;
      const yBot = Math.min(f.pos.y - 4, track.terrainBase(x, z) - 1);
      verts.set([x, yTop, z, x, yBot, z], i * 6);
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1;
      const c = ((i + 1) % n) * 2, d = ((i + 1) % n) * 2 + 1;
      idx.push(a, b, c, b, d, c, a, c, b, b, c, d); // double-sided via both windings
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    add(new THREE.Mesh(geo, skirtMat));
    reg(geo);
  }
  reg(skirtMat);

  // ---------------- barrier walls ----------------
  const wallMat = new THREE.MeshStandardMaterial({
    color: theme.wallColor, roughness: 0.8,
    emissive: theme.night ? theme.wallAccent : 0x000000,
    emissiveIntensity: theme.night ? 0.25 : 0,
  });
  const wallHeight = 1.15;
  for (const side of [1, -1]) {
    const flag = (i) => (side > 0 ? track.samples[i].wallL : track.samples[i].wallR);
    const verts = [];
    const idx = [];
    for (let i = 0; i < track.n; i++) {
      const j = (i + 1) % track.n;
      if (!flag(i) || !flag(j)) continue;
      const base = verts.length / 3;
      for (const k of [i, j]) {
        const f = track.samples[k];
        const lat = side * (hw + 1.45);
        const x = f.pos.x + f.left.x * lat, z = f.pos.z + f.left.z * lat;
        verts.push(x, f.pos.y + 0.05, z, x, f.pos.y + wallHeight, z);
      }
      // both windings so it's solid from either side
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    if (idx.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = add(new THREE.Mesh(geo, wallMat));
      m.castShadow = true;
      reg(geo);
    }
  }
  reg(wallMat);

  // wall posts
  const postGeo = new THREE.BoxGeometry(0.34, 1.5, 0.34);
  const postMat = new THREE.MeshStandardMaterial({ color: theme.wallAccent, roughness: 0.7 });
  const postSpots = [];
  for (let i = 0; i < track.n; i += 9) {
    for (const side of [1, -1]) {
      const flag = side > 0 ? track.samples[i].wallL : track.samples[i].wallR;
      if (!flag) continue;
      const f = track.samples[i];
      const lat = side * (hw + 1.45);
      postSpots.push(new THREE.Vector3(
        f.pos.x + f.left.x * lat, f.pos.y + 0.7, f.pos.z + f.left.z * lat));
    }
  }
  if (postSpots.length) {
    const posts = new THREE.InstancedMesh(postGeo, postMat, postSpots.length);
    const m4 = new THREE.Matrix4();
    postSpots.forEach((p, i) => { m4.setPosition(p); posts.setMatrixAt(i, m4); });
    posts.castShadow = true;
    add(posts);
  }
  reg(postGeo, postMat);

  // ---------------- support pillars under elevated road ----------------
  const pillarSpots = [];
  for (let i = 0; i < track.n; i += 10) {
    const f = track.samples[i];
    const ground = track.terrainBase(f.pos.x, f.pos.z);
    const drop = f.pos.y - ground;
    if (drop > 3.4) pillarSpots.push({ pos: f.pos, top: f.pos.y - 0.2, bottom: ground - 1.5 });
  }
  if (pillarSpots.length) {
    const pilGeo = new THREE.CylinderGeometry(1, 1.35, 1, 10);
    const pilMat = new THREE.MeshStandardMaterial({ color: theme.wallColor, roughness: 0.9 });
    const pillars = new THREE.InstancedMesh(pilGeo, pilMat, pillarSpots.length);
    const m4 = new THREE.Matrix4();
    pillarSpots.forEach((p, i) => {
      const height = p.top - p.bottom;
      m4.makeScale(1, height, 1);
      m4.setPosition(p.pos.x, p.bottom + height / 2, p.pos.z);
      pillars.setMatrixAt(i, m4);
    });
    pillars.castShadow = true;
    add(pillars);
    reg(pilGeo, pilMat);
  }

  // ---------------- start line + gate ----------------
  const checkTex = makeCheckerTexture();
  const lineMat = new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.8 });
  const lineFrames = [];
  for (let s = 0.5; s <= 4.5; s += 1) lineFrames.push(track.sampleAt(s));
  const lineGeo = ribbonGeometry(lineFrames, hw, -hw, { closed: false, yLift: 0.1, vScale: 0.5 });
  add(new THREE.Mesh(lineGeo, lineMat)).receiveShadow = true;
  reg(lineGeo, lineMat, checkTex);

  const gate = track.sampleAt(2.5);
  const gateH = 6.4;
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, gateH, 10);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.6 });
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(pillarGeo, gateMat);
    p.position.set(
      gate.pos.x + gate.left.x * side * (hw + 1.8),
      gate.pos.y + gateH / 2,
      gate.pos.z + gate.left.z * side * (hw + 1.8));
    p.castShadow = true;
    add(p);
  }
  reg(pillarGeo, gateMat);
  const bannerTex = makeBannerTexture('FABLEKART');
  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerTex, side: THREE.DoubleSide,
    emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: theme.night ? 0.7 : 0.15,
  });
  const bannerGeo = new THREE.PlaneGeometry((hw + 1.8) * 2, 1.9);
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(gate.pos.x, gate.pos.y + gateH - 0.6, gate.pos.z);
  // textured face toward approaching racers (they come from -tangent)
  banner.lookAt(banner.position.clone().sub(gate.tan));
  add(banner);
  reg(bannerGeo, bannerMat, bannerTex);

  // ---------------- boost pads ----------------
  const chevTex = makeBoostChevronTexture();
  const padMat = new THREE.MeshStandardMaterial({
    map: chevTex, transparent: true, roughness: 0.5,
    emissive: 0xffb400, emissiveMap: chevTex, emissiveIntensity: 1.6,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  for (const pad of track.pads) {
    const frames = [];
    for (let s = pad.s0; s <= pad.s1; s += 2) frames.push(track.sampleAt(s));
    const geo = ribbonGeometry(frames, pad.latC + pad.halfw, pad.latC - pad.halfw,
      { closed: false, yLift: 0.12, vScale: 2 / (pad.s1 - pad.s0) });
    add(new THREE.Mesh(geo, padMat));
    reg(geo);
  }
  reg(padMat, chevTex);

  return {
    group,
    dispose() { for (const d of disposables) d.dispose?.(); },
  };
}

// Builds a stylized low-poly kart + driver out of primitives. Returns the
// group plus references the game animates (wheels, flames, shield, tint).
import * as THREE from 'three';

export function buildKartMesh(character) {
  const group = new THREE.Group();
  const body = new THREE.Group(); // tilt/lean happens here
  group.add(body);

  const disposables = [];
  const reg = (...d) => { disposables.push(...d); return d[0]; };
  const coloredMats = [];

  const mat = (opts) => reg(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15, ...opts }));
  const colorMat = (c, opts = {}) => {
    const m = mat({ color: c, ...opts });
    coloredMats.push({ m, base: new THREE.Color(c) });
    return m;
  };

  const bodyMat = colorMat(character.color);
  const accentMat = colorMat(character.accent ?? 0xffffff);
  const darkMat = mat({ color: 0x1c1e26, roughness: 0.8 });
  const tireMat = mat({ color: 0x17181d, roughness: 0.95 });
  const hubMat = mat({ color: 0xd8d8e0, roughness: 0.4, metalness: 0.5 });
  const helmetMat = colorMat(character.helmet ?? 0xffffff);
  const visorMat = mat({ color: 0x10121c, roughness: 0.2, metalness: 0.6 });

  const weight = character.weight ?? 0.5;
  const scale = 0.95 + weight * 0.15;

  const addBox = (m, w, h, d, x, y, z, castShadow = true) => {
    const g = reg(new THREE.BoxGeometry(w, h, d));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    body.add(mesh);
    return mesh;
  };

  // chassis (+z = forward)
  addBox(bodyMat, 1.34, 0.34, 2.35, 0, 0.5, 0);
  // nose wedge
  const nose = addBox(bodyMat, 0.95, 0.26, 0.75, 0, 0.48, 1.45);
  nose.rotation.x = 0.16;
  // front bumper
  addBox(accentMat, 1.15, 0.16, 0.18, 0, 0.42, 1.78);
  // side pods
  addBox(darkMat, 0.24, 0.3, 1.25, 0.78, 0.48, -0.15);
  addBox(darkMat, 0.24, 0.3, 1.25, -0.78, 0.48, -0.15);
  // cockpit rim + seat
  addBox(darkMat, 0.85, 0.14, 0.95, 0, 0.7, -0.15);
  const seat = addBox(bodyMat, 0.7, 0.62, 0.16, 0, 0.95, -0.72);
  seat.rotation.x = -0.12;
  // spoiler
  addBox(darkMat, 0.1, 0.3, 0.1, 0.42, 0.85, -1.1);
  addBox(darkMat, 0.1, 0.3, 0.1, -0.42, 0.85, -1.1);
  const wing = addBox(accentMat, 1.35, 0.08, 0.42, 0, 1.02, -1.12);
  wing.rotation.x = -0.1;

  // driver
  const torsoGeo = reg(new THREE.CapsuleGeometry(0.26, 0.3, 4, 8));
  const torso = new THREE.Mesh(torsoGeo, accentMat);
  torso.position.set(0, 0.95, -0.32);
  torso.castShadow = true;
  body.add(torso);
  const headGeo = reg(new THREE.SphereGeometry(0.3, 14, 12));
  const head = new THREE.Mesh(headGeo, helmetMat);
  head.position.set(0, 1.42, -0.3);
  head.castShadow = true;
  body.add(head);
  const visor = addBox(visorMat, 0.4, 0.14, 0.1, 0, 1.44, -0.04);
  visor.position.z = -0.3 + 0.26;

  // wheels — front pair steers via pivot groups
  const wheels = [];
  const mkWheel = (x, z, front) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.34, z);
    const r = front ? 0.3 : 0.36;
    const tireGeo = reg(new THREE.CylinderGeometry(r, r, 0.3, 14));
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const hubGeo = reg(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.32, 8));
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    const spin = new THREE.Group();
    spin.add(tire, hub);
    pivot.add(spin);
    body.add(pivot);
    wheels.push({ pivot, spin, front });
  };
  mkWheel(0.78, 0.85, true);
  mkWheel(-0.78, 0.85, true);
  mkWheel(0.8, -0.78, false);
  mkWheel(-0.8, -0.78, false);

  // exhaust pipes + boost flames
  const flames = [];
  const pipeGeo = reg(new THREE.CylinderGeometry(0.09, 0.11, 0.4, 8));
  const flameGeo = reg(new THREE.ConeGeometry(0.16, 0.9, 8));
  const flameMat = reg(new THREE.MeshBasicMaterial({
    color: 0xffa030, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  for (const x of [0.3, -0.3]) {
    const pipe = new THREE.Mesh(pipeGeo, hubMat);
    pipe.position.set(x, 0.55, -1.28);
    pipe.rotation.x = Math.PI / 2 - 0.25;
    body.add(pipe);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x, 0.52, -1.75);
    flame.rotation.x = -Math.PI / 2 + 0.22;
    flame.visible = false;
    body.add(flame);
    flames.push(flame);
  }

  // shield bubble
  const shieldGeo = reg(new THREE.SphereGeometry(1.55, 18, 14));
  const shieldMat = reg(new THREE.MeshBasicMaterial({
    color: 0x54c8ff, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  shield.position.y = 0.8;
  shield.visible = false;
  group.add(shield);

  body.scale.setScalar(scale);

  return {
    group, body, wheels, flames, shield, shieldMat, coloredMats,
    dispose() { for (const d of disposables) d.dispose?.(); },
  };
}

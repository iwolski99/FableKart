// TrackData: samples the closed center spline into a dense lookup table and
// answers every spatial question the game asks: "what's under this kart?",
// "how far along the lap am I?", "is there a wall here?", "where do AI aim?".
import * as THREE from 'three';
import { clamp, lerp, smoothstep, angleDiff } from '../core/rng.js';

const UP = new THREE.Vector3(0, 1, 0);

function leftOf(tan) {
  // up × tangent, flattened to horizontal
  return new THREE.Vector3(tan.z, 0, -tan.x).normalize();
}

export class TrackData {
  constructor(def) {
    this.def = def;
    this.halfWidth = def.width / 2;

    const pts = def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    this.length = this.curve.getLength();
    this.n = clamp(Math.round(this.length / 1.6), 400, 1100);
    this.spacing = this.length / this.n;

    const raw = this.curve.getSpacedPoints(this.n); // n+1, last == first
    this.samples = [];
    for (let i = 0; i < this.n; i++) {
      const pos = raw[i];
      const next = raw[(i + 1) % this.n];
      const prev = raw[(i - 1 + this.n) % this.n];
      const tan = next.clone().sub(prev).normalize();
      this.samples.push({
        pos, tan, left: leftOf(tan),
        curv: 0, wallL: false, wallR: false,
      });
    }
    // signed curvature (positive = turning left)
    for (let i = 0; i < this.n; i++) {
      const a = this.samples[i].tan;
      const b = this.samples[(i + 1) % this.n].tan;
      const ha = Math.atan2(a.x, a.z);
      const hb = Math.atan2(b.x, b.z);
      this.samples[i].curv = angleDiff(ha, hb) / this.spacing;
    }

    this._applyWalls(def.walls || []);
    this.shortcut = def.shortcut ? this._buildShortcut(def.shortcut) : null;
    this._buildFeatures();
  }

  // ------------------------------------------------------------------
  _applyWalls(ranges) {
    for (const r of ranges) {
      for (let i = 0; i < this.n; i++) {
        const f = i / this.n;
        const inRange = r.from <= r.to
          ? f >= r.from && f <= r.to
          : f >= r.from || f <= r.to;
        if (!inRange) continue;
        if (r.side === 'both' || r.side === 'left') this.samples[i].wallL = true;
        if (r.side === 'both' || r.side === 'right') this.samples[i].wallR = true;
      }
    }
  }

  _nearestSampleToPoint(v) {
    let best = 0; let bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = this.samples[i].pos.distanceToSquared(v);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  _buildShortcut(sc) {
    const cpEntry = new THREE.Vector3(...this.def.points[sc.entryCP]);
    const cpExit = new THREE.Vector3(...this.def.points[sc.exitCP]);
    const iEntry = this._nearestSampleToPoint(cpEntry);
    const iExit = this._nearestSampleToPoint(cpExit);
    const entryS = iEntry * this.spacing;
    const exitS = iExit * this.spacing;
    const side = sc.side;

    const at = (s, latScale) => {
      const smp = this.sampleAt(s);
      return smp.pos.clone().add(smp.left.clone().multiplyScalar(side * this.halfWidth * latScale));
    };
    const pre = at((entryS - 13 + this.length) % this.length, 0.35);
    const entry = at(entryS, 0.8);
    const exit = at(exitS, 0.8);
    const post = at((exitS + 13) % this.length, 0.35);

    const chord = exit.clone().sub(entry);
    const chordFlat = new THREE.Vector3(chord.x, 0, chord.z);
    const perp = leftOf(chordFlat.clone().normalize());
    const ctrl = [pre, entry];
    for (const [t, lat, lift] of sc.mids) {
      ctrl.push(entry.clone()
        .addScaledVector(chord, t)
        .addScaledVector(perp, lat)
        .add(new THREE.Vector3(0, lift, 0)));
    }
    ctrl.push(exit, post);

    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
    const length = curve.getLength();
    const m = clamp(Math.round(length / 1.6), 40, 300);
    const raw = curve.getSpacedPoints(m);
    const samples = [];
    for (let i = 0; i <= m; i++) {
      const pos = raw[i];
      const a = raw[Math.max(0, i - 1)];
      const b = raw[Math.min(m, i + 1)];
      const tan = b.clone().sub(a).normalize();
      samples.push({ pos, tan, left: leftOf(tan) });
    }

    // open the barriers at both mouths
    this._clearWallRange(entryS - 15, entryS + 9, side);
    this._clearWallRange(exitS - 9, exitS + 15, side);

    return {
      samples, n: samples.length, spacing: length / m, length,
      halfWidth: sc.width / 2, entryS, exitS, side,
    };
  }

  _clearWallRange(s0, s1, side) {
    const i0 = Math.floor(((s0 % this.length) + this.length) % this.length / this.spacing);
    const i1 = Math.ceil(((s1 % this.length) + this.length) % this.length / this.spacing);
    let i = i0;
    while (true) {
      const idx = ((i % this.n) + this.n) % this.n;
      if (side > 0) this.samples[idx].wallL = false;
      else this.samples[idx].wallR = false;
      if (idx === ((i1 % this.n) + this.n) % this.n) break;
      i++;
      if (i - i0 > this.n) break;
    }
  }

  _buildFeatures() {
    // item boxes: rows of 4 across the road
    this.itemBoxSpots = [];
    const lats = [-0.62, -0.21, 0.21, 0.62];
    for (const f of this.def.itemBoxes || []) {
      const s = f * this.length;
      const smp = this.sampleAt(s);
      for (const l of lats) {
        const pos = smp.pos.clone().addScaledVector(smp.left, l * this.halfWidth);
        this.itemBoxSpots.push({ pos, s });
      }
    }
    // boost pads → world-space s/lat ranges
    this.pads = (this.def.boostPads || []).map((p) => ({
      s0: p.s * this.length,
      s1: p.s * this.length + p.len,
      latC: p.lat * this.halfWidth,
      halfw: p.halfw * this.halfWidth,
    }));
  }

  // ------------------------------------------------------------------
  // queries

  /** Interpolated frame at arc position s (meters, wraps). */
  sampleAt(s) {
    s = ((s % this.length) + this.length) % this.length;
    const fi = s / this.spacing;
    const i0 = Math.floor(fi) % this.n;
    const i1 = (i0 + 1) % this.n;
    const t = fi - Math.floor(fi);
    const a = this.samples[i0], b = this.samples[i1];
    const pos = a.pos.clone().lerp(b.pos, t);
    const tan = a.tan.clone().lerp(b.tan, t).normalize();
    return { pos, tan, left: leftOf(tan), curv: a.curv, index: i0 };
  }

  curvAt(s) {
    s = ((s % this.length) + this.length) % this.length;
    return this.samples[Math.floor(s / this.spacing) % this.n].curv;
  }

  /** Max |curvature| in the window [s, s+ahead], returns signed value. */
  maxCurvAhead(s, ahead) {
    const steps = Math.ceil(ahead / this.spacing);
    const i0 = Math.floor(((s % this.length) + this.length) % this.length / this.spacing);
    let best = 0;
    for (let k = 0; k < steps; k++) {
      const c = this.samples[(i0 + k) % this.n].curv;
      if (Math.abs(c) > Math.abs(best)) best = c;
    }
    return best;
  }

  _projectToSamples(samples, n, closed, spacing, x, z, hint, window) {
    let i0 = 0, i1 = n - 1;
    let bestI = -1, bestT = 0, bestD2 = Infinity, bestCx = 0, bestCz = 0;
    const segCount = closed ? n : n - 1;

    const testSeg = (i) => {
      const a = samples[i].pos;
      const b = samples[(i + 1) % n].pos;
      const abx = b.x - a.x, abz = b.z - a.z;
      const apx = x - a.x, apz = z - a.z;
      const den = abx * abx + abz * abz;
      let t = den > 1e-9 ? (apx * abx + apz * abz) / den : 0;
      t = clamp(t, 0, 1);
      const cx = a.x + abx * t, cz = a.z + abz * t;
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestI = i; bestT = t; bestCx = cx; bestCz = cz; }
    };

    if (hint >= 0) {
      for (let k = -window; k <= window; k++) {
        let i = hint + k;
        if (closed) i = ((i % n) + n) % n;
        else if (i < 0 || i >= segCount) continue;
        testSeg(i);
      }
    } else {
      // coarse pass then refine
      let coarseBest = 0, coarseD = Infinity;
      for (let i = 0; i < n; i += 4) {
        const p = samples[i].pos;
        const dx = x - p.x, dz = z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < coarseD) { coarseD = d2; coarseBest = i; }
      }
      for (let k = -6; k <= 6; k++) {
        let i = coarseBest + k;
        if (closed) i = ((i % n) + n) % n;
        else if (i < 0 || i >= segCount) continue;
        testSeg(i);
      }
    }

    const a = samples[bestI], b = samples[(bestI + 1) % n];
    const y = lerp(a.pos.y, b.pos.y, bestT);
    const tan = a.tan.clone().lerp(b.tan, bestT).normalize();
    const left = leftOf(tan);
    const lateral = (x - bestCx) * left.x + (z - bestCz) * left.z;
    return {
      index: bestI, t: bestT, s: (bestI + bestT) * spacing,
      y, tan, left, lateral, dist: Math.sqrt(bestD2),
    };
  }

  nearestOnMain(x, z, hint = -1, window = 48) {
    return this._projectToSamples(this.samples, this.n, true, this.spacing, x, z, hint, window);
  }

  nearestOnShortcut(x, z, hint = -1, window = 40) {
    if (!this.shortcut) return null;
    return this._projectToSamples(
      this.shortcut.samples, this.shortcut.n, false, this.shortcut.spacing, x, z, hint, window);
  }

  /** Base terrain height away from the track. */
  terrainBase(x, z) {
    const h = this.def.theme.hilliness;
    return -1.4 + h * (
      Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.017 + 0.6) * 0.62 +
      Math.sin(x * 0.043 + 0.3) * Math.sin(z * 0.037 + 2.1) * 0.38
    );
  }

  /**
   * Full physical description of the ground at (x, z).
   * hintMain / hintShort are last-known sample indices (or -1).
   */
  groundInfo(x, z, hintMain = -1, hintShort = -1) {
    const main = this.nearestOnMain(x, z, hintMain);
    // the shortcut spline is short — a full scan is cheap and never stale
    const sc = this.shortcut ? this.nearestOnShortcut(x, z, -1) : null;

    const latM = Math.abs(main.lateral);
    const onRoad = latM <= this.halfWidth;
    const scIn = sc && Math.abs(sc.lateral) <= this.shortcut.halfWidth;

    let surface, y;
    if (onRoad && scIn) {
      // overlapping at the mouths — whichever we're deeper inside
      if (latM / this.halfWidth <= Math.abs(sc.lateral) / this.shortcut.halfWidth) {
        surface = 'road'; y = main.y;
      } else { surface = 'dirt'; y = sc.y; }
    } else if (onRoad) {
      surface = 'road'; y = main.y;
    } else if (scIn) {
      surface = 'dirt'; y = sc.y;
    } else {
      const edM = latM - this.halfWidth;
      const edS = sc ? Math.abs(sc.lateral) - this.shortcut.halfWidth : Infinity;
      const ed = Math.min(edM, edS);
      const refY = edM <= edS ? main.y : sc.y;
      const w = smoothstep(0, 26, ed);
      y = lerp(refY, this.terrainBase(x, z), w) +
        w * 0.22 * Math.sin(x * 0.9) * Math.cos(z * 0.8);
      surface = 'grass';
    }

    const smp = this.samples[main.index];
    return {
      surface, y, main, sc,
      edgeMain: latM - this.halfWidth,
      wallL: smp.wallL, wallR: smp.wallR,
      onPad: surface === 'road' && this.isOnPad(main.s, main.lateral),
    };
  }

  isOnPad(s, lateral) {
    for (const p of this.pads) {
      let inS;
      if (p.s1 <= this.length) inS = s >= p.s0 && s <= p.s1;
      else inS = s >= p.s0 || s <= p.s1 - this.length;
      if (inS && Math.abs(lateral - p.latC) <= p.halfw) return true;
    }
    return false;
  }

  /**
   * Terrain-mesh / prop-placement height. No hints; handles overpasses by
   * preferring the *lower* of two overlapping road sections so the ground
   * hugs the bottom road instead of bulging up under a bridge.
   */
  groundHeightGlobal(x, z) {
    const a = this.nearestOnMain(x, z, -1);
    // find a second candidate in a different part of the loop
    let b = null;
    let coarseBest = -1, coarseD = Infinity;
    for (let i = 0; i < this.n; i += 4) {
      const gap = Math.abs(i - a.index);
      const circGap = Math.min(gap, this.n - gap);
      if (circGap < 90) continue;
      const p = this.samples[i].pos;
      const dx = x - p.x, dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < coarseD) { coarseD = d2; coarseBest = i; }
    }
    if (coarseBest >= 0) {
      b = this.nearestOnMain(x, z, coarseBest, 8);
    }
    let chosen = a;
    if (b && b.dist < a.dist + 12 && b.y < a.y - 2) chosen = b;

    let edM = Math.abs(chosen.lateral) - this.halfWidth;
    let refY = chosen.y;
    if (this.shortcut) {
      const sc = this.nearestOnShortcut(x, z, -1);
      const edS = Math.abs(sc.lateral) - this.shortcut.halfWidth;
      if (edS < edM) { edM = edS; refY = sc.y; }
    }
    if (edM <= 0) return { y: refY, edge: edM };
    const w = smoothstep(0, 26, edM);
    const y = lerp(refY, this.terrainBase(x, z), w) +
      w * 0.22 * Math.sin(x * 0.9) * Math.cos(z * 0.8);
    return { y, edge: edM };
  }

  /** Grid slot for racer i (0 = pole, at the back of the line). */
  startPlacement(i) {
    const row = Math.floor(i / 2);
    const lane = i % 2;
    const s = ((this.length - (9 + row * 5.5)) % this.length + this.length) % this.length;
    const smp = this.sampleAt(s);
    const lat = (lane === 0 ? -1 : 1) * (2.7 + (row % 2) * 0.5);
    const pos = smp.pos.clone().addScaledVector(smp.left, lat);
    return { pos, heading: Math.atan2(smp.tan.x, smp.tan.z), s };
  }
}

export { UP };

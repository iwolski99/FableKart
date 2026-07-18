// All textures are painted onto canvases at load time — zero external assets.
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = size[0]; c.height = size[1];
  draw(c.getContext('2d'), c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const css = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Road surface: asphalt speckle, edge lines, dashed center line. */
export function makeRoadTexture(tint = 0xffffff, edgeColor = '#e8e4da') {
  return canvasTexture([256, 256], (ctx, w, h) => {
    const rng = makeRng(101);
    ctx.fillStyle = '#3d3f46';
    ctx.fillRect(0, 0, w, h);
    // speckle
    for (let i = 0; i < 2600; i++) {
      const g = 46 + Math.floor(rng() * 46);
      ctx.fillStyle = `rgb(${g},${g},${g + 4})`;
      ctx.fillRect(rng() * w, rng() * h, 2, 2);
    }
    // faint tire wear bands
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.28, 'rgba(0,0,0,0.18)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // edge lines
    ctx.fillStyle = edgeColor;
    ctx.fillRect(10, 0, 6, h);
    ctx.fillRect(w - 16, 0, 6, h);
    // dashed center
    ctx.fillStyle = 'rgba(240,235,210,0.85)';
    for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 3, y, 6, 34);
    // tint pass
    const t = new THREE.Color(tint);
    ctx.fillStyle = `rgba(${(t.r * 255) | 0},${(t.g * 255) | 0},${(t.b * 255) | 0},0.12)`;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}

export function makeDirtTexture() {
  return canvasTexture([128, 128], (ctx, w, h) => {
    const rng = makeRng(77);
    ctx.fillStyle = '#8a6a42';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const v = rng();
      ctx.fillStyle = v < 0.5 ? '#7a5c38' : v < 0.8 ? '#977851' : '#6b4f30';
      const s = 1 + rng() * 3;
      ctx.fillRect(rng() * w, rng() * h, s, s);
    }
    // ruts
    ctx.strokeStyle = 'rgba(80,58,34,0.5)';
    ctx.lineWidth = 5;
    for (const x of [w * 0.3, w * 0.7]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6, h * 0.3, x - 6, h * 0.7, x, h);
      ctx.stroke();
    }
  });
}

export function makeGrassTexture(colorA, colorB) {
  return canvasTexture([128, 128], (ctx, w, h) => {
    const rng = makeRng(55);
    ctx.fillStyle = css(colorA);
    ctx.fillRect(0, 0, w, h);
    const cb = new THREE.Color(colorB);
    for (let i = 0; i < 1800; i++) {
      const k = 0.75 + rng() * 0.5;
      ctx.fillStyle = `rgb(${(cb.r * 255 * k) | 0},${(cb.g * 255 * k) | 0},${(cb.b * 255 * k) | 0})`;
      ctx.fillRect(rng() * w, rng() * h, 2, 2 + rng() * 3);
    }
  }, { repeat: [40, 40] });
}

export function makeCurbTexture(a, b) {
  return canvasTexture([64, 64], (ctx, w, h) => {
    ctx.fillStyle = css(a);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = css(b);
    ctx.fillRect(0, 0, w, h / 2);
  }, { repeat: [1, 1] });
}

export function makeCheckerTexture() {
  return canvasTexture([128, 32], (ctx, w, h) => {
    const s = 16;
    for (let y = 0; y < h / s; y++) {
      for (let x = 0; x < w / s; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#1a1a20' : '#f4f2ec';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  });
}

export function makeParticleTexture() {
  return canvasTexture([64, 64], (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { srgb: false });
}

export function makeWindowsTexture(seed = 9) {
  return canvasTexture([128, 256], (ctx, w, h) => {
    const rng = makeRng(seed);
    ctx.fillStyle = '#11141f';
    ctx.fillRect(0, 0, w, h);
    const cols = 6, rows = 16;
    const cw = w / cols, ch = h / rows;
    const palette = ['#ffe9a8', '#ffd27c', '#9fd8ff', '#c8fff0', '#ffb4d8'];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (rng() < 0.44) {
          ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
          ctx.globalAlpha = 0.5 + rng() * 0.5;
          ctx.fillRect(x * cw + 3, y * ch + 3, cw - 6, ch - 7);
        }
      }
    }
    ctx.globalAlpha = 1;
  });
}

export function makeLavaTexture() {
  return canvasTexture([256, 256], (ctx, w, h) => {
    const rng = makeRng(31);
    ctx.fillStyle = '#e2400c';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const x = rng() * w, y = rng() * h, r = 12 + rng() * 42;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      const hot = rng() < 0.5;
      g.addColorStop(0, hot ? 'rgba(255,236,120,0.95)' : 'rgba(120,16,4,0.9)');
      g.addColorStop(1, 'rgba(226,64,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // dark crust cracks
    ctx.strokeStyle = 'rgba(50,8,2,0.65)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 22; i++) {
      ctx.beginPath();
      let x = rng() * w, y = rng() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rng() - 0.5) * 70; y += (rng() - 0.5) * 70;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, { repeat: [2, 2] });
}

/** "?" face for item boxes. */
export function makeItemBoxTexture() {
  return canvasTexture([128, 128], (ctx, w, h) => {
    ctx.fillStyle = 'rgba(255,255,255,0)';
    ctx.clearRect(0, 0, w, h);
    ctx.font = '900 92px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(120,70,0,0.9)';
    ctx.strokeText('?', w / 2, h / 2 + 6);
    ctx.fillStyle = '#fff6d8';
    ctx.fillText('?', w / 2, h / 2 + 6);
  });
}

export function makeBoostChevronTexture(color = '#ffde3a') {
  return canvasTexture([128, 128], (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    // two chevrons pointing "up" (direction of travel = +v)
    for (const oy of [8, 62]) {
      ctx.beginPath();
      ctx.moveTo(10, oy + 44);
      ctx.lineTo(w / 2, oy);
      ctx.lineTo(w - 10, oy + 44);
      ctx.lineTo(w - 10, oy + 20);
      ctx.lineTo(w / 2, oy - 24);
      ctx.lineTo(10, oy + 20);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Big banner text (start gate). */
export function makeBannerTexture(text) {
  return canvasTexture([512, 128], (ctx, w, h) => {
    ctx.fillStyle = '#14162c';
    ctx.fillRect(0, 0, w, h);
    const s = 16;
    for (let x = 0; x < w / s; x++) {
      ctx.fillStyle = x % 2 ? '#f4f2ec' : '#1a1a20';
      ctx.fillRect(x * s, 0, s, s);
      ctx.fillStyle = x % 2 ? '#1a1a20' : '#f4f2ec';
      ctx.fillRect(x * s, h - s, s, s);
    }
    ctx.font = '900 italic 64px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffce3a';
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
}

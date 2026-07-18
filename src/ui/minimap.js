// Canvas minimap: prerendered track path + live kart dots.
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.size = 170;
    canvas.width = this.size * 2;   // retina
    canvas.height = this.size * 2;
    this.base.width = canvas.width;
    this.base.height = canvas.height;
  }

  setTrack(track) {
    this.track = track;
    const ctx = this.base.getContext('2d');
    const W = this.base.width;
    ctx.clearRect(0, 0, W, W);

    // fit bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    }
    const pad = 26;
    const scale = (W - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (W - (maxX - minX) * scale) / 2;
    const oz = (W - (maxZ - minZ) * scale) / 2;
    this._map = (x, z) => [ox + (x - minX) * scale, oz + (z - minZ) * scale];

    const trace = (samples, close) => {
      ctx.beginPath();
      samples.forEach((s, i) => {
        const [px, pz] = this._map(s.pos.x, s.pos.z);
        i === 0 ? ctx.moveTo(px, pz) : ctx.lineTo(px, pz);
      });
      if (close) ctx.closePath();
    };

    // main outline
    trace(track.samples, true);
    ctx.lineWidth = 13;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineJoin = 'round';
    ctx.stroke();
    trace(track.samples, true);
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();

    // shortcut (dashed)
    if (track.shortcut) {
      trace(track.shortcut.samples, false);
      ctx.lineWidth = 5;
      ctx.setLineDash([7, 7]);
      ctx.strokeStyle = 'rgba(255,206,58,0.9)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // start line notch
    const s0 = track.sampleAt(0);
    const [sx, sz] = this._map(s0.pos.x, s0.pos.z);
    ctx.fillStyle = '#ffce3a';
    ctx.beginPath();
    ctx.arc(sx, sz, 6, 0, 7);
    ctx.fill();
  }

  update(karts, player) {
    if (!this.track) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    for (const k of karts) {
      if (k === player) continue;
      const [x, z] = this._map(k.pos.x, k.pos.z);
      ctx.fillStyle = `#${k.character.color.toString(16).padStart(6, '0')}`;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, z, 6, 0, 7);
      ctx.fill();
      ctx.stroke();
    }
    // player on top, bigger with ring
    const [x, z] = this._map(player.pos.x, player.pos.z);
    ctx.fillStyle = `#${player.character.color.toString(16).padStart(6, '0')}`;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(x, z, 9, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
}

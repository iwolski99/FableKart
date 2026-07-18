// Vector item icons drawn with canvas 2D — shared by the HUD item slot and
// the roulette animation.

export const ITEM_LIST = ['boost', 'rocket', 'mine', 'star', 'bolt', 'shield'];

export function drawItemIcon(ctx, type, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 100; // icons authored on a 100x100 grid centered at 0
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (type) {
    case 'boost': {
      // triple chevron
      ctx.fillStyle = '#ff9d2e';
      ctx.strokeStyle = '#7a3c00';
      ctx.lineWidth = 5;
      for (let i = -1; i <= 1; i++) {
        const oy = i * 26;
        ctx.beginPath();
        ctx.moveTo(-30, 16 + oy);
        ctx.lineTo(0, -12 + oy);
        ctx.lineTo(30, 16 + oy);
        ctx.lineTo(30, 2 + oy);
        ctx.lineTo(0, -26 + oy);
        ctx.lineTo(-30, 2 + oy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'rocket': {
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#e84545';
      ctx.strokeStyle = '#6d1010';
      ctx.lineWidth = 5;
      ctx.beginPath(); // body
      ctx.moveTo(0, -40);
      ctx.quadraticCurveTo(20, -12, 14, 18);
      ctx.lineTo(-14, 18);
      ctx.quadraticCurveTo(-20, -12, 0, -40);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // window
      ctx.fillStyle = '#bfe8ff';
      ctx.beginPath(); ctx.arc(0, -8, 8, 0, 7); ctx.fill(); ctx.stroke();
      // fins
      ctx.fillStyle = '#ffce3a';
      ctx.beginPath();
      ctx.moveTo(-14, 6); ctx.lineTo(-28, 26); ctx.lineTo(-12, 20); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(14, 6); ctx.lineTo(28, 26); ctx.lineTo(12, 20); ctx.closePath();
      ctx.fill(); ctx.stroke();
      // flame
      ctx.fillStyle = '#ff9d2e';
      ctx.beginPath();
      ctx.moveTo(-8, 22); ctx.quadraticCurveTo(0, 44, 8, 22); ctx.closePath();
      ctx.fill();
      break;
    }
    case 'mine': {
      ctx.fillStyle = '#2b2f3d';
      ctx.strokeStyle = '#0d0f16';
      ctx.lineWidth = 5;
      // spikes
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22);
        ctx.lineTo(Math.cos(a) * 40, Math.sin(a) * 40);
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#2b2f3d';
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, 7);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#0d0f16';
      ctx.stroke();
      // blinking light
      ctx.fillStyle = '#ff4040';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffb0b0';
      ctx.beginPath(); ctx.arc(-3, -3, 3.5, 0, 7); ctx.fill();
      break;
    }
    case 'star': {
      ctx.fillStyle = '#ffd94e';
      ctx.strokeStyle = '#8a6100';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 40 : 17;
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // eyes
      ctx.fillStyle = '#3a2c00';
      ctx.beginPath(); ctx.arc(-8, 2, 3.4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(8, 2, 3.4, 0, 7); ctx.fill();
      break;
    }
    case 'bolt': {
      ctx.fillStyle = '#ffe14a';
      ctx.strokeStyle = '#8a6100';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(8, -42);
      ctx.lineTo(-18, 6);
      ctx.lineTo(-2, 6);
      ctx.lineTo(-8, 42);
      ctx.lineTo(20, -8);
      ctx.lineTo(3, -8);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'shield': {
      const g = ctx.createRadialGradient(-8, -10, 4, 0, 0, 42);
      g.addColorStop(0, 'rgba(210,245,255,0.95)');
      g.addColorStop(0.6, 'rgba(84,200,255,0.55)');
      g.addColorStop(1, 'rgba(40,120,255,0.35)');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#1b6bb0';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, 38, 0, 7);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, 26, -2.4, -1.2); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

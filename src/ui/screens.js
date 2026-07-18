// Menu flow: title → character select → track select → (race) → results.
// All DOM-based, keyboard + mouse navigable.
import { audio } from '../core/audio.js';
import { CHARACTERS } from '../config/characters.js';
import { TRACKS } from '../config/tracks.js';
import { DIFFICULTIES } from '../config/difficulty.js';
import { formatTime } from './hud.js';

const bestKey = (trackId) => `fablekart_best_${trackId}`;
export const getBestTime = (trackId) => {
  const v = localStorage.getItem(bestKey(trackId));
  return v ? parseFloat(v) : null;
};
export const setBestTime = (trackId, t) => {
  localStorage.setItem(bestKey(trackId), String(t));
};

function drawKartIcon(ctx, ch, w, h) {
  const color = `#${ch.color.toString(16).padStart(6, '0')}`;
  const helmet = `#${(ch.helmet ?? 0xffffff).toString(16).padStart(6, '0')}`;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2 + 8);
  const s = w / 150;
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 26, 52, 9, 0, 0, 7); ctx.fill();
  // body
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-46, 8);
  ctx.quadraticCurveTo(-50, -8, -30, -10);
  ctx.lineTo(6, -10);
  ctx.quadraticCurveTo(40, -10, 52, 2);
  ctx.quadraticCurveTo(56, 10, 44, 12);
  ctx.lineTo(-40, 12);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // spoiler
  ctx.fillStyle = color;
  ctx.fillRect(-52, -18, 16, 5);
  ctx.fillRect(-46, -13, 5, 8);
  ctx.strokeRect(-52, -18, 16, 5);
  // driver
  ctx.fillStyle = helmet;
  ctx.beginPath(); ctx.arc(-8, -22, 13, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#10121c';
  ctx.beginPath(); ctx.arc(-3, -22, 6, -0.9, 0.9); ctx.fill();
  // wheels
  for (const x of [-30, 30]) {
    ctx.fillStyle = '#17181d';
    ctx.beginPath(); ctx.arc(x, 14, 13, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c8c8d2';
    ctx.beginPath(); ctx.arc(x, 14, 5.5, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawTrackPreview(ctx, trackData, w, h) {
  ctx.clearRect(0, 0, w, h);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of trackData.samples) {
    minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
    minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
  }
  const pad = 16;
  const scale = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
  const ox = (w - (maxX - minX) * scale) / 2;
  const oz = (h - (maxZ - minZ) * scale) / 2;
  const map = (x, z) => [ox + (x - minX) * scale, oz + (z - minZ) * scale];

  const trace = (samples, close) => {
    ctx.beginPath();
    samples.forEach((s, i) => {
      const [px, pz] = map(s.pos.x, s.pos.z);
      i === 0 ? ctx.moveTo(px, pz) : ctx.lineTo(px, pz);
    });
    if (close) ctx.closePath();
  };
  trace(trackData.samples, true);
  ctx.lineWidth = 9; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  trace(trackData.samples, true);
  ctx.lineWidth = 5.5;
  ctx.strokeStyle = '#e8eaff';
  ctx.stroke();
  if (trackData.shortcut) {
    trace(trackData.shortcut.samples, false);
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffce3a';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const s0 = trackData.sampleAt(0);
  const [sx, sz] = map(s0.pos.x, s0.pos.z);
  ctx.fillStyle = '#ffce3a';
  ctx.beginPath(); ctx.arc(sx, sz, 4, 0, 7); ctx.fill();
}

export class Screens {
  constructor(root) {
    this.root = root;
    this.current = null;
    this._keyHandler = null;
  }

  _mount(el, keyHandler = null) {
    this.hide();
    this.root.appendChild(el);
    this.current = el;
    if (keyHandler) {
      this._keyHandler = keyHandler;
      window.addEventListener('keydown', keyHandler);
    }
  }

  hide() {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this.current) {
      this.current.remove();
      this.current = null;
    }
  }

  // ---------------- title ----------------
  showTitle(onStart, onSettings) {
    const el = document.createElement('div');
    el.className = 'screen bg-shade';
    el.innerHTML = `
      <div class="title-logo">FABLE<span>KART</span></div>
      <div class="title-tag">procedural arcade racing</div>
      <div class="menu-hint">press ENTER or click to race</div>
      <div class="foot-hint" style="margin-top:60px">
        <b>WASD/↑↓←→</b> drive &nbsp; <b>SPACE/SHIFT</b> drift &nbsp;
        <b>E/ENTER</b> item &nbsp; <b>ESC</b> settings &nbsp; <b>M</b> mute
      </div>`;
    const go = () => { audio.init(); audio.uiSelect(); onStart(); };
    el.addEventListener('pointerdown', go);
    this._mount(el, (e) => {
      if (e.code === 'Enter' || e.code === 'Space') go();
      else if (e.code === 'Escape' && onSettings) { audio.uiMove(); onSettings(); }
    });
  }

  // ---------------- character select ----------------
  showCharacterSelect(onPick, onBack) {
    const el = document.createElement('div');
    el.className = 'screen bg-shade';
    el.innerHTML = `<h2 class="screen-title">Choose your <em>racer</em></h2>`;
    const row = document.createElement('div');
    row.className = 'card-row';
    let sel = 0;
    const cards = CHARACTERS.map((ch, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <canvas width="186" height="120"></canvas>
        <div class="card-name">${ch.name}</div>
        <div class="card-sub">${ch.blurb}</div>
        <div class="statbars">
          ${[['speed', ch.speed], ['accel', ch.accel], ['turn', ch.handling], ['weight', ch.weight]]
            .map(([label, v]) => `
            <div class="statbar"><label>${label}</label>
              <div class="bar"><i style="width:${Math.round(18 + v * 82)}%"></i></div>
            </div>`).join('')}
        </div>`;
      drawKartIcon(card.querySelector('canvas').getContext('2d'), ch, 186, 120);
      card.addEventListener('pointerenter', () => { if (sel !== i) { sel = i; update(); } });
      card.addEventListener('click', () => { sel = i; update(); pick(); });
      row.appendChild(card);
      return card;
    });
    el.appendChild(row);
    const foot = document.createElement('div');
    foot.className = 'foot-hint';
    foot.innerHTML = `<b>←→</b> choose &nbsp; <b>ENTER</b> confirm &nbsp; <b>ESC</b> back`;
    el.appendChild(foot);

    const update = () => {
      cards.forEach((c, i) => c.classList.toggle('selected', i === sel));
      audio.uiMove();
    };
    const pick = () => { audio.uiSelect(); onPick(CHARACTERS[sel].id); };
    cards[0].classList.add('selected');

    this._mount(el, (e) => {
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { sel = (sel + 1) % cards.length; update(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { sel = (sel + cards.length - 1) % cards.length; update(); }
      else if (e.code === 'Enter' || e.code === 'Space') pick();
      else if (e.code === 'Escape' && onBack) { audio.uiMove(); onBack(); }
    });
  }

  // ---------------- track select ----------------
  showTrackSelect(getTrackData, onPick, onBack) {
    const el = document.createElement('div');
    el.className = 'screen bg-shade';
    el.innerHTML = `<h2 class="screen-title">Pick a <em>track</em></h2>`;
    const row = document.createElement('div');
    row.className = 'card-row';
    let sel = 0;
    const cards = TRACKS.map((tr, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      const best = getBestTime(tr.id);
      card.innerHTML = `
        <canvas width="186" height="130"></canvas>
        <div class="card-name">${tr.name}</div>
        <div class="card-sub">${tr.tagline}</div>
        <div class="track-meta">
          <span>${'★'.repeat(tr.difficulty)}${'☆'.repeat(3 - tr.difficulty)}</span>
          <span>${tr.laps} laps</span>
        </div>
        <div class="track-meta"><span>best</span><b>${best ? formatTime(best) : '—'}</b></div>`;
      drawTrackPreview(card.querySelector('canvas').getContext('2d'), getTrackData(tr.id), 186, 130);
      card.addEventListener('pointerenter', () => { if (sel !== i) { sel = i; update(); } });
      card.addEventListener('click', () => { sel = i; update(); pick(); });
      row.appendChild(card);
      return card;
    });
    el.appendChild(row);
    const foot = document.createElement('div');
    foot.className = 'foot-hint';
    foot.innerHTML = `<b>←→</b> choose &nbsp; <b>ENTER</b> race! &nbsp; <b>ESC</b> back`;
    el.appendChild(foot);

    const update = () => {
      cards.forEach((c, i) => c.classList.toggle('selected', i === sel));
      audio.uiMove();
    };
    const pick = () => { audio.uiSelect(); onPick(TRACKS[sel].id); };
    cards[0].classList.add('selected');

    this._mount(el, (e) => {
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { sel = (sel + 1) % cards.length; update(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { sel = (sel + cards.length - 1) % cards.length; update(); }
      else if (e.code === 'Enter' || e.code === 'Space') pick();
      else if (e.code === 'Escape' && onBack) { audio.uiMove(); onBack(); }
    });
  }

  // ---------------- results ----------------
  showResults(standings, raceTime, trackId, { onAgain, onNewTrack, onMenu }) {
    const el = document.createElement('div');
    el.className = 'screen bg-shade';
    const playerRow = standings.find((s) => s.isPlayer);
    const playerRank = standings.indexOf(playerRow) + 1;
    const headline = playerRank === 1 ? 'VICTORY!'
      : playerRank <= 3 ? 'ON THE PODIUM!' : 'RACE COMPLETE';

    // best time bookkeeping (only for finished player runs)
    let bestNote = '';
    if (playerRow?.finished && playerRow.time != null) {
      const prev = getBestTime(trackId);
      if (prev == null || playerRow.time < prev) {
        setBestTime(trackId, playerRow.time);
        bestNote = `★ new track record: ${formatTime(playerRow.time)} ★`;
      }
    }

    const medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = `
      <div class="results-headline">${headline}</div>
      <div class="results-panel">
        ${standings.map((s, i) => `
          <div class="standing-row p${i + 1} ${s.isPlayer ? 'you' : ''}" style="animation-delay:${i * 70}ms">
            <span class="place">${medals[i] ?? ''} ${i + 1}</span>
            <span class="swatch" style="background:#${s.color.toString(16).padStart(6, '0')}"></span>
            <span>${s.name}${s.isPlayer ? ' (you)' : ''}</span>
            <span class="rtime">${s.finished && s.time != null ? formatTime(s.time) : 'DNF'}</span>
          </div>`).join('')}
        <div class="best-time-note">${bestNote}</div>
      </div>
      <div class="btn-row">
        <button class="btn" data-act="again">Race Again</button>
        <button class="btn secondary" data-act="track">Change Track</button>
        <button class="btn secondary" data-act="menu">Main Menu</button>
      </div>`;

    // confetti for a podium
    if (playerRank <= 3) {
      const colors = ['#ffce3a', '#ff5f8f', '#29d3ff', '#7cf7c4', '#bf6fff'];
      for (let i = 0; i < 90; i++) {
        const c = document.createElement('div');
        c.className = 'confetti';
        c.style.left = `${Math.random() * 100}%`;
        c.style.background = colors[i % colors.length];
        c.style.animationDuration = `${2.6 + Math.random() * 2.4}s`;
        c.style.animationDelay = `${Math.random() * 2}s`;
        el.appendChild(c);
      }
    }

    el.querySelector('[data-act="again"]').addEventListener('click', () => { audio.uiSelect(); onAgain(); });
    el.querySelector('[data-act="track"]').addEventListener('click', () => { audio.uiSelect(); onNewTrack(); });
    el.querySelector('[data-act="menu"]').addEventListener('click', () => { audio.uiSelect(); onMenu(); });
    this._mount(el, (e) => {
      if (e.code === 'Enter') { audio.uiSelect(); onAgain(); }
      else if (e.code === 'Escape') { audio.uiSelect(); onMenu(); }
    });
  }

  // ---------------- pause ----------------
  showPause({ onResume, onRestart, onQuit, onSettings }) {
    const el = document.createElement('div');
    el.className = 'screen bg-shade';
    el.innerHTML = `
      <div class="pause-panel">
        <h2>PAUSED</h2>
        <div class="btn-row">
          <button class="btn" data-act="resume">Resume</button>
          <button class="btn secondary" data-act="settings">Settings</button>
          <button class="btn secondary" data-act="restart">Restart</button>
          <button class="btn secondary" data-act="quit">Quit</button>
        </div>
      </div>`;
    el.querySelector('[data-act="resume"]').addEventListener('click', () => { audio.uiSelect(); onResume(); });
    el.querySelector('[data-act="settings"]').addEventListener('click', () => { audio.uiSelect(); onSettings(); });
    el.querySelector('[data-act="restart"]').addEventListener('click', () => { audio.uiSelect(); onRestart(); });
    el.querySelector('[data-act="quit"]').addEventListener('click', () => { audio.uiSelect(); onQuit(); });
    this._mount(el, (e) => {
      if (e.code === 'Escape' || e.code === 'Enter') { audio.uiSelect(); onResume(); }
    });
  }

  // ---------------- settings ----------------
  showSettings(volumes, engineMode, difficultyId, onChange, onEngineModeChange, onDifficultyChange, onBack) {
    const el = document.createElement('div');
    el.className = 'screen bg-shade';
    const sliderRow = (label, kind, value) => `
      <div class="vol-row">
        <label for="vol-${kind}">${label}</label>
        <input id="vol-${kind}" type="range" min="0" max="100" value="${Math.round(value * 100)}"
          data-kind="${kind}" style="--fill:${Math.round(value * 100)}%" />
        <span class="vol-val" data-val="${kind}">${Math.round(value * 100)}%</span>
      </div>`;
    el.innerHTML = `
      <h2 class="screen-title">Settings</h2>
      <div class="settings-panel">
        ${sliderRow('Music', 'music', volumes.music)}
        ${sliderRow('SFX', 'sfx', volumes.sfx)}
        ${sliderRow('Vocals', 'vocals', volumes.vocals)}
        ${sliderRow('Engine', 'engine', volumes.engine)}
        <div class="vol-row">
          <label>Type</label>
          <div class="segmented" data-group="engine">
            <button class="seg-btn ${engineMode === 'sample' ? 'active' : ''}" data-value="sample">Realistic</button>
            <button class="seg-btn ${engineMode === 'synth' ? 'active' : ''}" data-value="synth">Synth</button>
          </div>
        </div>
        <div class="vol-row">
          <label>Skill</label>
          <div class="segmented" data-group="difficulty">
            ${DIFFICULTIES.map((d) => `
              <button class="seg-btn ${difficultyId === d.id ? 'active' : ''}" data-value="${d.id}">${d.name}</button>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn" data-act="back">Back</button>
      </div>`;
    el.querySelectorAll('input[type="range"]').forEach((input) => {
      input.addEventListener('input', () => {
        const { kind } = input.dataset;
        const v = Number(input.value) / 100;
        input.style.setProperty('--fill', `${input.value}%`);
        el.querySelector(`.vol-val[data-val="${kind}"]`).textContent = `${input.value}%`;
        onChange(kind, v);
      });
    });
    el.querySelectorAll('.segmented').forEach((group) => {
      const handler = group.dataset.group === 'engine' ? onEngineModeChange : onDifficultyChange;
      group.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          audio.uiMove();
          group.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
          handler(btn.dataset.value);
        });
      });
    });
    el.querySelector('[data-act="back"]').addEventListener('click', () => { audio.uiSelect(); onBack(); });
    this._mount(el, (e) => {
      if (e.code === 'Escape' || e.code === 'Enter') { audio.uiSelect(); onBack(); }
    });
  }
}

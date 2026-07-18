// In-race HUD: position, lap, timer, speed, item slot (with roulette),
// countdown numbers, banners, wrong-way warning, screen flashes, minimap host.
import { audio } from '../core/audio.js';
import { drawItemIcon, ITEM_LIST } from './itemIcons.js';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-pos"><span id="hud-pos-num">8</span><sup id="hud-pos-suf">th</sup></div>
      <div class="hud-lap" id="hud-lap">LAP 1/3</div>
      <div class="hud-timer" id="hud-timer">0:00.00</div>
      <div class="hud-speed"><span id="hud-speed-num">0</span> <small>km/h</small></div>
      <div class="hud-item" id="hud-item"><canvas id="hud-item-canvas" width="144" height="144"></canvas></div>
      <div class="hud-item-hint">E / Enter</div>
      <div id="minimap-wrap"><canvas id="minimap-canvas"></canvas></div>
      <div class="hud-center" id="hud-center" style="display:none"></div>
      <div class="hud-wrongway" id="hud-wrongway" style="display:none">WRONG WAY!</div>
      <div class="hud-flash" id="hud-flash"></div>
    `;
    this.el = {
      posNum: root.querySelector('#hud-pos-num'),
      posSuf: root.querySelector('#hud-pos-suf'),
      lap: root.querySelector('#hud-lap'),
      timer: root.querySelector('#hud-timer'),
      speed: root.querySelector('#hud-speed-num'),
      item: root.querySelector('#hud-item'),
      center: root.querySelector('#hud-center'),
      wrongway: root.querySelector('#hud-wrongway'),
      flash: root.querySelector('#hud-flash'),
    };
    this.itemCtx = root.querySelector('#hud-item-canvas').getContext('2d');
    this.minimapCanvas = root.querySelector('#minimap-canvas');
    this._lastItemDrawn = 'none';
    this._rouletteIdx = 0;
    this._rouletteTick = 0;
    this._flashT = 0;
    this._flashDur = 0;
  }

  show() { this.root.classList.add('active'); }
  hide() {
    this.root.classList.remove('active');
    this.el.center.style.display = 'none';
  }

  showCount(text) {
    const c = this.el.center;
    c.style.display = 'block';
    c.textContent = text;
    c.classList.remove('count-pop');
    void c.offsetWidth; // restart animation
    c.classList.add('count-pop');
  }

  showBanner(text) {
    const b = document.createElement('div');
    b.className = 'hud-banner';
    b.textContent = text;
    this.root.appendChild(b);
    setTimeout(() => b.remove(), 2300);
  }

  flash(color, dur = 0.3) {
    this.el.flash.style.background = color;
    this._flashT = dur;
    this._flashDur = dur;
  }

  update(race, player) {
    const dt = 1 / 60;
    // position
    const rank = player.rank;
    const ord = ORDINALS[rank - 1] || `${rank}th`;
    this.el.posNum.textContent = String(rank);
    this.el.posSuf.textContent = ord.replace(/^\d+/, '');

    // lap
    const lapNow = Math.min(race.laps, Math.max(1, player.lap + 1));
    this.el.lap.textContent = player.finished ? 'DONE' : `LAP ${lapNow}/${race.laps}`;

    // timer + speed
    this.el.timer.textContent = formatTime(race.raceTime);
    this.el.speed.textContent = String(Math.round(Math.abs(player.speed) * 3.1));

    // wrong way
    this.el.wrongway.style.display = player.wrongWayTimer > 1.1 ? 'block' : 'none';

    // flash overlay
    if (this._flashT > 0) {
      this._flashT = Math.max(0, this._flashT - dt);
      this.el.flash.style.opacity = (this._flashT / this._flashDur) * 0.9;
    } else {
      this.el.flash.style.opacity = 0;
    }

    // item slot
    let toDraw = 'empty';
    if (player.rouletteT > 0) {
      this._rouletteTick -= dt;
      if (this._rouletteTick <= 0) {
        this._rouletteTick = 0.07;
        this._rouletteIdx = (this._rouletteIdx + 1) % ITEM_LIST.length;
        audio.rouletteTick();
      }
      toDraw = `roulette:${this._rouletteIdx}`;
    } else if (player.item) {
      toDraw = player.item;
    }
    if (toDraw !== this._lastItemDrawn) {
      this._lastItemDrawn = toDraw;
      const ctx = this.itemCtx;
      ctx.clearRect(0, 0, 144, 144);
      if (toDraw.startsWith('roulette:')) {
        drawItemIcon(ctx, ITEM_LIST[this._rouletteIdx], 72, 72, 108);
        this.el.item.classList.remove('has-item');
      } else if (toDraw !== 'empty') {
        drawItemIcon(ctx, toDraw, 72, 72, 120);
        this.el.item.classList.add('has-item');
      } else {
        this.el.item.classList.remove('has-item');
      }
    }
  }
}

// Fully procedural audio: engine loop, synthesized SFX and a tiny generative
// chiptune sequencer. No samples, everything is oscillators + shaped noise.
import { clamp } from './rng.js';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.muted = false;
    this.engine = null;
    this.skid = null;
    this.music = null;
    this._noiseBuf = null;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.knee.value = 22;
    this.master.ratio.value = 8;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.9;
    this.master.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.42;
    this.musicBus.connect(this.master);

    this._noiseBuf = this._makeNoiseBuffer();
    this.music = new Music(this.ctx, this.musicBus);
  }

  setMuted(m) {
    this.muted = m;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
    }
  }
  toggleMuted() { this.setMuted(!this.muted); return this.muted; }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------- primitive voices ----------

  _tone({ freq = 440, endFreq = null, dur = 0.15, type = 'square', gain = 0.2,
          attack = 0.005, when = 0, bus = null }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(g).connect(bus || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.3, gain = 0.25, filter = 1200, endFilter = null, q = 0.8,
           type = 'lowpass', when = 0, attack = 0.004 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, t0);
    if (endFilter != null) f.frequency.exponentialRampToValueAtTime(Math.max(40, endFilter), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ---------- named SFX ----------

  uiMove()   { this._tone({ freq: 620, dur: 0.06, type: 'square', gain: 0.1 }); }
  uiSelect() {
    this._tone({ freq: 660, dur: 0.09, gain: 0.14 });
    this._tone({ freq: 990, dur: 0.14, gain: 0.14, when: 0.07 });
  }
  countBeep(final = false) {
    if (final) {
      this._tone({ freq: 880, dur: 0.5, type: 'square', gain: 0.22 });
      this._tone({ freq: 1320, dur: 0.5, type: 'sawtooth', gain: 0.1 });
    } else {
      this._tone({ freq: 440, dur: 0.16, type: 'square', gain: 0.2 });
    }
  }
  boost(pitch = 1) {
    this._noise({ dur: 0.55, gain: 0.3, filter: 900 * pitch, endFilter: 5200 * pitch, type: 'bandpass', q: 1.2 });
    this._tone({ freq: 190 * pitch, endFreq: 720 * pitch, dur: 0.4, type: 'sawtooth', gain: 0.16 });
  }
  driftTier(tier) {
    const f = tier === 2 ? 1450 : 1050;
    this._tone({ freq: f, dur: 0.08, type: 'square', gain: 0.13 });
    this._tone({ freq: f * 1.33, dur: 0.1, type: 'square', gain: 0.11, when: 0.06 });
  }
  itemBox() {
    this._tone({ freq: 780, dur: 0.07, gain: 0.13 });
    this._tone({ freq: 1040, dur: 0.07, gain: 0.13, when: 0.055 });
    this._tone({ freq: 1560, dur: 0.12, gain: 0.13, when: 0.11 });
  }
  itemLand() { this._tone({ freq: 520, dur: 0.12, type: 'triangle', gain: 0.18 }); }
  rouletteTick() { this._tone({ freq: 900, dur: 0.03, type: 'square', gain: 0.06 }); }
  rocketFire() {
    this._noise({ dur: 0.7, gain: 0.3, filter: 2600, endFilter: 300, q: 0.6 });
    this._tone({ freq: 300, endFreq: 90, dur: 0.6, type: 'sawtooth', gain: 0.18 });
  }
  explosion() {
    this._noise({ dur: 0.8, gain: 0.5, filter: 2400, endFilter: 120, q: 0.4 });
    this._tone({ freq: 130, endFreq: 38, dur: 0.7, type: 'sawtooth', gain: 0.3 });
  }
  spinOut() {
    this._tone({ freq: 640, endFreq: 130, dur: 0.55, type: 'square', gain: 0.2 });
    this._noise({ dur: 0.35, gain: 0.2, filter: 1600, endFilter: 400 });
  }
  bumpWall(hard = false) {
    this._noise({ dur: hard ? 0.28 : 0.14, gain: hard ? 0.34 : 0.18, filter: 700, endFilter: 160, q: 0.5 });
    this._tone({ freq: 120, endFreq: 60, dur: 0.18, type: 'triangle', gain: 0.22 });
  }
  bumpKart() {
    this._tone({ freq: 210, endFreq: 90, dur: 0.16, type: 'square', gain: 0.2 });
    this._noise({ dur: 0.12, gain: 0.14, filter: 900 });
  }
  star() {
    const seq = [660, 880, 1100, 880, 660, 880, 1100, 1320];
    seq.forEach((f, i) => this._tone({ freq: f, dur: 0.11, type: 'square', gain: 0.11, when: i * 0.09 }));
  }
  lightning() {
    this._noise({ dur: 0.65, gain: 0.4, filter: 6000, endFilter: 500, type: 'highpass', q: 0.5 });
    this._tone({ freq: 1800, endFreq: 90, dur: 0.6, type: 'sawtooth', gain: 0.2 });
  }
  shieldUp() { this._tone({ freq: 330, endFreq: 830, dur: 0.3, type: 'sine', gain: 0.2 }); }
  shieldBlock() {
    this._tone({ freq: 830, endFreq: 330, dur: 0.25, type: 'sine', gain: 0.24 });
    this._noise({ dur: 0.2, gain: 0.16, filter: 3000, type: 'highpass' });
  }
  lap(finalLap = false) {
    const base = finalLap ? [523, 659, 784, 1047] : [523, 659, 784];
    base.forEach((f, i) => this._tone({ freq: f, dur: 0.14, type: 'square', gain: 0.14, when: i * 0.11 }));
  }
  finish(won) {
    const seq = won
      ? [523, 659, 784, 1047, 784, 1047, 1319, 1568]
      : [392, 494, 587, 494, 587, 698];
    seq.forEach((f, i) => this._tone({ freq: f, dur: 0.2, type: 'square', gain: 0.15, when: i * 0.14 }));
  }
  respawn() { this._tone({ freq: 240, endFreq: 560, dur: 0.25, type: 'triangle', gain: 0.16 }); }
  geyser() { this._noise({ dur: 0.9, gain: 0.2, filter: 500, endFilter: 2400, q: 0.5 }); }

  // ---------- engine loop ----------

  startEngine() {
    if (!this.ctx || this.engine) return;
    const t0 = this.ctx.currentTime;
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'square';
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.055, t0 + 0.4);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 3;
    lfo.connect(lfoGain).connect(oscA.frequency);
    oscA.connect(filt); oscB.connect(filt);
    filt.connect(g).connect(this.sfxBus);
    oscA.start(); oscB.start(); lfo.start();
    this.engine = { oscA, oscB, filt, g, lfo };

    const skidSrc = this.ctx.createBufferSource();
    skidSrc.buffer = this._noiseBuf;
    skidSrc.loop = true;
    const skidFilt = this.ctx.createBiquadFilter();
    skidFilt.type = 'bandpass';
    skidFilt.frequency.value = 800;
    skidFilt.Q.value = 1.4;
    const skidGain = this.ctx.createGain();
    skidGain.gain.value = 0;
    skidSrc.connect(skidFilt).connect(skidGain).connect(this.sfxBus);
    skidSrc.start();
    this.skid = { src: skidSrc, filt: skidFilt, g: skidGain };
  }

  /** ratio 0..1 of top speed; drift 0..1 skid intensity */
  setEngine(ratio, drift = 0, boosting = false) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const f = 65 + ratio * 175 + (boosting ? 30 : 0);
    this.engine.oscA.frequency.setTargetAtTime(f, t, 0.06);
    this.engine.oscB.frequency.setTargetAtTime(f * 0.501, t, 0.06);
    this.engine.filt.frequency.setTargetAtTime(400 + ratio * 2600, t, 0.08);
    this.skid.g.gain.setTargetAtTime(drift * 0.16, t, 0.05);
    this.skid.filt.frequency.setTargetAtTime(700 + drift * 700, t, 0.1);
  }

  stopEngine() {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.g.gain.setTargetAtTime(0, t, 0.15);
    this.skid.g.gain.setTargetAtTime(0, t, 0.1);
    const { oscA, oscB, lfo } = this.engine;
    const src = this.skid.src;
    setTimeout(() => { try { oscA.stop(); oscB.stop(); lfo.stop(); src.stop(); } catch { /* already stopped */ } }, 600);
    this.engine = null;
    this.skid = null;
  }

  // ---------- music ----------
  playMusic(mood) { if (this.music) this.music.play(mood); }
  stopMusic() { if (this.music) this.music.stop(); }
}

// ---------------------------------------------------------------------------
// Tiny step-sequencer chiptune. Patterns are generated per "mood".
// ---------------------------------------------------------------------------
const SEMI = 2 ** (1 / 12);
const noteHz = (root, semis) => root * SEMI ** semis;

const MOODS = {
  menu:   { bpm: 96,  root: 110, energy: 0.5, prog: [0, -4, 5, 3] },
  meadow: { bpm: 128, root: 130.81, energy: 0.8, prog: [0, 5, -4, 7] },
  volcano:{ bpm: 132, root: 98,  energy: 1.0, prog: [0, -2, 3, -4] },
  city:   { bpm: 122, root: 116.54, energy: 0.85, prog: [0, 3, -2, 5] },
  results:{ bpm: 84,  root: 130.81, energy: 0.35, prog: [0, 5, 3, 7] },
};

class Music {
  constructor(ctx, bus) {
    this.ctx = ctx;
    this.bus = bus;
    this.timer = null;
    this.step = 0;
    this.nextTime = 0;
    this.mood = null;
  }

  play(moodName) {
    this.stop();
    this.mood = MOODS[moodName] || MOODS.menu;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._schedule(), 40);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _schedule() {
    const stepDur = 60 / this.mood.bpm / 4; // 16th notes
    while (this.nextTime < this.ctx.currentTime + 0.16) {
      this._playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  _playStep(step, t, stepDur) {
    const m = this.mood;
    const bar = (step >> 4) % m.prog.length; // 16 steps per bar
    const chordRoot = m.prog[bar];
    const inBar = step & 15;

    // bass: root pumping on 8ths
    if ((inBar & 1) === 0) {
      const octaveDrop = inBar % 8 === 6 ? 12 : 0;
      this._voice(noteHz(m.root, chordRoot - 12 + octaveDrop), t, stepDur * 1.7, 'square', 0.16);
    }
    // lead arp on 16ths, minor pentatonic-ish shape
    const arpShape = [0, 3, 7, 10, 12, 10, 7, 3];
    if (m.energy > 0.4 || (inBar & 1) === 0) {
      const n = arpShape[(step + bar) % arpShape.length];
      this._voice(noteHz(m.root, chordRoot + n + 12), t, stepDur * 0.9, 'triangle', 0.08 * m.energy + 0.03);
    }
    // sparkle every 4 bars
    if (step % 32 === 24) {
      this._voice(noteHz(m.root, chordRoot + 24), t, stepDur * 3, 'sine', 0.07);
    }
    // hat: shaped noise on off-8ths
    if ((inBar & 3) === 2 && m.energy > 0.3) this._hat(t, 0.03 + 0.03 * m.energy);
    // kick on quarters
    if ((inBar & 3) === 0) this._kick(t, 0.16 * m.energy + 0.05);
  }

  _voice(freq, t, dur, type, gain) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    osc.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  _kick(t, gain) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.16);
    osc.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  _hat(t, gain) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 6030 + Math.random() * 800;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.035);
    osc.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}

export const audio = new AudioManager();
export { clamp };

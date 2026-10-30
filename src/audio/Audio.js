// All sound is synthesized with WebAudio: crickets, birds, wind, footsteps,
// the shutter + film winder, the flash whine, a dial-up modem. No assets.
import { bus } from '../core/events.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.night = 0;
    this._cricketT = 0;
    this._birdT = 2;
    this._dogT = 30;
    this._carT = 20;
    this.enabled = true;

    bus.on('step', (surface, sprint) => this.step(surface, sprint));
    bus.on('land', (s) => this.step(s, true, 1.6));
    bus.on('shutter', ({ flash, wind }) => this.shutter(flash, wind));
    bus.on('sfx', (name) => this.sfx(name));
    bus.on('zoom', () => this.zoomTick());
    bus.on('ufoAudio', (a) => this.ufoAudio(a));
    this.hush = false;
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch {
      this.enabled = false;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    this.amb = c.createGain();
    this.amb.gain.value = 0.7;
    this.amb.connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.connect(this.master);

    // Shared noise buffer.
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Wind bed.
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.6;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0.05;
    src.connect(bp).connect(this.windGain).connect(this.amb);
    src.start();
    this.windFilter = bp;

    // Distant highway / town hum.
    const hum = c.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 55;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    this.humGain = c.createGain();
    this.humGain.gain.value = 0.006;
    hum.connect(lp).connect(this.humGain).connect(this.amb);
    hum.start();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  get t() {
    return this.ctx.currentTime;
  }

  _env(gainNode, t0, a, hold, r, peak) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.setValueAtTime(peak, t0 + a + hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + hold + r);
  }

  _noiseBurst({ t0 = this.t, dur = 0.08, type = 'bandpass', freq = 1000, q = 1, peak = 0.2, dest = this.sfxBus, attack = 0.003 }) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    s.connect(f).connect(g).connect(dest);
    this._env(g, t0, attack, 0, dur, peak);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.1);
  }

  _tone({ t0 = this.t, freq = 440, freq2 = null, dur = 0.1, type = 'sine', peak = 0.1, dest = this.sfxBus, attack = 0.005 }) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
    const g = c.createGain();
    o.connect(g).connect(dest);
    this._env(g, t0, attack, 0, dur, peak);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  step(surface, sprint, k = 1) {
    if (!this.ctx) return;
    const v = (sprint ? 0.16 : 0.11) * k;
    if (surface === 'grass') this._noiseBurst({ dur: 0.09, type: 'lowpass', freq: 900, peak: v * 0.8 });
    else if (surface === 'corn') {
      this._noiseBurst({ dur: 0.2, type: 'highpass', freq: 2500, peak: v * 0.9, attack: 0.02 });
      this._noiseBurst({ dur: 0.08, type: 'lowpass', freq: 600, peak: v * 0.5 });
    } else {
      this._noiseBurst({ dur: 0.05, type: 'bandpass', freq: 1800, q: 1.4, peak: v });
      this._noiseBurst({ dur: 0.03, type: 'lowpass', freq: 300, peak: v * 0.8 });
    }
  }

  shutter(flash, wind) {
    if (!this.ctx) return;
    const t = this.t;
    this._noiseBurst({ t0: t, dur: 0.025, type: 'highpass', freq: 3000, peak: 0.35 });
    this._tone({ t0: t, freq: 1800, freq2: 600, dur: 0.03, type: 'square', peak: 0.06 });
    this._noiseBurst({ t0: t + 0.06, dur: 0.03, type: 'bandpass', freq: 2200, q: 2, peak: 0.25 });
    // Film winder motor.
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t + 0.12);
    o.frequency.linearRampToValueAtTime(190, t + 0.12 + wind * 0.8);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 2;
    const g = c.createGain();
    o.connect(f).connect(g).connect(this.sfxBus);
    g.gain.setValueAtTime(0.0001, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.15);
    g.gain.setValueAtTime(0.05, t + 0.1 + wind * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15 + wind * 0.8);
    o.start(t + 0.12);
    o.stop(t + 0.3 + wind);
    if (flash) this._tone({ t0: t + 0.2, freq: 1200, freq2: 7000, dur: 1.2, type: 'sine', peak: 0.012, attack: 0.05 });
  }

  zoomTick() {
    if (!this.ctx) return;
    if (this._zoomLast && this.t - this._zoomLast < 0.05) return;
    this._zoomLast = this.t;
    this._tone({ freq: 320, dur: 0.05, type: 'sawtooth', peak: 0.012 });
  }

  sfx(name) {
    if (!this.ctx) return;
    const t = this.t;
    switch (name) {
      case 'click':
        this._noiseBurst({ dur: 0.02, type: 'highpass', freq: 2500, peak: 0.2 });
        break;
      case 'beep':
        this._tone({ freq: 2400, dur: 0.06, type: 'square', peak: 0.04 });
        break;
      case 'ui':
        this._tone({ freq: 880, dur: 0.04, type: 'square', peak: 0.03 });
        break;
      case 'uiBack':
        this._tone({ freq: 440, dur: 0.05, type: 'square', peak: 0.03 });
        break;
      case 'raise':
        this._noiseBurst({ dur: 0.12, type: 'bandpass', freq: 700, peak: 0.06, attack: 0.03 });
        break;
      case 'lower':
        this._noiseBurst({ dur: 0.1, type: 'bandpass', freq: 500, peak: 0.05, attack: 0.03 });
        break;
      case 'cloth':
        this._noiseBurst({ dur: 0.18, type: 'bandpass', freq: 900, peak: 0.06, attack: 0.04 });
        break;
      case 'tripod':
        this._noiseBurst({ dur: 0.05, type: 'bandpass', freq: 1500, q: 3, peak: 0.2 });
        this._noiseBurst({ t0: t + 0.12, dur: 0.05, type: 'bandpass', freq: 1300, q: 3, peak: 0.2 });
        break;
      case 'dryfire':
        this._noiseBurst({ dur: 0.02, type: 'highpass', freq: 3000, peak: 0.15 });
        break;
      case 'reload':
        for (let i = 0; i < 6; i++) this._noiseBurst({ t0: t + i * 0.18, dur: 0.04, type: 'bandpass', freq: 1600 + i * 80, q: 4, peak: 0.12 });
        this._noiseBurst({ t0: t + 1.3, dur: 0.05, type: 'highpass', freq: 2000, peak: 0.3 });
        break;
      case 'gasp':
        this._noiseBurst({ dur: 0.45, type: 'bandpass', freq: 1100, q: 0.7, peak: 0.08, attack: 0.08 });
        break;
      case 'door':
        this._noiseBurst({ dur: 0.25, type: 'lowpass', freq: 400, peak: 0.25, attack: 0.02 });
        this._tone({ t0: t + 0.05, freq: 180, freq2: 90, dur: 0.2, type: 'triangle', peak: 0.08 });
        break;
      case 'knock':
        for (let i = 0; i < 3; i++) this._noiseBurst({ t0: t + i * 0.22, dur: 0.06, type: 'lowpass', freq: 500, peak: 0.4 });
        break;
      case 'cash':
        this._tone({ freq: 1320, dur: 0.12, type: 'square', peak: 0.05 });
        this._tone({ t0: t + 0.1, freq: 1760, dur: 0.25, type: 'square', peak: 0.05 });
        this._noiseBurst({ t0: t + 0.02, dur: 0.3, type: 'highpass', freq: 5000, peak: 0.08 });
        break;
      case 'deny':
        this._tone({ freq: 220, dur: 0.18, type: 'square', peak: 0.04 });
        break;
      case 'bell':
        this._tone({ freq: 1568, dur: 0.6, type: 'triangle', peak: 0.08 });
        this._tone({ t0: t + 0.15, freq: 1318, dur: 0.8, type: 'triangle', peak: 0.07 });
        break;
      case 'modem':
        this.modem();
        break;
      case 'payphone':
        this._tone({ freq: 350, dur: 1.2, type: 'sine', peak: 0.04 });
        this._tone({ freq: 440, dur: 1.2, type: 'sine', peak: 0.04 });
        this._noiseBurst({ t0: t + 1.3, dur: 2.5, type: 'bandpass', freq: 1800, q: 0.5, peak: 0.03, attack: 0.5 });
        break;
      case 'flare':
        for (let i = 0; i < 3; i++) this._noiseBurst({ t0: t + i * 0.5, dur: 1.4, type: 'highpass', freq: 2500, peak: 0.12, attack: 0.05 });
        break;
      case 'dogs':
        for (let d = 0; d < 3; d++) {
          const n = 3 + Math.floor(Math.random() * 4);
          const f = 380 + d * 120 + Math.random() * 80;
          for (let i = 0; i < n; i++) {
            const t0 = t + d * 0.4 + i * (0.28 + Math.random() * 0.15);
            this._noiseBurst({ t0, dur: 0.12, type: 'bandpass', freq: f * 1.8, q: 3, peak: 0.05 / (d + 1), dest: this.amb });
            this._tone({ t0, freq: f, freq2: f * 0.7, dur: 0.12, type: 'sawtooth', peak: 0.012 / (d + 1), dest: this.amb });
          }
        }
        break;
      case 'package':
        this._noiseBurst({ dur: 0.2, type: 'bandpass', freq: 600, peak: 0.15 });
        break;
      default:
        break;
    }
  }

  // Continuous craft sound: saucers warble, triangles hum low.
  ufoAudio({ kind, level, hush }) {
    this.hush = !!hush;
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.ufoGain) {
      this.ufoGain = c.createGain();
      this.ufoGain.gain.value = 0;
      this.ufoGain.connect(this.amb);
      this.ufoOsc = c.createOscillator();
      this.ufoOsc2 = c.createOscillator();
      this.ufoOsc2.type = 'triangle';
      this.ufoLfo = c.createOscillator();
      this.ufoLfoGain = c.createGain();
      this.ufoLfo.connect(this.ufoLfoGain).connect(this.ufoOsc.frequency);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      this.ufoOsc.connect(lp);
      this.ufoOsc2.connect(lp);
      lp.connect(this.ufoGain);
      this.ufoOsc.start();
      this.ufoOsc2.start();
      this.ufoLfo.start();
    }
    const t = c.currentTime;
    if (kind === 'saucer') {
      this.ufoOsc.frequency.setTargetAtTime(150, t, 0.2);
      this.ufoOsc2.frequency.setTargetAtTime(301, t, 0.2);
      this.ufoLfo.frequency.setTargetAtTime(6, t, 0.2);
      this.ufoLfoGain.gain.setTargetAtTime(25, t, 0.2);
    } else if (kind === 'triangle') {
      this.ufoOsc.frequency.setTargetAtTime(44, t, 0.2);
      this.ufoOsc2.frequency.setTargetAtTime(66.5, t, 0.2);
      this.ufoLfo.frequency.setTargetAtTime(0.4, t, 0.2);
      this.ufoLfoGain.gain.setTargetAtTime(2, t, 0.2);
    }
    const peak = kind === 'triangle' ? 0.16 : 0.035;
    this.ufoGain.gain.setTargetAtTime(kind ? level * level * peak : 0, t, 0.4);
  }

  // ~2s of handshake screech, abridged.
  modem() {
    const c = this.ctx;
    const t = this.t;
    const dial = [941, 1336, 697, 1209, 770, 1477];
    for (let i = 0; i < 3; i++) {
      this._tone({ t0: t + i * 0.12, freq: dial[i * 2], dur: 0.08, peak: 0.03 });
      this._tone({ t0: t + i * 0.12, freq: dial[i * 2 + 1], dur: 0.08, peak: 0.03 });
    }
    this._tone({ t0: t + 0.5, freq: 2100, dur: 0.5, peak: 0.03 });
    const o = c.createOscillator();
    o.type = 'square';
    const g = c.createGain();
    o.connect(g).connect(this.sfxBus);
    g.gain.setValueAtTime(0.0001, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.02, t + 1.05);
    for (let k = 0; k < 20; k++) o.frequency.setValueAtTime(900 + Math.random() * 1600, t + 1.0 + k * 0.05);
    g.gain.setValueAtTime(0.02, t + 1.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.05);
    o.start(t + 1.0);
    o.stop(t + 2.1);
    this._noiseBurst({ t0: t + 1.1, dur: 0.9, type: 'highpass', freq: 3000, peak: 0.03 });
  }

  // Ambient life, called each frame.
  update(dt, night, inside, playerPos) {
    if (!this.ctx) return;
    this.amb.gain.value = inside ? 0.15 : 0.7;
    this.windGain.gain.value = 0.035 + 0.02 * Math.sin(this.t * 0.13) + night * 0.01;
    this.windFilter.frequency.value = 340 + 80 * Math.sin(this.t * 0.07);
    this.humGain.gain.value = 0.004 + night * 0.004;
    if (inside) return;

    // Crickets: chirp trains, louder at night. They go silent near a craft.
    this._cricketT -= dt;
    if (this._cricketT <= 0 && night > 0.2 && !this.hush) {
      this._cricketT = 0.25 + Math.random() * 0.6;
      const t = this.t;
      const f = 4200 + Math.random() * 900;
      const n = 2 + Math.floor(Math.random() * 3);
      const v = 0.012 * night * (0.4 + Math.random() * 0.6);
      for (let i = 0; i < n; i++) this._tone({ t0: t + i * 0.045, freq: f, dur: 0.03, type: 'sine', peak: v, dest: this.amb, attack: 0.004 });
    }
    // Birds in daylight.
    this._birdT -= dt;
    if (this._birdT <= 0 && night < 0.6 && !this.hush) {
      this._birdT = 1.2 + Math.random() * 4;
      const t = this.t;
      const base = 2400 + Math.random() * 1800;
      const n = 1 + Math.floor(Math.random() * 4);
      const v = 0.018 * (1 - night);
      for (let i = 0; i < n; i++) this._tone({ t0: t + i * 0.12, freq: base, freq2: base * (0.7 + Math.random() * 0.6), dur: 0.08, type: 'sine', peak: v, dest: this.amb });
    }
    // A distant dog.
    this._dogT -= dt;
    if (this._dogT <= 0) {
      this._dogT = 25 + Math.random() * 60;
      const t = this.t;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this._noiseBurst({ t0: t + i * 0.35, dur: 0.12, type: 'bandpass', freq: 700, q: 3, peak: 0.03, dest: this.amb });
        this._tone({ t0: t + i * 0.35, freq: 420, freq2: 300, dur: 0.12, type: 'sawtooth', peak: 0.008, dest: this.amb });
      }
    }
    // A car passing on a far-off road.
    this._carT -= dt;
    if (this._carT <= 0) {
      this._carT = 30 + Math.random() * 50;
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      const g = c.createGain();
      s.connect(f).connect(g).connect(this.amb);
      const t = this.t;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
      f.frequency.linearRampToValueAtTime(800, t + 3);
      f.frequency.linearRampToValueAtTime(350, t + 6.5);
      s.start(t);
      s.stop(t + 7);
    }
  }
}

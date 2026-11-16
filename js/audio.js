// Procedural WebAudio Synthesizer for Kart Race Turbo (No audio files, no background music per user rules)

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._lastEngineMs = 0;
  }

  _ensureCtx() {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  tone(freq, durSec = 0.12, type = 'triangle', gainVal = 0.14, slideTo = null) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + durSec);
    }
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durSec + 0.01);
  }

  countdown(count) {
    if (count > 0) {
      this.tone(440, 0.14, 'square', 0.11);
    } else {
      this.tone(880, 0.32, 'sawtooth', 0.16, 1180);
    }
  }

  engineTick(speedRatio = 0) {
    const now = performance.now();
    if (now - this._lastEngineMs < 95) return;
    this._lastEngineMs = now;
    if (speedRatio < 0.05) return;
    const f = 62 + speedRatio * 110;
    this.tone(f, 0.07, 'sawtooth', 0.025);
  }

  crateSmash() {
    this.tone(310, 0.09, 'square', 0.14, 140);
    setTimeout(() => this.tone(520, 0.12, 'triangle', 0.12, 780), 40);
  }

  fruitPickup() {
    this.tone(587, 0.08, 'sine', 0.12, 880);
  }

  turbo() {
    this.tone(240, 0.34, 'sawtooth', 0.16, 760);
  }

  hop() {
    this.tone(280, 0.11, 'sine', 0.11, 460);
  }

  attack() {
    this.tone(620, 0.16, 'sawtooth', 0.15, 190);
  }

  explosion() {
    this.tone(130, 0.35, 'sawtooth', 0.2, 38);
  }

  shieldBlock() {
    this.tone(740, 0.18, 'triangle', 0.15, 380);
  }

  thud() {
    this.tone(95, 0.1, 'square', 0.1, 55);
  }

  lap() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.13, 'triangle', 0.13), i * 70));
  }

  victory() {
    const notes = [523, 659, 784, 987, 1046];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.18, 'square', 0.14), i * 95));
  }
}

// 테니스 효과음 — 기본 소리 엔진(직접 합성, 음원 파일 없음)에 테니스 소리를 더함
import { Sound } from './audio.js';

export class TennisSound extends Sound {
  _noise(dur, { type = 'bandpass', freq = 1800, q = 1.2, vol = 0.4, when = 0, slideTo = null } = {}) {
    if (!this.ctx || !this.noise) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
  }

  // 라켓에 맞는 '팡!' — 낮은 '퍽'(몸통) + 높은 '딱'(줄) + 짧은 '퐁' (세게 칠수록 크고 높게)
  pok(power = 0.3) {
    this.sfx(() => {
      this.tone(150 + power * 50, 0.1, { type: 'sine', vol: 0.5 + power * 0.2, slide: 50 });
      this._noise(0.045, { freq: 2600 + power * 2000, q: 1.4, vol: 0.4 + power * 0.35 });
      this.tone(720 + power * 520, 0.08, { type: 'triangle', vol: 0.22, slide: 360 });
    });
  }
  // 스매시: '쉭' 바람 소리 + 낮은 '쾅'
  smash() {
    this.sfx(() => {
      this._noise(0.28, { type: 'bandpass', freq: 700, slideTo: 4200, q: 0.8, vol: 0.35 });
      this.tone(95, 0.35, { type: 'sine', vol: 0.55, slide: 38 });
      this.tone(1400, 0.12, { type: 'square', vol: 0.06, slide: 700, when: 0.02 });
    });
  }
  bounce(power = 0) {
    this.sfx(() => {
      this.tone(230, 0.08, { type: 'sine', vol: 0.32, slide: 110 });
      if (power > 0.5) this._noise(0.08, { type: 'lowpass', freq: 900, vol: 0.3 });
    });
  }
  netHit() { this.sfx(() => { this._noise(0.3, { type: 'lowpass', freq: 700, vol: 0.45 }); this.tone(120, 0.25, { type: 'sine', vol: 0.3, slide: 60 }); }); }
  point() { this.sfx(() => [659, 784, 988].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', vol: 0.22, when: i * 0.08 }))); }
  ready() { this.sfx(() => { this.tone(880, 0.1, { type: 'triangle', vol: 0.22 }); this.tone(1320, 0.16, { type: 'triangle', vol: 0.18, when: 0.08 }); }); }
  cheer() {
    this.sfx(() => {
      // 관중 '와~' (잡음을 부풀렸다 줄임)
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
        const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + i * 450; f.Q.value = 0.9;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 1.4);
      }
    });
  }
}

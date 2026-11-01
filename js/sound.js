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

  // 라켓에 맞는 '퐁' (세게 칠수록 높고 큼)
  pok(power = 0.3) {
    this.sfx(() => {
      this._noise(0.06, { freq: 1600 + power * 1800, q: 2, vol: 0.35 + power * 0.25 });
      this.tone(520 + power * 320, 0.09, { type: 'triangle', vol: 0.28, slide: 300 + power * 200 });
    });
  }
  smash() { this.sfx(() => { this._noise(0.25, { type: 'lowpass', freq: 3000, slideTo: 300, vol: 0.4 }); this.tone(900, 0.2, { type: 'sawtooth', vol: 0.08, slide: 220 }); }); }
  bounce() { this.sfx(() => this.tone(190, 0.12, { type: 'sine', vol: 0.3, slide: 90 })); }
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

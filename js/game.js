// 통통 테니스 — 게임 엔진 (공 물리·라켓 판정·점수 규칙·컴퓨터 선수·화면 그리기)
//
//  화면 = 옆에서 본 테니스 코트. 가운데 네트를 기준으로 왼쪽 선수 | 오른쪽 선수
//  · 선수의 손(자세 인식)이 곧 라켓. 라켓에 공이 닿으면 상대 코트로 넘어감
//  · 치는 방향은 자동 도움: 받는 사람 앞으로 공이 가도록 궤적을 계산 (아이도 랠리가 됨)
//    세게 휘두를수록 공이 빠르고, 받는 사람이 '어른'이면 조금 여기저기로 감
//  · 규칙: 내 코트에서 정해진 횟수(어른 1번, 어린이 2번)보다 더 튕기면 상대 득점,
//          네트에 걸리면 친 사람 실점. 정한 점수를 먼저 내면 승리
import { COURT, LEVELS, RULES, SIDE_COLORS, SIDE_LABELS } from './config.js';

const { W, H, GROUND, NET_X, NET_TOP, NET_HALF, BALL_R: BR, GRAVITY: G } = COURT;
const GY = GROUND - BR;            // 공 중심이 바닥에 닿는 높이
const TAU = Math.PI * 2;
const INK = '#2b2140';
const FONT = 'system-ui, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const HANDS = [[15, 17, 19, 21], [16, 18, 20, 22]]; // 손목, 새끼, 검지, 엄지 (왼손, 오른손)
const ELBOWS = [13, 14];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v), -2.2, 2.2); };
const towardNet = (side) => (side === 0 ? 1 : -1);
const halfCenter = (side) => (side === 0 ? W * 0.25 : W * 0.75);
const onSide = (x, side, margin = 0) => (side === 0 ? x < NET_X + margin : x > NET_X - margin);
const swingPower = (speed) => clamp((speed - RULES.SWING_MIN) / (RULES.SWING_MAX - RULES.SWING_MIN), 0, 1);

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px, y = ay + dy * t - py;
  return x * x + y * y;
}

// 손 떨림은 줄이고, 빠른 스윙은 안 늦게 (One Euro 필터)
class OneEuro {
  constructor(minCutoff = 1.7, beta = 0.008, dCutoff = 1.0) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.reset(); }
  reset() { this.x = null; this.dx = 0; this.t = 0; }
  static a(cutoff, dt) { const tau = 1 / (TAU * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.x == null || t <= this.t) { this.x = x; this.t = t; this.dx = 0; return x; }
    const dt = t - this.t; this.t = t;
    this.dx += OneEuro.a(this.dCutoff, dt) * ((x - this.x) / dt - this.dx);
    this.x += OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
}

function text(c, str, x, y, { size = 32, color = '#fff', stroke = INK, sw = null, align = 'center', base = 'middle', weight = 900 } = {}) {
  c.font = `${weight} ${size}px ${FONT}`; c.textAlign = align; c.textBaseline = base;
  if (stroke) { c.lineJoin = 'round'; c.lineWidth = sw ?? size * 0.2; c.strokeStyle = stroke; c.strokeText(str, x, y); }
  c.fillStyle = color; c.fillText(str, x, y);
}
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function mkRacket() {
  return { on: false, x: 0, y: 0, px: 0, py: 0, rx: 0, ry: 0, vx: 0, vy: 0, peak: 0, dx: 0, dy: -1, r: 50, t: 0, fx: new OneEuro(), fy: new OneEuro() };
}
function mkCpu(side) {
  const x = halfCenter(side) - towardNet(side) * 40;
  return { bodyX: x, homeX: x, shY: 372, hipY: 505, rx: x + towardNet(side) * 80, ry: 470, plan: null, planShot: -1, err: { x: 0, y: 0 }, power: 0.4, react: 0 };
}
function mkPlayer(side) {
  return {
    side, name: side ? '2P' : '1P', type: 'adult', color: SIDE_COLORS[side], score: 0,
    seenAt: -1e9, present: false,
    body: { ok: false, x: halfCenter(side), shY: 380, hipY: 520, headY: 290, scale: 100 },
    rackets: [mkRacket(), mkRacket()], ready: false, readyHitT: -9, cpu: null, hits: 0, smashes: 0,
  };
}
function mkBall() {
  return { x: W * 0.25, y: 400, vx: 0, vy: 0, e: 0.7, rot: 0, spin: 0, lastHitter: -1, bounces: [0, 0], netHit: false, visible: false, trail: [], power: 0, sx: 0, sy: 0 };
}

export class TennisEngine {
  constructor(canvas, sound) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.sound = sound; this.handlers = {};
    this.input = null; this._unsub = null; this.mouseSide = null;
    this.players = [mkPlayer(0), mkPlayer(1)];
    this.target = RULES.DEFAULT_TARGET;
    this.state = 'idle'; this.stateT = 0; this.time = 0;
    this.frozen = null; this.freezeT = 0; this.backAt = 0; this.missing = [];
    this.ball = mkBall();
    this.server = 0; this.rally = 0; this.maxRally = 0; this.shotId = 0; this.totalShots = 0;
    this.lastPoint = null; this.banner = null; this.cdShown = 0;
    this.fx = []; this.pops = [];
    this.demo = false; this.debug = false;
    this.fps = 60; this._fpsN = 0; this._fpsT = performance.now();
    this._last = performance.now(); this._acc = 0;
    this._stadium = null;
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const fn of this.handlers[ev] || []) { try { fn(...a); } catch (e) { console.warn(e); } } }
  snd(name, ...a) { if (!this.demo) this.sound?.[name]?.(...a); }

  // ── 설정 ──
  setPlayers(list) {
    list.forEach((cfg, s) => {
      const p = this.players[s];
      p.name = cfg.name || (s ? '2P' : '1P');
      p.type = LEVELS[cfg.type] ? cfg.type : 'adult';
      p.cpu = p.type === 'cpu' ? mkCpu(s) : null;
      p.body.ok = false; p.seenAt = -1e9;
      for (const rk of p.rackets) { rk.on = false; rk.fx.reset(); rk.fy.reset(); }
    });
  }
  setTarget(n) { this.target = RULES.TARGETS.includes(n) ? n : RULES.DEFAULT_TARGET; }
  setInput(vision) {
    this._unsub?.(); this._unsub = null;
    this.input = vision || null;
    if (vision) this._unsub = vision.onUpdate((now) => this._onPose(now));
  }

  // PC 확인용: 마우스로 한쪽 선수 라켓 움직이기 (?mouse)
  enableMouse(side = 0) {
    this.mouseSide = side;
    const toLocal = (e) => { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
    this.cv.addEventListener('pointermove', (e) => {
      const q = toLocal(e), now = performance.now(), p = this.players[side], rk = p.rackets[0];
      const dt = (now - rk.t) / 1000;
      if (rk.on && dt > 0 && dt < 0.3) { rk.px = rk.x; rk.py = rk.y; rk.vx = (q.x - rk.x) / dt; rk.vy = (q.y - rk.y) / dt; }
      else { rk.px = q.x; rk.py = q.y; rk.vx = rk.vy = 0; }
      rk.peak = Math.max(Math.hypot(rk.vx, rk.vy), rk.peak * 0.5);
      rk.x = q.x; rk.y = q.y; rk.t = now; rk.on = true; rk.dx = 0; rk.dy = -1;
      rk.r = clamp(110 * 0.5 * LEVELS[p.type].racket, 30, 110);
      Object.assign(p.body, { ok: true, x: clamp(q.x - towardNet(side) * 90, 60, W - 60), shY: 380, hipY: 520, headY: 280, scale: 110 });
      p.seenAt = now;
    });
  }

  // ── 자세 인식 결과 → 몸·라켓 ──
  _onPose(now) {
    const L = this.input?.sides;
    for (const p of this.players) {
      if (p.cpu || p.side === this.mouseSide) continue;
      const a = L?.[p.side];
      if (!a) {
        for (const rk of p.rackets) if (rk.on && now - rk.t > 250) { rk.on = false; rk.fx.reset(); rk.fy.reset(); }
        continue;
      }
      p.seenAt = now;
      this._updateBody(p, a);
      this._updateHands(p, a, now);
    }
  }

  _updateBody(p, a) {
    const X = (i) => a[i * 3], Y = (i) => a[i * 3 + 1], V = (i) => a[i * 3 + 2];
    const shX = (X(11) + X(12)) / 2, shY = (Y(11) + Y(12)) / 2;
    const shW = Math.hypot(X(11) - X(12), Y(11) - Y(12));
    const hipsOk = V(23) > 0.3 && V(24) > 0.3;
    const hipX = hipsOk ? (X(23) + X(24)) / 2 : shX;
    const hipY = hipsOk ? (Y(23) + Y(24)) / 2 : shY + shW * 1.4;
    const scale = clamp(Math.max(shW, Math.hypot(shX - hipX, shY - hipY) * 0.7), 30, 400);
    const headY = V(0) > 0.3 ? Y(0) - scale * 0.5 : shY - scale * 0.95;
    const b = p.body, k = b.ok ? 0.5 : 1;
    b.x = lerp(b.x, (shX + hipX) / 2, k); b.shY = lerp(b.shY, shY, k); b.hipY = lerp(b.hipY, hipY, k);
    b.headY = lerp(b.headY, headY, k); b.scale = lerp(b.scale, scale, k); b.ok = true;
  }

  _updateHands(p, a, now) {
    const X = (i) => a[i * 3], Y = (i) => a[i * 3 + 1], V = (i) => a[i * 3 + 2];
    const lv = LEVELS[p.type], t = now / 1000;
    for (let h = 0; h < 2; h++) {
      const [w, pk, ix, th] = HANDS[h], el = ELBOWS[h], rk = p.rackets[h];
      const wx = X(w), wy = Y(w);
      // 안 보이는 손, 화면 밖으로 짐작한 손은 라켓 없음
      if (Math.max(V(w), V(ix)) < 0.35 || wx < -40 || wx > W + 40 || wy < -40 || wy > H + 40) {
        if (rk.on && now - rk.t > 250) { rk.on = false; rk.fx.reset(); rk.fy.reset(); }
        continue;
      }
      const kx = (X(pk) + X(ix) + X(th)) / 3, ky = (Y(pk) + Y(ix) + Y(th)) / 3;
      const palmX = wx + (kx - wx) * 1.25, palmY = wy + (ky - wy) * 1.25; // 손바닥 가운데
      let dx = palmX - X(el), dy = palmY - Y(el);
      if (V(el) < 0.3 || Math.hypot(dx, dy) < 5) { dx = 0; dy = -1; }
      let dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      if (rk.on) { dx = lerp(rk.dx, dx, 0.5); dy = lerp(rk.dy, dy, 0.5); dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; }
      // 라켓 크기는 사람 크기(어깨 폭)에 맞춤 → 멀리 서도 가까이 서도 비슷하게 맞음
      const r = clamp(p.body.scale * 0.5 * lv.racket, 30, 110);
      const hx = palmX + dx * r * 1.25, hy = palmY + dy * r * 1.25;
      const dt = (now - rk.t) / 1000;
      // 인식이 순간 튀면(사람 손으로 불가능한 속도) 그 사이 경로로는 치지 않게 → 엉뚱한 득점 방지
      const teleport = rk.on && dt > 0 && Math.hypot(hx - rk.rx, hy - rk.ry) / dt > 6000;
      if (teleport) { rk.fx.reset(); rk.fy.reset(); }
      rk.rx = hx; rk.ry = hy;
      const fx = rk.fx.filter(hx, t), fy = rk.fy.filter(hy, t);
      if (rk.on && !teleport && dt > 0 && dt < 0.3) { rk.px = rk.x; rk.py = rk.y; rk.vx = (fx - rk.x) / dt; rk.vy = (fy - rk.y) / dt; }
      else { rk.px = fx; rk.py = fy; rk.vx = rk.vy = 0; }
      rk.peak = Math.max(Math.hypot(rk.vx, rk.vy), rk.peak * 0.5);
      rk.x = fx; rk.y = fy; rk.dx = dx; rk.dy = dy; rk.r = r; rk.t = now; rk.on = true;
    }
  }

  // ── 진행 ──
  _setState(s) { this.state = s; this.stateT = 0; }
  get active() { return ['countdown', 'serve', 'rally', 'point'].includes(this.state); }

  startDemo() {
    this.demo = true; this.frozen = null;
    this.setPlayers([{ name: '🤖', type: 'cpu' }, { name: '🤖', type: 'cpu' }]);
    this.setTarget(7);
    this._startMatch();
  }

  enterLobby() {
    this.demo = false; this.frozen = null; this.banner = null;
    for (const p of this.players) { p.score = 0; p.ready = !!p.cpu; p.readyHitT = -9; }
    this.ball.visible = false;
    this._setState('lobby');
    this.emit('lobby');
  }

  startCountdown() {
    if (this.demo) return;
    this.frozen = null; this.banner = null; this.ball.visible = false; this.cdShown = 0;
    for (const p of this.players) p.score = 0;
    this._setState('countdown');
    this.emit('countdown');
  }

  _startMatch() {
    for (const p of this.players) { p.score = 0; p.hits = 0; p.smashes = 0; }
    this.maxRally = 0; this.totalShots = 0; this.lastPoint = null;
    this.server = Math.random() < 0.5 ? 0 : 1;
    this._newServe();
    this.emit('start');
  }

  pause() { if (this.active && !this.frozen) { this.frozen = 'manual'; this.freezeT = 0; } }
  resume() { if (this.frozen === 'manual') this.frozen = null; }
  stop() { this.frozen = null; this.ball.visible = false; this._setState('idle'); }

  _serveSpot(s) {
    const p = this.players[s], tn = towardNet(s);
    let x, y;
    if (p.cpu) { x = p.cpu.bodyX + tn * 105; y = 430; }
    else if (p.body.ok && p.present) { x = p.body.x + tn * p.body.scale * 1.05; y = p.body.shY + p.body.scale * 0.25; }
    else { x = halfCenter(s) + tn * 60; y = 420; }
    x = s === 0 ? clamp(x, 80, NET_X - 90) : clamp(x, NET_X + 90, W - 80);
    return { x, y: clamp(y, 200, GY - 130) };
  }

  _newServe() {
    const b = this.ball, sp = this._serveSpot(this.server);
    Object.assign(b, { visible: true, vx: 0, vy: 0, lastHitter: -1, bounces: [0, 0], netHit: false, trail: [], power: 0, sx: sp.x, sy: sp.y, x: sp.x, y: sp.y });
    this.rally = 0;
    const sv = this.players[this.server];
    if (sv.cpu) sv.cpu.power = rand(0.15, 0.5);
    this._setState('serve');
    if (!this.demo) this.banner = { title: `${sv.name} 서브!`, sub: sv.cpu ? '' : '둥둥 떠 있는 공을 라켓으로 톡!', color: sv.color, t: 0, life: 2.0 };
  }

  // ── 치기: 받는 사람 앞으로 가는 궤적 계산 (자동 도움) ──
  _doHit(side, power) {
    const b = this.ball, opp = 1 - side, R = this.players[opp], lv = LEVELS[R.type], tn = towardNet(opp);
    let bx, shY, hipY, sc;
    if (R.cpu) { bx = R.cpu.bodyX; shY = R.cpu.shY; hipY = R.cpu.hipY; sc = 105; }
    else if (R.body.ok) ({ x: bx, shY, hipY, scale: sc } = R.body);
    else { bx = halfCenter(opp); shY = 380; hipY = 520; sc = 100; }
    // 공이 튄 뒤 가장 높이 뜨는 곳 = 받는 사람 바로 앞, 허리~가슴 높이
    const jit = lv.jitter * (0.35 + power * 0.85);
    let xr = bx + tn * sc * 0.9 + randn() * 70 * jit;
    let yr = hipY * 0.55 + shY * 0.45 + randn() * 35 * jit;
    xr = opp === 0 ? clamp(xr, 90, NET_X - 150) : clamp(xr, NET_X + 150, W - 90);
    yr = clamp(yr, 250, GY - 80);
    const ta = Math.sqrt(2 * (GY - yr) / G);           // 튄 뒤 꼭대기까지 걸리는 시간
    const x0 = b.x, y0 = Math.min(b.y, GY - 4);
    let T = lerp(lv.slow, lv.fast, power), vx = 0, vy = 0;
    for (let i = 0; i < 18; i++, T += 0.08) {
      vx = (xr - x0) / (T + ta);
      const xL = x0 + vx * T, minL = 70;                // 떨어지는 곳은 네트에서 조금 떨어지게
      if (opp === 1 && xL < NET_X + minL) vx = (NET_X + minL - x0) / T;
      if (opp === 0 && xL > NET_X - minL) vx = (NET_X - minL - x0) / T;
      vy = (GY - y0 - 0.5 * G * T * T) / T;
      const tc = (NET_X - x0) / vx;                      // 네트 넘을 때 높이 확인
      if (tc > 0 && tc < T && y0 + vy * tc + 0.5 * G * tc * tc > NET_TOP - BR - 24) continue;
      break;
    }
    const vLand = vy + G * T;
    b.vx = vx; b.vy = vy; b.e = clamp((G * ta) / Math.max(vLand, 1), 0.35, 0.97);
    b.lastHitter = side; b.bounces = [0, 0]; b.netHit = false; b.power = power;
    b.spin = towardNet(side) * (6 + power * 14);
    this.shotId++; this.totalShots++;
    const P = this.players[side];
    P.hits++;
    this._ring(b.x, b.y, P.color, 26, 90);
    this.snd('pok', power);
    if (power >= RULES.SMASH_POWER) { P.smashes++; this.snd('smash'); this._pop('스매시!', b.x, b.y - 50, '#ffd93d', 44); }
    if (this.state === 'serve') this._setState('rally');
    else {
      this.rally++;
      this.maxRally = Math.max(this.maxRally, this.rally);
      if (this.rally >= 5 && this.rally % 5 === 0) { this.snd('cheer'); this._pop(`랠리 ${this.rally}!`, W / 2, 150, '#fff', 46); }
    }
  }

  _score(winner, reason) {
    if (this.state !== 'rally') return;
    const w = this.players[winner], l = this.players[1 - winner];
    w.score++;
    this.lastPoint = { winner, reason };
    this._setState('point');
    const why = {
      net: '네트에 걸렸어요', own: '자기 쪽에 떨어졌어요', out: '밖으로 나갔어요', pass: '공을 못 받았어요',
      double: `${l.name} 쪽에서 ${LEVELS[l.type].bounces + 1}번 튕겼어요`,
    }[reason] || '';
    if (!this.demo) this.banner = { title: `${w.name} 득점!`, sub: why, color: w.color, t: 0, life: 1.8 };
    this.snd('point');
    this._pop('+1', winner === 0 ? W / 2 - 60 : W / 2 + 60, 100, w.color, 40);
    this._burst(halfCenter(winner), 220, w.color, 26);
    this.emit('point', winner, reason);
  }

  _afterPoint() {
    const w = this.lastPoint?.winner ?? 0;
    if (this.players[w].score >= this.target) { this._gameOver(w); return; }
    this.server = 1 - this.server;
    this._newServe();
  }

  _gameOver(w) {
    if (this.demo) { this._startMatch(); return; }
    this.ball.visible = false;
    for (const p of this.players) { p.ready = !!p.cpu; p.readyHitT = -9; }
    const win = this.players[w];
    this.banner = { title: `🏆 ${win.name} 승리!`, sub: `${this.players[0].score} : ${this.players[1].score}`, color: win.color, t: 0, life: 3.2, big: true };
    for (let i = 0; i < 140; i++) this.fx.push({ k: 'conf', x: rand(0, W), y: rand(-200, -10), vx: rand(-60, 60), vy: rand(60, 220), r: rand(5, 10), rot: rand(0, TAU), vr: rand(-6, 6), t: 0, life: rand(3, 5), color: ['#ffd93d', '#ff6b6b', '#4d96ff', '#3ecfb2', '#9b5de5', '#fff'][i % 6] });
    this.snd('fanfare');
    this._setState('over');
    this.emit('over', {
      winner: w, names: this.players.map((p) => p.name), scores: this.players.map((p) => p.score),
      maxRally: this.maxRally, hits: this.players.map((p) => p.hits), smashes: this.players.map((p) => p.smashes),
    });
  }

  // ── 매 프레임 ──
  _frame(now) {
    requestAnimationFrame(this._frame);
    let dt = (now - this._last) / 1000; this._last = now;
    if (dt > 0.1) dt = 0.1;
    this._acc += dt;
    const STEP = 1 / 120;
    let n = 0;
    while (this._acc >= STEP && n < 24) { this._update(STEP); this._acc -= STEP; n++; }
    try { this.render(); } catch (e) { console.warn(e); }
    this._fpsN++;
    if (now - this._fpsT > 1000) { this.fps = this._fpsN * 1000 / (now - this._fpsT); this._fpsN = 0; this._fpsT = now; }
  }

  _update(dt) {
    const now = performance.now();
    if (this.mouseSide != null) this.players[this.mouseSide].seenAt = now;
    for (const p of this.players) p.present = !!p.cpu || now - p.seenAt < 450;
    if (this.active && !this.demo) this._checkAbsent(now);
    this._updateFx(dt);
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.life) this.banner = null; }
    if (this.frozen) { this.freezeT += dt; return; }
    this.time += dt; this.stateT += dt;
    for (const p of this.players) if (p.cpu) this._cpuStep(p, dt);
    switch (this.state) {
      case 'lobby': case 'over': this._readyStep(); break;
      case 'countdown': {
        const left = Math.ceil(RULES.COUNTDOWN_SEC - this.stateT);
        if (left !== this.cdShown && left > 0) { this.cdShown = left; this.snd('beep', false); }
        if (this.stateT >= RULES.COUNTDOWN_SEC) { this.snd('beep', true); this._startMatch(); }
        break;
      }
      case 'serve': this._serveStep(dt); break;
      case 'rally': this._ballStep(dt); if (this.state === 'rally') this._hitStep(); break;
      case 'point': this._ballStep(dt); if (this.stateT > RULES.POINT_PAUSE_SEC) this._afterPoint(); break;
      default: break;
    }
  }

  _checkAbsent(now) {
    const gone = (p, ms) => !p.cpu && p.side !== this.mouseSide && now - p.seenAt > ms;
    if (!this.frozen) {
      const miss = this.players.filter((p) => gone(p, RULES.ABSENT_PAUSE_MS));
      if (miss.length) { this.frozen = 'absent'; this.freezeT = 0; this.backAt = 0; this.missing = miss.map((p) => p.side); this.emit('absent', true); }
    } else if (this.frozen === 'absent') {
      this.missing = this.players.filter((p) => gone(p, 450)).map((p) => p.side);
      if (this.missing.length) this.backAt = 0;
      else {
        if (!this.backAt) this.backAt = now;
        if (now - this.backAt > RULES.RETURN_MS) { this.frozen = null; this.backAt = 0; this._pop('다시 시작!', W / 2, 330, '#fff', 56); this.emit('absent', false); }
      }
    }
  }

  // 대기실·결과: 각자 자기 쪽 공을 손으로 톡 → 둘 다 준비되면 시작
  // 준비 공: 선수 바로 앞 가슴 높이 (아이도 손이 닿게). 사람이 없으면 반쪽 가운데
  _readyBallPos(s) {
    const p = this.players[s], tn = towardNet(s);
    let x = halfCenter(s), y = 300;
    if (!p.cpu && p.present && p.body.ok) {
      x = p.body.x + tn * p.body.scale * 1.1; y = p.body.shY;
      x = s === 0 ? clamp(x, 90, NET_X - 80) : clamp(x, NET_X + 80, W - 90); y = clamp(y, 170, GY - 140);
    }
    const q = (p.readyPos ||= { x, y });
    q.x += (x - q.x) * 0.04; q.y += (y - q.y) * 0.04;   // 천천히 따라감 (손이 다가가도 도망가지 않게)
    return { x: q.x, y: q.y + Math.sin(this.time * 2.4 + s * 1.7) * 10 };
  }
  _readyBallAt(s) { const q = this.players[s].readyPos || { x: halfCenter(s), y: 300 }; return { x: q.x, y: q.y + Math.sin(this.time * 2.4 + s * 1.7) * 10 }; }
  _readyStep() {
    for (const p of this.players) this._readyBallPos(p.side);
    const canReady = this.state === 'lobby' ? this.stateT > 0.4 : this.stateT > 2.6;
    if (!canReady) return;
    for (const p of this.players) {
      if (p.ready || !p.present) continue;
      const q = this._readyBallAt(p.side);
      for (const rk of p.rackets) {
        if (!rk.on) continue;
        const rr = rk.r + 34;
        if (segDist2(q.x, q.y, rk.px, rk.py, rk.x, rk.y) < rr * rr) {
          p.ready = true; p.readyHitT = this.time;
          this.snd('ready'); this._burst(q.x, q.y, p.color, 22); this._ring(q.x, q.y, '#fff', 30, 110);
          break;
        }
      }
    }
    if (this.players.every((p) => p.ready)) {
      if (this.state === 'over') this.emit('retry');
      this.startCountdown();
    }
  }

  _serveStep() {
    const b = this.ball, s = this.server, p = this.players[s];
    // 선수가 멀리 움직이면 서브 공도 천천히 따라감
    const tg = this._serveSpot(s), far = (p.body.scale || 100) * 1.6;
    const d = Math.hypot(tg.x - b.sx, tg.y - b.sy);
    if (d > far) { b.sx += (tg.x - b.sx) / d * 2; b.sy += (tg.y - b.sy) / d * 2; }
    b.x = b.sx; b.y = b.sy + Math.sin(this.time * 3) * 8;
    if (this.stateT > RULES.SERVE_AUTO_SEC && !p.cpu) { this._pop('톡!', b.x, b.y - 46, '#fff', 34); this._doHit(s, 0.1); return; }
    if (this.stateT < 0.6) return;
    for (const rk of p.rackets) {
      if (!rk.on) continue;
      const rr = rk.r + BR;
      if (segDist2(b.x, b.y, rk.px, rk.py, rk.x, rk.y) < rr * rr) { this._doHit(s, p.cpu ? p.cpu.power : swingPower(rk.peak)); return; }
    }
  }

  _ballStep(dt) {
    const b = this.ball;
    if (!b.visible) return;
    b.vy += G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.spin * dt;
    if ((this._trailN = (this._trailN || 0) + 1) % 2 === 0) { b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 12) b.trail.shift(); }
    // 네트
    if (!b.netHit && Math.abs(b.x - NET_X) < NET_HALF + BR && b.y > NET_TOP - BR * 0.6) {
      b.netHit = true;
      const back = b.lastHitter >= 0 ? b.lastHitter : (b.vx > 0 ? 0 : 1);
      b.x = back === 0 ? NET_X - NET_HALF - BR : NET_X + NET_HALF + BR;
      b.vx = -b.vx * 0.2; b.vy = Math.max(b.vy, 0) * 0.3;
      this.snd('netHit'); this._ring(b.x, b.y, '#fff', 20, 60);
      if (this.state === 'rally') this._score(1 - back, 'net');
    }
    // 바닥
    if (b.y >= GY && b.vy > 0) {
      b.y = GY;
      const side = b.x < NET_X ? 0 : 1, impact = b.vy;
      let e = 0.62;
      if (this.state === 'rally') {
        b.bounces[side]++;
        if (side === b.lastHitter) this._score(1 - side, 'own');
        else if (b.bounces[side] > LEVELS[this.players[side].type].bounces) this._score(b.lastHitter, 'double');
        else if (b.bounces[side] === 1) e = b.e;
      }
      b.vy = -impact * e;
      if (b.vy > -70) { b.vy = 0; b.vx *= 0.97; }
      if (impact > 160) { this.snd('bounce'); this._dust(b.x, GROUND); }
    }
    // 화면 밖으로
    if (b.x < -BR * 2 || b.x > W + BR * 2) {
      if (this.state === 'rally') {
        const side = b.x < 0 ? 0 : 1;
        if (side === b.lastHitter) this._score(1 - side, 'own');
        else if (b.bounces[side] >= 1) this._score(b.lastHitter, 'pass');
        else this._score(side, 'out');
      }
      b.visible = false;
    }
  }

  _hitStep() {
    const b = this.ball;
    if (!b.visible || b.netHit) return;
    for (const p of this.players) {
      const s = p.side;
      if (b.lastHitter === s || !onSide(b.x, s, RULES.HIT_MARGIN)) continue;
      if (!p.present) continue;
      for (const rk of p.rackets) {
        if (!rk.on) continue;
        const rr = rk.r + BR;
        if (segDist2(b.x, b.y, rk.px, rk.py, rk.x, rk.y) < rr * rr) { this._doHit(s, p.cpu ? p.cpu.power : swingPower(rk.peak)); return; }
      }
    }
  }

  // ── 컴퓨터 선수 ──
  _predictApex(s) {
    const b = this.ball, dt = 1 / 120;
    let { x, y, vx, vy } = b, bounced = 0;
    for (let i = 0; i < 600; i++) {
      vy += G * dt; x += vx * dt; y += vy * dt;
      if (y >= GY && vy > 0) { y = GY; bounced++; vy = -vy * (bounced === 1 ? b.e : 0.62); }
      if (bounced >= 1 && vy >= 0 && onSide(x, s)) return { x, y };
      if (x < -60 || x > W + 60) return null;
    }
    return null;
  }

  _cpuStep(p, dt) {
    const c = p.cpu, s = p.side, b = this.ball, tn = towardNet(s), rk = p.rackets[0];
    let tx = c.bodyX + tn * 85, ty = 470 + Math.sin(this.time * 2 + s) * 14, bodyT = c.homeX, fast = false;
    if (this.state === 'serve' && this.server === s && this.stateT > 1.1) {
      tx = b.x; ty = b.y; fast = true; bodyT = b.sx - tn * 105;
    } else if (this.state === 'rally' && b.lastHitter !== s && b.visible && !b.netHit) {
      if (c.planShot !== this.shotId) {
        c.planShot = this.shotId; c.plan = this._predictApex(s);
        const miss = Math.random() < 0.1 + Math.min(0.25, this.rally * 0.015);
        c.err = miss ? { x: 0, y: (Math.random() < 0.5 ? -1 : 1) * (rk.r + BR + rand(25, 60)) } : { x: rand(-0.3, 0.3) * rk.r, y: rand(-0.3, 0.3) * rk.r };
        c.power = rand(0.15, 0.65); c.react = rand(0.12, 0.3);
      }
      c.react -= dt;
      if (c.plan && c.react <= 0) { tx = c.plan.x + c.err.x; ty = c.plan.y + c.err.y; bodyT = c.plan.x - tn * 105; }
    }
    const step = 430 * dt;
    c.bodyX += clamp(bodyT - c.bodyX, -step, step);
    c.bodyX = s === 0 ? clamp(c.bodyX, 70, NET_X - 110) : clamp(c.bodyX, NET_X + 110, W - 70);
    // 팔 길이 안에서만
    const shX = c.bodyX + tn * 22, shY = c.shY + 12;
    let ddx = tx - shX, ddy = ty - shY, dl = Math.hypot(ddx, ddy) || 1;
    const reach = 200, minR = rk.r * 1.25 + 34;
    if (dl > reach) { tx = shX + ddx / dl * reach; ty = shY + ddy / dl * reach; }
    if (dl < minR) { tx = shX + ddx / dl * minR; ty = shY + ddy / dl * minR; }
    const sp = (fast ? 1500 : 950) * dt;
    const mx = clamp(tx - c.rx, -sp, sp), my = clamp(ty - c.ry, -sp, sp);
    rk.px = c.rx; rk.py = c.ry; c.rx += mx; c.ry += my;
    rk.x = c.rx; rk.y = c.ry; rk.vx = mx / dt; rk.vy = my / dt; rk.on = true; rk.r = 50;
    ddx = rk.x - shX; ddy = rk.y - shY; dl = Math.hypot(ddx, ddy) || 1; rk.dx = ddx / dl; rk.dy = ddy / dl;
  }

  // ── 효과 ──
  _pop(textStr, x, y, color, size = 36) { this.pops.push({ text: textStr, x, y, color, size, t: 0, life: 1.1 }); }
  _ring(x, y, color, r0, r1) { this.fx.push({ k: 'ring', x, y, color, r0, r1, t: 0, life: 0.35 }); }
  _burst(x, y, color, n = 18) {
    for (let i = 0; i < n; i++) { const a = rand(0, TAU), v = rand(120, 380); this.fx.push({ k: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, r: rand(4, 8), color: i % 3 ? color : '#ffd93d', t: 0, life: rand(0.5, 0.9) }); }
  }
  _dust(x, y) { for (let i = 0; i < 6; i++) this.fx.push({ k: 'dot', x: x + rand(-10, 10), y, vx: rand(-90, 90), vy: rand(-120, -40), r: rand(3, 6), color: 'rgba(255,255,255,0.8)', t: 0, life: 0.4 }); }
  _updateFx(dt) {
    for (const f of this.fx) {
      f.t += dt;
      if (f.k === 'dot') { f.vy += 600 * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
      else if (f.k === 'conf') { f.vy = Math.min(f.vy + 120 * dt, 260); f.x += (f.vx + Math.sin(f.t * 3 + f.rot) * 40) * dt; f.y += f.vy * dt; f.rot += f.vr * dt; }
    }
    this.fx = this.fx.filter((f) => f.t < f.life);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < p.life);
  }

  // ───────────────────────── 그리기 ─────────────────────────
  render() {
    const c = this.ctx;
    c.setTransform(this.cv.width / W, 0, 0, this.cv.height / H, 0, 0);
    if (this.input && this.input.drawTo(c, W, H)) { c.fillStyle = 'rgba(14,10,40,0.18)'; c.fillRect(0, 0, W, H); }
    else this._drawStadium(c);
    this._drawCourt(c);
    const showReady = (this.state === 'lobby') || (this.state === 'over' && this.stateT > 2.6);
    for (const p of this.players) this._drawPlayer(c, p, showReady);
    if (showReady) this._drawReady(c);
    if (this.ball.visible) this._drawBallFull(c);
    this._drawFx(c);
    if (this.state !== 'idle' && !this.demo) this._drawHud(c);
    this._drawOverlays(c);
    if (this.debug) this._drawDebug(c);
  }

  _drawStadium(c) {
    if (!this._stadium) {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const s = cv.getContext('2d');
      const g = s.createLinearGradient(0, 0, 0, GROUND);
      g.addColorStop(0, '#6fb8ff'); g.addColorStop(1, '#cdeaff');
      s.fillStyle = g; s.fillRect(0, 0, W, H);
      // 관중석
      s.fillStyle = '#5a4d8f'; s.fillRect(0, 300, W, GROUND - 300);
      const cols = ['#ff6b6b', '#ffd93d', '#3ecfb2', '#4d96ff', '#9b5de5', '#fff', '#ff9f68'];
      for (let row = 0; row < 7; row++) {
        for (let x = 10 + (row % 2) * 14; x < W; x += 28) {
          s.fillStyle = cols[(x * 7 + row * 13) % cols.length];
          s.globalAlpha = 0.75;
          s.beginPath(); s.arc(x, 318 + row * 30, 9, 0, TAU); s.fill();
        }
      }
      s.globalAlpha = 1;
      s.fillStyle = '#2f7d4f'; s.fillRect(0, 528, W, GROUND - 528);
      s.fillStyle = 'rgba(255,255,255,0.15)'; for (let x = 0; x < W; x += 160) s.fillRect(x, 528, 80, GROUND - 528);
      this._stadium = cv;
    }
    c.drawImage(this._stadium, 0, 0, W, H);
  }

  _drawCourt(c) {
    // 내 편 색
    c.fillStyle = 'rgba(77,150,255,0.08)'; c.fillRect(0, 0, NET_X, GROUND);
    c.fillStyle = 'rgba(255,107,107,0.08)'; c.fillRect(NET_X, 0, W - NET_X, GROUND);
    // 가운데 점선 (여기를 넘어가지 않게)
    c.save(); c.setLineDash([14, 14]); c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(NET_X, 0); c.lineTo(NET_X, NET_TOP - 10); c.stroke(); c.restore();
    // 바닥
    const g = c.createLinearGradient(0, GROUND, 0, H);
    g.addColorStop(0, '#43b26f'); g.addColorStop(1, '#2a8551');
    c.fillStyle = g; c.fillRect(0, GROUND, W, H - GROUND);
    c.fillStyle = '#fff'; c.fillRect(0, GROUND - 2, W, 5);
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(0, GROUND + 26, W, 3);
    // 공 그림자
    const b = this.ball;
    if (b.visible) {
      const k = clamp(1 - (GY - b.y) / 700, 0.25, 1);
      c.fillStyle = `rgba(0,0,0,${0.32 * k})`;
      c.beginPath(); c.ellipse(b.x, GROUND + 4, BR * 1.3 * k, BR * 0.38 * k, 0, 0, TAU); c.fill();
    }
    // 네트
    const nw = NET_HALF * 2 + 6, nx = NET_X - nw / 2;
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(nx, NET_TOP, nw, GROUND - NET_TOP);
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.5;
    c.beginPath();
    for (let y = NET_TOP; y < GROUND; y += 9) { c.moveTo(nx, y); c.lineTo(nx + nw, y + 9); c.moveTo(nx + nw, y); c.lineTo(nx, y + 9); }
    c.stroke();
    c.fillStyle = INK; c.fillRect(NET_X - 4, NET_TOP - 12, 8, GROUND - NET_TOP + 12);
    rrect(c, nx - 4, NET_TOP - 8, nw + 8, 10, 4); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
  }

  _drawPlayer(c, p, showReady) {
    if (p.cpu) { this._drawCpu(c, p); return; }
    if (!p.present || !p.body.ok) {
      const absent = this.frozen === 'absent' && this.missing.includes(p.side);
      if (showReady || absent || this.state === 'countdown') this._drawGhost(c, p, !absent);
      return;
    }
    for (const rk of p.rackets) if (rk.on) this._drawRacket(c, rk, p.color);
    this._nameTag(c, p, p.body.x, Math.max(48, p.body.headY - 22));
  }

  _nameTag(c, p, x, y) {
    const serving = this.state === 'serve' && this.server === p.side;
    const label = `${p.type === 'kid' ? '🧒 ' : ''}${p.name}${serving ? ' 🎾' : ''}`;
    c.font = `900 26px ${FONT}`;
    const w = c.measureText(label).width + 30;
    x = clamp(x, w / 2 + 6, W - w / 2 - 6);
    rrect(c, x - w / 2, y - 21, w, 42, 21); c.fillStyle = p.color; c.fill(); c.lineWidth = 3.5; c.strokeStyle = INK; c.stroke();
    text(c, label, x, y + 1, { size: 26, stroke: null });
  }

  _drawGhost(c, p, label = true) {
    const x = halfCenter(p.side), t = this.time;
    c.save();
    c.globalAlpha = 0.55 + Math.sin(t * 3) * 0.15;
    c.setLineDash([12, 10]); c.lineWidth = 5; c.strokeStyle = '#fff';
    c.beginPath(); c.arc(x, 330, 46, 0, TAU); c.stroke();
    rrect(c, x - 70, 390, 140, 180, 50); c.stroke();
    c.restore();
    if (label) text(c, `${SIDE_LABELS[p.side]} 선수는 여기에 서요 🙋`, x, 610, { size: 28 });
  }

  _drawRacket(c, rk, color) {
    const r = rk.r, ang = Math.atan2(rk.dy, rk.dx);
    const gx = rk.x - rk.dx * r * 1.25, gy = rk.y - rk.dy * r * 1.25;   // 손 위치
    const ex = rk.x - rk.dx * r * 0.92, ey = rk.y - rk.dy * r * 0.92;
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = INK; c.lineWidth = r * 0.24 + 5; c.beginPath(); c.moveTo(gx, gy); c.lineTo(ex, ey); c.stroke();
    c.strokeStyle = color; c.lineWidth = r * 0.24; c.stroke();
    c.translate(rk.x, rk.y); c.rotate(ang);
    const head = () => { c.beginPath(); c.ellipse(0, 0, r, r * 0.82, 0, 0, TAU); };
    head(); c.fillStyle = 'rgba(255,255,255,0.3)'; c.fill();
    c.save(); head(); c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.6; c.beginPath();
    for (let k = -r; k <= r; k += r / 4) { c.moveTo(k, -r); c.lineTo(k, r); c.moveTo(-r, k); c.lineTo(r, k); }
    c.stroke(); c.restore();
    head(); c.lineWidth = r * 0.17 + 5; c.strokeStyle = INK; c.stroke();
    c.lineWidth = r * 0.17; c.strokeStyle = color; c.stroke();
    c.restore();
    c.beginPath(); c.arc(gx, gy, Math.max(8, r * 0.17), 0, TAU); c.fillStyle = '#ffd93d'; c.fill(); c.lineWidth = 3; c.strokeStyle = INK; c.stroke();
  }

  _drawCpu(c, p) {
    const k = p.cpu, x = k.bodyX, tn = towardNet(p.side), col = p.color, bob = Math.sin(this.time * 4 + p.side) * 3;
    const shY = k.shY + bob, hipY = k.hipY;
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    // 다리
    c.strokeStyle = INK; c.lineWidth = 12;
    c.beginPath(); c.moveTo(x - 16, hipY); c.lineTo(x - 22, GROUND - 4); c.moveTo(x + 16, hipY); c.lineTo(x + 22, GROUND - 4); c.stroke();
    // 몸
    rrect(c, x - 38, shY - 8, 76, hipY - shY + 18, 22); c.fillStyle = col; c.fill(); c.lineWidth = 5; c.strokeStyle = INK; c.stroke();
    rrect(c, x - 18, shY + 26, 36, 30, 8); c.fillStyle = 'rgba(255,255,255,0.75)'; c.fill();
    // 머리
    const hy = shY - 62;
    c.strokeStyle = INK; c.lineWidth = 4; c.beginPath(); c.moveTo(x, hy - 34); c.lineTo(x, hy - 56); c.stroke();
    c.beginPath(); c.arc(x, hy - 60, 8, 0, TAU); c.fillStyle = '#ffd93d'; c.fill(); c.stroke();
    rrect(c, x - 40, hy - 34, 80, 64, 20); c.fillStyle = '#eef0f8'; c.fill(); c.lineWidth = 5; c.stroke();
    rrect(c, x - 30, hy - 20, 60, 34, 12); c.fillStyle = '#2b2140'; c.fill();
    c.fillStyle = col;
    c.beginPath(); c.arc(x - 12 + tn * 4, hy - 3, 6, 0, TAU); c.arc(x + 12 + tn * 4, hy - 3, 6, 0, TAU); c.fill();
    // 팔
    const rk = p.rackets[0], gx = rk.x - rk.dx * rk.r * 1.25, gy = rk.y - rk.dy * rk.r * 1.25;
    c.strokeStyle = INK; c.lineWidth = 12; c.beginPath(); c.moveTo(x + tn * 30, shY + 12); c.lineTo(gx, gy); c.stroke();
    c.strokeStyle = col; c.lineWidth = 6; c.stroke();
    c.restore();
    this._drawRacket(c, rk, col);
    if (!this.demo) this._nameTag(c, p, x, hy - 92);
  }

  _drawReady(c) {
    for (const p of this.players) {
      const x = halfCenter(p.side);
      if (p.ready) {
        const k = clamp((this.time - p.readyHitT) * 3, 0, 1);
        text(c, p.cpu ? '🤖 준비 완료!' : '준비 완료! ✅', x, 170 + (1 - k) * 20, { size: 40, color: '#fff' });
        continue;
      }
      if (!p.present) continue;
      const q = this._readyBallAt(p.side), pulse = 1 + Math.sin(this.time * 6) * 0.08;
      c.beginPath(); c.arc(q.x, q.y, 52 * pulse, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.22)'; c.fill();
      c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.stroke();
      this._drawBall(c, q.x, q.y, this.time * 2, 34);
      text(c, this.state === 'over' ? '한 판 더? 공을 톡!' : '손으로 공을 톡!', x, q.y - 82, { size: 32 });
    }
    if (this.state === 'lobby') {
      const msg = '양쪽에 한 명씩 서서, 자기 쪽 공을 손으로 톡 치면 시작!';
      c.font = `900 26px ${FONT}`;
      const w = c.measureText(msg).width + 44;
      rrect(c, W / 2 - w / 2, 18, w, 50, 25); c.fillStyle = 'rgba(255,250,242,0.94)'; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
      text(c, msg, W / 2, 44, { size: 26, color: INK, stroke: null });
    }
  }

  _drawBall(c, x, y, rot, r) {
    c.save(); c.translate(x, y); c.rotate(rot);
    const g = c.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#f8ffa8'); g.addColorStop(0.6, '#d9f23f'); g.addColorStop(1, '#a6c21a');
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = g; c.fill();
    c.save(); c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = r * 0.15;
    c.beginPath(); c.arc(-r * 1.15, 0, r * 0.85, -0.8, 0.8); c.stroke();
    c.beginPath(); c.arc(r * 1.15, 0, r * 0.85, Math.PI - 0.8, Math.PI + 0.8); c.stroke();
    c.restore();
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.lineWidth = 3; c.strokeStyle = INK; c.stroke();
    c.restore();
  }

  _drawBallFull(c) {
    const b = this.ball, hot = b.power >= RULES.SMASH_POWER && this.state === 'rally';
    b.trail.forEach((q, i) => {
      const a = (i + 1) / b.trail.length;
      c.beginPath(); c.arc(q.x, q.y, BR * (0.35 + a * 0.5), 0, TAU);
      c.fillStyle = hot ? `rgba(255,120,60,${a * 0.55})` : `rgba(255,255,255,${a * 0.35})`; c.fill();
    });
    if (this.state === 'serve') {
      const p = this.players[this.server];
      if (!p.cpu && this.stateT > 3) {
        const k = 1 + Math.sin(this.time * 7) * 0.12;
        c.beginPath(); c.arc(b.x, b.y, 44 * k, 0, TAU); c.lineWidth = 5; c.strokeStyle = '#ffd93d'; c.stroke();
        text(c, '라켓으로 톡!', b.x, b.y - 70, { size: 30, color: '#ffd93d' });
      }
    }
    if (b.y < -BR) {  // 화면 위로 높이 뜬 공 표시
      const x = clamp(b.x, 20, W - 20);
      c.beginPath(); c.moveTo(x, 6); c.lineTo(x - 16, 34); c.lineTo(x + 16, 34); c.closePath();
      c.fillStyle = '#d9f23f'; c.fill(); c.lineWidth = 3; c.strokeStyle = INK; c.stroke();
    } else this._drawBall(c, b.x, b.y, b.rot, BR);
  }

  _drawFx(c) {
    for (const f of this.fx) {
      const a = 1 - f.t / f.life;
      if (f.k === 'ring') {
        c.beginPath(); c.arc(f.x, f.y, lerp(f.r0, f.r1, f.t / f.life), 0, TAU);
        c.globalAlpha = a; c.lineWidth = 6 * a + 1; c.strokeStyle = f.color; c.stroke(); c.globalAlpha = 1;
      } else if (f.k === 'dot') {
        c.globalAlpha = a; c.fillStyle = f.color; c.beginPath(); c.arc(f.x, f.y, f.r, 0, TAU); c.fill(); c.globalAlpha = 1;
      } else if (f.k === 'conf') {
        c.save(); c.translate(f.x, f.y); c.rotate(f.rot); c.globalAlpha = Math.min(1, a * 2);
        c.fillStyle = f.color; c.fillRect(-f.r, -f.r * 0.45, f.r * 2, f.r * 0.9); c.restore();
      }
    }
    for (const p of this.pops) {
      const k = p.t / p.life, s = k < 0.15 ? 0.6 + k / 0.15 * 0.5 : 1.1 - Math.min(0.1, (k - 0.15));
      c.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      text(c, p.text, p.x, p.y - k * 40, { size: Math.round(p.size * s), color: p.color });
      c.globalAlpha = 1;
    }
  }

  _drawHud(c) {
    const [a, b] = this.players, cx = W / 2, y = 14, w = 560, h = 72;
    if (this.state === 'lobby') return;
    rrect(c, cx - w / 2, y, w, h, 22); c.fillStyle = 'rgba(255,250,242,0.95)'; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
    c.font = `900 26px ${FONT}`;
    const name = (p, x, align) => {
      let s = p.name; while (c.measureText(s).width > 170 && s.length > 1) s = s.slice(0, -1);
      text(c, s, x, y + h / 2 + 1, { size: 26, color: p.color, stroke: INK, sw: 5, align });
    };
    name(a, cx - 78, 'right'); name(b, cx + 78, 'left');
    text(c, String(a.score), cx - 40, y + h / 2 + 2, { size: 50, color: INK, stroke: null });
    text(c, ':', cx, y + h / 2 - 1, { size: 42, color: INK, stroke: null });
    text(c, String(b.score), cx + 40, y + h / 2 + 2, { size: 50, color: INK, stroke: null });
    if (this.state === 'serve' || this.state === 'rally' || this.state === 'point') {
      const sx = this.server === 0 ? cx - w / 2 + 26 : cx + w / 2 - 26;
      this._drawBall(c, sx, y + h / 2, 0, 12);
    }
    text(c, `${this.target}점 먼저 내면 승리!`, cx, y + h + 22, { size: 20, color: '#fff', sw: 5 });
    if (this.state === 'rally' && this.rally >= 2) text(c, `랠리 ${this.rally}`, cx, y + h + 52, { size: 26, color: '#ffd93d', sw: 6 });
  }

  _drawOverlays(c) {
    if (this.state === 'countdown' && !this.frozen) {
      const left = Math.ceil(RULES.COUNTDOWN_SEC - this.stateT), f = this.stateT % 1;
      text(c, String(Math.max(1, left)), W / 2, H / 2 - 30, { size: Math.round(190 * (1.25 - f * 0.25)), color: '#ffd93d', sw: 18 });
    }
    const bn = this.banner;
    if (bn) {
      const k = bn.t / bn.life, a = k < 0.12 ? k / 0.12 : k > 0.82 ? (1 - k) / 0.18 : 1, s = k < 0.12 ? 0.7 + k / 0.12 * 0.3 : 1;
      c.globalAlpha = clamp(a, 0, 1);
      const yy = bn.big ? 250 : 240;
      text(c, bn.title, W / 2, yy, { size: Math.round((bn.big ? 84 : 60) * s), color: '#fff', stroke: bn.color, sw: bn.big ? 16 : 12 });
      if (bn.sub) text(c, bn.sub, W / 2, yy + (bn.big ? 80 : 60), { size: bn.big ? 48 : 30, color: '#fff', sw: 7 });
      c.globalAlpha = 1;
    }
    if (this.frozen === 'absent') {
      for (const s of this.missing) {
        const x0 = s === 0 ? 0 : NET_X, cx = halfCenter(s), p = this.players[s];
        c.fillStyle = 'rgba(14,11,34,0.55)'; c.fillRect(x0, 0, NET_X, H);
        text(c, '⏸ 잠깐 멈춤', cx, 170, { size: 34, color: '#ffd93d' });
        text(c, '🙈', cx, 250, { size: 90, stroke: null });
        text(c, `${p.name} 선수가 안 보여요`, cx, 350, { size: 38 });
        text(c, `화면 ${SIDE_LABELS[s]} 반쪽 안에 서 주세요`, cx, 400, { size: 26 });
      }
      if (!this.missing.length) text(c, '좋아요! 곧 다시 시작해요', W / 2, H / 2, { size: 44, color: '#ffd93d' });
    }
  }

  _drawDebug(c) {
    const v = this.input;
    const lines = [
      `화면 ${this.fps.toFixed(0)}fps · 상태 ${this.state}${this.frozen ? `(${this.frozen})` : ''}`,
      v ? `인식 ${v.fps.toFixed(0)}fps · ${v.ms.toFixed(0)}ms · ${v.delegate} · ${v.threaded ? '워커' : '메인'} · ${v.FW}×${v.FH}` : '카메라 없음',
      `선수: ${this.players.map((p) => `${p.name}=${p.present ? 'O' : 'X'}`).join(' ')} · 공 e=${this.ball.e.toFixed(2)}`,
    ];
    c.font = `700 16px ${FONT}`;
    rrect(c, 8, H - 96, 560, 84, 10); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill();
    lines.forEach((l, i) => text(c, l, 18, H - 76 + i * 24, { size: 16, align: 'left', stroke: null, weight: 700 }));
  }
}

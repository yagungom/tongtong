// 통통 테니스 — 화면 흐름 담당
import { $, $$, store } from './util.js';
import * as fs from './fullscreen.js';
import { TennisEngine } from './game.js';
import { TennisSound } from './sound.js';
import { DuoVision } from './duo-vision.js';
import { LEVELS, RULES, QUALITY } from './config.js';

const params = new URLSearchParams(location.search);
const canvas = $('#game');
const sound = new TennisSound();
const engine = new TennisEngine(canvas, sound);
const mouseSide = params.has('mouse') ? (params.get('mouse') === 'right' ? 1 : 0) : null; // PC 확인용
if (mouseSide != null) engine.enableMouse(mouseSide);

// ── 설정 (이 기기에만 저장) ──
const DEFAULTS = {
  names: ['', ''], types: ['adult', 'kid'], target: RULES.DEFAULT_TARGET,
  facing: 'environment', cameraId: '', mirror: true, sfx: true, bgm: true, quality: 'high', debug: false,
};
const settings = { ...DEFAULTS, ...store.get('wt.settings.v1', {}) };
if (!Array.isArray(settings.names) || settings.names.length !== 2) settings.names = ['', ''];
if (!Array.isArray(settings.types) || settings.types.length !== 2 || !settings.types.every((t) => LEVELS[t])) settings.types = [...DEFAULTS.types];
if (!RULES.TARGETS.includes(settings.target)) settings.target = RULES.DEFAULT_TARGET;
if (!QUALITY[settings.quality]) settings.quality = 'high';
const saveSettings = () => store.set('wt.settings.v1', settings);
const applySettings = () => {
  sound.sfxOn = settings.sfx; sound.bgmOn = settings.bgm;
  engine.debug = settings.debug || params.has('debug');
  if (vision) vision.mirror = settings.mirror;
};

let vision = null;
let wakeLock = null;
let loadCancelled = false;

function show(name) {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === `scr-${name}`));
  document.body.dataset.screen = name;
  checkRotate();
}

// 이름: 화면에만 쓰고(글자로만 출력) 이 기기에만 저장. 꺾쇠·제어문자 제거, 6글자
const cleanName = (s, side) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 6) || (side ? '2P' : '1P');
const needsCamera = () => settings.types.some((t, s) => t !== 'cpu' && s !== mouseSide);

// ── 시작 화면 ──
function renderSetup() {
  for (let s = 0; s < 2; s++) {
    $(`#name${s}`).value = settings.names[s] || '';
    $$(`.seg[data-side="${s}"] .seg-btn`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === settings.types[s])));
  }
  $$('#target-row .seg-btn').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.target) === settings.target)));
  $$('#facing-row .seg-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.facing === settings.facing)));
  const cam = needsCamera();
  $('#facing-row').hidden = !cam; $('#facing-lbl').hidden = !cam;
  $('#btn-start').textContent = cam ? '경기 시작!' : '🤖 컴퓨터끼리 구경하기';
}
for (let s = 0; s < 2; s++) {
  $$(`.seg[data-side="${s}"] .seg-btn`).forEach((b) => b.addEventListener('click', () => { settings.types[s] = b.dataset.type; saveSettings(); renderSetup(); }));
  $(`#name${s}`).addEventListener('change', (e) => { settings.names[s] = e.target.value.trim().slice(0, 6); saveSettings(); });
}
$$('#target-row .seg-btn').forEach((b) => b.addEventListener('click', () => { settings.target = Number(b.dataset.target); saveSettings(); renderSetup(); }));
$$('#facing-row .seg-btn').forEach((b) => b.addEventListener('click', () => { settings.facing = b.dataset.facing; settings.cameraId = ''; saveSettings(); renderSetup(); }));

function goTitle() {
  loadCancelled = true;
  if (vision) vision.stopCamera(); // 카메라는 쓰지 않을 때 바로 끔
  engine.setInput(null);
  sound.stopBgm();
  releaseWake();
  engine.startDemo();             // 뒤에서 컴퓨터끼리 시범 경기
  renderSetup();
  show('title');
}

$('#btn-start').addEventListener('click', () => startGame());

async function startGame() {
  for (let s = 0; s < 2; s++) settings.names[s] = $(`#name${s}`).value.trim().slice(0, 6);
  saveSettings();
  sound.unlock();
  enterFullscreen();
  requestWake();
  engine.stop();
  engine.setPlayers(settings.types.map((type, s) => ({ type, name: cleanName(settings.names[s], s) })));
  engine.setTarget(settings.target);
  if (!needsCamera()) { if (vision) vision.stopCamera(); engine.setInput(null); enterLobby(); return; }
  loadCancelled = false;
  show('loading'); $('#loading-text').textContent = '카메라 켜는 중… (권한을 허용해 주세요)';
  try {
    if (!vision) vision = new DuoVision({ quality: settings.quality, mirror: settings.mirror });
    vision.mirror = settings.mirror;
    try { await vision.startCamera({ deviceId: settings.cameraId || null, facing: settings.facing }); }
    catch (e) {
      if (!settings.cameraId || e?.name === 'NotAllowedError') throw e;
      settings.cameraId = ''; saveSettings(); // 저장된 카메라가 없어졌으면 앞/뒤 기준으로 다시
      await vision.startCamera({ facing: settings.facing });
    }
    if (loadCancelled) { vision.stopCamera(); return; }
    await vision.init((msg) => { $('#loading-text').textContent = msg; });
    if (loadCancelled) { vision.stopCamera(); return; }
    engine.setInput(vision);
    enterLobby();
  } catch (e) {
    console.warn(e);
    if (vision) vision.stopCamera();
    if (!loadCancelled) showCamError(e);
  }
}

function showCamError(e) {
  const name = e?.name || '';
  let title = '카메라를 켤 수 없어요', msg = '';
  if (name === 'NotAllowedError' || name === 'SecurityError') { title = '카메라 권한이 필요해요'; msg = '주소창 옆 자물쇠 → 권한 → 카메라 허용 후 다시 시도해 주세요. 영상은 이 기기 밖으로 나가지 않아요.'; }
  else if (name === 'NotFoundError' || name === 'OverconstrainedError') { msg = '카메라를 찾지 못했어요. 시작 화면에서 후면/전면을 바꿔 보세요.'; settings.cameraId = ''; saveSettings(); }
  else if (name === 'NotReadableError') msg = '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫고 다시 시도해 주세요.';
  else if (!window.isSecureContext) msg = '카메라는 https 주소에서만 켜져요.';
  else msg = '사람 인식 엔진을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.';
  $('#camerr-title').textContent = title; $('#camerr-text').textContent = msg;
  show('camerr');
}
$('#btn-cancel-load').addEventListener('click', () => goTitle());
$('#btn-cam-retry').addEventListener('click', () => startGame());
$('#btn-cam-home').addEventListener('click', () => goTitle());

// ── 대기실 ──
function enterLobby() {
  engine.enterLobby();
  $('#btn-cam-switch').hidden = !engine.input;
  show('lobby');
  sound.stopBgm();
}
$('#btn-go').addEventListener('click', () => { sound.unlock(); engine.startCountdown(); });
$('#btn-lobby-home').addEventListener('click', () => goTitle());

// 카메라 바꾸기: 누를 때마다 다음 카메라 (광각 렌즈 등)
let toastTimer = 0;
function toast(msg) {
  const t = $('#cam-toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
const FRONT_RE = /front|user|전면|facetime/i, BACK_RE = /back|rear|environment|후면/i;
$('#btn-cam-switch').addEventListener('click', async () => {
  if (!vision || engine.input !== vision) return;
  const cams = await DuoVision.listCameras();
  if (cams.length < 2) { toast('바꿀 수 있는 카메라가 하나뿐이에요'); return; }
  const i = cams.findIndex((c) => c.deviceId === vision.deviceId);
  const next = cams[(i + 1) % cams.length];
  try {
    await vision.startCamera({ deviceId: next.deviceId });
    settings.cameraId = next.deviceId;
    if (vision.facing === 'user' || FRONT_RE.test(next.label)) settings.facing = 'user';
    else if (vision.facing === 'environment' || BACK_RE.test(next.label)) settings.facing = 'environment';
    saveSettings();
    const n = (i + 1) % cams.length + 1;
    toast(`📷 카메라 ${n}/${cams.length}${next.label ? ` · ${next.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')}` : ''}`);
  } catch (e) {
    console.warn(e);
    try { await vision.startCamera({ facing: settings.facing }); } catch { showCamError(e); }
  }
});

// ── 경기 ──
engine.on('countdown', () => { show('play'); sound.startBgm(3, 108); });
engine.on('over', (r) => {
  sound.stopBgm();
  $('#res-title').textContent = `🏆 ${r.names[r.winner]} 승리!`;
  $('#res-name0').textContent = r.names[0];
  $('#res-name1').textContent = r.names[1];
  $('#res-score').textContent = `${r.scores[0]} : ${r.scores[1]}`;
  const sm = r.smashes[0] + r.smashes[1];
  $('#res-stats').textContent = `최고 랠리 ${r.maxRally}번${sm ? ` · 스매시 ${sm}번` : ''}`;
  setTimeout(() => { if (engine.state === 'over') show('result'); }, 900);
});
engine.on('retry', () => show('play'));

$('#btn-retry').addEventListener('click', () => { sound.unlock(); engine.startCountdown(); });
$('#btn-home').addEventListener('click', () => goTitle());
$('#btn-pause').addEventListener('click', () => { engine.pause(); sound.stopBgm(); show('pause'); });
$('#btn-resume').addEventListener('click', () => { engine.resume(); sound.startBgm(3, 108); show('play'); });
$('#btn-quit').addEventListener('click', () => goTitle());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (engine.active) { engine.pause(); sound.stopBgm(); show('pause'); } }
  else if (engine.input) requestWake();
});

// ── 하는 법·설정 ──
$('#btn-help').addEventListener('click', () => show('help'));
$('#help-back').addEventListener('click', () => show('title'));
const qSel = $('#set-quality');
for (const [k, q] of Object.entries(QUALITY)) { const o = document.createElement('option'); o.value = k; o.textContent = q.label; qSel.append(o); }
$('#btn-settings').addEventListener('click', () => {
  $('#set-mirror').checked = settings.mirror; $('#set-sfx').checked = settings.sfx; $('#set-bgm').checked = settings.bgm;
  $('#set-debug').checked = settings.debug; qSel.value = settings.quality;
  show('settings');
});
$('#settings-back').addEventListener('click', () => show('title'));
$('#set-mirror').addEventListener('change', (e) => { settings.mirror = e.target.checked; saveSettings(); applySettings(); });
$('#set-sfx').addEventListener('change', (e) => { settings.sfx = e.target.checked; saveSettings(); applySettings(); });
$('#set-bgm').addEventListener('change', (e) => { settings.bgm = e.target.checked; saveSettings(); applySettings(); });
$('#set-debug').addEventListener('change', (e) => { settings.debug = e.target.checked; saveSettings(); applySettings(); });
qSel.addEventListener('change', (e) => {
  settings.quality = e.target.value; saveSettings();
  if (vision) { vision.stopCamera(); vision.setQuality(settings.quality); }
});

// ── 전체화면·화면 꺼짐 방지 ──
const NS = 'http://www.w3.org/2000/svg';
function fsIcon(exit) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', exit ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2.6');
  p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(p); return svg;
}
function renderFsButtons() {
  const on = fs.isFullscreen();
  const hide = fs.isStandalone() && !on && (!fs.supported() || fs.platform.iOS);
  const label = on ? '창 모드' : '전체화면';
  for (const b of $$('[data-fs]')) {
    b.hidden = hide;
    b.replaceChildren(fsIcon(on));
    if (b.classList.contains('fs-title')) { const s = document.createElement('span'); s.className = 'fs-label'; s.textContent = label; b.append(s); }
    b.setAttribute('aria-label', label);
  }
}
let fsBack = 'title';
function openFsGuide() {
  if (engine.active) { engine.pause(); sound.stopBgm(); }
  const g = fs.guide();
  fsBack = engine.active ? 'pause' : (document.body.dataset.screen || 'title');
  $('#fsguide-title').textContent = g.title;
  $('#fsguide-note').textContent = g.note;
  $('#fsguide-steps').replaceChildren(...g.steps.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
  show('fsguide');
}
$('#fsguide-close').addEventListener('click', () => show(fsBack));
$$('[data-fs]').forEach((b) => b.addEventListener('click', async () => {
  sound.unlock();
  if (fs.isFullscreen()) { await fs.exit(); return; }
  const ok = await fs.enter();
  if (!ok || !fs.isFullscreen()) { await new Promise((r) => setTimeout(r, 300)); if (!fs.isFullscreen()) openFsGuide(); }
}));
fs.onChange(renderFsButtons);
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key === 'f' || e.key === 'F') && fs.supported()) fs.toggle();
});
async function enterFullscreen() { if (fs.supported() && !fs.isFullscreen()) await fs.enter(); }
async function requestWake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); } } catch { /* noop */ }
}
function releaseWake() { try { wakeLock?.release(); } catch { /* noop */ } wakeLock = null; }

// ── 세로 화면 안내 ──
let rotateDismissed = false;
function checkRotate() {
  const portrait = window.innerHeight > window.innerWidth;
  const playing = document.body.dataset.screen && document.body.dataset.screen !== 'title';
  $('#rotate-hint').hidden = !(portrait && playing && !rotateDismissed && needsCamera());
}
window.addEventListener('resize', checkRotate);
$('#rotate-dismiss').addEventListener('click', () => { rotateDismissed = true; checkRotate(); });

// ── 시작 ──
applySettings();
renderFsButtons();
goTitle();
if (params.has('test')) window.__tn = { engine, settings, get vision() { return vision; }, show, startGame };

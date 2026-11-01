// ─────────────────────────────────────────────────────────────
//  통통 테니스 설정 — 숫자만 바꿔서 규칙·난이도를 조절할 수 있어요
// ─────────────────────────────────────────────────────────────

// 사람 인식 엔진·모델 (이 폴더에 같이 들어 있어 외부 서버를 부르지 않습니다)
export const PATHS = Object.freeze({
  BUNDLE: 'vendor/mediapipe/vision_bundle.mjs',
  WASM: 'vendor/mediapipe/wasm',
  POSE_MODELS: { full: 'models/pose_landmarker_full.task', lite: 'models/pose_landmarker_lite.task' },
});

// 코트 (화면 기준 1280×720, 16:9 고정)
export const COURT = Object.freeze({
  W: 1280,
  H: 720,
  GROUND: 652,      // 바닥(공이 튀는 곳) 높이
  NET_X: 640,       // 네트 위치 = 화면 가운데 (왼쪽 선수 | 오른쪽 선수)
  NET_TOP: 548,     // 네트 위쪽 끝
  NET_HALF: 6,      // 네트 두께의 절반
  BALL_R: 17,       // 공 반지름
  GRAVITY: 980,     // 중력 (px/s²)
});

// 선수 종류 — '받는 쪽' 기준으로 공 속도·정확도가 정해짐 (아이에게는 느리고 정확하게)
//  racket: 라켓 크기 배율 · slow/fast: 살살 쳤을 때 / 세게 쳤을 때 상대 코트까지 걸리는 시간(초)
//  jitter: 공이 받는 사람 앞으로 정확히 가는 정도 (클수록 여기저기)
//  bounces: 이 쪽 코트에서 몇 번까지 튕겨도 되는지 (어른 1번 = 테니스 규칙, 어린이 2번)
export const LEVELS = Object.freeze({
  adult: { label: '어른', emoji: '🧑', racket: 1.0, slow: 1.55, fast: 0.95, jitter: 1.0, bounces: 1 },
  kid: { label: '어린이', emoji: '🧒', racket: 1.4, slow: 1.95, fast: 1.5, jitter: 0.3, bounces: 2 },
  cpu: { label: '컴퓨터', emoji: '🤖', racket: 1.0, slow: 1.55, fast: 1.0, jitter: 0.9, bounces: 1 },
});

export const RULES = Object.freeze({
  TARGETS: [3, 5, 7],      // 몇 점 먼저 내면 이기는지 (시작 화면에서 고름)
  DEFAULT_TARGET: 5,
  SERVE_AUTO_SEC: 9,       // 서브 공을 이 시간 안에 못 치면 자동으로 톡 넘겨 줌
  POINT_PAUSE_SEC: 1.9,    // 점수 난 뒤 다음 서브까지
  COUNTDOWN_SEC: 3,
  ABSENT_PAUSE_MS: 2000,   // 선수가 이 시간 동안 안 보이면 자동 일시정지
  RETURN_MS: 700,          // 다시 보이고 이만큼 지나면 이어서
  SMASH_POWER: 0.72,       // 이보다 세게 휘두르면 '스매시!'
  SWING_MIN: 260,          // 라켓 속도(px/s) — 이 아래는 살살 친 공
  SWING_MAX: 2600,         //                    이 위는 가장 센 공
  HIT_MARGIN: 40,          // 네트 너머 이만큼까지는 내 공으로 쳐 줌 (네트 앞 발리)
});

export const SIDE_COLORS = Object.freeze(['#4d96ff', '#ff6b6b']);
export const SIDE_LABELS = Object.freeze(['왼쪽', '오른쪽']);

// 인식 화질: 카메라 프레임을 이 크기로 줄여서 좌우 반쪽씩 따로 자세 인식
export const QUALITY = Object.freeze({
  best: { w: 960, h: 540, pose: 'full', label: '최고 (정확, 최신 폰)' },
  high: { w: 768, h: 432, pose: 'lite', label: '고화질' },
  normal: { w: 640, h: 360, pose: 'lite', label: '표준' },
  low: { w: 512, h: 288, pose: 'lite', label: '절전' },
});

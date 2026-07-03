// ============================================================
// データ設計: Player / Game / AtBat / Pitch / PlayLog / PitchingRecord
// ローカル保存(localStorage)と Firestore で同一スキーマを共有する。
// ============================================================

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- 打撃結果種別 ----
export const RESULTS = {
  single: { label: '単打', short: 'H', hit: true, bases: 1, ab: true, onBase: true },
  double: { label: '二塁打', short: '2B', hit: true, bases: 2, ab: true, onBase: true },
  triple: { label: '三塁打', short: '3B', hit: true, bases: 3, ab: true, onBase: true },
  hr: { label: '本塁打', short: 'HR', hit: true, bases: 4, ab: true, onBase: true },
  out: { label: '凡打', short: 'OUT', hit: false, bases: 0, ab: true, onBase: false },
  bb: { label: '四球', short: 'BB', hit: false, bases: 0, ab: false, onBase: true },
  hbp: { label: '死球', short: 'HBP', hit: false, bases: 0, ab: false, onBase: true },
  so: { label: '三振', short: 'K', hit: false, bases: 0, ab: true, onBase: false },
  error: { label: '失策出塁', short: 'E', hit: false, bases: 0, ab: true, onBase: true },
  sacBunt: { label: '犠打', short: 'SAC', hit: false, bases: 0, ab: false, onBase: false },
  sacFly: { label: '犠飛', short: 'SF', hit: false, bases: 0, ab: false, onBase: false },
  interference: { label: '打撃妨害', short: 'IF', hit: false, bases: 0, ab: false, onBase: true },
};

// ---- 凡打の内訳 ----
export const OUT_TYPES = {
  ground: 'ゴロ',
  fly: 'フライ',
  liner: 'ライナー',
  dp: '併殺打',
};

// ---- 打球方向 ----
export const DIRECTIONS = {
  P: '投手', C: '捕手', '1B': '一塁', '2B': '二塁', '3B': '三塁',
  SS: '遊撃', LF: '左翼', CF: '中堅', RF: '右翼',
};

// ---- 守備位置 ----
export const POSITIONS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右', 'DH', '控'];

// ============================================================
// ファクトリ関数(スキーマ定義を兼ねる)
// ============================================================

export function newPlayer(name, number = '') {
  return { id: uid(), name, number, createdAt: Date.now() };
}

export function newGame({ opponent = '', isHome = false, date = null } = {}) {
  return {
    id: uid(),
    date: date || new Date().toISOString().slice(0, 10),
    opponent,
    isHome, // true=自チーム後攻
    status: 'ongoing', // 'ongoing' | 'finished'
    inning: 1,
    isTop: true, // 表/裏
    outs: 0,
    // 走者: 各塁 null または { playerId(自チーム時) , label, pitcherId(責任投手/守備時) }
    runners: { 1: null, 2: null, 3: null },
    myScore: 0,
    oppScore: 0,
    // 打順: [{ order, playerId, position }] を9枠
    lineup: [],
    usedPlayerIds: [], // 出場済み
    retiredPlayerIds: [], // 一度退いた(再出場警告用)
    batterIndex: 0, // 次打者のlineup index
    currentPitcherId: null,
    atBats: [], // AtBat[]
    playLogs: [], // PlayLog[]
    pitchingRecords: [], // PitchingRecord[]
    updatedAt: Date.now(),
  };
}

// AtBat: 打席。開始時スナップショットを必ず保持する。
export function newAtBat({ gameId, playerId, order, snapshot }) {
  return {
    id: uid(),
    gameId,
    playerId,
    order,
    // 結果(確定時に埋める)
    result: null, // RESULTS のキー
    outType: null, // OUT_TYPES のキー(凡打時)
    direction: null, // DIRECTIONS のキー
    rbi: 0,
    runsOnPlay: 0,
    // 投球(Pitch構造の配列): { type: 'ball'|'strike'|'foul'|'inplay', ts }
    pitches: [],
    pitchCount: 0,
    firstPitch: null, // 初球結果
    firstPitchHit: false, // 初球インプレーで安打
    // 打席開始時スナップショット(RISP/ADV%/クラッチ判定に必須)
    snapshot: snapshot || {
      runners: { 1: false, 2: false, 3: false },
      outs: 0,
      inning: 1,
      isTop: true,
      scoreDiff: 0, // 自チーム − 相手 (打席開始時)
    },
    advSuccess: null, // 走者あり凡打: 進塁打成功 true/false、対象外は null
    clutch: null, // 'first'|'tie'|'goahead'|'comeback'|null
    ts: Date.now(),
  };
}

// Pitch: 1球。AtBat.pitches に格納(同一スキーマでCSVにも展開)
export function newPitch(type) {
  return { type, ts: Date.now() }; // type: 'ball'|'strike'|'foul'|'inplay'
}

// PlayLog: 全プレイの時系列ログ
export function newPlayLog({ gameId, inning, isTop, kind, text, payload = {} }) {
  return { id: uid(), gameId, inning, isTop, kind, text, payload, ts: Date.now() };
}

// PitchingRecord: 投手成績(1試合1投手1レコード)
export function newPitchingRecord({ gameId, playerId, appearanceOrder }) {
  return {
    id: uid(),
    gameId,
    playerId,
    appearanceOrder,
    outsRecorded: 0, // 1/3回単位(アウト数)
    runs: 0, // 失点
    earnedRuns: 0, // 自責点(手動微調整可)
    hitsAllowed: 0, // 被安打
    walks: 0, // 与四球
    hitByPitch: 0, // 与死球
    strikeouts: 0, // 奪三振
    pitches: 0, // 投球数
    abFaced: 0, // 被打数(相手の打数: 被打率の分母)
    win: false,
    save: false,
    hold: false, // ホールド
    ts: Date.now(),
  };
}

// 投球回の表示 (アウト数 → "3.2" 形式)
export function formatIP(outs) {
  const full = Math.floor(outs / 3);
  const rem = outs % 3;
  return rem === 0 ? `${full}` : `${full}.${rem}`;
}

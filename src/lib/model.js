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
  error: { label: 'エラー', short: 'E', hit: false, bases: 0, ab: true, onBase: true },
  sacBunt: { label: '犠打', short: 'SAC', hit: false, bases: 0, ab: false, onBase: false },
  sacFly: { label: '犠飛', short: 'SF', hit: false, bases: 0, ab: false, onBase: false },
  interference: { label: '打撃妨害', short: 'IF', hit: false, bases: 0, ab: false, onBase: true },
  // 守備妨害(攻撃側の妨害): 打者/走者アウト。走塁妨害(守備側の妨害/オブストラクション): 出塁が認められる。
  fieldInterference: { label: '守備妨害', short: '守妨', hit: false, bases: 0, ab: true, onBase: false },
  obstruction: { label: '走塁妨害', short: '走妨', hit: false, bases: 0, ab: false, onBase: true },
};

// ---- 三振の内訳 ----
export const SO_TYPES = { swinging: '空振り三振', looking: '見逃し三振' };

// ---- 凡打の内訳 ----
export const OUT_TYPES = {
  ground: 'ゴロ',
  fly: 'フライ',
  liner: 'ライナー',
  dp: '併殺打',
};

// プレイ結果の分類(スコアシート・ログの色分け用。画面とPDFで同一のクラス名を使う)。
// hit=ヒット / outres=アウト / walk=四死球 / error=エラー / sac=犠打犠飛 / intf=妨害 / other=その他
export function resultCategory(result) {
  const r = RESULTS[result];
  if (!r) return 'other';
  if (r.hit) return 'hit';
  if (result === 'error') return 'error';
  if (result === 'bb' || result === 'hbp') return 'walk';
  if (result === 'sacBunt' || result === 'sacFly') return 'sac';
  if (result === 'interference' || result === 'obstruction' || result === 'fieldInterference') return 'intf';
  if (result === 'out' || result === 'so') return 'outres';
  return 'other';
}

// 1プレイでまとめて取ったアウト数の強調表記(2=ダブルプレー, 3=トリプルプレー)。
export function multiOutLabel(outsOnPlay) {
  if (outsOnPlay >= 3) return 'トリプルプレー';
  if (outsOnPlay === 2) return 'ダブルプレー';
  return null;
}

// 凡打の内訳ラベル。少年野球エディションでは親しみやすい表記に差し替える(併殺打→ゲッツー)。
export function outTypeLabel(outType, edition) {
  if (edition === '少年野球' && outType === 'dp') return 'ゲッツー';
  return OUT_TYPES[outType] || '';
}

// ---- 打球方向 ----
export const DIRECTIONS = {
  P: '投手', C: '捕手', '1B': '一塁', '2B': '二塁', '3B': '三塁',
  SS: '遊撃', LF: '左翼', CF: '中堅', RF: '右翼',
};

// ---- 守備位置 ----
// '打' = 全員打ちの打撃のみ(守備につかない打者)、'控' = ベンチ
export const POSITIONS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右', 'DH', '打', '控'];

// ---- 相手チームの選手記号(実名は入力せず A〜T の20人で管理) ----
export const OPP_LETTERS = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i));

// ============================================================
// ファクトリ関数(スキーマ定義を兼ねる)
// ============================================================

// 投打の左右。空文字=未設定(任意入力)。
export const HAND_OPTIONS = ['', 'R', 'L', 'S']; // R=右 / L=左 / S=両(スイッチ)
export const HAND_LABEL = { R: '右', L: '左', S: '両', '': '—' };

export function newPlayer(name, number = '', opts = {}) {
  return {
    id: uid(), name, number, createdAt: Date.now(),
    throws: opts.throws || '', // 投げる手: 'R'|'L'|'' (捕手左投げ等の稀少ケースも許容)
    bats: opts.bats || '',     // 打つ側: 'R'|'L'|'S'|''
    // AI選手名鑑(スカウト寸評)の保存内容。未確定の間は編集画面側のローカル状態のみで保持する。
    scoutTags: [], // { label, type }[]
    scoutCatchphrase: '',
    scoutReport: '',
    scoutPhoto: '', // 顔写真(256px JPEGのdataURL)。空なら頭文字を表示。
  };
}

// ---- エディション(利用シーン別のモード切り替え) ----
// AIスタメン提案・AI選手名鑑など一部AI機能は「草野球」エディション(=大人向け)限定。
// パワプロ風の際どい寸評等が未成年(ブカツ/少年野球)の文脈にそぐわないため。
// ※「草野球」エディションは社会人野球も包含する(いずれも大人・標準用語・AI機能ありで挙動が同一)。
//   内部の保存値は '草野球' のままとし、UI表示だけ editionLabel() で「草野球・社会人」にする
//   (データ移行不要・既存の判定/CSS/プリセットを一切変えないため)。
export const EDITIONS = ['草野球', 'ブカツ(中高大)', '少年野球'];
export const DEFAULT_EDITION = '草野球';

// エディションのUI表示ラベル。保存値は変えず表示のみ差し替える。
export function editionLabel(edition) {
  return edition === '草野球' ? '草野球・社会人' : (edition || '草野球');
}

// 旧表記(初期リリースの「ブカツ(中-大)」)を現行表記へ正規化する。
// 保存済みデータ(settings.edition / チームレジストリ)の読み込み時に通すこと。
export function normalizeEdition(edition) {
  return edition === 'ブカツ(中-大)' ? 'ブカツ(中高大)' : edition;
}

// ---- 参加メンバー(マネージャー/応援/スタッフ等。試合には出ないが参加回数を記録する) ----
export const MEMBER_ROLES = ['マネージャー', 'コーチ', '応援', 'スタッフ', 'その他'];

export function newMember(name, role = 'マネージャー') {
  return {
    id: uid(), name, role, participation: 0, createdAt: Date.now(),
    // 選手と同じく名鑑(スカウト寸評)を持てる
    scoutTags: [],
    scoutCatchphrase: '',
    scoutReport: '',
    scoutPhoto: '',
  };
}

export function newGame({ opponent = '', isHome = false, date = null, season = '', rules = null } = {}) {
  return {
    id: uid(),
    date: date || new Date().toISOString().slice(0, 10),
    opponent,
    season, // シーズン/大会名(任意。集計フィルタに使用)
    isHome, // true=自チーム後攻
    // 試合ルール(lib/rules.js)。試合作成時のルールをスナップショットとして保持する。
    // null = ルール管理なし(旧データ含む。終了提案・球数警告などの判定は無効)
    rules,
    startedAt: Date.now(), // 試合開始時刻(時間制限ルールの判定に使用)
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
    // 相手チーム: 実名の代わりに A〜T の記号で管理する打順(9枠)。代打・代走・守備交代で入れ替え可能
    oppLineup: OPP_LETTERS.slice(0, 9).map((letter, i) => ({ order: i + 1, letter, position: '' })),
    oppUsedLetters: OPP_LETTERS.slice(0, 9), // 出場済み記号
    oppRetiredLetters: [], // 一度退いた記号(再出場警告用)
    oppBatterIndex: 0, // 次の相手打者のoppLineup index
    oppPitcherLetter: null, // 相手投手(記号ラベルで管理)
    // 相手投手の球数(記号ごと)。成績は追わないが球数だけはペース把握のため記録する。
    // { [letter]: { pitches, pitchesByInning: { "1": n, ... } } }
    oppPitchers: {},
    // 左右別スタッツ用: 相手投手・相手打者の投打(記号ごと)。任意。'R'|'L'|'S'
    oppPitcherHands: {}, // { [letter]: 'R'|'L' } 自軍打者の対左右投手splitに使う
    oppBatterHands: {},  // { [letter]: 'R'|'L'|'S' } 自軍投手の対左右打者splitに使う
    atBats: [], // AtBat[]
    playLogs: [], // PlayLog[]
    pitchingRecords: [], // PitchingRecord[]
    linescore: {}, // { [inning]: { my, opp } } 回ごとの得点(試合結果の線分表示用)
    // CSV取り込み(ボックススコア)の集計値。プレイ単位ではなく選手ごとの合計を保持し、
    // 成績集計エンジンが加算する。空欄項目は0扱い(まばらなデータも許容)。
    importedBatting: [], // [{ playerId, pa, ab, h, single, double, triple, hr, rbi, bb, hbp, so, sacBunt, sacFly, sb, runs, tb }]
    importedPitching: [], // [{ playerId, outsRecorded, runs, earnedRuns, hitsAllowed, walks, hitByPitch, strikeouts, pitches, abFaced, win, save, hold }]
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
    soType: null, // 三振の種類: 'swinging'(空振り) | 'looking'(見逃し)
    direction: null, // DIRECTIONS のキー
    rbi: 0,
    runsOnPlay: 0,
    // 投球(Pitch構造の配列): { type: 'ball'|'strike'|'foul'|'inplay', sub?, ts }
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
    vsHand: null, // 対戦した相手投手の投げ手 'R'|'L'(左右別split用。未設定null)
    clutch: null, // 'first'|'tie'|'goahead'|'comeback'|null
    ts: Date.now(),
  };
}

// Pitch: 1球。AtBat.pitches に格納(同一スキーマでCSVにも展開)
// type: 'ball'|'strike'|'foul'|'inplay' / sub: ストライクの種別 'looking'(見逃し)|'swinging'(空振り)。任意。
export function newPitch(type, sub = null) {
  const p = { type, ts: Date.now() };
  if (sub) p.sub = sub;
  return p;
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
    pitchesByInning: {}, // イニング別投球数 { "1": 12, "2": 15, ... }(ペース把握用)
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

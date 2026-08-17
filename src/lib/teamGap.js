// ============================================================
// チーム差 — 相手との力の差を、勝率そのもので入れる
//
// ---- なぜ「得点◯倍」ではなく「10回中◯回勝てる」なのか ----
// 「格上だから得点期待値を0.85倍」は、0.85の根拠がどこにもない。
// 一方「10回やって3回は勝てる相手」なら、記録員が試合前に答えられるし、
// アプリは勝率を計算できるので、そこから倍率を逆に解ける。
//
//   設定「10回中3回」 → プレイボール時点の勝率が30%になる倍率を二分探索
//
// 倍率はこちらが決めた数字ではなく、計算で出てくる結果になる。そして
// 設定が効いているかを誰でも確かめられる: 30%と設定した試合は、
// 流れチャートが30%から始まる。それだけ。
//
// 副産物として、7回制と9回制で同じ「3割」を作る倍率が変わる。試合が短い
// ほど番狂わせが起きやすいので、短い試合ほど大きな戦力差が要る。
// 手で倍率を決めていたら出てこない挙動で、こちらのほうが現実に近い。
//
// ---- 表は2枚になる ----
// 格上が相手なら、こちらの期待得点は下がり、期待失点は上がる。逆向きに
// 動くので1枚では表せない。攻撃時と守備時で別の表を持つ。
// (互角のときだけ、2枚は完全に同じ = いままでの表そのもの)
// ============================================================
import { priorDist, buildWinModel } from './winExp.js';

// 5段階。副題の「10回中◯回」が本体で、名前はその呼び名。
//   両端を0%/100%にはできない。勝率0%からは動きようがないので、WPAが
//   全員ゼロになり、流れチャートが真っ平らな直線になってしまう。
//   「10回中10回負ける」は日本語として「まず勝てない」の意味なので5%に置く。
export const TEAM_GAPS = [
  { id: 'borrow', win: 0.05 },    // 胸を借りる
  { id: 'challenge', win: 0.30 }, // 挑戦
  { id: 'even', win: 0.50 },      // 互角
  { id: 'accept', win: 0.70 },    // 受けて立つ
  { id: 'lend', win: 0.95 },      // 胸を貸す
];
export const DEFAULT_TEAM_GAP = 'even';

export const gapOf = (id) => TEAM_GAPS.find((g) => g.id === id) || TEAM_GAPS[2];
export const isEvenGap = (id) => gapOf(id).id === 'even';

// ---- 平均を動かすと「1点以上入る確率」もついてくる ----
// 分布は平均と0点率の2つで決まる(winExp.js priorDist)。平均だけ動かして
// 0点率を据え置くと、「点は入りにくいのに入ると大量点」という歪んだ形になる。
//
// 2つがどう連動するかは、土台の2つの表から測れる。NPB実測の24状況で
// log(1点以上入る確率) を log(得点期待値) に回帰すると傾き 0.894、R²=0.968。
// つまり s ≒ (定数) × RE^0.894 がほぼ直線に乗る。これをそのまま使う。
//   出典: どちらも baseball.piupapp.com「得点期待値 / 得点確率」NPB 2023-2025
//   加工: 24点の最小二乗。scripts/fit-score-prob.mjs で再現できる
export const S_EXP = 0.894;

// 分布の平均を f 倍する。形は同じ族(0点だけ別扱い＋その先は幾何分布)のまま。
// f が 1 ちょうどなら何もしない — 互角の試合はいままでの分布そのままになる
export function scaleDist(dist, f) {
  if (!Array.isArray(dist) && !ArrayBuffer.isView(dist)) return dist;
  if (!(f > 0) || Math.abs(f - 1) < 1e-9) return dist;
  let m = 0;
  for (let k = 0; k < dist.length; k++) m += dist[k] * k;
  if (!(m > 0)) return dist;
  const s = 1 - dist[0];
  return priorDist(m * f, s * Math.pow(f, S_EXP));
}

export function scaleDists(dists, f) {
  if (!dists || Math.abs(f - 1) < 1e-9) return dists;
  const out = new Map();
  for (const [k, d] of dists) out.set(k, scaleDist(d, f));
  return out;
}

// ---- 倍率を勝率から逆に解く ----
// r は「相手のほうが強い倍率」。自チームの攻撃を 1/r 倍、相手の攻撃を r 倍する。
// r を上げるほど勝率は単調に下がるので、二分探索で目標に当てられる。
const R_MIN = 1 / 8;
const R_MAX = 8;

export function openingWin(build, r) {
  const we = build(r);
  return we({ inning: 1, isTop: true, runners: { 1: false, 2: false, 3: false }, outs: 0, diff: 0 });
}

// build(r) … 倍率 r の勝率モデルを返す関数
export function solveGapFactor(build, targetWin) {
  const target = Math.min(0.99, Math.max(0.01, Number(targetWin)));
  // 互角は解かない。r=1 と決め打つことで、いままでの計算と1ビットも変えない
  if (Math.abs(target - 0.5) < 1e-9) return 1;
  let lo = R_MIN;
  let hi = R_MAX;
  // 端で届かない目標(短い試合では95%を作れないことがある)は、端で打ち切る
  if (openingWin(build, R_MAX) > target) return R_MAX;
  if (openingWin(build, R_MIN) < target) return R_MIN;
  for (let i = 0; i < 40; i++) {
    const mid = Math.sqrt(lo * hi); // 倍率なので対数の真ん中で割る
    if (openingWin(build, mid) > target) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

// ------------------------------------------------------------
// 試合1つぶんのチーム差つき勝率モデル
//
// 返すもの:
//   we      … 勝率モデル(攻撃用/守備用の分布を持つ)
//   factor  … 解けた倍率 r
//   opening … その設定でのプレイボール時点の勝率(設定値と一致するはず)
//   own/opp … 攻撃時・守備時の分布(ヒートマップが読む)
// ------------------------------------------------------------
export function buildGapModel({ dists, isHome, regulation, halfStartKey, gap }) {
  const target = gapOf(gap).win;
  const build = (r) => buildWinModel({
    dists: scaleDists(dists, 1 / r),
    oppDists: scaleDists(dists, r),
    isHome, regulation, halfStartKey,
  });
  const factor = solveGapFactor(build, target);
  const own = scaleDists(dists, 1 / factor);
  const opp = scaleDists(dists, factor);
  const we = buildWinModel({ dists: own, oppDists: opp, isHome, regulation, halfStartKey });
  return { we, factor, opening: openingWin(build, factor), own, opp, target };
}

// 期待得点・期待失点の表そのものを倍率で作る(ヒートマップ用)。
// 分布ではなく平均の表なので、単純に掛けるだけでよい
export function gapTables(re, factor) {
  const off = new Map();
  const def = new Map();
  for (const [k, v] of re) {
    off.set(k, v / factor);
    def.set(k, v * factor);
  }
  return { off, def };
}

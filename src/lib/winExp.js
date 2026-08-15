// ============================================================
// 勝利期待値(WE) — 試合の流れの土台
//
// ---- なぜ得点期待値ではなく勝利期待値なのか ----
// 得点期待値(RE)の差を足し上げたもの(RE24)は、1プレイ・1選手の貢献を
// 「点」で測るための指標で、試合の流れを描くためのものではない。
// 実際、RE24の積み上げは回の切れ目でそのときの点差と一致し、回の途中は
// アウトのぶん必ず下へ流れるので、完全な0-0の試合でも先に攻めるほうが
// 8割がた「劣勢」に見えてしまう(基準線が0にならない)。
//
// 流れを描くために確立されているのは勝利期待値のほう。
//   ・縦軸は0〜100%。50%が互角で、基準線が動かない
//   ・「相手に傾いている」= 勝率が50%を下回っている、で説明が終わる
//   ・1プレイの動き(WPA)がそのまま「その打席で勝率をどれだけ動かしたか」
//
// ---- どうやって出すか ----
// 公開されている勝率表はMLBの得点環境・9回制が前提で、7回制・タイブレーク・
// コールドのあるアマチュアの試合には合わない。だから自分たちの記録から作る。
//   1. 半回に何点入るかの分布を、24の塁状況×アウトごとに数える
//   2. 回数が少ないうちは土台の形へ寄せる(RE表と同じ SHRINK_K)
//   3. 残りの半回を順に畳み込んで、最後に点差が勝っている確率を出す
// 同点で規定回数を終えたら 0.5(引き分け、または延長は五分)とする。
// チームの強さは持っていないので、五分と置くのがいちばん素直。
// ============================================================
import { isTiebreakInning } from './rules.js';
import { stateKey, baseReFor, reOf, SHRINK_K } from './flow.js';

// 1半回の得点はここで打ち切る。これ以上は稀で、勝ち負けの判定にはほぼ効かない
export const MAX_RUNS = 12;
// 点差もここで打ち切る。20点差の先はどちらにしても勝負がついている
export const MAX_DIFF = 20;

// ---- 土台: その状況から「1点でも入る」確率 ----
// RE(平均何点)だけでは分布が決まらない。同じ平均1.0でも「たまに大量点」と
// 「だいたい1点」では勝率がまるで違うので、0点で終わる確率を別に与える。
// これも BASE_RE と同じく一般的な形を与えるためのもので、記録が貯まれば薄まる。
export const SCORE_PROB = {
  '000|0': 0.26, '100|0': 0.42, '010|0': 0.61, '001|0': 0.83,
  '110|0': 0.62, '101|0': 0.85, '011|0': 0.86, '111|0': 0.87,
  '000|1': 0.15, '100|1': 0.27, '010|1': 0.41, '001|1': 0.66,
  '110|1': 0.41, '101|1': 0.64, '011|1': 0.68, '111|1': 0.66,
  '000|2': 0.07, '100|2': 0.13, '010|2': 0.22, '001|2': 0.26,
  '110|2': 0.23, '101|2': 0.27, '011|2': 0.27, '111|2': 0.31,
};

// 平均 m ・ 1点以上入る確率 s から分布を組む。
// 0点で終わるのが 1-s、点が入るなら 1点+幾何分布(平均 m/s - 1)。
// 平均と「0点率」の2つを与えれば形が決まる、いちばん素直な作り方。
export function priorDist(m, s) {
  const out = new Array(MAX_RUNS + 1).fill(0);
  const sc = Math.min(0.99, Math.max(0.01, s));
  out[0] = 1 - sc;
  const excess = Math.max(0, m / sc - 1); // 点が入ったときの「1点を超える分」の平均
  const p = excess / (1 + excess);        // 幾何分布のパラメータ
  let rest = sc;
  for (let k = 1; k <= MAX_RUNS; k++) {
    const q = k === MAX_RUNS ? rest : sc * (1 - p) * Math.pow(p, k - 1);
    out[k] = Math.min(rest, q);
    rest -= out[k];
    if (rest <= 0) break;
  }
  return out;
}

const isPa = (l) => l && (l.kind === 'atbat' || l.kind === 'defense');
const halfKey = (l) => `${Number(l.inning) || 0}${l.isTop ? 'T' : 'B'}`;

// ------------------------------------------------------------
// 記録から「その状況から半回の終わりまでに何点入ったか」の分布を作る
// ------------------------------------------------------------
export function buildRunDists(games = [], edition = null, re = null) {
  const base = baseReFor(edition);
  const counts = new Map(); // key -> number[]
  for (const g of games) {
    if (!g || !Array.isArray(g.playLogs)) continue;
    const halves = new Map();
    for (const l of g.playLogs) {
      if (!isPa(l)) continue;
      // タイブレークの回は走者を置いて始まるので状況の意味が変わる。混ぜない
      if (isTiebreakInning(g, l.inning)) continue;
      const k = halfKey(l);
      if (!halves.has(k)) halves.set(k, []);
      halves.get(k).push(l);
    }
    for (const logs of halves.values()) {
      const total = logs.reduce((s, l) => s + (Number(l.payload?.runs) || 0), 0);
      let done = 0;
      for (const l of logs) {
        const p = l.payload || {};
        if (!p.beforeRunners || p.outsBefore == null || p.outsBefore > 2) { done += Number(p.runs) || 0; continue; }
        const key = stateKey(p.beforeRunners, p.outsBefore);
        if (!counts.has(key)) counts.set(key, new Array(MAX_RUNS + 1).fill(0));
        const left = Math.min(MAX_RUNS, Math.max(0, total - done));
        counts.get(key)[left] += 1;
        done += Number(p.runs) || 0;
      }
    }
  }

  const dists = new Map();
  let total = 0;
  for (const key of Object.keys(base)) {
    const c = counts.get(key) || new Array(MAX_RUNS + 1).fill(0);
    const n = c.reduce((a, b) => a + b, 0);
    total += n;
    // 平均は RE表(すでに寄せてある)に合わせる。分布だけをここで作る
    const mean = re ? reOf(re, key) : base[key];
    const prior = priorDist(mean, SCORE_PROB[key] ?? 0.3);
    const out = new Array(MAX_RUNS + 1);
    for (let k = 0; k <= MAX_RUNS; k++) out[k] = (c[k] + SHRINK_K * prior[k]) / (n + SHRINK_K);
    dists.set(key, out);
  }
  return { dists, samples: total, ownShare: total / (total + SHRINK_K * 24) };
}

export const distOf = (dists, key) =>
  (dists && dists.get(key)) || priorDist(baseReFor(null)[key] ?? 0.3, SCORE_PROB[key] ?? 0.3);

// ------------------------------------------------------------
// 勝率モデル
// ------------------------------------------------------------
const clampDiff = (d) => Math.max(-MAX_DIFF, Math.min(MAX_DIFF, d));

// 残りの半回を並べる(いま進んでいる半回の「次」から、規定回の終わりまで)。
// 延長に入っている試合は「この回で決まる」とみなす(同点で終われば五分)。
export function remainingHalves(isHome, inning, isTop, regulation) {
  const out = [];
  const last = Math.max(Number(regulation) || 7, Number(inning) || 1);
  let i = Number(inning) || 1;
  let top = !!isTop;
  for (let guard = 0; guard < 60; guard++) {
    if (top) top = false; else { top = true; i += 1; }
    if (i > last) break;
    out.push({ inning: i, isTop: top, mine: top !== !!isHome });
  }
  return out;
}

// 末尾(全部終わったあと)の勝ち: 点差>0で勝ち、0は五分、<0で負け
function terminal() {
  const w = new Float64Array(MAX_DIFF * 2 + 1);
  for (let d = -MAX_DIFF; d <= MAX_DIFF; d++) w[d + MAX_DIFF] = d > 0 ? 1 : d < 0 ? 0 : 0.5;
  return w;
}

// 半回を1つ畳み込む。攻めるのが自チームなら点差は増える方向
function foldHalf(next, dist, mine) {
  const cur = new Float64Array(MAX_DIFF * 2 + 1);
  for (let d = -MAX_DIFF; d <= MAX_DIFF; d++) {
    let p = 0;
    for (let k = 0; k < dist.length; k++) {
      if (!dist[k]) continue;
      p += dist[k] * next[clampDiff(d + (mine ? k : -k)) + MAX_DIFF];
    }
    cur[d + MAX_DIFF] = p;
  }
  return cur;
}

// 試合1つぶんの勝率モデルを作る。
// 呼び出しごとに残り半回を畳み直すと重いので、半回ごとの表を1度だけ作って使い回す。
export function buildWinModel({ dists, isHome, regulation }) {
  const fresh = distOf(dists, '000|0');
  const cache = new Map(); // "inningT" -> 「その半回が終わった直後」の勝率表
  const tableAfter = (inning, isTop) => {
    const key = `${inning}${isTop ? 'T' : 'B'}`;
    if (cache.has(key)) return cache.get(key);
    let w = terminal();
    const rest = remainingHalves(isHome, inning, isTop, regulation);
    for (let j = rest.length - 1; j >= 0; j--) w = foldHalf(w, fresh, rest[j].mine);
    cache.set(key, w);
    return w;
  };

  // いまの状況から見た勝率。runners/outs はその半回の途中の状態
  function winExp({ inning, isTop, runners, outs, diff }) {
    const after = tableAfter(inning, isTop);
    const mine = !!isTop !== !!isHome;
    // 半回が終わっている(アウト3つ)なら、この半回はもう畳まない
    const o = Number(outs);
    if (!(o >= 0 && o <= 2)) return after[clampDiff(diff) + MAX_DIFF];
    const dist = distOf(dists, stateKey(runners, o));
    let p = 0;
    for (let k = 0; k < dist.length; k++) {
      if (!dist[k]) continue;
      p += dist[k] * after[clampDiff(diff + (mine ? k : -k)) + MAX_DIFF];
    }
    return p;
  }
  // 半回の切れ目で「試合が終わったか」を判定するのに要るので、前提を持たせておく
  winExp.regulation = Number(regulation) || 7;
  winExp.isHome = !!isHome;
  return winExp;
}

// ============================================================
// チーム力(順位表なしで読める指標)
//
// チーム打率も順位も、他のチームと比べないと良し悪しが分からない。
// ここでは比べる相手を、他チームではなく「その場面そのもの」に変える。
// 無死一塁という場面は、そのレベルの野球だと平均で何点入るかが決まっている。
// これは他チームとの比較ではなく野球というゲームの性質なので、
// リーグも順位表も要らず、1試合でも20試合でもまったく同じ意味で読める。
//
// ---- 1.00 が「場面どおり」----
// 決定力 = 走者を置いた場面で、その場面の値ぶんを実際に出せたかの比。
//   分母: その打席を迎えた時点の期待値の合計
//   分子: 実際に入った点 + 打席後の期待値の合計
// 場面どおりに打てば分子と分母が釣り合って 1.00 になる。
// 0.85 なら「あと1本が出ていない」、1.10 なら「場面以上に返している」。
//
// 火消し力はその裏返し(与えたピンチをどれだけ止めたか)。
// 単純に分子と分母をひっくり返すと、完全に抑えた回(分子が0)で割り算が壊れる。
// 完全に抑えるのは最良の結果なのに値が出ないのでは逆なので、
// 1.00 を挟んで折り返す形にする: 火消し力 = 2 − (相手の決定力)
//   相手が場面どおり  → 1.00
//   相手を完全に抑えた → 2.00
//   相手に場面以上に返された → 1.00未満
//
// ---- 攻撃と守備は鏡にする ----
//   先頭出塁率   ↔ 先頭封じ率     流れを作り始める / 渡さない
//   決定力       ↔ 火消し力       好機を点にする / ピンチを0で終える
//   畳みかけ率   ↔ 立ち直り率     得点の次も得点 / 失点の次は無失点
//   二死からの得点率 ↔ 二死からの失点率  粘って取る / 粘られて取られる
// 名前は実況が普段から使っている言葉にしてある。新しい言葉を作らず、
// すでにある言葉に初めて数字を与えるほうが広まると考えたため。
//
// ---- 少ない回数の数字は出さない ----
// 5回しかない場面の「57%」には意味がない。必ず回数を併記し、
// 少ないうちは順位を出さない。判断は minSamples で呼び出し側が決める。
// ============================================================
import { RESULTS } from './model.js';
import { stateKey, reOf } from './flow.js';
import { isTiebreakInning } from './rules.js';

const isPa = (l) => l && (l.kind === 'atbat' || l.kind === 'defense');
const halfKey = (l) => `${Number(l.inning) || 0}${l.isTop ? 'T' : 'B'}`;
const hasRunner = (r) => !!(r && (r[1] || r[2] || r[3]));
const reached = (result) => !!RESULTS[result]?.onBase;

// 試合を半回ごとに分ける。攻撃(atbat)と守備(defense)は別々に集める。
// タイブレークの回は走者を置いて始めるので、場面の意味が変わる。混ぜない。
function halvesOf(game) {
  const out = new Map(); // key -> { mine, inning, isTop, logs: [] }
  for (const l of game.playLogs || []) {
    if (!isPa(l)) continue;
    if (isTiebreakInning(game, l.inning)) continue;
    const k = `${l.kind === 'atbat' ? 'O' : 'D'}${halfKey(l)}`;
    if (!out.has(k)) out.set(k, { mine: l.kind === 'atbat', inning: Number(l.inning) || 0, isTop: !!l.isTop, logs: [] });
    out.get(k).logs.push(l);
  }
  return [...out.values()].sort((a, b) => (a.inning - b.inning) || (a.isTop === b.isTop ? 0 : (a.isTop ? -1 : 1)));
}

const runsIn = (h) => h.logs.reduce((s, l) => s + (Number(l.payload?.runs) || 0), 0);

// 決定力 / 火消し力の材料。走者を置いた(=好機/ピンチの)打席だけを見る。
function conversion(halves, re, mine) {
  let before = 0;
  let after = 0;
  let n = 0;
  for (const h of halves) {
    if (h.mine !== mine) continue;
    for (let i = 0; i < h.logs.length; i++) {
      const p = h.logs[i].payload || {};
      if (!p.beforeRunners || p.outsBefore == null || p.outsBefore > 2) continue;
      if (!hasRunner(p.beforeRunners)) continue; // 走者が居ない場面は好機ではない
      const nx = h.logs[i + 1]?.payload;
      const afterRe = (nx?.beforeRunners && nx.outsBefore != null && nx.outsBefore <= 2)
        ? reOf(re, stateKey(nx.beforeRunners, nx.outsBefore))
        : 0; // 回が終わった
      before += reOf(re, stateKey(p.beforeRunners, p.outsBefore));
      after += (Number(p.runs) || 0) + afterRe;
      n += 1;
    }
  }
  return { before, after, n };
}

// 先頭打者。その半回の最初の打席
function leadoff(halves, mine) {
  let on = 0;
  let n = 0;
  for (const h of halves) {
    if (h.mine !== mine || !h.logs.length) continue;
    n += 1;
    if (reached(h.logs[0].payload?.result)) on += 1;
  }
  return { on, n };
}

// 畳みかけ / 立ち直り。「前の自分の半回」との連なりで見る
function streak(halves, mine, want) {
  const mineHalves = halves.filter((h) => h.mine === mine);
  let hit = 0;
  let n = 0;
  for (let i = 1; i < mineHalves.length; i++) {
    const prevScored = runsIn(mineHalves[i - 1]) > 0;
    if (!prevScored) continue; // 直前に点が動いた回のあとだけを見る
    n += 1;
    const nowScored = runsIn(mineHalves[i]) > 0;
    if (nowScored === want) hit += 1;
  }
  return { hit, n };
}

// 二死から。2アウトになってから点が入った半回の割合
function twoOut(halves, mine) {
  let hit = 0;
  let n = 0;
  for (const h of halves) {
    if (h.mine !== mine) continue;
    const idx = h.logs.findIndex((l) => Number(l.payload?.outsBefore) === 2);
    if (idx < 0) continue; // 二死まで行かずに終わった回は母数に入れない
    n += 1;
    const after = h.logs.slice(idx).reduce((s, l) => s + (Number(l.payload?.runs) || 0), 0);
    if (after > 0) hit += 1;
  }
  return { hit, n };
}

const rate = (a, b) => (b > 0 ? a / b : null);

// ------------------------------------------------------------
// チーム力をまとめて出す
// games: 対象試合の配列 / re: 得点期待値(buildRunExpectancy の re)
// 戻り値: [{ key, pair, side, value, n, better, ... }]
//   value … 決定力/火消し力は 1.00 が基準、他は割合(0〜1)
//   n     … 回数。少ないうちは表示側で扱いを変えられるよう必ず返す
// ------------------------------------------------------------
export function teamPower(games = [], re = null) {
  const halves = [];
  for (const g of games) {
    if (!g || !Array.isArray(g.playLogs)) continue;
    halves.push(...halvesOf(g));
  }

  const offConv = conversion(halves, re, true);
  const defConv = conversion(halves, re, false);
  const offLead = leadoff(halves, true);
  const defLead = leadoff(halves, false);
  const pileOn = streak(halves, true, true);    // 得点した次の回も得点
  const bounce = streak(halves, false, false);  // 失点した次の回は無失点
  const offTwo = twoOut(halves, true);
  const defTwo = twoOut(halves, false);

  return [
    {
      pair: 'lead', key: 'off.leadoff', side: 'off',
      value: rate(offLead.on, offLead.n), n: offLead.n, hit: offLead.on, kind: 'pct',
    },
    {
      pair: 'lead', key: 'def.leadoff', side: 'def',
      // 先頭を抑えた割合なので、出塁されなかった側を数える
      value: rate(defLead.n - defLead.on, defLead.n), n: defLead.n, hit: defLead.n - defLead.on, kind: 'pct',
    },
    {
      pair: 'conv', key: 'off.conversion', side: 'off',
      value: rate(offConv.after, offConv.before), n: offConv.n, kind: 'index',
    },
    {
      pair: 'conv', key: 'def.conversion', side: 'def',
      // 相手の決定力を1.00で折り返す。完全に抑えた回でも壊れない
      value: defConv.before > 0 ? Math.max(0, 2 - (defConv.after / defConv.before)) : null,
      n: defConv.n, kind: 'index',
    },
    {
      pair: 'streak', key: 'off.pileOn', side: 'off',
      value: rate(pileOn.hit, pileOn.n), n: pileOn.n, hit: pileOn.hit, kind: 'pct',
    },
    {
      pair: 'streak', key: 'def.bounceBack', side: 'def',
      value: rate(bounce.hit, bounce.n), n: bounce.n, hit: bounce.hit, kind: 'pct',
    },
    {
      pair: 'twoout', key: 'off.twoOut', side: 'off',
      value: rate(offTwo.hit, offTwo.n), n: offTwo.n, hit: offTwo.hit, kind: 'pct',
    },
    {
      pair: 'twoout', key: 'def.twoOut', side: 'def',
      // 二死から取られなかった割合(高いほど良い)に揃える
      value: rate(defTwo.n - defTwo.hit, defTwo.n), n: defTwo.n, hit: defTwo.n - defTwo.hit, kind: 'pct',
    },
  ];
}

// 指標を20個並べたら誰も見ない。「いま一番ずれているもの」から出すための並び替え。
// 基準(決定力等は1.00、割合は攻守の平均)からの離れ具合が大きい順。
// 回数が少ないものは、たまたま大きく外れているだけなので後ろへ回す。
export function mostOff(rows = [], { minSamples = 10, top = 3 } = {}) {
  const enough = rows.filter((r) => r.value != null && r.n >= minSamples);
  const baseOf = (r) => {
    if (r.kind === 'index') return 1;
    const mate = enough.find((x) => x.pair === r.pair && x.side !== r.side);
    return mate && mate.value != null ? (r.value + mate.value) / 2 : 0.5;
  };
  return enough
    .map((r) => ({ ...r, gap: r.value - baseOf(r) }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, top);
}

// 1.00基準の指標は小数2桁、割合は打率と同じ書き方
export function formatPower(row) {
  if (row?.value == null) return '—';
  if (row.kind === 'index') return row.value.toFixed(2);
  if (row.value >= 1) return '1.000';
  return `.${String(Math.round(row.value * 1000)).padStart(3, '0')}`;
}

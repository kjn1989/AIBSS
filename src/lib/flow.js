// ============================================================
// 試合の流れ(得点期待値ベース)
//
// 「野球は流れのスポーツ」と誰もが言うのに、スコアブックにも成績表にも
// 流れに対応する数字が一つも無い。ここでは、すでに記録している内容だけから
// 流れを数字にする。入力は増やさない。
//
// ---- 何を計算しているか ----
// 打席の前後で「この回にあと何点入りそうか」がどれだけ動いたかを見る。
//   その打席の動き = (打席後の期待値 + その打席で入った点) − 打席前の期待値
// 自チームの攻撃ならプラスが自チームに傾いた分、守備なら符号を反転する。
// これを足し上げたものが「流れ」の線になる。
//
// ---- 得点期待値(RE)はどこから来るか ----
// 大事なところなので明記する。MLBの公開表をそのまま使うと、草野球・高校野球の
// 得点環境(四球とエラーが多く、得点がずっと入りやすい)と合わず、全部の評価がずれる。
// だから「自分たちの試合から作る」のを基本にする。
//   ・自チームの記録(相手の打席も含む)から24状態それぞれの平均得点を数える
//   ・まだ回数が少ない状態は、基準表の側へ寄せる(下の shrink)
//   ・回数は必ず持ち回り、少ないうちは画面にも出す
// 基準表は「その状態から回の終わりまでに平均何点入るか」の一般的な形(下記)。
// 試合が貯まるほど基準表の影響は薄まり、自分たちの数字になる。
// ============================================================
import { isTiebreakInning } from './rules.js';

// 24状態のキー: 走者(一二三の順に0/1) + アウト
export const stateKey = (runners, outs) => {
  const r = runners || {};
  return `${r[1] ? 1 : 0}${r[2] ? 1 : 0}${r[3] ? 1 : 0}|${Math.max(0, Math.min(2, Number(outs) || 0))}`;
};

// ---- 土台の表: NPB 2023〜2025年の実測値 ----
// 自分たちの記録が貯まるまでの土台。そのまま出す値ではないが、
// 手で書いた「それらしい値」ではなく、出典のある実測値を使う。
//
//   出典: baseball.piupapp.com「得点期待値 / 得点確率」過去3年(2023-2025)
//   対象: 日本プロ野球(NPB)。投手も含めた全打席から算出、と同ページに明記
//   加工: していない。掲載値をそのまま書き写している
//
// MLBの公開表ではなくNPBを土台にする理由は2つ。
//  1. このアプリを使うのは日本でプレーしている人なので、値を見たときに
//     「プロだとこれくらい」の感覚と地続きになる
//  2. 得点環境がMLBより低く、日本の野球の形(バントの多さ等)を含んでいる
// ただしアマチュア(高校・中学・草野球)はNPBより点が入るので、これも
// あくまで土台。実測が貯まれば下の shrink で自分たちの側へ寄っていく。
export const NPB_SOURCE = {
  where: 'baseball.piupapp.com「得点期待値 / 得点確率」',
  url: 'https://baseball.piupapp.com/run-expectancy',
  data: 'NPB 過去3年(2023-2025)・投手を含む全打席',
};

export const BASE_RE = {
  '000|0': 0.38, '100|0': 0.70, '010|0': 0.99, '001|0': 1.25,
  '110|0': 1.26, '101|0': 1.60, '011|0': 1.76, '111|0': 2.05,
  '000|1': 0.20, '100|1': 0.42, '010|1': 0.59, '001|1': 0.92,
  '110|1': 0.79, '101|1': 1.06, '011|1': 1.23, '111|1': 1.41,
  '000|2': 0.07, '100|2': 0.19, '010|2': 0.27, '001|2': 0.33,
  '110|2': 0.40, '101|2': 0.42, '011|2': 0.48, '111|2': 0.66,
};

// ---- 甲子園で実測されている4状況 ----
// 明治大学 総合数理学部 2018年度卒業研究
// 「夏の高校野球甲子園大会における得点期待値と走者生還率の分析」
// 2015〜2017年 夏の甲子園 全144試合。
//
// 論文が出しているのは戦術別(ヒッティング/盗塁/バント)の値なので、
// 同論文の実行回数で重みを付けて、戦術によらない得点期待値に直してある:
//   無死一塁   (351×0.90 + 56×0.71 + 363×0.69) / 770 = 0.79
//   無死一二塁 ( 62×1.24 +  1×1.00 +  67×1.09) / 130 = 1.16
//   一死一塁   (481×0.54 + 74×0.66 +  74×0.49) / 629 = 0.55
//   一死一二塁 (241×0.92 +  2×1.00 +  10×0.30) / 253 = 0.90
//
// 土台のNPB値と比べると、3つは高く1つだけ低い:
//   無死一塁   0.79 / NPB 0.70 … +13%
//   一死一塁   0.55 / NPB 0.42 … +31%
//   一死一二塁 0.90 / NPB 0.79 … +14%
//   無死一二塁 1.16 / NPB 1.26 …  -8%   ← ここだけ低い
// 高いのは、アマチュアはプロより点が入るから(四球とエラーが多い)。
// 無死一二塁だけ低いのは、その場面でバントが半分(52%)使われていて、
// 自分から1アウトを差し出しているため。どちらも高校野球の実際の姿なので、
// この4状況はブカツ(中高大)の土台として採用する。
//
// 残り20状況は論文に無い。草野球・少年野球はバントがここまで多くなく、
// 得点も甲子園より入りやすいので、この4つを他のエディションへは持ち込まない。
export const KOSHIEN_RE = {
  '100|0': 0.79, '110|0': 1.16, '100|1': 0.55, '110|1': 0.90,
};

// ---- 残り20状況の水準補正 ----
// 24状況そろった高校野球の得点期待値表は公開されていない(探した範囲では
// 見つからない)。実測があるのは上の4状況だけ。
// そこで、4状況を実測に差し替えて残り20状況をNPBのまま置くのはやめる。
// それをやると1つの表の中に水準が2つ同居して、「一塁に進んだ」の値だけが
// 出どころの違いで飛ぶ。表としては壊れている。
//
// 代わりに、重なっている4状況でNPBとの水準差を測り、その比を残り20状況にかける。
// 重みは論文の実行回数(その場面が実際に甲子園で何回あったか)。
//   甲子園 = 0.79×770 + 1.16×130 + 0.55×629 + 0.90×253 = 1332.75
//   NPB    = 0.70×770 + 1.26×130 + 0.42×629 + 0.79×253 = 1166.85
//   比     = 1332.75 / 1166.85 = 1.142
// 状況ごとの比(1.13 / 0.92 / 1.31 / 1.14)を単純平均しないのは、1回しか
// 起きない場面と600回起きる場面が同じ重さになってしまうため。
//
// この1.14は実測ではなく、実測4点から引いた「高校野球はNPBより14%点が入る」
// という一次近似。だから画面では実測の4状況と補正した20状況を分けて出す。
export const KOSHIEN_WEIGHTS = { '100|0': 770, '110|0': 130, '100|1': 629, '110|1': 253 };

export const KOSHIEN_LEVEL = (() => {
  let ko = 0;
  let npb = 0;
  for (const [key, w] of Object.entries(KOSHIEN_WEIGHTS)) {
    ko += KOSHIEN_RE[key] * w;
    npb += BASE_RE[key] * w;
  }
  return ko / npb;
})();

// 実測がある4状況はそのまま。残り20状況はNPB値に比をかける。
const KOSHIEN_BASE = (() => {
  const out = {};
  for (const [key, v] of Object.entries(BASE_RE)) {
    out[key] = KOSHIEN_RE[key] ?? Math.round(v * KOSHIEN_LEVEL * 100) / 100;
  }
  return out;
})();

export const KOSHIEN_SOURCE = {
  title: '夏の高校野球甲子園大会における得点期待値と走者生還率の分析',
  where: '明治大学 総合数理学部 2018年度卒業研究',
  data: '2015〜2017年 夏の甲子園 全144試合',
  states: Object.keys(KOSHIEN_RE).length,
  level: KOSHIEN_LEVEL,
};

// エディション別の土台。実測が無いところは一般的な形のまま。
export function baseReFor(edition) {
  if (edition === 'ブカツ(中高大)') return KOSHIEN_BASE;
  return BASE_RE;
}

// この状況は甲子園の実測そのものか(画面で実測と補正を分けて出すため)
export const isKoshienMeasured = (key) => Object.prototype.hasOwnProperty.call(KOSHIEN_RE, key);

// 回数が少ない状態を基準表側へ寄せる強さ。
// K回ぶんの「基準表どおりの結果」を最初から持っていた、とみなす。
export const SHRINK_K = 30;

// ---- 土台の水準を、自分たちの得点環境に合わせる ----
//
// 少年野球には得点期待値の実測表が無い。1試合平均得点すら公開されていない
// (探した範囲では見つからない)。だから「少年野球はNPBの◯倍」という倍率は
// 作れない。作れば根拠のない数字になる。
//
// 代わりに、倍率は自分たちの記録から出す。24状況それぞれの平均を埋めるには
// 何試合も要るが、「半回あたり平均何点入るか」なら1試合でもそれなりに測れる。
// 打席1つずつではなく半回ごとに数えるので、同じ試合数でも桁違いに標本が多い。
//
//   土台の水準 = 基準表の「走者なし0アウト」= その半回に入る平均得点
//   自分たちの水準 = 記録した半回の総得点 ÷ 半回数
//   倍率 = 自分たちの水準 ÷ 土台の水準
//
// この倍率を24状況すべてにかけてから寄せる。少年野球でも草野球でも、
// 記録が入った時点で土台の高さがその環境に合う。記録が無ければ倍率は1で、
// これまでどおり基準表そのまま。
//
// 倍率そのものも寄せる。1試合しか無いのに大量点の試合だと倍率が跳ねるので、
// LEVEL_K 半回ぶんの「基準表どおり」を持っていたことにして薄める。
export const LEVEL_K = 40;
// 壊れた記録で土台が飛ばないようにする外枠。実際の得点環境を否定するための
// ものではないので、広めに取る。
// 学童は半回1点(6回制で1チーム6点)でも土台のNPB比は2.6倍になる。ここを2.5で
// 止めていたら、ごく普通の学童の試合ですら頭打ちになっていた。
export const LEVEL_MIN = 0.4;
export const LEVEL_MAX = 5.0;

const isPa = (l) => l && (l.kind === 'atbat' || l.kind === 'defense');
const halfKey = (l) => `${Number(l.inning) || 0}${l.isTop ? 'T' : 'B'}`;

// ------------------------------------------------------------
// 得点期待値表を、渡された試合群から作る
// 戻り値: { re(key)->点, samples(key)->回数, total, ownShare }
// ------------------------------------------------------------
export function buildRunExpectancy(games = [], edition = null) {
  const rawBase = baseReFor(edition);
  const acc = new Map(); // key -> { n, runs }
  // 得点環境の測り方: 記録した半回の数と、そこで入った点の合計
  let halfCount = 0;
  let halfRuns = 0;
  for (const g of games) {
    if (!g || !Array.isArray(g.playLogs)) continue;
    // 半回ごとに、その回に入った点を後ろから積む
    const halves = new Map();
    for (const l of g.playLogs) {
      if (!isPa(l)) continue;
      // タイブレークの回は走者を置いて始めるので、状態の意味が変わる。混ぜない。
      if (isTiebreakInning(g, l.inning)) continue;
      const k = halfKey(l);
      if (!halves.has(k)) halves.set(k, []);
      halves.get(k).push(l);
    }
    for (const logs of halves.values()) {
      const total = logs.reduce((s, l) => s + (Number(l.payload?.runs) || 0), 0);
      // 途中で終わった半回(試合終了・サヨナラ)も含める。点が入りやすい環境ほど
      // 早く終わる回が増えるので、外すと得点環境を低く見積もることになる
      halfCount += 1;
      halfRuns += total;
      let done = 0;
      for (const l of logs) {
        const p = l.payload || {};
        if (!p.beforeRunners || p.outsBefore == null || p.outsBefore > 2) { done += Number(p.runs) || 0; continue; }
        const key = stateKey(p.beforeRunners, p.outsBefore);
        if (!acc.has(key)) acc.set(key, { n: 0, runs: 0 });
        const a = acc.get(key);
        a.n += 1;
        a.runs += total - done; // この状態から回の終わりまでに入った点
        done += Number(p.runs) || 0;
      }
    }
  }

  // ---- 土台の高さを、自分たちの得点環境へ合わせてから寄せる ----
  const baseRate = rawBase['000|0'] || 0;
  // 倍率も寄せる(半回が少ないうちは1に近い)
  const ownRate = baseRate > 0
    ? (halfRuns + LEVEL_K * baseRate) / (halfCount + LEVEL_K)
    : baseRate;
  const level = baseRate > 0
    ? Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, ownRate / baseRate))
    : 1;
  const base = {};
  for (const [k, v] of Object.entries(rawBase)) base[k] = v * level;

  const samples = new Map();
  const re = new Map();
  let total = 0;
  for (const key of Object.keys(base)) {
    const a = acc.get(key) || { n: 0, runs: 0 };
    samples.set(key, a.n);
    total += a.n;
    // 回数が少ないほど基準表寄り、貯まるほど自分たちの数字へ
    re.set(key, (a.runs + SHRINK_K * base[key]) / (a.n + SHRINK_K));
  }
  // 自分たちの記録がどれだけ効いているか(0=基準表のまま, 1=完全に自前)
  const ownShare = total / (total + SHRINK_K * 24);
  return {
    re, samples, total, ownShare, base, rawBase,
    // 土台の高さをどれだけ動かしたか(画面で出す)
    level, halfCount, halfRuns,
    levelShare: halfCount / (halfCount + LEVEL_K),
  };
}

// 期待値を引く。表に無ければ基準表、それも無ければ0。
export const reOf = (re, key) => (re && re.get(key) != null ? re.get(key) : (BASE_RE[key] ?? 0));

// ------------------------------------------------------------
// 1試合の流れ
//
// 各打席の「動き」= (打席後の期待値 + 入った点) − 打席前の期待値
// 打席後の状態は、同じ半回の次の打席の「打席前」。回が終わっていれば期待値0。
// 自チームの攻撃はそのまま、守備は符号を反転して「自チームから見た傾き」に揃える。
// 戻り値: [{ log, id, inning, isTop, mine, delta, cum, before, after, runs }]
// ------------------------------------------------------------
export function flowSeries(game, re) {
  if (!game || !Array.isArray(game.playLogs)) return [];
  const pas = game.playLogs.filter(isPa);
  // 半回ごとに並べて、次の打席を引けるようにする
  const idxInHalf = new Map();
  const halves = new Map();
  for (const l of pas) {
    const k = halfKey(l);
    if (!halves.has(k)) halves.set(k, []);
    idxInHalf.set(l.id, halves.get(k).length);
    halves.get(k).push(l);
  }

  const out = [];
  let cum = 0;
  for (const l of pas) {
    const p = l.payload || {};
    const runs = Number(p.runs) || 0;
    const mine = l.kind === 'atbat';
    let delta = 0;
    let beforeRe = null;
    let afterRe = null;
    if (p.beforeRunners && p.outsBefore != null && p.outsBefore <= 2) {
      beforeRe = reOf(re, stateKey(p.beforeRunners, p.outsBefore));
      const list = halves.get(halfKey(l)) || [];
      const nxt = list[idxInHalf.get(l.id) + 1];
      const np = nxt?.payload;
      // 次の打席があり、その状態が取れれば「打席後」。無ければ回が終わった=0
      afterRe = (np?.beforeRunners && np.outsBefore != null && np.outsBefore <= 2)
        ? reOf(re, stateKey(np.beforeRunners, np.outsBefore))
        : 0;
      delta = (afterRe + runs) - beforeRe;
    }
    // 守備側の動きは、自チームから見ると逆向き
    const signed = mine ? delta : -delta;
    cum += signed;
    out.push({
      log: l, id: l.id, inning: Number(l.inning) || 0, isTop: !!l.isTop,
      mine, runs, delta: signed, cum, beforeRe, afterRe,
    });
  }
  return out;
}

// ------------------------------------------------------------
// 1試合の流れ(勝利期待値)
//
// 画面に出す線はこちら。縦軸は「自チームが勝つ確率」で、50%が互角。
// 打席の前後の差(WPA)が「その打席で勝率をどれだけ動かしたか」になる。
// 守備側でも自チーム視点の確率なので、符号を反転する必要がない。
//
// 戻り値: [{ log, id, inning, isTop, mine, runs, we, delta }]
//   we    … その打席を終えた時点の勝率
//   delta … その打席で動いた勝率(WPA)
// ------------------------------------------------------------
// その半回を終えた時点で試合が終わっているか。
// 延長に入るのは同点のときだけ。規定回の表を終えて後攻がリードしていれば裏は行われない。
// (winExp モデルが規定回と先攻/後攻を持っているので、そこから判断する)
// 24状況キー('110|0'等)を走者とアウトに戻す。
// 半回の頭がどこから始まるかは回によって変わる(タイブレークは走者を置く)。
export function stateOfKey(key) {
  const s = String(key || '000|0');
  const [r = '000', o = '0'] = s.split('|');
  return {
    runners: { 1: r[0] === '1', 2: r[1] === '1', 3: r[2] === '1' },
    outs: Math.max(0, Math.min(2, Number(o) || 0)),
  };
}

// その回の半回の開始状態。モデルが持っていなければ走者なし0アウト
const halfStartOf = (model, inning) => stateOfKey(model?.halfStartKey?.(inning) || '000|0');

export function gameDecided(model, inning, isTop, diff) {
  const reg = Number(model?.regulation) || 7;
  if ((Number(inning) || 0) < reg) return false;
  if (!isTop) return diff !== 0;
  return model?.isHome ? diff > 0 : diff < 0;
}

export function weSeries(game, winExp) {
  if (!game || !Array.isArray(game.playLogs) || typeof winExp !== 'function') return [];
  const pas = game.playLogs.filter(isPa);
  if (!pas.length) return [];

  const idxInHalf = new Map();
  const halves = new Map();
  for (const l of pas) {
    const k = halfKey(l);
    if (!halves.has(k)) halves.set(k, []);
    idxInHalf.set(l.id, halves.get(k).length);
    halves.get(k).push(l);
  }

  const out = [];
  let diff = 0; // 自チーム − 相手
  // 試合開始時(1回表・走者なし0アウト・0-0)の勝率。ここが線の出発点になる
  const first = pas[0];
  const firstInn = Number(first.inning) || 1;
  const firstSt = halfStartOf(winExp, firstInn);
  let prev = winExp({
    inning: firstInn, isTop: !!first.isTop,
    runners: firstSt.runners, outs: firstSt.outs, diff: 0,
  });
  const start = prev;

  for (const l of pas) {
    const p = l.payload || {};
    const runs = Number(p.runs) || 0;
    const mine = l.kind === 'atbat';
    diff += mine ? runs : -runs;

    // 打席後の状況 = 同じ半回の次の打席の「打席前」。無ければその半回は終わり
    const list = halves.get(halfKey(l)) || [];
    const nxt = list[idxInHalf.get(l.id) + 1];
    const np = nxt?.payload;
    let we;
    if (np?.beforeRunners && np.outsBefore != null && np.outsBefore <= 2) {
      we = winExp({
        inning: Number(l.inning) || 1, isTop: !!l.isTop,
        runners: np.beforeRunners, outs: np.outsBefore, diff,
      });
    } else if (gameDecided(winExp, Number(l.inning) || 1, !!l.isTop, diff)) {
      // 半回が終わって試合も終わった。延長に入るのは同点のときだけ
      we = diff > 0 ? 1 : 0;
    } else {
      // 半回が終わった。次の半回の頭から見る。
      // タイブレークの回は走者を置いて始まるので、走者なしで見てはいけない。
      // (先の半回を畳むときはタイブレークを見ているので、ここだけ走者なしにすると
      //  「自分の回は走者なし・相手の回は走者あり」という非対称な見立てになり、
      //  無失点で抑えた投手にマイナスが付く)
      const nextTop = !l.isTop;
      const nextInn = (Number(l.inning) || 1) + (l.isTop ? 0 : 1);
      const st = halfStartOf(winExp, nextInn);
      we = winExp({ inning: nextInn, isTop: nextTop, runners: st.runners, outs: st.outs, diff });
    }
    out.push({
      log: l, id: l.id, inning: Number(l.inning) || 0, isTop: !!l.isTop,
      mine, runs, we, delta: we - prev, diff,
    });
    prev = we;
  }
  out.start = start;
  return out;
}

// 続いた区間としての「流れ」。人が「流れが変わった」と言うのは1本のヒットではなく、
// 同じ方向に続いた数打席のこと。だから同じ向きが続いた区間をまとめて取り出す。
export function flowRuns(series = [], minSwing = 0.6) {
  const out = [];
  let cur = null;
  for (const s of series) {
    if (!s.delta) continue;
    const dir = s.delta > 0 ? 1 : -1;
    if (cur && cur.dir === dir) {
      cur.swing += s.delta; cur.to = s; cur.n += 1;
      cur.items.push(s);
      // その区間でいちばん動かした1打席。「5打席で25%→44%」だけだと
      // 何が起きたのか分からないので、山になった打席を1つ持っておく
      if (Math.abs(s.delta) > Math.abs(cur.peak.delta)) cur.peak = s;
    } else {
      if (cur && Math.abs(cur.swing) >= minSwing) out.push(cur);
      cur = { dir, swing: s.delta, from: s, to: s, n: 1, peak: s, items: [s] };
    }
  }
  if (cur && Math.abs(cur.swing) >= minSwing) out.push(cur);
  return out.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
}

// ------------------------------------------------------------
// 流れタグの答え合わせ
//
// 測るのは一致ではなく順番。走者一掃の直後に押せばほぼ当たるが、それは
// 起きたことをなぞっただけで価値がない。「動く前に押せたか」だけを予兆にする。
//   予兆 … 押した後、windowAfter打席以内に、その向きへ minSwing 以上動いた
//   反応 … 押す直前 windowBefore打席以内に、もうその向きへ動いていた
//   空振り… どちらでもない
// 成績は必ず2つセットで出す。読みの精度だけだと「確信があるときしか押さない」で
// 高くできてしまうので、押さなければ下がる読みの広さと並べる。
// ------------------------------------------------------------
export function judgeFlowTags(game, series = [], opts = {}) {
  const windowAfter = opts.windowAfter ?? 5;
  const windowBefore = opts.windowBefore ?? 3;
  // 既定は得点期待値(点)の単位。土台がNPBの実測値(無死走者なし 0.38点)なので、
  // 単打1本ぶんの動きは0.22前後になる。「もう動いていた」をそれより下に置かないと、
  // ヒットの直後に押したのを(読みではなく)反応として拾えない。
  // 画面の流れタグは勝率(0〜1)の単位で判定するので、そちらは呼び出し側が渡す。
  const minSwing = opts.minSwing ?? 0.40;
  const reactSwing = opts.reactSwing ?? 0.20;

  const tags = (game?.playLogs || []).filter((l) => l.kind === 'flow');
  // 打席の並びの中で、そのタグがどこに入るかを求める(ログ全体の並び順で見る)
  const order = new Map();
  (game?.playLogs || []).forEach((l, i) => order.set(l.id, i));
  const paPos = series.map((s) => ({ s, at: order.get(s.id) ?? 0 }));

  const swings = flowRuns(series, minSwing);
  const verdict = {};
  const caught = new Set();

  for (const tag of tags) {
    const at = order.get(tag.id) ?? 0;
    const want = tag.payload?.dir === 'down' ? -1 : 1;
    const before = paPos.filter((x) => x.at < at).slice(-windowBefore);
    const after = paPos.filter((x) => x.at > at).slice(0, windowAfter);
    // 窓の端まで足してはいけない。その向きへ動いたあと戻した場合、
    // 合計だと打ち消し合って「何も起きなかった」ことになってしまう。
    // 途中でいちばん動いたところを見る。
    const best = (arr) => {
      let acc = 0;
      let top = 0;
      for (const x of arr) { acc += want * x.s.delta; if (acc > top) top = acc; }
      return top;
    };

    // 押す直前にも動き、押したあとにも動く、ということは普通に起きる。
    // 回の終わりに押せば「攻撃が終わった」動きが直前にあり、そのあと相手の攻撃で
    // 大きく動く。ここで直前だけを見て「反応」に決めてしまうと、
    // これから起きることを言い当てていても評価されない。
    // どちらが大きいかで決める。あとの動きのほうが大きければ、それは読めていたということ。
    const beforeBest = best([...before].reverse());
    const afterBest = best(after);
    if (afterBest >= minSwing && afterBest >= beforeBest) { /* 予兆 */ }
    else if (beforeBest >= reactSwing) { verdict[tag.id] = 'post'; continue; }
    if (afterBest >= minSwing) {
      verdict[tag.id] = 'pre';
      // どの区間を先に読めたか(読みの広さの分子)
      for (const sw of swings) {
        if (sw.dir !== want) continue;
        const from = order.get(sw.from.id) ?? 0;
        const to = order.get(sw.to.id) ?? 0;
        if (at <= to && at >= from - windowAfter) { caught.add(sw.from.id); break; }
      }
      continue;
    }
    verdict[tag.id] = 'miss';
  }

  const c = { pre: 0, post: 0, miss: 0 };
  for (const tg of tags) c[verdict[tg.id]] = (c[verdict[tg.id]] || 0) + 1;
  return {
    tags, verdict, counts: c, swings,
    hitRate: tags.length ? c.pre / tags.length : null,   // 読みの精度
    catchRate: swings.length ? caught.size / swings.length : null, // 読みの広さ
    caught: caught.size,
  };
}

// ------------------------------------------------------------
// 線の形をひとことで言う
//
// 出すのは2つだけ。
//  ・いちばん苦しかった打席と、いちばん良かった打席(勝率そのもの)
//    勝率は0〜100%で基準が動かないので、そのまま読める。
//  ・リードして進んだ打席・同点だった打席・リードされていた打席の割合
//    こちらは点差だけで決まるので、どちらが先攻でも偏らない。
//
// 「勝率が50%を下回っていた打席の割合」は出さない。後攻が最後に打つぶん
// 同点の試合では先攻がずっと50%を下回るので(これは計算の作為ではなく
// 本物の優位だが)、見出しの数字にすると互角の試合が劣勢に読めてしまう。
// ------------------------------------------------------------
export function weShape(series = []) {
  if (!series.length) return null;
  let lowest = series[0];
  let highest = series[0];
  let ahead = 0;
  let tied = 0;
  let behind = 0;
  for (const s of series) {
    if (s.we < lowest.we) lowest = s;
    if (s.we > highest.we) highest = s;
    if (s.diff > 0) ahead += 1;
    else if (s.diff < 0) behind += 1;
    else tied += 1;
  }
  const n = series.length;
  const pct = (x) => Math.round((x / n) * 100);
  return {
    lowest, highest, n,
    // 母数は両チームの全打席。経過時間は記録していないので「時間」では言えない。
    // 割合だけを勝率の近くに置くと勝率と読み違えられるので、実数も一緒に返す
    ahead, tied, behind,
    aheadPct: pct(ahead), tiedPct: pct(tied), behindPct: pct(behind),
  };
}

// 打率と同じ書き方。10割だけ 1.000 と書く(.1000 にならないように)
export function formatRate(v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= 1) return '1.000';
  return `.${String(Math.round(v * 1000)).padStart(3, '0')}`;
}

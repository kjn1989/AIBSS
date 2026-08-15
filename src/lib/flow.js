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

// 基準表。自分たちの記録が貯まるまでの土台にするだけで、そのまま出す値ではない。
// 形(走者が進むほど・アウトが増えないほど期待値が高い)を与えるためのもので、
// 水準は shrink を通して自分たちの記録側へ寄っていく。
export const BASE_RE = {
  '000|0': 0.48, '100|0': 0.86, '010|0': 1.10, '001|0': 1.35,
  '110|0': 1.44, '101|0': 1.78, '011|0': 1.96, '111|0': 2.29,
  '000|1': 0.25, '100|1': 0.51, '010|1': 0.66, '001|1': 0.95,
  '110|1': 0.88, '101|1': 1.13, '011|1': 1.38, '111|1': 1.54,
  '000|2': 0.10, '100|2': 0.22, '010|2': 0.32, '001|2': 0.35,
  '110|2': 0.43, '101|2': 0.48, '011|2': 0.58, '111|2': 0.75,
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
// 一般的な値と比べると、1アウトの状況はほぼ一致するのに(+7%, +2%)、
// 無死だけ低い(-8%, -19%)。これは偶然ではなく、無死ではバントが半分近く
// (無死一塁47%・無死一二塁52%)使われて自分から1アウトを差し出しているため。
// 高校野球の実際の姿なので、この4状況はブカツ(中高大)の土台として採用する。
//
// 残り20状況は論文に無い。草野球・少年野球はバントがここまで多くなく、
// 得点も甲子園より入りやすいので、この4つを他のエディションへは持ち込まない。
export const KOSHIEN_RE = {
  '100|0': 0.79, '110|0': 1.16, '100|1': 0.55, '110|1': 0.90,
};
export const KOSHIEN_SOURCE = {
  title: '夏の高校野球甲子園大会における得点期待値と走者生還率の分析',
  where: '明治大学 総合数理学部 2018年度卒業研究',
  data: '2015〜2017年 夏の甲子園 全144試合',
  states: Object.keys(KOSHIEN_RE).length,
};

// エディション別の土台。実測が無いところは一般的な形のまま。
export function baseReFor(edition) {
  if (edition === 'ブカツ(中高大)') return { ...BASE_RE, ...KOSHIEN_RE };
  return BASE_RE;
}

// 回数が少ない状態を基準表側へ寄せる強さ。
// K回ぶんの「基準表どおりの結果」を最初から持っていた、とみなす。
export const SHRINK_K = 30;

const isPa = (l) => l && (l.kind === 'atbat' || l.kind === 'defense');
const halfKey = (l) => `${Number(l.inning) || 0}${l.isTop ? 'T' : 'B'}`;

// ------------------------------------------------------------
// 得点期待値表を、渡された試合群から作る
// 戻り値: { re(key)->点, samples(key)->回数, total, ownShare }
// ------------------------------------------------------------
export function buildRunExpectancy(games = [], edition = null) {
  const base = baseReFor(edition);
  const acc = new Map(); // key -> { n, runs }
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
  return { re, samples, total, ownShare, base };
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
    } else {
      if (cur && Math.abs(cur.swing) >= minSwing) out.push(cur);
      cur = { dir, swing: s.delta, from: s, to: s, n: 1 };
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
// 成績は必ず2つセットで出す。読み当て率だけだと「確信があるときしか押さない」で
// 高くできてしまうので、押さなければ下がる察知率と並べる。
// ------------------------------------------------------------
export function judgeFlowTags(game, series = [], opts = {}) {
  const windowAfter = opts.windowAfter ?? 5;
  const windowBefore = opts.windowBefore ?? 3;
  const minSwing = opts.minSwing ?? 0.5;
  // 「もう動いていた」の判定はこれより小さくてよい。単打1本で0.3前後動くので、
  // ヒットの直後に押したのは(読みではなく)反応として拾えないと意味がない。
  const reactSwing = opts.reactSwing ?? 0.25;

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
      // どの区間を先に読めたか(察知率の分子)
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
    hitRate: tags.length ? c.pre / tags.length : null,   // 読み当て率
    catchRate: swings.length ? caught.size / swings.length : null, // 察知率
    caught: caught.size,
  };
}

// ------------------------------------------------------------
// 線の形をひとことで言う
//
// 線の終値そのものは出さない。デルタは半回ごとに打ち消し合うので、
// 回の切れ目では積み上げ値は「そのときの点差」とぴったり同じ値になる
// (半回の合計 = その半回の得点 − 開始状態の得点期待値。両チームが同じ回数
//  ずつ攻撃すれば、開始状態ぶんは相殺される)。
// つまり終値を見出しに出しても、すぐ上のスコアボードを分かりにくい単位で
// 言い直しているだけになる。
//
// スコアボードに書いていないのは「どれだけの時間どちらに傾いていたか」と
// 「どこが底で、どこまで押し返したか」。線から読めるのはそこなので、そこを言う。
// ------------------------------------------------------------
export function flowShape(series = []) {
  if (!series.length) return null;
  let lowest = series[0];
  let highest = series[0];
  let below = 0;
  for (const s of series) {
    if (s.cum < lowest.cum) lowest = s;
    if (s.cum > highest.cum) highest = s;
    if (s.cum < 0) below += 1;
  }
  const belowShare = below / series.length;
  // 6割を境にする。5割ちょうどを「傾いていた」と言うと、
  // ほぼ互角の試合まで一方に振り分けてしまう
  const lean = belowShare >= 0.6 ? 'them' : belowShare <= 0.4 ? 'us' : 'even';
  return {
    lowest, highest, belowShare, lean,
    // 見出しに出す割合。傾いていた側の時間を出す
    leanPct: Math.round((lean === 'them' ? belowShare : 1 - belowShare) * 100),
  };
}

// 打率と同じ書き方。10割だけ 1.000 と書く(.1000 にならないように)
export function formatRate(v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v >= 1) return '1.000';
  return `.${String(Math.round(v * 1000)).padStart(3, '0')}`;
}

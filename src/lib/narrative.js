// ============================================================
// 流れの区間を文章にする
//
// 「1回裏〜2回表 から5打席で 勝率25% → 44%」だけでは、あとから試合を
// 見返しても何が起きたのか思い出せない。効くのは「誰が何をしたか」。
//
// ---- 羅列にしない ----
// 打席をそのまま「、」でつなぐと「Cは遊撃フライ、Dは一塁フライ、Eは左翼ゴロ」
// という表になる。読めるが、実況にも解説にもなっていない。
// 人が話すときは、こうしている:
//   ・続けて打ち取った打者はまとめる  → 「C、Dを連続で打ち取り」
//   ・回が変わるところで文を切る      → 「…打ち取った。続く1回裏、」
//   ・点が入ったら点差で呼び分ける    → 「先制」「同点」「逆転」「2点」
//   ・最後だけ言い切りにする          → 「…出塁」で終える
// この4つを入れる。
//
// 回と勝率は左の欄に出ているので、文章では繰り返さない。
//
// ---- これは下書きである ----
// ここが作るのは、記録から機械的に組んだ文。試合を見ていた記録員の言葉には
// 到底かなわない。「あの回はベンチが静かになった」も「相手が代えどきを
// 間違えた」も、記録には残っていない。
// だから完成品として出さない。記録員がそのまま書き直せる下書きとして出し、
// 直された文があればそちらを常に優先する。
// ============================================================
import { RESULTS } from './model.js';
import { playLabel } from './voiceParser.js';

// 文に入れるできごとの上限。これ以上並べても読めない
export const MAX_EVENTS = 4;
// この程度しか動いていない打席は、話の筋に関係ない
export const MIN_DELTA = 0.01;

const sameHalf = (a, b) => a && b && a.inning === b.inning && a.isTop === b.isTop;

const runnersKey = (r) => {
  const on = r || {};
  return `${on[1] ? 1 : 0}${on[2] ? 1 : 0}${on[3] ? 1 : 0}`;
};

// その打席の「あと」の塁状況。同じ半回の次の打席の「前」がそれにあたる。
//
// 実際に起きた問題: 区間の中だけを見ていたので、区間の最後の打席では塁状況が
// 出なかった。タイブレークの無死一二塁から死球で満塁になった打席が
// 「死球で出塁」としか書かれず、なぜ勝率が18ポイントも動いたのか読めなかった。
// 区間の外(試合全体の並び)まで見て、同じ半回に次の打席があればそこから読む。
function basesAfter(items, i, ctx) {
  const cur = items[i];
  const next = items[i + 1] && sameHalf(items[i + 1], cur)
    ? items[i + 1]
    : ctx?.nextInHalf?.(cur);
  if (!cur || !next || !sameHalf(next, cur)) return null;
  const key = runnersKey(next.log?.payload?.beforeRunners);
  return key === '000' ? null : key;
}

const payloadOf = (item) => item?.log?.payload || null;
// 犠打・犠飛は、アウトにはなるが打ち取られたのではない。狙って走者を進めた
// 成功したプレイなので、「倒れ」「打ち取り」の側に入れてはいけない。
// (8回の送りバントが「バントに倒れ」と書かれていた。実際は試合を決めた1つ)
const isSacPlay = (p) => p?.result === 'sacBunt' || p?.result === 'sacFly';
const isOutPlay = (p) => {
  const def = RESULTS[p?.result];
  if (isSacPlay(p)) return false;
  return !!def && !def.onBase && !(Number(p.runs) || 0);
};

// 打席の呼び名。文の中では「遊撃ゴロ・アウト」が硬いので、末尾の「・アウト」は
// 落とす(ログの表記はそのまま残す)
function whatOf(p, ctx) {
  const s = playLabel(p.result, p.direction, p.outType, p.soType, ctx.edition, ctx.lang,
    { hitAngle: p.hitAngle, intentional: p.intentional });
  return ctx.lang === 'en' ? s : s.replace(/・アウト$/, '');
}
// 打者の呼び名。打順が記録されていれば「4番・田中」と添える。
// 実況が必ず打順を言うのは、それが打線のどこで起きたかを一言で示すため。
// 古い記録には打順が入っていないことがあるので、そのときは名前だけにする。
const whoOf = (item, ctx) => {
  const p = payloadOf(item);
  const name = item.mine ? ctx.nameOf(p?.playerId) : ctx.oppNameOf(p?.letter);
  if (!name) return '';
  const order = Number(p?.order);
  return order > 0 ? ctx.t('nr.who', { n: order, who: name }) : name;
};

// ---- 点が入ったときの呼び分け ----
// 「2点」とだけ言うのと「逆転」と言うのでは、同じ2点でも意味がまるで違う。
// 点差はすでに記録から分かるので、そこは言い分ける。
function scoreWord(item, before, ctx, end, runsOverride) {
  const runs = runsOverride ?? (Number(payloadOf(item)?.runs) || 0);
  const f = end ? 'end' : 'mid';
  // 「先制」「逆転」だけだと何点入ったのかが消える。2点以上なら点数も残す
  const withRuns = (w) => (runs >= 2 ? ctx.t(`nr.sc.multi.${f}`, { n: runs, w }) : w);
  if (!before) return ctx.t(`nr.sc.runs.${f}`, { n: runs });
  const diff = before.my - before.opp;      // 自チームから見た点差(その打席の前)
  const after = item.mine ? diff + runs : diff - runs;
  if (item.mine) {
    if (before.my === 0 && before.opp === 0) return withRuns(ctx.t(`nr.sc.first.${f}`, { n: runs }));
    if (diff < 0 && after === 0) return withRuns(ctx.t(`nr.sc.tie.${f}`, { n: runs }));
    if (diff < 0 && after > 0) return withRuns(ctx.t(`nr.sc.comeback.${f}`, { n: runs }));
    if (diff === 0 && after > 0) return withRuns(ctx.t(`nr.sc.ahead.${f}`, { n: runs }));
    return ctx.t(`nr.sc.runs.${f}`, { n: runs });
  }
  // 守備側。こちらから見れば失点
  if (diff > 0 && after < 0) return withRuns(ctx.t(`nr.sc.lost.${f}`, { n: runs }));
  if (diff > 0 && after === 0) return withRuns(ctx.t(`nr.sc.caught.${f}`, { n: runs }));
  return ctx.t(`nr.sc.allowed.${f}`, { n: runs });
}

// ---- 打席をできごとにまとめる ----
// 続けて打ち取った(出塁もせず点も入らない)打者は1つにまとめる。
// 「C、Dを連続で打ち取り」のほうが、2つ並べるより実際の話し方に近い。
function toEvents(items, ctx) {
  const events = [];
  for (let i = 0; i < items.length; i += 1) {
    const p = payloadOf(items[i]);
    if (!p || !p.result || !RESULTS[p.result]) continue;
    if (isSacPlay(p)) {
      // 打ち取られた側にも出塁した側にもまとめない。どちらの言い方も合わない
      events.push({ kind: 'sac', items: [items[i]], at: items[i], mine: items[i].mine, index: i });
    } else if (isOutPlay(p)) {
      const group = [items[i]];
      while (i + 1 < items.length) {
        const np = payloadOf(items[i + 1]);
        if (!np || !isOutPlay(np) || items[i + 1].mine !== items[i].mine
          || !sameHalf(items[i + 1], items[i])) break;
        group.push(items[i + 1]);
        i += 1;
      }
      events.push({ kind: 'outs', items: group, at: group[0], mine: group[0].mine });
    } else if (!RESULTS[p.result].onBase) {
      // 点は入ったが打者は出塁していない(犠飛・スクイズなど)。
      // 「続けて出塁」のまとめに混ぜると、出ていない打者を出塁させてしまう
      events.push({ kind: 'play', items: [items[i]], at: items[i], mine: items[i].mine, index: i });
    } else {
      // 続けて出塁した打者はまとめる。「秦の1点、若山の1点、竹丸の1点」と
      // 並べるより「秦、若山、竹丸の3連打で3点」のほうが実際の話し方に近い
      const group = [items[i]];
      let j = i;
      while (j + 1 < items.length) {
        const np = payloadOf(items[j + 1]);
        if (!np || !np.result || !RESULTS[np.result]) break;
        // まとめてよいのは「実際に塁に出た」打者だけ
        if (!RESULTS[np.result].onBase) break;
        if (items[j + 1].mine !== items[i].mine || !sameHalf(items[j + 1], items[i])) break;
        group.push(items[j + 1]);
        j += 1;
      }
      if (group.length >= 2) {
        events.push({ kind: 'rally', items: group, at: group[0], mine: group[0].mine, index: i });
        i = j;
      } else {
        events.push({ kind: 'play', items: [items[i]], at: items[i], mine: items[i].mine, index: i });
      }
    }
  }
  return events;
}

// できごと1つを句にする。end=true なら言い切りの形にする
function phraseOf(ev, ctx, items, end) {
  const side = ev.mine ? 'o' : 'd';   // o=自チームの攻撃 / d=守備
  const tail = end ? 'end' : 'mid';
  if (ev.kind === 'outs') {
    const names = ev.items.map((x) => whoOf(x, ctx)).filter(Boolean);
    if (!names.length) return null;
    if (names.length === 1) {
      return ctx.t(`nr.${side}.out.${tail}`, { who: names[0], what: whatOf(payloadOf(ev.at), ctx) });
    }
    return ctx.t(`nr.${side}.outs.${tail}`, { who: names.join(ctx.lang === 'en' ? ', ' : '、'), n: names.length });
  }
  if (ev.kind === 'rally') {
    const names = ev.items.map((x) => whoOf(x, ctx)).filter(Boolean);
    const runs = ev.items.reduce((n, x) => n + (Number(payloadOf(x)?.runs) || 0), 0);
    if (!names.length) return null;
    const who = names.join(ctx.lang === 'en' ? ', ' : '、');
    // 全部が安打なら「連打」、四球やエラーが混じるなら「続けて出塁」
    const allHits = ev.items.every((x) => RESULTS[payloadOf(x)?.result]?.hit);
    const kind = allHits ? 'rally' : 'chain';
    if (!runs) return ctx.t(`nr.${side}.${kind}0.${tail}`, { who, n: names.length });
    return ctx.t(`nr.${side}.${kind}.${tail}`, {
      who, n: names.length,
      score: scoreWord(ev.items[ev.items.length - 1], ctx.scoreBefore?.(ev.at), ctx, end, runs),
    });
  }
  const p = payloadOf(ev.at);
  const who = whoOf(ev.at, ctx);
  if (!who) return null;
  const what = whatOf(p, ctx);
  const runs = Number(p.runs) || 0;
  if (ev.kind === 'sac') {
    // 呼び名は打球方向を外して「送りバント」「犠牲フライ」にする。
    // 「投手バント」だと、狙って転がしたことより打球方向のほうが前に出る
    const sacWhat = ctx.t(p.result === 'sacFly' ? 'nr.sacFly' : 'nr.sacBunt');
    if (runs > 0) {
      return ctx.t(`nr.${side}.sacRuns.${tail}`, {
        who, what: sacWhat, score: scoreWord(ev.at, ctx.scoreBefore?.(ev.at), ctx, end),
      });
    }
    return ctx.t(`nr.${side}.sac.${tail}`, { who, what: sacWhat });
  }
  if (runs > 0) {
    // 打者が出ていないのに点が入ったなら、その打席が点を取ったわけではない。
    // 暴投・捕逸・失策で還っている。「三振で勝ち越し」は起きていないことを書く形。
    const key = RESULTS[p.result]?.onBase ? 'runs' : 'outRuns';
    return ctx.t(`nr.${side}.${key}.${tail}`, {
      who, what, score: scoreWord(ev.at, ctx.scoreBefore?.(ev.at), ctx, end),
    });
  }
  const bases = ev.index != null ? basesAfter(items, ev.index, ctx) : null;
  if (bases) {
    return ctx.t(`nr.${side}.reachBases.${tail}`, { who, what, bases: ctx.t(`ret.r.${bases}`) });
  }
  return ctx.t(`nr.${side}.reach.${tail}`, { who, what });
}

// ------------------------------------------------------------
// 区間 → 下書きの文
//
// run … flowRuns の1要素 { items, from, to, n, dir }
// ctx … { nameOf, oppNameOf, edition, lang, t, innOf, scoreBefore? }
// ------------------------------------------------------------
export function draftNarrative(run, ctx) {
  if (!run || !Array.isArray(run.items) || !run.items.length) return '';
  const items = run.items;

  const all = toEvents(items, ctx);
  // 動いたできごとだけ。まとめたアウトは、まとめて1つぶんの動きで見る
  const moved = all.filter((ev) =>
    ev.items.reduce((sum, x) => sum + Math.abs(x.delta || 0), 0) >= MIN_DELTA);
  const picked = (moved.length > MAX_EVENTS
    ? [...moved].sort((a, b) => {
      const w = (e) => e.items.reduce((s, x) => s + Math.abs(x.delta || 0), 0);
      return w(b) - w(a);
    }).slice(0, MAX_EVENTS)
    : moved
  ).sort((a, b) => items.indexOf(a.at) - items.indexOf(b.at));
  if (!picked.length) return '';

  // 回が変わるところで文を切る。人が話すときも、そこで一度切っている
  const sep = ctx.lang === 'en' ? ', ' : '、';
  // ---- どちらのチームの打者かを必ず言う ----
  // 「打ち取った」なら相手、「倒れ」なら自チーム、と動詞で暗示はできるが、
  // 回をまたぐと2つの打線が続けて出てくるので、暗示だけでは読み手が追えない。
  // 側が変わるところで、そのイニングを攻めているチームの名前を置く。
  const sideLabel = (ev) => ctx.t(ev.mine ? 'nr.side.own' : 'nr.side.opp', {
    team: ev.mine ? ctx.teamName : ctx.oppName,
  });
  // タイブレークの回は走者を置いて始まる。そこを書かないと「先頭が出ただけで
  // 大きく動いた」と読めてしまう(実際は無死一二塁から満塁になっている)
  const tbLead = (ev) => {
    const key = ctx.tiebreakAt?.(ev.at.inning);
    if (!key) return '';
    // 半回の途中から始まる区間に「無死一二塁から」と書くと、記録に無いことを
    // 書いたことになる。その打席が本当にその半回の1人目のときだけ 書く
    const p0 = payloadOf(ev.at);
    const startedHere = p0
      && `${runnersKey(p0.beforeRunners)}|${Math.min(2, Number(p0.outsBefore) || 0)}` === String(key);
    if (!startedHere) return '';
    const [runners, outs] = String(key).split('|');
    return ctx.t('nr.tb', {
      state: `${ctx.t(`nr.outs.${Math.min(2, Number(outs) || 0)}`)}${ctx.t(`ret.r.${runners}`)}`,
    });
  };
  let out = '';
  for (let i = 0; i < picked.length; i += 1) {
    const ev = picked[i];
    const prev = picked[i - 1];
    const newHalf = i > 0 && !sameHalf(ev.at, prev.at);
    const newSide = i === 0 || ev.mine !== prev.mine || newHalf;
    const isLast = i === picked.length - 1;
    // 回をまたぐ手前は言い切って、次の回を頭に置く
    const body = phraseOf(ev, ctx, items, isLast || (i + 1 < picked.length && !sameHalf(picked[i + 1].at, ev.at)));
    if (!body) continue;
    const phrase = newSide ? `${tbLead(ev)}${sideLabel(ev)}${body}` : body;
    if (i === 0) out = phrase;
    else if (newHalf) out += `${ctx.t('nr.period')}${ctx.t('nr.next', { inn: ctx.innOf(ev.at) })}${phrase}`;
    else out += `${sep}${phrase}`;
  }
  if (!out) return '';
  out += ctx.t('nr.period');

  // 拾わなかった打席は黙って落とさない。文章と記録が食い違ったまま残るので
  const shown = picked.reduce((n, ev) => n + ev.items.length, 0);
  const rest = items.length - shown;
  return rest > 0 ? `${out}${ctx.t('nr.more', { n: rest })}` : out;
}

// 記録員が直した文の置き場所。区間の先頭打席のIDで引く。
// 打席を消したり直したりすると区間の切れ目が変わるので、キーが合わなくなる
// ことがある。そのときは下書きに戻るだけで、記録は壊れない。
export const noteKeyOf = (run) => run?.from?.id || '';
export const noteOf = (game, run) => (game?.flowNotes || {})[noteKeyOf(run)] || '';

// ============================================================
// 流れの区間を文章にする
//
// 「1回裏〜2回表 から5打席で 勝率25% → 44%」だけでは、あとから試合を
// 見返しても何が起きたのか思い出せない。効くのは「誰が何をしたか」。
//
// ---- これは下書きである ----
// ここが作るのは、記録から機械的に組んだ文。試合を見ていた記録員の言葉には
// 到底かなわない。「あの回はベンチが静かになった」も「相手が代えどきを
// 間違えた」も、記録には残っていない。
// だから完成品として出さない。記録員がそのまま書き直せる下書きとして出し、
// 直された文があればそちらを常に優先する。
//
// ---- 何を1文に入れるか ----
// 打席を全部並べると読めない。動いた打席だけを時系列で拾い、上限を置く。
// 拾わなかったぶんは「ほか◯打席」と正直に書く(黙って落とすと、文章が
// 記録と食い違ったまま残る)。
// ============================================================
import { RESULTS } from './model.js';
import { playLabel } from './voiceParser.js';

// 文に入れる打席の上限。これ以上並べても読めない
export const MAX_CLAUSES = 4;
// この程度しか動いていない打席は、話の筋に関係ない
export const MIN_DELTA = 0.01;

const runnersKey = (r) => {
  const on = r || {};
  return `${on[1] ? 1 : 0}${on[2] ? 1 : 0}${on[3] ? 1 : 0}`;
};

// その打席の「あと」の塁状況。同じ半回の次の打席の「前」がそれにあたる。
// 半回の最後の打席は次が無いので分からない(null)。
function basesAfter(items, i) {
  const cur = items[i];
  const next = items[i + 1];
  if (!cur || !next) return null;
  if (next.inning !== cur.inning || next.isTop !== cur.isTop) return null;
  const key = runnersKey(next.log?.payload?.beforeRunners);
  return key === '000' ? null : key;
}

// 打席1つを句にする。
//   点が入った  … 「田中の左翼ヒットで2点」
//   出塁した    … 「佐藤の四球で一二塁」(塁状況が分かるときだけ添える)
//   アウト      … 「山本は遊撃ゴロ」
function clauseOf(item, basesKey, ctx) {
  const p = item.log?.payload;
  if (!p || !p.result) return null;
  const def = RESULTS[p.result];
  if (!def) return null;
  const who = item.mine ? ctx.nameOf(p.playerId) : ctx.oppNameOf(p.letter);
  if (!who) return null;
  const what = playLabel(p.result, p.direction, p.outType, p.soType, ctx.edition, ctx.lang,
    { hitAngle: p.hitAngle, intentional: p.intentional });
  const runs = Number(p.runs) || 0;
  if (runs > 0) return ctx.t('nr.runs', { who, what, n: runs });
  if (def.onBase) {
    return basesKey
      ? ctx.t('nr.reachBases', { who, what, bases: ctx.t(`ret.r.${basesKey}`) })
      : ctx.t('nr.reach', { who, what });
  }
  // 「鈴木は遊撃ゴロ・アウト」は文の中では硬い。「〜は」がもうアウトを表して
  // いるので、末尾の「・アウト」は落とす(ログの表記はそのまま残す)
  return ctx.t('nr.out', { who, what: what.replace(/・アウト$/, '') });
}

// ------------------------------------------------------------
// 区間 → 下書きの文
//
// run … flowRuns の1要素 { items, from, to, n, dir }
// ctx … { nameOf, oppNameOf, edition, lang, t, innOf }
// ------------------------------------------------------------
export function draftNarrative(run, ctx) {
  if (!run || !Array.isArray(run.items) || !run.items.length) return '';
  const items = run.items;

  // 動いた打席だけを時系列で。多すぎるときは動いた順に選んで、並べ直す
  const moved = items
    .map((s, i) => ({ s, i }))
    .filter((x) => Math.abs(x.s.delta) >= MIN_DELTA);
  const picked = (moved.length > MAX_CLAUSES
    ? [...moved].sort((a, b) => Math.abs(b.s.delta) - Math.abs(a.s.delta)).slice(0, MAX_CLAUSES)
    : moved
  ).sort((a, b) => a.i - b.i);

  const clauses = [];
  for (const x of picked) {
    const c = clauseOf(x.s, basesAfter(items, x.i), ctx);
    if (c) clauses.push(c);
  }
  if (!clauses.length) return '';

  const sep = ctx.lang === 'en' ? ', ' : '、';
  const head = ctx.t('nr.head', {
    inn: ctx.innOf(run.from) === ctx.innOf(run.to)
      ? ctx.innOf(run.from)
      : `${ctx.innOf(run.from)}〜${ctx.innOf(run.to)}`,
    n: run.n,
  });
  // 拾わなかった打席は黙って落とさない。文章と記録が食い違ったまま残るので
  const rest = items.length - picked.length;
  const more = rest > 0 ? ctx.t('nr.more', { n: rest }) : '';
  const tail = ctx.t('nr.tail', {
    a: Math.round((run.from.we - run.from.delta) * 100),
    b: Math.round(run.to.we * 100),
  });
  return `${head}${clauses.join(sep)}${ctx.t('nr.period')}${more}${tail}`;
}

// 記録員が直した文の置き場所。区間の先頭打席のIDで引く。
// 打席を消したり直したりすると区間の切れ目が変わるので、キーが合わなくなる
// ことがある。そのときは下書きに戻るだけで、記録は壊れない。
export const noteKeyOf = (run) => run?.from?.id || '';
export const noteOf = (game, run) => (game?.flowNotes || {})[noteKeyOf(run)] || '';

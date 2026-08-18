// ============================================================
// 記録員(スコアラー)と、その「流れの読み」の実績
//
// 流れタグは打った・投げたの記録ではなく、記録員が見て押した判断そのもの。
// だから誰が付けた試合かを残さないと、当たったのか外したのかを積み上げられない。
// 試合に記録員を1人置き、タグにも押した時点の記録員を焼き込む(途中で交代しても
// タグの持ち主は変わらない)。
//
// 記録員は選手とは別に持つ。スコアラーは選手とは限らない(監督・保護者・部員)し、
// 選手として登録すると打席が無いのに打者一覧に出てきてしまう。
// ============================================================
import { weSeries, judgeFlowTags } from './flow.js';
import { gapOf } from './teamGap.js';

export const scorerName = (settings, id) =>
  (settings?.scorers || []).find((s) => s.id === id)?.name || '';

export const scorersOf = (settings) => (settings?.scorers || []);

// そのタグを押した記録員。押した時点の記録員を優先し、無ければ試合の記録員
export const tagScorerId = (game, tag) => tag?.payload?.scorerId || game?.scorerId || null;

// 記録員ごとの実績。
//  読みの精度 = 押したタグのうち「予兆」だったもの / 押したタグ(タグ単位で数える)
//  読みの広さ = 実際に大きく動いた区間のうち、押せていたもの / 動いた区間
//             (区間は試合のもので、タグ1つに割り当てられない。試合の記録員に付ける)
export function aggregateScorers(games, winExp, opts = {}) {
  const map = {};
  const get = (id) => {
    if (!map[id]) {
      map[id] = {
        scorerId: id, games: 0, tags: 0, pre: 0, post: 0, miss: 0,
        swings: 0, caught: 0,
      };
    }
    return map[id];
  };

  for (const g of games || []) {
    const tagLogs = (g.playLogs || []).filter((l) => l.kind === 'flow');
    if (!tagLogs.length && !g.scorerId) continue;
    const series = weSeries(g, winExp);
    // しきい値は勝率(0〜1)の単位。FlowViewの判定とそろえる。
    // 力の差を入れた試合は勝率が動ける幅そのものが狭いので、試合ごとに縮める
    const j = judgeFlowTags(g, series, { ...swingScale(g), ...opts });

    for (const tag of j.tags) {
      const id = tagScorerId(g, tag);
      if (!id) continue;
      const s = get(id);
      s.tags += 1;
      const v = j.verdict[tag.id];
      if (v === 'pre') s.pre += 1;
      else if (v === 'post') s.post += 1;
      else s.miss += 1;
    }
    // 読みの広さは「試合の中で起きた大きな動き」が母数なので、試合の記録員に付ける
    if (g.scorerId) {
      const s = get(g.scorerId);
      s.games += 1;
      s.swings += j.swings.length;
      s.caught += j.caught;
    }
  }

  for (const s of Object.values(map)) {
    s.hitRate = s.tags ? s.pre / s.tags : null;
    s.catchRate = s.swings ? s.caught / s.swings : null;
  }
  return map;
}

// ------------------------------------------------------------
// 流れタグのしきい値を、その試合の「勝率が動ける幅」に合わせる
//
// 実際に起きた問題: 相手を「胸を借りる」(勝率5%)に設定した試合では、
// 1回無死満塁でも勝率が4.4ポイントしか動かない(互角なら18.2ポイント)。
// 互角前提の12ポイントのままだと、記録員がどれだけ正しく読んでも
// 「大きく動いた」が一度も成立せず、読みの精度が0のまま沈む。
//
// 幅の目安には 4p(1-p) を使う。勝率pのときに勝敗がどれだけ揺れうるかで、
// p=0.5 で1、p=0.05 で0.19。実測の圧縮率(4.4/18.2=0.24)とほぼ一致する。
// 縮めすぎると誤差を拾うので、下限を0.25に置く。
export const OPEN_MIN_SWING = 0.12;
export const OPEN_REACT_SWING = 0.07;

export function swingScale(game, opening = null) {
  const p = Number(opening ?? openingOf(game));
  if (!(p > 0 && p < 1)) return { minSwing: OPEN_MIN_SWING, reactSwing: OPEN_REACT_SWING };
  const k = Math.max(0.25, 4 * p * (1 - p));
  return { minSwing: OPEN_MIN_SWING * k, reactSwing: OPEN_REACT_SWING * k };
}

// 試合の設定から開始時の勝率を読む(倍率を解き直さずに済むよう、段階の値をそのまま使う)
function openingOf(game) {
  return gapOf(game?.teamGap || 'even').win;
}

// ------------------------------------------------------------
// 試合ごとに勝率モデルを作って合算する
//
// 実際に起きた問題: 呼び出し側が「いま開いている試合のモデル」を1つ渡して
// 全試合を計算していた。先攻/後攻も規定回数も相手との力の差も試合ごとに
// 違うので、同じ記録員の通算成績が「どの試合を開いているか」で変わっていた。
// modelFor(game) を受け取って、試合ごとに正しいモデルで数える。
// ------------------------------------------------------------
const SUM_KEYS = ['games', 'tags', 'pre', 'post', 'miss', 'swings', 'caught'];

export function aggregateScorersOver(games, modelFor, opts = {}) {
  const merged = {};
  for (const g of games || []) {
    const one = aggregateScorers([g], modelFor(g), opts);
    for (const [id, v] of Object.entries(one)) {
      if (!merged[id]) merged[id] = { ...v };
      else for (const k of SUM_KEYS) merged[id][k] += v[k];
    }
  }
  for (const s of Object.values(merged)) {
    s.hitRate = s.tags ? s.pre / s.tags : null;
    s.catchRate = s.swings ? s.caught / s.swings : null;
  }
  return merged;
}

// 並べ替え: 押した数がある人を先に、読みの精度の高い順。
// 1試合だけの人が満点で先頭に来ると実績として読めないので、
// 最低タグ数(minTags)に届かない人は後ろへ回す。
export function rankScorers(map, minTags = 5) {
  return Object.values(map).sort((a, b) => {
    const qa = a.tags >= minTags ? 1 : 0;
    const qb = b.tags >= minTags ? 1 : 0;
    if (qa !== qb) return qb - qa;
    const ra = a.hitRate ?? -1;
    const rb = b.hitRate ?? -1;
    if (ra !== rb) return rb - ra;
    return b.tags - a.tags;
  });
}

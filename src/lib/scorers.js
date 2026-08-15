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

export const scorerName = (settings, id) =>
  (settings?.scorers || []).find((s) => s.id === id)?.name || '';

export const scorersOf = (settings) => (settings?.scorers || []);

// そのタグを押した記録員。押した時点の記録員を優先し、無ければ試合の記録員
export const tagScorerId = (game, tag) => tag?.payload?.scorerId || game?.scorerId || null;

// 記録員ごとの実績。
//  読み当て率 = 押したタグのうち「予兆」だったもの / 押したタグ(タグ単位で数える)
//  察知率     = 実際に大きく動いた区間のうち、押せていたもの / 動いた区間
//               (区間は試合のもので、タグ1つに割り当てられない。試合の記録員に付ける)
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
    // しきい値は勝率(0〜1)の単位。FlowViewの判定とそろえる
    const j = judgeFlowTags(g, series, { minSwing: 0.12, reactSwing: 0.07, ...opts });

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
    // 察知率は「試合の中で起きた大きな動き」が母数なので、試合の記録員に付ける
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

// 並べ替え: 押した数がある人を先に、読み当て率の高い順。
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

import React, { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildRunExpectancy, formatRate } from '../lib/flow.js';
import { buildRunDists, buildWinModel } from '../lib/winExp.js';
import { currentRules } from '../lib/rules.js';
import { halfStartKeyOf } from '../lib/tiebreak.js';
import { aggregateScorersOver, rankScorers, scorerName } from '../lib/scorers.js';

// ---- 記録員の読み ----
// 打った・投げたは選手の成績になるが、「いま流れが来た」を押した判断は
// 記録員のもの。当たり外れが残らないと、その人が試合に居た意味が記録に出ない。
//
// 確度 = 押したタグのうち、動く前に読めていたものの割合(分母は押した回数)
// 大きさ = 読めたときに勝率が動いた幅の平均      (分母は読めた回数)
//          表示は五分(50%)からの行き先に揃える。「31ポイント」だけでは
//          大きいのか小さいのか分からないので、物差しを固定して言い直す
//          (防御率を「9回投げたら何点」に揃えるのと同じ)
// 順番に読む2つで、競合する物差しではない。
// 押した数が少ないうちは跳ねるので、回数を必ず併記する。
const MIN_TAGS = 5;

export default function ScorerCard({ games }) {
  const { state } = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const real = (games || []).filter((g) => g && !String(g.id).startsWith('demo-'));
    if (!real.length) return [];
    const edition = state.settings.edition || '草野球';
    const { re } = buildRunExpectancy(real, edition);
    const { dists } = buildRunDists(real, edition, re);
    // 勝率は先攻/後攻と規定回数で変わるので、試合ごとにモデルを作って渡す
    const modelFor = (g) => buildWinModel({
      dists, isHome: !!g.isHome, regulation: currentRules(g)?.innings || 7,
      halfStartKey: (inn) => halfStartKeyOf(g, inn),
    });
    return rankScorers(aggregateScorersOver(real, modelFor), MIN_TAGS);
  }, [games, state.settings.edition]);

  // 誰も記録員が設定されていない = この機能をまだ使っていない。空の表は出さない
  if (!rows.length) return null;
  const shown = open ? rows : rows.slice(0, 3);

  return (
    <div className="card">
      <h2>{t('sc.title')}</h2>
      <p className="small dim" style={{ marginTop: -4 }}>{t('sc.lead')}</p>
      <table className="sc-table">
        <thead>
          <tr>
            <th>{t('sc.name')}</th>
            <th className="num">{t('sc.readRate')}</th>
            <th className="num">{t('sc.readSize')}</th>
            <th className="num">{t('sc.tags')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.scorerId} className={s.tags < MIN_TAGS ? 'thin' : ''}>
              <td className="sc-name">{scorerName(state.settings, s.scorerId) || t('sc.unknown')}</td>
              <td className="num"><b>{formatRate(s.hitRate)}</b></td>
              <td className="num">{s.avgMove == null ? '—' : `${50 + Math.round(s.avgMove * 100)}%`}</td>
              <td className="num">{t('sc.tagsN', { n: s.tags, g: s.games })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 3 && (
        <button className="small mt8" style={{ width: '100%' }} onClick={() => setOpen(!open)}>
          {open ? t('sc.less') : t('sc.more', { n: rows.length - 3 })}
        </button>
      )}
      <p className="small dim mt8">{t('sc.note', { n: MIN_TAGS })}</p>
    </div>
  );
}

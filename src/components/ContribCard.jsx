import React, { useMemo, useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { buildRunExpectancy } from '../lib/flow.js';
import { buildRunDists, buildWinModel } from '../lib/winExp.js';
import { currentRules } from '../lib/rules.js';
import { halfStartKeyOf } from '../lib/tiebreak.js';
import { aggregateContrib, rankContrib, formatContrib } from '../lib/contrib.js';

// ---- 勝利貢献 / 得点貢献 ----
// 打率も打点も「どの場面だったか」を捨てている。9回2死同点の一打も、
// 大差の試合の1本も同じ1安打。ここはそこを分けて見るための2列。
//
//   勝利貢献(WPA) … その打席で勝率をどれだけ動かしたか。場面の重さが入る
//   得点貢献(RE24)… その打席で得点期待値をどれだけ動かしたか。場面の重みを外した値
//
// 2つ並べないと読み違える。片方だけだと「チャンスで回ってきただけ」の選手が上に来る。
const SHOW = 5;

export default function ContribCard({ games }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [side, setSide] = useState('bat');
  const [open, setOpen] = useState(false);

  const { bat, pit } = useMemo(() => {
    const real = (games || []).filter((g) => g && !String(g.id).startsWith('demo-'));
    if (!real.length) return { bat: [], pit: [] };
    const edition = state.settings.edition || '草野球';
    const { re } = buildRunExpectancy(real, edition);
    const { dists } = buildRunDists(real, edition, re);
    // 勝率は先攻/後攻と規定回数で変わるので、試合ごとにモデルを作る
    const modelFor = (g) => buildWinModel({
      dists,
      isHome: !!g.isHome,
      regulation: currentRules(g)?.innings || 7,
      halfStartKey: (inn) => halfStartKeyOf(g, inn),
    });
    const out = aggregateContrib(real, modelFor, re);
    return { bat: rankContrib(out.bat), pit: rankContrib(out.pit) };
  }, [games, state.settings.edition]);

  if (!bat.length && !pit.length) return null;
  const rows = side === 'bat' ? bat : pit;
  const shown = open ? rows : rows.slice(0, SHOW);

  return (
    <div className="card">
      {/* 2列目の意味が打者と投手で反転するので、見出しも切り替える */}
      <h2>{t(`cc.title.${side}`)}</h2>
      <p className="small dim" style={{ marginTop: -4 }}>{t(`cc.lead.${side}`)}</p>
      <div className="toggle-row">
        <button className={side === 'bat' ? 'active' : ''} onClick={() => { setSide('bat'); setOpen(false); }}>
          {t('cc.bat')}
        </button>
        <button className={side === 'pit' ? 'active' : ''} onClick={() => { setSide('pit'); setOpen(false); }}>
          {t('cc.pit')}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="small dim mt8">{t('cc.empty')}</p>
      ) : (
        <>
          <table className="cc-table">
            <thead>
              <tr>
                <th>{t('cc.player')}</th>
                <th className="num">{t('cc.wpa')}</th>
                <th className="num">{t(side === 'bat' ? 'cc.re24' : 'cc.rePrev')}</th>
                <th className="num">{side === 'bat' ? t('cc.pa') : t('cc.bf')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.playerId}>
                  <td className="cc-name">{nameOf(r.playerId)}</td>
                  <td className={`num ${r.wpa >= 0 ? 'up' : 'down'}`}><b>{formatContrib(r.wpa)}</b></td>
                  <td className={`num ${r.re24 >= 0 ? 'up' : 'down'}`}>{formatContrib(r.re24, 1)}</td>
                  <td className="num dim">{side === 'bat' ? r.pa : r.bf}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > SHOW && (
            <button className="small mt8" style={{ width: '100%' }} onClick={() => setOpen(!open)}>
              {open ? t('cc.less') : t('cc.more', { n: rows.length - SHOW })}
            </button>
          )}
        </>
      )}
      {/* 同じ列でも打者と投手で意味が反転する(稼いだ点 / 取られずに済んだ点)。
          見出しも説明も side ごとに変えないと、投手側が読めない */}
      <p className="small dim mt8">{t('cc.note.wpa')}</p>
      <p className="small dim">{t(`cc.note.${side}`)}</p>
      <p className="small dim">{t('cc.noWar')}</p>
    </div>
  );
}

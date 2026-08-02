import React, { useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { oppPlayerAtBats, buildMatchups } from '../lib/matchup.js';
import SprayChart from './SprayChart.jsx';
import { fmtAvg } from '../lib/stats.js';

// ============================================================
// 相手選手ページ
//
// 打球分布は、この一連の機能で唯一「試合中」に使えるデータ。
// 他はすべて試合前の準備だが、これは打席に入った瞬間に外野を動かせる。
// 打球方向(direction)は相手の打席にも記録済みなので、過去の試合ぶんも
// そのまま描ける。
//
// 数字を並べるだけでは試合中に使えないので、「右方向が3分の2」という
// 傾向を帯と一言に翻訳して添える。
// ============================================================
export default function OppPlayerView({ oppKey, onClose }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = (id) => state.players.find((p) => p.id === id)?.name || id;

  const data = useMemo(
    () => oppPlayerAtBats(Object.values(state.games), oppKey),
    [state.games, oppKey],
  );
  // 自軍投手別の被打率(この相手に誰が抑えているか)
  const vsPitchers = useMemo(() => {
    const { pitching } = buildMatchups(Object.values(state.games));
    return pitching.filter((r) => r.oppKey === oppKey).sort((a, b) => b.pa - a.pa);
  }, [state.games, oppKey]);

  if (!data) return null;

  const dirTotal = data.dir.pull + data.dir.center + data.dir.oppo;
  const pct = (n) => (dirTotal ? Math.round((n / dirTotal) * 100) : 0);
  const handLabel = data.hand === 'L' ? t('hand.L') : data.hand === 'R' ? t('hand.R') : '';
  // 引っ張りが半分を超えていれば、守備を寄せる価値がある
  const pullHeavy = dirTotal >= 5 && data.dir.pull / dirTotal >= 0.5;

  return (
    <div className="sheet-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet opv-card">
        <div className="yc-head">
          <button className="small ghost" onClick={onClose}>‹ {t('action.close')}</button>
        </div>
        <h2 style={{ marginBottom: 2 }}>
          {data.name}
          {handLabel && <span className="dim small" style={{ marginLeft: 6 }}>{handLabel}打</span>}
        </h2>
        <p className="small dim" style={{ margin: 0 }}>
          {data.team} ・ {t('oppview.games', { n: data.games, pa: data.atBats.length })}
        </p>

        <div className="mt12">
          <SprayChart atBats={data.atBats} title={t('oppview.spray')} />
        </div>

        {dirTotal > 0 && (
          <>
            <div className="dirbar">
              <i className="pull" style={{ width: `${pct(data.dir.pull)}%` }} />
              <i className="mid" style={{ width: `${pct(data.dir.center)}%` }} />
              <i className="oppo" style={{ width: `${pct(data.dir.oppo)}%` }} />
            </div>
            <div className="dirlab">
              <span>{t('oppview.pull')} {pct(data.dir.pull)}%</span>
              <span>{t('oppview.center')} {pct(data.dir.center)}%</span>
              <span>{t('oppview.oppo')} {pct(data.dir.oppo)}%</span>
            </div>
            {pullHeavy && (
              <div className="opv-callout">
                {t('oppview.pullHint', { pct: pct(data.dir.pull), side: data.hand === 'L' ? t('oppview.right') : t('oppview.left') })}
              </div>
            )}
          </>
        )}

        <div className="section-title">{t('oppview.kind')}</div>
        <div className="kvrow"><span>{t('oppview.ground')}</span><b>{data.kind.ground}</b></div>
        <div className="kvrow"><span>{t('oppview.air')}</span><b>{data.kind.fly + data.kind.line}</b></div>

        {(data.sb || data.cs || data.sacBunt) > 0 && (
          <>
            <div className="section-title">{t('oppview.run')}</div>
            <div className="kvrow">
              <span>{t('oppview.sb')}</span>
              <b className={data.sb ? 'hot' : ''}>{data.sb} / {data.sb + data.cs}</b>
            </div>
            {data.sacBunt > 0 && <div className="kvrow"><span>{t('oppview.sac')}</span><b>{data.sacBunt}</b></div>}
          </>
        )}

        {vsPitchers.length > 0 && (
          <>
            <div className="section-title">{t('oppview.vsPit')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="rank-table" style={{ minWidth: 280 }}>
                <thead>
                  <tr><th>{t('stats.player')}</th><th>{t('stats.col.pa')}</th><th>{t('stats.col.h')}</th><th>{t('matchup.colOba')}</th></tr>
                </thead>
                <tbody>
                  {vsPitchers.map((r) => (
                    <tr key={r.key}>
                      <td style={{ fontWeight: 600 }}>{nameOf(r.myPlayerId)}</td>
                      <td className="num">{r.pa}</td>
                      <td className="num">{r.h}</td>
                      <td className="num">{fmtAvg(r.avg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="foot-note">{t('oppview.note')}</p>
      </div>
    </div>
  );
}

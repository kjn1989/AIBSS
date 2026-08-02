import React, { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { oppOffenseStats, opponentTeams, normalizeName } from '../lib/matchup.js';
import { fmtAvg } from '../lib/stats.js';

// ============================================================
// 相手の機動力(走ってくるチームか、送ってくるチームか)
//
// 試合前に知りたいのは細かい数字ではなく、まず一言の性格づけ。
// 「走ってくる」と分かればバッテリーの準備が変わり、「送ってくる」と
// 分かれば内野の位置が変わる。数字はその裏づけとして下に置く。
//
// 場面別は「よく出る形」だけを名前で持つ。全組み合わせを並べても
// 1回きりの場面ばかりになり、傾向としては読めないため。
// ============================================================
export default function OppOffenseCard({ games }) {
  const { state } = useStore();
  const t = useT();
  const teams = useMemo(() => opponentTeams(games), [games]);
  const [team, setTeam] = useState(null);
  const cur = team ?? teams[0]?.name ?? null;
  const scoped = useMemo(
    () => (cur ? games.filter((g) => normalizeName(g.opponent) === normalizeName(cur)) : games),
    [games, cur],
  );
  const s = useMemo(() => oppOffenseStats(scoped), [scoped]);

  const hasData = s.att > 0 || s.sacBunt > 0 || s.sacFly > 0 || s.situations.length > 0;
  if (!hasData) return null;

  // 一言の性格づけ。強い順に1つだけ出す(3つ並べると結局読まれない)
  let callout = null;
  if (s.att >= 3 && s.sbRate != null && s.sbRate >= 0.7) {
    callout = { good: false, text: t('offense.runsALot', { sb: s.sb, att: s.att }) };
  } else if (s.sacBunt >= 3) {
    callout = { good: false, text: t('offense.buntsALot', { n: s.sacBunt }) };
  } else if (s.att >= 3 && s.sbRate != null && s.sbRate <= 0.4) {
    callout = { good: true, text: t('offense.canStop', { cs: s.cs, att: s.att }) };
  } else if (s.firstPitchRate != null && s.firstPitchRate >= 0.3) {
    callout = { good: false, text: t('offense.firstPitchHitter', { pct: Math.round(s.firstPitchRate * 100) }) };
  }

  return (
    <div className="card">
      <h2>{t('offense.title')}</h2>
      {teams.length > 1 && (
        <select value={cur || ''} onChange={(e) => setTeam(e.target.value)} style={{ marginBottom: 10 }}>
          {teams.map((o) => <option key={o.key} value={o.name}>{o.name}</option>)}
        </select>
      )}

      <div className="kpi3">
        <div className="kpi">
          <b>{s.sbRate == null ? '-' : fmtAvg(s.sbRate)}</b>
          <span>{t('offense.sbRate')}</span>
          <i>{t('offense.ofAtt', { sb: s.sb, att: s.att })}</i>
        </div>
        <div className="kpi">
          <b>{s.sacBunt}</b>
          <span>{t('offense.sacBunt')}</span>
          <i>{t('offense.perGame', { n: (s.sacBunt / Math.max(1, scoped.length)).toFixed(1) })}</i>
        </div>
        <div className="kpi">
          <b>{s.firstPitchRate == null ? '-' : `${Math.round(s.firstPitchRate * 100)}%`}</b>
          <span>{t('offense.firstPitch')}</span>
          <i>{t('offense.sacFlyN', { n: s.sacFly })}</i>
        </div>
      </div>

      {callout && (
        <div className={`opv-callout${callout.good ? ' good' : ''}`}>{callout.text}</div>
      )}

      {s.situations.length > 0 && (
        <>
          <div className="section-title">{t('offense.situations')}</div>
          <table className="rank-table">
            <thead>
              <tr>
                <th>{t('offense.situation')}</th>
                <th>{t('offense.count')}</th>
                <th>{t('offense.sacCount')}</th>
              </tr>
            </thead>
            <tbody>
              {s.situations.map((row) => (
                <tr key={row.key}>
                  <td style={{ fontWeight: 600 }}>{t(`offense.sit.${row.key}`)}</td>
                  <td className="num">{row.count}</td>
                  {/* 半分以上送ってくる場面は、そこだけ色を付けて拾えるようにする */}
                  <td className="num" style={{ color: row.sac / row.count >= 0.5 ? 'var(--amber)' : undefined }}>
                    {row.sac}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {s.runners.length > 0 && (
        <>
          <div className="section-title">{t('offense.runners')}</div>
          <table className="rank-table">
            <thead>
              <tr>
                <th>{t('offense.runner')}</th>
                <th>{t('battery.success')}</th>
                <th>{t('battery.caught')}</th>
                <th>{t('offense.rate')}</th>
              </tr>
            </thead>
            <tbody>
              {s.runners.map((r) => (
                <tr key={r.key}>
                  <td style={{ fontWeight: 600 }}>
                    {r.order ? <span className="dim small">{r.order} </span> : null}{r.name}
                  </td>
                  <td className="num">{r.sb}</td>
                  <td className="num">{r.cs}</td>
                  <td className="num">{r.rate == null ? '-' : fmtAvg(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="foot-note">{t('offense.note')}</p>
    </div>
  );
}

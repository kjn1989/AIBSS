import React, { useMemo, useState } from 'react';
import { useT, usePlayerName } from '../state/store.jsx';
import { oppOffenseStats, opponentTeams, normalizeName } from '../lib/matchup.js';
import { ownOffenseStats } from '../lib/ownScout.js';
import { fmtAvg } from '../lib/stats.js';

// ============================================================
// 機動力(走ってくるチームか、送ってくるチームか)
//
// 試合前に知りたいのは細かい数字ではなく、まず一言の性格づけ。
// 「走ってくる」と分かればバッテリーの準備が変わり、「送ってくる」と
// 分かれば内野の位置が変わる。数字はその裏づけとして下に置く。
//
// 同じ切り口を自軍にも向ける。相手は自軍を同じ目で見ているので、
// 「うちは無死一塁でいつも送っている」と気づけること自体が対策になる。
// 場面の区切りを相手と揃えてあるので、タブを行き来すれば比較できる。
// ============================================================
export default function OffenseCard({ games }) {
  const t = useT();
  const nameOf = usePlayerName();
  const [side, setSide] = useState('opp');
  const teams = useMemo(() => opponentTeams(games), [games]);
  const [team, setTeam] = useState(null);
  const cur = team ?? teams[0]?.name ?? null;
  const own = side === 'own';
  // 自軍は相手チームで絞らない(全試合が自分たちの傾向)
  const scoped = useMemo(
    () => (own || !cur ? games : games.filter((g) => normalizeName(g.opponent) === normalizeName(cur))),
    [games, cur, own],
  );
  const s = useMemo(() => (own ? ownOffenseStats(scoped) : oppOffenseStats(scoped)), [scoped, own]);

  const has = (x) => x.att > 0 || x.sacBunt > 0 || x.sacFly > 0 || x.situations.length > 0;
  const hasData = has(s);
  // 片側だけ空でもタブは残す。両方空のときだけカードごと隠す。
  const anyData = useMemo(
    () => hasData || has(own ? oppOffenseStats(games) : ownOffenseStats(games)),
    [hasData, own, games],
  );
  if (!anyData) return null;

  // 一言の性格づけ。強い順に1つだけ出す(3つ並べると結局読まれない)
  let callout = null;
  if (s.att >= 3 && s.sbRate != null && s.sbRate >= 0.7) {
    callout = { good: own, text: t(own ? 'offense.ownRuns' : 'offense.runsALot', { sb: s.sb, att: s.att }) };
  } else if (s.sacBunt >= 3) {
    callout = { good: false, text: t(own ? 'offense.ownBunts' : 'offense.buntsALot', { n: s.sacBunt }) };
  } else if (s.att >= 3 && s.sbRate != null && s.sbRate <= 0.4) {
    callout = { good: !own, text: t(own ? 'offense.ownCaught' : 'offense.canStop', { cs: s.cs, att: s.att }) };
  } else if (s.firstPitchRate != null && s.firstPitchRate >= 0.3) {
    callout = { good: false, text: t(own ? 'offense.ownFirstPitch' : 'offense.firstPitchHitter', { pct: Math.round(s.firstPitchRate * 100) }) };
  }

  return (
    <div className="card">
      <h2>{t(own ? 'offense.titleOwn' : 'offense.title')}</h2>
      <div className="scout-side">
        <div className="seg-control mini" role="tablist" aria-label={t('offense.title')}>
          <button role="tab" aria-selected={!own} className={!own ? 'on' : ''} onClick={() => setSide('opp')}>{t('scout.opp')}</button>
          <button role="tab" aria-selected={own} className={own ? 'on' : ''} onClick={() => setSide('own')}>{t('scout.own')}</button>
        </div>
        {!own && teams.length > 1 && (
          <select value={cur || ''} onChange={(e) => setTeam(e.target.value)}>
            {teams.map((o) => <option key={o.key} value={o.name}>{o.name}</option>)}
          </select>
        )}
      </div>

      {!hasData ? (
        <div className="dim small">{t('scout.noData')}</div>
      ) : (
        <>
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

          {callout && <div className={`opv-callout${callout.good ? ' good' : ''}`}>{callout.text}</div>}

          {s.situations.length > 0 && (
            <>
              <div className="section-title">{t(own ? 'offense.ownSituations' : 'offense.situations')}</div>
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
                      {/* 半分以上送っている場面は色を付ける。相手なら備え、自軍なら読まれている合図 */}
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
              <div className="section-title">{t(own ? 'offense.ownRunners' : 'offense.runners')}</div>
              <table className="rank-table">
                <thead>
                  <tr>
                    <th>{t(own ? 'offense.runnerOwn' : 'offense.runner')}</th>
                    <th>{t('battery.success')}</th>
                    <th>{t('battery.caught')}</th>
                    <th>{t('offense.rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.runners.map((r) => (
                    <tr key={r.key}>
                      <td style={{ fontWeight: 600 }}>
                        {own ? nameOf(r.playerId) : <>{r.order ? <span className="dim small">{r.order} </span> : null}{r.name}</>}
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
        </>
      )}
    </div>
  );
}

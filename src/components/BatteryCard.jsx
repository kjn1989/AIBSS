import React, { useMemo, useState } from 'react';
import { useT, usePlayerName } from '../state/store.jsx';
import { oppBatteryStats, opponentTeams, normalizeName } from '../lib/matchup.js';
import { ownBatteryStats } from '../lib/ownScout.js';
import { fmtAvg } from '../lib/stats.js';

// ============================================================
// バッテリーの隙
//
// 「この捕手からは走れる」が分かるだけで作戦が1つ増える。
// 草野球・学生野球ではここが一番点になる。
//
// 同じ物差しを自軍にも向ける。自軍は守備位置が記録されているので、
// 回ごとの捕手が確定でき、盗塁阻止率を捕手ごとに出せる。
// これは他のアプリではまず出てこない数字で、練習の的が決まる。
//
// 記録が薄い項目(暴投・捕逸は入力し損ねやすい)は、記録された試合数を
// 併記する。「暴投0=堅い」と「誰も入力していない」を混同させないため。
// ============================================================
export default function BatteryCard({ games }) {
  const t = useT();
  const nameOf = usePlayerName();
  const [side, setSide] = useState('opp');
  const teams = useMemo(() => opponentTeams(games), [games]);
  const [team, setTeam] = useState(null);
  const cur = team ?? teams[0]?.name ?? null;
  const own = side === 'own';
  // 自軍は相手チームで絞らない(全試合が自分たちのバッテリーの記録)
  const scoped = useMemo(
    () => (own || !cur ? games : games.filter((g) => normalizeName(g.opponent) === normalizeName(cur))),
    [games, cur, own],
  );
  const { catchers, pitchers, team: teamStats } = useMemo(
    () => (own ? ownBatteryStats(scoped) : oppBatteryStats(scoped)),
    [scoped, own],
  );

  const hasData = catchers.length > 0 || pitchers.length > 0;
  // 片側だけ空でもタブは残す。両方空のときだけカードごと隠す。
  const anyData = useMemo(() => {
    if (hasData) return true;
    const o = own ? oppBatteryStats(games) : ownBatteryStats(games);
    return o.catchers.length > 0 || o.pitchers.length > 0;
  }, [hasData, own, games]);
  if (!anyData) return null;

  // 走塁の記録がある試合数(0と「記録なし」を見分けるための目安)
  const withRunEvents = scoped.filter((g) =>
    (g.playLogs || []).some((l) => l.kind === 'sb' || (l.kind === 'runner' && l.text))).length;
  const label = (r) => (own ? nameOf(r.playerId) : r.name);
  const top = catchers[0];

  return (
    <div className="card">
      <h2>{t(own ? 'battery.titleOwn' : 'battery.title')}</h2>
      <div className="scout-side">
        <div className="seg-control mini" role="tablist" aria-label={t('battery.title')}>
          <button role="tab" aria-selected={!own} className={!own ? 'on' : ''} onClick={() => setSide('opp')}>{t('scout.opp')}</button>
          <button role="tab" aria-selected={own} className={own ? 'on' : ''} onClick={() => setSide('own')}>{t('scout.own')}</button>
        </div>
        {!own && teams.length > 1 && (
          <select value={cur || ''} onChange={(e) => setTeam(e.target.value)}>
            {teams.map((o) => <option key={o.key} value={o.name}>{o.name}</option>)}
          </select>
        )}
      </div>

      {!hasData ? <div className="dim small">{t('scout.noData')}</div> : (
        <>
          {catchers.length > 0 && (
            <>
              <div className="section-title">{t(own ? 'battery.ownCatchers' : 'battery.catchers')}</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="rank-table" style={{ minWidth: own ? 340 : 300 }}>
                  <thead>
                    <tr>
                      <th>{t('battery.catcher')}</th><th>{t('battery.success')}</th>
                      <th>{t('battery.caught')}</th><th>{t('battery.csRate')}</th>
                      {own && <th>{t('battery.pb')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {catchers.map((c) => (
                      <tr key={c.key}>
                        <td style={{ fontWeight: 600 }}>{label(c)}</td>
                        <td className="num">{c.sbAllowed}</td>
                        <td className="num">{c.caught}</td>
                        {/* 良し悪しの向きが逆になる。相手は「阻止率が低い=走れる=好都合」、
                            自軍は「阻止率が高い=良い」。色もそれぞれの見方に合わせる */}
                        <td
                          className="num"
                          style={{
                            color: c.csRate == null ? undefined
                              : own ? (c.csRate >= 0.4 ? 'var(--green)' : c.csRate <= 0.2 ? 'var(--amber)' : undefined)
                                : (c.csRate <= 0.25 ? 'var(--green)' : c.csRate >= 0.5 ? 'var(--amber)' : undefined),
                          }}
                        >
                          {c.csRate == null ? '-' : fmtAvg(c.csRate)}
                        </td>
                        {own && <td className="num">{c.pb}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {top && top.att >= 3 && top.csRate != null && (
                own ? (
                  <div className={`opv-callout${top.csRate >= 0.4 ? ' good' : ''}`}>
                    {top.csRate >= 0.4
                      ? t('battery.ownStrong', { name: label(top), cs: top.caught, att: top.att })
                      : t('battery.ownWeak', { name: label(top), sb: top.sbAllowed, att: top.att })}
                  </div>
                ) : (
                  <div className={`opv-callout${top.csRate <= 0.25 ? ' good' : ''}`}>
                    {top.csRate <= 0.25
                      ? t('battery.canRun', { name: top.name, sb: top.sbAllowed, att: top.att })
                      : t('battery.hardToRun', { name: top.name, cs: top.caught, att: top.att })}
                  </div>
                )
              )}
            </>
          )}

          {pitchers.length > 0 && (
            <>
              <div className="section-title">{t(own ? 'battery.ownPitchers' : 'battery.pitchers')}</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="rank-table" style={{ minWidth: 300 }}>
                  <thead>
                    <tr>
                      <th>{t('battery.pitcher')}</th><th>{t('battery.wp')}</th>
                      {!own && <th>{t('stats.col.bbhbp')}</th>}
                      <th>{t('battery.pickoff')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pitchers.map((p) => (
                      <tr key={p.key}>
                        <td style={{ fontWeight: 600 }}>{label(p)}</td>
                        <td className="num">{p.wp}</td>
                        {!own && <td className="num">{p.bbHbp}</td>}
                        <td className="num">{p.pickoff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {((!own && teamStats.pb > 0) || teamStats.balk > 0) && (
            <>
              <div className="section-title">{t('battery.other')}</div>
              {!own && teamStats.pb > 0 && <div className="kvrow"><span>{t('battery.pb')}</span><b>{teamStats.pb}</b></div>}
              {teamStats.balk > 0 && <div className="kvrow"><span>{t('battery.balk')}</span><b>{teamStats.balk}</b></div>}
            </>
          )}

          <p className="foot-note">
            {t('battery.coverage', { n: withRunEvents, total: scoped.length })}
            {' '}{t('battery.note')}
          </p>
        </>
      )}
    </div>
  );
}

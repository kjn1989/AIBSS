import React, { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { oppBatteryStats, opponentTeams, normalizeName } from '../lib/matchup.js';
import { fmtAvg } from '../lib/stats.js';

// ============================================================
// 相手バッテリーの隙
//
// 「この捕手からは走れる」が分かるだけで作戦が1つ増える。
// 草野球・学生野球ではここが一番点になる。
//
// 記録が薄い項目(暴投・捕逸は入力し損ねやすい)は、記録された試合数を
// 併記する。「暴投0=堅い」と「誰も入力していない」を混同させないため。
// ============================================================
export default function OppBatteryCard({ games }) {
  const { state } = useStore();
  const t = useT();
  const teams = useMemo(() => opponentTeams(games), [games]);
  const [team, setTeam] = useState(null);
  const cur = team ?? teams[0]?.name ?? null;
  const scoped = useMemo(
    () => (cur ? games.filter((g) => normalizeName(g.opponent) === normalizeName(cur)) : games),
    [games, cur],
  );
  const { catchers, pitchers, team: teamStats } = useMemo(() => oppBatteryStats(scoped), [scoped]);

  if (!catchers.length && !pitchers.length) return null;

  // 走塁の記録がある試合数(0と「記録なし」を見分けるための目安)
  const withRunEvents = scoped.filter((g) =>
    (g.playLogs || []).some((l) => l.kind === 'sb' || (l.kind === 'runner' && l.text))).length;

  return (
    <div className="card">
      <h2>{t('battery.title')}</h2>
      {teams.length > 1 && (
        <select value={cur || ''} onChange={(e) => setTeam(e.target.value)} style={{ marginBottom: 10 }}>
          {teams.map((o) => <option key={o.key} value={o.name}>{o.name}</option>)}
        </select>
      )}

      {catchers.length > 0 && (
        <>
          <div className="section-title">{t('battery.catchers')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rank-table" style={{ minWidth: 300 }}>
              <thead>
                <tr>
                  <th>{t('battery.catcher')}</th><th>{t('battery.success')}</th>
                  <th>{t('battery.caught')}</th><th>{t('battery.csRate')}</th>
                </tr>
              </thead>
              <tbody>
                {catchers.map((c) => (
                  <tr key={c.key}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td className="num">{c.sbAllowed}</td>
                    <td className="num">{c.caught}</td>
                    {/* 阻止率が低い=走れる。低い方を緑にするのは、自軍から見た良し悪しに合わせるため */}
                    <td className="num" style={{ color: c.csRate == null ? undefined : c.csRate <= 0.25 ? 'var(--green)' : c.csRate >= 0.5 ? 'var(--amber)' : undefined }}>
                      {c.csRate == null ? '-' : fmtAvg(c.csRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {catchers[0] && catchers[0].att >= 3 && catchers[0].csRate != null && (
            <div className={`opv-callout${catchers[0].csRate <= 0.25 ? ' good' : ''}`}>
              {catchers[0].csRate <= 0.25
                ? t('battery.canRun', { name: catchers[0].name, sb: catchers[0].sbAllowed, att: catchers[0].att })
                : t('battery.hardToRun', { name: catchers[0].name, cs: catchers[0].caught, att: catchers[0].att })}
            </div>
          )}
        </>
      )}

      {pitchers.length > 0 && (
        <>
          <div className="section-title">{t('battery.pitchers')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rank-table" style={{ minWidth: 300 }}>
              <thead>
                <tr>
                  <th>{t('battery.pitcher')}</th><th>{t('battery.wp')}</th>
                  <th>{t('stats.col.bbhbp')}</th><th>{t('battery.pickoff')}</th>
                </tr>
              </thead>
              <tbody>
                {pitchers.map((p) => (
                  <tr key={p.key}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="num">{p.wp}</td>
                    <td className="num">{p.bbHbp}</td>
                    <td className="num">{p.pickoff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(teamStats.pb > 0 || teamStats.balk > 0) && (
        <>
          <div className="section-title">{t('battery.other')}</div>
          <div className="kvrow"><span>{t('battery.pb')}</span><b>{teamStats.pb}</b></div>
          {teamStats.balk > 0 && <div className="kvrow"><span>{t('battery.balk')}</span><b>{teamStats.balk}</b></div>}
        </>
      )}

      <p className="foot-note">
        {t('battery.coverage', { n: withRunEvents, total: scoped.length })}
        {' '}{t('battery.note')}
      </p>
    </div>
  );
}

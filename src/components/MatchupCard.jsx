import React, { useMemo, useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { buildMatchups, opponentSummaries } from '../lib/matchup.js';
import { fmtAvg } from '../lib/stats.js';

// ============================================================
// 対戦成績カード
//
// 「自軍打者 × 相手投手」「自軍投手 × 相手打者」を試合をまたいで見る。
// 相手選手は名前を入れたぶんだけ積み上がるので、まだ1人も名前が
// 入っていないチームでは、その旨を案内して表は出さない。
// ============================================================

// 相手チームで絞り込み → 自軍選手ごとに、相手選手の行をぶら下げる形にまとめる。
// 対戦表をそのまま並べると行が多くなりすぎるため、自軍選手を見出しにする。
function groupByMyPlayer(rows, nameOf) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.myPlayerId)) map.set(r.myPlayerId, { myPlayerId: r.myPlayerId, name: nameOf(r.myPlayerId), rows: [], pa: 0 });
    const g = map.get(r.myPlayerId);
    g.rows.push(r);
    g.pa += r.pa;
  }
  return [...map.values()].sort((a, b) => b.pa - a.pa);
}

export default function MatchupCard({ games, onOpenPlayer }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [side, setSide] = useState('batting'); // batting: 自軍打者 vs 相手投手
  const [team, setTeam] = useState(null); // null = 未選択(既定は一番多く対戦した相手)
  const [minPa, setMinPa] = useState(1);

  const { batting, pitching } = useMemo(() => buildMatchups(games), [games]);
  const teams = useMemo(() => opponentSummaries(games), [games]);

  const all = side === 'batting' ? batting : pitching;
  const teamNames = [...new Set(all.map((r) => r.oppTeam).filter(Boolean))];
  // 既定は一番多く対戦した相手。対戦成績は「次にこのチームとやる」ときに見るものなので、
  // 全チーム混在よりも、まず1チームに絞れている方が読みやすい。
  const curTeam = team ?? (teamNames.length > 1 ? (teams.find((s) => teamNames.includes(s.name))?.name || 'all') : 'all');
  const rows = all.filter((r) => (curTeam === 'all' || r.oppTeam === curTeam) && r.pa >= minPa);
  const groups = groupByMyPlayer(rows, nameOf);
  // 相手チーム名は「すべての相手」を選んだときだけ行に添える(絞り込み中は自明で邪魔なため)
  const showTeamTag = curTeam === 'all' && teamNames.length > 1;

  // 相手選手の名前が1人も入っていないと対戦成績は作れない。作り方を案内する。
  if (batting.length === 0 && pitching.length === 0) {
    return (
      <div className="card">
        <h2>{t('matchup.title')}</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>{t('matchup.empty')}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>{t('matchup.title')}</h2>

      {/* 見る向きの切り替え。3つ並べる形式ではなく2択なので左右に並べる */}
      <div className="seg-control" style={{ marginBottom: 8 }}>
        <button className={side === 'batting' ? 'on' : ''} onClick={() => setSide('batting')}>{t('matchup.sideBat')}</button>
        <button className={side === 'pitching' ? 'on' : ''} onClick={() => setSide('pitching')}>{t('matchup.sidePit')}</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {teamNames.length > 1 && (
          <select value={curTeam} onChange={(e) => setTeam(e.target.value)} style={{ flex: '1 1 140px', minWidth: 0 }}>
            {teamNames.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="all">{t('matchup.allTeams')}</option>
          </select>
        )}
        <select value={minPa} onChange={(e) => setMinPa(Number(e.target.value))} style={{ flex: '0 1 120px' }}>
          {[1, 3, 5, 10].map((n) => <option key={n} value={n}>{t('matchup.minPa', { n })}</option>)}
        </select>
      </div>

      {groups.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{t('matchup.noRows')}</p>}

      {groups.map((g) => (
        <div key={g.myPlayerId} style={{ marginBottom: 14 }}>
          <div
            role="button"
            onClick={() => onOpenPlayer?.(g.myPlayerId)}
            style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}
          >
            {g.name}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rank-table" style={{ minWidth: 440 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>{side === 'batting' ? t('matchup.colOppPit') : t('matchup.colOppBat')}</th>
                  <th>{t('stats.col.pa')}</th>
                  <th>{t('stats.col.ab')}</th>
                  <th>{t('stats.col.h')}</th>
                  <th>{side === 'batting' ? t('stats.col.avg') : t('matchup.colOba')}</th>
                  <th>{t('stats.col.hr')}</th>
                  <th>{t('stats.col.bbhbp')}</th>
                  <th>{t('stats.col.so')}</th>
                  <th>{t('matchup.colOps')}</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {r.oppName}
                      {showTeamTag && (
                        <span
                          className="muted"
                          title={r.oppTeam}
                          style={{ fontSize: 11, marginLeft: 4, display: 'inline-block', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}
                        >
                          {r.oppTeam}
                        </span>
                      )}
                    </td>
                    <td className="num">{r.pa}</td>
                    <td className="num">{r.ab}</td>
                    <td className="num">{r.h}</td>
                    <td className="num">{fmtAvg(r.avg)}</td>
                    <td className="num">{r.hr}</td>
                    <td className="num">{r.bb + r.hbp}</td>
                    <td className="num">{r.so}</td>
                    <td className="num">{r.ops === null ? '-' : r.ops.toFixed(3).replace(/^0\./, '.')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {teams.length > 0 && (
        <>
          <div className="section-title">{t('matchup.teamRecord')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rank-table" style={{ minWidth: 360 }}>
              <thead>
                <tr>
                  <th>{t('matchup.colTeam')}</th><th>{t('matchup.colG')}</th>
                  <th>{t('matchup.colWL')}</th><th>{t('matchup.colRs')}</th><th>{t('matchup.colRa')}</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((s) => (
                  <tr key={s.key}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td className="num">{s.games}</td>
                    <td className="num">{s.win}-{s.lose}{s.draw ? `-${s.draw}` : ''}</td>
                    <td className="num">{s.rs}</td>
                    <td className="num">{s.ra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>{t('matchup.note')}</p>
    </div>
  );
}

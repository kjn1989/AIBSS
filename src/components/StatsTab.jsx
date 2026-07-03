import React, { useState, useMemo } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, DETAIL_METRICS, detailRanking, battingMetrics, fmtAvg } from '../lib/stats.js';
import GameScopeToggle, { scopedGames } from './GameScopeToggle.jsx';

// 成績・詳細ランキング(10大メトリクス)
export default function StatsTab() {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const [scope, setScope] = useState({ scope: 'season', gameId: null });
  const [metricKey, setMetricKey] = useState('ba');

  const games = scopedGames(state, scope);
  const batting = useMemo(() => aggregateBatting(games), [games]);
  const pitching = useMemo(() => aggregatePitching(games), [games]);

  const metric = DETAIL_METRICS.find((m) => m.key === metricKey);
  const rows = useMemo(() => detailRanking(metric, batting, pitching), [metric, batting, pitching]);

  const batMetrics = DETAIL_METRICS.filter((m) => m.type === 'bat');
  const pitMetrics = DETAIL_METRICS.filter((m) => m.type === 'pit');

  return (
    <div>
      <GameScopeToggle value={scope} onChange={setScope} />

      <div className="section-title">打者メトリクス</div>
      <div className="grid3">
        {batMetrics.map((m) => (
          <button key={m.key} className={`small ${metricKey === m.key ? 'primary' : ''}`} onClick={() => setMetricKey(m.key)}>
            {m.label.split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="section-title">投手メトリクス</div>
      <div className="grid3">
        {pitMetrics.map((m) => (
          <button key={m.key} className={`small ${metricKey === m.key ? 'primary' : ''}`} onClick={() => setMetricKey(m.key)}>
            {m.label.split(' ')[0]}
          </button>
        ))}
      </div>

      <div className="card mt16">
        <h2>{metric.label} ランキング {metric.higherBetter ? '' : '(小さいほど上位)'}</h2>
        {rows.length === 0 ? (
          <div className="dim small">対象データがありません(分母0の選手は「-」扱いで除外)。</div>
        ) : (
          <table className="rank-table">
            <thead>
              <tr>
                <th>順位</th>
                <th>選手</th>
                <th style={{ textAlign: 'right' }}>{metric.label.split(' ')[0]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId}>
                  <td><span className="rank-badge">{r.rank}</span></td>
                  <td>
                    {nameOf(r.playerId)}
                    <div className="dim small">{r.detail}</div>
                  </td>
                  <td className="num">{r.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <BattingSummaryTable batting={batting} nameOf={nameOf} />
    </div>
  );
}

// 全員の打撃基本成績一覧(参考テーブル)
function BattingSummaryTable({ batting, nameOf }) {
  const rows = Object.values(batting)
    .filter((s) => s.pa > 0)
    .sort((a, b) => b.h - a.h);
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h2>打撃成績一覧</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="rank-table" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th>選手</th><th>打席</th><th>打数</th><th>安打</th><th>打率</th>
              <th>本</th><th>点</th><th>四死</th><th>三振</th><th>盗</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const m = battingMetrics(s);
              return (
                <tr key={s.playerId}>
                  <td>{nameOf(s.playerId)}</td>
                  <td className="num">{s.pa}</td>
                  <td className="num">{s.ab}</td>
                  <td className="num">{s.h}</td>
                  <td className="num">{fmtAvg(m.ba)}</td>
                  <td className="num">{s.hr}</td>
                  <td className="num">{s.rbi}</td>
                  <td className="num">{s.bb + s.hbp}</td>
                  <td className="num">{s.so}</td>
                  <td className="num">{s.sb}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

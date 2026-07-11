import React, { useState, useMemo } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, pitchingMetrics, DETAIL_METRICS, detailRanking, battingMetrics, fmtAvg } from '../lib/stats.js';
import { formatIP } from '../lib/model.js';
import GameScopeToggle, { scopedGames } from './GameScopeToggle.jsx';
import PlayerView from './PlayerView.jsx';
import MemberSection from './MemberSection.jsx';
import TitleCards from './TitleCards.jsx';

// 成績・詳細ランキング(10大メトリクス) + 投手成績(旧「投手」タブを統合)
export default function StatsTab() {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const [scope, setScope] = useState({ scope: 'season', gameId: null });
  const [metricKey, setMetricKey] = useState('ba');
  const [playerId, setPlayerId] = useState(null); // 選手個人ページ

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

      {/* タイトルホルダー(👑)。ホームから移設 */}
      <TitleCards games={games} />

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
                <tr key={r.playerId} onClick={() => setPlayerId(r.playerId)} role="button">
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

      <BattingSummaryTable batting={batting} nameOf={nameOf} onOpenPlayer={setPlayerId} />
      <PitchingSummaryTable pitching={pitching} nameOf={nameOf} onOpenPlayer={setPlayerId} />
      <p className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>
        選手名をタップすると個人ページ(スプレーチャート・成績推移・打席履歴)が開きます。
      </p>

      <MemberSection />

      {playerId && <PlayerView playerId={playerId} games={games} onClose={() => setPlayerId(null)} />}
    </div>
  );
}

// 全員の打撃基本成績一覧(参考テーブル)
function BattingSummaryTable({ batting, nameOf, onOpenPlayer }) {
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
                <tr key={s.playerId} onClick={() => onOpenPlayer?.(s.playerId)} role="button">
                  <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{nameOf(s.playerId)}</td>
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

// 全員の投手基本成績一覧(参考テーブル。旧「投手」タブのサマリーを移設)
function PitchingSummaryTable({ pitching, nameOf, onOpenPlayer }) {
  const rows = Object.values(pitching).filter((s) => s.outsRecorded > 0 || s.games > 0);
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h2>投手成績一覧</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="rank-table" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th>投手</th><th>回</th><th>防御率</th><th>被打率</th><th>WHIP</th><th>奪三振</th>
              <th>与四死</th><th>被安</th><th>自責</th><th>勝</th><th>S</th><th>H</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const m = pitchingMetrics(s);
              return (
                <tr key={s.playerId} onClick={() => onOpenPlayer?.(s.playerId)} role="button">
                  <td style={{ color: 'var(--accent)', fontWeight: 700 }}>{nameOf(s.playerId)}</td>
                  <td className="num">{formatIP(s.outsRecorded)}</td>
                  <td className="num">{m.era7 === null ? '-' : m.era7.toFixed(2)}</td>
                  <td className="num">{m.oba === null ? '-' : m.oba.toFixed(3).replace(/^0\./, '.')}</td>
                  <td className="num">{m.whip === null ? '-' : m.whip.toFixed(2)}</td>
                  <td className="num">{s.strikeouts}</td>
                  <td className="num">{s.walks + s.hitByPitch}</td>
                  <td className="num">{s.hitsAllowed}</td>
                  <td className="num">{s.earnedRuns}</td>
                  <td className="num">{s.wins}</td>
                  <td className="num">{s.saves}</td>
                  <td className="num">{s.holds}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

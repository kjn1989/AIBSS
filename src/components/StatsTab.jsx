import React, { useState, useMemo } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, pitchingMetrics, DETAIL_METRICS, detailRanking, battingMetrics, fmtAvg, mLabel } from '../lib/stats.js';
import { formatIP } from '../lib/model.js';
import GameScopeToggle, { scopedGames } from './GameScopeToggle.jsx';
import PlayerView from './PlayerView.jsx';
import MemberSection from './MemberSection.jsx';
import TitleCards from './TitleCards.jsx';

// 成績・詳細ランキング(10大メトリクス) + 投手成績(旧「投手」タブを統合)
export default function StatsTab() {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const statTr = (key) => t(`stat.${key}`);
  const nameOf = usePlayerName();
  const [scope, setScope] = useState({ scope: 'season', gameId: null });
  const [metricKey, setMetricKey] = useState('ba');
  const [playerId, setPlayerId] = useState(null); // 選手個人ページ

  const games = scopedGames(state, scope);
  const batting = useMemo(() => aggregateBatting(games), [games]);
  const pitching = useMemo(() => aggregatePitching(games), [games]);

  const metric = DETAIL_METRICS.find((m) => m.key === metricKey);
  const rows = useMemo(() => detailRanking(metric, batting, pitching, statTr), [metric, batting, pitching, lang]);

  const batMetrics = DETAIL_METRICS.filter((m) => m.type === 'bat');
  const pitMetrics = DETAIL_METRICS.filter((m) => m.type === 'pit');

  return (
    <div>
      <GameScopeToggle value={scope} onChange={setScope} />

      {/* タイトルホルダー(👑)。ホームから移設 */}
      <TitleCards games={games} />

      <div className="section-title">{t('stats.battingMetrics')}</div>
      <div className="grid3">
        {batMetrics.map((m) => (
          <button key={m.key} className={`small ${metricKey === m.key ? 'primary' : ''}`} onClick={() => setMetricKey(m.key)}>
            {mLabel(m, lang).split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="section-title">{t('stats.pitchingMetrics')}</div>
      <div className="grid3">
        {pitMetrics.map((m) => (
          <button key={m.key} className={`small ${metricKey === m.key ? 'primary' : ''}`} onClick={() => setMetricKey(m.key)}>
            {mLabel(m, lang).split(' ')[0]}
          </button>
        ))}
      </div>

      <div className="card mt16">
        <h2>{t('stats.ranking', { label: mLabel(metric, lang) })} {metric.higherBetter ? '' : t('stats.lowerBetter')}</h2>
        {rows.length === 0 ? (
          <div className="dim small">{t('stats.noData')}</div>
        ) : (
          <table className="rank-table">
            <thead>
              <tr>
                <th>{t('stats.rank')}</th>
                <th>{t('stats.player')}</th>
                <th style={{ textAlign: 'right' }}>{mLabel(metric, lang).split(' ')[0]}</th>
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
        {t('stats.tapHint')}
      </p>

      <MemberSection />

      {playerId && <PlayerView playerId={playerId} games={games} onClose={() => setPlayerId(null)} />}
    </div>
  );
}

// 全員の打撃基本成績一覧(参考テーブル)
function BattingSummaryTable({ batting, nameOf, onOpenPlayer }) {
  const t = useT();
  const rows = Object.values(batting)
    .filter((s) => s.pa > 0)
    .sort((a, b) => b.h - a.h);
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h2>{t('stats.battingTable')}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="rank-table" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th>{t('stats.player')}</th><th>{t('stats.col.pa')}</th><th>{t('stats.col.ab')}</th><th>{t('stats.col.h')}</th><th>{t('stats.col.avg')}</th>
              <th>{t('stats.col.hr')}</th><th>{t('stats.col.rbi')}</th><th>{t('stats.col.bbhbp')}</th><th>{t('stats.col.so')}</th><th>{t('stats.col.sb')}</th>
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
  const t = useT();
  const rows = Object.values(pitching).filter((s) => s.outsRecorded > 0 || s.games > 0);
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h2>{t('stats.pitchingTable')}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="rank-table" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th>{t('stats.col.pitcher')}</th><th>{t('stats.col.ip')}</th><th>{t('stats.col.era')}</th><th>{t('stats.col.oba')}</th><th>{t('stats.col.whip')}</th><th>{t('stats.col.k')}</th>
              <th>{t('stats.col.bbhbpP')}</th><th>{t('stats.col.ha')}</th><th>{t('stats.col.er')}</th><th>{t('stats.col.w')}</th><th>{t('stats.col.s')}</th><th>{t('stats.col.hld')}</th>
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

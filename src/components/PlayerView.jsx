import React, { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, battingMetrics, pitchingMetrics, fmtAvg, battingSplits, pitchingSplits, avg3, teamHighlights, recentGames, buildStatsSummary } from '../lib/stats.js';
import { formatIP } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import SprayChart from './SprayChart.jsx';
import TrendChart from './TrendChart.jsx';
import ScoutCard from './ScoutCard.jsx';
import FullscreenView from './FullscreenView.jsx';

// 選手個人ページ: 通算成績・スプレーチャート・成績推移・打席履歴を1画面に集約
export default function PlayerView({ playerId, games, onClose }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const player = state.players.find((p) => p.id === playerId);
  const [showScout, setShowScout] = useState(false);
  // AI選手名鑑は「草野球」エディション限定の機能
  const scoutEnabled = state.settings.edition === '草野球';

  const battingMap = useMemo(() => aggregateBatting(games), [games]);
  const pitchingMap = useMemo(() => aggregatePitching(games), [games]);
  const batting = battingMap[playerId];
  const pitching = pitchingMap[playerId];
  const batSplit = useMemo(() => battingSplits(games)[playerId], [games, playerId]);
  const pitSplit = useMemo(() => pitchingSplits(games)[playerId], [games, playerId]);
  // AI選手名鑑向け: 他の選手と比べて明確に上回っている項目(タイトル・レートスタッツ首位)
  const uniqueFacts = useMemo(
    () => teamHighlights(playerId, battingMap, pitchingMap),
    [playerId, battingMap, pitchingMap]
  );
  // AIコーチの「直近の調子」向け: この選手が出場した直近3試合だけの成績
  const recentSummary = useMemo(() => {
    const playerGames = games.filter(
      (g) => (g.atBats || []).some((ab) => ab.playerId === playerId && ab.result) || (g.pitchingRecords || []).some((r) => r.playerId === playerId)
    );
    const recent = recentGames(playerGames, 3);
    if (recent.length === 0) return '';
    const rb = aggregateBatting(recent)[playerId];
    const rp = aggregatePitching(recent)[playerId];
    const rm = rb ? battingMetrics(rb) : null;
    const rpm = rp ? pitchingMetrics(rp) : null;
    const summary = buildStatsSummary(rb, rp, rm, rpm);
    return summary ? `直近${recent.length}試合 ${summary}` : '';
  }, [games, playerId]);

  // この選手の全打席(試合の古い順 → 各試合内は記録順)
  const atBatsByGame = useMemo(() => {
    const sorted = [...games].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return sorted
      .map((g) => ({ game: g, atBats: (g.atBats || []).filter((ab) => ab.playerId === playerId && ab.result) }))
      .filter((e) => e.atBats.length > 0);
  }, [games, playerId]);
  const allAtBats = atBatsByGame.flatMap((e) => e.atBats);

  const m = batting ? battingMetrics(batting) : null;
  const pm = pitching ? pitchingMetrics(pitching) : null;

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>{t('action.back')}</button>
        <h2>{player?.name || t('pv.playerFallback')}{player?.number ? ` #${player.number}` : ''}</h2>
        {scoutEnabled ? (
          <button className="ghost small" onClick={() => setShowScout(true)}>{t('pv.profileBtn')}</button>
        ) : (
          <span style={{ width: 60 }} />
        )}
      </header>
      <div className="fullscreen-body">
        <h1 className="player-page-name">{player?.name || t('pv.playerFallback')}{player?.number ? ` #${player.number}` : ''}</h1>
        {(player?.throws || player?.bats) && (
          <div className="dim small" style={{ marginTop: -6, marginBottom: 8 }}>
            {player?.throws ? t('pv.throwsHand', { h: t(`hand.${player.throws}`) }) : ''}{player?.throws && player?.bats ? t('pv.handSep') : ''}{player?.bats ? t('pv.batsHand', { h: t(`hand.${player.bats}`) }) : ''}
          </div>
        )}
        {batting ? (
          <div className="card">
            <h2>{t('pv.batting')} <span className="dim small">{t('pv.gamesCount', { n: atBatsByGame.length })}</span></h2>
            <div className="player-stat-grid">
              <div><div className="dim small">{t('pv.avg')}</div><b>{fmtAvg(m.ba)}</b></div>
              <div><div className="dim small">{t('pv.obp')}</div><b>{fmtAvg(m.obp)}</b></div>
              <div><div className="dim small">{t('pv.ops')}</div><b>{m.ops === null ? '-' : m.ops.toFixed(3)}</b></div>
              <div><div className="dim small">{t('pv.paAb')}</div><b>{batting.pa}/{batting.ab}</b></div>
              <div><div className="dim small">{t('pv.hits')}</div><b>{batting.h}</b></div>
              <div><div className="dim small">{t('pv.hr')}</div><b>{batting.hr}</b></div>
              <div><div className="dim small">{t('pv.rbi')}</div><b>{batting.rbi}</b></div>
              <div><div className="dim small">{t('pv.runs')}</div><b>{batting.runs}</b></div>
              <div><div className="dim small">{t('pv.sb')}</div><b>{batting.sb}</b></div>
              <div><div className="dim small">{t('pv.bbhbp')}</div><b>{batting.bb + batting.hbp}</b></div>
              <div><div className="dim small">{t('pv.so')}</div><b>{batting.so}</b></div>
              <div><div className="dim small">{t('pv.risp')}</div><b>{fmtAvg(m.risp)}</b></div>
            </div>
          </div>
        ) : (
          <div className="big-note">{t('pv.noAtBats')}</div>
        )}

        {pm && (pitching.outsRecorded > 0 || pitching.games > 0) && (
          <div className="card">
            <h2>{t('pv.pitching')}</h2>
            <div className="player-stat-grid">
              <div><div className="dim small">{t('pv.ip')}</div><b>{formatIP(pitching.outsRecorded)}</b></div>
              <div><div className="dim small">{t('pv.era')}</div><b>{pm.era7 === null ? '-' : pm.era7.toFixed(2)}</b></div>
              <div><div className="dim small">{t('pv.k')}</div><b>{pitching.strikeouts}</b></div>
              <div><div className="dim small">{t('pv.whip')}</div><b>{pm.whip === null ? '-' : pm.whip.toFixed(2)}</b></div>
              <div><div className="dim small">{t('pv.wsh')}</div><b>{pitching.wins}/{pitching.saves}/{pitching.holds}</b></div>
              <div><div className="dim small">{t('pv.er')}</div><b>{pitching.earnedRuns}</b></div>
            </div>
          </div>
        )}

        {batSplit && (batSplit.R.pa > 0 || batSplit.L.pa > 0) && (
          <div className="card">
            <h2>{t('pv.batSplit')}</h2>
            <table className="split-table">
              <thead><tr><th></th><th>{t('pv.hAvg')}</th><th>{t('pv.hPa')}</th><th>{t('pv.hAb')}</th><th>{t('pv.hH')}</th><th>{t('pv.hHr')}</th><th>{t('pv.hBbhbp')}</th><th>{t('pv.hSo')}</th></tr></thead>
              <tbody>
                {[[t('pv.vsLHP'), batSplit.L], [t('pv.vsRHP'), batSplit.R]].map(([lbl, s]) => (
                  <tr key={lbl}><td className="sp-lbl">{lbl}</td><td><b>{avg3(s.h, s.ab) ?? '-'}</b></td><td>{s.pa}</td><td>{s.ab}</td><td>{s.h}</td><td>{s.hr}</td><td>{s.bb}</td><td>{s.so}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="small dim mt8">{t('pv.batSplitNote')}</p>
          </div>
        )}

        {pitSplit && (pitSplit.R.bf > 0 || pitSplit.L.bf > 0) && (
          <div className="card">
            <h2>{t('pv.pitSplit')}</h2>
            <table className="split-table">
              <thead><tr><th></th><th>{t('pv.pOba')}</th><th>{t('pv.pBf')}</th><th>{t('pv.pH')}</th><th>{t('pv.pHr')}</th><th>{t('pv.pK')}</th><th>{t('pv.pBbhbp')}</th></tr></thead>
              <tbody>
                {[[t('pv.vsLHB'), pitSplit.L], [t('pv.vsRHB'), pitSplit.R]].map(([lbl, s]) => (
                  <tr key={lbl}><td className="sp-lbl">{lbl}</td><td><b>{avg3(s.h, s.ab) ?? '-'}</b></td><td>{s.bf}</td><td>{s.h}</td><td>{s.hr}</td><td>{s.so}</td><td>{s.bb}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="small dim mt8">{t('pv.pitSplitNote')}</p>
          </div>
        )}

        {allAtBats.length > 0 && <SprayChart atBats={allAtBats} />}
        <TrendChart games={games} playerId={playerId} />

        {atBatsByGame.length > 0 && (
          <div className="card">
            <h2>{t('pv.atBatHistory')}</h2>
            {atBatsByGame.map(({ game, atBats }) => (
              <div key={game.id} style={{ marginBottom: 10 }}>
                <div className="small dim" style={{ padding: '4px 0', fontWeight: 700 }}>
                  {game.date} vs {game.opponent || t('restab.opponentFallback')}
                </div>
                <div className="atbat-history">
                  {atBats.map((ab, i) => (
                    <span className="hist-chip" key={ab.id}>
                      {i + 1}. {playLabel(ab.result, ab.direction, ab.outType, ab.soType, state.settings.edition, lang)}
                      {ab.rbi > 0 && <b style={{ color: 'var(--gold)' }}>{t('pv.rbiSuffix', { n: ab.rbi })}</b>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {scoutEnabled && showScout && (
        <ScoutCard
          player={player}
          batting={batting}
          pitching={pitching}
          battingM={m}
          pitchingM={pm}
          uniqueFacts={uniqueFacts}
          recentSummary={recentSummary}
          onClose={() => setShowScout(false)}
        />
      )}
    </FullscreenView>
  );
}

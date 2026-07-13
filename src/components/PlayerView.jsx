import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, battingMetrics, pitchingMetrics, fmtAvg, battingSplits, pitchingSplits, avg3 } from '../lib/stats.js';
import { formatIP, HAND_LABEL } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import SprayChart from './SprayChart.jsx';
import TrendChart from './TrendChart.jsx';
import ScoutCard from './ScoutCard.jsx';
import FullscreenView from './FullscreenView.jsx';

// 選手個人ページ: 通算成績・スプレーチャート・成績推移・打席履歴を1画面に集約
export default function PlayerView({ playerId, games, onClose }) {
  const { state } = useStore();
  const player = state.players.find((p) => p.id === playerId);
  const [showScout, setShowScout] = useState(false);
  // AI選手名鑑は「草野球」エディション限定の機能
  const scoutEnabled = state.settings.edition === '草野球';

  const batting = useMemo(() => aggregateBatting(games)[playerId], [games, playerId]);
  const pitching = useMemo(() => aggregatePitching(games)[playerId], [games, playerId]);
  const batSplit = useMemo(() => battingSplits(games)[playerId], [games, playerId]);
  const pitSplit = useMemo(() => pitchingSplits(games)[playerId], [games, playerId]);

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
        <button className="ghost small" onClick={onClose}>← 戻る</button>
        <h2>{player?.name || '選手'}{player?.number ? ` #${player.number}` : ''}</h2>
        {scoutEnabled ? (
          <button className="ghost small" onClick={() => setShowScout(true)}>📇 名鑑</button>
        ) : (
          <span style={{ width: 60 }} />
        )}
      </header>
      <div className="fullscreen-body">
        <h1 className="player-page-name">{player?.name || '選手'}{player?.number ? ` #${player.number}` : ''}</h1>
        {(player?.throws || player?.bats) && (
          <div className="dim small" style={{ marginTop: -6, marginBottom: 8 }}>
            {player?.throws ? `投${HAND_LABEL[player.throws]}` : ''}{player?.throws && player?.bats ? '・' : ''}{player?.bats ? `打${HAND_LABEL[player.bats]}` : ''}
          </div>
        )}
        {batting ? (
          <div className="card">
            <h2>打撃成績 <span className="dim small">({atBatsByGame.length}試合)</span></h2>
            <div className="player-stat-grid">
              <div><div className="dim small">打率</div><b>{fmtAvg(m.ba)}</b></div>
              <div><div className="dim small">出塁率</div><b>{fmtAvg(m.obp)}</b></div>
              <div><div className="dim small">OPS</div><b>{m.ops === null ? '-' : m.ops.toFixed(3)}</b></div>
              <div><div className="dim small">打席/打数</div><b>{batting.pa}/{batting.ab}</b></div>
              <div><div className="dim small">安打</div><b>{batting.h}</b></div>
              <div><div className="dim small">本塁打</div><b>{batting.hr}</b></div>
              <div><div className="dim small">打点</div><b>{batting.rbi}</b></div>
              <div><div className="dim small">得点</div><b>{batting.runs}</b></div>
              <div><div className="dim small">盗塁</div><b>{batting.sb}</b></div>
              <div><div className="dim small">四死球</div><b>{batting.bb + batting.hbp}</b></div>
              <div><div className="dim small">三振</div><b>{batting.so}</b></div>
              <div><div className="dim small">得点圏</div><b>{fmtAvg(m.risp)}</b></div>
            </div>
          </div>
        ) : (
          <div className="big-note">まだ打席記録がありません。</div>
        )}

        {pm && (pitching.outsRecorded > 0 || pitching.games > 0) && (
          <div className="card">
            <h2>投手成績</h2>
            <div className="player-stat-grid">
              <div><div className="dim small">投球回</div><b>{formatIP(pitching.outsRecorded)}</b></div>
              <div><div className="dim small">防御率</div><b>{pm.era7 === null ? '-' : pm.era7.toFixed(2)}</b></div>
              <div><div className="dim small">奪三振</div><b>{pitching.strikeouts}</b></div>
              <div><div className="dim small">WHIP</div><b>{pm.whip === null ? '-' : pm.whip.toFixed(2)}</b></div>
              <div><div className="dim small">勝/S/H</div><b>{pitching.wins}/{pitching.saves}/{pitching.holds}</b></div>
              <div><div className="dim small">自責点</div><b>{pitching.earnedRuns}</b></div>
            </div>
          </div>
        )}

        {batSplit && (batSplit.R.pa > 0 || batSplit.L.pa > 0) && (
          <div className="card">
            <h2>左右別打撃(対戦投手の左右)</h2>
            <table className="split-table">
              <thead><tr><th></th><th>打率</th><th>打席</th><th>打数</th><th>安打</th><th>本</th><th>四死</th><th>三振</th></tr></thead>
              <tbody>
                {[['対左投手', batSplit.L], ['対右投手', batSplit.R]].map(([lbl, s]) => (
                  <tr key={lbl}><td className="sp-lbl">{lbl}</td><td><b>{avg3(s.h, s.ab) ?? '-'}</b></td><td>{s.pa}</td><td>{s.ab}</td><td>{s.h}</td><td>{s.hr}</td><td>{s.bb}</td><td>{s.so}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="small dim mt8">相手投手の左右を記録した打席のみ集計(スコア入力の相手投手欄で設定)。</p>
          </div>
        )}

        {pitSplit && (pitSplit.R.bf > 0 || pitSplit.L.bf > 0) && (
          <div className="card">
            <h2>左右別投球(対戦打者の左右)</h2>
            <table className="split-table">
              <thead><tr><th></th><th>被打率</th><th>対戦</th><th>被安</th><th>被本</th><th>奪三振</th><th>与四死</th></tr></thead>
              <tbody>
                {[['対左打者', pitSplit.L], ['対右打者', pitSplit.R]].map(([lbl, s]) => (
                  <tr key={lbl}><td className="sp-lbl">{lbl}</td><td><b>{avg3(s.h, s.ab) ?? '-'}</b></td><td>{s.bf}</td><td>{s.h}</td><td>{s.hr}</td><td>{s.so}</td><td>{s.bb}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="small dim mt8">相手打者の左右を記録した対戦のみ集計(スコア入力の相手打者欄で設定)。</p>
          </div>
        )}

        {allAtBats.length > 0 && <SprayChart atBats={allAtBats} />}
        <TrendChart games={games} playerId={playerId} />

        {atBatsByGame.length > 0 && (
          <div className="card">
            <h2>打席履歴</h2>
            {atBatsByGame.map(({ game, atBats }) => (
              <div key={game.id} style={{ marginBottom: 10 }}>
                <div className="small dim" style={{ padding: '4px 0', fontWeight: 700 }}>
                  {game.date} vs {game.opponent || '対戦相手'}
                </div>
                <div className="atbat-history">
                  {atBats.map((ab, i) => (
                    <span className="hist-chip" key={ab.id}>
                      {i + 1}. {playLabel(ab.result, ab.direction, ab.outType, ab.soType)}
                      {ab.rbi > 0 && <b style={{ color: 'var(--gold)' }}> {ab.rbi}打点</b>}
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
          onClose={() => setShowScout(false)}
        />
      )}
    </FullscreenView>
  );
}

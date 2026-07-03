import React, { useState, useMemo } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, BATTING_TITLES, PITCHING_TITLES, titleLeaders } from '../lib/stats.js';
import GameScopeToggle, { scopedGames } from './GameScopeToggle.jsx';

function TitleCard({ crown, label, leaders, display, nameOf, pitcher }) {
  return (
    <div className={`title-card${pitcher ? ' pitcher' : ''}`}>
      <div className="crown">👑 {crown}</div>
      {leaders.length === 0 ? (
        <div className="none">記録なし</div>
      ) : (
        <>
          <div className={`holder${leaders.length > 1 ? ' multi' : ''}`}>
            {leaders.map((id) => `${nameOf(id)}さん`).join('・')}
          </div>
          <div>
            <span className="value">{display}</span>
            <span className="unit">{label}</span>
          </div>
        </>
      )}
    </div>
  );
}

export default function HomeTab() {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const [scope, setScope] = useState({ scope: 'season', gameId: null });

  const games = scopedGames(state, scope);
  const batting = useMemo(() => aggregateBatting(games), [games]);
  const pitching = useMemo(() => aggregatePitching(games), [games]);

  const hasData = Object.keys(state.games).length > 0;

  return (
    <div>
      <GameScopeToggle value={scope} onChange={setScope} />

      {!hasData && (
        <div className="big-note">
          まだ試合データがありません。<br />
          ⚙️ 設定 →「デモデータを投入」で表示を確認するか、<br />
          「スコア入力」タブから試合を始めましょう。
        </div>
      )}

      {hasData && (
        <>
          <div className="section-title">打者タイトル</div>
          <div className="title-grid">
            {BATTING_TITLES.map((t) => {
              const { leaders, display } = titleLeaders(batting, t.key);
              return <TitleCard key={t.key} crown={t.crown} label={t.label} leaders={leaders} display={display} nameOf={nameOf} />;
            })}
          </div>

          <div className="section-title">投手タイトル</div>
          <div className="title-grid">
            {PITCHING_TITLES.map((t) => {
              const { leaders, display } = titleLeaders(pitching, t.key);
              return (
                <TitleCard key={t.key} crown={t.crown} label={t.label === '投球回' ? '回' : t.label} leaders={leaders} display={display} nameOf={nameOf} pitcher />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

import React, { useMemo } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, BATTING_TITLES, PITCHING_TITLES, titleLeaders } from '../lib/stats.js';

// タイトルホルダー(👑安打王等)のカード群。ホームから成績タブへ移設した。
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

export default function TitleCards({ games }) {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const batting = useMemo(() => aggregateBatting(games), [games]);
  const pitching = useMemo(() => aggregatePitching(games), [games]);
  if (Object.keys(state.games).length === 0) return null;

  return (
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
  );
}

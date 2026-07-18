import React, { useMemo } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, BATTING_TITLES, PITCHING_TITLES, titleLeaders, mLabel, mCrown } from '../lib/stats.js';

// タイトルホルダー(👑安打王等)のカード群。ホームから成績タブへ移設した。
function TitleCard({ crown, label, leaders, display, nameOf, pitcher }) {
  const t = useT();
  const honorific = t('stats.honorific');
  return (
    <div className={`title-card${pitcher ? ' pitcher' : ''}`}>
      <div className="crown">👑 {crown}</div>
      {leaders.length === 0 ? (
        <div className="none">{t('stats.noRecord')}</div>
      ) : (
        <>
          <div className={`holder${leaders.length > 1 ? ' multi' : ''}`}>
            {leaders.map((id) => `${nameOf(id)}${honorific}`).join('・')}
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
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const batting = useMemo(() => aggregateBatting(games), [games]);
  const pitching = useMemo(() => aggregatePitching(games), [games]);
  if (Object.keys(state.games).length === 0) return null;

  return (
    <>
      <div className="section-title">{t('stats.battingTitles')}</div>
      <div className="title-grid">
        {BATTING_TITLES.map((ti) => {
          const { leaders, display } = titleLeaders(batting, ti.key);
          return <TitleCard key={ti.key} crown={mCrown(ti, lang)} label={mLabel(ti, lang)} leaders={leaders} display={display} nameOf={nameOf} />;
        })}
      </div>

      <div className="section-title">{t('stats.pitchingTitles')}</div>
      <div className="title-grid">
        {PITCHING_TITLES.map((ti) => {
          const { leaders, display } = titleLeaders(pitching, ti.key);
          const unit = ti.key === 'ip' && lang === 'ja' ? '回' : mLabel(ti, lang);
          return (
            <TitleCard key={ti.key} crown={mCrown(ti, lang)} label={unit} leaders={leaders} display={display} nameOf={nameOf} pitcher />
          );
        })}
      </div>
    </>
  );
}

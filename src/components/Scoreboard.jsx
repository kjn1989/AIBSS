import React from 'react';
import { useStore, useT, isMyTeamBatting } from '../state/store.jsx';

export default function Scoreboard({ game }) {
  const { state } = useStore();
  const t = useT();
  const my = state.settings.teamName || t('scoreboard.you');
  const opp = game.opponent || t('scoreboard.opponent');
  const batting = isMyTeamBatting(game);

  return (
    <div className="scoreboard">
      <div className="team">
        <div className="name">{game.isHome ? opp : my} {game.isTop && '🡄'}</div>
        <div className="score">{game.isHome ? game.oppScore : game.myScore}</div>
      </div>
      <div className="mid">
        <div className="inning">
          {game.rules && game.inning > game.rules.innings && t('scoreboard.extra')}
          {t(game.isTop ? 'scoreboard.top' : 'scoreboard.bottom', { n: game.inning })}
        </div>
        <div className="small dim">
          {batting ? t('scoreboard.batting') : t('scoreboard.fielding')}
          {game.rules ? `・${game.rules.innings}${t('scoreboard.innings')}` : ''}
        </div>
        <div className="outs">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`out-dot${game.outs > i ? ' on' : ''}`} />
          ))}
        </div>
      </div>
      <div className="team">
        <div className="name">{game.isHome ? my : opp} {!game.isTop && '🡄'}</div>
        <div className="score">{game.isHome ? game.myScore : game.oppScore}</div>
      </div>
    </div>
  );
}

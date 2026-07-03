import React from 'react';
import { useStore, isMyTeamBatting } from '../state/store.jsx';

export default function Scoreboard({ game }) {
  const { state } = useStore();
  const my = state.settings.teamName || '自チーム';
  const opp = game.opponent || '相手';
  const batting = isMyTeamBatting(game);

  return (
    <div className="scoreboard">
      <div className="team">
        <div className="name">{game.isHome ? opp : my} {game.isTop && '🡄'}</div>
        <div className="score">{game.isHome ? game.oppScore : game.myScore}</div>
      </div>
      <div className="mid">
        <div className="inning">
          {game.inning}回{game.isTop ? '表' : '裏'}
        </div>
        <div className="small dim">{batting ? '⚔️ 攻撃中' : '🧤 守備中'}</div>
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

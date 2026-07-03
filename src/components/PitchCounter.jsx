import React from 'react';
import { useStore } from '../state/store.jsx';

// 投球カウンター: B/S/ファウルのタップ記録。
// 初球結果と総投球数は pending.pitches に蓄積され、打席確定時に保存される。
// (PPA・初球安打率の算出に必須)
export default function PitchCounter({ game }) {
  const { dispatch } = useStore();
  const pitches = game.pending?.pitches || [];
  const balls = pitches.filter((p) => p.type === 'ball').length;
  const strikes = pitches.filter((p) => p.type === 'strike').length;
  const fouls = pitches.filter((p) => p.type === 'foul').length;

  // カウント表示: ボールは3、ストライクはファウル込みで2を上限に表示
  const dispB = Math.min(balls, 3);
  const dispS = Math.min(strikes + fouls, 2);
  const firstLabel = { ball: 'ボール', strike: 'ストライク', foul: 'ファウル' }[pitches[0]?.type];

  const add = (pitchType) => dispatch({ type: 'ADD_PITCH', gameId: game.id, pitchType });

  return (
    <div className="card">
      <div className="count-display">
        <span className="bs b">B {dispB}</span>
        <span className="bs s">S {dispS}</span>
        <span className="pitches">
          {pitches.length}球{firstLabel ? ` (初球:${firstLabel})` : ''}
        </span>
      </div>
      <div className="count-btns">
        <button className="ball" onClick={() => add('ball')}>ボール</button>
        <button className="strike" onClick={() => add('strike')}>ストライク</button>
        <button className="foul" onClick={() => add('foul')}>ファウル</button>
      </div>
      {pitches.length > 0 && (
        <button className="ghost small mt8" onClick={() => dispatch({ type: 'REMOVE_LAST_PITCH', gameId: game.id })}>
          ↩ 1球取り消し
        </button>
      )}
    </div>
  );
}

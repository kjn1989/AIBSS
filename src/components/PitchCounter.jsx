import React from 'react';
import { useStore, useT } from '../state/store.jsx';

// 投球カウンター: B/S/ファウルのタップ記録。
// 初球結果と総投球数は pending.pitches に蓄積され、打席確定時に保存される。
// (PPA・初球安打率の算出に必須)
// 2ストライク後のストライク→三振、3ボール後のボール→四球を自動判定して
// onAutoEvent('so' | 'bb') で親に通知する。
export default function PitchCounter({ game, onAutoEvent }) {
  const { dispatch } = useStore();
  const t = useT();
  const pitches = game.pending?.pitches || [];
  const balls = pitches.filter((p) => p.type === 'ball').length;
  const strikes = pitches.filter((p) => p.type === 'strike').length;
  const fouls = pitches.filter((p) => p.type === 'foul').length;

  // カウント表示: ボールは3、ストライクはファウル込みで2を上限に表示
  const dispB = Math.min(balls, 3);
  const dispS = Math.min(strikes + fouls, 2);
  const firstKey = { ball: 'pitch.ball', strike: 'pitch.strike', foul: 'pitch.foul' }[pitches[0]?.type];

  const add = (pitchType, sub = null) => {
    dispatch({ type: 'ADD_PITCH', gameId: game.id, pitchType, sub });
    // 自動判定: 3球目のストライク=三振 / 4球目のボール=四球
    // 三振時は押したボタン(見逃し/空振り)を三振種別として引き継ぐ
    if (pitchType === 'strike' && dispS >= 2) onAutoEvent?.('so', sub === 'looking' ? 'looking' : 'swinging');
    else if (pitchType === 'ball' && dispB >= 3) onAutoEvent?.('bb');
  };

  return (
    <div className="card">
      <div className="count-display">
        <span className="bs b">B {dispB}</span>
        <span className="bs s">S {dispS}</span>
        <span className="pitches">
          {t('pitch.count.thisAtBat', { n: pitches.length })}
          {firstKey ? t('pitch.count.first', { label: t(firstKey) }) : ''}
        </span>
      </div>
      {(dispS === 2 || dispB === 3) && (
        <div className="center small dim" style={{ marginBottom: 8 }}>
          {dispS === 2 && <span className="pill amber" style={{ marginRight: 6 }}>{t('pitch.nextStrikeSo')}</span>}
          {dispB === 3 && <span className="pill green">{t('pitch.nextBallBb')}</span>}
        </div>
      )}
      {/* 左=ボール(縦長) / 中央=二段(上:空振り 下:見逃し) / 右=ファウル(縦長) */}
      <div className="count-btns pitch3">
        <button className="ball" onClick={() => add('ball')}>{t('pitch.ball')}</button>
        <button className="strike swing" onClick={() => add('strike', 'swinging')}>{t('pitch.swinging')}</button>
        <button className="strike look" onClick={() => add('strike', 'looking')}>{t('pitch.looking')}</button>
        <button className="foul" onClick={() => add('foul')}>{t('pitch.foul')}</button>
      </div>
      {pitches.length > 0 && (
        <button className="ghost small mt8" onClick={() => dispatch({ type: 'REMOVE_LAST_PITCH', gameId: game.id })}>
          {t('pitch.undo')}
        </button>
      )}
    </div>
  );
}

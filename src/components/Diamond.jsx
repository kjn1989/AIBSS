import React from 'react';
import { usePlayerName } from '../state/store.jsx';

// 走者ダイヤモンド: TV中継風フィールドの上に塁を配置。
// 塁タップで走者イベントシートを開く。クラス名(.base.b1等)はE2E互換のため維持。
export default function Diamond({ game, onBaseTap }) {
  const nameOf = usePlayerName();

  const label = (base) => {
    const r = game.runners[base];
    if (!r) return base === 1 ? '一塁' : base === 2 ? '二塁' : '三塁';
    return r.playerId ? nameOf(r.playerId) : '走者';
  };

  return (
    <div className="field-diamond bf">
      <div className="bf-dirtfan" />
      <div className="bf-mound" />
      <div className="bf-line left" />
      <div className="bf-line right" />
      <div className="bf-basepath" />
      {[2, 3, 1].map((b) => (
        <div
          key={b}
          className={`base b${b}${game.runners[b] ? ' occupied' : ''}`}
          onClick={() => onBaseTap?.(b)}
          role="button"
        >
          <span>{label(b)}</span>
        </div>
      ))}
      <div className="base home">
        <span>本塁</span>
      </div>
    </div>
  );
}

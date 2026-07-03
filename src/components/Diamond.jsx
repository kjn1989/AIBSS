import React from 'react';
import { usePlayerName } from '../state/store.jsx';

// 走者ダイヤモンド表示。塁タップで走者イベントシートを開く。
export default function Diamond({ game, onBaseTap }) {
  const nameOf = usePlayerName();

  const label = (base) => {
    const r = game.runners[base];
    if (!r) return base === 1 ? '一塁' : base === 2 ? '二塁' : '三塁';
    return r.playerId ? nameOf(r.playerId) : '走者';
  };

  return (
    <div className="diamond-wrap">
      <div className="diamond">
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
    </div>
  );
}

import React from 'react';
import { useStore } from '../state/store.jsx';

// 「試合単位 / シーズン通算」トグル + 試合選択
// value: { scope: 'season'|'game', gameId }
export default function GameScopeToggle({ value, onChange }) {
  const { state } = useStore();
  const games = Object.values(state.games).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <>
      <div className="toggle-row">
        <button className={value.scope === 'season' ? 'active' : ''} onClick={() => onChange({ ...value, scope: 'season' })}>
          シーズン通算
        </button>
        <button
          className={value.scope === 'game' ? 'active' : ''}
          onClick={() => onChange({ scope: 'game', gameId: value.gameId || games[0]?.id || null })}
        >
          試合単位
        </button>
      </div>
      {value.scope === 'game' && (
        <div style={{ marginBottom: 14 }}>
          <select value={value.gameId || ''} onChange={(e) => onChange({ ...value, gameId: e.target.value })}>
            {games.length === 0 && <option value="">試合がありません</option>}
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.date} vs {g.opponent || '対戦相手'} ({g.myScore}-{g.oppScore})
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

// スコープに応じた試合配列を返すユーティリティ
export function scopedGames(state, value) {
  const all = Object.values(state.games);
  if (value.scope === 'game') {
    const g = value.gameId ? state.games[value.gameId] : null;
    return g ? [g] : [];
  }
  return all;
}

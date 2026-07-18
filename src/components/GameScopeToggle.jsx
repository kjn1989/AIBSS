import React from 'react';
import { useStore, useT } from '../state/store.jsx';

// 「試合単位 / シーズン通算」トグル + 試合選択 + シーズン/大会フィルタ
// value: { scope: 'season'|'game', gameId, season }
export default function GameScopeToggle({ value, onChange }) {
  const { state } = useStore();
  const t = useT();
  const games = Object.values(state.games).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const seasons = [...new Set(games.map((g) => g.season).filter(Boolean))];

  return (
    <>
      <div className="toggle-row">
        <button className={value.scope === 'season' ? 'active' : ''} onClick={() => onChange({ ...value, scope: 'season' })}>
          {t('gamescope.total')}
        </button>
        <button
          className={value.scope === 'game' ? 'active' : ''}
          onClick={() => onChange({ ...value, scope: 'game', gameId: value.gameId || games[0]?.id || null })}
        >
          {t('gamescope.perGame')}
        </button>
      </div>
      {value.scope === 'season' && seasons.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <select value={value.season || ''} onChange={(e) => onChange({ ...value, season: e.target.value })}>
            <option value="">{t('gamescope.allSeasons')}</option>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
      {value.scope === 'game' && (
        <div style={{ marginBottom: 14 }}>
          <select value={value.gameId || ''} onChange={(e) => onChange({ ...value, gameId: e.target.value })}>
            {games.length === 0 && <option value="">{t('gamescope.noGames')}</option>}
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.date} vs {g.opponent || t('restab.opponentFallback')} ({g.myScore}-{g.oppScore}){g.season ? ` [${g.season}]` : ''}
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
  // 通算: シーズン/大会が指定されていればそのシーズンのみに絞る
  if (value.season) return all.filter((g) => g.season === value.season);
  return all;
}

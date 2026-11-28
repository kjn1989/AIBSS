import React from 'react';
import { useStore, useT } from '../state/store.jsx';
import { yearsInGames, labelOfYear, resolveYear, scopedGames, DEFAULT_YEAR_START_MONTH } from '../lib/year.js';
import { tournaments as listTournaments } from '../lib/tournament.js';
import TournamentSummary from './TournamentSummary.jsx';

// 取り込み側の変更を減らすため、集計ユーティリティはここからも再輸出する
export { scopedGames, resolveYear };

// 集計の範囲を選ぶトグル。
// value: { scope: 'year'|'game'|'tournament'|'total', gameId, year, season, tournament }
//
// 並びは 年度 → 試合 → 通算。左端が既定なので、開いた直後に見えるのは常に
// 「今年のチーム」になる。通算を既定にすると、初手で卒業生の混ざった一覧が
// 出てしまうため。通算はいちばん右(過去の果て)に置く。
export default function GameScopeToggle({ value, onChange }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const startMonth = state.settings.yearStartMonth || DEFAULT_YEAR_START_MONTH;
  const games = Object.values(state.games).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const years = yearsInGames(games, startMonth);
  const seasons = [...new Set(games.map((g) => g.season).filter(Boolean))];
  const curYear = resolveYear(games, value, startMonth);
  // 2試合以上ある大会(「AABC2026 初戦」「AABC2026 第2戦」…は AABC2026 にまとまる)
  const tours = listTournaments(games.filter((g) => !String(g.id).startsWith('demo-')));

  return (
    <>
      <div className="toggle-row">
        <button
          className={value.scope === 'year' ? 'active' : ''}
          onClick={() => onChange({ ...value, scope: 'year', year: curYear ?? null })}
        >
          {curYear != null && value.scope === 'year' ? labelOfYear(curYear, state.settings) : t('gamescope.year')}
        </button>
        <button
          className={value.scope === 'game' ? 'active' : ''}
          onClick={() => onChange({ ...value, scope: 'game', gameId: value.gameId || games[0]?.id || null })}
        >
          {t('gamescope.perGame')}
        </button>
        {tours.length > 0 && (
          <button
            className={value.scope === 'tournament' ? 'active' : ''}
            onClick={() => onChange({ ...value, scope: 'tournament', tournament: value.tournament || tours[0].name })}
          >
            {t('gamescope.tournament')}
          </button>
        )}
        <button className={value.scope === 'total' ? 'active' : ''} onClick={() => onChange({ ...value, scope: 'total' })}>
          {t('gamescope.total')}
        </button>
      </div>

      {value.scope === 'year' && years.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <select value={curYear ?? ''} onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}>
            {years.map((y) => <option key={y} value={y}>{labelOfYear(y, state.settings)}</option>)}
          </select>
        </div>
      )}
      {/* 大会/シーズン名は年度の中の区分。年度を選んでいるときだけ二次フィルタとして出す */}
      {value.scope === 'year' && seasons.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <select value={value.season || ''} onChange={(e) => onChange({ ...value, season: e.target.value })}>
            <option value="">{t('gamescope.allSeasons')}</option>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
      {value.scope === 'tournament' && (
        <div style={{ marginBottom: 14 }}>
          <select value={value.tournament || ''} onChange={(e) => onChange({ ...value, tournament: e.target.value })}>
            {tours.map((x) => <option key={x.name} value={x.name}>{t('gamescope.tourOpt', { name: x.name, n: x.games.length })}</option>)}
          </select>
          <TournamentSummary games={tours.find((x) => x.name === value.tournament)?.games || []} />
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

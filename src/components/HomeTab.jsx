import React from 'react';
import { useStore, useT } from '../state/store.jsx';

// ホーム: 「いま何をすればいいか」が一目で分かる入口に徹する。
// - 進行中の試合があれば最優先で「試合に戻る」
// - なければ「新しい試合を開始」
// - 直近の結果と通算成績をひと目で、詳細は各タブへの大きな導線で
// ランキング(タイトル)は成績タブへ、CSV取り込みは試合結果タブへ移設した。
export default function HomeTab({ onNavigate }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const games = Object.values(state.games);
  const ongoing = games
    .filter((g) => g.status === 'ongoing')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const finished = games
    .filter((g) => g.status === 'finished')
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
  const firstRun = state.players.length === 0 && games.length === 0;
  const live = ongoing[0];

  let w = 0, l = 0, d = 0;
  for (const g of finished) {
    if (g.myScore > g.oppScore) w += 1;
    else if (g.myScore < g.oppScore) l += 1;
    else d += 1;
  }

  const resultPill = (g) =>
    g.myScore > g.oppScore ? <span className="pill green">{t('home.w')}</span>
      : g.myScore < g.oppScore ? <span className="pill red">{t('home.l')}</span>
        : <span className="pill">{t('home.d')}</span>;

  const openGame = (g, tab) => {
    dispatch({ type: 'SELECT_GAME', id: g.id });
    onNavigate?.(tab);
  };

  return (
    <div>
      {/* 最優先アクション: 試合に戻る or 試合を始める */}
      {live ? (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="flex">
            <span className="pill blue">{t('home.live')}</span>
            <span className="grow small dim">{live.date} vs {live.opponent || t('restab.opponentFallback')}</span>
          </div>
          <div className="hl-final" style={{ fontSize: 34, textAlign: 'center', margin: '8px 0' }}>
            {live.myScore} - {live.oppScore}
            <span className="small dim" style={{ marginLeft: 10 }}>
              {live.rules && live.inning > live.rules.innings ? t('home.extra') : ''}{t(live.isTop ? 'scoreboard.top' : 'scoreboard.bottom', { n: live.inning })}
            </span>
          </div>
          <button
            className="primary"
            style={{ width: '100%', minHeight: 56, fontSize: 18 }}
            onClick={() => openGame(live, 'score')}
          >
            {t('home.resume')}
          </button>
        </div>
      ) : (
        <div className="card">
          <button
            className="primary"
            style={{ width: '100%', minHeight: 64, fontSize: 19 }}
            onClick={() => onNavigate?.('score')}
          >
            {t('home.newGame')}
          </button>
          {state.players.length === 0 && (
            <p className="small dim mt8" style={{ textAlign: 'center' }}>
              {t('home.registerHint')}
              <button className="small" onClick={() => onNavigate?.('settings')}>{t('home.registerBtn')}</button>
            </p>
          )}
        </div>
      )}

      {/* はじめての方向け: 3ステップ+デモ */}
      {firstRun && (
        <div className="card">
          <h2>{t('home.firstTime')}</h2>
          <div className="row"><span className="rank-badge">1</span><span className="grow">{t('home.step1pre')}<b>{t('home.step1b')}</b>{t('home.step1post')}</span></div>
          <div className="row"><span className="rank-badge">2</span><span className="grow">{t('home.step2pre')}<b>{t('home.step2b')}</b>{t('home.step2post')}</span></div>
          <div className="row"><span className="rank-badge">3</span><span className="grow">{t('home.step3pre')}<b>{t('home.step3b')}</b>{t('home.step3post')}</span></div>
          <button className="mt12" style={{ width: '100%' }} onClick={() => dispatch({ type: 'LOAD_DEMO' })}>
            {t('home.demo')}
          </button>
        </div>
      )}

      {/* 通算成績サマリー */}
      {finished.length > 0 && (
        <div className="card">
          <div className="flex">
            <h2 className="grow" style={{ marginBottom: 0 }}>{t('home.record')}</h2>
            <span style={{ fontSize: 22, fontWeight: 800 }}>
              {w}<span className="small dim">{t('home.w')}</span> {l}<span className="small dim">{t('home.l')}</span>{d > 0 && <> {d}<span className="small dim">{t('home.d')}</span></>}
            </span>
          </div>
        </div>
      )}

      {/* 直近の試合 */}
      {finished.length > 0 && (
        <div className="card">
          <h2>{t('home.recent')}</h2>
          {finished.slice(0, 3).map((g) => (
            <div className="row" key={g.id} role="button" onClick={() => openGame(g, 'result')}>
              <div className="grow">
                <b>vs {g.opponent || t('restab.opponentFallback')}</b>
                <div className="dim small">{g.date}{g.season ? ` ・${g.season}` : ''}</div>
              </div>
              <span style={{ fontWeight: 800, marginRight: 6 }}>{g.myScore} - {g.oppScore}</span>
              {resultPill(g)}
            </div>
          ))}
        </div>
      )}

      {/* 主要機能への大きな導線 */}
      {games.length > 0 && (
        <div className="grid2">
          <button style={{ minHeight: 56 }} onClick={() => onNavigate?.('stats')}>{t('home.navStats')}</button>
          <button style={{ minHeight: 56 }} onClick={() => onNavigate?.('result')}>{t('home.navResults')}</button>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { useStore } from '../state/store.jsx';

// ホーム: 「いま何をすればいいか」が一目で分かる入口に徹する。
// - 進行中の試合があれば最優先で「試合に戻る」
// - なければ「新しい試合を開始」
// - 直近の結果と通算成績をひと目で、詳細は各タブへの大きな導線で
// ランキング(タイトル)は成績タブへ、CSV取り込みは試合結果タブへ移設した。
export default function HomeTab({ onNavigate }) {
  const { state, dispatch } = useStore();
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
    g.myScore > g.oppScore ? <span className="pill green">勝</span>
      : g.myScore < g.oppScore ? <span className="pill red">敗</span>
        : <span className="pill">分</span>;

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
            <span className="pill blue">試合中</span>
            <span className="grow small dim">{live.date} vs {live.opponent || '対戦相手'}</span>
          </div>
          <div className="hl-final" style={{ fontSize: 34, textAlign: 'center', margin: '8px 0' }}>
            {live.myScore} - {live.oppScore}
            <span className="small dim" style={{ marginLeft: 10 }}>
              {live.rules && live.inning > live.rules.innings ? '延長' : ''}{live.inning}回{live.isTop ? '表' : '裏'}
            </span>
          </div>
          <button
            className="primary"
            style={{ width: '100%', minHeight: 56, fontSize: 18 }}
            onClick={() => openGame(live, 'score')}
          >
            ▶ 試合に戻る
          </button>
        </div>
      ) : (
        <div className="card">
          <button
            className="primary"
            style={{ width: '100%', minHeight: 64, fontSize: 19 }}
            onClick={() => onNavigate?.('score')}
          >
            ⚾ 新しい試合を開始
          </button>
          {state.players.length === 0 && (
            <p className="small dim mt8" style={{ textAlign: 'center' }}>
              まずは選手を登録しましょう →{' '}
              <button className="small" onClick={() => onNavigate?.('settings')}>⚙️ 選手を登録する</button>
            </p>
          )}
        </div>
      )}

      {/* はじめての方向け: 3ステップ+デモ */}
      {firstRun && (
        <div className="card">
          <h2>はじめての方へ</h2>
          <div className="row"><span className="rank-badge">1</span><span className="grow">⚙️ 設定タブで<b>選手を登録</b>(名前だけでOK)</span></div>
          <div className="row"><span className="rank-badge">2</span><span className="grow">⚾ 上のボタンから<b>試合を開始</b></span></div>
          <div className="row"><span className="rank-badge">3</span><span className="grow">👆 タップ(または🎤音声)で<b>プレイを記録</b>。成績は自動集計</span></div>
          <button className="mt12" style={{ width: '100%' }} onClick={() => dispatch({ type: 'LOAD_DEMO' })}>
            🎮 まずはデモデータで試してみる
          </button>
        </div>
      )}

      {/* 通算成績サマリー */}
      {finished.length > 0 && (
        <div className="card">
          <div className="flex">
            <h2 className="grow" style={{ marginBottom: 0 }}>これまでの成績</h2>
            <span style={{ fontSize: 22, fontWeight: 800 }}>
              {w}<span className="small dim">勝</span> {l}<span className="small dim">敗</span>{d > 0 && <> {d}<span className="small dim">分</span></>}
            </span>
          </div>
        </div>
      )}

      {/* 直近の試合 */}
      {finished.length > 0 && (
        <div className="card">
          <h2>最近の試合</h2>
          {finished.slice(0, 3).map((g) => (
            <div className="row" key={g.id} role="button" onClick={() => openGame(g, 'result')}>
              <div className="grow">
                <b>vs {g.opponent || '対戦相手'}</b>
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
          <button style={{ minHeight: 56 }} onClick={() => onNavigate?.('stats')}>📊 成績・ランキング</button>
          <button style={{ minHeight: 56 }} onClick={() => onNavigate?.('result')}>🏟️ 試合結果・レポート</button>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { computeHighlights, highlightShareText } from '../lib/highlights.js';
import { GameProgressContent } from './GameProgressView.jsx';

// 試合レポート(ハイライト)カード。HighlightSheetと同じ内容をタブ内に埋め込む形で表示
function HighlightCard({ game }) {
  const nameOf = usePlayerName();
  const h = computeHighlights(game, nameOf);
  const shareText = highlightShareText(game, h);
  const empty = !h.clutch && !h.topBatter && !h.topPitcher && h.extraBaseHits.length === 0;

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: '試合ハイライト', text: shareText });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      window.alert('ハイライトをコピーしました。SNSやLINEに貼り付けて共有できます。');
    } catch {
      window.prompt('コピーしてSNS等に貼り付けてください:', shareText);
    }
  };

  return (
    <div className="highlight-card">
      <div className="hl-score">
        <span className="hl-vs">{game.date} vs {game.opponent || '対戦相手'}</span>
        <div className="hl-final">{game.myScore} - {game.oppScore}</div>
        <span className={`pill ${h.resultLabel === '勝利' ? 'green' : h.resultLabel === '敗北' ? 'red' : ''}`}>
          {h.resultLabel}
        </span>
      </div>

      {h.clutch && (
        <div className="hl-row">
          <div className="hl-label">🔥 決勝・勝ち越し打</div>
          <div className="hl-body">{h.clutch.label}</div>
        </div>
      )}
      {h.topBatter && (
        <div className="hl-row">
          <div className="hl-label">🏅 MVP</div>
          <div className="hl-body">
            {h.topBatter.name}({h.topBatter.h}安打 {h.topBatter.rbi}打点{h.topBatter.hr ? ` ${h.topBatter.hr}本塁打` : ''})
          </div>
        </div>
      )}
      {h.topPitcher && (
        <div className="hl-row">
          <div className="hl-label">💪 {h.topPitcher.tag}</div>
          <div className="hl-body">{h.topPitcher.name} {h.topPitcher.line}</div>
        </div>
      )}
      {h.extraBaseHits.length > 0 && (
        <div className="hl-row">
          <div className="hl-label">⚡ 見どころ</div>
          {h.extraBaseHits.map((t, i) => <div className="hl-body" key={i}>{t}</div>)}
        </div>
      )}
      {empty && <p className="small dim">まだ見どころになる記録がありません。</p>}

      <button className="primary mt12" style={{ width: '100%' }} onClick={share}>📤 共有</button>
    </div>
  );
}

export default function ResultTab() {
  const { state } = useStore();
  const games = Object.values(state.games)
    .filter((g) => !g.id.startsWith('demo-'))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const [gameId, setGameId] = useState(state.currentGameId || games[0]?.id || '');
  const game = state.games[gameId] || games[0];

  if (!game) {
    return <div className="big-note">まだ試合データがありません。「スコア入力」タブから試合を始めましょう。</div>;
  }

  return (
    <div>
      <div className="card">
        <label className="small dim">試合を選択</label>
        <select value={game.id} onChange={(e) => setGameId(e.target.value)}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.date} vs {g.opponent || '対戦相手'} ({g.myScore}-{g.oppScore}){g.status === 'ongoing' ? ' 進行中' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="section-title">試合レポート</div>
      <HighlightCard game={game} />

      <div className="section-title">試合経過</div>
      <GameProgressContent game={game} />
    </div>
  );
}

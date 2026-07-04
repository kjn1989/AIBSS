import React, { useState } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { computeHighlights, highlightShareText } from '../lib/highlights.js';
import { shareHighlightImage } from '../lib/shareImage.js';
import { GameProgressContent } from './GameProgressView.jsx';
import { PitchingGameManagement } from './PitchingTab.jsx';
import ScoreSheetView from './ScoreSheetView.jsx';
import NewspaperView from './NewspaperView.jsx';

// 試合レポート(ハイライト)カード。HighlightSheetと同じ内容をタブ内に埋め込む形で表示
function HighlightCard({ game }) {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const h = computeHighlights(game, nameOf);
  const shareText = highlightShareText(game, h);
  const teamName = state.settings.teamName || 'マイチーム';
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

      <div className="grid2 mt12">
        <button className="primary" onClick={share}>📤 テキスト共有</button>
        <button onClick={() => shareHighlightImage(game, h, teamName)}>🖼 画像で共有</button>
      </div>
    </div>
  );
}

export default function ResultTab() {
  const { state, dispatch } = useStore();
  const [showSheet, setShowSheet] = useState(false);
  const [showNewspaper, setShowNewspaper] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const games = Object.values(state.games)
    .filter((g) => !g.id.startsWith('demo-'))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const [gameId, setGameId] = useState(state.currentGameId || games[0]?.id || '');
  const game = state.games[gameId] || games[0];
  const knownSeasons = [...new Set(games.map((g) => g.season).filter(Boolean))];

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
              {g.date} vs {g.opponent || '対戦相手'} ({g.myScore}-{g.oppScore}){g.season ? ` [${g.season}]` : ''}{g.status === 'ongoing' ? ' 進行中' : ''}
            </option>
          ))}
        </select>
        <div className="flex mt8">
          <span className="grow small dim">
            {game.season ? `📅 ${game.season}` : 'シーズン/大会 未設定'}
          </span>
          <button className="small" onClick={() => setEditMeta((v) => !v)}>{editMeta ? '閉じる' : '試合情報を編集'}</button>
        </div>
        {editMeta && (
          <div className="mt8">
            <label className="small dim">対戦相手</label>
            <input
              value={game.opponent || ''}
              onChange={(e) => dispatch({ type: 'UPDATE_GAME_META', id: game.id, patch: { opponent: e.target.value } })}
            />
            <label className="small dim mt8" style={{ display: 'block' }}>日付</label>
            <input
              type="date"
              value={game.date || ''}
              onChange={(e) => dispatch({ type: 'UPDATE_GAME_META', id: game.id, patch: { date: e.target.value } })}
            />
            <label className="small dim mt8" style={{ display: 'block' }}>シーズン/大会名</label>
            <input
              value={game.season || ''}
              onChange={(e) => dispatch({ type: 'UPDATE_GAME_META', id: game.id, patch: { season: e.target.value } })}
              placeholder="例: 2026春季大会"
              list="season-suggest-result"
            />
            {knownSeasons.length > 0 && (
              <datalist id="season-suggest-result">
                {knownSeasons.map((s) => <option key={s} value={s} />)}
              </datalist>
            )}
            <button
              className="ghost danger mt12"
              style={{ width: '100%' }}
              onClick={() => {
                if (!window.confirm(`この試合(${game.date} vs ${game.opponent || '対戦相手'})を削除しますか？\nこの操作は取り消せません。`)) return;
                dispatch({ type: 'DELETE_GAME', id: game.id });
                setEditMeta(false);
                const remaining = Object.values(state.games).filter((g) => g.id !== game.id && !g.id.startsWith('demo-'));
                setGameId(remaining[0]?.id || '');
              }}
            >
              🗑 この試合を削除
            </button>
          </div>
        )}
        <button className="mt8" style={{ width: '100%' }} onClick={() => setShowSheet(true)}>
          🖨 スコアシート(印刷用)を開く
        </button>
      </div>

      <div className="section-title">試合レポート</div>
      <HighlightCard game={game} />
      <button className="mt12" style={{ width: '100%' }} onClick={() => setShowNewspaper(true)}>
        📰 AIスポーツ新聞を作る
      </button>

      <div className="section-title">試合経過</div>
      <GameProgressContent game={game} editable />

      {game.status === 'ongoing' && game.id === state.currentGameId && (
        <>
          <div className="section-title">登板・継投</div>
          <PitchingGameManagement game={game} />
        </>
      )}

      {showSheet && <ScoreSheetView game={game} onClose={() => setShowSheet(false)} />}
      {showNewspaper && <NewspaperView game={game} onClose={() => setShowNewspaper(false)} />}
    </div>
  );
}

import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { computeHighlights, highlightShareText } from '../lib/highlights.js';
import { shareHighlightImage } from '../lib/shareImage.js';
import { GameProgressContent } from './GameProgressView.jsx';
import { PitchingGameManagement } from './PitchingTab.jsx';
import ScoreSheetView from './ScoreSheetView.jsx';
import NewspaperView from './NewspaperView.jsx';
import ImportCsvView from './ImportCsvView.jsx';

// 過去試合のCSV取り込み(ホームから移設): 紙のスコアブック等を成績に取り込む入口
function ImportCard() {
  const t = useT();
  const [showImport, setShowImport] = useState(false);
  return (
    <div className="card">
      <h2>{t('restab.importTitle')}</h2>
      <p className="small dim" style={{ marginBottom: 8 }}>
        {t('restab.importDesc')}
      </p>
      <button style={{ width: '100%' }} onClick={() => setShowImport(true)}>
        {t('restab.importBtn')}
      </button>
      {showImport && <ImportCsvView onClose={() => setShowImport(false)} />}
    </div>
  );
}

// 試合レポート(ハイライト)カード。HighlightSheetと同じ内容をタブ内に埋め込む形で表示
function HighlightCard({ game }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const h = computeHighlights(game, nameOf);
  const shareText = highlightShareText(game, h);
  const teamName = state.settings.teamName || t('restab.teamFallback');
  const empty = !h.clutch && !h.topBatter && !h.topPitcher && h.extraBaseHits.length === 0;
  // resultLabel は highlights.js が返す日本語データ。色分けの判定はその値で行い、表示だけ翻訳する。
  const wlKey = { 勝利: 'restab.win', 敗北: 'restab.lose', 引き分け: 'restab.draw' }[h.resultLabel];

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: t('restab.shareTitle'), text: shareText });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      window.alert(t('restab.copied'));
    } catch {
      window.prompt(t('restab.copyPrompt'), shareText);
    }
  };

  return (
    <div className="highlight-card">
      <div className="hl-score">
        <span className="hl-vs">{game.date} vs {game.opponent || t('restab.opponentFallback')}</span>
        <div className="hl-final">{game.myScore} - {game.oppScore}</div>
        <span className={`pill ${h.resultLabel === '勝利' ? 'green' : h.resultLabel === '敗北' ? 'red' : ''}`}>
          {wlKey ? t(wlKey) : h.resultLabel}
        </span>
      </div>

      {h.clutch && (
        <div className="hl-row">
          <div className="hl-label">{t('restab.clutchLabel')}</div>
          <div className="hl-body">{h.clutch.label}</div>
        </div>
      )}
      {h.topBatter && (
        <div className="hl-row">
          <div className="hl-label">{t('restab.mvp')}</div>
          <div className="hl-body">
            {t('restab.mvpLine', {
              name: h.topBatter.name, h: h.topBatter.h, rbi: h.topBatter.rbi,
              hr: h.topBatter.hr ? t('restab.mvpHr', { hr: h.topBatter.hr }) : '',
            })}
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
          <div className="hl-label">{t('restab.highlights')}</div>
          {h.extraBaseHits.map((x, i) => <div className="hl-body" key={i}>{x}</div>)}
        </div>
      )}
      {empty && <p className="small dim">{t('restab.noHighlights')}</p>}

      <div className="grid2 mt12">
        <button className="primary" onClick={share}>{t('restab.shareText')}</button>
        <button onClick={() => shareHighlightImage(game, h, teamName)}>{t('restab.shareImage')}</button>
      </div>
    </div>
  );
}

export default function ResultTab() {
  const { state, dispatch } = useStore();
  const t = useT();
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
    return (
      <div>
        <div className="big-note">{t('restab.noGames')}</div>
        <ImportCard />
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <label className="small dim">{t('restab.selectGame')}</label>
        <select value={game.id} onChange={(e) => setGameId(e.target.value)}>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.date} vs {g.opponent || t('restab.opponentFallback')} ({g.myScore}-{g.oppScore}){g.season ? ` [${g.season}]` : ''}{g.status === 'ongoing' ? t('restab.ongoing') : ''}
            </option>
          ))}
        </select>
        <div className="flex mt8">
          <span className="grow small dim">
            {game.season ? `📅 ${game.season}` : t('restab.seasonUnset')}
          </span>
          <button className="small" onClick={() => setEditMeta((v) => !v)}>{editMeta ? t('action.close') : t('restab.editMeta')}</button>
        </div>
        {editMeta && (
          <div className="mt8">
            <label className="small dim">{t('gamesetup.opponent')}</label>
            <input
              value={game.opponent || ''}
              onChange={(e) => dispatch({ type: 'UPDATE_GAME_META', id: game.id, patch: { opponent: e.target.value } })}
            />
            <label className="small dim mt8" style={{ display: 'block' }}>{t('restab.date')}</label>
            <input
              type="date"
              value={game.date || ''}
              onChange={(e) => dispatch({ type: 'UPDATE_GAME_META', id: game.id, patch: { date: e.target.value } })}
            />
            <label className="small dim mt8" style={{ display: 'block' }}>{t('restab.seasonName')}</label>
            <input
              value={game.season || ''}
              onChange={(e) => dispatch({ type: 'UPDATE_GAME_META', id: game.id, patch: { season: e.target.value } })}
              placeholder={t('gamesetup.season.placeholder')}
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
                if (!window.confirm(t('restab.deleteGameConfirm', { date: game.date, opp: game.opponent || t('restab.opponentFallback') }))) return;
                dispatch({ type: 'DELETE_GAME', id: game.id });
                setEditMeta(false);
                const remaining = Object.values(state.games).filter((g) => g.id !== game.id && !g.id.startsWith('demo-'));
                setGameId(remaining[0]?.id || '');
              }}
            >
              {t('restab.deleteGame')}
            </button>
          </div>
        )}
        <button className="mt8" style={{ width: '100%' }} onClick={() => setShowSheet(true)}>
          {t('restab.openSheet')}
        </button>
      </div>

      <div className="section-title">{t('restab.report')}</div>
      <HighlightCard game={game} />
      <button className="mt12" style={{ width: '100%' }} onClick={() => setShowNewspaper(true)}>
        {t('restab.makeNewspaper')}
      </button>

      <div className="section-title">{t('restab.progress')}</div>
      <GameProgressContent game={game} editable />

      {game.status === 'ongoing' && game.id === state.currentGameId && (
        <>
          <div className="section-title">{t('restab.pitching')}</div>
          <PitchingGameManagement game={game} />
        </>
      )}

      <ImportCard />

      {showSheet && <ScoreSheetView game={game} onClose={() => setShowSheet(false)} />}
      {showNewspaper && <NewspaperView game={game} onClose={() => setShowNewspaper(false)} />}
    </div>
  );
}

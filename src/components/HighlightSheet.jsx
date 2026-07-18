import React from 'react';
import Sheet from './Sheet.jsx';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { computeHighlights, highlightShareText } from '../lib/highlights.js';
import { shareHighlightImage } from '../lib/shareImage.js';

// 試合ハイライト: 決勝打・好投・MVP・見どころを自動要約し、SNS共有できるカード
export default function HighlightSheet({ game, onClose }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const h = computeHighlights(game, nameOf);
  const shareText = highlightShareText(game, h);
  const teamName = state.settings.teamName || t('restab.teamFallback');
  const empty = !h.clutch && !h.topBatter && !h.topPitcher && h.extraBaseHits.length === 0;
  const wlKey = { 勝利: 'restab.win', 敗北: 'restab.lose', 引き分け: 'restab.draw' }[h.resultLabel];

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: t('restab.shareTitle'), text: shareText });
        return;
      } catch {
        return; // ユーザーがキャンセルした場合は何もしない
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
    <Sheet title={t('restab.hlSheetTitle')} onClose={onClose}>
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
            {h.extraBaseHits.map((x, i) => (
              <div className="hl-body" key={i}>{x}</div>
            ))}
          </div>
        )}

        {empty && <p className="small dim">{t('restab.noHighlightsLong')}</p>}
      </div>

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.close')}</button>
        <button onClick={() => shareHighlightImage(game, h, teamName)}>{t('restab.imageBtn')}</button>
        <button className="primary" onClick={share}>{t('restab.shareShort')}</button>
      </div>
    </Sheet>
  );
}

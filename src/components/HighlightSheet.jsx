import React from 'react';
import Sheet from './Sheet.jsx';
import { usePlayerName } from '../state/store.jsx';
import { computeHighlights, highlightShareText } from '../lib/highlights.js';

// 試合ハイライト: 決勝打・好投・MVP・見どころを自動要約し、SNS共有できるカード
export default function HighlightSheet({ game, onClose }) {
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
        return; // ユーザーがキャンセルした場合は何もしない
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
    <Sheet title="🏆 試合ハイライト" onClose={onClose}>
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
            {h.extraBaseHits.map((t, i) => (
              <div className="hl-body" key={i}>{t}</div>
            ))}
          </div>
        )}

        {empty && <p className="small dim">まだ見どころになる記録がありません。試合が進むと自動で表示されます。</p>}
      </div>

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>閉じる</button>
        <button className="primary" onClick={share}>📤 共有</button>
      </div>
    </Sheet>
  );
}

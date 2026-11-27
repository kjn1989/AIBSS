import React, { useState } from 'react';
import { useStore, useT, usePlayerName } from '../state/store.jsx';
import Scoreboard from './Scoreboard.jsx';
import Diamond from './Diamond.jsx';
import ScoreSheetView from './ScoreSheetView.jsx';
import CurrentBatter from './CurrentBatter.jsx';
import { CheerStrip, CheerCounts, useCheerByLog } from './Cheer.jsx';
import { BatonConflict, BatonLocked } from './BatonPanel.jsx';
import { renderPlayLog } from '../lib/playLogText.js';

// 別の端末が記録中のときの画面(この端末は見るだけ)。
// 観戦リンクのページと同じ見た目(ダイヤモンド・スコアシート・試合経過)を既定にし、
// 従来の短い一覧にも切り替えられる。選んだ表示はこの端末に覚えておく。
const KEY = 'bbscorer.lockedView';
const read = () => { try { return localStorage.getItem(KEY) === 'list' ? 'list' : 'watch'; } catch { return 'watch'; } };

export default function LockedView({ game }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const lang = state.settings.lang || 'ja';
  const [mode, setMode] = useState(read);
  const [sheetOpen, setSheetOpen] = useState(false);
  const cheerByLog = useCheerByLog(game.id);
  const pick = (m) => { setMode(m); try { localStorage.setItem(KEY, m); } catch { /* 覚えられなくても動く */ } };
  const watch = mode === 'watch';
  const logs = [...game.playLogs].filter((l) => l.kind !== 'run').slice(watch ? -15 : -10).reverse();
  const inn = (l) => t('score.logInning', { inning: l.inning, half: t(l.isTop ? 'half.top' : 'half.bottom') });

  return (
    <div>
      <div className="grid2" role="group" aria-label={t('locked.viewTitle')} style={{ marginBottom: 8 }}>
        <button type="button" className={watch ? 'primary' : ''} aria-pressed={watch} onClick={() => pick('watch')}>{t('locked.viewWatch')}</button>
        <button type="button" className={!watch ? 'primary' : ''} aria-pressed={!watch} onClick={() => pick('list')}>{t('locked.viewList')}</button>
      </div>
      <Scoreboard game={game} />
      <BatonConflict game={game} />
      <BatonLocked game={game} compact={watch} />
      <CheerStrip game={game} />
      {watch && (
        <>
          <Diamond game={game} onBaseTap={() => {}} />
          <CurrentBatter game={game} />
          <button className="live-sheet-btn" onClick={() => setSheetOpen(true)}>{t('live.scoresheet')}</button>
        </>
      )}
      <div className="card">
        <h2>{t(watch ? 'watch.playLog' : 'restab.progress')}</h2>
        {logs.map((l) => (
          <div className="log-line" key={l.id}>
            <b>{inn(l)}</b> {renderPlayLog(game, l, { lang, t, nameOf, edition: state.settings.edition })}
            <CheerCounts m={cheerByLog?.[l.id]} />
          </div>
        ))}
        {game.playLogs.length === 0 && <div className="dim small">{t('score.noPlays')}</div>}
      </div>
      {sheetOpen && <ScoreSheetView game={game} readOnly onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

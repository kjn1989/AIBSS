import { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, NEEDS_DIRECTION, SIMPLE_DIR_ROWS, SIMPLE_RESULTS, OUTFIELD_DIRS, resultLabelOf } from '../lib/model.js';
import Sheet from './Sheet.jsx';

// かんたん記録の「直す」。あとでチームメイトに聞いて、結果と守備位置だけ入れ直せればよい。
//  - 結果を押す → (必要なら)守備位置を押す → 保存
//  - 「不明」で飛ばした打席には、ここで結果を入れる
//  - アウト・走者・得点はここでは動かさない(必要なら「得点を直す」)
export default function SimpleEditSheet({ game, log, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const p = log.payload || {};
  const isSkip = log.kind === 'skip';
  const [result, setResult] = useState(isSkip ? null : p.result);
  const [direction, setDirection] = useState(p.direction || null);
  const needsDir = result && NEEDS_DIRECTION.includes(result);

  const who = isSkip
    ? (p.mine ? nameOf(p.playerId) : (game.oppNames?.[p.letter] || p.letter))
    : (log.kind === 'atbat' ? nameOf(p.playerId) : (game.oppNames?.[p.letter] || p.letter));

  const pickDir = (k) => setDirection(direction === k ? null : k);
  const save = () => {
    const outType = result === 'out'
      ? (p.outType && p.outType !== 'ground' && p.outType !== 'fly' ? p.outType : (OUTFIELD_DIRS.includes(direction) ? 'fly' : 'ground'))
      : null;
    if (isSkip) {
      dispatch({ type: 'FILL_SKIP', gameId: game.id, logId: log.id, result, direction: needsDir ? direction : null, outType,
        batterName: p.mine ? nameOf(p.playerId) : '' });
    } else {
      dispatch({ type: 'EDIT_PLAY_LOG', gameId: game.id, logId: log.id,
        patch: { result, direction: needsDir ? direction : null, outType: result === 'out' ? outType : null,
          soType: result === 'so' ? (p.soType || null) : null, hitAngle: null, hitDepth: null, contact: null } });
    }
    onClose();
  };
  const remove = () => {
    if (!window.confirm(t('gp.deleteConfirm'))) return;
    dispatch({ type: 'DELETE_PLAY_LOG', gameId: game.id, logId: log.id });
    onClose();
  };

  return (
    <Sheet title={t('sedit.title', { name: who, n: p.order ?? '' })} onClose={onClose}>
      {isSkip && <p className="small dim" style={{ marginTop: 0 }}>{t('sedit.skipNote')}</p>}
      <div className="section-title" style={{ marginTop: 0 }}>{t('gp.result')}</div>
      <div className="grid3">
        {SIMPLE_RESULTS.map((k) => (
          <button key={k} className={`small ${result === k ? 'primary' : ''}`} aria-pressed={result === k} onClick={() => setResult(k)}>
            {lang === 'ja' ? RESULTS[k].label : t(`result.${k}`)}
          </button>
        ))}
      </div>
      {needsDir && (
        <>
          <div className="section-title">{t('playsheet.direction')}</div>
          <div className="simple-dir">
            {SIMPLE_DIR_ROWS.map((row, i) => (
              <div key={i} className="simple-dir-row">
                {row.map((k) => (
                  <button key={k} type="button" className={direction === k ? 'primary' : ''} aria-pressed={direction === k} onClick={() => pickDir(k)}>
                    {lang === 'ja' ? DIRECTIONS[k] : t(`dir.${k}`)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      <p className="small dim mt8">{t('sedit.note')}</p>
      {!isSkip && <button className="ghost danger mt8" style={{ width: '100%' }} onClick={remove}>{t('gp.deletePlay')}</button>}
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" disabled={!result} onClick={save}>{t('action.save')}</button>
      </div>
    </Sheet>
  );
}

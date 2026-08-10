import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { formatIP } from '../lib/model.js';
import { rebuildPitchingStats } from '../lib/pitchingRebuild.js';
import { oppPitchingStats, oppNameOf } from '../lib/oppBox.js';
import Sheet from './Sheet.jsx';

// ---- 投手成績を直す ----
// 投球回は「継投がどの打者の後に入っているか」で決まる。数字だけ手で直しても、
// 継投の位置が違えば再計算のたびにまたズレる。だから記録から計算した値を並べ、
// 原因である「回の流れ」へ行けるようにしてある。
//
// ただし、手で直しているということは「記録の方が足りない/違う」と人が判断したということ。
// そこへ「記録から振り直す」を大きく出すのは、その判断を否定する誘導になる。
// 記録どおりのときは何も勧めず、手で決めた値はその判断を優先すると言い切り、
// 戻す道は主ボタンの下に薄く置くだけにする。

const OWN_FIELDS = [
  { k: 'outsRecorded', n: 'pf.ip', ip: true },
  { k: 'runs', n: 'pf.runs' },
  { k: 'earnedRuns', n: 'pf.er' },
  { k: 'hitsAllowed', n: 'pf.h' },
  { k: 'walks', n: 'pf.bb' },
  { k: 'hitByPitch', n: 'pf.hbp' },
  { k: 'strikeouts', n: 'pf.k' },
  { k: 'pitches', n: 'pf.pitches' },
];
const OPP_FIELDS = [
  { k: 'outs', n: 'pf.ip', ip: true },
  { k: 'runs', n: 'pf.runs' },
  { k: 'h', n: 'pf.h' },
  { k: 'bb', n: 'pf.bb' },
  { k: 'hbp', n: 'pf.hbp' },
  { k: 'k', n: 'pf.k' },
  { k: 'pitches', n: 'pf.pitches' },
];

export default function PitchingFixSheet({ game, side, id, onClose, onOpenFlow }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const isOpp = side === 'opp';
  const fields = isOpp ? OPP_FIELDS : OWN_FIELDS;

  // 記録から計算した値。手で直した値と必ず並べて見せる
  const auto = isOpp
    ? (oppPitchingStats(game).find((r) => r.letter === id) || {})
    : (rebuildPitchingStats(game).records.find((r) => r.playerId === id) || {});
  const stored = isOpp
    ? { ...(oppPitchingStats(game).find((r) => r.letter === id) || {}), ...((game.oppPitchingFix || {})[id] || {}) }
    : ((game.pitchingRecords || []).find((r) => r.playerId === id) || {});

  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const f of fields) d[f.k] = Number(stored[f.k] || 0);
    return d;
  });
  const [touched, setTouched] = useState(false);

  const fmt = (f, v) => (f.ip ? formatIP(v) : String(v));
  const diffs = fields.filter((f) => draft[f.k] !== Number(auto[f.k] || 0));
  const same = diffs.length === 0;
  // 保存済みの上書きがあるか(手で決めた値かどうかの判断に使う)
  const hasFix = isOpp
    ? !!(game.oppPitchingFix || {})[id]
    : fields.some((f) => Number(stored[f.k] || 0) !== Number(auto[f.k] || 0));
  const manual = touched || hasFix;

  const label = isOpp ? oppNameOf(game, id) : nameOf(id);

  // その投手が絡む継投がある回。投球回のズレはそこで起きている
  const changeInnings = [...new Set(
    (game.playLogs || [])
      .filter((l) => (isOpp
        ? l.kind === 'opppitcher' && (l.payload?.in === id || l.payload?.out === id)
        : (l.kind === 'pitcher' || (l.kind === 'sub' && l.payload?.position === '投'))
          && (l.payload?.in === id || l.payload?.out === id)))
      .map((l) => Number(l.inning)),
  )].filter(Boolean).sort((a, b) => a - b);

  const bump = (f, d) => {
    setTouched(true);
    setDraft((prev) => ({ ...prev, [f.k]: Math.max(0, (prev[f.k] || 0) + d) }));
  };

  const revert = () => {
    if (isOpp) dispatch({ type: 'ADJUST_OPP_PITCHING', gameId: game.id, letter: id, patch: {} });
    else dispatch({ type: 'RECOMPUTE_PITCHING', gameId: game.id });
    onClose();
  };

  const save = () => {
    const patch = {};
    for (const f of diffs) patch[f.k] = draft[f.k];
    if (isOpp) {
      dispatch({ type: 'ADJUST_OPP_PITCHING', gameId: game.id, letter: id, patch });
    } else if (stored.id) {
      const full = {};
      for (const f of fields) full[f.k] = draft[f.k];
      dispatch({ type: 'ADJUST_PITCHING', gameId: game.id, recordId: stored.id, patch: full });
    }
    onClose();
  };

  return (
    <Sheet title={t('pf.title')} onClose={onClose}>
      <p className="small dim" style={{ margin: '0 0 12px' }}>{isOpp ? `${t('pf.opp')} ` : ''}{label}</p>

      <div className={`pf-box${same ? '' : ' pf-manual'}`}>
        {same ? (
          <>
            <b>{t('pf.asRecorded')}</b>
            {t('pf.asRecordedBody', { ip: formatIP(Number(auto[fields[0].k] || 0)) })}
          </>
        ) : manual ? (
          <>
            <b>{t('pf.manualTitle')}</b>
            <div className="pf-diff">
              {diffs.map((f) => (
                <div key={f.k}>
                  {t(f.n)} {fmt(f, draft[f.k])} <i>{t('pf.recordedWas', { v: fmt(f, Number(auto[f.k] || 0)) })}</i>
                </div>
              ))}
            </div>
            {t('pf.manualBody')}
          </>
        ) : (
          <>
            <b>{t('pf.gapTitle')}</b>
            <div className="pf-diff">
              {diffs.map((f) => (
                <div key={f.k}>
                  {t(f.n)} {fmt(f, draft[f.k])} <i>{t('pf.recordedWas', { v: fmt(f, Number(auto[f.k] || 0)) })}</i>
                </div>
              ))}
            </div>
            {t('pf.gapBody')}
            <button className="primary small mt8" style={{ width: '100%' }} onClick={revert}>{t('pf.rebuild')}</button>
          </>
        )}
      </div>

      <div className="section-title">{t('pf.byHand')}</div>
      {fields.map((f) => (
        <div key={f.k} className="pf-field">
          <span>{t(f.n)}</span>
          <div className="stepper">
            <button onClick={() => bump(f, -1)}>−</button>
            <span className="val">{fmt(f, draft[f.k])}</span>
            <button onClick={() => bump(f, 1)}>＋</button>
          </div>
        </div>
      ))}

      {changeInnings.length > 0 && (
        <div className="pf-jump">
          <span>{t('pf.checkTiming')}{isOpp ? t('pf.oppNote') : ''}</span>
          <div className="chips-row">
            {changeInnings.map((n) => (
              <button key={n} className="small" onClick={() => onOpenFlow(n)}>
                {t('pf.openFlow', { n })}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={save}>{manual && !same ? t('pf.applyMine') : t('action.save')}</button>
      </div>
      {manual && !same && (
        <button className="pf-undo" onClick={revert}>{t('pf.backToRecord')}</button>
      )}
    </Sheet>
  );
}

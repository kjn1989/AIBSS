import React from 'react';
import { useT } from '../state/store.jsx';
import { TEAM_GAPS } from '../lib/teamGap.js';

// ---- 相手との力の差を選ぶ ----
// 「得点期待値を0.85倍」ではなく「10回やって何回勝てる相手か」で入れる。
// 記録員が試合前に答えられるのはこちらだし、勝率で入れれば倍率は計算で出る。
//
// 名前だけだと強弱の順が読めないので、副題の「10回中◯回」を必ず併記する。
// 「格下」のような語を避けているのは、少年野球で保護者が画面を見るため。
export default function TeamGapPicker({ value, onChange, compact = false }) {
  const t = useT();
  const cur = value || 'even';

  return (
    <div className={`gap-pick${compact ? ' compact' : ''}`}>
      {!compact && <p className="small dim">{t('gap.lead')}</p>}
      <div className="gap-row">
        {TEAM_GAPS.map((g) => (
          <button
            key={g.id}
            className={`gap-chip${cur === g.id ? ' active' : ''}`}
            onClick={() => onChange(g.id)}
            aria-pressed={cur === g.id}
          >
            <b>{t(`gap.${g.id}`)}</b>
            <i>{t(`gap.${g.id}.sub`)}</i>
          </button>
        ))}
      </div>
      {!compact && cur === 'even' && <p className="small dim">{t('gap.evenNote')}</p>}
      {!compact && cur !== 'even' && <p className="small dim">{t('gap.recordNote')}</p>}
    </div>
  );
}

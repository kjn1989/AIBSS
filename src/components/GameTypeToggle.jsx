import React from 'react';
import { useT } from '../state/store.jsx';

// 試合の種別(公式戦/練習試合)。任意で、既定は未指定(null)。
//
// 大会名の自由入力だけだと「練習」「TM」「OP戦」と書き方がばらけ、空欄の試合は
// どちらか分からない。記録の集計でいちばん効く区別なので、2択で持つ。
// 押している方をもう一度押すと未指定に戻る(押し間違いを取り消せるように)。
export default function GameTypeToggle({ value, onChange }) {
  const t = useT();
  const pick = (v) => onChange(value === v ? null : v);
  return (
    <>
      <label className="small dim mt8" style={{ display: 'block' }}>{t('gametype.label')}</label>
      <div className="toggle-row">
        <button className={value === 'official' ? 'active' : ''} aria-pressed={value === 'official'} onClick={() => pick('official')}>
          {t('gametype.official')}
        </button>
        <button className={value === 'practice' ? 'active' : ''} aria-pressed={value === 'practice'} onClick={() => pick('practice')}>
          {t('gametype.practice')}
        </button>
      </div>
      <p className="small dim" style={{ marginTop: 4 }}>{t('gametype.hint')}</p>
    </>
  );
}

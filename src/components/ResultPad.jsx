import React from 'react';
import { resultCategory } from '../lib/model.js';

// 打撃結果のワンタップ選択パッド。色分けは resultCategory() を単一の基準にして
// スコアシート・PDF・ログと完全に同期させる(既存レイアウトは維持)。
const BUTTONS = [
  { key: 'single', label: '単打' },
  { key: 'double', label: '二塁打' },
  { key: 'triple', label: '三塁打' },
  { key: 'hr', label: '本塁打' },
  { key: 'out', label: '凡打' },
  { key: 'so', label: '三振' },
  { key: 'bb', label: '四球' },
  { key: 'hbp', label: '死球' },
  { key: 'error', label: 'エラー' },
  { key: 'sacBunt', label: '犠打' },
  { key: 'sacFly', label: '犠飛' },
  { key: 'interference', label: '打撃妨害' },
];

export default function ResultPad({ onSelect }) {
  return (
    <div className="result-pad">
      {BUTTONS.map((b) => (
        <button key={b.key} className={resultCategory(b.key)} onClick={() => onSelect(b.key)}>
          {b.label}
        </button>
      ))}
    </div>
  );
}

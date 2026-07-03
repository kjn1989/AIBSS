import React from 'react';

// 打撃結果のワンタップ選択パッド
const BUTTONS = [
  { key: 'single', label: '単打', cls: 'hit' },
  { key: 'double', label: '二塁打', cls: 'hit' },
  { key: 'triple', label: '三塁打', cls: 'hit' },
  { key: 'hr', label: '本塁打', cls: 'hit' },
  { key: 'out', label: '凡打', cls: 'outres' },
  { key: 'so', label: '三振', cls: 'outres' },
  { key: 'bb', label: '四球', cls: 'onbase' },
  { key: 'hbp', label: '死球', cls: 'onbase' },
  { key: 'error', label: '失策', cls: 'onbase' },
  { key: 'sacBunt', label: '犠打', cls: 'sac' },
  { key: 'sacFly', label: '犠飛', cls: 'sac' },
  { key: 'interference', label: '打撃妨害', cls: 'sac' },
];

export default function ResultPad({ onSelect }) {
  return (
    <div className="result-pad">
      {BUTTONS.map((b) => (
        <button key={b.key} className={b.cls} onClick={() => onSelect(b.key)}>
          {b.label}
        </button>
      ))}
    </div>
  );
}

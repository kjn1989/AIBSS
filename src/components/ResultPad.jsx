import React from 'react';
import { resultCategory } from '../lib/model.js';
import { useT } from '../state/store.jsx';

// 打撃結果のワンタップ選択パッド。表示名は i18n辞書(result.*)を単一の基準にして、
// 現在の表示言語(ja/en)に追従させる。保存済みプレイログの文言はRESULTS.label
// (model.js)のまま日本語固定 — 既存記録の正確さを優先し、表示だけを切り替える。
// レイアウト:
//  - 主要結果(ヒット系4種 + 凡打/三振/四球/死球)は4列グリッド
//  - エラー・バント・犠牲フライは3列均一(下段の妨害3種と横幅を揃える)
//  - 打撃/守備/走塁妨害の3種も3列均一
const MAIN_KEYS = ['single', 'double', 'triple', 'hr', 'out', 'so', 'bb', 'hbp'];
const SECONDARY_KEYS = ['error', 'sacBunt', 'sacFly'];
const INTERFERENCE_KEYS = ['interference', 'fieldInterference', 'obstruction'];

function PadButton({ k, onSelect, t }) {
  return (
    <button className={resultCategory(k)} onClick={() => onSelect(k)}>
      {t(`result.${k}`)}
    </button>
  );
}

export default function ResultPad({ onSelect }) {
  const t = useT();
  return (
    <div>
      <div className="result-pad">
        {MAIN_KEYS.map((k) => (
          <PadButton key={k} k={k} onSelect={onSelect} t={t} />
        ))}
      </div>
      {/* エラー・バント・犠牲フライを3列均一(下段の妨害と横幅を揃える) */}
      <div className="result-pad result-pad-intf">
        {SECONDARY_KEYS.map((k) => (
          <PadButton key={k} k={k} onSelect={onSelect} t={t} />
        ))}
      </div>
      <div className="result-pad result-pad-intf">
        {INTERFERENCE_KEYS.map((k) => (
          <PadButton key={k} k={k} onSelect={onSelect} t={t} />
        ))}
      </div>
    </div>
  );
}

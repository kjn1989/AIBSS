import React from 'react';
import { RESULTS, resultCategory } from '../lib/model.js';

// 打撃結果のワンタップ選択パッド。表示名は RESULTS.label(初心者にも分かる口語表記)を
// 単一の基準にして、ログ・確認・編集・スコアシートと完全に同期させる。
// レイアウト:
//  - 主要結果(ヒット系4種 + 凡打/三振/四球/死球)は4列グリッド
//  - エラー・バント・犠牲フライは3列均一(下段の妨害3種と横幅を揃える)
//  - 打撃/守備/走塁妨害の3種も3列均一
const MAIN_KEYS = ['single', 'double', 'triple', 'hr', 'out', 'so', 'bb', 'hbp'];
const SECONDARY_KEYS = ['error', 'sacBunt', 'sacFly'];
const INTERFERENCE_KEYS = ['interference', 'fieldInterference', 'obstruction'];

function PadButton({ k, onSelect }) {
  return (
    <button className={resultCategory(k)} onClick={() => onSelect(k)}>
      {RESULTS[k].label}
    </button>
  );
}

export default function ResultPad({ onSelect }) {
  return (
    <div>
      <div className="result-pad">
        {MAIN_KEYS.map((k) => (
          <PadButton key={k} k={k} onSelect={onSelect} />
        ))}
      </div>
      {/* エラー・バント・犠牲フライを3列均一(下段の妨害と横幅を揃える) */}
      <div className="result-pad result-pad-intf">
        {SECONDARY_KEYS.map((k) => (
          <PadButton key={k} k={k} onSelect={onSelect} />
        ))}
      </div>
      <div className="result-pad result-pad-intf">
        {INTERFERENCE_KEYS.map((k) => (
          <PadButton key={k} k={k} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

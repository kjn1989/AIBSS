import React from 'react';
import { editionLabel } from '../lib/model.js';

// エディション名の表示を1行にスッキリ収めるための共通コンポーネント。
// 括弧の補足(例: ブカツ(中高大)の「(中高大)」)だけを小さく控えめに表示し、
// 「草野球・社会人」のような「・」区切りは並列(同サイズ)のまま。
// ヘッダー(withFor)と設定のエディション切替トグルの両方で共用する。
export default function EditionText({ edition, withFor = false }) {
  const label = editionLabel(edition);
  const m = label.match(/^(.+?)(（.*）|\(.*\))$/); // 括弧内のみ補足扱い
  return (
    <>
      {withFor ? 'for ' : ''}{m ? m[1] : label}
      {m && <span className="ed-paren">{m[2]}</span>}
    </>
  );
}

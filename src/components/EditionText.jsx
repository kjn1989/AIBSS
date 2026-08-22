import React from 'react';
import { editionLabel } from '../lib/model.js';
import { kindOf, defaultKindFor } from '../lib/editionKind.js';
import { useStore } from '../state/store.jsx';
import { translate } from '../lib/i18n.js';

// エディション名の表示を1行にスッキリ収めるための共通コンポーネント。
// 括弧の補足(例: ブカツ(中高大)の「(中高大)」)だけを小さく控えめに表示し、
// 「草野球・社会人」のような「・」区切りは並列(同サイズ)のまま。
// ヘッダー(withFor)と設定のエディション切替トグルの両方で共用する。
export default function EditionText({ edition, withFor = false, withLevel = false }) {
  const { state } = useStore();
  const lang = state.settings.lang || 'ja';
  // 区分を添えるのはヘッダーだけ。設定の切替ボタンは各エディションの名前を
  // 出すところなので、いま選んでいる区分を混ぜると別のエディションにも付いてしまう
  const kind = withLevel
    ? (edition === state.settings.edition ? kindOf(state.settings) : defaultKindFor(edition))
    : null;
  const label = lang === 'en' ? translate('en', `edition.${edition}`) : editionLabel(edition, kind);
  const m = label.match(/^(.+?)(（.*）|\(.*\))$/); // 括弧内のみ補足扱い
  return (
    <>
      {withFor ? 'for ' : ''}{m ? m[1] : label}
      {m && <span className="ed-paren">{m[2]}</span>}
    </>
  );
}

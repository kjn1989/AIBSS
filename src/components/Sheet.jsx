import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store.jsx';

// 画面下から出る汎用ボトムシート
// - createPortal で body 直下に描画: iOS Safari で .main のスクロールコンテキストに
//   閉じ込められてタブバーの下に潜る問題を回避する
// - 表示中は背景(.main)のスクロールをロックし、シート内のみスクロール可能にする
// - body 直下に出るぶん .app の外に落ちるので、エディションの色(アクセント)を
//   継げずシートだけ青いままだった。data-edition を持たせて色を継がせる
export default function Sheet({ title, onClose, children }) {
  const { state } = useStore();
  useEffect(() => {
    document.body.classList.add('sheet-open');
    return () => document.body.classList.remove('sheet-open');
  }, []);

  return createPortal(
    <div className="sheet-overlay" data-edition={state.settings.edition} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  );
}

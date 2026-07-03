import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

// 画面下から出る汎用ボトムシート
// - createPortal で body 直下に描画: iOS Safari で .main のスクロールコンテキストに
//   閉じ込められてタブバーの下に潜る問題を回避する
// - 表示中は背景(.main)のスクロールをロックし、シート内のみスクロール可能にする
export default function Sheet({ title, onClose, children }) {
  useEffect(() => {
    document.body.classList.add('sheet-open');
    return () => document.body.classList.remove('sheet-open');
  }, []);

  return createPortal(
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>,
    document.body
  );
}

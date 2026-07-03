import React from 'react';

// 画面下から出る汎用ボトムシート
export default function Sheet({ title, onClose, children }) {
  return (
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

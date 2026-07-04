import { createPortal } from 'react-dom';

// 全画面ビュー共通ラッパー。document.body直下にポータルで描画することで、
// .main(overflow-y: auto + -webkit-overflow-scrolling: touch)の内側に
// position: fixed 要素がネストされることで起きるiOS Safariの不具合
// (fixedの基準がスクロールコンテナ化し、ヘッダー/タブバーが透けて見える)を回避する。
export default function FullscreenView({ children }) {
  return createPortal(<div className="fullscreen-view">{children}</div>, document.body);
}

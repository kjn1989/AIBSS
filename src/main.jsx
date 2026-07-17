import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import WatchView from './components/WatchView.jsx';
import { StoreProvider } from './state/store.jsx';
import { recoverIfNeeded, requestPersistentStorage } from './lib/durableStore.js';
import { ensureRegistry, getActiveProfileId, profileStorageKey, LEGACY_DATA_KEY } from './lib/profiles.js';
import { initNativeChrome } from './lib/nativeBridge.js';
import './styles.css';

// ?watch=1 が付いたリンクは観戦専用ページ(読み取り専用)を表示する
const isWatchMode = new URLSearchParams(window.location.search).get('watch') === '1';

function mount() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <StoreProvider>
        {isWatchMode ? <WatchView /> : <App />}
      </StoreProvider>
    </React.StrictMode>
  );
}

// データ消失対策 + 複数チーム対応: 描画前に
//  1. 旧(単一チーム時代)データをIndexedDBミラーから復旧
//  2. チームレジストリが無ければ、旧データを最初のチームとして移行
//  3. 現在アクティブなチームのデータをIndexedDBミラーから復旧
// の順で行い、その後で恒久ストレージの利用を要求する。IndexedDB不可でも必ずmountする。
recoverIfNeeded(LEGACY_DATA_KEY)
  .catch(() => {})
  .then(() => {
    ensureRegistry();
    const activeId = getActiveProfileId();
    return activeId ? recoverIfNeeded(profileStorageKey(activeId)) : null;
  })
  .catch(() => {})
  .finally(() => {
    mount();
    requestPersistentStorage();
    initNativeChrome(); // ネイティブ(Capacitor)ラップ時のみステータスバー/スプラッシュを制御
  });

// PWA: Service Worker 登録(本番ビルドのみ)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

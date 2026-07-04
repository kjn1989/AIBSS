import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import WatchView from './components/WatchView.jsx';
import { StoreProvider, STORAGE_KEY } from './state/store.jsx';
import { recoverIfNeeded, requestPersistentStorage } from './lib/durableStore.js';
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

// データ消失対策: 描画前にIndexedDBミラーからの復旧を試み(localStorageが消えていた場合)、
// その後で恒久ストレージの利用を要求する。IndexedDB不可でも必ずmountする。
recoverIfNeeded(STORAGE_KEY)
  .catch(() => {})
  .finally(() => {
    mount();
    requestPersistentStorage();
  });

// PWA: Service Worker 登録(本番ビルドのみ)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

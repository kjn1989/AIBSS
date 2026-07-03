import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import WatchView from './components/WatchView.jsx';
import { StoreProvider } from './state/store.jsx';
import './styles.css';

// ?watch=1 が付いたリンクは観戦専用ページ(読み取り専用)を表示する
const isWatchMode = new URLSearchParams(window.location.search).get('watch') === '1';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StoreProvider>
      {isWatchMode ? <WatchView /> : <App />}
    </StoreProvider>
  </React.StrictMode>
);

// PWA: Service Worker 登録(本番ビルドのみ)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import WatchView from './components/WatchView.jsx';
import { StoreProvider } from './state/store.jsx';
import { recoverIfNeeded, requestPersistentStorage } from './lib/durableStore.js';
import { ensureRegistry, getActiveProfileId, profileStorageKey, LEGACY_DATA_KEY } from './lib/profiles.js';
import { initNativeChrome } from './lib/nativeBridge.js';
import { applyDocumentLang } from './lib/documentLang.js';
import { resolveLang, storedLang, langFromUrl, saveLang } from './lib/langStore.js';
import { keepAlivePing } from './lib/officialCloud.js';
import './styles.css';

// ?watch=1 が付いたリンクは観戦専用ページ(読み取り専用)を表示する
const isWatchMode = new URLSearchParams(window.location.search).get('watch') === '1';

// 表示言語を決めて保存し、文書側(lang/title/manifest)へ反映する。
// 判断の順番は lib/langStore.js に書いてある。プロフィールの settings.lang を
// 見るのは、端末単位へ移す前に選んでいた人の引き継ぎのため(1回で端末側へ移る)。
function applyLang(storageKey) {
  let profile = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) profile = JSON.parse(raw)?.settings?.lang || null;
  } catch {
    /* 壊れていても推定へ落ちる */
  }
  const lang = resolveLang({ url: langFromUrl(), stored: storedLang(), profile });
  saveLang(lang);
  applyDocumentLang(lang);
}



function mount() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {/* いちばん外側の受け皿。ヘッダーやタブバー、ストア自体が落ちたときは
          タブ単位の境界では受けきれないので、ここでも受ける */}
      <ErrorBoundary>
        <StoreProvider>
          {isWatchMode ? <WatchView /> : <App />}
        </StoreProvider>
      </ErrorBoundary>
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
    // 表示言語を決めて端末に残す。描画前にやる理由は2つ:
    //  ・<html lang> とタイトルが最初の1フレームから正しくなる
    //  ・ストアの初期化(settings.lang)がこの結果を読む
    applyLang(activeId ? profileStorageKey(activeId) : LEGACY_DATA_KEY);
    return activeId ? recoverIfNeeded(profileStorageKey(activeId)) : null;
  })
  .catch(() => {})
  .finally(() => {
    mount();
    requestPersistentStorage();
    initNativeChrome(); // ネイティブ(Capacitor)ラップ時のみステータスバー/スプラッシュを制御
    keepAlivePing(); // Supabase休止防止の二重化(20時間に1回まで間引き)。失敗しても無視
  });

// PWA: Service Worker 登録(本番ビルドのみ)
// 新しいSWが有効化されたら自動で1回リロードして最新版へ切り替える
// (これまで「直したのに反映されない=古いキャッシュ表示」が頻発していた対策)。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return; // 初回インストール時は再読込しない
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => reg.update?.()).catch(() => {});
  });
  // 復帰時にも更新チェック(バックグラウンド滞在後に最新へ)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update?.()).catch(() => {});
    }
  });
}

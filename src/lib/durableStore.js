// ============================================================
// データ消失対策: IndexedDB を localStorage のミラーにして二重化する。
//
// iOS Safari は「ホーム画面に未追加のサイト」のストレージを、一定期間
// 未操作だと自動削除することがある(ITP)。有料ユーザーが1シーズン分の
// データを失うのは「恒久的に売れる」の最大の敵なので、次の3段で守る:
//   1. localStorage と IndexedDB の2系統に保存(片方が消えても復旧)
//   2. 起動時、localStorageが空でIndexedDBに残っていれば自動復旧
//   3. navigator.storage.persist() で消去対象からの除外を要求(対応環境)
//
// 補足(Capacitorネイティブラップ時): iOSのITP自動削除はSafari上のWeb
// ストレージが対象で、Capacitorアプリが使うWKWebView専用のストレージ
// (アプリのサンドボックス内)は対象外。ネイティブアプリ化そのものが、
// この消失リスクの根本的な解決策になる(詳細は docs/mobile-build.md)。
// ============================================================

const DB_NAME = 'aibss';
const STORE = 'kv';
// 複数チーム対応前(〜v1系)は固定キー'snapshot'に1件だけ保存していた。
// 後方互換のため、旧データのIDB復旧時のみこのキーもフォールバック参照する。
const LEGACY_SNAPSHOT_KEY = 'snapshot';
const LEGACY_STORAGE_KEY = 'bbscorer.v1';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// スナップショット文字列(persist()が作るJSON)をIndexedDBへ保存。失敗は無視。
// key: localStorageキーと同じ文字列(チームごとに独立させるため)
export async function idbSave(key, snapshotString) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snapshotString, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* IndexedDB不可の環境でもlocalStorage側で継続 */
  }
}

export async function idbLoad(key) {
  try {
    const db = await openDB();
    const val = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return val;
  } catch {
    return null;
  }
}

// 起動時の復旧/移行。React描画前(同期的なloadPersistedが読む前)に呼ぶこと。
// 戻り値: 'recovered'(IDB→localStorage復旧) | 'seeded'(localStorage→IDB初回複製) | 'ok' | 'error'
export async function recoverIfNeeded(storageKey) {
  try {
    const ls = localStorage.getItem(storageKey);
    const hasLS = !!ls && ls !== 'null';
    let idb = await idbLoad(storageKey);
    if (!idb && storageKey === LEGACY_STORAGE_KEY) idb = await idbLoad(LEGACY_SNAPSHOT_KEY); // 旧固定キーからの後方互換復旧
    if (!hasLS && idb) {
      localStorage.setItem(storageKey, idb); // localStorageが消えていた → IDBから復旧
      return 'recovered';
    }
    if (hasLS && !idb) {
      await idbSave(storageKey, ls); // 既存ユーザーの初回: IDBにも複製しておく
      return 'seeded';
    }
    return 'ok';
  } catch {
    return 'error';
  }
}

// 恒久ストレージ(消去対象からの除外)を要求。対応ブラウザでのみ有効。失敗は無視。
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* noop */
  }
  return false;
}

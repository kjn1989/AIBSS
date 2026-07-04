// ============================================================
// データ消失対策: IndexedDB を localStorage のミラーにして二重化する。
//
// iOS Safari は「ホーム画面に未追加のサイト」のストレージを、一定期間
// 未操作だと自動削除することがある(ITP)。有料ユーザーが1シーズン分の
// データを失うのは「恒久的に売れる」の最大の敵なので、次の3段で守る:
//   1. localStorage と IndexedDB の2系統に保存(片方が消えても復旧)
//   2. 起動時、localStorageが空でIndexedDBに残っていれば自動復旧
//   3. navigator.storage.persist() で消去対象からの除外を要求(対応環境)
// ============================================================

const DB_NAME = 'aibss';
const STORE = 'kv';
const KEY = 'snapshot';

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
export async function idbSave(snapshotString) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snapshotString, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* IndexedDB不可の環境でもlocalStorage側で継続 */
  }
}

export async function idbLoad() {
  try {
    const db = await openDB();
    const val = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
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
    const idb = await idbLoad();
    if (!hasLS && idb) {
      localStorage.setItem(storageKey, idb); // localStorageが消えていた → IDBから復旧
      return 'recovered';
    }
    if (hasLS && !idb) {
      await idbSave(ls); // 既存ユーザーの初回: IDBにも複製しておく
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

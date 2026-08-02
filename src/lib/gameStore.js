// ============================================================
// 試合の保存(IndexedDB・試合ごとの独立レコード)
//
// 従来は全試合＋全ログを1つのJSONにして localStorage に丸ごと入れていた。
// 1試合はおよそ100KBあるので、localStorage の上限(5MB前後)には
// 50試合ほどで到達する。高校野球のように年50試合を超えるチームは
// 1シーズンで崖に当たる。
//
// そこで試合は IndexedDB に1件ずつ保存する。IDB は空きディスクの数十%まで
// 使えるので、20年ぶん(1000試合・約95MB)でも問題にならない。
// localStorage には「試合の索引」だけを置く(1件200バイト程度)。
// 索引があるので、起動直後にホームや試合一覧をすぐ描ける。
// ============================================================

const DB_NAME = 'aibss';
const DB_VERSION = 2; // v1: kv(スナップショットのミラー) / v2: games を追加
const KV = 'kv';
const GAMES = 'games';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(GAMES)) {
        // key は `${プロフィールキー}::${試合ID}`。チームごとに独立させる
        const store = db.createObjectStore(GAMES);
        store.createIndex('profile', 'profileKey', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const recKey = (profileKey, gameId) => `${profileKey}::${gameId}`;

// 試合をまとめて保存する。updatedAt が変わったものだけ書く。
// 戻り値: 書いた試合数(失敗時は -1)
export async function saveGames(profileKey, games, writtenAt = new Map()) {
  try {
    const db = await openDB();
    const targets = Object.values(games || {}).filter((g) => g && g.id && writtenAt.get(g.id) !== g.updatedAt);
    if (!targets.length) return 0;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(GAMES, 'readwrite');
      const store = tx.objectStore(GAMES);
      for (const g of targets) store.put({ profileKey, gameId: g.id, updatedAt: g.updatedAt || 0, game: g }, recKey(profileKey, g.id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    for (const g of targets) writtenAt.set(g.id, g.updatedAt);
    return targets.length;
  } catch {
    return -1; // IDBが使えない環境(プライベートブラウズ等)。呼び出し側で握る
  }
}

// そのチームの全試合を読み出す。戻り値: { [id]: game } | null(読めない)
export async function loadGames(profileKey) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(GAMES, 'readonly');
      const req = tx.objectStore(GAMES).index('profile').getAll(profileKey);
      req.onsuccess = () => {
        const out = {};
        for (const rec of req.result || []) if (rec?.game?.id) out[rec.game.id] = rec.game;
        resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// 保存済みの試合IDのうち、いま state に無いものを消す(削除の反映)
export async function pruneGames(profileKey, keepIds) {
  try {
    const db = await openDB();
    const keep = new Set(keepIds);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(GAMES, 'readwrite');
      const store = tx.objectStore(GAMES);
      const req = store.index('profile').getAllKeys(profileKey);
      req.onsuccess = () => {
        for (const k of req.result || []) {
          const id = String(k).split('::')[1];
          if (id && !keep.has(id)) store.delete(k);
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

// 試合の索引(localStorage に置く軽い一覧)。ログを含まないので1件200バイト程度。
// 起動直後、IndexedDB の読み出しを待たずにホームや試合一覧を描くために使う。
export function gameIndex(games) {
  return Object.values(games || {}).map((g) => ({
    id: g.id, date: g.date, opponent: g.opponent, season: g.season, year: g.year ?? null,
    isHome: g.isHome, status: g.status, myScore: g.myScore, oppScore: g.oppScore,
    updatedAt: g.updatedAt || 0,
  }));
}

// 索引から、ログを持たない仮の試合オブジェクトを作る。
// _stub が立っている間は「まだ読み込んでいない」ことを表す。
export function stubGamesFromIndex(index = []) {
  const out = {};
  for (const m of index) {
    if (!m?.id) continue;
    out[m.id] = {
      ...m, _stub: true,
      lineup: [], startingLineup: [], usedPlayerIds: [], retiredPlayerIds: [],
      playLogs: [], atBats: [], pitchingRecords: [], linescore: {},
      runners: { 1: null, 2: null, 3: null }, oppLineup: [], oppUsedLetters: [], oppRetiredLetters: [],
      oppPitchers: {}, oppPitcherHands: {}, oppBatterHands: {}, oppNames: {}, oppPositions: {},
    };
  }
  return out;
}

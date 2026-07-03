// ============================================================
// クラウド共有: Firebase Firestore
// - 設定画面で貼り付けた config(JSON) + チームコードで接続
// - 未設定時は一切ロードされず、ローカルのみで完全動作
// - スキーマは localStorage と同一(Game/Player オブジェクトをそのまま保存)
// - 同期方式: onSnapshot で購読 + updatedAt の Last-Write-Wins
// ============================================================
import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, doc, setDoc, onSnapshot,
} from 'firebase/firestore';

export function parseFirebaseConfig(text) {
  if (!text?.trim()) return null;
  try {
    // JSONでも JSのオブジェクトリテラル風でも受け付ける
    const cleaned = text
      .replace(/^[^{]*\{/s, '{')
      .replace(/\}[^}]*$/s, '}')
      .replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*}/g, '}');
    const cfg = JSON.parse(cleaned);
    return cfg.projectId && cfg.apiKey ? cfg : null;
  } catch {
    return null;
  }
}

// 接続ハンドル
export function connectCloud({ configText, teamCode, onGames, onPlayers, onStatus }) {
  const cfg = parseFirebaseConfig(configText);
  if (!cfg || !teamCode) {
    onStatus?.('error');
    return null;
  }
  let app;
  try {
    onStatus?.('connecting');
    app = initializeApp(cfg, `bbscorer-${Date.now()}`);
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
    });
    const gamesCol = collection(db, 'teams', teamCode, 'games');
    const playersCol = collection(db, 'teams', teamCode, 'players');

    const unsubGames = onSnapshot(
      gamesCol,
      (snap) => {
        onStatus?.('on');
        onGames?.(snap.docs.map((d) => d.data()));
      },
      () => onStatus?.('error')
    );
    const unsubPlayers = onSnapshot(
      playersCol,
      (snap) => onPlayers?.(snap.docs.map((d) => d.data())),
      () => onStatus?.('error')
    );

    return {
      db,
      teamCode,
      async pushGame(game) {
        await setDoc(doc(db, 'teams', teamCode, 'games', game.id), sanitize(game));
      },
      async pushPlayer(player) {
        await setDoc(doc(db, 'teams', teamCode, 'players', player.id), sanitize(player));
      },
      teardown() {
        unsubGames();
        unsubPlayers();
        deleteApp(app).catch(() => {});
      },
    };
  } catch {
    onStatus?.('error');
    if (app) deleteApp(app).catch(() => {});
    return null;
  }
}

// Firestore は undefined を許容しないため除去(JSON往復でスキーマ同一性も担保)
function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj));
}

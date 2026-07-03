import { useEffect, useRef } from 'react';
import { useStore } from '../state/store.jsx';
import { connectCloud } from '../lib/cloud.js';

// ヘッドレス同期コンポーネント: 設定に応じて Firestore と双方向同期する。
// - 受信: onSnapshot → MERGE_REMOTE (updatedAt の新しい方を採用)
// - 送信: state.games/players の変更をデバウンスして push
//   (受信済み updatedAt と同じものは再送しないためループしない)
export default function CloudSync() {
  const { state, dispatch } = useStore();
  const connRef = useRef(null);
  const remoteVersions = useRef({}); // gameId -> updatedAt (リモートで確認済み)
  const playerCache = useRef({}); // playerId -> JSON (送信済み)

  const { cloudEnabled, firebaseConfigText, teamCode } = state.settings;

  // 接続の確立/解除
  useEffect(() => {
    if (!cloudEnabled || !firebaseConfigText || !teamCode) {
      connRef.current?.teardown();
      connRef.current = null;
      dispatch({ type: 'SET_CLOUD_STATUS', status: 'off' });
      return;
    }
    const conn = connectCloud({
      configText: firebaseConfigText,
      teamCode,
      onStatus: (status) => dispatch({ type: 'SET_CLOUD_STATUS', status }),
      onGames: (games) => {
        for (const g of games) remoteVersions.current[g.id] = g.updatedAt || 0;
        dispatch({ type: 'MERGE_REMOTE', games });
      },
      onPlayers: (players) => {
        for (const p of players) playerCache.current[p.id] = JSON.stringify(p);
        dispatch({ type: 'MERGE_REMOTE', players });
      },
    });
    connRef.current = conn;
    return () => {
      conn?.teardown();
      connRef.current = null;
    };
  }, [cloudEnabled, firebaseConfigText, teamCode]);

  // ローカル変更のプッシュ(デバウンス)
  useEffect(() => {
    if (!connRef.current) return;
    const t = setTimeout(async () => {
      const conn = connRef.current;
      if (!conn) return;
      try {
        for (const g of Object.values(state.games)) {
          if (g.id.startsWith('demo-')) continue; // デモデータは共有しない
          if ((g.updatedAt || 0) > (remoteVersions.current[g.id] || 0)) {
            await conn.pushGame(g);
            remoteVersions.current[g.id] = g.updatedAt || 0;
          }
        }
        for (const p of state.players) {
          if (p.id.startsWith('demo-')) continue;
          const json = JSON.stringify(p);
          if (playerCache.current[p.id] !== json) {
            await conn.pushPlayer(p);
            playerCache.current[p.id] = json;
          }
        }
      } catch {
        dispatch({ type: 'SET_CLOUD_STATUS', status: 'error' });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [state.games, state.players]);

  return null;
}

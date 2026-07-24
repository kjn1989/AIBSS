import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store.jsx';
import { connectCloud } from '../lib/cloud.js';
import { connectOfficial, watchAuth, officialAvailable, listMyTeams } from '../lib/officialCloud.js';

// ヘッドレス同期コンポーネント: 設定に応じて Firestore と双方向同期する。
// 接続先は2系統(公式クラウドを優先):
//  1. 公式クラウド(officialTeamId + ログイン) … teams/{id}/games|players|crew
//  2. 旧方式(自前Firebase config + チームコード) … 上級者向けに併存
// - 受信: onSnapshot → MERGE_REMOTE (updatedAt の新しい方を採用)
// - 送信: state.games/players/members の変更をデバウンスして push
//   (受信済み updatedAt と同じものは再送しないためループしない)
export default function CloudSync() {
  const { state, dispatch } = useStore();
  const connRef = useRef(null);
  const remoteVersions = useRef({}); // gameId -> updatedAt (リモートで確認済み)
  const playerCache = useRef({}); // playerId -> JSON (送信済み)
  const crewCache = useRef({}); // memberId -> JSON (送信済み)
  const [officialUser, setOfficialUser] = useState(null);

  const { cloudEnabled, firebaseConfigText, teamCode, officialTeamId } = state.settings;
  const useOfficial = !!(officialTeamId && officialAvailable());

  // 公式クラウドのログイン状態を監視(接続はログイン後に確立)
  useEffect(() => {
    if (!useOfficial) return;
    const unsub = watchAuth((u) => setOfficialUser(u));
    return unsub;
  }, [useOfficial]);

  // 接続の確立/解除
  useEffect(() => {
    const teardown = () => {
      connRef.current?.teardown();
      connRef.current = null;
    };

    if (useOfficial) {
      if (!officialUser) {
        teardown();
        dispatch({ type: 'SET_CLOUD_STATUS', status: 'off' });
        return;
      }
      // 自分のロール(owner/scorer/viewer)とチーム名を取得。
      // クラウド接続中のプロフィールでは、クラウド側のチーム名が正(オーナーが設定した名前)。
      // ヘッダー表示が「マイチーム」等のままにならないよう、接続先チーム名へ同期する。
      listMyTeams().then((teams) => {
        const mine = teams.find((t) => t.teamId === officialTeamId);
        const role = mine?.role || null;
        const patch = {};
        if (role !== state.settings.officialRole) patch.officialRole = role;
        if (mine?.teamName && mine.teamName !== state.settings.teamName) patch.teamName = mine.teamName;
        if (Object.keys(patch).length) dispatch({ type: 'UPDATE_SETTINGS', patch });
      }).catch(() => {});
      const conn = connectOfficial({
        teamId: officialTeamId,
        onStatus: (status) => dispatch({ type: 'SET_CLOUD_STATUS', status }),
        onGames: (games) => {
          for (const g of games) remoteVersions.current[g.id] = g.updatedAt || 0;
          dispatch({ type: 'MERGE_REMOTE', games });
        },
        onPlayers: (players) => {
          for (const p of players) playerCache.current[p.id] = JSON.stringify(p);
          dispatch({ type: 'MERGE_REMOTE', players });
        },
        onCrew: (crew) => {
          for (const m of crew) crewCache.current[m.id] = JSON.stringify(m);
          dispatch({ type: 'MERGE_REMOTE', crew });
        },
      });
      connRef.current = conn;
      return teardown;
    }

    if (!cloudEnabled || !firebaseConfigText || !teamCode) {
      teardown();
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
    return teardown;
  }, [useOfficial, officialUser, officialTeamId, cloudEnabled, firebaseConfigText, teamCode]);

  // 削除のクラウド伝播: ローカルで削除した項目(pendingDeletes)をクラウドからも消す。
  // 成功したらトゥームストーンを外す。これが無いと全取得で削除項目が復活する。
  useEffect(() => {
    if (!connRef.current) return;
    if (useOfficial && state.settings.officialRole === 'viewer') return;
    const pd = state.pendingDeletes || { games: [], players: [], crew: [] };
    if (!(pd.games?.length || pd.players?.length || pd.crew?.length)) return;
    const conn = connRef.current;
    const jobs = [
      { bucket: 'games', ids: pd.games || [], fn: conn.deleteGame, cache: remoteVersions.current },
      { bucket: 'players', ids: pd.players || [], fn: conn.deletePlayer, cache: playerCache.current },
      { bucket: 'crew', ids: pd.crew || [], fn: conn.deleteCrew, cache: crewCache.current },
    ];
    (async () => {
      for (const job of jobs) {
        if (!job.ids.length) continue;
        if (!job.fn) { dispatch({ type: 'CLEAR_PENDING_DELETE', bucket: job.bucket, ids: job.ids }); continue; }
        const done = [];
        for (const id of job.ids) {
          try {
            await job.fn(id);
            delete job.cache[id]; // 再送キャッシュからも除去
            done.push(id);
          } catch {
            /* 失敗したidは残し、次回の接続/変更時に再試行 */
          }
        }
        if (done.length) dispatch({ type: 'CLEAR_PENDING_DELETE', bucket: job.bucket, ids: done });
      }
    })();
  }, [useOfficial, officialUser, state.pendingDeletes, connRef.current]);

  // ローカル変更のプッシュ(デバウンス)
  useEffect(() => {
    if (!connRef.current) return;
    // 観戦(viewer)ロールは書き込み権限が無い(RLSで拒否される)のでpushしない
    if (useOfficial && state.settings.officialRole === 'viewer') return;
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
        // 参加メンバー(公式クラウドのみ対応。旧方式にはpushCrewが無い)
        if (conn.pushCrew) {
          for (const m of state.members || []) {
            const json = JSON.stringify(m);
            if (crewCache.current[m.id] !== json) {
              await conn.pushCrew(m);
              crewCache.current[m.id] = json;
            }
          }
        }
      } catch {
        dispatch({ type: 'SET_CLOUD_STATUS', status: 'error' });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [state.games, state.players, state.members]);

  return null;
}

// ============================================================
// 状態管理: React標準機能のみ (useReducer + Context)
// - localStorage へ自動永続化(オフライン完全動作)
// - Firestore 同期は lib/cloud.js が本ストアの状態を購読して行う
// - Undo: 試合データのスナップショットを履歴スタックに積む
// ============================================================
import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import {
  newPlayer, newMember, newGame, newAtBat, newPitch, newPlayLog, newPitchingRecord, RESULTS, DIRECTIONS, OUT_TYPES, SO_TYPES,
  OPP_LETTERS, DEFAULT_EDITION, normalizeEdition, multiOutLabel,
} from '../lib/model.js';
import { generateDemoData } from '../lib/demo.js';
import { rebuildPitchingStats } from '../lib/pitchingRebuild.js';
import { resolveStarters, alignmentByInning, findPositionIssues } from '../lib/lineupBox.js';

// 1人しか就けない守備位置(「打」=全員打ち・「控」は複数人可)。位置変更の入れ替え判定に使う。
const UNIQUE_POSITIONS = new Set(['投', '捕', '一', '二', '三', '遊', '左', '中', '右', 'DH']);
import { remapPlayerInGame, fillPlayerGaps } from '../lib/mergePlayers.js';
import { rebuildBatters } from '../lib/battersRebuild.js';
import { idbSave } from '../lib/durableStore.js';
import { translate, DEFAULT_LANG } from '../lib/i18n.js';
import { getActiveProfileId, profileStorageKey, listProfiles, updateProfileMeta } from '../lib/profiles.js';

const UNDO_LIMIT = 50;
// アクティブなチーム(プロフィール)のデータ保存キー。main.jsxのensureRegistry()が
// 描画前に必ずアクティブIDを確定させるため、通常はフォールバックに落ちない。
function currentStorageKey() {
  const id = getActiveProfileId();
  return id ? profileStorageKey(id) : 'bbscorer.v1';
}

// ------------------------------------------------------------
// 初期状態
// ------------------------------------------------------------
export const initialState = {
  players: [], // Player[]
  members: [], // Member[] 参加メンバー(マネージャー/応援等。試合には出ないが参加回数を記録)
  games: {}, // { [gameId]: Game }
  currentGameId: null,
  settings: {
    teamName: 'マイチーム',
    lang: DEFAULT_LANG, // 表示言語 'ja' | 'en'。保存済みログは記録時の言語のまま残す。
    edition: DEFAULT_EDITION, // '草野球' | 'ブカツ(中高大)' | '少年野球'。AIスタメン/AI選手名鑑は草野球限定。
    firebaseConfigText: '', // 設定画面で貼り付けるJSON
    cloudEnabled: false,
    teamCode: '', // Firestore上のチーム識別子
    anthropicApiKey: '', // 廃止(GeminiへAI機能を一本化)。旧データ互換のため残置・未使用
    useLLM: false,
    geminiApiKey: '', // AI選手名鑑のスカウト寸評生成(任意)
    maskAiNames: true, // AI送信前に選手名を「選手」に伏せる(メモ変換・音声解釈に適用。既定ON)
    lastBackupAt: null, // 最後にJSONバックアップを保存した時刻(データ消失対策のリマインド用)
    yearStartMonth: 4, // 年度の開始月。日本の年度に合わせて4月始まりが既定(1=暦年 / 9=北米式)
    schoolType: null, // 'elementary'|'junior'|'high'|'university'。最終学年(卒業の判定)を決める。草野球はnull
    officialTeamId: null, // 公式クラウド(lib/officialCloud.js)のチームID。null=未接続
    officialRole: null, // 公式クラウドでの自分のロール(owner/scorer/viewer)。CloudSyncが接続時に更新
  },
  demoLoaded: false,
  // 削除のトゥームストーン: ローカルで削除した項目のidを保持し、CloudSyncが
  // クラウドからも削除するまで記録。クラウド削除が済むまでMERGE_REMOTEでの復活も防ぐ。
  // (これが無いと、削除がクラウドに伝わらず、リロード時の全取得で戻ってしまう)
  pendingDeletes: { games: [], players: [], crew: [] },
  // ---- 以下は永続化しないセッション状態 ----
  history: [], // Undo用: { gameId, game(deep copy), label }
  cloudStatus: 'off', // 'off' | 'connecting' | 'on' | 'error'
  lastDeleted: null, // 誤削除の復元用: { kind:'player'|'game'|'member', label, item, idx? }。数秒だけ保持
};

const PERSIST_KEYS = ['players', 'members', 'games', 'currentGameId', 'settings', 'demoLoaded', 'pendingDeletes'];

// トゥームストーンにidを追加(重複排除)
function addTomb(pd, bucket, ids) {
  const cur = pd?.[bucket] || [];
  return { ...(pd || { games: [], players: [], crew: [] }), [bucket]: [...new Set([...cur, ...ids])] };
}
// トゥームストーンからidを外す(復元時: 削除待ちを取り消す)
function removeTomb(pd, bucket, id) {
  const cur = pd?.[bucket] || [];
  return { ...(pd || { games: [], players: [], crew: [] }), [bucket]: cur.filter((x) => x !== id) };
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(currentStorageKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 旧バージョンのセーブデータに後から追加されたフィールドの既定値を補う
// ある打順の占有者を、先発+残っている交代・位置ログから作り直す。
// 誤って記録された交代を取り消したあと、その枠を誰に戻すかの判定に使う。
function replaySlot(g, order) {
  const st = resolveStarters(g).find((l) => l.order === order);
  let cur = st ? { playerId: st.playerId, position: st.position || null } : null;
  for (const l of g.playLogs || []) {
    const p = l.payload || {};
    if (l.kind === 'sub' && p.order === order && p.in) {
      cur = { playerId: p.in, position: p.position || cur?.position || null };
    } else if (l.kind === 'position' && p.order === order && cur && cur.playerId === p.playerId) {
      cur = { ...cur, position: p.position || cur.position };
    }
  }
  return cur;
}

// 誤って記録された交代ログを取り消す。その打順を本来の占有者に戻し、
// 付け替わっていた打席も返す。playLogs からの除去は呼び出し側で済ませておく。
function undoSubLog(g, sl, nameOf) {
  const o = sl.payload?.order;
  const inId = sl.payload?.in;
  if (o == null || !inId) return;
  const back = replaySlot(g, o);
  if (!back || back.playerId === inId) return;
  const slot = g.lineup.find((l) => l.order === o);
  if (slot && slot.playerId === inId) { slot.playerId = back.playerId; slot.position = back.position || slot.position; }
  const from = Number(sl.inning || 0);
  for (const ab of g.atBats || []) {
    if (ab.order === o && ab.playerId === inId && Number(ab.snapshot?.inning || 0) >= from) ab.playerId = back.playerId;
  }
  for (const l of g.playLogs || []) {
    if (l.kind === 'atbat' && l.payload?.order === o && l.payload?.playerId === inId && Number(l.inning || 0) >= from) {
      l.payload = { ...l.payload, playerId: back.playerId };
      const rest = String(l.text || '').split(' ').slice(1).join(' ');
      l.text = `${nameOf(back.playerId)} ${rest}`.trim();
    }
  }
}

function ensureOppFields(g) {
  const out = g.oppLineup ? { ...g } : {
    ...g,
    oppLineup: OPP_LETTERS.slice(0, 9).map((letter, i) => ({ order: i + 1, letter, position: '' })),
    oppUsedLetters: OPP_LETTERS.slice(0, 9),
    oppRetiredLetters: [],
    oppBatterIndex: g.oppBatterIndex || 0,
    oppPitcherLetter: null,
  };
  if (!out.linescore) out.linescore = {}; // 回別得点(線分スコア)未保存の試合
  return out;
}

// 保存の失敗(localStorageの容量超過など)を画面へ伝えるための購読口。
// 黙って保存をやめるのが一番危ない: 画面は動き続けるのに記録だけが残らず、
// リロードした瞬間にその試合が消える。必ず知らせて書き出しを促す。
let persistState = { ok: true, error: null, at: 0 };
const persistSubs = new Set();
export function subscribePersistStatus(fn) {
  persistSubs.add(fn);
  fn(persistState);
  return () => persistSubs.delete(fn);
}
function setPersistStatus(next) {
  if (next.ok === persistState.ok && next.error === persistState.error) return;
  persistState = { ...next, at: Date.now() };
  for (const fn of persistSubs) { try { fn(persistState); } catch { /* 購読側の失敗は無視 */ } }
}
export function getPersistStatus() { return persistState; }

export function persist(state) {
  let json;
  let key;
  try {
    const out = {};
    for (const k of PERSIST_KEYS) out[k] = state[k];
    json = JSON.stringify(out);
    key = currentStorageKey();
  } catch (e) {
    setPersistStatus({ ok: false, error: 'serialize' });
    return;
  }
  // IndexedDB を先に書く。localStorage は 5MB 前後で頭打ちになるが IDB は桁違いに
  // 余裕があるため、先に書いておけば容量超過でも記録そのものは残る。
  // (以前は setItem が先で、容量超過の例外でミラーまで到達していなかった)
  idbSave(key, json);
  try {
    localStorage.setItem(key, json);
    setPersistStatus({ ok: true, error: null });
  } catch (e) {
    // 容量超過。IDB には書けているので即座に失うわけではないが、
    // 二重化が崩れた状態なので利用者に知らせる。
    setPersistStatus({ ok: false, error: e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '') ? 'quota' : 'unknown' });
  }
}

const deep = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------
// ゲーム進行ヘルパー
// ------------------------------------------------------------

// 自チームが攻撃中か
export function isMyTeamBatting(game) {
  return game.isTop !== game.isHome; // 先攻(isHome=false)なら表に攻撃
}

// 現在の打者(lineupエントリ)
export function currentBatter(game) {
  if (!game.lineup.length) return null;
  return game.lineup[game.batterIndex % game.lineup.length];
}

// 現在の相手打者(oppLineupエントリ。実名は管理せず記号A〜Tで識別)
export function currentOppBatter(game) {
  if (!game.oppLineup || !game.oppLineup.length) return null;
  return game.oppLineup[game.oppBatterIndex % game.oppLineup.length];
}

// reducer内(フック不可)で選手名を引くための素の参照
function playerNameOf(state, id) {
  return state.players.find((p) => p.id === id)?.name || '不明';
}

// 走者移動をUI表示用の1行テキストにする(打者本人以外の走者を対象)
// 呼び出し側は applyRunnerMoves で game.runners が書き換わる前に呼ぶこと
function describeRunnerMoves(state, game, moves) {
  const baseName = ['', '一', '二', '三'];
  return (moves || []).map((mv) => {
    const r = game.runners[mv.from];
    const who = r?.playerId ? playerNameOf(state, r.playerId) : r?.letter || '走者';
    if (mv.to === 'out') return `${baseName[mv.from]}塁走者 ${who}、アウト`;
    if (mv.to === 4) return `${baseName[mv.from]}塁走者 ${who}、得点`;
    return `${baseName[mv.from]}塁走者 ${who}、${baseName[mv.to]}塁へ進塁`;
  });
}

// 打席開始スナップショットを作る
function makeSnapshot(game) {
  return {
    runners: { 1: !!game.runners[1], 2: !!game.runners[2], 3: !!game.runners[3] },
    outs: game.outs,
    inning: game.inning,
    isTop: game.isTop,
    scoreDiff: game.myScore - game.oppScore,
  };
}

// 未開始なら pending(進行中打席バッファ) を用意
function ensurePending(game) {
  if (!game.pending) {
    game.pending = { snapshot: makeSnapshot(game), pitches: [] };
  }
  return game.pending;
}

// 現在投手の PitchingRecord を取得(なければ作成)
function ensurePitchingRecord(game, playerId) {
  let pr = game.pitchingRecords.find((r) => r.playerId === playerId);
  if (!pr) {
    pr = newPitchingRecord({ gameId: game.id, playerId, appearanceOrder: game.pitchingRecords.length + 1 });
    game.pitchingRecords.push(pr);
  }
  if (!pr.pitchesByInning) pr.pitchesByInning = {}; // 旧レコード互換
  return pr;
}

// 投手の球数を delta 分だけ増減(総数+イニング別を同時に更新)。現在のイニングを鍵にする。
function bumpPitches(game, playerId, delta) {
  const pr = ensurePitchingRecord(game, playerId);
  pr.pitches = Math.max(0, pr.pitches + delta);
  const key = String(game.inning);
  pr.pitchesByInning[key] = Math.max(0, (pr.pitchesByInning[key] || 0) + delta);
}

// 相手投手(記号)の球数を delta 分だけ増減。自軍打撃時に相手投手が投げた球を記録する。
function bumpOppPitches(game, letter, delta) {
  if (!game.oppPitchers) game.oppPitchers = {};
  const op = game.oppPitchers[letter] || (game.oppPitchers[letter] = { pitches: 0, pitchesByInning: {} });
  op.pitches = Math.max(0, op.pitches + delta);
  const key = String(game.inning);
  op.pitchesByInning[key] = Math.max(0, (op.pitchesByInning[key] || 0) + delta);
}

// クラッチ判定: 打席開始時点差 + この打席の打点
function judgeClutch(scoreDiffBefore, rbi, myScoreBefore, oppScoreBefore) {
  if (rbi <= 0) return null;
  const after = scoreDiffBefore + rbi;
  if (scoreDiffBefore < 0 && after > 0) return 'comeback'; // 逆転
  if (scoreDiffBefore < 0 && after === 0) return 'tie'; // 同点
  if (scoreDiffBefore === 0 && after > 0) {
    return myScoreBefore === 0 && oppScoreBefore === 0 ? 'first' : 'goahead'; // 先制 / 勝ち越し
  }
  return null;
}

// チェンジ処理(3アウト)
function changeHalf(game) {
  game.outs = 0;
  game.runners = { 1: null, 2: null, 3: null };
  game.pending = null;
  if (game.isTop) {
    game.isTop = false;
  } else {
    game.isTop = true;
    game.inning += 1;
  }
}

// BB/K確定時、タップ漏れがあっても最低限の球数を担保する
function ensureMinimumPitches(pitches, result) {
  const balls = pitches.filter((p) => p.type === 'ball').length;
  const strikes = pitches.filter((p) => p.type === 'strike').length;
  const fouls = pitches.filter((p) => p.type === 'foul').length;
  const out = [...pitches];
  if (result === 'bb') {
    for (let i = balls; i < 4; i++) out.push(newPitch('ball'));
  } else if (result === 'so') {
    // ファウルは2ストライク分まで有効(ファウル2球+空振り1球でも正規の三振)
    const strikeEquiv = strikes + Math.min(fouls, 2);
    for (let i = strikeEquiv; i < 3; i++) out.push(newPitch('strike'));
  }
  return out;
}

// ------------------------------------------------------------
// Reducer
// ------------------------------------------------------------
export function reducer(state, action) {
  switch (action.type) {
    // ===== 全体 =====
    case 'HYDRATE': {
      // Firestore等からの全置換(スキーマは同一)
      return { ...state, ...action.payload };
    }
    case 'IMPORT_BACKUP': {
      // バックアップJSONからの全置換。旧スキーマの試合には既定値を補う
      const b = action.payload || {};
      const games = Object.fromEntries(
        Object.entries(b.games || {}).map(([id, g]) => [id, ensureOppFields(g)])
      );
      const settings = { ...state.settings, ...(b.settings || {}) };
      settings.edition = normalizeEdition(settings.edition) || DEFAULT_EDITION;
      return {
        ...state,
        players: Array.isArray(b.players) ? b.players : [],
        members: Array.isArray(b.members) ? b.members : [],
        games,
        currentGameId: b.currentGameId && games[b.currentGameId] ? b.currentGameId : null,
        settings,
        demoLoaded: !!b.demoLoaded,
        pendingDeletes: b.pendingDeletes && typeof b.pendingDeletes === 'object'
          ? { games: b.pendingDeletes.games || [], players: b.pendingDeletes.players || [], crew: b.pendingDeletes.crew || [] }
          : { games: [], players: [], crew: [] },
        history: [], // 別データ由来のUndo履歴は破棄
      };
    }
    case 'SET_CLOUD_STATUS':
      return { ...state, cloudStatus: action.status };
    case 'MERGE_REMOTE': {
      // Firestoreからの差分反映: 試合は updatedAt が新しい方を採用(Last-Write-Wins)
      // 削除待ち(pendingDeletes)のidはクラウド削除が済むまで復活させない
      const pd = state.pendingDeletes || { games: [], players: [], crew: [] };
      const delG = new Set(pd.games || []);
      const delP = new Set(pd.players || []);
      const delC = new Set(pd.crew || []);
      // クラウド上の「削除済みの印」。誰かが消した項目は、こちらに残っていても消す
      // (これが無いと、消した端末以外が持ち続け、次の起動で再アップロードして復活する)。
      const dead = (r) => !!(r && r.deleted);
      const games = { ...state.games };
      for (const g of action.games || []) {
        if (delG.has(g.id)) continue; // 削除待ちは無視
        const local = games[g.id];
        if (dead(g)) {
          // 削除より後に手元で更新していた場合だけ残す(その更新が再送されて復活する)
          if (!local || (g.deletedAt || 0) >= (local.updatedAt || 0)) delete games[g.id];
          continue;
        }
        if (!local || (g.updatedAt || 0) >= (local.updatedAt || 0)) games[g.id] = ensureOppFields(g);
      }
      const pmap = new Map(state.players.map((p) => [p.id, p]));
      for (const p of action.players || []) {
        if (delP.has(p.id)) continue;
        if (dead(p)) pmap.delete(p.id);
        else pmap.set(p.id, p);
      }
      const players = [...pmap.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      // 参加メンバー(公式クラウドではcrewコレクション)も同様にidマージ
      let members = state.members || [];
      if (action.crew) {
        const mmap = new Map(members.map((m) => [m.id, m]));
        for (const m of action.crew) {
          if (delC.has(m.id)) continue;
          if (dead(m)) mmap.delete(m.id);
          else mmap.set(m.id, m);
        }
        members = [...mmap.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      }
      const currentGameId = state.currentGameId && !games[state.currentGameId] ? null : state.currentGameId;
      return { ...state, games, players, members, currentGameId };
    }
    // CloudSyncがクラウド削除に成功したらトゥームストーンから外す
    case 'CLEAR_PENDING_DELETE': {
      const pd = state.pendingDeletes || { games: [], players: [], crew: [] };
      const rm = new Set(action.ids || []);
      return { ...state, pendingDeletes: { ...pd, [action.bucket]: (pd[action.bucket] || []).filter((id) => !rm.has(id)) } };
    }
    // 誤削除の復元: 直前に削除した項目を元の位置に戻し、削除待ちも取り消す。
    // クラウド接続時は、pendingDeletesから外れ、項目が復活することで
    // CloudSyncのpushが再アップロードして整合する。
    case 'RESTORE_DELETED': {
      const d = state.lastDeleted;
      if (!d) return state;
      if (d.kind === 'player') {
        const players = [...state.players];
        const at = Math.min(Math.max(d.idx ?? players.length, 0), players.length);
        players.splice(at, 0, d.item);
        return { ...state, players, pendingDeletes: removeTomb(state.pendingDeletes, 'players', d.item.id), lastDeleted: null };
      }
      if (d.kind === 'member') {
        const members = [...(state.members || [])];
        const at = Math.min(Math.max(d.idx ?? members.length, 0), members.length);
        members.splice(at, 0, d.item);
        return { ...state, members, pendingDeletes: removeTomb(state.pendingDeletes, 'crew', d.item.id), lastDeleted: null };
      }
      if (d.kind === 'game') {
        return {
          ...state,
          games: { ...state.games, [d.item.id]: d.item },
          currentGameId: d.prevCurrentGameId ?? state.currentGameId,
          pendingDeletes: removeTomb(state.pendingDeletes, 'games', d.item.id),
          lastDeleted: null,
        };
      }
      return { ...state, lastDeleted: null };
    }
    case 'DISMISS_DELETED':
      return { ...state, lastDeleted: null };
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    // ===== デモデータ =====
    case 'LOAD_DEMO': {
      const { players, games } = generateDemoData();
      const gameMap = { ...state.games };
      for (const g of games) gameMap[g.id] = g;
      const existingIds = new Set(state.players.map((p) => p.id));
      const mergedPlayers = [...state.players, ...players.filter((p) => !existingIds.has(p.id))];
      return { ...state, players: mergedPlayers, games: gameMap, demoLoaded: true };
    }
    case 'CLEAR_DEMO': {
      const games = Object.fromEntries(Object.entries(state.games).filter(([id]) => !id.startsWith('demo-')));
      const players = state.players.filter((p) => !p.id.startsWith('demo-'));
      const currentGameId = state.currentGameId?.startsWith('demo-') ? null : state.currentGameId;
      return { ...state, games, players, currentGameId, demoLoaded: false };
    }

    // ===== 選手 =====
    case 'ADD_PLAYER': {
      const p = newPlayer(action.name, action.number || '', {
        throws: action.throws || '', bats: action.bats || '', entryYear: action.entryYear ?? null,
      });
      return { ...state, players: [...state.players, p] };
    }
    case 'UPDATE_PLAYER': {
      const players = state.players.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p));
      return { ...state, players };
    }
    // ===== 主将・副主将 =====
    // 主将は1人だけ。同じ役割を別の選手に付けたら、前の選手からは自動で外す
    // (2人が主将になっている状態を作らせない)。副主将は2人まで許す。
    case 'SET_TEAM_ROLE': {
      const { id, role } = action; // role: 'captain' | 'vice' | ''
      const limit = role === 'captain' ? 1 : role === 'vice' ? 2 : 0;
      const others = state.players.filter((p) => p.id !== id && p.teamRole === role);
      const drop = new Set(others.slice(0, Math.max(0, others.length - (limit - 1))).map((p) => p.id));
      const players = state.players.map((p) => {
        if (p.id === id) return { ...p, teamRole: role };
        if (role && drop.has(p.id)) return { ...p, teamRole: '' };
        return p;
      });
      return { ...state, players };
    }

    // ===== 選手のアーカイブ(卒業・退部) =====
    // 削除ではない。記録は1件も失わず、名簿の前面とオーダー編成の候補から外れるだけ。
    // 通算成績には引き続き含まれ(チームの歴史)、年度スコープでは自動的に外れる。
    // ids で複数人をまとめて処理できる(年度の締めで使う)。
    case 'ARCHIVE_PLAYERS': {
      const ids = new Set(action.ids || (action.id ? [action.id] : []));
      if (!ids.size) return state;
      const at = Date.now();
      const players = state.players.map((p) => (ids.has(p.id)
        ? { ...p, archivedAt: at, archivedYear: action.year ?? null, archiveNote: action.note || '' }
        : p));
      return { ...state, players };
    }
    // アーカイブから戻す(付け間違い・出戻り)。1タップで元に戻せることが誤操作の備えになる。
    case 'UNARCHIVE_PLAYERS': {
      const ids = new Set(action.ids || (action.id ? [action.id] : []));
      if (!ids.size) return state;
      const players = state.players.map((p) => (ids.has(p.id)
        ? { ...p, archivedAt: null, archivedYear: null, archiveNote: '' }
        : p));
      return { ...state, players };
    }
    // ===== 同名で二重登録された選手の統合 =====
    // 同じ人が2件の選手レコードに分かれていると、打順移動の検出や通算成績が分断される
    // (例: 8番の平川と9番の平川が別人扱いになる)。全試合の参照を keepId に付け替え、
    // 重複レコードを削除して1人にまとめる。背番号など空欄の項目は残る側に補完する。
    case 'MERGE_PLAYERS': {
      const { keepId, mergeId } = action;
      if (!keepId || !mergeId || keepId === mergeId) return state;
      const keep = state.players.find((p) => p.id === keepId);
      const dup = state.players.find((p) => p.id === mergeId);
      if (!keep || !dup) return state;

      const games = {};
      for (const [gid, g0] of Object.entries(state.games)) {
        const g = deep(g0);
        remapPlayerInGame(g, mergeId, keepId); // 付け替えが起きた試合は updatedAt も進む
        games[gid] = g;
      }
      const filled = fillPlayerGaps(keep, dup);
      return {
        ...state,
        games,
        players: state.players.filter((p) => p.id !== mergeId).map((p) => (p.id === keepId ? filled : p)),
        pendingDeletes: mergeId.startsWith('demo-') ? state.pendingDeletes : addTomb(state.pendingDeletes, 'players', [mergeId]),
      };
    }

    case 'DELETE_PLAYER': {
      const idx = state.players.findIndex((p) => p.id === action.id);
      const item = state.players[idx];
      if (!item) return state;
      return {
        ...state,
        players: state.players.filter((p) => p.id !== action.id),
        pendingDeletes: action.id.startsWith('demo-') ? state.pendingDeletes : addTomb(state.pendingDeletes, 'players', [action.id]),
        lastDeleted: { kind: 'player', label: item.name, item, idx },
      };
    }

    // その他(記述式メモ): 判断に迷う不明なプレイを、とりあえず自由記述で残す。
    // 後からAIが正式なスコア記録へ変換・提案する材料にする(payload.memoに原文を保持)。
    case 'ADD_NOTE': {
      const g = deep(state.games[action.gameId]);
      g.playLogs.push(newPlayLog({
        gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'note',
        text: `📝 メモ: ${action.text}`,
        payload: { memo: action.text, resolved: false },
      }));
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // 臨時代走(courtesy runner): 塁上の走者だけを別選手に差し替え、打順(lineup)は変えない。
    // → 元の選手は次の打席で通常どおり出場でき、ラインナップに"復帰"する。
    // 得点・盗塁などの走塁記録は臨時代走側(runner.playerId)に付く。
    case 'COURTESY_RUNNER': {
      const g = deep(state.games[action.gameId]);
      const r = g.runners[action.base];
      if (!r) return state;
      const origId = r.playerId;
      const nm = (id) => state.players.find((p) => p.id === id)?.name || '走者';
      g.runners[action.base] = { ...r, playerId: action.playerId, courtesyFor: origId };
      g.usedPlayerIds = [...new Set([...g.usedPlayerIds, action.playerId])];
      g.playLogs.push(newPlayLog({
        gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'runner',
        text: `臨時代走: ${nm(action.playerId)} (${nm(origId)}に代わり)`,
        payload: { moves: [], playerId: action.playerId, courtesyFor: origId },
      }));
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // 左右別split用: 相手投手/相手打者の投打(記号ごと)を記録
    case 'SET_OPP_HAND': {
      const g = deep(state.games[action.gameId]);
      const key = action.which === 'pitcher' ? 'oppPitcherHands' : 'oppBatterHands';
      g[key] = { ...(g[key] || {}), [action.letter]: action.hand };
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }

    // ===== 参加メンバー(マネージャー/応援等) =====
    case 'ADD_MEMBER':
      return { ...state, members: [...(state.members || []), newMember(action.name, action.role)] };
    case 'UPDATE_MEMBER': {
      const members = (state.members || []).map((m) => (m.id === action.id ? { ...m, ...action.patch } : m));
      return { ...state, members };
    }
    case 'DELETE_MEMBER': {
      const members = state.members || [];
      const idx = members.findIndex((m) => m.id === action.id);
      const item = members[idx];
      if (!item) return state;
      return {
        ...state,
        members: members.filter((m) => m.id !== action.id),
        pendingDeletes: addTomb(state.pendingDeletes, 'crew', [action.id]),
        lastDeleted: { kind: 'member', label: item.name, item, idx },
      };
    }

    // ===== 試合 =====
    case 'CREATE_GAME': {
      const g = newGame(action.payload || {});
      return { ...state, games: { ...state.games, [g.id]: g }, currentGameId: g.id };
    }
    case 'SELECT_GAME':
      return { ...state, currentGameId: action.id };
    case 'IMPORT_BOX_GAME': {
      // 指定フォーマットCSVから作った完成済み試合を挿入。選手は名前照合(なければ新規作成)。
      const { meta, linescore, batters, pitchers } = action.payload;
      let players = [...state.players];
      const findOrCreate = (name, number) => {
        let p = players.find((x) => x.name === name);
        if (!p) { p = newPlayer(name, number || ''); players = [...players, p]; }
        return p.id;
      };
      const importedBatting = (batters || []).map(({ name, number, ...stats }) => ({ playerId: findOrCreate(name, number), ...stats }));
      const importedPitching = (pitchers || []).map(({ name, ...stats }) => ({ playerId: findOrCreate(name), ...stats }));
      let myScore = 0, oppScore = 0;
      const lsKeys = Object.keys(linescore || {});
      if (lsKeys.length) {
        for (const k of lsKeys) { myScore += linescore[k].my || 0; oppScore += linescore[k].opp || 0; }
      } else if (meta.myScore != null || meta.oppScore != null) {
        myScore = meta.myScore || 0; oppScore = meta.oppScore || 0;
      } else {
        myScore = (batters || []).reduce((s, b) => s + (b.runs || 0), 0);
      }
      const g = {
        ...newGame({ opponent: meta.opponent, date: meta.date || undefined, isHome: meta.isHome, season: meta.season }),
        status: 'finished', myScore, oppScore, linescore: linescore || {},
        importedBatting, importedPitching,
        inning: Math.max(1, lsKeys.length), isTop: false,
      };
      return { ...state, players, games: { ...state.games, [g.id]: g } };
    }
    case 'DELETE_GAME': {
      const removed = state.games[action.id];
      const games = { ...state.games };
      delete games[action.id];
      const currentGameId = state.currentGameId === action.id ? null : state.currentGameId;
      const pendingDeletes = action.id.startsWith('demo-') ? state.pendingDeletes : addTomb(state.pendingDeletes, 'games', [action.id]);
      const lastDeleted = removed
        ? { kind: 'game', label: `${removed.date || ''} vs ${removed.opponent || ''}`.trim(), item: removed, prevCurrentGameId: state.currentGameId }
        : state.lastDeleted;
      return { ...state, games, currentGameId, pendingDeletes, lastDeleted, history: state.history.filter((h) => h.gameId !== action.id) };
    }
    case 'DELETE_ALL_GAMES': {
      // 全試合を削除(登録選手・チーム設定は保持)。
      // デモ由来の試合・選手(id が 'demo-' で始まる)も一緒に片付ける
      const players = state.players.filter((p) => !p.id.startsWith('demo-'));
      const gameIds = Object.keys(state.games).filter((id) => !id.startsWith('demo-'));
      const delPlayerIds = state.players.filter((p) => p.id.startsWith('demo-')).map((p) => p.id);
      let pd = addTomb(state.pendingDeletes, 'games', gameIds);
      if (delPlayerIds.length) pd = addTomb(pd, 'players', delPlayerIds);
      return { ...state, games: {}, players, currentGameId: null, demoLoaded: false, pendingDeletes: pd, history: [] };
    }
    case 'RESET_ALL': {
      // 完全初期化: 選手・メンバー・試合をすべて消す。チーム名など設定は保持する
      // クラウド接続時も反映されるよう、消した全idをトゥームストーンに記録
      let pd = addTomb(state.pendingDeletes, 'games', Object.keys(state.games).filter((id) => !id.startsWith('demo-')));
      pd = addTomb(pd, 'players', state.players.map((p) => p.id).filter((id) => !id.startsWith('demo-')));
      pd = addTomb(pd, 'crew', (state.members || []).map((m) => m.id));
      return {
        ...state,
        players: [],
        members: [],
        games: {},
        currentGameId: null,
        demoLoaded: false,
        pendingDeletes: pd,
        history: [],
      };
    }
    case 'FINISH_GAME': {
      const g = deep(state.games[action.id]);
      g.status = 'finished';
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }
    case 'UPDATE_GAME_META': {
      // 試合の対戦相手・日付・シーズンを後から編集
      const g = deep(state.games[action.id]);
      if (!g) return state;
      Object.assign(g, action.patch); // { opponent, date, season }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }

    // ===== オーダー =====
    case 'SET_LINEUP': {
      const g = deep(state.games[action.gameId]);
      g.lineup = action.lineup; // [{order, playerId, position}]
      // 試合開始前(まだ打席が無い)のスタメンをスナップショット保存。
      // lineup は交代で書き換わるため、伝統表記(先発の守備位置)の生成にはこれを使う。
      if (!(g.atBats?.length)) g.startingLineup = action.lineup.map((l) => ({ ...l }));
      g.usedPlayerIds = [...new Set([...g.usedPlayerIds, ...action.lineup.map((l) => l.playerId).filter(Boolean)])];
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }
    case 'SUBSTITUTE': {
      // 代打・代走・守備交代: lineupの1枠を入れ替える
      const g = deep(state.games[action.gameId]);
      const slot = g.lineup.find((l) => l.order === action.order);
      if (!slot) return state;
      const outgoing = slot.playerId;
      slot.playerId = action.playerId;
      if (action.position) slot.position = action.position;
      if (outgoing && !g.retiredPlayerIds.includes(outgoing)) g.retiredPlayerIds.push(outgoing);
      if (!g.usedPlayerIds.includes(action.playerId)) g.usedPlayerIds.push(action.playerId);
      // 代走: 塁上の走者も差し替える
      if (action.asRunner) {
        for (const b of [1, 2, 3]) {
          if (g.runners[b]?.playerId === outgoing) g.runners[b] = { ...g.runners[b], playerId: action.playerId };
        }
      }
      g.playLogs.push(newPlayLog({
        gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'sub',
        text: action.label || '選手交代',
        // kind(ph/pr/def)とposition を残し、伝統的な位置表記(打/走+守備位置)を後から再現できるようにする
        payload: { order: action.order, in: action.playerId, out: outgoing, kind: action.kind || (action.asRunner ? 'pr' : 'def'), position: action.position || null },
      }));
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }
    case 'SET_POSITION': {
      // 守備位置のみ変更(交代を伴わない)
      const g = deep(state.games[action.gameId]);
      const slot = g.lineup.find((l) => l.order === action.order);
      if (slot && slot.position !== action.position) {
        const prev = slot.position;
        // 位置変更を記録(伝統表記の「中左」のような連結に使う)。試合中(打席発生後)のみ。
        const logMove = (s, from) => {
          if (!(g.atBats?.length) || !s.playerId) return;
          g.playLogs.push(newPlayLog({
            gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'position',
            text: '', payload: { order: s.order, playerId: s.playerId, position: s.position, from },
          }));
        };
        // 守備は1人1か所。移った先に居た選手を、空いた位置へ移す。
        // 片方だけ動かすと必ず「その位置に2人・元の位置が不在」になるため、対で動かす。
        // (swap:false は、呼び出し側が9人ぶんの配置を丸ごと指定する場合に使う)
        if (action.swap !== false && UNIQUE_POSITIONS.has(action.position)) {
          for (const other of g.lineup) {
            if (other.order === action.order || other.position !== action.position) continue;
            const from = other.position;
            other.position = prev || '控';
            logMove(other, from);
          }
        }
        slot.position = action.position;
        logMove(slot, prev);
      }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }
    case 'SET_BATTER_INDEX': {
      const g = deep(state.games[action.gameId]);
      g.batterIndex = action.index;
      g.pending = null; // 打者が変わるのでバッファをリセット
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }

    // ===== 相手チーム(記号A〜Tで管理・代打/代走/守備交代) =====
    case 'OPP_SUBSTITUTE': {
      const g = deep(state.games[action.gameId]);
      const slot = g.oppLineup.find((l) => l.order === action.order);
      if (!slot) return state;
      const outgoing = slot.letter;
      slot.letter = action.letter;
      if (action.position) slot.position = action.position;
      if (outgoing && !g.oppRetiredLetters.includes(outgoing)) g.oppRetiredLetters.push(outgoing);
      if (!g.oppUsedLetters.includes(action.letter)) g.oppUsedLetters.push(action.letter);
      // 代走: 塁上の走者も差し替える
      if (action.asRunner) {
        for (const b of [1, 2, 3]) {
          if (g.runners[b]?.letter === outgoing) g.runners[b] = { ...g.runners[b], letter: action.letter };
        }
      }
      g.playLogs.push(newPlayLog({
        gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'oppsub',
        text: action.label || '相手選手交代', payload: { order: action.order, in: action.letter, out: outgoing },
      }));
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }
    // 相手選手の名前(任意)。記号(A〜T)のままでも記録は成立するが、分かる範囲で
    // 実名を入れられるようにする。相手は毎試合変わるので、選手マスタではなく試合に持つ。
    case 'SET_OPP_NAME': {
      const g = deep(state.games[action.gameId]);
      if (!action.letter) return state;
      const names = { ...(g.oppNames || {}) };
      const name = (action.name || '').trim();
      if (name) names[action.letter] = name; else delete names[action.letter];
      g.oppNames = names;
      g.updatedAt = Date.now(); // クラウド同期(後勝ち)に載せるため必ず進める
      return { ...state, games: { ...state.games, [g.id]: g } };
    }
    // 相手選手の守備位置(任意)。記号ごとに持つので、打順が入れ替わっても付いて回る。
    case 'SET_OPP_POSITION': {
      const g = deep(state.games[action.gameId]);
      if (!action.letter) return state;
      const pos = { ...(g.oppPositions || {}) };
      if (action.position) pos[action.letter] = action.position; else delete pos[action.letter];
      // 守備は1人1か所。同じ位置に居た相手選手からは外す(自軍と同じ考え方)
      if (action.position && UNIQUE_POSITIONS.has(action.position)) {
        for (const [l, p] of Object.entries(pos)) if (l !== action.letter && p === action.position) delete pos[l];
      }
      g.oppPositions = pos;
      const slot = (g.oppLineup || []).find((l) => l.letter === action.letter);
      if (slot) slot.position = action.position || '';
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }
    case 'OPP_SET_BATTER_INDEX': {
      const g = deep(state.games[action.gameId]);
      g.oppBatterIndex = action.index;
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }
    case 'OPP_SET_PITCHER': {
      const g = deep(state.games[action.gameId]);
      const prev = g.oppPitcherLetter;
      g.oppPitcherLetter = action.letter;
      if (!g.oppUsedLetters.includes(action.letter)) g.oppUsedLetters.push(action.letter);
      g.playLogs.push(newPlayLog({
        gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'opppitcher',
        text: action.label || '相手投手交代', payload: { in: action.letter, out: prev },
      }));
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 投手 =====
    case 'SET_PITCHER': {
      const g = deep(state.games[action.gameId]);
      const prev = g.currentPitcherId;
      g.currentPitcherId = action.playerId;
      ensurePitchingRecord(g, action.playerId);
      // 継投時: 塁上走者の責任投手は前任のまま残す(自責点帰属ダイアログで使用)
      g.playLogs.push(newPlayLog({
        gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'pitcher',
        text: action.label || '投手交代', payload: { in: action.playerId, out: prev },
      }));
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }
    case 'ADJUST_PITCHING': {
      // 自責点等の手動微調整
      const g = deep(state.games[action.gameId]);
      const pr = g.pitchingRecords.find((r) => r.id === action.recordId);
      if (pr) Object.assign(pr, action.patch);
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }
    case 'SET_DECISION': {
      // 勝利投手/セーブ/ホールドの付与 (win/saveは1試合1人=exclusive、holdは複数可)
      const g = deep(state.games[action.gameId]);
      const field = { win: 'win', save: 'save', hold: 'hold' }[action.decision];
      if (!field) return state;
      for (const pr of g.pitchingRecords) {
        if (pr.id === action.recordId) pr[field] = action.value;
        else if (action.exclusive) pr[field] = false;
      }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }

    // ===== 投球カウンター =====
    case 'ADD_PITCH': {
      // action.pitchType: 'ball' | 'strike' | 'foul' / action.sub: 'looking' | 'swinging'(ストライクのみ)
      const g = deep(state.games[action.gameId]);
      const pending = ensurePending(g);
      pending.pitches.push(newPitch(action.pitchType, action.sub));
      // 守備時は自軍投手、打撃時は相手投手の球数を加算(総数+イニング別)
      if (!isMyTeamBatting(g) && g.currentPitcherId) {
        bumpPitches(g, g.currentPitcherId, +1);
      } else if (isMyTeamBatting(g) && g.oppPitcherLetter) {
        bumpOppPitches(g, g.oppPitcherLetter, +1);
      }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }
    case 'REMOVE_LAST_PITCH': {
      const g = deep(state.games[action.gameId]);
      if (g.pending?.pitches.length) {
        const removed = g.pending.pitches.pop();
        if (removed && !isMyTeamBatting(g) && g.currentPitcherId) {
          bumpPitches(g, g.currentPitcherId, -1);
        } else if (removed && isMyTeamBatting(g) && g.oppPitcherLetter) {
          bumpOppPitches(g, g.oppPitcherLetter, -1);
        }
      }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g } };
    }

    // ===== 走者イベント(打席途中: 盗塁・暴投・捕逸等) =====
    case 'RUNNER_EVENT': {
      // action.event: 'sb'|'cs'|'wp'|'pb'|'pickoff'
      // action.moves: [{ from: 1|2|3, to: 2|3|4|'out' }]
      const g = deep(state.games[action.gameId]);
      ensurePending(g); // スナップショットは打席開始時のまま保持
      const outsBefore = g.outs;
      // 適用後は runners が書き換わるため、動いた走者を塁ごとに先に控える。
      // 自軍の走者は選手ID、相手の走者は記号(A〜T)で識別する。記号を残しておかないと
      // 「相手の誰が走ったか」が消えてしまい、盗塁を選手ごとに積み上げられない。
      const whoByFrom = {};
      for (const mv of action.moves || []) {
        const r = state.games[action.gameId].runners?.[mv.from];
        whoByFrom[mv.from] = { playerId: r?.playerId || null, letter: r?.letter || null };
      }
      const whoOf = (from) => ({ playerId: whoByFrom[from]?.playerId ?? null, letter: whoByFrom[from]?.letter ?? null });
      applyRunnerMoves(g, action.moves, { eventKind: action.event, erChoices: action.erChoices });
      // 守備時: 走塁アウト(盗塁死・牽制死等)も投手のアウト数に加算
      if (!isMyTeamBatting(g) && g.currentPitcherId && g.outs > outsBefore) {
        ensurePitchingRecord(g, g.currentPitcherId).outsRecorded += g.outs - outsBefore;
      }
      const labels = { sb: '盗塁', cs: '盗塁死', wp: '暴投', pb: '捕逸', pickoff: '牽制死', pickoffThrow: '牽制', balk: 'ボーク' };
      // このイベントで増えたアウト数。後から投手成績を再集計しても投球回が失われないよう、
      // ライブ加算(上)だけで終わらせずログにも残す。
      const outsDelta = g.outs - outsBefore;
      if (action.event === 'sb') {
        // 盗塁は「成功した走者ごと」に1ログ。重盗でも全員の個人成績(盗塁数)に正しく反映される
        const safe = (action.moves || []).filter((mv) => mv.to !== 'out');
        for (const mv of safe) {
          g.playLogs.push(newPlayLog({
            gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'sb',
            text: safe.length > 1 ? '盗塁(重盗)' : '盗塁',
            payload: { moves: [mv], ...whoOf(mv.from) },
          }));
        }
        // 重盗などで刺された走者がいれば、そのアウトを別ログに残す(成功ログと混ざらないように)
        const caught = (action.moves || []).filter((mv) => mv.to === 'out');
        if (caught.length > 0) {
          g.playLogs.push(newPlayLog({
            gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'runner',
            text: labels.cs,
            payload: { moves: caught, ...whoOf(caught[0].from), outs: outsDelta },
          }));
        }
      } else {
        g.playLogs.push(newPlayLog({
          gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'runner',
          text: labels[action.event] || '走者イベント',
          payload: { moves: action.moves, ...whoOf(action.moves?.[0]?.from), outs: outsDelta },
        }));
      }
      if (g.outs >= 3) changeHalf(g);
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 打席確定(攻撃/守備 共通のメイン処理) =====
    case 'CONFIRM_PLAY': {
      const g = deep(state.games[action.gameId]);
      const p = action.payload;
      // p: { result, outType, direction, moves, batterTo, rbi(自動計算を上書き可), advSuccess,
      //      erChoices, unearnedRuns, extraOuts }
      const pending = ensurePending(g);
      const batter = currentBatter(g);
      const oppBatter = currentOppBatter(g);
      if (!batter && isMyTeamBatting(g)) return state;

      const myBatting = isMyTeamBatting(g);
      const scoreBefore = { my: g.myScore, opp: g.oppScore };
      const outsBefore = g.outs;

      // --- 投球記録を確定 ---
      let pitches = [...pending.pitches];
      const resultDef = RESULTS[p.result];
      if (resultDef && (resultDef.hit || ['out', 'error', 'sacBunt', 'sacFly', 'interference'].includes(p.result))) {
        pitches.push(newPitch('inplay')); // インプレーの1球を自動加算
        if (!myBatting && g.currentPitcherId) bumpPitches(g, g.currentPitcherId, +1);
        else if (myBatting && g.oppPitcherLetter) bumpOppPitches(g, g.oppPitcherLetter, +1);
      }
      pitches = ensureMinimumPitches(pitches, p.result);
      const balls = pitches.filter((pt) => pt.type === 'ball').length;
      const strikes = pitches.filter((pt) => pt.type === 'strike').length;
      const fouls = pitches.filter((pt) => pt.type === 'foul').length;

      // 打者以外の走者の動き(試合経過画面用の説明文): runnersが書き換わる前に確定
      const moveLines = describeRunnerMoves(state, g, p.moves);

      // --- 走者を動かして得点を数える ---
      const runsInfo = applyRunnerMoves(g, p.moves || [], {
        eventKind: 'play', erChoices: p.erChoices, unearnedRuns: p.unearnedRuns,
      });

      // --- 打者自身の進塁 ---
      let batterScored = false;
      if (p.batterTo === 4) {
        batterScored = true;
        addRun(g, { playerId: myBatting ? batter?.playerId : null, viaError: p.result === 'error' && p.unearnedBatter !== false, erChoice: null });
      } else if (p.batterTo === 'out') {
        g.outs += 1; // 明示的な打者アウト(凡打、単打後の走塁死など)
      } else if (typeof p.batterTo !== 'number' && resultDef && !resultDef.onBase) {
        g.outs += 1; // 出塁しない結果(三振・犠打等)のデフォルト
        // ※振り逃げ等で batterTo に塁が指定された場合はアウトにしない
      }
      if (typeof p.batterTo === 'number' && p.batterTo >= 1 && p.batterTo <= 3) {
        g.runners[p.batterTo] = {
          playerId: myBatting ? batter?.playerId : null,
          letter: myBatting ? null : oppBatter?.letter || null,
          pitcherId: myBatting ? null : g.currentPitcherId,
          viaError: p.result === 'error',
        };
      }
      // 併殺の追加アウト: 走者側のアウトが moves に明示されていない場合のみ+1する。
      // (現行UIは併殺打選択時に走者を必ず'out'にするため通常はここを通らない。
      //  movesにアウトがあるのに+1すると打者アウトと合わせて3アウトになる二重計上バグになる)
      if (p.outType === 'dp' && !(p.moves || []).some((m) => m.to === 'out')) g.outs += 1;
      if (p.extraOuts) g.outs += p.extraOuts;

      // このプレイでまとめて取ったアウト数(ダブル/トリプルプレー判定用)。changeHalf前に確定。
      const outsOnPlay = Math.max(0, g.outs - outsBefore);

      const totalRuns = runsInfo.runs + (batterScored ? 1 : 0);

      // --- 自チーム打席なら AtBat レコードを作成 ---
      if (myBatting && batter) {
        const ab = newAtBat({ gameId: g.id, playerId: batter.playerId, order: batter.order, snapshot: pending.snapshot });
        ab.result = p.result;
        ab.outType = p.outType || null;
        ab.soType = p.result === 'so' ? p.soType || null : null;
        ab.direction = p.direction || null;
        ab.pitches = pitches;
        ab.pitchCount = pitches.length;
        ab.firstPitch = pitches[0]?.type || null;
        ab.firstPitchHit = pitches.length === 1 && ab.firstPitch === 'inplay' && !!resultDef?.hit;
        // RBI: 自動 = 生還数。失策・併殺打では打点なし(手動上書き可)
        let rbi = p.rbi;
        if (rbi === undefined || rbi === null) {
          rbi = p.result === 'error' || p.outType === 'dp' ? 0 : totalRuns;
        }
        ab.rbi = rbi;
        ab.runsOnPlay = totalRuns;
        ab.outsOnPlay = outsOnPlay;
        ab.vsHand = (g.oppPitcherLetter && g.oppPitcherHands?.[g.oppPitcherLetter]) || null; // 対戦相手投手の左右
        // 進塁打: 走者あり凡打(三振以外のアウト)のみ対象
        const hadRunners = pending.snapshot.runners[1] || pending.snapshot.runners[2] || pending.snapshot.runners[3];
        if (p.result === 'out' && hadRunners) {
          ab.advSuccess = p.advSuccess !== undefined ? p.advSuccess : runsInfo.advanced;
        }
        ab.clutch = judgeClutch(pending.snapshot.scoreDiff, rbi, scoreBefore.my, scoreBefore.opp);
        g.atBats.push(ab);
        const resultLabel = (p.result === 'so' && SO_TYPES[p.soType]) || resultDef?.label || p.result;
        const multiOut = multiOutLabel(outsOnPlay);
        g.playLogs.push(newPlayLog({
          gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'atbat',
          text: `${action.batterName || ''} ${DIRECTIONS[p.direction] || ''}${resultLabel}` +
            (multiOut ? ` ⚡${multiOut}` : '') +
            (totalRuns ? ` (${totalRuns}点)` : '') +
            (p.result === 'so' && p.batterTo === 1 ? ' 振り逃げ' : ''),
          payload: {
            atBatId: ab.id, playerId: batter.playerId, order: batter.order, result: p.result,
            outType: p.outType || null, soType: p.result === 'so' ? p.soType || null : null,
            direction: p.direction, rbi, runs: totalRuns, outsOnPlay,
            beforeRunners: pending.snapshot.runners, outsBefore, balls, strikes, fouls, pitchCount: pitches.length,
            moveLines, scoreAfter: { my: g.myScore, opp: g.oppScore },
          },
        }));
        // 生還した打者の得点ログ
        if (batterScored) {
          g.playLogs.push(newPlayLog({
            gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'run',
            text: '得点', payload: { playerId: batter.playerId },
          }));
        }
        g.batterIndex = (g.batterIndex + 1) % Math.max(1, g.lineup.length);
      }

      // --- 守備時: 投手成績へ反映 ---
      if (!myBatting && g.currentPitcherId) {
        const pr = ensurePitchingRecord(g, g.currentPitcherId);
        if (resultDef?.hit) pr.hitsAllowed += 1;
        if (resultDef?.ab) pr.abFaced = (pr.abFaced || 0) + 1; // 被打数(被打率の分母)
        if (p.result === 'bb') pr.walks += 1;
        if (p.result === 'hbp') pr.hitByPitch += 1;
        if (p.result === 'so') pr.strikeouts += 1;
        // アウトカウントは下の共通処理後に別途集計する
      }
      // --- 守備時: 相手打者は記号(A〜T)で識別してログに残す ---
      // (投手未選択でも打順表示・履歴は追えるよう、投手成績とは別に常に記録する)
      if (!myBatting && oppBatter) {
        const oppResultLabel = (p.result === 'so' && SO_TYPES[p.soType]) || resultDef?.label || p.result;
        const oppMultiOut = multiOutLabel(outsOnPlay);
        g.playLogs.push(newPlayLog({
          gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'defense',
          text: `相手打者${oppBatter.letter}(${oppBatter.order}番): ${DIRECTIONS[p.direction] || ''}${oppResultLabel}` +
            (oppMultiOut ? ` ⚡${oppMultiOut}` : '') + (totalRuns ? ` (${totalRuns}失点)` : ''),
          payload: {
            result: p.result, direction: p.direction, outType: p.outType || null,
            soType: p.result === 'so' ? p.soType || null : null, runs: totalRuns, outsOnPlay,
            letter: oppBatter.letter, order: oppBatter.order,
            pitcherId: g.currentPitcherId || null, // どの自軍投手が投げたか(対左右打者split用)
            batterHand: g.oppBatterHands?.[oppBatter.letter] || null, // 相手打者の左右
            beforeRunners: pending.snapshot.runners, outsBefore, balls, strikes, fouls, pitchCount: pitches.length,
            moveLines, scoreAfter: { my: g.myScore, opp: g.oppScore },
          },
        }));
        g.oppBatterIndex = (g.oppBatterIndex + 1) % Math.max(1, g.oppLineup.length);
      }

      // --- 守備時: このプレイで増えたアウト数を現投手に加算 ---
      if (!myBatting && g.currentPitcherId && g.outs > outsBefore) {
        ensurePitchingRecord(g, g.currentPitcherId).outsRecorded += g.outs - outsBefore;
      }

      g.pending = null;
      if (g.outs >= 3) changeHalf(g);
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 手動チェンジ(規定アウト前の攻守交代・修正用) =====
    case 'FORCE_CHANGE_HALF': {
      const g = deep(state.games[action.gameId]);
      g.playLogs.push(newPlayLog({
        gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'change',
        text: 'チェンジ', payload: {},
      }));
      changeHalf(g);
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 走者の手動配置/除去(修正用) =====
    case 'SET_RUNNER': {
      const g = deep(state.games[action.gameId]);
      g.runners[action.base] = action.runner; // { playerId, pitcherId } | null
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 過去プレイの事後編集(結果種別・方向・打点を修正し成績を再計算) =====
    case 'EDIT_PLAY_LOG': {
      const g = deep(state.games[action.gameId]);
      const log = g.playLogs.find((l) => l.id === action.logId);
      if (!log) return state;
      const p = action.patch; // { result, direction, outType, soType, rbi, runs } ※未指定の項目は現状維持
      // 「打点だけ直す」のような部分的な修正で、指定の無い項目まで消さないようにする
      const cur = log.payload || {};
      const pick = (k) => (p[k] !== undefined ? p[k] : cur[k]);
      const result = pick('result');
      const direction = pick('direction');
      const outType = result === 'out' ? (pick('outType') || 'ground') : null;
      const soType = result === 'so' ? (pick('soType') || 'swinging') : null;
      const label = (result === 'so' && SO_TYPES[soType]) || RESULTS[result]?.label || result;
      const dir = DIRECTIONS[direction] || '';
      // その打撃で入った得点。打席を入れ替えるときは打点と一緒に移す必要がある
      const newRuns = p.runs !== undefined ? p.runs : log.payload.runs;
      if (log.kind === 'atbat') {
        const ab = g.atBats.find((a) => a.id === log.payload.atBatId);
        if (ab) {
          ab.result = result;
          ab.direction = direction || null;
          ab.outType = outType;
          ab.soType = soType;
          if (p.rbi !== undefined) ab.rbi = p.rbi;
        }
        const name = playerNameOf(state, log.payload.playerId);
        log.text = `${name} ${dir}${label}` + (newRuns ? ` (${newRuns}点)` : '');
      } else if (log.kind === 'defense') {
        log.text = `相手打者${log.payload.letter}(${log.payload.order}番): ${dir}${label}` +
          (newRuns ? ` (${newRuns}失点)` : '');
      }
      log.payload = {
        ...log.payload,
        result,
        direction: direction || null,
        outType,
        soType,
        ...(p.rbi !== undefined ? { rbi: p.rbi } : {}),
        ...(p.runs !== undefined ? { runs: p.runs } : {}),
      };
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }
    case 'DELETE_PLAY_LOG': {
      const g = deep(state.games[action.gameId]);
      const log = g.playLogs.find((l) => l.id === action.logId);
      if (!log) return state;
      if (log.kind === 'atbat' && log.payload.atBatId) {
        g.atBats = g.atBats.filter((a) => a.id !== log.payload.atBatId);
      }
      g.playLogs = g.playLogs.filter((l) => l.id !== action.logId);
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 守備位置の訂正(入力ミスの是正。交代ではないので回を伴わない) =====
    // 先発なら startingLineup を、途中出場ならその交代ログの守備位置を直す。
    // その打順に今もその選手が居るなら現lineupの守備位置も合わせる。
    // startingLineup が無い過去試合は、表示と同じ推定(resolveStarters)で先に実体化する。
    case 'FIX_STARTING_POSITION': {
      const g = deep(state.games[action.gameId]);
      const { playerId, position } = action;
      if (!playerId || !position) return state;
      if (!g.startingLineup || !g.startingLineup.length) g.startingLineup = resolveStarters(g);
      const applyToSlot = (order) => {
        const slot = (g.lineup || []).find((l) => l.order === order);
        if (slot && slot.playerId === playerId) slot.position = position;
      };
      const st = (g.startingLineup || []).find((l) => l.playerId === playerId);
      if (st) {
        st.position = position;
        applyToSlot(st.order);
      } else {
        // 途中出場: その選手が入った交代ログの守備位置を訂正する(最後の登場を対象)
        const subs = (g.playLogs || []).filter((l) => l.kind === 'sub' && l.payload?.in === playerId);
        const log = subs[subs.length - 1];
        if (!log) return state;
        log.payload = { ...log.payload, position };
        applyToSlot(log.payload.order);
      }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 打者の付け替え(リエントリー等で打者の帰属がズレた打席を、正しい選手へ) =====
    // 打順スロット(order)はそのままに、その打席の選手(playerId)だけを差し替える。
    // AtBatレコード・打席ログ・(直後にあれば)打者自身の得点ログを一括で付け替え、成績を再計算。
    case 'REASSIGN_ATBAT': {
      const g = deep(state.games[action.gameId]);
      const idx = g.playLogs.findIndex((l) => l.id === action.logId);
      if (idx < 0) return state;
      const log = g.playLogs[idx];
      if (log.kind !== 'atbat') return state;
      const oldId = log.payload.playerId;
      const newId = action.newPlayerId;
      if (!newId || newId === oldId) return state;
      const ab = g.atBats.find((a) => a.id === log.payload.atBatId);
      if (ab) ab.playerId = newId;
      log.payload = { ...log.payload, playerId: newId };
      const name = playerNameOf(state, newId);
      const label = (log.payload.result === 'so' && SO_TYPES[log.payload.soType]) || RESULTS[log.payload.result]?.label || log.payload.result;
      const dir = DIRECTIONS[log.payload.direction] || '';
      log.text = `${name} ${dir}${label}` + (log.payload.runs ? ` (${log.payload.runs}点)` : '');
      // 直後の得点ログ(打者自身の生還。CONFIRM_PLAYで打席ログの直後にpushされる)も付け替える
      const nxt = g.playLogs[idx + 1];
      if (nxt && nxt.kind === 'run' && nxt.payload?.playerId === oldId) {
        nxt.payload = { ...nxt.payload, playerId: newId };
      }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 文章での守備位置変更(あとから「◯回からこの位置」を差し込む) =====
    // 交代ではなく、既に出場している選手の守備位置だけが変わったケース
    // (例: 7回からショート茂木・サード入交・セカンド宇田川、という内野の組み替え)。
    // その回の守備の頭に position ログを挿入し、現lineupの守備位置も合わせる。
    case 'RETRO_POSITION': {
      const g = deep(state.games[action.gameId]);
      const { order, playerId, position, inning } = action;
      if (order == null || !playerId || !position) return state;
      // その回の守備陣を見て、いま誰がどこを守っているかを起点にする。
      // 打順の指定が実際の枠とズレていても、その回に居る枠へ反映する。
      const align = alignmentByInning(g).get(Number(inning)) || [];
      const mine = align.find((a) => a.order === order && a.playerId === playerId)
        || align.find((a) => a.playerId === playerId) || null;
      const effOrder = mine ? mine.order : order;
      const before = mine ? mine.position : (g.lineup.find((l) => l.order === order)?.position || null);
      // その回に出ていない選手なら、入れ替え相手を動かすと守備が壊れるので位置だけ記録する
      const displaced = (action.swap === false || !UNIQUE_POSITIONS.has(position) || !mine)
        ? [] : align.filter((a) => a.position === position && a.order !== effOrder);
      // 同じ打順・同じ回の位置ログが既にあれば置き換える(重複防止)
      const touched = new Set([effOrder, ...displaced.map((d) => d.order)]);
      g.playLogs = g.playLogs.filter((l) => !(l.kind === 'position' && touched.has(l.payload?.order) && Number(l.inning) === Number(inning)));
      const insert = (payload) => {
        const log = newPlayLog({ gameId: g.id, inning, isTop: !!g.isHome, kind: 'position', text: '', payload });
        // その回の最後に置く。回の先頭に入れると、同じ回の交代より前に評価され、
        // まだ枠に居ない選手への位置指定として無視されてしまう。
        const at = g.playLogs.findIndex((l) => (l.inning || 0) > inning);
        if (at < 0) g.playLogs.push(log); else g.playLogs.splice(at, 0, log);
      };
      // 守備は1人1か所。その位置に居た選手は、空いた位置(移る選手が居た位置)へ移す。
      // 片方だけ動かすと必ず「その位置に2人・元の位置が不在」になるため対で動かす。
      for (const d of displaced) {
        insert({ order: d.order, playerId: d.playerId, position: before || '控', from: d.position });
        const ds = g.lineup.find((l) => l.order === d.order);
        if (ds && ds.playerId === d.playerId) ds.position = before || '控';
      }
      insert({ order: effOrder, playerId, position, from: before });
      const slot = g.lineup.find((l) => l.order === effOrder);
      if (slot && slot.playerId === playerId) slot.position = position;
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 文章での交代記録(あとから守備交代・代打・リエントリーを差し込む) =====
    // 指定した回に out→in の交代ログを挿入し、その回より後の当該打順の打席を in へ付け替える。
    // 出場選手ツリー・スコアシートは 'sub' ログから系譜を再構成するため、これで反映される。
    case 'RETRO_SUBSTITUTE': {
      const g = deep(state.games[action.gameId]);
      const { order, inId, outId, position, subKind, inning } = action;
      if (order == null || !inId) return state;
      // 同じ付け替え(out→in)が別の回/種別で既に記録されていれば置き換える(重複防止)。
      // 例: 「代打・山城」を後から「2回の守備交代」に直すケース。
      g.playLogs = g.playLogs.filter((l) => !(l.kind === 'sub' && l.payload?.order === order && l.payload?.in === inId && l.payload?.out === outId));
      // 1人が同時に2つの打順に入ることはあり得ない。別の打順へ入れた記録が残っていれば
      // それを取り消し、その打順を元の選手に戻す(この記録違いが「同じ位置に2人」「守る人が
      // 居ない」という警告を大量に生む元になる)。
      const stale = g.playLogs.filter((l) => l.kind === 'sub' && l.payload?.in === inId && l.payload?.order !== order);
      if (stale.length) {
        g.playLogs = g.playLogs.filter((l) => !stale.includes(l));
        for (const sl of stale) undoSubLog(g, sl, (id) => playerNameOf(state, id));
      }
      // 交代が起きた半回を決める。g.isTop は「今どの半回か」なので、過去の回を直す
      // 事後交代にそのまま使うと、ビジターの代打が「◯回裏」に記録されてしまう。
      // 代打・代走は自チームの攻撃中、守備交代は自チームの守備中に起きる。
      const battingTop = !g.isHome; // ビジターは表に攻撃
      const subLog = newPlayLog({
        gameId: g.id, inning, kind: 'sub',
        isTop: (subKind === 'ph' || subKind === 'pr') ? battingTop : !battingTop,
        text: action.label || '選手交代',
        payload: { order, in: inId, out: outId, kind: subKind || 'def', position: position || null },
      });
      // 時系列の正しい位置へ挿入(投手成績の再集計が正しく分かれるように)。
      //  - afterOppOrder 指定: その回の相手打者(打順)のプレイ直後(回の途中の交代)
      //  - 投手交代: その回の守備の頭(回の先頭)
      //  - それ以外: その回の最後
      let at = -1;
      if (action.afterOppOrder != null) {
        const i = g.playLogs.findIndex((l) => l.kind === 'defense' && (l.inning || 0) === inning && l.payload?.order === action.afterOppOrder);
        if (i >= 0) at = i + 1;
      }
      if (at < 0) {
        at = (position === '投')
          ? g.playLogs.findIndex((l) => (l.inning || 0) >= inning)
          : g.playLogs.findIndex((l) => (l.inning || 0) > inning);
      }
      if (at < 0) g.playLogs.push(subLog); else g.playLogs.splice(at, 0, subLog);
      // 交代した回より後の、その打順の out選手の打席を in選手へ付け替える(以降は交代選手の打席)。
      // ただし in選手がその回に既に打席を持っている場合は付け替えない。1人が同じ回に
      // 2打席持つ状態(例: 7回に「右飛/四球/左飛」)は誤った付け替えの結果でしかないため。
      const inningsOfIn = new Set(
        g.atBats.filter((ab) => ab.playerId === inId).map((ab) => Number(ab.snapshot?.inning || 0))
      );
      const canMove = (inn) => !inningsOfIn.has(Number(inn));
      for (const ab of g.atBats) {
        const inn = ab.snapshot?.inning || 0;
        if (ab.order === order && ab.playerId === outId && inn > inning && canMove(inn)) {
          ab.playerId = inId;
          inningsOfIn.add(Number(inn));
        }
      }
      for (const l of g.playLogs) {
        if (l.kind === 'atbat' && l.payload?.order === order && l.payload?.playerId === outId && (l.inning || 0) > inning
            && !g.atBats.some((ab) => ab.id === l.payload.atBatId && ab.playerId === outId)) {
          const nm = playerNameOf(state, inId);
          const lbl = (l.payload.result === 'so' && SO_TYPES[l.payload.soType]) || RESULTS[l.payload.result]?.label || l.payload.result;
          const dir = DIRECTIONS[l.payload.direction] || '';
          l.payload = { ...l.payload, playerId: inId };
          l.text = `${nm} ${dir}${lbl}` + (l.payload.runs ? ` (${l.payload.runs}点)` : '');
        }
      }
      // 現lineupの該当枠がまだout選手なら差し替え(退場登録)
      const slot = g.lineup.find((l) => l.order === order);
      if (slot && slot.playerId === outId) { slot.playerId = inId; if (position) slot.position = position; }
      if (outId && !g.retiredPlayerIds.includes(outId)) g.retiredPlayerIds.push(outId);
      if (!g.usedPlayerIds.includes(inId)) g.usedPlayerIds.push(inId);
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 同じ選手が2つの打順に入っている状態の修復 =====
    // 1人が同時に2枠に居ることはあり得ないので、最初に入った枠だけを残し、
    // あとから入れた記録を取り消して、その枠を本来の選手に戻す。
    // (この食い違いが「同じ位置に2人」「守る人が居ない」を大量に生む元になる)
    case 'FIX_DUPLICATE_SLOTS': {
      const g = deep(state.games[action.gameId]);
      const { sameSlots } = findPositionIssues(g);
      if (!sameSlots.length) return state;
      const nameOf = (id) => playerNameOf(state, id);
      let removed = 0;
      for (const pid of new Set(sameSlots.map((s) => s.playerId))) {
        const starterOrder = resolveStarters(g).find((l) => l.playerId === pid)?.order ?? null;
        const subs = g.playLogs
          .filter((l) => l.kind === 'sub' && l.payload?.in === pid)
          .sort((a, b) => Number(a.inning || 0) - Number(b.inning || 0));
        // 先発で入っている枠があればそれを残す。無ければ最初に入った交代の枠を残す。
        const keepOrder = starterOrder ?? subs[0]?.payload?.order ?? null;
        if (keepOrder == null) continue;
        const drop = subs.filter((l) => l.payload.order !== keepOrder);
        if (!drop.length) continue;
        g.playLogs = g.playLogs.filter((l) => !drop.includes(l));
        for (const sl of drop) { undoSubLog(g, sl, nameOf); removed += 1; }
      }
      if (!removed) return state;
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 打者の再割り当て(交代の記録から、各打席の打者を振り直す) =====
    // 付け替えを重ねて実際の出場と食い違ったとき(1人が同じ回に2打席ある等)の修復。
    // 打順は動かさず、各打席の「誰が打ったか」だけを交代の記録に合わせ直す。
    case 'REBUILD_BATTERS': {
      const g = deep(state.games[action.gameId]);
      const n = rebuildBatters(g, (id) => playerNameOf(state, id));
      if (!n.total) return state;
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== 投手成績の再集計(交代タイムラインに基づき、守備プレイを正しい投手へ振り直す) =====
    // 実体は純粋関数 rebuildPitchingStats(src/lib/pitchingRebuild.js)。
    // 打席のアウトに加えて走塁アウトも数え、さらに「完了した守備イニング=3アウト」で
    // 照合するため、記録漏れによる投球回のズレが自動で埋まる。勝利/S/Hは保持する。
    case 'RECOMPUTE_PITCHING': {
      const g = deep(state.games[action.gameId]);
      const { records, lastPitcherId } = rebuildPitchingStats(g);
      if (records.length) {
        g.pitchingRecords = records;
        g.currentPitcherId = lastPitcherId || g.currentPitcherId;
      }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== スコアの手動修正(回を指定して±) =====
    case 'ADJUST_SCORE': {
      const g = deep(state.games[action.gameId]);
      const key = action.team === 'my' ? 'my' : 'opp';
      const inn = String(action.inning);
      if (!g.linescore) g.linescore = {};
      if (!g.linescore[inn]) g.linescore[inn] = { my: 0, opp: 0 };
      const nextInn = g.linescore[inn][key] + action.delta;
      const nextTotal = (key === 'my' ? g.myScore : g.oppScore) + action.delta;
      if (nextInn < 0 || nextTotal < 0) return state;
      g.linescore[inn][key] = nextInn;
      if (key === 'my') g.myScore = nextTotal;
      else g.oppScore = nextTotal;
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }

    // ===== Undo =====
    case 'UNDO': {
      const hist = [...state.history];
      const last = hist.pop();
      if (!last) return state;
      const games = { ...state.games, [last.gameId]: last.game };
      return { ...state, games, history: hist };
    }

    default:
      return state;
  }
}

// 直前状態を履歴に積む(呼び出しはreducer内の変異アクションから)
function pushHistory(state, action) {
  const gameId = action.gameId;
  const game = state.games[gameId];
  if (!game) return state.history;
  const entry = { gameId, game: deep(game), label: action.type, ts: Date.now() };
  const hist = [...state.history, entry];
  if (hist.length > UNDO_LIMIT) hist.shift();
  return hist;
}

// 走者移動の適用: moves = [{from: 1|2|3, to: 2|3|4|'out'}]
// 戻り値: { runs, advanced, outsFromMoves }
function applyRunnerMoves(game, moves, { eventKind, erChoices = {}, unearnedRuns = {} } = {}) {
  let runs = 0;
  let advanced = false;
  let outsFromMoves = 0;
  // 3塁→2塁→1塁の順に処理(前の走者から)
  const sorted = [...(moves || [])].sort((a, b) => b.from - a.from);
  for (const mv of sorted) {
    const runner = game.runners[mv.from];
    if (!runner) continue;
    game.runners[mv.from] = null;
    if (mv.to === 'out') {
      game.outs += 1;
      outsFromMoves += 1;
    } else if (mv.to === 4) {
      runs += 1;
      addRun(game, {
        playerId: runner.playerId || null,
        // 継投跨ぎの自責点帰属: erChoices[from] = pitcherId 指定があれば優先
        erChoice: erChoices[mv.from] || runner.pitcherId || null,
        viaError: !!unearnedRuns[mv.from] || !!runner.viaError,
      });
      if (runner.playerId) {
        game.playLogs.push(newPlayLog({
          gameId: game.id, inning: game.inning, isTop: game.isTop, kind: 'run',
          text: '得点', payload: { playerId: runner.playerId },
        }));
      }
      advanced = true;
    } else if (mv.to > mv.from) {
      game.runners[mv.to] = runner;
      advanced = true;
    } else {
      game.runners[mv.to] = runner; // 通常は起きないが保険
    }
  }
  return { runs, advanced, outsFromMoves };
}

// 得点処理: スコア加算 + 回ごとの得点(線分表示用) + (守備時)投手の失点/自責点
function addRun(game, { playerId, erChoice, viaError }) {
  const myBatting = isMyTeamBatting(game);
  const inn = String(game.inning);
  if (!game.linescore) game.linescore = {}; // 旧データ保険
  if (!game.linescore[inn]) game.linescore[inn] = { my: 0, opp: 0 };
  if (myBatting) {
    game.myScore += 1;
    game.linescore[inn].my += 1;
  } else {
    game.oppScore += 1;
    game.linescore[inn].opp += 1;
    // 失点・自責点の帰属先: erChoice(責任投手) > 現投手
    const pid = erChoice || game.currentPitcherId;
    if (pid) {
      const pr = ensurePitchingRecord(game, pid);
      pr.runs += 1;
      if (!viaError) pr.earnedRuns += 1;
    }
  }
}

// ------------------------------------------------------------
// Context
// ------------------------------------------------------------
const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => {
    const saved = loadPersisted();
    if (saved) {
      const games = Object.fromEntries(
        Object.entries(saved.games || {}).map(([id, g]) => [id, ensureOppFields(g)])
      );
      // 設定は既定値とマージする(保存後に追加された設定キーの欠落を補う)。旧エディション表記も正規化
      const settings = { ...init.settings, ...(saved.settings || {}) };
      settings.edition = normalizeEdition(settings.edition) || init.settings.edition;
      return { ...init, ...saved, settings, games };
    }
    // 新規チーム(まだデータ未保存): チーム切り替え/招待参加で決まったメタ情報を反映
    const meta = listProfiles().find((p) => p.id === getActiveProfileId());
    if (meta) {
      return {
        ...init,
        settings: {
          ...init.settings,
          teamName: meta.name,
          edition: meta.edition,
          officialTeamId: meta.officialTeamId || null,
          officialRole: meta.officialRole || null, // 招待参加/接続時に決まったロールを初期反映(観戦URLの権限を即時有効化)
        },
      };
    }
    return init;
  });

  // 永続化(変更のたび、軽くデバウンス)
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(state), 150);
    return () => clearTimeout(timer.current);
  }, [state]);

  // チーム切り替えリストの表示名/エディション/クラウド接続を、設定変更のたびレジストリ側にも同期する
  useEffect(() => {
    const id = getActiveProfileId();
    if (id) {
      updateProfileMeta(id, {
        name: state.settings.teamName,
        edition: state.settings.edition,
        officialTeamId: state.settings.officialTeamId || null,
      });
    }
  }, [state.settings.teamName, state.settings.edition, state.settings.officialTeamId]);

  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

// 便利セレクタ
export function usePlayerName() {
  const { state } = useStore();
  const map = Object.fromEntries(state.players.map((p) => [p.id, p.name]));
  return (id) => map[id] || '不明';
}

// 表示言語の翻訳フック。t('tab.home') のように使う(辞書は lib/i18n.js)。
// 言語は settings.lang(ja/en)。今後の英語化はこの t() 経由に順次移行する。
export function useT() {
  const { state } = useStore();
  const lang = state.settings.lang || DEFAULT_LANG;
  return (key, params) => translate(lang, key, params);
}

export function useCurrentGame() {
  const { state } = useStore();
  return state.currentGameId ? state.games[state.currentGameId] : null;
}

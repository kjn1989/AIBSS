// ============================================================
// 状態管理: React標準機能のみ (useReducer + Context)
// - localStorage へ自動永続化(オフライン完全動作)
// - Firestore 同期は lib/cloud.js が本ストアの状態を購読して行う
// - Undo: 試合データのスナップショットを履歴スタックに積む
// ============================================================
import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import {
  newPlayer, newMember, newGame, newAtBat, newPitch, newPlayLog, newPitchingRecord, RESULTS, DIRECTIONS, OUT_TYPES, SO_TYPES,
  OPP_LETTERS,
} from '../lib/model.js';
import { generateDemoData } from '../lib/demo.js';
import { idbSave } from '../lib/durableStore.js';

export const STORAGE_KEY = 'bbscorer.v1';
const UNDO_LIMIT = 50;

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
    firebaseConfigText: '', // 設定画面で貼り付けるJSON
    cloudEnabled: false,
    teamCode: '', // Firestore上のチーム識別子
    anthropicApiKey: '', // 音声解釈のLLM拡張(任意)
    useLLM: false,
    geminiApiKey: '', // AI選手名鑑のスカウト寸評生成(任意)
    lastBackupAt: null, // 最後にJSONバックアップを保存した時刻(データ消失対策のリマインド用)
  },
  demoLoaded: false,
  // ---- 以下は永続化しないセッション状態 ----
  history: [], // Undo用: { gameId, game(deep copy), label }
  cloudStatus: 'off', // 'off' | 'connecting' | 'on' | 'error'
};

const PERSIST_KEYS = ['players', 'members', 'games', 'currentGameId', 'settings', 'demoLoaded'];

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 旧バージョンのセーブデータに後から追加されたフィールドの既定値を補う
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

export function persist(state) {
  try {
    const out = {};
    for (const k of PERSIST_KEYS) out[k] = state[k];
    const json = JSON.stringify(out);
    localStorage.setItem(STORAGE_KEY, json);
    idbSave(json); // IndexedDBミラー(非同期・失敗は無視。データ消失対策の二重化)
  } catch {
    /* 容量超過等は無視(次回保存で回復) */
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
    if (mv.to === 4) return `${baseName[mv.from]}塁走者 ${who}、生還`;
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
  return pr;
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
      return {
        ...state,
        players: Array.isArray(b.players) ? b.players : [],
        members: Array.isArray(b.members) ? b.members : [],
        games,
        currentGameId: b.currentGameId && games[b.currentGameId] ? b.currentGameId : null,
        settings: { ...state.settings, ...(b.settings || {}) },
        demoLoaded: !!b.demoLoaded,
        history: [], // 別データ由来のUndo履歴は破棄
      };
    }
    case 'SET_CLOUD_STATUS':
      return { ...state, cloudStatus: action.status };
    case 'MERGE_REMOTE': {
      // Firestoreからの差分反映: 試合は updatedAt が新しい方を採用(Last-Write-Wins)
      const games = { ...state.games };
      for (const g of action.games || []) {
        const local = games[g.id];
        if (!local || (g.updatedAt || 0) >= (local.updatedAt || 0)) games[g.id] = ensureOppFields(g);
      }
      const pmap = new Map(state.players.map((p) => [p.id, p]));
      for (const p of action.players || []) pmap.set(p.id, p);
      const players = [...pmap.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      return { ...state, games, players };
    }
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
      const p = newPlayer(action.name, action.number || '');
      return { ...state, players: [...state.players, p] };
    }
    case 'UPDATE_PLAYER': {
      const players = state.players.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p));
      return { ...state, players };
    }
    case 'DELETE_PLAYER':
      return { ...state, players: state.players.filter((p) => p.id !== action.id) };

    // ===== 参加メンバー(マネージャー/応援等) =====
    case 'ADD_MEMBER':
      return { ...state, members: [...(state.members || []), newMember(action.name, action.role)] };
    case 'UPDATE_MEMBER': {
      const members = (state.members || []).map((m) => (m.id === action.id ? { ...m, ...action.patch } : m));
      return { ...state, members };
    }
    case 'DELETE_MEMBER':
      return { ...state, members: (state.members || []).filter((m) => m.id !== action.id) };

    // ===== 試合 =====
    case 'CREATE_GAME': {
      const g = newGame(action.payload || {});
      return { ...state, games: { ...state.games, [g.id]: g }, currentGameId: g.id };
    }
    case 'SELECT_GAME':
      return { ...state, currentGameId: action.id };
    case 'DELETE_GAME': {
      const games = { ...state.games };
      delete games[action.id];
      const currentGameId = state.currentGameId === action.id ? null : state.currentGameId;
      return { ...state, games, currentGameId, history: state.history.filter((h) => h.gameId !== action.id) };
    }
    case 'DELETE_ALL_GAMES': {
      // 全試合を削除(登録選手・チーム設定は保持)。
      // デモ由来の試合・選手(id が 'demo-' で始まる)も一緒に片付ける
      const players = state.players.filter((p) => !p.id.startsWith('demo-'));
      return { ...state, games: {}, players, currentGameId: null, demoLoaded: false, history: [] };
    }
    case 'RESET_ALL': {
      // 完全初期化: 選手・メンバー・試合をすべて消す。チーム名など設定は保持する
      return {
        ...state,
        players: [],
        members: [],
        games: {},
        currentGameId: null,
        demoLoaded: false,
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
        text: action.label || '選手交代', payload: { order: action.order, in: action.playerId, out: outgoing },
      }));
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }
    case 'SET_POSITION': {
      // 守備位置のみ変更(交代を伴わない)
      const g = deep(state.games[action.gameId]);
      const slot = g.lineup.find((l) => l.order === action.order);
      if (slot) slot.position = action.position;
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
      // action.pitchType: 'ball' | 'strike' | 'foul'
      const g = deep(state.games[action.gameId]);
      const pending = ensurePending(g);
      pending.pitches.push(newPitch(action.pitchType));
      // 守備時は投手の球数も加算
      if (!isMyTeamBatting(g) && g.currentPitcherId) {
        ensurePitchingRecord(g, g.currentPitcherId).pitches += 1;
      }
      g.updatedAt = Date.now();
      return { ...state, games: { ...state.games, [g.id]: g }, history: pushHistory(state, action) };
    }
    case 'REMOVE_LAST_PITCH': {
      const g = deep(state.games[action.gameId]);
      if (g.pending?.pitches.length) {
        const removed = g.pending.pitches.pop();
        if (!isMyTeamBatting(g) && g.currentPitcherId && removed) {
          const pr = ensurePitchingRecord(g, g.currentPitcherId);
          pr.pitches = Math.max(0, pr.pitches - 1);
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
      const movedPlayerId = runnerPlayerIdBefore(state, action);
      applyRunnerMoves(g, action.moves, { eventKind: action.event, erChoices: action.erChoices });
      // 守備時: 走塁アウト(盗塁死・牽制死等)も投手のアウト数に加算
      if (!isMyTeamBatting(g) && g.currentPitcherId && g.outs > outsBefore) {
        ensurePitchingRecord(g, g.currentPitcherId).outsRecorded += g.outs - outsBefore;
      }
      const labels = { sb: '盗塁', cs: '盗塁死', wp: '暴投', pb: '捕逸', pickoff: '牽制死' };
      g.playLogs.push(newPlayLog({
        gameId: g.id, inning: g.inning, isTop: g.isTop, kind: action.event === 'sb' ? 'sb' : 'runner',
        text: labels[action.event] || '走者イベント',
        payload: { moves: action.moves, playerId: movedPlayerId },
      }));
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
        if (!myBatting && g.currentPitcherId) ensurePitchingRecord(g, g.currentPitcherId).pitches += 1;
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
      // 併殺: 追加アウト
      if (p.outType === 'dp') g.outs += 1;
      if (p.extraOuts) g.outs += p.extraOuts;

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
        // 進塁打: 走者あり凡打(三振以外のアウト)のみ対象
        const hadRunners = pending.snapshot.runners[1] || pending.snapshot.runners[2] || pending.snapshot.runners[3];
        if (p.result === 'out' && hadRunners) {
          ab.advSuccess = p.advSuccess !== undefined ? p.advSuccess : runsInfo.advanced;
        }
        ab.clutch = judgeClutch(pending.snapshot.scoreDiff, rbi, scoreBefore.my, scoreBefore.opp);
        g.atBats.push(ab);
        const resultLabel = (p.result === 'so' && SO_TYPES[p.soType]) || resultDef?.label || p.result;
        g.playLogs.push(newPlayLog({
          gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'atbat',
          text: `${action.batterName || ''} ${DIRECTIONS[p.direction] || ''}${resultLabel}` +
            (totalRuns ? ` (${totalRuns}点)` : '') +
            (p.result === 'so' && p.batterTo === 1 ? ' 振り逃げ' : ''),
          payload: {
            atBatId: ab.id, playerId: batter.playerId, order: batter.order, result: p.result,
            outType: p.outType || null, soType: p.result === 'so' ? p.soType || null : null,
            direction: p.direction, rbi, runs: totalRuns,
            beforeRunners: pending.snapshot.runners, outsBefore, balls, strikes, fouls, pitchCount: pitches.length,
            moveLines, scoreAfter: { my: g.myScore, opp: g.oppScore },
          },
        }));
        // 生還した打者の得点ログ
        if (batterScored) {
          g.playLogs.push(newPlayLog({
            gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'run',
            text: '生還', payload: { playerId: batter.playerId },
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
        g.playLogs.push(newPlayLog({
          gameId: g.id, inning: g.inning, isTop: g.isTop, kind: 'defense',
          text: `相手打者${oppBatter.letter}(${oppBatter.order}番): ${DIRECTIONS[p.direction] || ''}${oppResultLabel}` + (totalRuns ? ` (${totalRuns}失点)` : ''),
          payload: {
            result: p.result, direction: p.direction, outType: p.outType || null,
            soType: p.result === 'so' ? p.soType || null : null, runs: totalRuns,
            letter: oppBatter.letter, order: oppBatter.order,
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
      const p = action.patch; // { result, direction, outType, soType, rbi }
      const label = (p.result === 'so' && SO_TYPES[p.soType]) || RESULTS[p.result]?.label || p.result;
      const dir = DIRECTIONS[p.direction] || '';
      if (log.kind === 'atbat') {
        const ab = g.atBats.find((a) => a.id === log.payload.atBatId);
        if (ab) {
          ab.result = p.result;
          ab.direction = p.direction || null;
          ab.outType = p.result === 'out' ? p.outType || 'ground' : null;
          ab.soType = p.result === 'so' ? p.soType || 'swinging' : null;
          if (p.rbi !== undefined) ab.rbi = p.rbi;
        }
        const name = playerNameOf(state, log.payload.playerId);
        log.text = `${name} ${dir}${label}` + (log.payload.runs ? ` (${log.payload.runs}点)` : '');
      } else if (log.kind === 'defense') {
        log.text = `相手打者${log.payload.letter}(${log.payload.order}番): ${dir}${label}` +
          (log.payload.runs ? ` (${log.payload.runs}失点)` : '');
      }
      log.payload = {
        ...log.payload,
        result: p.result,
        direction: p.direction || null,
        outType: p.result === 'out' ? p.outType || 'ground' : null,
        soType: p.result === 'so' ? p.soType || 'swinging' : null,
        ...(p.rbi !== undefined ? { rbi: p.rbi } : {}),
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
          text: '生還', payload: { playerId: runner.playerId },
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

function runnerPlayerIdBefore(state, action) {
  const g = state.games[action.gameId];
  const mv = action.moves[0];
  return g?.runners?.[mv.from]?.playerId || null;
}

// ------------------------------------------------------------
// Context
// ------------------------------------------------------------
const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => {
    const saved = loadPersisted();
    if (!saved) return init;
    const games = Object.fromEntries(
      Object.entries(saved.games || {}).map(([id, g]) => [id, ensureOppFields(g)])
    );
    return { ...init, ...saved, games };
  });

  // 永続化(変更のたび、軽くデバウンス)
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(state), 150);
    return () => clearTimeout(timer.current);
  }, [state]);

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

export function useCurrentGame() {
  const { state } = useStore();
  return state.currentGameId ? state.games[state.currentGameId] : null;
}

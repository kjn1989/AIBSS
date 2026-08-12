// ============================================================
// 投手成績の再構築(交代タイムラインに基づく振り直し)
//
// 投手交代を時系列に辿り、各守備プレイの被安打・与四死球・奪三振・対戦打者・
// アウト・失点・球数を、その時点でマウンドにいた投手へ集計し直す。
//
// 投球回(アウト数)は2段構えで正確性を担保する:
//   1) ログに残るアウトを集計
//      - 打席のアウト(kind:'defense' の outsOnPlay)
//      - 走塁アウト(kind:'runner'/'sb' の outs。盗塁死・牽制死・走塁死など)
//   2) 「完了した守備イニングは必ず3アウト」という野球の原則で照合し、
//      記録漏れ(走塁アウトの outs を持たない旧データ等)をその回を締めた投手に補う
//
// 2) があるおかげで「3イニング投げ切ったのに2.2回になる」といったズレが
// 手動修正なしで解消する。なお1イニングも記録されていない守備回(相手の打席を
// 記録していない試合)には架空のアウトを足さない(下記 outs>0 のガード)。
//
// 注: 自責点は近似(全失点を自責として仮置き)。勝利/セーブ/ホールドは保持する。
// ただしタイブレークの回だけは、置いた走者が還った分を自責点から外す。
// 置いた走者が実際に還ったかまでは記録から追えないので、その回の失点のうち
// 置いた走者の人数ぶんを上限として外す(走者が残塁したのに他の走者で失点した場合は
// 引きすぎになる)。人が直せるよう、投手成績の修正シートから手で上書きできる。
// ============================================================
import { RESULTS, newPitchingRecord } from './model.js';
import { isTiebreakInning, rulesAtInning, runnersPlaced } from './rules.js';

// 投手交代を表すログか(kind:'pitcher' または 守備位置'投'のsub)
export const isPitcherChangeLog = (l) => l.kind === 'pitcher' || (l.kind === 'sub' && l.payload?.position === '投');

// ハーフイニングの時系列位置(同じ回なら表→裏)。イニングの完了判定に使う。
const halfPos = (inning, isTop) => Number(inning || 0) * 2 + (isTop ? 0 : 1);
const halfKey = (inning, isTop) => `${Number(inning || 0)}${isTop ? 'T' : 'B'}`;
// 自軍が守備につくハーフか(先攻=表に攻撃・裏に守備 / 後攻=その逆)
const isFieldingHalf = (game, isTop) => !!isTop === !!game.isHome;

// 先発投手を決める: スタメンの「投」→ 最初の交代のout → 最小appearanceOrderの登板記録
export function resolveStartPitcher(game) {
  const fromLineup = (game.startingLineup || []).find((l) => l.position === '投')?.playerId;
  if (fromLineup) return fromLineup;
  const firstChange = (game.playLogs || []).find(isPitcherChangeLog);
  if (firstChange?.payload?.out) return firstChange.payload.out;
  const recs = [...(game.pitchingRecords || [])].sort((a, b) => a.appearanceOrder - b.appearanceOrder);
  return recs[0]?.playerId || null;
}

// game.playLogs から投手成績を作り直す。
// 引数の game は呼び出し側でコピー済みであることを前提とし、
// 守備ログの payload.pitcherId(対左右split用)だけ正しい投手に書き戻す。
// 戻り値: { records, lastPitcherId, filledOuts } (filledOuts = 3アウト照合で補った数)
export function rebuildPitchingStats(game) {
  const startPitcher = resolveStartPitcher(game);
  const prevDec = {};
  for (const pr of game.pitchingRecords || []) prevDec[pr.playerId] = { win: pr.win, save: pr.save, hold: pr.hold };

  const recs = new Map();
  let appearance = 0;
  const ensure = (pid) => {
    if (!recs.has(pid)) {
      appearance += 1;
      const pr = newPitchingRecord({ gameId: game.id, playerId: pid, appearanceOrder: appearance });
      const d = prevDec[pid];
      if (d) { pr.win = d.win; pr.save = d.save; pr.hold = d.hold; }
      recs.set(pid, pr);
    }
    return recs.get(pid);
  };

  // 守備ハーフイニングごとの集計(3アウト照合用)。key -> { pos, outs, lastPitcherId }
  const halves = new Map();
  const touchHalf = (l, pid) => {
    if (!isFieldingHalf(game, l.isTop)) return null;
    const k = halfKey(l.inning, l.isTop);
    let h = halves.get(k);
    if (!h) {
      // タイブレークの回は、置いた走者の人数ぶんを自責点から外せる枠として持つ
      const tb = isTiebreakInning(game, l.inning) ? rulesAtInning(game, l.inning).tiebreak : null;
      h = {
        pos: halfPos(l.inning, l.isTop), outs: 0, lastPitcherId: pid || null,
        unearnedLeft: tb ? runnersPlaced(tb.runners) : 0,
      };
      halves.set(k, h);
    }
    if (pid) h.lastPitcherId = pid; // その回を締めた投手(記録漏れアウトの帰属先)
    return h;
  };
  // 失点のうち自責点として数える分。タイブレークの回は置いた走者ぶんを先に外す。
  let unearnedExcluded = 0;
  const earnedOf = (h, runs) => {
    if (!h || !runs || h.unearnedLeft <= 0) return runs;
    const off = Math.min(h.unearnedLeft, runs);
    h.unearnedLeft -= off;
    unearnedExcluded += off;
    return runs - off;
  };

  let cur = startPitcher;
  let lastPid = startPitcher;
  let maxPos = 0; // ログが存在する最後のハーフイニング位置
  if (cur) ensure(cur);

  for (const l of game.playLogs || []) {
    maxPos = Math.max(maxPos, halfPos(l.inning, l.isTop));
    if (isPitcherChangeLog(l) && l.payload?.in) {
      cur = l.payload.in;
      ensure(cur);
      touchHalf(l, cur);
      continue;
    }
    if (!cur) continue;
    const p = l.payload || {};
    if (l.kind === 'defense') {
      lastPid = cur;
      const pr = ensure(cur);
      const def = RESULTS[p.result];
      if (def?.hit) pr.hitsAllowed += 1;
      if (def?.ab) pr.abFaced = (pr.abFaced || 0) + 1;
      if (p.result === 'bb') pr.walks += 1;
      if (p.result === 'hbp') pr.hitByPitch += 1;
      if (p.result === 'so') pr.strikeouts += 1;
      pr.outsRecorded += p.outsOnPlay || 0;
      pr.runs += p.runs || 0;
      pr.pitches += p.pitchCount || 0;
      if (p.pitchCount) { const k = String(l.inning); pr.pitchesByInning[k] = (pr.pitchesByInning[k] || 0) + p.pitchCount; }
      l.payload = { ...p, pitcherId: cur }; // どの投手が投げたかを再設定(対左右split用)
      const h = touchHalf(l, cur);
      // 近似(自責=失点)。タイブレークで置いた走者ぶんだけ外す。手動調整で補正可
      pr.earnedRuns += earnedOf(h, p.runs || 0);
      if (h) h.outs += p.outsOnPlay || 0;
    } else if (l.kind === 'runner' || l.kind === 'sb') {
      // 走塁アウト(盗塁死・牽制死等)。守備側のときだけ投手のアウトに数える。
      const h = touchHalf(l, cur);
      if (h && p.outs) { ensure(cur).outsRecorded += p.outs; h.outs += p.outs; }
    }
  }

  // ---- 完了した守備イニングは必ず3アウト。足りない分をその回を締めた投手に補う ----
  // 最後のハーフは、試合終了済みなら完了とみなす(ただしサヨナラ負けは途中で終わる)。
  const walkOffAgainstUs = !game.isHome && game.status === 'finished' && (game.oppScore || 0) > (game.myScore || 0);
  let filledOuts = 0;
  for (const h of halves.values()) {
    const isLastHalf = h.pos >= maxPos;
    const complete = isLastHalf ? (game.status === 'finished' && !walkOffAgainstUs) : true;
    if (!complete) continue;
    if (h.outs <= 0 || h.outs >= 3) continue; // 未記録の回に架空のアウトを足さない
    const pid = h.lastPitcherId;
    if (!pid || !recs.has(pid)) continue;
    recs.get(pid).outsRecorded += 3 - h.outs;
    filledOuts += 3 - h.outs;
  }

  return { records: [...recs.values()], lastPitcherId: lastPid || null, filledOuts, unearnedExcluded };
}

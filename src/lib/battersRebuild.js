// ============================================================
// 打者の再割り当て(交代の記録から、各打席の打者を振り直す)
//
// 打席の「打順(order)」は入力時に確定していて動かない。一方で「誰が打ったか
// (playerId)」は、あとからの交代・付け替えで書き換わるため、操作を重ねるうちに
// 実際の出場と食い違うことがある(例: 1人が同じ回に2打席持つ)。
//
// そこでプレイログを時系列に辿り、打順ごとの「今その枠にいる選手」を追いながら、
// 各打席の打者をその選手へ振り直す。投手成績の再集計(pitchingRebuild.js)と同じ考え方で、
// 交代の記録を唯一の正とする。
// ============================================================
import { RESULTS, SO_TYPES, DIRECTIONS } from './model.js';
import { resolveStarters } from './lineupBox.js';

// 打席ログの表示テキストを組み立て直す(打者名が変わるため)
function atBatText(nameOf, payload) {
  const label = (payload.result === 'so' && SO_TYPES[payload.soType]) || RESULTS[payload.result]?.label || payload.result;
  const dir = DIRECTIONS[payload.direction] || '';
  return `${nameOf(payload.playerId)} ${dir}${label}` + (payload.runs ? ` (${payload.runs}点)` : '');
}

// game を破壊的に書き換え、変更した打席数を返す。
// game は呼び出し側でコピー済みであることを前提とする。
export function rebuildBatters(game, nameOf = () => '') {
  // 打順ごとの現在の占有者。先発から開始する。
  const occupant = new Map();
  for (const s of resolveStarters(game)) {
    if (s.playerId != null) occupant.set(s.order, s.playerId);
  }

  const abById = new Map((game.atBats || []).map((ab) => [ab.id, ab]));
  let changed = 0;

  for (const log of game.playLogs || []) {
    if (log.kind === 'sub') {
      const p = log.payload || {};
      if (p.order != null && p.in) occupant.set(p.order, p.in);
      continue;
    }
    if (log.kind !== 'atbat') continue;
    const p = log.payload || {};
    const who = occupant.get(p.order);
    if (!who || who === p.playerId) continue;
    log.payload = { ...p, playerId: who };
    log.text = atBatText(nameOf, log.payload);
    const ab = abById.get(p.atBatId);
    if (ab) ab.playerId = who;
    changed += 1;
  }

  if (changed) game.updatedAt = Date.now(); // 同期のLast-Write-Winsに確実に載せる
  return changed;
}

// 「1人の選手が同じ回に2打席以上ある」= 付け替えの誤りでしか起きない状態を検出する。
// 修復を促すかどうかの判定に使う。戻り値: [{ playerId, inning, count }]
export function findDuplicateAtBats(game) {
  const seen = new Map(); // `${playerId}|${inning}` -> count
  for (const ab of game.atBats || []) {
    if (!ab.result) continue;
    const key = `${ab.playerId}|${ab.snapshot?.inning || 0}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const out = [];
  for (const [key, count] of seen) {
    if (count < 2) continue;
    const [playerId, inning] = key.split('|');
    out.push({ playerId, inning: Number(inning), count });
  }
  return out.sort((a, b) => a.inning - b.inning);
}

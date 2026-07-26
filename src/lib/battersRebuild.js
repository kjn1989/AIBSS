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

  // 「その打順から抜ける記録」の集合。打順移動が正当かどうかの判定に使う。
  // 正当な移動(8番→9番)なら、元の打順に別の選手が入る交代が必ず記録されている。
  const leaves = new Set();
  for (const l of game.playLogs || []) {
    const p = l.payload || {};
    if (l.kind === 'sub' && p.out != null && p.order != null) leaves.add(`${p.order}|${p.out}`);
  }

  const abById = new Map((game.atBats || []).map((ab) => [ab.id, ab]));
  const bogusSubs = new Set(); // 矛盾した交代ログ(これ自体を消さないと出場表も直らない)
  let changed = 0;

  for (const log of game.playLogs || []) {
    if (log.kind === 'sub') {
      const p = log.payload || {};
      if (p.order == null || !p.in) continue;
      // 1人が同時に2つの打順を占めることはあり得ない。既に別の打順にいる選手が
      // 入ってくる場合、元の打順から抜ける記録があれば正当な打順移動として元を空け、
      // 無ければ誤って作られた交代とみなして採用しない(この交代が矛盾の発生源)。
      const cur = [...occupant.entries()].find(([o, pid]) => pid === p.in && o !== p.order);
      if (cur) {
        if (!leaves.has(`${cur[0]}|${p.in}`)) { bogusSubs.add(log.id); continue; }
        occupant.delete(cur[0]);
      }
      occupant.set(p.order, p.in);
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

  // 矛盾した交代ログを取り除く。残したままだと出場選手ツリー(打順ツリー・スコアシート)が
  // 1人を2つの打順に表示し続け、次に開いたときも同じ矛盾が出てしまう。
  if (bogusSubs.size) game.playLogs = game.playLogs.filter((l) => !bogusSubs.has(l.id));
  const total = changed + bogusSubs.size;
  if (total) game.updatedAt = Date.now(); // 同期のLast-Write-Winsに確実に載せる
  return { atBats: changed, removedSubs: bogusSubs.size, total };
}

// 「同じ回に、1人が別々の打順で打席を持っている」= 物理的にあり得ない状態を検出する。
// 同じ打順で2打席になるのは打者一巡で普通に起きるため、それは対象にしない。
// 修復を促すかどうかの判定に使う。戻り値: [{ playerId, inning, count }] (count=打順の数)
export function findDuplicateAtBats(game) {
  const orders = new Map(); // `${playerId}|${inning}` -> Set(order)
  for (const ab of game.atBats || []) {
    if (!ab.result || ab.order == null) continue;
    const key = `${ab.playerId}|${ab.snapshot?.inning || 0}`;
    if (!orders.has(key)) orders.set(key, new Set());
    orders.get(key).add(ab.order);
  }
  const out = [];
  for (const [key, set] of orders) {
    if (set.size < 2) continue; // 同じ打順での複数打席(打者一巡)は正常
    const [playerId, inning] = key.split('|');
    out.push({ playerId, inning: Number(inning), count: set.size });
  }
  return out.sort((a, b) => a.inning - b.inning);
}

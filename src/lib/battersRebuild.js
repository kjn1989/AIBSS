// ============================================================
// 打者の再割り当て(交代の記録から、各打席の打者を振り直す)
//
// 打席の「打順(order)」は入力時に確定していて動かない。一方で「誰が打ったか
// (playerId)」は、あとからの交代・付け替えで書き換わるため、操作を重ねるうちに
// 実際の出場と食い違うことがある。
//
// 方針:
//  1) プレイログを時系列に辿り、打順ごとの「今その枠にいる選手」を追って打席を割り当てる。
//  2) 割り当ての結果「1人が同じ回に2つの打順で打席を持つ」= 物理的にあり得ない状態が
//     残っていたら、その原因になった交代ログを外して 1) をやり直す。
//     残す打順は「先に入っていた方」(先発ならその打順)とし、後から入れた方の交代を捨てる。
// 交代ログの整合だけでは判定しきれない(正当な打順移動と誤った交代が同じ形になる)ため、
// 実際に矛盾した打席が出たかどうかで判定するのが確実。
// ============================================================
import { DIRECTIONS, resultLabelOf } from './model.js';
import { resolveStarters } from './lineupBox.js';

// 打席ログの表示テキストを組み立て直す(打者名が変わるため)
function atBatText(nameOf, payload) {
  const label = resultLabelOf(payload);
  const dir = DIRECTIONS[payload.direction] || '';
  return `${nameOf(payload.playerId)} ${dir}${label}` + (payload.runs ? ` (${payload.runs}点)` : '');
}

// 交代ログを1回辿って、各打席ログの担当打者を決める。
// skip: 無効にする交代ログの集合(ログオブジェクトそのものを鍵にする。idが無い過去データでも動く)
// 戻り値: { assign: Map(打席ログ → playerId), cause: Map(打席ログ → 原因の交代ログ|null) }
function walk(game, skip) {
  const occupant = new Map();  // order → playerId
  const causeBySlot = new Map(); // order → その枠に入れた交代ログid(先発はnull)
  for (const s of resolveStarters(game)) {
    if (s.playerId != null) occupant.set(s.order, s.playerId);
  }
  const assign = new Map();
  const cause = new Map();

  for (const log of game.playLogs || []) {
    if (log.kind === 'sub') {
      if (skip.has(log)) continue;
      const p = log.payload || {};
      if (p.order == null || !p.in) continue;
      // 元の打順は空けない。空けると矛盾(1人が2打順で打席)が「打者不明」になって
      // 見えなくなるため、あえて重複させ、下の突き合わせで原因の交代を特定する。
      // 正当な打順移動なら元の打順にも別の選手が入る交代があり、そこで自然に解消する。
      occupant.set(p.order, p.in);
      causeBySlot.set(p.order, log);
      continue;
    }
    if (log.kind !== 'atbat') continue;
    const order = log.payload?.order;
    const who = occupant.get(order);
    if (who == null) continue;
    assign.set(log, who);
    cause.set(log, causeBySlot.get(order) ?? null);
  }
  return { assign, cause };
}

// 割り当て結果から「同じ回に別々の打順で打席を持つ選手」を探す。
// 戻り値: [{ playerId, inning, logs: [打席ログ] }]
function conflictsOf(game, assign) {
  const byKey = new Map(); // `${playerId}|${inning}` → [log]
  for (const log of game.playLogs || []) {
    if (log.kind !== 'atbat') continue;
    const who = assign.get(log);
    if (who == null) continue;
    const key = `${who}|${log.inning || 0}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(log);
  }
  const out = [];
  for (const [key, logs] of byKey) {
    const orders = new Set(logs.map((l) => l.payload?.order));
    if (orders.size < 2) continue; // 同じ打順で複数打席(打者一巡)は正常
    const [playerId, inning] = key.split('|');
    out.push({ playerId, inning: Number(inning), logs });
  }
  return out;
}

// 打線の人数(通常9。DH等で増えることがあるので実データの最大打順を見る)
function lineupSize(game) {
  const orders = [9];
  for (const l of game.startingLineup || []) if (l.order != null) orders.push(l.order);
  for (const l of game.lineup || []) if (l.order != null) orders.push(l.order);
  for (const ab of game.atBats || []) if (ab.order != null) orders.push(ab.order);
  return Math.max(...orders);
}

// 自軍の打席を時系列に並べたもの
const myAtBatLogs = (game) => (game.playLogs || []).filter((l) => l.kind === 'atbat' && l.payload?.order != null);

// 打順は打席の並びで決まる(1→2→…→9→1→…)。この並びから外れている打席の数を返す。
// 0でなければ、記録された打順が実際の並びとずれている(例: ある回で6番だけ3打席、4番が0打席)。
export function findOrderBreaks(game) {
  const n = lineupSize(game);
  const logs = myAtBatLogs(game);
  let breaks = 0;
  for (let i = 1; i < logs.length; i++) {
    const expect = (logs[i - 1].payload.order % n) + 1;
    if (logs[i].payload.order !== expect) breaks += 1;
  }
  return breaks;
}

// 打順の振り直しをして良いか。
// 打席を全部は記録していない試合(要点だけ記録した等)では巡回の前提が成り立たず、
// 振り直すとかえって壊すため、「ほぼ巡回しているのに一部だけ崩れている」ときに限る。
export function canRebuildOrders(game) {
  const logs = myAtBatLogs(game);
  const breaks = findOrderBreaks(game);
  if (logs.length < 9 || breaks === 0) return false;
  return breaks <= logs.length * 0.25;
}

// 打席の並びから打順を振り直す。最初の打席の打順を起点に1つずつ進める。
// 戻り値: 直した打席数
function rebuildOrders(game) {
  const n = lineupSize(game);
  const logs = myAtBatLogs(game);
  if (!logs.length) return 0;
  const abById = new Map((game.atBats || []).map((ab) => [ab.id, ab]));
  let cur = logs[0].payload.order;
  let changed = 0;
  for (const log of logs) {
    if (log.payload.order !== cur) {
      log.payload = { ...log.payload, order: cur };
      const ab = abById.get(log.payload.atBatId);
      if (ab) ab.order = cur;
      changed += 1;
    }
    cur = (cur % n) + 1;
  }
  return changed;
}

// game を破壊的に書き換える。
// 戻り値: { atBats: 直した打席数, removedSubs: 取り除いた交代数, orders: 直した打順数, total }
export function rebuildBatters(game, nameOf = () => '') {
  // 打者の割り当ては打順を前提にするので、まず打順の並びを直す
  const orders = canRebuildOrders(game) ? rebuildOrders(game) : 0;
  const index = new Map((game.playLogs || []).map((l, i) => [l, i]));
  const skip = new Set();
  let result = walk(game, skip);

  // 矛盾が消えるまで、原因になった交代を外してやり直す(打順は9つなので数回で収束する)
  for (let pass = 0; pass < 10; pass++) {
    const conflicts = conflictsOf(game, result.assign);
    if (!conflicts.length) break;
    let dropped = false;
    for (const c of conflicts) {
      // 打順ごとに「その枠へ入れた交代」を集め、先に入っていた方(先発ならnull)を残す
      const byOrder = new Map();
      for (const log of c.logs) {
        const order = log.payload?.order;
        if (!byOrder.has(order)) byOrder.set(order, result.cause.get(log) ?? null);
      }
      const entries = [...byOrder.entries()];
      const rank = ([, causeLog]) => (causeLog == null ? -1 : index.get(causeLog) ?? Infinity);
      entries.sort((a, b) => rank(a) - rank(b));
      for (const [, causeLog] of entries.slice(1)) { // 先頭(最も早い)以外を捨てる
        if (causeLog != null && !skip.has(causeLog)) { skip.add(causeLog); dropped = true; }
      }
    }
    if (!dropped) break; // これ以上外せる交代が無い(元データの矛盾)
    result = walk(game, skip);
  }

  // ---- 反映 ----
  const abById = new Map((game.atBats || []).map((ab) => [ab.id, ab]));
  let changed = 0;
  for (const log of game.playLogs || []) {
    if (log.kind !== 'atbat') continue;
    const who = result.assign.get(log);
    const p = log.payload || {};
    if (who == null || who === p.playerId) continue;
    log.payload = { ...p, playerId: who };
    log.text = atBatText(nameOf, log.payload);
    const ab = abById.get(p.atBatId);
    if (ab) ab.playerId = who;
    changed += 1;
  }
  // 矛盾の原因になった交代ログは取り除く。残すと出場選手ツリーが1人を2打順に
  // 表示し続け、開き直すたびに同じ矛盾が出てしまう。
  if (skip.size) game.playLogs = game.playLogs.filter((l) => !skip.has(l));

  const total = changed + skip.size + orders;
  if (total) game.updatedAt = Date.now(); // 同期のLast-Write-Winsに確実に載せる
  return { atBats: changed, removedSubs: skip.size, orders, total };
}

// 「同じ回に、1人が別々の打順で打席を持っている」= 物理的にあり得ない状態を検出する。
// 同じ打順で2打席になるのは打者一巡で普通に起きるため、それは対象にしない。
// 修復を促すかどうかの判定に使う。戻り値: [{ playerId, inning, count }] (count=打順の数)
export function findDuplicateAtBats(game) {
  const orders = new Map(); // `${playerId}|${inning}` → Set(order)
  for (const ab of game.atBats || []) {
    if (!ab.result || ab.order == null) continue;
    const key = `${ab.playerId}|${ab.snapshot?.inning || 0}`;
    if (!orders.has(key)) orders.set(key, new Set());
    orders.get(key).add(ab.order);
  }
  const out = [];
  for (const [key, set] of orders) {
    if (set.size < 2) continue;
    const [playerId, inning] = key.split('|');
    out.push({ playerId, inning: Number(inning), count: set.size });
  }
  return out.sort((a, b) => a.inning - b.inning);
}

// ------------------------------------------------------------
// いま打席に入るはずの打順(記録から導く)
//
// 打順は記録の並びで決まる。最後に記録した打席の次の枠が、次に来る打者。
// 画面が持っている打者ポインタ(batterIndex / oppBatterIndex)がこれとずれていたら、
// 記録と画面が食い違っている。
//
// 打席を直したり消したりすると、ここがずれたまま試合が進んでしまい、
// 実際の打者とアプリの打者が1人違う、という事故になる。
// 戻り値: 期待されるインデックス(0始まり) | null(まだ判断できない)
// ------------------------------------------------------------
function expectedIndexFrom(logs, lineup) {
  if (!logs.length || !lineup.length) return null;
  const lastOrder = logs[logs.length - 1].payload.order;
  const i = lineup.findIndex((l) => Number(l.order) === Number(lastOrder));
  if (i < 0) return null;
  return (i + 1) % lineup.length;
}

export function expectedBatterIndex(game) {
  return expectedIndexFrom(myAtBatLogs(game), game?.lineup || []);
}

export function expectedOppBatterIndex(game) {
  const logs = (game?.playLogs || []).filter((l) => l.kind === 'defense' && l.payload?.order != null);
  return expectedIndexFrom(logs, game?.oppLineup || []);
}

// 画面の打者と記録がずれているか。ずれていれば、あるべきインデックスを返す。
// mine=true で自チーム、false で相手。ずれていなければ null。
export function batterDrift(game, mine) {
  if (!game) return null;
  const expected = mine ? expectedBatterIndex(game) : expectedOppBatterIndex(game);
  if (expected == null) return null;
  const cur = Number(mine ? game.batterIndex : game.oppBatterIndex) || 0;
  return expected === cur ? null : expected;
}

// ============================================================
// 出場選手のボックススコア生成(伝統的な「位置」表記つき)
//
// プロ野球のスコア表記に合わせ、打順スロットごとに「登場順」で各選手を1行に並べ、
// その選手の出場のしかた+守備位置を1つの記号列で表す:
//   先発        … 守備位置を括弧で囲む            例) (二) (遊) (指)
//   守備位置変更 … 続けて連結                       例) (中左) = 中堅→左翼
//   代打        … 「打」、その後守備につけば連結    例) 打中 = 代打→中堅
//   代走        … 「走」、その後守備につけば連結    例) 走三 = 代走→三塁
//   守備交代    … 守備位置のみ                      例) 右 / 投(リリーフ)
//
// 入力: game(startingLineup / lineup / playLogs)。過去データ(kind/position無し)でも
//       できる範囲で復元する。DH は表示上「指」に読み替える。
// ============================================================

// 守備位置コード→フル表記(カード表示用)。例: 投→投手 / 遊→遊撃 / DH→指名打者。
import { rulesAtInning } from './rules.js';
import { isPitcherChangeLog, resolveStartPitcher } from './pitchingRebuild.js';

// 各回の投手。投手はスタメン表に「投」として載っているとは限らない。
// スコア入力画面の投手欄(SET_PITCHER)で選んだだけの場合、打順の守備位置は
// 空のままなので、そのままでは「投手を守る人が居ない」と誤って警告してしまう。
function pitcherByInning(game, maxInning) {
  const out = new Map();
  let cur = resolveStartPitcher(game) || game?.currentPitcherId || null;
  const logs = (game?.playLogs || []).filter(isPitcherChangeLog);
  let i = 0;
  for (let inn = 1; inn <= maxInning; inn++) {
    while (i < logs.length && (Number(logs[i].inning) || 1) <= inn) {
      if (logs[i].payload?.in) cur = logs[i].payload.in;
      i += 1;
    }
    out.set(inn, cur);
  }
  return out;
}

// その回の守備に、投手を「投」として足す。
// すでに誰かが「投」に就いているときは触らない(記録を上書きしない)。
// 打順に居る投手はその枠を「投」にし、打順外(DH等)は枠の無い守備として足す。
function withPitcher(arr, pitcherId) {
  if (!pitcherId || arr.some((s) => s.position === '投')) return arr;
  const slot = arr.find((s) => s.playerId === pitcherId);
  if (slot) return arr.map((s) => (s === slot ? { ...s, position: '投' } : s));
  return [...arr, { order: null, playerId: pitcherId, position: '投' }];
}

// その回に宣言されている守備人数。宣言が無ければ null(旧データ・未設定)。
function declaredFieldCount(game, inning) {
  const n = Number(rulesAtInning(game, inning)?.fieldCount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const POS_FULL_JA = { 投: '投手', 捕: '捕手', 一: '一塁', 二: '二塁', 三: '三塁', 遊: '遊撃', 左: '左翼', 中: '中堅', 右: '右翼', DH: '指名打者' };
const POS_FULL_EN = { 投: 'P', 捕: 'C', 一: '1B', 二: '2B', 三: '3B', 遊: 'SS', 左: 'LF', 中: 'CF', 右: 'RF', DH: 'DH' };
export function posFull(code, lang = 'ja') {
  if (!code) return '';
  return (lang === 'en' ? POS_FULL_EN[code] : POS_FULL_JA[code]) || code;
}

// 守備位置コード→表示1文字。守備につかない擬似位置(打/控)は空を返す。
export function posChar(pos) {
  if (!pos) return '';
  if (pos === 'DH') return '指';
  return ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'].includes(pos) ? pos : '';
}

// 1選手ぶんの出場記録(marks)から位置表記を組み立てる。
// marks: [{ kind:'start'|'ph'|'pr'|'def'|'move', position }]
function composeNotation(marks) {
  const isStart = marks[0]?.kind === 'start';
  let prefix = '';
  const positions = [];
  for (const m of marks) {
    if (m.kind === 'ph') prefix = '打';
    else if (m.kind === 'pr') prefix = '走';
    const c = posChar(m.position);
    if (c && positions[positions.length - 1] !== c) positions.push(c);
  }
  if (isStart) {
    const body = positions.join('') || posChar(marks[0].position);
    return body ? `(${body})` : ''; // 守備位置不明の先発(過去データ)は空表示
  }
  const body = prefix + positions.join('');
  return body || '—';
}

// 各打順スロットの「先発」を決める。
// startingLineup があればそれを使う。無い過去試合は、その打順で最初に行われた
// 交代の out(交代前にいた選手)を先発とみなす(交代が無ければ現lineupの選手)。
export function resolveStarters(game) {
  if (game.startingLineup && game.startingLineup.length) {
    return game.startingLineup.map((s) => ({ order: s.order, playerId: s.playerId, position: s.position || null }));
  }
  const firstOut = new Map(); // order -> 最初の交代前にいた選手
  for (const log of game.playLogs || []) {
    if (log.kind === 'sub') {
      const p = log.payload || {};
      if (p.out != null && !firstOut.has(p.order)) firstOut.set(p.order, p.out);
    }
  }
  const orders = new Set();
  for (const l of game.lineup || []) orders.add(l.order);
  for (const o of firstOut.keys()) orders.add(o);
  for (const ab of game.atBats || []) if (ab.order != null) orders.add(ab.order);

  const out = [];
  for (const order of orders) {
    const cur = (game.lineup || []).find((l) => l.order === order);
    if (firstOut.has(order)) {
      // 先発の元ポジションは交代で上書き済み。過去データではその打順の現守備位置から推定し、
      // 先発を必ず括弧つきの正規表示にする(単純な守備交代・代打→守備なら概ね一致)。
      out.push({ order, playerId: firstOut.get(order), position: cur?.position || null });
    } else if (cur && cur.playerId != null) {
      out.push({ order, playerId: cur.playerId, position: cur.position || null });
    }
  }
  return out;
}

// 打順スロットごとに登場順の選手行を作る。
// 戻り値: [{ order, players: [{ playerId, notation, isStarter }] }]
export function buildLineupRows(game) {
  const byOrder = new Map(); // order -> [{ playerId, marks:[] }]
  const ensure = (order) => {
    if (!byOrder.has(order)) byOrder.set(order, []);
    return byOrder.get(order);
  };

  for (const s of resolveStarters(game)) {
    if (s.playerId == null) continue;
    ensure(s.order).push({ playerId: s.playerId, marks: [{ kind: 'start', position: s.position }], inning: null });
  }

  for (const log of game.playLogs || []) {
    if (log.kind === 'sub') {
      const p = log.payload || {};
      if (p.in == null) continue;
      const chain = ensure(p.order);
      if (chain[chain.length - 1]?.playerId === p.in) continue; // 同一選手の二重追加を防ぐ(保険)
      chain.push({ playerId: p.in, marks: [{ kind: p.kind || 'def', position: p.position || null }], inning: log.inning || null });
    } else if (log.kind === 'position') {
      const p = log.payload || {};
      const chain = byOrder.get(p.order);
      const cur = chain && chain[chain.length - 1];
      if (cur && cur.playerId === p.playerId) cur.marks.push({ kind: 'move', position: p.position || null });
    }
  }

  // 最終出場者の守備位置は現lineupを正とする。位置ログが残っていない守備位置変更
  // (交代の記録経由で lineup だけ変わった場合など)も表記の連結に反映する。
  // 例: 5回に代打で入って左翼→6回から一塁 なら「打左一」。
  for (const [order, chain] of byOrder) {
    const cur = (game.lineup || []).find((l) => l.order === order);
    const last = chain[chain.length - 1];
    if (!cur || !last || last.playerId !== cur.playerId || !cur.position) continue;
    const shown = [...last.marks].reverse().map((m) => m.position).find((p) => posChar(p)) || null;
    if (shown !== cur.position) last.marks.push({ kind: 'move', position: cur.position });
  }

  const rows = [...byOrder.keys()].sort((a, b) => a - b).map((order) => ({
    order,
    players: byOrder.get(order).map((e, i) => {
      const kind = e.marks[0]?.kind || 'def';
      const isStarter = i === 0 && kind === 'start';
      // 表示用の守備位置コード(その選手が最後に就いた守備位置)
      const posCode = [...e.marks].reverse().map((m) => m.position).find((p) => posChar(p)) || null;
      return {
        playerId: e.playerId,
        notation: composeNotation(e.marks), // 伝統表記(スコアシート用)
        isStarter,
        role: isStarter ? 'start' : kind,   // start / ph(代打) / pr(代走) / def(守備)
        inning: e.inning ?? null,           // 交代で入った回(先発はnull)
        posCode,                            // 守備位置コード(投捕一二三遊左中右/DH) or null
        fromOrder: null,                    // 別の打順から移ってきた場合その打順(継続出場)
        toOrder: null,                      // このあと別の打順へ移る場合その打順
      };
    }),
  }));

  // 同じ選手が別の打順スロットに現れる=「途中出場」ではなく「出場を続けたまま打順が移った」
  // (守備位置の入れ替えを伴う交代でよく起きる)。そのままだと新しいスロット側が
  // 途中出場に見えてしまうため、移動元/移動先の打順番号を付けて系譜を辿れるようにする。
  const byPlayer = new Map(); // playerId -> [{ order, inning, p }]
  for (const row of rows) {
    for (const p of row.players) {
      if (!byPlayer.has(p.playerId)) byPlayer.set(p.playerId, []);
      byPlayer.get(p.playerId).push({ order: row.order, inning: p.inning, p });
    }
  }
  for (const list of byPlayer.values()) {
    if (list.length < 2) continue;
    const seq = [...list].sort((a, b) => (a.inning ?? -1) - (b.inning ?? -1));
    for (let i = 0; i < seq.length; i++) {
      const prev = seq[i - 1];
      const next = seq[i + 1];
      // 同一スロットへの再登場(リエントリー・再登板)は打順移動ではないので付けない
      if (prev && prev.order !== seq[i].order) seq[i].p.fromOrder = prev.order;
      if (next && next.order !== seq[i].order) seq[i].p.toOrder = next.order;
    }
  }
  return rows;
}

// 選手ごとに「主たる出場行(=最初に出場した行)」を決め、その選手の打席・盗塁を
// すべてそこに集約する。
//
// 同じ選手は、リエントリーや再登板で同じ打順に複数回現れることも、守備の入れ替えで
// 別の打順へ移ることもある。行ごとに打席を振り分けると1人の打撃成績が複数行に散り、
// スコアシートが読みにくくなる(逆に何も制御しないと全行に同じ打席が重複表示される)。
// そこで「1人の打撃結果は1行」に統一する。集約先でない行は打撃欄を空にして、
// 0打数と紛らわしくならないようにする(位置表記と ←/→ の印で系譜は追える)。
//
// rows: buildLineupRows(game) の戻り値(全打順ぶん)
// 戻り値: Map<行の選手オブジェクト, { atBats, sb, primary, primaryOrder }>
export function assignAtBatsByPlayer(rows, atBats = [], sbLogs = []) {
  const innOf = (p) => (p.inning == null ? -Infinity : Number(p.inning)); // 先発は最先
  const primary = new Map(); // playerId -> { p, order }
  for (const row of rows) {
    for (const p of row.players) {
      const cur = primary.get(p.playerId);
      if (!cur || innOf(p) < innOf(cur.p)) primary.set(p.playerId, { p, order: row.order });
    }
  }

  const out = new Map();
  for (const row of rows) {
    for (const p of row.players) {
      const top = primary.get(p.playerId);
      out.set(p, { atBats: [], sb: 0, primary: top?.p === p, primaryOrder: top?.order ?? row.order });
    }
  }
  for (const ab of atBats) {
    const top = primary.get(ab.playerId);
    if (top) out.get(top.p).atBats.push(ab);
  }
  for (const log of sbLogs) {
    const pid = log.payload?.playerId;
    const top = pid != null ? primary.get(pid) : null;
    if (top) out.get(top.p).sb += 1;
  }
  return out;
}

// 守備位置の整合チェック。
// 同じ位置に2人いる／守るべき位置に誰も居ない、は交代や訂正の取りこぼしでしか起きない。
// 例: 捕手が交代したのに位置が一塁のままだと「一塁が2人・捕手が不在」になる。
//
// いつ起きているかが分かるよう、交代を回ごとに辿って各回の守備陣を作り、
// 問題が続いている回を範囲(from〜to)にまとめて返す。
// 戻り値: { duplicates: [{ position, playerIds, from, to }], missing: [{ position, from, to }] }
const STANDARD_POSITIONS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
// 1人しか就けない守備位置。「打」(全員打ち)と「控」は複数人でも正常なので除く。
const FIELD_POSITIONS = new Set([...STANDARD_POSITIONS, 'DH']);

// 回ごとの守備陣(打順→{playerId, position})を作る。回N の状態は「N回までの交代を適用した形」。
export function alignmentByInning(game) {
  const slots = new Map();
  for (const s of resolveStarters(game)) {
    if (s.playerId != null) slots.set(s.order, { playerId: s.playerId, position: s.position || null });
  }
  const logs = (game.playLogs || []).filter((l) => l.kind === 'sub' || l.kind === 'position');
  const maxInning = Math.max(1, ...(game.playLogs || []).map((l) => Number(l.inning) || 1));
  const pitchers = pitcherByInning(game, maxInning);
  const out = new Map();
  let i = 0;
  for (let inn = 1; inn <= maxInning; inn++) {
    while (i < logs.length && (Number(logs[i].inning) || 1) <= inn) {
      const l = logs[i];
      const p = l.payload || {};
      if (l.kind === 'sub' && p.order != null && p.in) {
        slots.set(p.order, { playerId: p.in, position: p.position || slots.get(p.order)?.position || null });
      } else if (l.kind === 'position' && p.order != null) {
        const cur = slots.get(p.order);
        if (cur && cur.playerId === p.playerId) cur.position = p.position || cur.position;
      }
      i += 1;
    }
    const arr = [...slots.entries()].filter(([, v]) => v.playerId && v.position).map(([order, v]) => ({ order, ...v }));
    out.set(inn, withPitcher(arr, pitchers.get(inn)));
  }
  // 最終回は現lineupを正とする(位置ログが残っていない変更を取りこぼさない)
  const last = (game.lineup || []).filter((l) => l.playerId && l.position);
  if (last.length) {
    out.set(maxInning, withPitcher(
      last.map((l) => ({ order: l.order, playerId: l.playerId, position: l.position })),
      pitchers.get(maxInning),
    ));
  }
  return out;
}

// 連続する回を範囲にまとめる: [3,4,5,7] -> [{from:3,to:5},{from:7,to:7}]
function toRanges(innings) {
  const sorted = [...new Set(innings)].sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n === last.to + 1) last.to = n;
    else out.push({ from: n, to: n });
  }
  return out;
}

export function findPositionIssues(game) {
  const byInning = alignmentByInning(game);
  const dupSeen = new Map();  // `${position}|${playerIds}` -> { position, playerIds, innings }
  const missSeen = new Map(); // position -> innings
  const slotSeen = new Map(); // playerId -> { orders:Set, innings:[] } (同じ選手が2つの打順に居る)

  for (const [inn, slots] of byInning) {
    const byPos = new Map();
    const byPlayer = new Map();
    for (const s of slots) {
      if (!byPos.has(s.position)) byPos.set(s.position, []);
      byPos.get(s.position).push(s.playerId);
      if (s.order != null) {
        if (!byPlayer.has(s.playerId)) byPlayer.set(s.playerId, new Set());
        byPlayer.get(s.playerId).add(s.order);
      }
    }
    // 同じ選手が同時に2つの打順に入っている(記録の重ねがけで起きる)
    for (const [playerId, orders] of byPlayer) {
      if (orders.size < 2) continue;
      if (!slotSeen.has(playerId)) slotSeen.set(playerId, { playerId, orders: new Set(), innings: [] });
      const e = slotSeen.get(playerId);
      for (const o of orders) e.orders.add(o);
      e.innings.push(inn);
    }
    // その回に宣言されている守備人数。10人守備(4外野)なら同じ位置に2人が正常、
    // 8人以下なら守備位置が空くのが正常。宣言はイニング単位で効く(途中で人が帰る)。
    const declared = declaredFieldCount(game, inn);
    for (const [position, playerIds] of byPos) {
      // 「打」(全員打ち)や「控」は複数人が正常なので守備位置の重複としては見ない
      if (!FIELD_POSITIONS.has(position)) continue;
      if (declared > 9) continue; // 10人守備を宣言しているなら重複は正常
      // 同じ選手が2枠に居るだけの場合は「2人が同じ位置」ではない(上の slotSeen で扱う)
      const distinct = [...new Set(playerIds)];
      if (distinct.length < 2) continue;
      const key = `${position}|${[...distinct].sort().join(',')}`;
      if (!dupSeen.has(key)) dupSeen.set(key, { position, playerIds: distinct, innings: [] });
      dupSeen.get(key).innings.push(inn);
    }
    // 守備位置が9つ揃うはずの布陣のときだけ「不在」を見る(DHや人数不足の試合で誤警告しない)。
    // 人数を宣言していればそれに従い、宣言が無い試合(旧データ含む)は
    // これまでどおり打順の枠数から推し量る。
    const realSlots = slots.filter((s) => s.order != null).length;
    const expectAll = declared ? declared >= 9 : realSlots >= 9;
    if (expectAll) {
      for (const p of STANDARD_POSITIONS) {
        if (byPos.has(p)) continue;
        if (!missSeen.has(p)) missSeen.set(p, []);
        missSeen.get(p).push(inn);
      }
    }
  }

  const duplicates = [];
  for (const d of dupSeen.values()) {
    for (const r of toRanges(d.innings)) duplicates.push({ position: d.position, playerIds: d.playerIds, ...r });
  }
  const missing = [];
  for (const [position, innings] of missSeen) {
    for (const r of toRanges(innings)) missing.push({ position, ...r });
  }
  const sameSlots = [];
  for (const s of slotSeen.values()) {
    for (const r of toRanges(s.innings)) sameSlots.push({ playerId: s.playerId, orders: [...s.orders].sort((a, b) => a - b), ...r });
  }
  return { duplicates, missing, sameSlots };
}

// カード/ツリー表示用の“役割ラベル種別”を返す。守備交代で投手に就く=救援。
export function roleTag(p) {
  if (p.isStarter || p.role === 'start') return null; // 先発はバッジ無し(引き算のデザイン)
  if (p.role === 'ph') return 'ph';
  if (p.role === 'pr') return 'pr';
  if (p.role === 'def' && p.posCode === '投') return 'relief';
  return 'def';
}

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
function resolveStarters(game) {
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
      out.push({ order, playerId: firstOut.get(order), position: null }); // 先発の位置は交代で上書き済み=不明
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
    ensure(s.order).push({ playerId: s.playerId, marks: [{ kind: 'start', position: s.position }] });
  }

  for (const log of game.playLogs || []) {
    if (log.kind === 'sub') {
      const p = log.payload || {};
      if (p.in == null) continue;
      const chain = ensure(p.order);
      if (chain[chain.length - 1]?.playerId === p.in) continue; // 同一選手の二重追加を防ぐ(保険)
      chain.push({ playerId: p.in, marks: [{ kind: p.kind || 'def', position: p.position || null }] });
    } else if (log.kind === 'position') {
      const p = log.payload || {};
      const chain = byOrder.get(p.order);
      const cur = chain && chain[chain.length - 1];
      if (cur && cur.playerId === p.playerId) cur.marks.push({ kind: 'move', position: p.position || null });
    }
  }

  // 位置不明の「最終出場者」には、現lineupの守備位置を補う(過去データの守備交代を拾う)
  for (const [order, chain] of byOrder) {
    const cur = (game.lineup || []).find((l) => l.order === order);
    const last = chain[chain.length - 1];
    if (cur && last && last.playerId === cur.playerId && cur.position) {
      if (!last.marks.some((m) => posChar(m.position))) last.marks.push({ kind: 'move', position: cur.position });
    }
  }

  return [...byOrder.keys()].sort((a, b) => a - b).map((order) => ({
    order,
    players: byOrder.get(order).map((e, i) => ({
      playerId: e.playerId,
      notation: composeNotation(e.marks),
      isStarter: i === 0 && e.marks[0]?.kind === 'start',
    })),
  }));
}

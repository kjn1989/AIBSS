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
      };
    }),
  }));
}

// スロット(打順)内の各登場行に、その打順の打席・盗塁を1つずつ割り当てる。
// 同じ選手が再登場(リエントリー/救援→再登板など)した場合、そのままだと
// 全登場行が「その選手の全打席」を拾って二重表示になる。打席・盗塁の回を見て、
// その回以下で最も遅く始まった登場の行にだけ入れることで重複を防ぐ。
// players: buildLineupRows(...).players の1スロット分(各要素は { playerId, inning })
// 戻り値: { abBuckets:[[atBat...]], sbCounts:[n...] }(players と同順・同長)
export function distributeToAppearances(players, atBats = [], sbLogs = []) {
  const entryInn = (p) => (p.inning == null ? -Infinity : Number(p.inning));
  // playerId と 回 から、割り当て先の登場行インデックスを選ぶ。
  const pickIndex = (pid, inn) => {
    let best = -1;
    let bestInn = -Infinity;
    for (let i = 0; i < players.length; i++) {
      if (players[i].playerId !== pid) continue;
      const e = entryInn(players[i]);
      // その登場が対象の回までに始まっていて、より遅く始まった登場を優先
      if (e <= inn && (best === -1 || e >= bestInn)) { best = i; bestInn = e; }
    }
    // 見つからない(登場回が打席回より後=データ矛盾)場合は最初の該当行へ
    if (best === -1) best = players.findIndex((p) => p.playerId === pid);
    return best;
  };
  const abBuckets = players.map(() => []);
  const sbCounts = players.map(() => 0);
  for (const ab of atBats) {
    const idx = pickIndex(ab.playerId, ab.snapshot?.inning || 1);
    if (idx !== -1) abBuckets[idx].push(ab);
  }
  for (const log of sbLogs) {
    const pid = log.payload?.playerId;
    if (pid == null) continue;
    const idx = pickIndex(pid, Number(log.inning) || 1);
    if (idx !== -1) sbCounts[idx] += 1;
  }
  return { abBuckets, sbCounts };
}

// カード/ツリー表示用の“役割ラベル種別”を返す。守備交代で投手に就く=救援。
export function roleTag(p) {
  if (p.isStarter || p.role === 'start') return null; // 先発はバッジ無し(引き算のデザイン)
  if (p.role === 'ph') return 'ph';
  if (p.role === 'pr') return 'pr';
  if (p.role === 'def' && p.posCode === '投') return 'relief';
  return 'def';
}

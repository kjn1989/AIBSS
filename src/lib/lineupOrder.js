// 打順そのものを直す。
//
// 交代とは別のものなので分けてある。交代は「途中でその枠の人が代わった」ことで、
// 代わる前の打席は前の選手のもの。こちらは「最初から並びが違っていた」ことなので、
// すでに記録した打席も本来の選手へ付け替える必要がある。
//
// 実際に起きたこと: 7番と8番を逆に組んだまま3回まで記録してしまった。
// 打席は画面に出ていた名前で残っているので、並びを直すだけでは記録が合わない。
//
// 交代で直すこともできない。同じ選手が2つの打順を占めないよう SUBSTITUTE が
// 止めるので、入れ替えの途中(片方が2枠に居る状態)を作れない。

// 隣どうしだけを入れ替える。離れた枠へ動かすと、その間の枠が全部ずれて
// 「どの打席が誰のものか」を1つずつ決め直すことになる。
// 隣との入れ替えを繰り返せば同じところへ届く。
export function canSwapOrder(game, orderA, orderB) {
  const a = Number(orderA);
  const b = Number(orderB);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return false;
  if (Math.abs(a - b) !== 1) return false;
  const lineup = game?.lineup || [];
  return lineup.some((l) => l.order === a) && lineup.some((l) => l.order === b);
}

// 入れ替えの中身を先に組み立てる。画面で「何件の記録が動くか」を出してから
// 押してもらうため、実行と分けてある。
// 戻り値: { lineup, startingLineup, reassign: [{ logId, newPlayerId }] } | null
export function swapOrderPlan(game, orderA, orderB) {
  if (!canSwapOrder(game, orderA, orderB)) return null;
  const a = Number(orderA);
  const b = Number(orderB);
  const lineup = (game.lineup || []).map((l) => ({ ...l }));
  const sa = lineup.find((l) => l.order === a);
  const sb = lineup.find((l) => l.order === b);
  const pa = sa.playerId;
  const pb = sb.playerId;

  // 守備位置は選手について回る。7番の左翼手と8番の遊撃手を入れ替えたら、
  // 打順だけが入れ替わって守る場所は変わらない
  const posA = sa.position;
  sa.playerId = pb;
  sa.position = sb.position;
  sb.playerId = pa;
  sb.position = posA;

  const swapIn = (list) => (list || []).map((l) => {
    if (l.order === a) return { ...l, playerId: pb, position: sa.position };
    if (l.order === b) return { ...l, playerId: pa, position: sb.position };
    return { ...l };
  });

  // すでに記録した打席のうち、この2人のものだけを付け替える。
  // 枠だけを見て一律に付け替えると、途中で入った代打の打席まで動いてしまう。
  const reassign = [];
  for (const l of game.playLogs || []) {
    if (l.kind !== 'atbat') continue;
    const who = l.payload?.playerId;
    const ord = Number(l.payload?.order);
    if (ord === a && who === pa) reassign.push({ logId: l.id, newPlayerId: pb });
    else if (ord === b && who === pb) reassign.push({ logId: l.id, newPlayerId: pa });
  }

  return {
    lineup,
    startingLineup: game.startingLineup?.length ? swapIn(game.startingLineup) : null,
    reassign,
  };
}

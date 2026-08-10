// 回の中の出来事の並べ替え。
// 交代は打席と打席の「間」に起きるので、打順×イニングのマス目では表せない。
// ログの並び順そのものが「どの打席の後か」なので、隣と入れ替えることでタイミングを直す。
//
// 打席同士は動かさない。打順は野球のルールで決まっていて人が並べ替えるものではなく、
// 動かせるようにすると打順の並びを壊す操作をこちらから用意することになる。

export const isPlateAppearance = (l) => l && (l.kind === 'atbat' || l.kind === 'defense');

// 入れ替える相手の位置を返す。動かせないときは -1。
// 回や表裏をまたいでは動かさない(5回の継投が3回に飛ぶような事故を防ぐ)。
export function swapTargetIndex(playLogs = [], logId, dir = 1) {
  const idx = playLogs.findIndex((l) => l.id === logId);
  if (idx < 0) return -1;
  const me = playLogs[idx];
  if (isPlateAppearance(me)) return -1;
  const step = dir < 0 ? -1 : 1;
  const to = idx + step;
  if (to < 0 || to >= playLogs.length) return -1;
  const other = playLogs[to];
  if (Number(other.inning) !== Number(me.inning)) return -1;
  if (!!other.isTop !== !!me.isTop) return -1;
  return to;
}

// 交代の行が「どの打席の後」に置かれているかを返す。
// 表示は行の位置から毎回導く。固定の文言にすると並べ替えた瞬間に嘘になる。
export function timingAnchor(rows = [], i) {
  for (let k = i - 1; k >= 0; k--) {
    if (isPlateAppearance(rows[k])) return rows[k];
  }
  return null;
}

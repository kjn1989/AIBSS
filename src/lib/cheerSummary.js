// クラウドの応援の集計(live_cheer_summary の形)を、画面と試合の記録で使う形にする。
//   aliases: 統合で消えた選手ID → 残した選手ID(その選手のコインに足し込む)
// 戻り値: { total, byStamp: {stamp: n}, byLog: {logId: {stamp: n}}, top: [上位3プレー], players: [{id, coins, n}] }
export function cheerSummary(r, aliases = null) {
  const byLog = {};
  const byStamp = {};
  for (const c of r?.cheers || []) {
    const n = Number(c.n) || 0;
    (byLog[c.log || ''] ||= {})[c.stamp] = n;
    byStamp[c.stamp] = (byStamp[c.stamp] || 0) + n;
  }
  const top = Object.entries(byLog)
    .filter(([log]) => log)
    .map(([log, m]) => ({ log, m, n: Object.values(m).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  const pm = new Map();
  for (const x of r?.players || []) {
    const id = (aliases && aliases.get(x.player)) || x.player;
    const cur = pm.get(id) || { id, coins: 0, n: 0 };
    cur.coins += Number(x.coins) || 0;
    cur.n += Number(x.n) || 0;
    pm.set(id, cur);
  }
  const players = [...pm.values()].sort((a, b) => b.coins - a.coins || b.n - a.n);
  return { total: Number(r?.total) || 0, byStamp, byLog, top, players };
}


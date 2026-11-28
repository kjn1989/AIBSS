// 応援スタンプの種類とコイン(supabase/live_cheer.sql の live_stamp_cost と同じ)
export const CHEER_STAMPS = ['clap', 'wow', 'fire', 'ball', 'mvp'];
export const CHEER_EMOJI = { clap: '👏', wow: '😱', fire: '🔥', ball: '⚾', mvp: '🏆', muscle: '💪' };
export const CHEER_COST = { clap: 0, wow: 0, fire: 1, ball: 3, mvp: 10 };
export const CHEER_WALLET = 50;

// そのプレーで応援を受け取る選手(自チームの選手だけ。相手の選手には贈らない)
//   自チームの打席 → 打者 / 守りの打席 → ファインプレーの野手、なければ投手
export function recipientOf(log) {
  if (!log) return null;
  const p = log.payload || {};
  if (log.kind === 'atbat') return p.playerId || null;
  if (log.kind === 'defense') return p.finePlay?.playerId || p.pitcherId || null;
  return null;
}

// 選手ごとの応援コインを、スタンプが付いたプレーから数え直す。
// クラウドに残っている「贈った相手の選手ID」は、贈った時点のもの。あとで選手を統合したり
// 名前の無い仮の選手を本人にまとめたりすると、そのIDはもう名簿に無く「不明」になる。
// プレーのほうは統合のときに付け替わっているので、プレーから引けば、いまの選手になる。
//   byLog: { logId: { stamp: n } }(cheerSummary の byLog)
export function playersFromLogs(game, byLog) {
  if (!game || !byLog) return null;
  const logs = new Map((game.playLogs || []).map((l) => [l.id, l]));
  const pm = new Map();
  for (const [logId, m] of Object.entries(byLog)) {
    const id = recipientOf(logs.get(logId));
    if (!id) continue;
    const cur = pm.get(id) || { id, coins: 0, n: 0 };
    for (const [stamp, n] of Object.entries(m)) {
      const cost = CHEER_COST[stamp] || 0;
      if (!cost) continue;
      cur.coins += cost * (Number(n) || 0);
      cur.n += Number(n) || 0;
    }
    if (cur.n) pm.set(id, cur);
  }
  return [...pm.values()].sort((a, b) => b.coins - a.coins || b.n - a.n);
}

// クラウドの応援の集計(live_cheer_summary の形)を、画面と試合の記録で使う形にする。
//   aliases: 統合で消えた選手ID → 残した選手ID(その選手のコインに足し込む)
//   game: その試合。あれば選手ごとのコインはプレーから数え直す(playersFromLogs)
// 戻り値: { total, byStamp: {stamp: n}, byLog: {logId: {stamp: n}}, top: [上位3プレー], players: [{id, coins, n}] }
export function cheerSummary(r, aliases = null, game = null) {
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
  const fromServer = [...pm.values()].sort((a, b) => b.coins - a.coins || b.n - a.n);
  // 試合が分かれば、プレーから数え直したほうを使う(統合した選手も正しい名前になる)
  const players = (game && playersFromLogs(game, byLog)) || fromServer;
  return { total: Number(r?.total) || 0, byStamp, byLog, top, players };
}


// ============================================================
// 大会(複数試合)のまとまり
//
// 大会名の欄には「AABC2026 初戦」「AABC2026 第2戦」「AABC2026 決勝」のように、
// 大会名のあとに何試合目かを書く使い方が多い。そのままでは3試合が別々の
// 「大会」になってしまうので、末尾の「何試合目か」を外した名前を大会とみなす。
//   AABC2026 初戦 / AABC2026 第2戦 / AABC2026 第3戦 → AABC2026
// 末尾に何も付いていなければ、大会名そのものが大会。
// ============================================================

const NUM = '[0-9０-９一二三四五六七八九十]+';
const ROUND_RE = new RegExp(
  '[\\s　]*[-ー－:：・/／(（]?[\\s　]*(?:'
  + [
    '初戦', '緒戦', `第${NUM}(?:戦|試合|節)`, `${NUM}(?:回戦|戦目|試合目|日目|戦)`,
    '予選(?:リーグ)?(?:[\\s　]*' + NUM + '(?:戦|試合)?)?', '決勝トーナメント(?:[\\s　]*' + NUM + '回戦)?',
    '準々決勝', '準決勝', '決勝', `${NUM}位決定戦`, '三位決定戦', '順位決定戦', '敗者復活戦?',
    `Day[\\s　]*${NUM}`, `Game[\\s　]*${NUM}`, `G${NUM}`,
    'Final', 'Semi[- ]?final', 'Quarter[- ]?final',
  ].join('|')
  + ')[)）]?$',
  'i',
);

// 大会名(大会名の欄から、何試合目かを外したもの)。空なら ''
export function tournamentOf(season) {
  const s = String(season || '').trim();
  if (!s) return '';
  let out = s;
  // 「予選リーグ 第2戦」のように重なっていることがあるので、外せるだけ外す
  for (let i = 0; i < 3; i++) {
    const next = out.replace(ROUND_RE, '').trim();
    if (!next || next === out) break;
    out = next;
  }
  return out;
}

// 試合を大会ごとにまとめる。2試合以上ある大会だけを、新しい順で返す
//   [{ name, games: [古い順] }]
export function tournaments(games = []) {
  const map = new Map();
  for (const g of games) {
    const name = tournamentOf(g?.season);
    if (!name) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(g);
  }
  const byOrder = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.startedAt || 0) - (b.startedAt || 0);
  return [...map.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, games: [...list].sort(byOrder) }))
    .sort((a, b) => (b.games[b.games.length - 1].date || '').localeCompare(a.games[a.games.length - 1].date || ''));
}

// 大会の戦績(勝ち・負け・引き分け・得点・失点)
export function tournamentRecord(games = []) {
  const r = { w: 0, l: 0, d: 0, rs: 0, ra: 0, ongoing: 0 };
  for (const g of games) {
    r.rs += g.myScore || 0;
    r.ra += g.oppScore || 0;
    if (g.status !== 'finished') { r.ongoing += 1; continue; }
    if ((g.myScore || 0) > (g.oppScore || 0)) r.w += 1;
    else if ((g.myScore || 0) < (g.oppScore || 0)) r.l += 1;
    else r.d += 1;
  }
  return r;
}

// ============================================================
// 対戦成績(マッチアップ)
//
// 「自軍投手 × 相手打者」「自軍打者 × 相手投手」を試合をまたいで積み上げる。
//
// 相手選手は試合ごとの記号(A〜T)で記録しているため、記号そのものには
// 試合をまたぐ意味が無い。そこで「対戦相手チーム名 + 相手選手名」を
// 同一人物の鍵として使う。名前は任意入力なので、
//   - 名前が入っている相手だけが通算の対戦成績に出る
//   - 名前を後から入れれば、過去の試合ぶんも遡って繋がる
// という振る舞いになる。新しい保存項目を増やさないので移行も要らない。
//
// 対戦の組み合わせは既に記録済み:
//   - 相手打席(kind:'defense')には pitcherId(自軍投手)と letter(相手打者)が入っている
//   - 自軍打席(kind:'atbat')には相手投手が入っていないが、opppitcher ログの
//     時系列を辿れば「その打席のときマウンドに居た記号」が分かる
// ============================================================
import { RESULTS } from './model.js';
import { oppNameOf, oppHasName } from './oppBox.js';

// 表記ゆれの吸収。全角/半角・空白・記号・大文字小文字をならす。
// 「上智大学女子野球部 Mamues」と「上智大学女子野球部Mamues」を同じ鍵にするため。
export function normalizeName(s) {
  return String(s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　･・.,-]/g, '')
    .toLowerCase()
    .trim();
}

// 相手選手の同一人物キー。名前が未入力なら null(通算には数えない)。
export function oppPlayerKey(game, letter) {
  if (!oppHasName(game, letter)) return null;
  const team = normalizeName(game?.opponent);
  const name = normalizeName(oppNameOf(game, letter));
  if (!name) return null;
  return `${team}|${name}`;
}

// 自軍の各打席について、そのときマウンドに居た相手投手の記号を返す。
// 戻り値: Map<打席ログID, 記号>
export function oppPitcherByAtBat(game) {
  const logs = game?.playLogs || [];
  const changes = logs.filter((l) => l.kind === 'opppitcher');
  // 先発 = 最初の交代の out。交代が無ければ現在の投手がそのまま先発。
  let cur = changes.length ? (changes[0].payload?.out || null) : (game?.oppPitcherLetter || null);
  const out = new Map();
  for (const l of logs) {
    if (l.kind === 'opppitcher') {
      if (l.payload?.in) cur = l.payload.in;
      continue;
    }
    if (l.kind === 'atbat' && cur) out.set(l.id, cur);
  }
  return out;
}

// 打撃側の集計の入れもの
function newBat() {
  return { pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, hbp: 0, so: 0, sf: 0, rbi: 0, tb: 0, games: new Set() };
}

function applyBat(s, p) {
  const def = RESULTS[p.result];
  if (!def) return;
  s.pa += 1;
  if (def.ab) s.ab += 1;
  if (def.hit) s.h += 1;
  if (p.result === 'double') s.double += 1;
  if (p.result === 'triple') s.triple += 1;
  if (p.result === 'hr') s.hr += 1;
  if (p.result === 'bb') s.bb += 1;
  if (p.result === 'hbp') s.hbp += 1;
  if (p.result === 'so') s.so += 1;
  if (p.result === 'sacFly') s.sf += 1;
  s.rbi += p.rbi || 0;
  s.tb += ({ single: 1, double: 2, triple: 3, hr: 4 })[p.result] || 0;
}

// 打率・出塁率・長打率。分母0は null(「-」表示)にして .000 と区別する。
export function matchupRates(s) {
  const obDen = s.ab + s.bb + s.hbp + s.sf;
  const obp = obDen > 0 ? (s.h + s.bb + s.hbp) / obDen : null;
  const slg = s.ab > 0 ? s.tb / s.ab : null;
  return {
    avg: s.ab > 0 ? s.h / s.ab : null,
    obp,
    slg,
    ops: obp !== null && slg !== null ? obp + slg : null,
  };
}

// 試合群から対戦成績を組み立てる。
// 戻り値: {
//   batting:  [{ key, myPlayerId, oppName, oppTeam, ...集計 }]  自軍打者 vs 相手投手
//   pitching: [{ key, myPlayerId, oppName, oppTeam, ...集計 }]  自軍投手 vs 相手打者
// }
// key は自軍選手ID + 相手選手キーの組で、行の同定に使う。
export function buildMatchups(games = []) {
  const batting = new Map(); // `${myId}|${oppKey}` -> 集計
  const pitching = new Map();

  const cell = (map, k, myPlayerId, oppKey, oppName, oppTeam) => {
    if (!map.has(k)) map.set(k, { key: k, myPlayerId, oppKey, oppName, oppTeam, ...newBat() });
    return map.get(k);
  };

  for (const g of games) {
    if (!g) continue;
    const oppTeam = g.opponent || '';
    // --- 自軍打者 × 相手投手 ---
    const pitcherAt = oppPitcherByAtBat(g);
    for (const l of g.playLogs || []) {
      if (l.kind !== 'atbat') continue;
      const letter = pitcherAt.get(l.id);
      if (!letter) continue;
      const oppKey = oppPlayerKey(g, letter);
      if (!oppKey) continue; // 名前が未入力の相手投手は通算に数えない
      const myId = l.payload?.playerId;
      if (!myId) continue;
      const s = cell(batting, `${myId}|${oppKey}`, myId, oppKey, oppNameOf(g, letter), oppTeam);
      applyBat(s, l.payload || {});
      s.games.add(g.id);
    }
    // --- 自軍投手 × 相手打者 ---
    for (const l of g.playLogs || []) {
      if (l.kind !== 'defense') continue;
      const p = l.payload || {};
      const myId = p.pitcherId;
      const letter = p.letter;
      if (!myId || !letter) continue;
      const oppKey = oppPlayerKey(g, letter);
      if (!oppKey) continue;
      const s = cell(pitching, `${myId}|${oppKey}`, myId, oppKey, oppNameOf(g, letter), oppTeam);
      // 相手の打点は自軍視点では取れないため、その打席で入った失点を打点として扱う
      applyBat(s, { ...p, rbi: p.runs || 0 });
      s.games.add(g.id);
    }
  }

  const finish = (map) => [...map.values()]
    .map((s) => ({ ...s, games: s.games.size, ...matchupRates(s) }))
    .sort((a, b) => b.pa - a.pa);
  return { batting: finish(batting), pitching: finish(pitching) };
}

// 相手チームごとの通算対戦成績(勝敗と得失点)。
// 「このチームとは通算何勝何敗か」を出すのに使う。
export function opponentSummaries(games = []) {
  const map = new Map();
  for (const g of games) {
    if (!g || g.status !== 'finished') continue;
    const key = normalizeName(g.opponent);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, name: g.opponent, games: 0, win: 0, lose: 0, draw: 0, rs: 0, ra: 0 });
    const s = map.get(key);
    s.games += 1;
    s.rs += g.myScore || 0;
    s.ra += g.oppScore || 0;
    if ((g.myScore || 0) > (g.oppScore || 0)) s.win += 1;
    else if ((g.myScore || 0) < (g.oppScore || 0)) s.lose += 1;
    else s.draw += 1;
  }
  return [...map.values()].sort((a, b) => b.games - a.games);
}

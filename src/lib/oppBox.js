// ============================================================
// 相手チームの出場選手ツリー + その試合の打撃成績
//
// 草野球では対戦相手が毎回変わるため、相手選手は記号(A〜T)で記録している。
// ただし自軍の投手成績をつけている時点で、相手の打席結果は 'defense' ログとして
// すべて残っている。ここではそれを打順ツリー(自軍と同じ形)へ組み直す。
//
// 蓄積成績(通算)は持たない。あくまで「その試合の記録」だけを扱う。
// 名前は game.oppNames[letter] に任意で入る(未入力なら記号のまま)。
// ============================================================
import { RESULTS } from './model.js';

// 記号→表示名。未入力なら記号そのまま(A, B, …)。
export function oppNameOf(game, letter) {
  if (!letter) return '';
  return (game?.oppNames && game.oppNames[letter]) || letter;
}

// 名前が入っているかどうか(仮の記号のままかの判定に使う)
export function oppHasName(game, letter) {
  return !!(game?.oppNames && game.oppNames[letter]);
}

const innOf = (l) => Number(l?.inning || 0);

// 打順ツリー: [{ order, players:[{ letter, inning, isStarter, posCode }] }]
// 先発は「その打順で最初に記録された交代の out」。交代が無ければ現在の記号。
export function buildOppLineupRows(game) {
  const lineup = [...(game?.oppLineup || [])].sort((a, b) => a.order - b.order);
  if (!lineup.length) return [];
  const subs = (game.playLogs || [])
    .filter((l) => l.kind === 'oppsub' && l.payload?.order != null && l.payload?.in)
    .sort((a, b) => innOf(a) - innOf(b));

  const rows = [];
  for (const slot of lineup) {
    const mine = subs.filter((s) => s.payload.order === slot.order);
    const starter = mine[0]?.payload?.out || slot.letter;
    const players = [{ letter: starter, inning: null, isStarter: true, posCode: null }];
    for (const s of mine) {
      if (s.payload.in === players[players.length - 1].letter) continue; // 同じ記号の重複記録は畳む
      players.push({ letter: s.payload.in, inning: innOf(s) || null, isStarter: false, posCode: null });
    }
    // 現在の記号がツリーに出てこない(交代ログが無い)場合は末尾に足す
    if (!players.some((p) => p.letter === slot.letter)) {
      players.push({ letter: slot.letter, inning: null, isStarter: false, posCode: null });
    }
    rows.push({ order: slot.order, players });
  }
  return rows;
}

// 登板した記号(先発投手 + 継投)。ツリーに出ない投手を別枠で見せるのに使う。
export function oppPitcherLetters(game) {
  const out = [];
  const add = (l) => { if (l && !out.includes(l)) out.push(l); };
  const changes = (game?.playLogs || []).filter((l) => l.kind === 'opppitcher');
  // 最初の交代の out が先発。交代が無ければ現在の投手が先発のまま。
  if (changes.length) add(changes[0].payload?.out);
  else add(game?.oppPitcherLetter);
  for (const c of changes) add(c.payload?.in);
  return out.filter(Boolean);
}

// 記号ごとの、その試合の打撃成績。相手の打席は 'defense' ログに入っている。
// 打点は相手側の集計が無いため、その打席で入った得点(runs)を打点として扱う。
export function oppBattingByLetter(game) {
  const map = new Map();
  for (const l of game?.playLogs || []) {
    if (l.kind !== 'defense') continue;
    const p = l.payload || {};
    const def = RESULTS[p.result];
    if (!p.letter || !def) continue;
    const cur = map.get(p.letter) || { pa: 0, ab: 0, h: 0, rbi: 0, hr: 0 };
    cur.pa += 1;
    if (def.ab) cur.ab += 1;
    if (def.hit) cur.h += 1;
    if (p.result === 'hr') cur.hr += 1;
    cur.rbi += p.runs || 0;
    map.set(p.letter, cur);
  }
  // 盗塁は走者ログに記号が入らない(自軍選手idのみ)ため、相手側では集計しない
  return map;
}

// その試合に出てきた相手の記号を、打順→交代順に並べて返す(名前編集の一覧に使う)
export function oppLettersInGame(game) {
  const out = [];
  for (const row of buildOppLineupRows(game)) {
    for (const p of row.players) if (!out.includes(p.letter)) out.push(p.letter);
  }
  for (const l of oppPitcherLetters(game)) if (!out.includes(l)) out.push(l);
  return out;
}

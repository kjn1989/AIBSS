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

// 相手投手のその試合の成績。
// 球数は入力時に記録している(game.oppPitchers)。それ以外は自軍の打席記録から逆算する:
// 継投ログ(opppitcher)で「いつ誰が投げていたか」が分かるので、その間の自軍の打席を
// その投手に帰属させれば、投球回・被安打・四死球・奪三振・失点が出せる。
// 自責点だけは相手の守備エラーを追っていないため出さない。
export function oppPitchingStats(game) {
  const logs = game?.playLogs || [];
  const changes = logs.filter((l) => l.kind === 'opppitcher');
  // 先発 = 最初の交代の out。交代が無ければ現在の投手がそのまま先発。
  let cur = changes.length ? (changes[0].payload?.out || null) : (game?.oppPitcherLetter || null);
  const map = new Map();
  const get = (letter) => {
    if (!map.has(letter)) {
      map.set(letter, { letter, outs: 0, bf: 0, h: 0, hr: 0, bb: 0, hbp: 0, k: 0, runs: 0, pitches: 0 });
    }
    return map.get(letter);
  };
  if (cur) get(cur);
  const myHalfIsTop = !game?.isHome; // 自軍の攻撃はどちらの半回か
  // 「完了した回は必ず3アウト」で照合するため、自軍の攻撃ハーフごとに集計する
  const halves = new Map(); // key -> { pos, outs, lastLetter }
  let maxPos = 0;
  const touchHalf = (l, letter) => {
    if (!!l.isTop !== myHalfIsTop) return null;
    const pos = Number(l.inning || 0) * 2 + (l.isTop ? 0 : 1);
    const k = String(pos);
    let h = halves.get(k);
    if (!h) { h = { pos, outs: 0, lastLetter: letter || null }; halves.set(k, h); }
    if (letter) h.lastLetter = letter; // その回を締めた投手(記録漏れアウトの帰属先)
    return h;
  };

  for (const l of logs) {
    maxPos = Math.max(maxPos, Number(l.inning || 0) * 2 + (l.isTop ? 0 : 1));
    if (l.kind === 'opppitcher') {
      if (l.payload?.in) { cur = l.payload.in; get(cur); touchHalf(l, cur); }
      continue;
    }
    if (!cur) continue;
    if (l.kind === 'atbat') {
      const p = l.payload || {};
      const def = RESULTS[p.result];
      const r = get(cur);
      r.bf += 1;
      r.outs += p.outsOnPlay || 0;
      if (def?.hit) r.h += 1;
      if (p.result === 'hr') r.hr += 1;
      if (p.result === 'bb') r.bb += 1;
      if (p.result === 'hbp') r.hbp += 1;
      if (p.result === 'so') r.k += 1;
      r.runs += p.runs || 0;
      const h = touchHalf(l, cur);
      if (h) h.outs += p.outsOnPlay || 0;
    } else if (l.kind === 'runner' || l.kind === 'sb') {
      // 自軍の走塁アウト(盗塁死・牽制死)も、その回を投げた相手投手のアウトに数える
      const h = touchHalf(l, cur);
      const outs = Number(l.payload?.outs || 0);
      if (h && outs) { get(cur).outs += outs; h.outs += outs; }
    }
  }

  // 完了した回は3アウト。記録漏れ(走塁アウトのouts未保存など)をその回を締めた投手に補う。
  // サヨナラ勝ちの最終回は3アウトで終わらないので対象外にする。
  const walkOffWin = !!game?.isHome && game?.status === 'finished' && (game?.myScore || 0) > (game?.oppScore || 0);
  for (const h of halves.values()) {
    const isLastHalf = h.pos >= maxPos;
    const complete = isLastHalf ? (game?.status === 'finished' && !walkOffWin) : true;
    if (!complete) continue;
    if (h.outs <= 0 || h.outs >= 3) continue; // 記録の無い回に架空のアウトを足さない
    const r = h.lastLetter && map.get(h.lastLetter);
    if (r) r.outs += 3 - h.outs;
  }
  // 球数は記録済みの実数を使う(打席に至らない投球も数えているため、こちらが正)
  for (const [letter, r] of map) r.pitches = game?.oppPitchers?.[letter]?.pitches || 0;
  return [...map.values()];
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

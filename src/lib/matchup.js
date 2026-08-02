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

// ============================================================
// 対戦相手チームの台帳(導出)
//
// チーム名は自由入力なので、表記ゆれがあると対戦成績が分断される。
// 過去の対戦相手を候補として出し、入口で選ばせることで揺れを防ぐ。
// ============================================================

// 過去の対戦相手。最後に対戦した順。
// 戻り値: [{ name, key, games, lastDate }]
export function opponentTeams(games = []) {
  const map = new Map();
  for (const g of games) {
    const name = (g?.opponent || '').trim();
    if (!name) continue;
    const key = normalizeName(name);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { key, name, games: 1, lastDate: g.date || '' });
    } else {
      cur.games += 1;
      // 表記が揺れている場合は、最後に使った書き方を採用する
      if ((g.date || '') >= cur.lastDate) { cur.lastDate = g.date || ''; cur.name = name; }
    }
  }
  return [...map.values()].sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
}

// そのチームと最後に対戦した試合から、相手の並び(記号・名前・守備位置・左右)を取り出す。
// 次の試合の下ごしらえに使う。名前を入れる手間が「次に当たるとき」に返ってくることが、
// 相手選手名を入力し続けてもらえるかどうかの分かれ目になる。
export function lastOppRoster(games = [], teamName) {
  const key = normalizeName(teamName);
  if (!key) return null;
  const rows = games
    .filter((g) => normalizeName(g.opponent) === key && (g.oppLineup || []).length)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const g = rows[0];
  if (!g) return null;
  const named = Object.keys(g.oppNames || {}).length;
  return {
    fromGameId: g.id,
    fromDate: g.date || '',
    namedCount: named,
    lineup: (g.oppLineup || []).map((l) => ({ order: l.order, letter: l.letter, position: l.position || '' })),
    oppNames: { ...(g.oppNames || {}) },
    oppPositions: { ...(g.oppPositions || {}) },
    oppBatterHands: { ...(g.oppBatterHands || {}) },
    oppPitcherHands: { ...(g.oppPitcherHands || {}) },
    oppPitcherLetter: g.oppPitcherLetter || 'A',
  };
}

// 相手選手ひとりの打席を、試合をまたいで集める。
// 打球方向(direction)は相手の打席にも記録されているので、守備シフトの判断材料になる。
// oppKey は oppPlayerKey が返す「チーム名|選手名」。
export function oppPlayerAtBats(games = [], oppKey) {
  if (!oppKey) return null;
  const atBats = [];
  let name = '';
  let team = '';
  let hand = '';
  const kind = { ground: 0, fly: 0, line: 0 }; // ゴロ/フライ/ライナーの別
  const dir = { pull: 0, center: 0, oppo: 0 };
  let sb = 0; let cs = 0; let sacBunt = 0;
  const gameIds = new Set();

  for (const g of games) {
    // その試合で、この選手に当たる記号を先に割り出す
    const letters = new Set();
    for (const l of g.playLogs || []) {
      const lt = l.payload?.letter;
      if (lt && oppPlayerKey(g, lt) === oppKey) letters.add(lt);
    }
    for (const lt of Object.keys(g.oppNames || {})) {
      if (oppPlayerKey(g, lt) === oppKey) letters.add(lt);
    }
    if (!letters.size) continue;
    team = g.opponent || team;
    for (const lt of letters) {
      name = name || (g.oppNames || {})[lt] || '';
      hand = hand || (g.oppBatterHands || {})[lt] || '';
    }

    for (const l of g.playLogs || []) {
      const p = l.payload || {};
      if (!p.letter || !letters.has(p.letter)) continue;
      if (l.kind === 'defense') {
        gameIds.add(g.id);
        // SprayChart がそのまま読める形に揃える(自軍の打席と同じ描画を使う)
        atBats.push({ id: l.id, direction: p.direction || null, result: p.result, outType: p.outType || null });
        if (p.outType && kind[p.outType] != null) kind[p.outType] += 1;
        if (p.result === 'sacBunt') sacBunt += 1;
        // 引っ張り/逆方向は打者の左右で入れ替わる。左打者は右方向が引っ張り
        const d = p.direction;
        if (d) {
          const rightSide = d === 'RF' || d === '1B' || d === '2B';
          const leftSide = d === 'LF' || d === '3B' || d === 'SS';
          if (d === 'CF' || d === 'P' || d === 'C') dir.center += 1;
          else if ((hand === 'L' && rightSide) || (hand !== 'L' && leftSide)) dir.pull += 1;
          else if (rightSide || leftSide) dir.oppo += 1;
        }
      } else if (l.kind === 'sb') sb += 1;
      else if (l.kind === 'runner' && l.text === '盗塁死') cs += 1;
    }
  }
  if (!atBats.length && !sb && !cs) return null;
  return { oppKey, name, team, hand, atBats, kind, dir, sb, cs, sacBunt, games: gameIds.size };
}

// ============================================================
// 相手バッテリーの隙(暴投・捕逸・牽制・盗塁阻止)
//
// 草野球・学生野球では、ここが一番点になる。「この捕手からは走れる」が
// 分かるだけで作戦が1つ増える。
//
// 記録はすべて既にある:
//   自軍の攻撃中(isTop が自軍の攻撃側)の sb / 盗塁死 / 暴投 / 捕逸 / 牽制死 は
//   すべて相手バッテリーの出来事。
// 誰の捕手だったかは、相手の守備位置と交代(oppsub)から辿る。
// ============================================================

// その試合で「捕手」を務めた記号を、回の進行順に並べる。
// 戻り値: [{ letter, fromInning }]
function oppCatcherTimeline(game) {
  const slot = (game?.oppLineup || []).find(
    (l) => (game.oppPositions || {})[l.letter] === '捕' || l.position === '捕',
  );
  // 守備位置が入っていない試合は辿れない(捕手を特定できないので空で返す)
  if (!slot) return [];
  const subs = (game.playLogs || [])
    .filter((l) => l.kind === 'oppsub' && l.payload?.order === slot.order && l.payload?.in)
    .sort((a, b) => Number(a.inning || 0) - Number(b.inning || 0));
  const start = subs.length ? (subs[0].payload.out || slot.letter) : slot.letter;
  const out = [{ letter: start, fromInning: 0 }];
  for (const s of subs) out.push({ letter: s.payload.in, fromInning: Number(s.inning || 0) });
  return out;
}

const catcherAt = (timeline, inning) => {
  let cur = null;
  for (const t of timeline) if (Number(inning || 0) >= t.fromInning) cur = t.letter;
  return cur;
};

// 相手バッテリーの集計。
// 戻り値: {
//   catchers: [{ letter, name, sbAllowed, caught, att, csRate }]  ← 自軍が走ったとき
//   pitchers: [{ letter, name, wp, bbHbp, pickoff }]
//   team: { pb, balk }
// }
export function oppBatteryStats(games = []) {
  const catchers = new Map();
  const pitchers = new Map();
  const team = { pb: 0, balk: 0 };

  const cat = (key, name) => {
    if (!catchers.has(key)) catchers.set(key, { key, name, sbAllowed: 0, caught: 0 });
    return catchers.get(key);
  };
  const pit = (key, name) => {
    if (!pitchers.has(key)) pitchers.set(key, { key, name, wp: 0, bbHbp: 0, pickoff: 0 });
    return pitchers.get(key);
  };

  for (const g of games) {
    const myBattingIsTop = !g.isHome; // 自軍の攻撃はどちらの半回か
    const cTimeline = oppCatcherTimeline(g);
    const pAt = oppPitcherByAtBat(g);
    // 回ごとの相手投手(走者イベントは打席ログではないので、直前の打席から引く)
    let lastPitcher = null;

    for (const l of g.playLogs || []) {
      if (l.kind === 'atbat') {
        const lt = pAt.get(l.id);
        if (lt) lastPitcher = lt;
        // 与四死球は相手投手のもの
        if (lt && (l.payload?.result === 'bb' || l.payload?.result === 'hbp')) {
          const k = oppPlayerKey(g, lt);
          if (k) pit(k, oppNameOf(g, lt)).bbHbp += 1;
        }
        continue;
      }
      if (!!l.isTop !== myBattingIsTop) continue; // 自軍の攻撃中の出来事だけが相手バッテリーの隙
      const cLetter = catcherAt(cTimeline, l.inning);
      const cKey = cLetter ? oppPlayerKey(g, cLetter) : null;
      const pKey = lastPitcher ? oppPlayerKey(g, lastPitcher) : null;

      if (l.kind === 'sb') {
        if (cKey) cat(cKey, oppNameOf(g, cLetter)).sbAllowed += 1;
      } else if (l.kind === 'runner') {
        if (l.text === '盗塁死') { if (cKey) cat(cKey, oppNameOf(g, cLetter)).caught += 1; }
        else if (l.text === '暴投') { if (pKey) pit(pKey, oppNameOf(g, lastPitcher)).wp += 1; }
        else if (l.text === '捕逸') team.pb += 1;
        else if (l.text === '牽制死') { if (pKey) pit(pKey, oppNameOf(g, lastPitcher)).pickoff += 1; }
        else if (l.text === 'ボーク') team.balk += 1;
      }
    }
  }

  const cRows = [...catchers.values()].map((c) => {
    const att = c.sbAllowed + c.caught;
    // 企図0のときは阻止率を null にして 0% と区別する(「刺せない」と「試していない」は違う)
    return { ...c, att, csRate: att > 0 ? c.caught / att : null };
  }).sort((a, b) => b.att - a.att);
  const pRows = [...pitchers.values()]
    .filter((p) => p.wp || p.bbHbp || p.pickoff)
    .sort((a, b) => (b.wp + b.bbHbp) - (a.wp + a.bbHbp));
  return { catchers: cRows, pitchers: pRows, team };
}

// ============================================================
// 相手の機動力(走ってくるチームか、送ってくるチームか)
//
// 走者と結果はすべて相手の打席(defense)に記録されているので、
// 「どの場面で何を仕掛けてきたか」まで組み立てられる。
// ============================================================

// 走者とアウト数から場面の名前を作る。よく出る形だけを名前で持ち、他はまとめる。
const SITUATIONS = [
  { key: 'o0_1', outs: 0, on: '1' }, { key: 'o1_1', outs: 1, on: '1' },
  { key: 'o0_2', outs: 0, on: '2' }, { key: 'o1_2', outs: 1, on: '2' },
  { key: 'o0_12', outs: 0, on: '12' }, { key: 'o1_12', outs: 1, on: '12' },
  { key: 'o0_13', outs: 0, on: '13' }, { key: 'o1_13', outs: 1, on: '13' },
];
function situationKey(before, outs) {
  const on = [1, 2, 3].filter((b) => before?.[b]).join('');
  if (!on) return null; // 走者なしは仕掛けようがない
  const found = SITUATIONS.find((s) => s.outs === Number(outs || 0) && s.on === on);
  return found ? found.key : null;
}

export function oppOffenseStats(games = []) {
  const byPlayer = new Map(); // 相手選手ごとの走塁
  const sit = new Map();      // 場面ごとの仕掛け
  let sb = 0; let cs = 0; let sacBunt = 0; let sacFly = 0;
  let firstPitchSwings = 0; let paWithPitches = 0;

  const who = (g, letter) => {
    const key = oppPlayerKey(g, letter);
    if (!key) return null;
    if (!byPlayer.has(key)) {
      const order = (g.oppLineup || []).find((l) => l.letter === letter)?.order ?? null;
      byPlayer.set(key, { key, name: oppNameOf(g, letter), order, sb: 0, cs: 0 });
    }
    return byPlayer.get(key);
  };

  for (const g of games) {
    const oppBattingIsTop = !!g.isHome; // 相手の攻撃はどちらの半回か
    for (const l of g.playLogs || []) {
      const p = l.payload || {};
      if (l.kind === 'defense') {
        if (p.result === 'sacBunt') sacBunt += 1;
        if (p.result === 'sacFly') sacFly += 1;
        // 初球から打ちにきた打席(投球数1でインプレー or 長打)
        if (p.pitchCount != null) {
          paWithPitches += 1;
          if (p.pitchCount === 1 && p.result !== 'bb' && p.result !== 'hbp') firstPitchSwings += 1;
        }
        const k = situationKey(p.beforeRunners, p.outsBefore);
        if (k) {
          if (!sit.has(k)) sit.set(k, { key: k, count: 0, sac: 0 });
          const s = sit.get(k);
          s.count += 1;
          if (p.result === 'sacBunt') s.sac += 1;
        }
        continue;
      }
      if (!!l.isTop !== oppBattingIsTop) continue; // 相手の攻撃中だけ
      if (l.kind === 'sb') {
        sb += 1;
        const w = p.letter ? who(g, p.letter) : null;
        if (w) w.sb += 1;
      } else if (l.kind === 'runner' && l.text === '盗塁死') {
        cs += 1;
        const w = p.letter ? who(g, p.letter) : null;
        if (w) w.cs += 1;
      }
    }
  }

  const runners = [...byPlayer.values()]
    .map((r) => ({ ...r, att: r.sb + r.cs, rate: r.sb + r.cs > 0 ? r.sb / (r.sb + r.cs) : null }))
    .filter((r) => r.att > 0)
    .sort((a, b) => b.att - a.att || (a.order ?? 99) - (b.order ?? 99));
  const situations = [...sit.values()]
    .filter((s) => s.count >= 2) // 1回きりの場面は傾向とは言えない
    .sort((a, b) => b.sac - a.sac || b.count - a.count);
  return {
    sb, cs, att: sb + cs, sbRate: sb + cs > 0 ? sb / (sb + cs) : null,
    sacBunt, sacFly,
    firstPitchRate: paWithPitches > 0 ? firstPitchSwings / paWithPitches : null,
    runners, situations,
  };
}

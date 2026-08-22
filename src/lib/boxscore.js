// ============================================================
// 線分(イニングごとの得点)ボックススコア: R(得点)・H(安打)・E(失策)
// ============================================================
import { RESULTS, playErrorOf } from './model.js';

export function computeBoxScore(game) {
  const linescore = game.linescore || {};
  const recorded = Object.keys(linescore).map(Number);
  const maxInning = Math.max(9, game.inning || 1, ...(recorded.length ? recorded : [0]));

  const all = [];
  for (let i = 1; i <= maxInning; i++) {
    const e = linescore[String(i)];
    const played = i < game.inning || (i === game.inning && !!e);
    all.push({ inning: i, my: e?.my ?? 0, opp: e?.opp ?? 0, played });
  }
  // 表示は「実際に行われた回」まで。7回で終わった試合に8回・9回の空欄を出さない。
  // (延長は maxInning が伸びるのでそのまま含まれる)
  let last = 0;
  for (const e of all) if (e.played) last = e.inning;
  const innings = all.slice(0, Math.max(1, last));

  const myH = game.atBats.filter((ab) => RESULTS[ab.result]?.hit).length;
  const oppH = game.playLogs.filter((l) => l.kind === 'defense' && RESULTS[l.payload?.result]?.hit).length;
  // E: 失策の数。出塁させた失策(result='error')だけでなく、
  // 安打やアウトのあとに付いた失策(payload.playError)も数える。
  // 記録規則では安打かどうかは打球で決まり、そのあと守備が乱れて余分に
  // 進んだぶんは失策になるので、1つのプレイに安打と失策が同時に付く。
  // 守備側(kind='defense')の失策は自チーム、打席側(atBats)の失策は相手。
  const errOn = (p) => (p?.result === 'error' ? 1 : 0) + (playErrorOf(p) ? 1 : 0);
  const myE = game.playLogs
    .filter((l) => l.kind === 'defense')
    .reduce((n, l) => n + errOn(l.payload), 0);
  const oppE = game.atBats.reduce((n, ab) => n + errOn(ab), 0);

  return {
    innings,
    my: { r: game.myScore, h: myH, e: myE },
    opp: { r: game.oppScore, h: oppH, e: oppE },
  };
}


// ------------------------------------------------------------
// ラインスコアのそのマスを表示してよいか
//
// 「まだ来ていない回」は空にするが、「終わった半回」は0点でも数字を出す。
// linescore は点が入った回にしか作られないので、
// 「その回のエントリがあるか」で判定すると、無得点で終わった半回が
// 空欄のままになる(表が終わって裏に移っても表の欄が出ない)。
//
// side: 'away'(先攻=表に打つ) | 'home'(後攻=裏に打つ)
// ------------------------------------------------------------
// 回別の安打数。スコアボードでも流れの線分スコアでも同じ数え方をしたいので、
// ここに1つだけ置く(2か所で数えると、片方だけ直したときに食い違う)。
// 戻り値: { my: {inning: 本数}, opp: {...} }
export function hitsByInning(game) {
  const my = {};
  const opp = {};
  for (const ab of game?.atBats || []) {
    if (!RESULTS[ab.result]?.hit) continue;
    const inn = ab.snapshot?.inning;
    if (inn) my[inn] = (my[inn] || 0) + 1;
  }
  for (const l of game?.playLogs || []) {
    if (l.kind !== 'defense' || !RESULTS[l.payload?.result]?.hit) continue;
    const inn = Number(l.inning) || 0;
    if (inn) opp[inn] = (opp[inn] || 0) + 1;
  }
  return { my, opp };
}

export function halfPlayed(game, inning, side, sideRuns = 0) {
  const cur = Number(game?.inning) || 1;
  const i = Number(inning) || 0;
  if (i < cur) return true;   // 過ぎた回は両方とも終わっている
  if (i > cur) return false;  // まだ来ていない
  const finished = game?.status === 'finished';
  // 試合は表から始まる。isTop が無い(旧データ)ときは表とみなす
  const isTop = game?.isTop !== false;
  // 点が入ったかは「その回」ではなく「その半回」で見る。
  // 回で見ると、表が点を取った時点で、まだ戦っていない裏まで0が出てしまう。
  const scored = Number(sideRuns) > 0;
  if (side === 'away') {
    // 先攻の半回(表)は、裏に移った時点で終わっている
    return !isTop || finished || scored;
  }
  // 後攻の半回(裏)は、この回が進行中のあいだは終わっていない。
  // 点が入っていれば途中経過として出す(試合終了時も同じ)
  return scored || (finished && !isTop);
}

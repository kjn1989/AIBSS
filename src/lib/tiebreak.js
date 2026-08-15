// ============================================================
// タイブレーク: 半回の頭に走者を置く
//
// タイブレークは「走者を置いて始める回」なので、置く操作そのものがルールの中身。
// 宣言だけして誰も置かれないと、画面はふつうの回のままになってしまう。
// 攻守が入れ替わったとき、そして回に入ってから後でルールを適用したときに、
// その半回がまだ始まっていなければ置く。
//
// 誰が置かれるかは打順で決まる。継続打順(cont)なら、その半回の先頭打者の
// 「1人前」から順に、先の塁から埋める(一・二塁なら1人前が二塁、2人前が一塁)。
// 打順の先頭から(top)なら、先に打順を1番へ戻してから同じ計算をするので、
// 9番が二塁・8番が一塁に入る。
//
// 置いた走者が還っても投手の自責点にはならない(投手が出した走者ではないため)。
// その扱いは pitchingRebuild 側がタイブレークの回として別に見ている。
// ============================================================
import { isTiebreakInning, rulesAtInning } from './rules.js';
import { stateKey } from './flow.js';

// その半回に打席がもう記録されているか。
// 記録済みの半回に後から走者を置くと、記録の中の塁上と食い違う。
export function halfHasPlays(game, myBatting) {
  const kind = myBatting ? 'atbat' : 'defense';
  return (game?.playLogs || []).some(
    (l) => l.kind === kind
      && Number(l.inning) === Number(game.inning) && !!l.isTop === !!game.isTop,
  );
}

// 打順のうしろへ n 人ぶん戻った枠。全員打ちで枠数が9でなくても回る
export function backInOrder(list, index, n) {
  const len = (list || []).length;
  if (!len) return null;
  return list[((index - n) % len + len) % len] || null;
}

// 置く走者の内訳を組み立てる(reducerから切り離してあるのは、ここだけ試験できるようにするため)。
// 戻り値: { runners: {1,2,3}, outs, batterIndex, oppBatterIndex } | null
export function tiebreakPlacement(game) {
  if (!game || game.status !== 'ongoing') return null;
  if (!isTiebreakInning(game, game.inning)) return null;
  const tb = rulesAtInning(game, game.inning)?.tiebreak;
  if (!tb) return null;
  const myBatting = game.isTop !== game.isHome;
  // すでに誰か塁に居る / この半回がもう始まっている なら触らない
  const r = game.runners || {};
  if (r[1] || r[2] || r[3]) return null;
  if (halfHasPlays(game, myBatting)) return null;

  const fromTop = tb.order === 'top';
  const batterIndex = fromTop && myBatting ? 0 : (game.batterIndex || 0);
  const oppBatterIndex = fromTop && !myBatting ? 0 : (game.oppBatterIndex || 0);
  const index = myBatting ? batterIndex : oppBatterIndex;
  const list = myBatting ? (game.lineup || []) : (game.oppLineup || []);

  // 埋めるのは先の塁から。先頭打者の1人前がいちばん先の塁に入る
  const bases = String(tb.runners || '12').split('')
    .map(Number).filter((b) => b >= 1 && b <= 3)
    .sort((a, b) => b - a);

  const runners = { 1: null, 2: null, 3: null };
  bases.forEach((base, i) => {
    const slot = backInOrder(list, index, i + 1);
    runners[base] = {
      playerId: myBatting ? slot?.playerId || null : null,
      letter: myBatting ? null : slot?.letter || null,
      pitcherId: myBatting ? null : game.currentPitcherId || null,
      viaError: false,
      placed: true, // タイブレークで置いた走者(自責点の見立てと表示に使う)
    };
  });

  return {
    runners,
    outs: Math.min(2, Math.max(0, Number(tb.outs) || 0)),
    batterIndex,
    oppBatterIndex,
  };
}

// その回の半回が「どの状態から始まるか」。
// ふつうの回は走者なし0アウトだが、タイブレークの回は走者を置いて始まる。
// 勝率モデルはこれから先の半回の得点分布を畳むので、置いた走者を知らないと
// 「まだ点が入りやすい回が残っている」ことを見落として勝率がずれる。
export function halfStartKeyOf(game, inning) {
  if (!isTiebreakInning(game, inning)) return '000|0';
  const tb = rulesAtInning(game, inning)?.tiebreak;
  if (!tb) return '000|0';
  const on = String(tb.runners || '12');
  const runners = { 1: on.includes('1'), 2: on.includes('2'), 3: on.includes('3') };
  return stateKey(runners, Math.min(2, Math.max(0, Number(tb.outs) || 0)));
}

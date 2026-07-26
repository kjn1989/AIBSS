// ============================================================
// 線分(イニングごとの得点)ボックススコア: R(得点)・H(安打)・E(失策)
// ============================================================
import { RESULTS } from './model.js';

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
  // E: バッテリー側の失策で相手を出塁させた回数(自チームが守備の時にresult='error'を記録した数)
  const myE = game.playLogs.filter((l) => l.kind === 'defense' && l.payload?.result === 'error').length;
  const oppE = game.atBats.filter((ab) => ab.result === 'error').length;

  return {
    innings,
    my: { r: game.myScore, h: myH, e: myE },
    opp: { r: game.oppScore, h: oppH, e: oppE },
  };
}

// ============================================================
// 線分(イニングごとの得点)ボックススコア: R(得点)・H(安打)・E(失策)
// ============================================================
import { RESULTS } from './model.js';

export function computeBoxScore(game) {
  const linescore = game.linescore || {};
  const recorded = Object.keys(linescore).map(Number);
  const maxInning = Math.max(9, game.inning || 1, ...(recorded.length ? recorded : [0]));

  const innings = [];
  for (let i = 1; i <= maxInning; i++) {
    const e = linescore[String(i)];
    const played = i < game.inning || (i === game.inning && !!e);
    innings.push({ inning: i, my: e?.my ?? 0, opp: e?.opp ?? 0, played });
  }

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

// ============================================================
// 試合1つから、個人を特定できない形の集計用データを取り出す。
//
// いまはどこにも送らない。この関数はアプリのどの画面からも呼ばれていない。
// 先に作っておく理由は、送る仕組みを足す日(利用者の同意を取る版)に
// 「記録にこの項目が無かった」と気づいても、過去の試合には戻って足せないから。
// 取り出せることをテストで固定しておけば、いま記録している形が足りているかを
// 毎回確かめられる。
//
// 入れないもの(名前・ID・自由記述はすべて落とす):
//   選手名・選手ID・相手チーム名・大会名・記録員・参加メンバー・流れの文・日付(年月まで)
// 入れるもの:
//   試合の条件(エディション・区分・種別・力の差・回数)と、打席ごとの
//   状況(回・アウト・走者の有無・点差)と結果、その回の残りに入った点
//
// 得点期待値の数え方は lib/flow.js の buildRunExpectancy と同じにしてある
// (打席のログだけを数え、その打席から回の終わりまでに入った点を積む)。
// ============================================================
import { stateKey } from './flow.js';
import { isTiebreakInning } from './rules.js';

// 取り出す形の版。項目を足す・意味を変えるときに上げる
export const DATASET_VERSION = 1;

const isPa = (l) => l && (l.kind === 'atbat' || l.kind === 'defense');
const halfKey = (l) => `${Number(l.inning) || 0}${l.isTop ? 'T' : 'B'}`;
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// 集計に使ってよい試合か。使えないときは理由を返す(送る側で数えて見せるため)
export function datasetEligibility(game) {
  if (!game || typeof game !== 'object') return { ok: false, reason: 'invalid' };
  if (String(game.id || '').startsWith('demo-') || game.origin === 'demo') return { ok: false, reason: 'demo' };
  // 出どころの項目より前の取り込み試合は、取り込んだ成績を持っていることで見分ける
  // (importedBatting はどの試合にも空配列で入っている)
  if (game.origin === 'import' || game.importedBatting?.length || game.importedPitching?.length) {
    return { ok: false, reason: 'import' };
  }
  if (game.status !== 'finished') return { ok: false, reason: 'unfinished' };
  if (!Array.isArray(game.playLogs) || !game.playLogs.some(isPa)) return { ok: false, reason: 'no-plays' };
  return { ok: true, reason: null };
}

export function extractGameDataset(game) {
  const elig = datasetEligibility(game);
  if (!elig.ok) return null;

  const logs = game.playLogs.filter(isPa);
  const started = num(game.startedAt);

  // 半回ごとの合計点(その打席から回の終わりまでの点を出すため)
  const halves = new Map();
  for (const l of logs) {
    const k = halfKey(l);
    if (!halves.has(k)) halves.set(k, []);
    halves.get(k).push(l);
  }
  const restOfHalf = new Map();
  for (const hl of halves.values()) {
    let left = hl.reduce((s, l) => s + (Number(l.payload?.runs) || 0), 0);
    for (const l of hl) {
      restOfHalf.set(l, left);
      left -= Number(l.payload?.runs) || 0;
    }
  }

  const plays = logs.map((l) => {
    const p = l.payload || {};
    // 攻撃側から見た点差(打席の前)。scoreAfter は打席の後なので、入った点を戻す
    const mine = l.kind === 'atbat';
    const after = p.scoreAfter || null;
    const runs = Number(p.runs) || 0;
    let diffBefore = null;
    if (after && after.my != null && after.opp != null) {
      const off = (mine ? after.my : after.opp) - runs;
      const def = mine ? after.opp : after.my;
      diffBefore = off - def;
    }
    const hasState = !!p.beforeRunners && p.outsBefore != null && p.outsBefore <= 2;
    return {
      inning: Number(l.inning) || 0,
      top: !!l.isTop,
      offense: mine ? 'my' : 'opp',
      // 走者は有無だけ(誰が居たかは落とす)。'一二三|アウト'
      state: hasState ? stateKey(p.beforeRunners, p.outsBefore) : null,
      diffBefore,
      result: p.result || null,
      outType: p.outType || null,
      soType: p.soType || null,
      intentional: !!p.intentional,
      direction: p.direction || null,
      contact: p.contact || null,
      hitAngle: num(p.hitAngle),
      hitDepth: num(p.hitDepth),
      playError: p.playError ? { pos: p.playError.pos || null, kind: p.playError.kind || null } : null,
      finePlay: !!p.finePlay,
      balls: num(p.balls),
      strikes: num(p.strikes),
      pitches: num(p.pitchCount),
      runs,
      outsOnPlay: num(p.outsOnPlay),
      runsRestOfHalf: restOfHalf.get(l),
      tiebreak: isTiebreakInning(game, l.inning),
      // 試合開始からの秒数。実況で1打席ずつ付けた試合か、後からまとめて入れた
      // 試合かを見分ける手がかり(時刻そのものは落とす)
      t: started != null && num(l.ts) != null ? Math.round((l.ts - started) / 1000) : null,
      edited: !!l.editedAt,
    };
  });

  const ts = logs.map((l) => num(l.ts)).filter((v) => v != null);
  const spanSec = ts.length > 1 ? Math.round((Math.max(...ts) - Math.min(...ts)) / 1000) : 0;

  return {
    datasetVersion: DATASET_VERSION,
    schemaVersion: game.schemaVersion ?? null,
    appBuild: game.appBuild ?? null,
    game: {
      edition: game.edition || null,
      kind: game.kind || null,
      gameType: game.gameType || null,
      teamGap: game.teamGap || null,
      innings: num(game.rules?.innings),
      isHome: !!game.isHome,
      month: typeof game.date === 'string' ? game.date.slice(0, 7) : null,
      finalScore: { my: Number(game.myScore) || 0, opp: Number(game.oppScore) || 0 },
    },
    quality: {
      plays: plays.length,
      edited: plays.filter((x) => x.edited).length,
      deletions: Number(game.paDeletions) || 0,
      // 最初の打席から最後の打席までの時間。9回の試合を数分で付け終えていれば
      // 実況ではなく後からの入力(あるいは試しの入力)と分かる
      spanSec,
      withState: plays.filter((x) => x.state).length,
      withContact: plays.filter((x) => x.contact).length,
    },
    plays,
  };
}

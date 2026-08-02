// ============================================================
// 自軍のスカウティング(相手に対してやっている分析を、自分たちに向ける)
//
// 相手チーム分析で作った切り口 — 機動力(走る/送る)、バッテリーの隙 —
// は、そのまま自軍にも当てはまる。むしろ相手は自軍を同じ目で見ている。
// 「うちの捕手は何%刺せているか」「うちは無死一塁で何をしているか」は、
// 相手の数字より先に知っておくべきもの。
//
// データは既に全部ある。自軍の打席は kind:'atbat'、相手の打席は
// kind:'defense' で、どちらも同じ payload(走者・アウト・投球数)を持つ。
// 新しく記録してもらうことは何もない。
// ============================================================
import { alignmentByInning } from './lineupBox.js';

// 相手の機動力と同じ場面の切り方(見比べられるよう、意図的に揃える)
const SITUATIONS = [
  { key: 'o0_1', outs: 0, on: '1' }, { key: 'o1_1', outs: 1, on: '1' },
  { key: 'o0_2', outs: 0, on: '2' }, { key: 'o1_2', outs: 1, on: '2' },
  { key: 'o0_12', outs: 0, on: '12' }, { key: 'o1_12', outs: 1, on: '12' },
  { key: 'o0_13', outs: 0, on: '13' }, { key: 'o1_13', outs: 1, on: '13' },
];
function situationKey(before, outs) {
  const on = [1, 2, 3].filter((b) => before?.[b]).join('');
  if (!on) return null;
  const found = SITUATIONS.find((s) => s.outs === Number(outs || 0) && s.on === on);
  return found ? found.key : null;
}

// 自軍の攻撃はどちらの半回か(先攻なら表)
const ourBattingIsTop = (g) => !g.isHome;

// ------------------------------------------------------------
// 自軍の機動力。oppOffenseStats と同じ形を返すので、同じ画面で並べられる。
// runners の識別子だけが違う(相手は記号、自軍は選手ID)。
// ------------------------------------------------------------
export function ownOffenseStats(games = []) {
  const byPlayer = new Map();
  const sit = new Map();
  let sb = 0; let cs = 0; let sacBunt = 0; let sacFly = 0;
  let firstPitchSwings = 0; let paWithPitches = 0;

  const who = (playerId) => {
    if (!playerId) return null;
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, { key: playerId, playerId, sb: 0, cs: 0 });
    return byPlayer.get(playerId);
  };

  for (const g of games) {
    const ourTop = ourBattingIsTop(g);
    for (const l of g.playLogs || []) {
      const p = l.payload || {};
      if (l.kind === 'atbat') {
        if (p.result === 'sacBunt') sacBunt += 1;
        if (p.result === 'sacFly') sacFly += 1;
        if (p.pitchCount != null) {
          paWithPitches += 1;
          // 四球・死球は「振っていない」ので初球打ちには数えない
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
      if (!!l.isTop !== ourTop) continue; // 自軍の攻撃中だけ
      if (l.kind === 'sb') {
        sb += 1;
        const w = who(p.playerId);
        if (w) w.sb += 1;
      } else if (l.kind === 'runner' && l.text === '盗塁死') {
        cs += 1;
        const w = who(p.playerId);
        if (w) w.cs += 1;
      }
    }
  }

  const runners = [...byPlayer.values()]
    .map((r) => ({ ...r, att: r.sb + r.cs, rate: r.sb + r.cs > 0 ? r.sb / (r.sb + r.cs) : null }))
    .filter((r) => r.att > 0)
    .sort((a, b) => b.att - a.att || b.sb - a.sb);
  const situations = [...sit.values()]
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.sac - a.sac || b.count - a.count);
  return {
    sb, cs, att: sb + cs, sbRate: sb + cs > 0 ? sb / (sb + cs) : null,
    sacBunt, sacFly,
    firstPitchRate: paWithPitches > 0 ? firstPitchSwings / paWithPitches : null,
    runners, situations,
  };
}

// ------------------------------------------------------------
// 自軍バッテリー。相手のときは記号から捕手を推測したが、自軍は
// 守備位置が記録されているので回ごとの捕手が確定できる。
// そのぶん捕逸も「チーム計」ではなく捕手ごとに出せる。
// ------------------------------------------------------------
export function ownBatteryStats(games = []) {
  const catchers = new Map();
  const pitchers = new Map();
  const team = { balk: 0 };

  const cat = (id) => {
    if (!catchers.has(id)) catchers.set(id, { key: id, playerId: id, sbAllowed: 0, caught: 0, pb: 0 });
    return catchers.get(id);
  };
  const pit = (id) => {
    if (!pitchers.has(id)) pitchers.set(id, { key: id, playerId: id, wp: 0, pickoff: 0 });
    return pitchers.get(id);
  };

  for (const g of games) {
    const ourTop = ourBattingIsTop(g);
    const align = alignmentByInning(g);
    const catcherAt = (inning) => {
      const inn = Math.max(1, Number(inning) || 1);
      // その回の守備陣が無ければ、直近の分かる回まで遡る
      for (let n = inn; n >= 1; n--) {
        const row = align.get(n);
        const c = row?.find((s) => s.position === '捕');
        if (c) return c.playerId;
      }
      return null;
    };
    let lastPitcher = null;
    for (const l of g.playLogs || []) {
      const p = l.payload || {};
      if (l.kind === 'pitcher' && p.in) { lastPitcher = p.in; continue; }
      if (l.kind === 'defense' && p.pitcherId) lastPitcher = p.pitcherId; // 交代ログが無い試合の保険
      if (!!l.isTop === ourTop) continue; // 相手の攻撃中だけ(自軍が守っている)

      if (l.kind === 'sb') {
        const c = catcherAt(l.inning);
        if (c) cat(c).sbAllowed += 1;
      } else if (l.kind === 'runner') {
        if (l.text === '盗塁死') { const c = catcherAt(l.inning); if (c) cat(c).caught += 1; }
        else if (l.text === '捕逸') { const c = catcherAt(l.inning); if (c) cat(c).pb += 1; }
        else if (l.text === '暴投') { if (lastPitcher) pit(lastPitcher).wp += 1; }
        else if (l.text === '牽制死') { if (lastPitcher) pit(lastPitcher).pickoff += 1; }
        else if (l.text === 'ボーク') team.balk += 1;
      }
    }
  }

  const cRows = [...catchers.values()]
    .map((c) => {
      const att = c.sbAllowed + c.caught;
      // 企図0のときは阻止率を null にする(「刺せない」と「走られていない」は違う)
      return { ...c, att, csRate: att > 0 ? c.caught / att : null };
    })
    .filter((c) => c.att > 0 || c.pb > 0)
    .sort((a, b) => b.att - a.att);
  const pRows = [...pitchers.values()]
    .filter((p) => p.wp || p.pickoff)
    .sort((a, b) => b.wp - a.wp || b.pickoff - a.pickoff);
  return { catchers: cRows, pitchers: pRows, team };
}

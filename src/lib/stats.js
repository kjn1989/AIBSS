// ============================================================
// スタッツ集計エンジン
// games(対象試合の配列) から選手別に集計する。
// 「試合単位/シーズン通算」の切替は呼び出し側が games を絞って渡す。
// ============================================================
import { RESULTS, formatIP } from './model.js';

// ---- 打者: 足し算カウントスタッツ(タイトル系) ----
export function aggregateBatting(games) {
  const map = {}; // playerId -> stats
  const get = (pid) => {
    if (!map[pid]) {
      map[pid] = {
        playerId: pid,
        pa: 0, ab: 0, h: 0, single: 0, double: 0, triple: 0, hr: 0,
        rbi: 0, runs: 0, sb: 0, bb: 0, hbp: 0, so: 0,
        sacBunt: 0, sacFly: 0, interference: 0, error: 0, tb: 0,
        // 詳細メトリクス用
        rispAB: 0, rispH: 0,
        advChance: 0, advSuccess: 0,
        totalPitches: 0,
        clutch: 0,
        firstPitchSwings: 0, firstPitchHits: 0,
      };
    }
    return map[pid];
  };

  for (const g of games) {
    for (const ab of g.atBats || []) {
      if (!ab.result) continue; // 未確定打席は除外
      const s = get(ab.playerId);
      const def = RESULTS[ab.result];
      if (!def) continue;

      s.pa += 1;
      if (def.ab) s.ab += 1;
      if (def.hit) {
        s.h += 1;
        s.tb += def.bases;
        if (ab.result === 'single') s.single += 1;
        if (ab.result === 'double') s.double += 1;
        if (ab.result === 'triple') s.triple += 1;
        if (ab.result === 'hr') s.hr += 1;
      }
      if (ab.result === 'bb') s.bb += 1;
      if (ab.result === 'hbp') s.hbp += 1;
      if (ab.result === 'so') s.so += 1;
      if (ab.result === 'sacBunt') s.sacBunt += 1;
      if (ab.result === 'sacFly') s.sacFly += 1;
      if (ab.result === 'interference') s.interference += 1;
      if (ab.result === 'error') s.error += 1;
      s.rbi += ab.rbi || 0;

      // RISP: 打席開始時に走者二塁or三塁
      const snap = ab.snapshot || {};
      const risp = snap.runners && (snap.runners[2] || snap.runners[3]);
      if (risp && def.ab) {
        s.rispAB += 1;
        if (def.hit) s.rispH += 1;
      }

      // 進塁打: 走者あり凡打(三振除く)が対象
      if (ab.advSuccess !== null && ab.advSuccess !== undefined) {
        s.advChance += 1;
        if (ab.advSuccess) s.advSuccess += 1;
      }

      // PPA用
      s.totalPitches += ab.pitchCount || 0;

      // クラッチ
      if (ab.clutch) s.clutch += 1;

      // 初球打ち
      if (ab.firstPitch === 'inplay') {
        s.firstPitchSwings += 1;
        if (ab.firstPitchHit) s.firstPitchHits += 1;
      }
    }
    // 得点・盗塁は PlayLog から拾う(打席レコード外の事象のため)
    for (const log of g.playLogs || []) {
      if (log.kind === 'run' && log.payload?.playerId) get(log.payload.playerId).runs += 1;
      if (log.kind === 'sb' && log.payload?.playerId) get(log.payload.playerId).sb += 1;
    }
    // CSV取り込みのボックススコアを加算(空欄は0扱い)
    for (const b of g.importedBatting || []) {
      const s = get(b.playerId);
      const single = b.single != null ? b.single : Math.max(0, (b.h || 0) - (b.double || 0) - (b.triple || 0) - (b.hr || 0));
      const tb = b.tb != null ? b.tb : single + 2 * (b.double || 0) + 3 * (b.triple || 0) + 4 * (b.hr || 0);
      s.pa += b.pa || 0; s.ab += b.ab || 0; s.h += b.h || 0;
      s.single += single; s.double += b.double || 0; s.triple += b.triple || 0; s.hr += b.hr || 0;
      s.rbi += b.rbi || 0; s.runs += b.runs || 0; s.sb += b.sb || 0;
      s.bb += b.bb || 0; s.hbp += b.hbp || 0; s.so += b.so || 0;
      s.sacBunt += b.sacBunt || 0; s.sacFly += b.sacFly || 0; s.tb += tb;
    }
  }
  return map;
}

// ---- 投手: カウントスタッツ ----
export function aggregatePitching(games) {
  const map = {}; // playerId -> stats
  const get = (pid) => {
    if (!map[pid]) {
      map[pid] = {
        playerId: pid,
        outsRecorded: 0, runs: 0, earnedRuns: 0, hitsAllowed: 0,
        walks: 0, hitByPitch: 0, strikeouts: 0, pitches: 0, abFaced: 0,
        wins: 0, saves: 0, holds: 0, games: 0,
      };
    }
    return map[pid];
  };
  for (const g of games) {
    for (const pr of g.pitchingRecords || []) {
      const s = get(pr.playerId);
      s.games += 1;
      s.outsRecorded += pr.outsRecorded || 0;
      s.runs += pr.runs || 0;
      s.earnedRuns += pr.earnedRuns || 0;
      s.hitsAllowed += pr.hitsAllowed || 0;
      s.walks += pr.walks || 0;
      s.hitByPitch += pr.hitByPitch || 0;
      s.strikeouts += pr.strikeouts || 0;
      s.pitches += pr.pitches || 0;
      s.abFaced += pr.abFaced || 0;
      if (pr.win) s.wins += 1;
      if (pr.save) s.saves += 1;
      if (pr.hold) s.holds += 1;
    }
    // CSV取り込みの投手ボックススコアを加算(空欄は0扱い)
    for (const p of g.importedPitching || []) {
      const s = get(p.playerId);
      s.games += 1;
      s.outsRecorded += p.outsRecorded || 0;
      s.runs += p.runs || 0;
      s.earnedRuns += p.earnedRuns || 0;
      s.hitsAllowed += p.hitsAllowed || 0;
      s.walks += p.walks || 0;
      s.hitByPitch += p.hitByPitch || 0;
      s.strikeouts += p.strikeouts || 0;
      s.pitches += p.pitches || 0;
      s.abFaced += p.abFaced || 0;
      if (p.win) s.wins += 1;
      if (p.save) s.saves += 1;
      if (p.hold) s.holds += 1;
    }
  }
  return map;
}

// ---- タイトル系ランキング(同数は同順位で全員返す) ----
export const BATTING_TITLES = [
  { key: 'h', label: '安打', crown: '安打王', en: 'Hits', enCrown: 'Hits Leader' },
  { key: 'rbi', label: '打点', crown: '打点王', en: 'RBI', enCrown: 'RBI Leader' },
  { key: 'runs', label: '得点', crown: '得点王', en: 'Runs', enCrown: 'Runs Leader' },
  { key: 'hr', label: '本塁打', crown: '本塁打王', en: 'HR', enCrown: 'HR Leader' },
  { key: 'double', label: '二塁打', crown: '二塁打王', en: '2B', enCrown: '2B Leader' },
  { key: 'triple', label: '三塁打', crown: '三塁打王', en: '3B', enCrown: '3B Leader' },
  { key: 'sb', label: '盗塁', crown: '盗塁王', en: 'SB', enCrown: 'SB Leader' },
  { key: 'bbhbp', label: '四死球', crown: '選球眼王', en: 'BB+HBP', enCrown: 'Best Eye' },
  { key: 'tb', label: '塁打', crown: '塁打王', en: 'TB', enCrown: 'TB Leader' },
];

export const PITCHING_TITLES = [
  { key: 'wins', label: '勝利', crown: '最多勝', en: 'Wins', enCrown: 'Most Wins' },
  { key: 'strikeouts', label: '奪三振', crown: '奪三振王', en: 'K', enCrown: 'K Leader' },
  { key: 'saves', label: 'セーブ', crown: 'セーブ王', en: 'Saves', enCrown: 'Saves Leader' },
  { key: 'holds', label: 'ホールド', crown: 'ホールド王', en: 'Holds', enCrown: 'Holds Leader' },
  { key: 'ip', label: '投球回', crown: 'イニング王', en: 'IP', enCrown: 'Innings Leader' },
];

// メトリクス/タイトルの表示ラベルを言語に応じて返す(保存値・比較キーはそのまま)。
export const mLabel = (m, lang) => (lang === 'en' && m.en ? m.en : m.label);
export const mCrown = (m, lang) => (lang === 'en' && m.enCrown ? m.enCrown : m.crown);

// stats map からタイトルのトップ(同数同順位)を返す
export function titleLeaders(statsMap, key) {
  const rows = Object.values(statsMap).map((s) => {
    let v;
    if (key === 'bbhbp') v = s.bb + s.hbp;
    else if (key === 'ip') v = s.outsRecorded; // 内部はアウト数で比較
    else v = s[key] ?? 0;
    return { playerId: s.playerId, value: v };
  });
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (max <= 0) return { leaders: [], value: 0, display: '0' };
  const leaders = rows.filter((r) => r.value === max).map((r) => r.playerId);
  const display = key === 'ip' ? formatIP(max) : String(max);
  return { leaders, value: max, display };
}

// 値の降順で順位付け(同数同順位)したランキング行を返す
export function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => b.sortValue - a.sortValue);
  let rank = 0;
  let prev = null;
  return sorted.map((r, i) => {
    if (prev === null || r.sortValue !== prev) rank = i + 1;
    prev = r.sortValue;
    return { ...r, rank };
  });
}

// ============================================================
// 10大メトリクス (分母0は null を返し、表示側で「-」にする)
// ============================================================
const div = (a, b) => (b > 0 ? a / b : null);

export const fmtAvg = (v) => (v === null ? '-' : v.toFixed(3).replace(/^0\./, '.'));
export const fmtPct = (v) => (v === null ? '-' : (v * 100).toFixed(1) + '%');
export const fmt2 = (v) => (v === null ? '-' : v.toFixed(2));

// ---- 打者メトリクス ----
export function battingMetrics(s) {
  const ba = div(s.h, s.ab); // 1. 打率 (AB = 打席 − 四死球・犠打・犠飛・打撃妨害)
  const risp = div(s.rispH, s.rispAB); // 2. 得点圏打率
  const obpDen = s.ab + s.bb + s.hbp + s.sacFly;
  const obp = div(s.h + s.bb + s.hbp, obpDen);
  const slg = div(s.tb, s.ab);
  const ops = obp === null || slg === null ? null : obp + slg; // 3. OPS
  const adv = div(s.advSuccess, s.advChance); // 4. 進塁打成功率
  const ppa = div(s.totalPitches, s.pa); // 5. P/PA
  const clutch = s.clutch; // 6. クラッチ打数(カウント)
  const fhit = div(s.firstPitchHits, s.firstPitchSwings); // 7. 初球安打率
  return { ba, risp, obp, slg, ops, adv, ppa, clutch, fhit };
}

// ---- 投手メトリクス ----
export function pitchingMetrics(s) {
  const ip = s.outsRecorded / 3;
  const era7 = ip > 0 ? (s.earnedRuns / ip) * 7 : null; // 8. 防御率(7回換算)
  const whip = ip > 0 ? (s.hitsAllowed + s.walks + s.hitByPitch) / ip : null; // 9. WHIP(被安打+与四死球)
  // 10. K/BB: 与四球0のときは奪三振数を表示し注記
  const kbb = s.walks > 0 ? s.strikeouts / s.walks : null;
  const kbbDisplay = s.walks > 0 ? fmt2(kbb) : s.strikeouts > 0 ? `${s.strikeouts} (与四球0)` : '-';
  const kbbSort = s.walks > 0 ? kbb : s.strikeouts > 0 ? s.strikeouts : -1;
  const oba = div(s.hitsAllowed, s.abFaced); // 被打率 = 被安打 ÷ 被打数
  return { ip, era7, whip, kbb, kbbDisplay, kbbSort, oba };
}

// ---- 詳細ランキングのメトリクス定義 ----
// higherBetter=false のものは昇順で順位付け
// 内訳(detail)で使う単位語のデフォルト(日本語)。表示側が tr を渡せば英語等に切替わる。
const JA_UNITS = {
  hits: '安打', ab: '打数', pa: '打席', pitches: '球', games: '登板', ipUnit: '回', er: '自責',
  bbhbp: '四死球', ha: '被安打', bb: '与四球', k: '奪三振', abFaced: '被打数', success: '成功',
  chances: '機会', obp: '出塁率', slg: '長打率', firstPitch: '(初球打ち)',
  clutchDesc: '先制・同点・逆転・勝ち越し打の合計',
};
const jaTr = (key) => JA_UNITS[key];

export const DETAIL_METRICS = [
  {
    key: 'ba', label: '打率', en: 'AVG', type: 'bat', higherBetter: true,
    value: (m) => m.ba, format: fmtAvg,
    detail: (s, m, tr = jaTr) => `${s.h}${tr('hits')}/${s.ab}${tr('ab')}`,
    qualify: (s) => s.ab > 0,
  },
  {
    key: 'risp', label: '得点圏打率', en: 'RISP AVG', type: 'bat', higherBetter: true,
    value: (m) => m.risp, format: fmtAvg,
    detail: (s, m, tr = jaTr) => `${s.rispH}${tr('hits')}/${s.rispAB}${tr('ab')}`,
    qualify: (s) => s.rispAB > 0,
  },
  {
    key: 'obp', label: '出塁率', en: 'OBP', type: 'bat', higherBetter: true,
    value: (m) => m.obp, format: fmtAvg,
    detail: (s, m, tr = jaTr) => `${tr('hits')}${s.h}+${tr('bbhbp')}${s.bb + s.hbp}/${s.ab + s.bb + s.hbp + s.sacFly}`,
    qualify: (s) => s.ab + s.bb + s.hbp + s.sacFly > 0,
  },
  {
    key: 'ops', label: 'OPS', en: 'OPS', type: 'bat', higherBetter: true,
    value: (m) => m.ops, format: (v, m) => (v === null ? '-' : v.toFixed(3)),
    detail: (s, m, tr = jaTr) => `${tr('obp')}${fmtAvg(m.obp)} ${tr('slg')}${fmtAvg(m.slg)}`,
    qualify: (s) => s.ab > 0,
  },
  {
    key: 'adv', label: '進塁打成功率', en: 'ProdOut% (productive-out rate)', type: 'bat', higherBetter: true,
    value: (m) => m.adv, format: fmtPct,
    detail: (s, m, tr = jaTr) => `${s.advSuccess}${tr('success')}/${s.advChance}${tr('chances')}`,
    qualify: (s) => s.advChance > 0,
  },
  {
    key: 'ppa', label: 'PPA (球/打席)', en: 'PPA (P/AB)', type: 'bat', higherBetter: true,
    value: (m) => m.ppa, format: fmt2,
    detail: (s, m, tr = jaTr) => `${s.totalPitches}${tr('pitches')}/${s.pa}${tr('pa')}`,
    qualify: (s) => s.pa > 0,
  },
  {
    key: 'clutch', label: 'クラッチ打数', en: 'Clutch (clutch hits)', type: 'bat', higherBetter: true,
    value: (m) => m.clutch, format: (v) => (v === null ? '-' : String(v)),
    detail: (s, m, tr = jaTr) => tr('clutchDesc'),
    qualify: (s) => s.pa > 0,
  },
  {
    key: 'fhit', label: '初球安打率', en: '1stHit% (first-pitch)', type: 'bat', higherBetter: true,
    value: (m) => m.fhit, format: fmtPct,
    detail: (s, m, tr = jaTr) => `${s.firstPitchHits}${tr('hits')}/${s.firstPitchSwings}${tr('pa')}${tr('firstPitch')}`,
    qualify: (s) => s.firstPitchSwings > 0,
  },
  {
    key: 'era7', label: '防御率 (7回換算)', en: 'ERA (7-inn)', type: 'pit', higherBetter: false,
    value: (m) => m.era7, format: fmt2,
    detail: (s, m, tr = jaTr) => `${tr('er')}${s.earnedRuns}/${formatIP(s.outsRecorded)}${tr('ipUnit')}`,
    qualify: (s) => s.outsRecorded > 0,
  },
  {
    key: 'whip', label: 'WHIP', en: 'WHIP', type: 'pit', higherBetter: false,
    value: (m) => m.whip, format: fmt2,
    detail: (s, m, tr = jaTr) => `${tr('ha')}${s.hitsAllowed}+${tr('bbhbp')}${s.walks + s.hitByPitch}/${formatIP(s.outsRecorded)}${tr('ipUnit')}`,
    qualify: (s) => s.outsRecorded > 0,
  },
  {
    key: 'kbb', label: 'K/BB', en: 'K/BB', type: 'pit', higherBetter: true,
    value: (m) => m.kbbSort, format: (v, m) => m.kbbDisplay,
    detail: (s, m, tr = jaTr) => `${tr('k')}${s.strikeouts}/${tr('bb')}${s.walks}`,
    qualify: (s) => s.outsRecorded > 0 && (s.strikeouts > 0 || s.walks > 0),
  },
  {
    key: 'oba', label: '被打率', en: 'OBA', type: 'pit', higherBetter: false,
    value: (m) => m.oba, format: fmtAvg,
    detail: (s, m, tr = jaTr) => `${tr('ha')}${s.hitsAllowed}/${tr('abFaced')}${s.abFaced}`,
    qualify: (s) => s.abFaced > 0,
  },
  {
    key: 'holds', label: 'ホールド', en: 'Holds', type: 'pit', higherBetter: true,
    value: (m, s) => s.holds, format: (v) => (v === null ? '-' : String(v)),
    detail: (s, m, tr = jaTr) => `${s.games}${tr('games')}`,
    qualify: (s) => s.holds > 0,
  },
  {
    key: 'saves', label: 'セーブ', en: 'Saves', type: 'pit', higherBetter: true,
    value: (m, s) => s.saves, format: (v) => (v === null ? '-' : String(v)),
    detail: (s, m, tr = jaTr) => `${s.games}${tr('games')}`,
    qualify: (s) => s.saves > 0,
  },
];

// 指定メトリクスのランキング行を作る。tr(key) を渡すと内訳の単位語を翻訳する(未指定は日本語)。
export function detailRanking(metricDef, battingMap, pitchingMap, tr) {
  const src = metricDef.type === 'bat' ? battingMap : pitchingMap;
  const rows = [];
  for (const s of Object.values(src)) {
    if (!metricDef.qualify(s)) continue;
    const m = metricDef.type === 'bat' ? battingMetrics(s) : pitchingMetrics(s);
    const v = metricDef.value(m, s);
    if (v === null || v === undefined) continue;
    rows.push({
      playerId: s.playerId,
      sortValue: metricDef.higherBetter ? v : -v,
      display: metricDef.format(v, m),
      detail: metricDef.detail(s, m, tr),
    });
  }
  return rankRows(rows);
}

// この選手が「チーム内で他の誰にも負けていない」と言える項目を抽出する(AI選手名鑑で
// 独自の強みを具体的な数字とともに指摘するために使う)。タイトル系は同率首位も含め、
// レートスタッツ(打率・OPS・防御率等)は比較対象が2人以上いる時だけ意味を持つので絞る。
export function teamHighlights(playerId, battingMap, pitchingMap) {
  const facts = [];
  for (const t of BATTING_TITLES) {
    const { leaders, value, display } = titleLeaders(battingMap, t.key);
    if (value > 0 && leaders.includes(playerId)) {
      facts.push(`${t.label}チーム${leaders.length > 1 ? '1位タイ' : '1位'}(${display})`);
    }
  }
  for (const t of PITCHING_TITLES) {
    const { leaders, value, display } = titleLeaders(pitchingMap, t.key);
    if (value > 0 && leaders.includes(playerId)) {
      facts.push(`${t.label}チーム${leaders.length > 1 ? '1位タイ' : '1位'}(${display})`);
    }
  }
  for (const md of DETAIL_METRICS) {
    const rows = detailRanking(md, battingMap, pitchingMap);
    if (rows.length < 2) continue; // 比較対象が1人以下なら「独自の強み」として意味がない
    const row = rows.find((r) => r.playerId === playerId);
    if (row && row.rank === 1) facts.push(`${md.label}チーム1位(${row.display})`);
  }
  return facts;
}

// 直近N試合(新しい順)だけを取り出す。AIコーチが「今季通算」と「直近の調子」を
// 比べて伸びしろ・ワンポイントアドバイスを組み立てるための材料。
export function recentGames(games, n = 3) {
  return [...games].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, n);
}

// 選手の集計成績(打撃/投手)を短い日本語サマリーに変換する(AI選手名鑑・個人ページ共通)
export function buildStatsSummary(batting, pitching, m, pm) {
  const parts = [];
  if (batting && batting.pa > 0 && m) {
    parts.push(`打率${fmtAvg(m.ba)} 本塁打${batting.hr} 打点${batting.rbi} OPS${m.ops === null ? '-' : m.ops.toFixed(3)}`);
  }
  if (pitching && (pitching.outsRecorded > 0 || pitching.games > 0) && pm) {
    parts.push(`防御率${pm.era7 === null ? '-' : pm.era7.toFixed(2)} 奪三振${pitching.strikeouts} WHIP${pm.whip === null ? '-' : pm.whip.toFixed(2)}`);
  }
  return parts.join(' / ');
}

// ============================================================
// 左右別スプリット集計
//  - 打者splits: 各AtBatの vsHand(対戦相手投手の左右)で分ける → 対左投手/対右投手
//  - 投手splits: 守備ログ(kind:'defense')の pitcherId + batterHand で分ける → 対左打者/対右打者
//  未設定(hand不明)の対戦は集計から除外する。任意入力なので分かるものだけ積み上がる。
// ============================================================
const emptyBatSplit = () => ({ pa: 0, ab: 0, h: 0, hr: 0, bb: 0, so: 0, tb: 0, rbi: 0 });
const emptyPitSplit = () => ({ bf: 0, ab: 0, h: 0, hr: 0, so: 0, bb: 0 });

// { [playerId]: { R: {...}, L: {...} } }
export function battingSplits(games) {
  const map = {};
  for (const g of games) {
    for (const ab of g.atBats || []) {
      if (!ab.result || !ab.vsHand) continue;
      const def = RESULTS[ab.result];
      if (!def) continue;
      const rec = (map[ab.playerId] = map[ab.playerId] || { R: emptyBatSplit(), L: emptyBatSplit() });
      const s = rec[ab.vsHand];
      if (!s) continue;
      s.pa += 1;
      if (def.ab) s.ab += 1;
      if (def.hit) { s.h += 1; s.tb += def.bases; }
      if (ab.result === 'hr') s.hr += 1;
      if (ab.result === 'bb' || ab.result === 'hbp') s.bb += 1;
      if (ab.result === 'so') s.so += 1;
      s.rbi += ab.rbi || 0;
    }
  }
  return map;
}

// { [pitcherId]: { R: {...}, L: {...} } } (対戦打者の左右別)
export function pitchingSplits(games) {
  const map = {};
  for (const g of games) {
    for (const log of g.playLogs || []) {
      if (log.kind !== 'defense') continue;
      const p = log.payload || {};
      if (!p.pitcherId || !p.batterHand || !p.result) continue;
      const hand = p.batterHand === 'S' ? null : p.batterHand; // 両打はsplit対象外
      if (!hand) continue;
      const def = RESULTS[p.result];
      if (!def) continue;
      const rec = (map[p.pitcherId] = map[p.pitcherId] || { R: emptyPitSplit(), L: emptyPitSplit() });
      const s = rec[hand];
      s.bf += 1;
      if (def.ab) s.ab += 1;
      if (def.hit) s.h += 1;
      if (p.result === 'hr') s.hr += 1;
      if (p.result === 'so') s.so += 1;
      if (p.result === 'bb' || p.result === 'hbp') s.bb += 1;
    }
  }
  return map;
}

// 打率などの表示用: 割り算(分母0はnull)
export function avg3(num, den) {
  if (!den) return null;
  return (num / den).toFixed(3).replace(/^0/, '');
}

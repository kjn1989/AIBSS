// ============================================================
// 推定年俸(お遊び)。チームの中での成績の順位で決める。
//
// 1. 成績をポイントにする(数え方は下の salaryPoints。根拠はすべて画面に書く)
//    出場イニング数・守備機会・ファインプレーも入れる(打てなくても出て守っている選手を、ちゃんと評価する)
// 2. ポイントの多い順に並べる(同点は同じ順位)
// 3. 1位 = チーム最高額(設定。初期5億円・上限100億円)。順位が1つ下がるごとに RATE 倍
// 4. 記録が無い選手は最低額(最高額の1%)
// 実在の年俸の計算方法ではない。チームの中で「誰が上か」を楽しむための数字。
// ============================================================

import { DIR_TO_POSITION, finePlayOf } from './model.js';
import { resolveStarters, alignmentByInning } from './lineupBox.js';

export const SALARY_TOP_DEFAULT = 5; // 億円
export const SALARY_TOP_MIN = 0.1; // 1000万円
export const SALARY_TOP_MAX = 100; // 億円(大谷翔平の世界観)
export const SALARY_RATE = 0.8; // 順位が1つ下がるごとの倍率
export const SALARY_FLOOR = 0.01; // 最低額 = 最高額 × 1%

export const clampTop = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return SALARY_TOP_DEFAULT;
  return Math.min(SALARY_TOP_MAX, Math.max(SALARY_TOP_MIN, n));
};

// 成績のポイント。
//   打者: 塁打 + 四死球 + 盗塁 + 得点 + 打点
//   投手: 投球回×1.5 + 奪三振×0.5 − 自責点 − 与四死球×0.3 (0未満は0)
//   出場: 出場イニング×0.3 / 守備: 守備機会×0.5 + ファインプレー×2
//   ファン: 観戦ページで贈られた応援コイン×0.2(クラウドで観戦リンクを使っているチームだけ)
// 投手の1試合(7回・3奪三振・3自責点)が、打者のよく打った1試合(2安打・1得点・1打点)の2倍くらいになる重み
export const INNING_WEIGHT = 0.3; // 7回フル出場で約2点
export const CHANCE_WEIGHT = 0.5;
export const FINE_WEIGHT = 2;
export const FAN_WEIGHT = 0.2; // 観戦者から贈られた応援コイン1枚あたり(1人が1試合で贈れるのは50枚 = 10点)
export function salaryPoints(b, p, x = null) {
  const bat = b ? (b.tb || 0) + (b.bb || 0) + (b.hbp || 0) + (b.sb || 0) + (b.runs || 0) + (b.rbi || 0) : 0;
  const pit = p
    ? Math.max(0, ((p.outsRecorded || 0) / 3) * 1.5 + (p.strikeouts || 0) * 0.5 - (p.earnedRuns || 0) - ((p.walks || 0) + (p.hitByPitch || 0)) * 0.3)
    : 0;
  const more = x ? (x.innings || 0) * INNING_WEIGHT + (x.chances || 0) * CHANCE_WEIGHT + (x.fine || 0) * FINE_WEIGHT + (x.fan || 0) * FAN_WEIGHT : 0;
  return Math.round((bat + pit + more) * 10) / 10;
}

// 出場イニング数・守備機会・ファインプレー(選手ごと)。
//   出場イニング: 守備についていた回(回ごとの守備陣)と、打席に立った回を合わせた回の数
//   守備機会: 相手の打球(凡打・安打・失策・犠打・犠飛)が飛んだ守備位置を、そのとき守っていた回数。
//             その回の守備陣は lineupBox の alignmentByInning で引く(途中で代わっても正しい人に付く)
//   ファインプレー: 記録したときにその位置を守っていた選手(stats.js の守備成績と同じ数え方)
export function participation(games = []) {
  const out = {};
  const get = (id) => (out[id] ||= { innings: 0, chances: 0, fine: 0 });
  for (const g of games) {
    if (!g || g.importedBatting?.length) continue;
    const align = alignmentByInning(g);
    const played = new Map(); // playerId -> Set(回)
    const mark = (id, inn) => { if (!id || !inn) return; if (!played.has(id)) played.set(id, new Set()); played.get(id).add(inn); };
    for (const [inn, arr] of align) for (const x of arr) mark(x.playerId, Number(inn));
    for (const l of g.playLogs || []) {
      const p = l.payload || {};
      if (l.kind === 'atbat') mark(p.playerId, Number(l.inning));
      if (l.kind !== 'defense') continue;
      const fine = finePlayOf(p);
      if (fine?.playerId) get(fine.playerId).fine += 1;
      if (!FIELDED.has(p.result)) continue;
      const pos = DIR_TO_POSITION[p.direction];
      if (!pos) continue;
      const who = (align.get(Number(l.inning)) || []).find((x) => x.position === pos);
      if (who?.playerId) get(who.playerId).chances += 1;
    }
    for (const [id, set] of played) get(id).innings += set.size;
  }
  return out;
}
const FIELDED = new Set(['out', 'single', 'double', 'triple', 'error', 'sacBunt', 'sacFly']);

// 金額(万円)を見やすい単位で丸める
export function roundMan(man) {
  if (man >= 10000) return Math.round(man / 1000) * 1000; // 1億以上は1000万円単位
  if (man >= 1000) return Math.round(man / 100) * 100; // 1000万円以上は100万円単位
  return Math.max(10, Math.round(man / 10) * 10); // それ未満は10万円単位
}

// players: [{id,name}], battingMap/pitchingMap: aggregateBatting/aggregatePitching の結果
// 戻り値: 年俸の高い順 [{ playerId, points, rank, man }]
// extraMap: participation() の結果 { playerId -> { apps, chances } }(省略可)
export function teamSalaries(players = [], battingMap = {}, pitchingMap = {}, topOku = SALARY_TOP_DEFAULT, extraMap = {}) {
  const topMan = clampTop(topOku) * 10000;
  const rows = players.map((pl) => ({ playerId: pl.id, points: salaryPoints(battingMap[pl.id], pitchingMap[pl.id], extraMap[pl.id]) }));
  rows.sort((a, b) => b.points - a.points);
  let rank = 0;
  let prev = null;
  rows.forEach((r, i) => {
    if (r.points !== prev) { rank = i + 1; prev = r.points; }
    r.rank = rank;
    const man = r.points > 0 ? topMan * SALARY_RATE ** (rank - 1) : 0;
    r.man = roundMan(Math.max(man, topMan * SALARY_FLOOR));
  });
  return rows;
}

// 表示。日本語は「3億2,000万円」、英語は「¥320M」
export function formatSalary(man, lang = 'ja') {
  if (lang === 'en') {
    const m = man / 100; // 百万円
    return m >= 1000 ? `¥${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}B` : `¥${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  const oku = Math.floor(man / 10000);
  const rest = man % 10000;
  if (oku && rest) return `${oku}億${rest.toLocaleString('ja-JP')}万円`;
  if (oku) return `${oku}億円`;
  return `${rest.toLocaleString('ja-JP')}万円`;
}

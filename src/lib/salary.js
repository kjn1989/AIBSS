// ============================================================
// 推定年俸(お遊び)。チームの中での成績の順位で決める。
//
// 1. 成績をポイントにする(数え方は下の salaryPoints。根拠はすべて画面に書く)
// 2. ポイントの多い順に並べる(同点は同じ順位)
// 3. 1位 = チーム最高額(設定。初期5億円・上限100億円)。順位が1つ下がるごとに RATE 倍
// 4. 記録が無い選手は最低額(最高額の1%)
// 実在の年俸の計算方法ではない。チームの中で「誰が上か」を楽しむための数字。
// ============================================================

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
// 投手の1試合(7回・3奪三振・3自責点)が、打者のよく打った1試合(2安打・1得点・1打点)の2倍くらいになる重み
export function salaryPoints(b, p) {
  const bat = b ? (b.tb || 0) + (b.bb || 0) + (b.hbp || 0) + (b.sb || 0) + (b.runs || 0) + (b.rbi || 0) : 0;
  const pit = p
    ? Math.max(0, ((p.outsRecorded || 0) / 3) * 1.5 + (p.strikeouts || 0) * 0.5 - (p.earnedRuns || 0) - ((p.walks || 0) + (p.hitByPitch || 0)) * 0.3)
    : 0;
  return Math.round((bat + pit) * 10) / 10;
}

// 金額(万円)を見やすい単位で丸める
export function roundMan(man) {
  if (man >= 10000) return Math.round(man / 1000) * 1000; // 1億以上は1000万円単位
  if (man >= 1000) return Math.round(man / 100) * 100; // 1000万円以上は100万円単位
  return Math.max(10, Math.round(man / 10) * 10); // それ未満は10万円単位
}

// players: [{id,name}], battingMap/pitchingMap: aggregateBatting/aggregatePitching の結果
// 戻り値: 年俸の高い順 [{ playerId, points, rank, man }]
export function teamSalaries(players = [], battingMap = {}, pitchingMap = {}, topOku = SALARY_TOP_DEFAULT) {
  const topMan = clampTop(topOku) * 10000;
  const rows = players.map((pl) => ({ playerId: pl.id, points: salaryPoints(battingMap[pl.id], pitchingMap[pl.id]) }));
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

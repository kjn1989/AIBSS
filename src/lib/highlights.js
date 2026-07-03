// ============================================================
// 試合ハイライト: 1試合分のAtBat/PitchingRecordから
// 決勝打・好投・MVP・見どころを自動抽出し、共有用テキストを組み立てる。
// ============================================================
import { aggregateBatting, aggregatePitching, pitchingMetrics } from './stats.js';
import { formatIP } from './model.js';
import { playLabel } from './voiceParser.js';

const inningLabel = (ab) => `${ab.snapshot?.inning ?? '?'}回${ab.snapshot?.isTop ? '表' : '裏'}`;

// 決勝点・勝ち越し打: 試合中に起きた goahead/comeback/first のうち最後のもの
function findClutchHit(game) {
  const ab = [...game.atBats].reverse().find((a) => ['goahead', 'comeback', 'first'].includes(a.clutch));
  if (!ab) return null;
  return { atBat: ab, label: `${inningLabel(ab)} ${playLabel(ab.result, ab.direction, ab.outType, ab.soType)}(${ab.rbi}打点)` };
}

// MVP的活躍: 安打3・本塁打5・打点2・得点1の簡易加重で最高得点の打者
function findTopBatter(batting, nameOf) {
  let best = null;
  for (const s of Object.values(batting)) {
    if (s.pa === 0) continue;
    const score = s.h * 3 + s.hr * 5 + s.rbi * 2 + s.runs;
    if (score <= 0) continue;
    if (!best || score > best.score) best = { ...s, score, name: nameOf(s.playerId) };
  }
  return best;
}

// 好投: 勝利投手 > セーブ投手 > 奪三振最多 の順で選出
function findTopPitcher(pitching, nameOf) {
  const list = Object.values(pitching).filter((s) => s.outsRecorded > 0 || s.games > 0);
  if (list.length === 0) return null;
  const win = list.find((s) => s.wins > 0);
  const save = list.find((s) => s.saves > 0);
  const pick = win || save || [...list].sort((a, b) => b.strikeouts - a.strikeouts)[0];
  const m = pitchingMetrics(pick);
  return {
    ...pick,
    name: nameOf(pick.playerId),
    tag: win ? '勝利投手' : save ? 'セーブ' : '好投',
    line: `${formatIP(pick.outsRecorded)}回 ${pick.strikeouts}奪三振 自責${pick.earnedRuns} (防御率${m.era7 === null ? '-' : m.era7.toFixed(2)})`,
  };
}

// 見どころ: 長打(二塁打・三塁打・本塁打)を時系列で
function findExtraBaseHits(game, nameOf) {
  return game.atBats
    .filter((ab) => ['double', 'triple', 'hr'].includes(ab.result))
    .map((ab) => `${inningLabel(ab)} ${nameOf(ab.playerId)} ${playLabel(ab.result, ab.direction, ab.outType, ab.soType)}`);
}

export function computeHighlights(game, nameOf) {
  const batting = aggregateBatting([game]);
  const pitching = aggregatePitching([game]);
  const resultLabel = game.myScore > game.oppScore ? '勝利' : game.myScore < game.oppScore ? '敗北' : '引き分け';

  return {
    resultLabel,
    clutch: findClutchHit(game),
    topBatter: findTopBatter(batting, nameOf),
    topPitcher: findTopPitcher(pitching, nameOf),
    extraBaseHits: findExtraBaseHits(game, nameOf),
  };
}

// SNS等への貼り付け用テキストを生成
export function highlightShareText(game, h) {
  const lines = [];
  lines.push(`⚾ ${game.date} vs ${game.opponent || '対戦相手'}`);
  lines.push(`${game.myScore} - ${game.oppScore} (${h.resultLabel})`);
  if (h.clutch) lines.push(`🔥 決勝/勝ち越し打: ${h.clutch.label}`);
  if (h.topBatter) lines.push(`🏅 MVP: ${h.topBatter.name}(${h.topBatter.h}安打 ${h.topBatter.rbi}打点)`);
  if (h.topPitcher) lines.push(`💪 ${h.topPitcher.tag}: ${h.topPitcher.name} ${h.topPitcher.line}`);
  if (h.extraBaseHits.length > 0) {
    lines.push('見どころ:');
    for (const t of h.extraBaseHits) lines.push(`・${t}`);
  }
  return lines.join('\n');
}

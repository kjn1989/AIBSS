// ============================================================
// 試合ハイライト: 1試合分のAtBat/PitchingRecordから
// 決勝打・好投・MVP・見どころを自動抽出し、共有用テキストを組み立てる。
//
// 表示言語について:
// ここが返すのは画面にそのまま出る文字列(「8回裏 松本 犠打(1打点)」など)なので、
// 言語を受け取る。以前は日本語で組み立てて返していたため、英語表示にしても
// 試合結果の画面のここだけ日本語が残っていた。
// 勝敗は色分けなどの判定にも使うので、訳した文字列とは別に resultKey を返す
// (訳文で分岐すると、言語を足すたびに分岐が増える)。
// ============================================================
import { aggregateBatting, aggregatePitching, pitchingMetrics } from './stats.js';
import { formatIP } from './model.js';
import { playLabel } from './voiceParser.js';
import { translate } from './i18n.js';

const inningLabel = (ab, lang) => translate(
  lang,
  ab.snapshot?.isTop ? 'hl.inningTop' : 'hl.inningBot',
  { n: ab.snapshot?.inning ?? '?' },
);

// 決勝点・勝ち越し打: 試合中に起きた goahead/comeback/first のうち最後のもの
function findClutchHit(game, nameOf, lang) {
  const ab = [...game.atBats].reverse().find((a) => ['goahead', 'comeback', 'first'].includes(a.clutch));
  if (!ab) return null;
  const who = nameOf ? nameOf(ab.playerId) : '';
  const play = playLabel(ab.result, ab.direction, ab.outType, ab.soType, undefined, lang, { hitAngle: ab.hitAngle });
  const rbi = translate(lang, 'hl.rbiParen', { n: ab.rbi });
  return { atBat: ab, name: who, label: `${inningLabel(ab, lang)} ${who ? `${who} ` : ''}${play}${rbi}` };
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
function findTopPitcher(pitching, nameOf, lang, basis) {
  const list = Object.values(pitching).filter((s) => s.outsRecorded > 0 || s.games > 0);
  if (list.length === 0) return null;
  const win = list.find((s) => s.wins > 0);
  const save = list.find((s) => s.saves > 0);
  const pick = win || save || [...list].sort((a, b) => b.strikeouts - a.strikeouts)[0];
  const m = pitchingMetrics(pick, basis, lang);
  const tagKey = win ? 'hl.tagWin' : save ? 'hl.tagSave' : 'hl.tagGood';
  return {
    ...pick,
    name: nameOf(pick.playerId),
    tagKey,
    tag: translate(lang, tagKey),
    line: translate(lang, 'hl.pitchLine', {
      ip: formatIP(pick.outsRecorded),
      k: pick.strikeouts,
      er: pick.earnedRuns,
      era: m.era === null ? '-' : m.era.toFixed(2),
    }),
  };
}

// 見どころ: 長打(二塁打・三塁打・本塁打)を時系列で
function findExtraBaseHits(game, nameOf, lang) {
  return game.atBats
    .filter((ab) => ['double', 'triple', 'hr'].includes(ab.result))
    .map((ab) => `${inningLabel(ab, lang)} ${nameOf(ab.playerId)} ${playLabel(ab.result, ab.direction, ab.outType, ab.soType, undefined, lang, { intentional: ab.intentional })}`);
}

export function computeHighlights(game, nameOf, lang = 'ja', basis = undefined) {
  const batting = aggregateBatting([game]);
  const pitching = aggregatePitching([game]);
  // 1試合ぶんなので、回数換算はその試合のルールがいちばん正しい
  const b = basis ?? game?.rules?.innings ?? 7;
  const resultKey = game.myScore > game.oppScore ? 'win' : game.myScore < game.oppScore ? 'lose' : 'draw';

  return {
    resultKey,
    resultLabel: translate(lang, `hl.${resultKey}`),
    clutch: findClutchHit(game, nameOf, lang),
    topBatter: findTopBatter(batting, nameOf),
    topPitcher: findTopPitcher(pitching, nameOf, lang, b),
    extraBaseHits: findExtraBaseHits(game, nameOf, lang),
  };
}

// SNS等への貼り付け用テキストを生成
export function highlightShareText(game, h, lang = 'ja') {
  const T = (k, p) => translate(lang, k, p);
  const lines = [];
  lines.push(`⚾ ${game.date} vs ${game.opponent || T('hl.oppFallback')}`);
  lines.push(`${game.myScore} - ${game.oppScore} (${h.resultLabel})`);
  if (h.clutch) lines.push(T('hl.shareClutch', { x: h.clutch.label }));
  if (h.topBatter) lines.push(T('hl.shareMvp', { name: h.topBatter.name, h: h.topBatter.h, rbi: h.topBatter.rbi }));
  if (h.topPitcher) lines.push(`💪 ${h.topPitcher.tag}: ${h.topPitcher.name} ${h.topPitcher.line}`);
  if (h.extraBaseHits.length > 0) {
    lines.push(T('hl.shareHighlights'));
    for (const x of h.extraBaseHits) lines.push(`・${x}`);
  }
  return lines.join('\n');
}

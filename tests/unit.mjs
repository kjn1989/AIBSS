// 純関数ロジックのユニットテスト(node:test / 依存追加なし)
// 実行: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeMoves, judgeAdvance, batterDestOptions } from '../src/lib/plays.js';
import { gameEndCheck, initialPresetIdFor, defaultPresetIdForEdition, presetById, describeRules, rulesAtInning, currentRules, fieldCountAt, isTiebreakInning, diffLiveRules, describeRulePatch, runnersPlaced, placedRunsScored, halfKeyOf, DEFAULT_TIEBREAK, ALL_BAT_MAX, TIEBREAK_RUNNERS, allBatSize, lineupSlotsFor } from '../src/lib/rules.js';
import { aggregateFielding, rankFielding, aggregateBatting, aggregatePitching, battingMetrics, pitchingMetrics, titleLeaders, DETAIL_METRICS, detailRanking, defaultInningBasis } from '../src/lib/stats.js';
import { translate } from '../src/lib/i18n.js';
import { newspaperPrompt, editionForPrompt } from '../src/lib/gemini.js';
import { kindsFor, kindOf, kindPatch, defaultKindFor } from '../src/lib/editionKind.js';
import { swapOrderPlan, canSwapOrder } from '../src/lib/lineupOrder.js';
import { parseUtterance, prettifyTranscript, parseRunnerAdjust, needsRunnerConfirm, needsComplexConfirm, parseDirectionOnly, parseContact, playLabel } from '../src/lib/voiceParser.js';
import { swapTargetIndex, timingAnchor } from '../src/lib/logOrder.js';
import { parseBatterCorrection, findTargetAtBat, parseSubstitution, parseSubstitutions, parseBatterReassignments, parseResultCorrections, assignResultTargets, mergeResultCorrections, parsePositionCorrections, parseDefensiveAlignment, parsePositionSwaps, keepsBattingOrder, explicitOrderChange, stripInningFractions, parseInningRange, parseSlotBatters, parseAtBatDeletions, parseShortResult, isExplicitSubText, inGamePlayerIds, preferInGamePlayers } from '../src/lib/correctionParser.js';
import { buildLineupRows, posChar, roleTag, assignAtBatsByPlayer, resolveStarters, findPositionIssues, alignmentByInning } from '../src/lib/lineupBox.js';
import { rebuildPitchingStats } from '../src/lib/pitchingRebuild.js';
import { backupPayload, backupFileName } from '../src/lib/backup.js';
import { draftNarrative, noteOf, noteKeyOf } from '../src/lib/narrative.js';
import { tiebreakPlacement, backInOrder, halfHasPlays, halfStartKeyOf } from '../src/lib/tiebreak.js';
import { aggregateScorers, rankScorers, scorerName, tagScorerId } from '../src/lib/scorers.js';
import { buildRunDists, buildWinModel, priorDist, remainingHalves, SCORE_PROB, MAX_RUNS } from '../src/lib/winExp.js';
import { TEAM_GAPS, buildGapModel, gapTables, gapOf, scaleDist, scaleDists, S_EXP } from '../src/lib/teamGap.js';
import { aggregateScorersOver, swingScale, OPEN_MIN_SWING, OPEN_REACT_SWING } from '../src/lib/scorers.js';
import { aggregateContrib, rankContrib, formatContrib } from '../src/lib/contrib.js';
import { LEVEL_K, LEVEL_MIN, LEVEL_MAX, stateKey, buildRunExpectancy, flowSeries, flowRuns, judgeFlowTags, movePlays, formatRate, weShape, weSeries, stateOfKey, BASE_RE, reOf, KOSHIEN_RE, KOSHIEN_WEIGHTS, KOSHIEN_LEVEL, isKoshienMeasured, baseReFor } from '../src/lib/flow.js';
import { teamPower, mostOff, formatPower } from '../src/lib/teamPower.js';
import { RESULTS as RESULTS_FOR_OUT, OUT_TYPES, outTypeLabel, infieldFlyPossible, newGame, allowsFoul, newPlayer, FIELD_POSITIONS, playablePosition, positionCoverage, uncoveredPositions, attendeesOf, lastAttendees, autoLineupFrom, lineupFromPast, playErrorOf, finePlayOf, editionLabel, subRank, resultLabelOf, isIntentionalBB } from '../src/lib/model.js';
import { buildOppLineupRows, oppBattingByLetter, oppPitcherLetters, oppPitchingStats, oppNameOf, logTextOf, oppLettersInGame, oppBaserunning } from '../src/lib/oppBox.js';
import { remapPlayerInGame, fillPlayerGaps } from '../src/lib/mergePlayers.js';
import { computeBoxScore, halfPlayed } from '../src/lib/boxscore.js';
import { buildMatchups, opponentSummaries, oppPitcherByAtBat, oppPlayerKey, normalizeName, opponentTeams, lastOppRoster, oppPlayerAtBats, oppBatteryStats, oppOffenseStats } from '../src/lib/matchup.js';
import { yearOfDate, yearOfGame, yearsInGames, tenureByPlayer, playedInYear, isArchived, yearLabel, currentYear, resolveYear, scopedGames,
  gradeOf, entryYearFromGrade, willGraduate, sortByGrade, usesGrade, defaultSchoolType, maxGradeOf,
  defaultYearStartMonth, schoolYearAtSeasonEnd, currentSchoolYear, labelOfYear } from '../src/lib/year.js';

import { rebuildBatters, findDuplicateAtBats, findOrderBreaks, canRebuildOrders, expectedBatterIndex, expectedOppBatterIndex, batterDrift } from '../src/lib/battersRebuild.js';
import { ownOffenseStats, ownBatteryStats } from '../src/lib/ownScout.js';
import { padPointToBall, ballToPadPoint, nearestDirection, depthBand, contactCandidate, ballOf, chartPoint, zoneCounts, zoneOf, POS_BALL, PAD_VB, PAD_ASPECT, padPoint, padWedge, padBandRange, PAD_STANDS_TOP, padSector, padArc, isFoul } from '../src/lib/battedBall.js';

test('parseDirectionOnly: 方向のみの発話は方向、結果語を含めばnull(言い直し扱い)', () => {
  assert.equal(parseDirectionOnly('ライト'), 'RF');
  assert.equal(parseDirectionOnly('方向はセンター'), 'CF');
  assert.equal(parseDirectionOnly('レフトへ'), 'LF');
  assert.equal(parseDirectionOnly('センター前ヒット'), null);
  assert.equal(parseDirectionOnly('三塁打'), null);
});

test('needsRunnerConfirm: 走者ありの安打・凡打は確認、四球/本塁打/走者なしは不要', () => {
  assert.equal(needsRunnerConfirm('single', { 1: true, 2: true }), true);
  assert.equal(needsRunnerConfirm('out', { 3: true }), true);
  assert.equal(needsRunnerConfirm('single', {}), false);
  assert.equal(needsRunnerConfirm('hr', { 1: true }), false);
  assert.equal(needsRunnerConfirm('bb', { 1: true }), false);
});
test('parseRunnerAdjust: 走者進塁の音声修正を解釈', () => {
  assert.deepEqual(parseRunnerAdjust('二塁ランナーは三塁'), { base: 2, to: 3 });
  assert.deepEqual(parseRunnerAdjust('一塁走者は得点'), { base: 1, to: 4 });
  assert.deepEqual(parseRunnerAdjust('セカンドランナーそのまま'), { base: 2, to: 'stay' });
  assert.deepEqual(parseRunnerAdjust('三塁ランナーアウト'), { base: 3, to: 'out' });
  assert.equal(parseRunnerAdjust('はい'), null);
});

test('parseUtterance: 「センターマイヒット」(前ヒットの誤認識)も中堅ヒット・高信頼度', () => {
  const a = parseUtterance('センター前ヒット')[0];
  const b = parseUtterance('センターマイヒット')[0];
  assert.equal(b.result, 'single');
  assert.equal(b.direction, 'CF');
  assert.equal(b.confidence, a.confidence); // 誤認識でも正しく聞けた時と同じ信頼度
});
test('prettifyTranscript: 表示用に「マイヒット」を「前ヒット」へ整形', () => {
  assert.equal(prettifyTranscript('センターマイヒット'), 'センター前ヒット');
});

// ---- voiceParser.js: 投球コール ----
test('parseUtterance: 「空振り」単独は1ストライク(pitch)・種別swinging', () => {
  const top = parseUtterance('空振り')[0];
  assert.equal(top.kind, 'pitch');
  assert.equal(top.pitchType, 'strike');
  assert.equal(top.sub, 'swinging');
});
test('parseUtterance: 「見逃し」単独も1ストライク(pitch)・種別looking', () => {
  const top = parseUtterance('見逃し')[0];
  assert.equal(top.kind, 'pitch');
  assert.equal(top.pitchType, 'strike');
  assert.equal(top.sub, 'looking');
});
test('parseUtterance: 「空振り三振」は三振(so)で投球にならない', () => {
  const top = parseUtterance('空振り三振')[0];
  assert.equal(top.kind, 'play');
  assert.equal(top.result, 'so');
});
test('parseUtterance: 「スクイズ」は犠打(sacBunt)として認識', () => {
  const top = parseUtterance('スクイズ')[0];
  assert.equal(top.kind, 'play');
  assert.equal(top.result, 'sacBunt');
});
test('parseUtterance: 「金振り/かなぶり」(空振りの誤認識)も空振りストライク', () => {
  for (const s of ['金振り', 'かなぶり', 'カナブリ']) {
    const top = parseUtterance(s)[0];
    assert.equal(top.kind, 'pitch', s);
    assert.equal(top.pitchType, 'strike', s);
    assert.equal(top.sub, 'swinging', s);
  }
  assert.equal(parseUtterance('金振り三振')[0].result, 'so');
});

// ---- 文章での打者修正パーサ ----
const CORR_PLAYERS = [
  { id: 'kawai', name: '河合' }, { id: 'yamashiro', name: '山城' },
  { id: 'irimajiri', name: '入交' }, { id: 'takashima', name: '髙島' },
];
test('parseBatterCorrection: 「◯回の◯◯でなく△△」= 対象と付け替え先を抽出', () => {
  const r = parseBatterCorrection('4回の第2打席は河合でなく山城です', CORR_PLAYERS);
  assert.equal(r.ok, true);
  assert.equal(r.inning, 4);
  assert.equal(r.ordinal, 2);
  assert.equal(r.targetPlayerId, 'kawai');
  assert.equal(r.newPlayerId, 'yamashiro');
});
test('parseBatterCorrection: 「◯回の◯◯の打席は△△」= 名前で対象特定', () => {
  const r = parseBatterCorrection('3回の入交の打席は髙島でした', CORR_PLAYERS);
  assert.equal(r.ok, true);
  assert.equal(r.inning, 3);
  assert.equal(r.targetPlayerId, 'irimajiri');
  assert.equal(r.newPlayerId, 'takashima');
});
test('parseBatterCorrection: 回が無い/付け替え先が無いはエラー', () => {
  assert.equal(parseBatterCorrection('河合でなく山城', CORR_PLAYERS).ok, false);
  assert.equal(parseBatterCorrection('4回の打席', CORR_PLAYERS).ok, false);
});
test('parseSubstitution: 「2回にキャッチャー河合が負傷、山城と交代」= 守備交代を解釈', () => {
  const r = parseSubstitution('2回にキャッチャー河合が負傷、山城と交代', CORR_PLAYERS);
  assert.equal(r.ok, true);
  assert.equal(r.inning, 2);
  assert.equal(r.outId, 'kawai'); // 先に出る名前=退く側
  assert.equal(r.inId, 'yamashiro');
  assert.equal(r.position, '捕');
  assert.equal(r.subKind, 'def');
});
test('parseSubstitution: 代打/代走の種別と、交代文でない文の切り分け', () => {
  assert.equal(parseSubstitution('4回、河合に代わって山城が代打', CORR_PLAYERS).subKind, 'ph');
  // 交代の語も守備位置も無い(打者付け替え)文は notSub を返す→呼び出し側で打者付け替えへ
  assert.equal(parseSubstitution('3回の入交の打席は髙島', CORR_PLAYERS).ok, false);
});
test('parseSubstitutions: 1文章から複数の投手交代をすべて抽出', () => {
  const PS = [{ id: 't', name: '髙島' }, { id: 'u', name: '宇田川' }, { id: 'm', name: '茂木' }];
  const txt = 'JICA TWINS側の投手が実は交代していました。3回裏からは髙島に代わり、宇田川が投手に。宇田川は4回も投げました。\n\n'
    + '5回裏に、ピッチャーが宇田川から茂木に替わりました。更に、5回裏に4番に四球を出した後に、茂木からまた宇田川に投手を交代しました。';
  const subs = parseSubstitutions(txt, PS);
  assert.equal(subs.length, 3);
  assert.deepEqual(subs.map((s) => [s.inning, s.outId, s.inId]), [
    [3, 't', 'u'], [5, 'u', 'm'], [5, 'm', 'u'],
  ]);
  assert.ok(subs.every((s) => s.position === '投')); // ピッチャー/投手→投
  assert.equal(subs[2].afterOppOrder, 4); // 「4番に四球を出した後に」→ 回途中交代のアンカー
});
test('parseBatterReassignments: 複数回の打者付け替え(5回・7回)を両方抽出', () => {
  const PS = [{ id: 's', name: '清水' }, { id: 'n', name: '中島' }];
  const txt = '中島が清水の代打で入りました。清水の5回、7回の打撃は中島です。';
  const rs = parseBatterReassignments(txt, PS);
  assert.equal(rs.length, 2);
  assert.deepEqual(rs.map((r) => [r.inning, r.targetId, r.newId]), [[5, 's', 'n'], [7, 's', 'n']]);
});
test('parseDefensiveAlignment: 「7回の守備はショート茂木、サード入交、セカンド宇田川」= 3件の守備位置', () => {
  const PS = [{ id: 'm', name: '茂木' }, { id: 'i', name: '入交' }, { id: 'u', name: '宇田川' }];
  const rs = parseDefensiveAlignment('7回の守備はショート茂木、サード入交、セカンド宇田川でした', PS);
  assert.deepEqual(rs.map((r) => [r.inning, r.playerId, r.position]), [
    [7, 'm', '遊'], [7, 'i', '三'], [7, 'u', '二'],
  ]);
});
test('parseDefensiveAlignment: 「◯◯は6回からレフトからファーストに変更」= 1人の守備位置変更', () => {
  const PS = [{ id: 'n', name: '中島' }, { id: 's', name: '清水' }];
  const rs = parseDefensiveAlignment('中島は6回からレフトからファーストに変更していました', PS);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].inning, 6);
  assert.equal(rs[0].playerId, 'n');
  assert.equal(rs[0].position, '一'); // 「AからBに」のB(移動後)を採る
});
test('parseDefensiveAlignment: 1人の文でも位置変更の文脈が無ければ拾わない / 投手はの交代側に任せる', () => {
  const PS = [{ id: 'n', name: '中島' }, { id: 'u', name: '宇田川' }];
  // 打席の記述(位置ワードは打球方向)を守備位置変更と誤検出しない
  assert.equal(parseDefensiveAlignment('1回 中島 レフト前ヒット', PS).length, 0);
  // 投手への変更は継投の記録が必要なので parseSubstitutions の担当
  assert.equal(parseDefensiveAlignment('3回から宇田川がピッチャーに変更', PS).length, 0);
});
test('parseSubstitutions: 守備陣形の申告を「交代」と誤読しない', () => {
  const PS = [{ id: 'm', name: '茂木' }, { id: 'i', name: '入交' }, { id: 'u', name: '宇田川' }];
  // 以前は先頭2名を拾って「茂木→入交(二塁)」という誤った交代を1件作っていた
  assert.deepEqual(parseSubstitutions('7回の守備はショート茂木、サード入交、セカンド宇田川でした', PS), []);
});
test('parseDefensiveAlignment: 交代文は拾わない(交代解釈と取り合わない)', () => {
  const PS = [{ id: 'y', name: '山城' }, { id: 'm', name: '松田' }, { id: 'k', name: '河合' }];
  // 交代語を含む文は parseSubstitutions の担当
  assert.equal(parseDefensiveAlignment('2回にキャッチャー河合が負傷、ファースト山城と交代', PS).length, 0);
  // 1人ぶんの守備位置の申告は拾う(交代語が無いので交代側とは取り合わない)
  const one = parseDefensiveAlignment('6回の守備はキャッチャー松田でした', PS);
  assert.deepEqual(one.map((r) => [r.inning, r.playerId, r.position]), [[6, 'm', '捕']]);
});
test('parseDefensiveAlignment: 「2回から山城はキャッチャーです」のような素直な言い方も拾う', () => {
  const PS = [{ id: 'y', name: '山城' }, { id: 'n', name: '中島' }];
  assert.deepEqual(
    parseDefensiveAlignment('2回から山城はキャッチャーです', PS).map((r) => [r.inning, r.playerId, r.position]),
    [[2, 'y', '捕']],
  );
  // 打席結果の記述は守備位置として拾わない
  assert.equal(parseDefensiveAlignment('1回 中島 レフト前ヒット', PS).length, 0);
  assert.equal(parseDefensiveAlignment('7回表の中島は中犠飛です', PS).length, 0);
});

// ---- 相手チームの記録(記号A〜Tで記録された打席を打順ツリーへ) ----
const OPP_GAME = {
  oppLineup: 'ABCDEFGHI'.split('').map((letter, i) => ({ order: i + 1, letter: i === 4 ? 'J' : letter, position: '' })),
  oppPitcherLetter: 'K',
  oppNames: { A: '佐々木' },
  playLogs: [
    { kind: 'defense', inning: 1, payload: { letter: 'A', order: 1, result: 'single', runs: 0 } },
    { kind: 'defense', inning: 1, payload: { letter: 'B', order: 2, result: 'so', runs: 0 } },
    { kind: 'defense', inning: 3, payload: { letter: 'A', order: 1, result: 'hr', runs: 2 } },
    { kind: 'defense', inning: 3, payload: { letter: 'A', order: 1, result: 'bb', runs: 0 } },
    { kind: 'oppsub', inning: 5, payload: { order: 5, in: 'J', out: 'E' } },
    { kind: 'defense', inning: 6, payload: { letter: 'J', order: 5, result: 'double', runs: 1 } },
    { kind: 'opppitcher', inning: 4, payload: { in: 'K', out: 'A' } },
  ],
};

test('buildOppLineupRows: 相手も自軍と同じ打順ツリーの形にする(先発は交代ログのoutから復元)', () => {
  const rows = buildOppLineupRows(OPP_GAME);
  assert.equal(rows.length, 9);
  assert.deepEqual(rows[0].players.map((p) => p.letter), ['A']);
  // 5番は E が先発で、5回に J が入った
  assert.deepEqual(rows[4].players.map((p) => p.letter), ['E', 'J']);
  assert.equal(rows[4].players[0].isStarter, true);
  assert.equal(rows[4].players[1].isStarter, false);
  assert.equal(rows[4].players[1].inning, 5);
});

test('oppBattingByLetter: 守備ログからその試合の相手打撃成績を出す', () => {
  const m = oppBattingByLetter(OPP_GAME);
  // A: 単打・本塁打・四球 → 3打席 2打数 1安打 1本 2打点(その打席の得点)
  assert.deepEqual(m.get('A'), { pa: 3, ab: 2, h: 2, rbi: 2, hr: 1 });
  assert.deepEqual(m.get('B'), { pa: 1, ab: 1, h: 0, rbi: 0, hr: 0 });
  assert.deepEqual(m.get('J'), { pa: 1, ab: 1, h: 1, rbi: 1, hr: 0 });
  assert.equal(m.has('C'), false); // 打席が無い記号は出てこない
});

test('oppPitcherLetters: 先発(最初の交代のout)と継投した記号を並べる', () => {
  assert.deepEqual(oppPitcherLetters(OPP_GAME), ['A', 'K']);
  // 交代が無ければ現在の投手だけ
  assert.deepEqual(oppPitcherLetters({ oppPitcherLetter: 'A', playLogs: [] }), ['A']);
});

test('oppNameOf: 名前が入っていればその名前、無ければ記号のまま', () => {
  assert.equal(oppNameOf(OPP_GAME, 'A'), '佐々木');
  assert.equal(oppNameOf(OPP_GAME, 'B'), 'B');
  assert.equal(oppNameOf({}, 'C'), 'C');
});

test('oppLettersInGame: 打順に出た記号と登板した記号をまとめて返す', () => {
  const list = oppLettersInGame(OPP_GAME);
  assert.equal(list.includes('E') && list.includes('J') && list.includes('K'), true);
  assert.equal(new Set(list).size, list.length); // 重複なし
});

test('oppPitchingStats: 相手投手の成績を、球数の記録と自軍の打席から組み立てる', () => {
  const g = {
    isHome: false, // 自軍は先攻(表が自軍の攻撃)
    oppPitcherLetter: 'K',
    oppPitchers: { A: { pitches: 45 }, K: { pitches: 30 } },
    playLogs: [
      { kind: 'atbat', inning: 1, isTop: true, payload: { result: 'single', outsOnPlay: 0, runs: 0 } },
      { kind: 'atbat', inning: 1, isTop: true, payload: { result: 'so', outsOnPlay: 1, runs: 0 } },
      { kind: 'runner', inning: 1, isTop: true, payload: { outs: 1 } }, // 盗塁死もアウトに数える
      { kind: 'atbat', inning: 2, isTop: true, payload: { result: 'hr', outsOnPlay: 0, runs: 2 } },
      { kind: 'atbat', inning: 2, isTop: true, payload: { result: 'out', outsOnPlay: 1, runs: 0 } },
      { kind: 'opppitcher', inning: 3, payload: { in: 'K', out: 'A' } },
      { kind: 'atbat', inning: 3, isTop: true, payload: { result: 'bb', outsOnPlay: 0, runs: 0 } },
      { kind: 'atbat', inning: 3, isTop: true, payload: { result: 'out', outsOnPlay: 2, runs: 0 } },
      // 相手の攻撃中の走塁アウトは、相手投手のアウトには数えない
      { kind: 'runner', inning: 3, isTop: false, payload: { outs: 1 } },
    ],
  };
  const rows = oppPitchingStats(g);
  assert.deepEqual(rows.map((r) => r.letter), ['A', 'K']);
  const a = rows[0];
  // 1回・2回とも完了しているので3アウトずつに照合される(記録漏れの補完)
  assert.equal(a.outs, 6);
  assert.equal(a.h, 2);      // 単打 + 本塁打
  assert.equal(a.hr, 1);
  assert.equal(a.k, 1);
  assert.equal(a.runs, 2);
  assert.equal(a.pitches, 45); // 球数は入力時の記録から
  const k = rows[1];
  assert.equal(k.outs, 3); // 3回も完了扱いで3アウトに照合
  assert.equal(k.bb, 1);
  assert.equal(k.pitches, 30);
});
test('oppPitchingStats: 完了した回は3アウトで照合し、記録漏れを補う', () => {
  const g = {
    isHome: false, status: 'finished', myScore: 0, oppScore: 1,
    oppPitcherLetter: 'A', oppPitchers: { A: { pitches: 50 } },
    playLogs: [
      // 1回: アウトが1つしか記録されていない(走塁アウトのouts欠落を想定)
      { kind: 'atbat', inning: 1, isTop: true, payload: { result: 'out', outsOnPlay: 1 } },
      // 2回: 3アウトぶん記録済み
      { kind: 'atbat', inning: 2, isTop: true, payload: { result: 'out', outsOnPlay: 1 } },
      { kind: 'atbat', inning: 2, isTop: true, payload: { result: 'out', outsOnPlay: 1 } },
      { kind: 'atbat', inning: 2, isTop: true, payload: { result: 'so', outsOnPlay: 1 } },
      { kind: 'defense', inning: 2, isTop: false, payload: { letter: 'B', result: 'out', outsOnPlay: 1 } },
    ],
  };
  // 1回は2アウトぶん補われ、合計 3 + 3 = 6アウト = 2.0回
  assert.equal(oppPitchingStats(g)[0].outs, 6);
});
test('oppPitchingStats: 継投が無ければ現在の投手が先発として1人だけ出る', () => {
  const g = {
    isHome: false, oppPitcherLetter: 'A', oppPitchers: { A: { pitches: 88 } },
    playLogs: [{ kind: 'atbat', inning: 1, isTop: true, payload: { result: 'out', outsOnPlay: 1 } }],
  };
  const rows = oppPitchingStats(g);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].letter, rows[0].outs, rows[0].pitches], ['A', 1, 88]);
});

// ---- 対左右のスタッツ(相手投手・相手打者の左右を入れてある打席だけを母数にする) ----
const HAND_GAMES = [{
  atBats: [
    { playerId: 'b1', result: 'single', vsHand: 'L' },
    { playerId: 'b1', result: 'out', vsHand: 'L' },
    { playerId: 'b1', result: 'out', vsHand: 'R' },
    { playerId: 'b1', result: 'bb', vsHand: 'L' }, // 四球は打数に入らない
    { playerId: 'b1', result: 'double' },          // 左右未入力は母数に入れない
  ],
  playLogs: [
    { kind: 'defense', payload: { pitcherId: 'p1', batterHand: 'L', result: 'single' } },
    { kind: 'defense', payload: { pitcherId: 'p1', batterHand: 'L', result: 'out' } },
    { kind: 'defense', payload: { pitcherId: 'p1', batterHand: 'L', result: 'so' } },
    { kind: 'defense', payload: { pitcherId: 'p1', batterHand: 'R', result: 'out' } },
    { kind: 'defense', payload: { pitcherId: 'p1', batterHand: 'L', result: 'bb' } }, // 被打数に入らない
    { kind: 'defense', payload: { pitcherId: 'p1', batterHand: 'S', result: 'single' } }, // 両打は対象外
    { kind: 'defense', payload: { pitcherId: 'p1', result: 'single' } }, // 左右未入力は対象外
  ],
  pitchingRecords: [{ playerId: 'p1', outsRecorded: 21, earnedRuns: 2, hitsAllowed: 6, walks: 2, hitByPitch: 0, strikeouts: 7, pitches: 84, abFaced: 24 }],
}];

test('battingMetrics: 対左投手打率は左右を入力した打席だけを母数にする', () => {
  const b = aggregateBatting(HAND_GAMES).b1;
  assert.deepEqual(b.vsL, { ab: 2, h: 1 }); // 四球は打数外
  assert.deepEqual(b.vsR, { ab: 1, h: 0 });
  const m = battingMetrics(b);
  assert.equal(m.baVsL, 0.5);
  assert.equal(m.baVsR, 0);
  // 未入力の二塁打は通算打率には入るが、対左右には入らない
  assert.equal(b.ab, 4);
});

test('pitchingMetrics: 対左打者被打率・奪三振率・球数/回', () => {
  const p = aggregatePitching(HAND_GAMES).p1;
  assert.deepEqual(p.vsL, { ab: 3, h: 1 }); // 単打/凡打/三振が被打数、四球は除く
  assert.deepEqual(p.vsR, { ab: 1, h: 0 });
  const m = pitchingMetrics(p);
  assert.equal(m.obaVsL.toFixed(3), '0.333');
  assert.equal(m.obaVsR, 0);
  assert.equal(m.k7, 7 / 7 * 7);        // 7奪三振 / 7回 * 7
  assert.equal(m.pip, 84 / 7);          // 84球 / 7回
});

test('battingMetrics: 長打率と四球率', () => {
  const b = aggregateBatting(HAND_GAMES).b1;
  const m = battingMetrics(b);
  assert.equal(m.slg, (1 + 2) / 4);     // 単打1 + 二塁打2 塁打 / 4打数
  assert.equal(m.bbRate, 1 / 5);        // 四死球1 / 5打席
});

test('DETAIL_METRICS: 追加した指標がランキングに出せる(母数0なら除外)', () => {
  const bat = aggregateBatting(HAND_GAMES);
  const pit = aggregatePitching(HAND_GAMES);
  for (const key of ['baVsL', 'slg', 'bbRate', 'obaVsL', 'k7', 'pip']) {
    const def = DETAIL_METRICS.find((m) => m.key === key);
    assert.ok(def, `${key} が定義されていない`);
    const rows = detailRanking(def, bat, pit);
    assert.equal(rows.length, 1, `${key} の行が作れない`);
    assert.ok(rows[0].detail.length > 0);
  }
  // 対左の打席が無い選手はランキングに出さない
  const empty = detailRanking(DETAIL_METRICS.find((m) => m.key === 'baVsL'), { x: aggregateBatting([{ atBats: [{ playerId: 'x', result: 'single' }] }]).x }, {});
  assert.equal(empty.length, 0);
});

test('pitchingMetrics: 基準イニングで防御率・奪三振率が変わる', () => {
  const s = { outsRecorded: 21, earnedRuns: 2, hitsAllowed: 6, walks: 2, hitByPitch: 0, strikeouts: 7, pitches: 84, abFaced: 24 };
  const m7 = pitchingMetrics(s, 7);
  const m9 = pitchingMetrics(s, 9);
  assert.equal(m7.era, 2);            // 自責2 / 7回 * 7
  assert.equal(m9.era.toFixed(2), '2.57'); // 同じ内容でも9回換算だと増える
  assert.equal(m7.k7, 7);
  assert.equal(m9.k7, 9);
  assert.equal(m7.basis, 7);
  // 既定は7回換算(引数なし)
  assert.equal(pitchingMetrics(s).era, 2);
});
test('defaultInningBasis: 試合のルールから基準イニングの既定値を決める', () => {
  assert.equal(defaultInningBasis([{ rules: { innings: 9 } }, { rules: { innings: 9 } }, { rules: { innings: 7 } }]), 9);
  assert.equal(defaultInningBasis([{ rules: { innings: 6 } }]), 6);
  assert.equal(defaultInningBasis([{ rules: null }, {}]), 7); // ルール未設定は7回制とみなす
  assert.equal(defaultInningBasis([]), 7);
});
test('detailRanking: 基準イニングがランキングの値に反映される', () => {
  const pit = { p1: { playerId: 'p1', outsRecorded: 21, earnedRuns: 2, hitsAllowed: 6, walks: 2, hitByPitch: 0, strikeouts: 7, pitches: 84, abFaced: 24, vsL: { ab: 0, h: 0 }, vsR: { ab: 0, h: 0 } } };
  const def = DETAIL_METRICS.find((m) => m.key === 'k7');
  assert.equal(def.perInning, true);
  assert.equal(detailRanking(def, {}, pit, undefined, 7)[0].display, '7.00');
  assert.equal(detailRanking(def, {}, pit, undefined, 9)[0].display, '9.00');
});

test('parseShortResult: スコアシートの短縮表記を打席結果として読む', () => {
  assert.deepEqual(parseShortResult('中2'), { result: 'double', direction: 'CF' });
  assert.deepEqual(parseShortResult('中安'), { result: 'single', direction: 'CF' });
  assert.deepEqual(parseShortResult('三飛'), { result: 'out', outType: 'fly', direction: '3B' });
  assert.deepEqual(parseShortResult('遊ゴ'), { result: 'out', outType: 'ground', direction: 'SS' });
  assert.deepEqual(parseShortResult('左本'), { result: 'hr', direction: 'LF' });
  assert.deepEqual(parseShortResult('中犠飛'), { result: 'sacFly', direction: 'CF' });
  // 選手名や位置の文言に引っかからない
  assert.equal(parseShortResult('中島は'), null);
  assert.equal(parseShortResult('一塁は松田です'), null);
});

test('parseResultCorrections: 1文に複数の打席(「山城は3回に中2、4回に中安です」)', () => {
  const PS = [{ id: 'y', name: '山城' }, { id: 'm', name: '松田' }];
  const rs = parseResultCorrections('山城は3回に中2、4回に中安です。松田が3回に中飛、4回に三飛です。', PS);
  assert.equal(rs.length, 4);
  assert.deepEqual(rs.map((r) => [r.inning, r.batterId, r.patch.result]), [
    [3, 'y', 'double'], [4, 'y', 'single'], [3, 'm', 'out'], [4, 'm', 'out'],
  ]);
  // 方向・アウトの種類も短縮表記から取れる
  assert.equal(rs[0].patch.direction, 'CF');
  assert.deepEqual([rs[3].patch.direction, rs[3].patch.outType], ['3B', 'fly']);
});

// 打者一巡した回は同じ打者が同じ回に2打席立つ。どちらの打席かを言えないと、
// 2打席目に手が届かず、2文書いても両方が1打席目に当たって上書きになる。
// 交代は打席と打席の「間」に起きる。並び順そのものがタイミングなので、
// 隣と入れ替えて直す。打席を動かせるようにすると打順の並びを壊す操作を用意することになる。
test('swapTargetIndex: 交代だけを、同じ回の中で動かす', () => {
  const L = [
    { id: 'a1', kind: 'atbat', inning: 5, isTop: true },
    { id: 's1', kind: 'pitcher', inning: 5, isTop: true },
    { id: 'a2', kind: 'atbat', inning: 5, isTop: true },
    { id: 'c1', kind: 'change', inning: 5, isTop: false },
    { id: 'a3', kind: 'atbat', inning: 6, isTop: true },
  ];
  assert.equal(swapTargetIndex(L, 's1', -1), 0);
  assert.equal(swapTargetIndex(L, 's1', 1), 2);
  // 打席は動かせない
  assert.equal(swapTargetIndex(L, 'a1', 1), -1);
  assert.equal(swapTargetIndex(L, 'a2', -1), -1);
  // 表裏や回はまたがない
  assert.equal(swapTargetIndex(L, 'c1', -1), -1);
  assert.equal(swapTargetIndex(L, 'c1', 1), -1);
  // 端やIDなしは動かない
  assert.equal(swapTargetIndex(L, 'zz', 1), -1);
});

test('timingAnchor: 直前の打席が「どの打席の後か」になる', () => {
  const rows = [
    { id: 'a1', kind: 'atbat' },
    { id: 'r1', kind: 'run' },
    { id: 's1', kind: 'pitcher' },
    { id: 'a2', kind: 'atbat' },
  ];
  // 得点をまたいでも、直前の「打席」を指す
  assert.equal(timingAnchor(rows, 2).id, 'a1');
  // 回の先頭に置かれていれば拠り所は無い
  assert.equal(timingAnchor(rows, 0), null);
  assert.equal(timingAnchor([{ id: 's', kind: 'sub' }, { id: 'a', kind: 'atbat' }], 0), null);
});

test('parseResultCorrections: 打者一巡の回で1打席目/2打席目を撃ち分ける', () => {
  const PS = [{ id: 'i', name: '磯野' }];
  // 明示指定
  const rs = parseResultCorrections('6回の磯野は1打席目が左2、2打席目が中安です', PS);
  assert.deepEqual(rs.map((r) => [r.inning, r.batterId, r.nth, r.patch.result, r.patch.direction]), [
    [6, 'i', 1, 'double', 'LF'], [6, 'i', 2, 'single', 'CF'],
  ]);
  // 「第2打席」「二打席目」も同じ意味として読む
  assert.equal(parseResultCorrections('6回の磯野は第2打席が中安です', PS)[0].nth, 2);
  assert.equal(parseResultCorrections('6回の磯野は二打席目が中安です', PS)[0].nth, 2);
  // 「2打席目」の数字を打点として読んでしまわない
  assert.equal(parseResultCorrections('6回の磯野は2打席目が中安です', PS)[0].patch.rbi, undefined);
  // 打席目の指定が無ければ nth は付けず、書かれた順に割り当てる(適用側の役目)
  const plain = parseResultCorrections('6回の磯野は左2、中安です', PS);
  assert.deepEqual(plain.map((r) => [r.nth, r.patch.result]), [[null, 'double'], [null, 'single']]);
});

test('assignResultTargets: 同じ回の2打席を1打席目・2打席目へ別々に当てる', () => {
  const PS = [{ id: 'i', name: '磯野' }];
  // 6回に磯野が2打席、7回に1打席立っている試合
  const logs = [
    { id: 'L1', kind: 'atbat', inning: 6, payload: { playerId: 'i' } },
    { id: 'L2', kind: 'defense', inning: 6, payload: {} },
    { id: 'L3', kind: 'atbat', inning: 6, payload: { playerId: 'i' } },
    { id: 'L4', kind: 'atbat', inning: 7, payload: { playerId: 'i' } },
  ];
  const text = '6回の磯野は左2、中安です。7回の磯野は三振です。';
  const corrs = parseResultCorrections(text, PS);
  assert.deepEqual(
    assignResultTargets(logs, corrs).map((h) => [h.logId, h.nth]),
    [['L1', 1], ['L3', 2], ['L4', null]], // 1打席しかない回は打席番号を付けない
  );
  // 打席目を明示しても同じ結果になる。順番を逆に書いても指定どおりの打席に当たる
  const rev = parseResultCorrections('6回の磯野は2打席目が中安、1打席目が左2です', PS);
  assert.deepEqual(assignResultTargets(logs, rev).map((h) => h.logId), ['L3', 'L1']);
  // 2打席目だけを直す指示が、1打席目に当たってしまわない
  const only2 = parseResultCorrections('6回の磯野の2打席目は中安です', PS);
  assert.deepEqual(assignResultTargets(logs, only2).map((h) => [h.logId, h.nth]), [['L3', 2]]);
  // 打者で特定できない分は null を返し、呼び出し側の手掛かりに委ねる
  assert.deepEqual(assignResultTargets(logs, [{ inning: 6, batterId: 'zz' }]), [null]);
});

// AI併用時、回と打者だけで束ねると1打席目と2打席目が潰し合い、
// 「7件直すはずが5件しか入らない」形で片方の指示が黙って消えていた。
test('mergeResultCorrections: 同じ回・同じ打者の2打席が潰し合わない', () => {
  const PS = [{ id: 'i', name: '磯野' }, { id: 'o', name: '奥田' }];
  const local = parseResultCorrections('6回の磯野は1打席目が左2、2打席目が中安です。6回の奥田は見逃し三振です。', PS);
  // AIは打席目を返さないことがある。それでも両方の打席が残る
  const ai = [
    { inning: 6, batterId: 'i', nth: null, patch: { result: 'double' } },
    { inning: 6, batterId: 'i', nth: null, patch: { result: 'single' } },
    { inning: 6, batterId: 'o', nth: null, patch: { result: 'so' } },
  ];
  const merged = mergeResultCorrections(ai, local);
  assert.equal(merged.length, 3);
  // 食い違ったら端末内(local)が勝つ。磯野の2打席とも local の指示になっている
  assert.deepEqual(merged.map((r) => [r.batterId, r.nth, r.patch.result, r.patch.direction]), [
    ['i', 1, 'double', 'LF'], ['i', 2, 'single', 'CF'], ['o', null, 'so', null],
  ]);
  // 片側だけでも数は保たれる
  assert.equal(mergeResultCorrections(ai, []).length, 3);
  assert.equal(mergeResultCorrections([], local).length, 3);
  // 打席目の指定が両側にあれば、その番号どうしで突き合わせる
  const merged2 = mergeResultCorrections([{ inning: 6, batterId: 'i', nth: 2, patch: { result: 'hr' } }], local);
  assert.deepEqual(merged2.filter((r) => r.batterId === 'i').map((r) => [r.nth, r.patch.result]), [[2, 'single'], [1, 'double']]);
});

test('parseResultCorrections: 打点の訂正(「7回の中犠飛は打点1に修正」)', () => {
  const PS = [{ id: 'n', name: '中島' }, { id: 's', name: '清水' }];
  // 結果と打点を一緒に指定した場合
  assert.deepEqual(
    parseResultCorrections('中島の7回の中犠飛は打点1に修正してください', PS)
      .map((r) => [r.inning, r.batterId, r.patch.result, r.patch.rbi]),
    [[7, 'n', 'sacFly', 1]],
  );
  // 打点だけの訂正は結果に触れない(patch に result を入れない)
  const only = parseResultCorrections('中島の7回は打点1に修正してください', PS);
  assert.deepEqual(only.map((r) => [r.inning, r.batterId, r.patch.rbi]), [[7, 'n', 1]]);
  assert.equal(only[0].patch.result, undefined);
  // 「打点なし」は0として読む
  assert.equal(parseResultCorrections('7回の中島は打点なしに修正', PS)[0].patch.rbi, 0);
  // 「〜に修正してください」を合図に加えても、守備位置の訂正は結果修正にしない
  assert.deepEqual(parseResultCorrections('6-7回のライトは清水に修正してください', PS), []);
});

test('parseBatterReassignments: 複数回をまとめた付け替え(「5回の三振と7回の中犠飛は中島に」)', () => {
  const PS = [{ id: 's', name: '清水' }, { id: 'n', name: '中島' }];
  const rs = parseBatterReassignments('清水の5回の三振と7回の中犠飛は、中島に付け替えてください', PS);
  assert.deepEqual(rs.map((r) => [r.inning, r.targetId, r.newId]), [[5, 's', 'n'], [7, 's', 'n']]);
});

test('parseBatterReassignments: 「◯◯に入っている左飛を△△につけて」を付け替えとして読む', () => {
  const PS = [{ id: 'h', name: '平川' }, { id: 'o', name: '奥田' }];
  const T = '7回の平川は空席で、平川に入っている左飛を奥田につけてください';
  assert.deepEqual(
    parseBatterReassignments(T, PS).map((r) => [r.inning, r.targetId, r.newId]),
    [[7, 'h', 'o']],
  );
  // 「平川に入っている」の「入っ」を交代語と読んで実在しない交代を作らない
  assert.deepEqual(parseSubstitutions(T, PS), []);
  assert.equal(isExplicitSubText(T, ['平川', '奥田']), false);
  // 「空席」も打席の取り消し語として拾う(付け替えと重なる場合は呼び出し側で除外)
  assert.deepEqual(parseAtBatDeletions(T, PS).map((d) => [d.inning, d.playerId]), [[7, 'h']]);
  // 本物の交代文は今までどおり交代として読む
  assert.equal(parseSubstitutions('7回、平川に代わって奥田がサード', PS).length, 1);
});

test('preferInGamePlayers: 同名の二重登録は「その試合に出ている方」を掴む', () => {
  // 実際に起きていた不具合: 記録0件の重複登録が名簿の先に並んでいると、
  // 解析がそのIDを掴んでしまい、該当打席が見つからず修正が黙って捨てられていた。
  const players = [
    { id: 'dupY', name: '山城' }, { id: 'dupM', name: '松田' },
    { id: 'y', name: '山城' }, { id: 'm', name: '松田' },
  ];
  const game = {
    lineup: [{ order: 3, playerId: 'y' }, { order: 4, playerId: 'm' }],
    startingLineup: [], atBats: [], playLogs: [],
  };
  const inGame = inGamePlayerIds(game);
  assert.deepEqual([...inGame].sort(), ['m', 'y']);
  const ps = preferInGamePlayers(players, inGame);
  assert.deepEqual(ps.map((p) => p.id).sort(), ['m', 'y']); // 同名は1人に畳まれる
  const rs = parseResultCorrections('山城は3回に中2、4回に中安です。松田が3回に中飛、4回に三飛です。修正してください。', ps);
  assert.deepEqual(rs.map((r) => [r.inning, r.batterId, r.patch.result]), [
    [3, 'y', 'double'], [4, 'y', 'single'], [3, 'm', 'out'], [4, 'm', 'out'],
  ]);
  // 重複登録が無い名簿でも壊れない
  assert.equal(preferInGamePlayers([{ id: 'a', name: '佐藤' }], new Set()).length, 1);
});

test('parseAtBatDeletions: 打席の取り消し(「7回の平川の打席は空欄に」)', () => {
  const PS = [{ id: 'h', name: '平川' }, { id: 'o', name: '奥田' }];
  assert.deepEqual(
    parseAtBatDeletions('7回の平川の打席は空欄にしてください', PS).map((d) => [d.inning, d.playerId]),
    [[7, 'h']],
  );
  // 打順や「第◯打席」でも指せる
  assert.deepEqual(parseAtBatDeletions('7回の8番の打席を削除', PS).map((d) => [d.inning, d.order]), [[7, 8]]);
  assert.equal(parseAtBatDeletions('7回の平川の第2打席を消してください', PS)[0].ordinal, 2);
  // 「2打席目」も「第2打席」と同じ意味。結果修正側と表記が揃っていないと、
  // 同じ書き方が片方でだけ通らず、打者一巡の回でどの打席か指せなくなる
  assert.equal(parseAtBatDeletions('7回の平川の2打席目は取り消してください', PS)[0].ordinal, 2);
  assert.equal(parseAtBatDeletions('7回の平川の二打席目を削除', PS)[0].ordinal, 2);
  assert.equal(parseAtBatDeletions('7回の平川の打席は空欄に', PS)[0].ordinal, null);
  // 取り消しの語が無い文は対象外(通常の訂正と取り違えない)
  assert.deepEqual(parseAtBatDeletions('7回の8番は奥田です', PS), []);
  assert.deepEqual(parseAtBatDeletions('7回の平川は四球です', PS), []);
  // 誰の打席か分からないものは扱わない
  assert.deepEqual(parseAtBatDeletions('7回は空欄にしてください', PS), []);
});

test('newGame: リエントリー可否は試合ごとに持ち、既定は「なし」', () => {
  assert.equal(newGame({}).allowReentry, false);
  assert.equal(newGame({ allowReentry: true }).allowReentry, true);
});

test('parseSlotBatters: 打順を指定した打者の訂正(「7回の8番は奥田です」)', () => {
  const PS = [{ id: 'o', name: '奥田' }, { id: 'h', name: '平川' }, { id: 'm', name: '松田' }];
  assert.deepEqual(
    parseSlotBatters('7回の8番は奥田です', PS).map((r) => [r.inning, r.order, r.playerId]),
    [[7, 8, 'o']],
  );
  // 打順より後ろの名前を採る(「8番は平川でなく奥田」でも奥田)
  assert.deepEqual(
    parseSlotBatters('7回、8番は平川ではなく奥田', PS).map((r) => r.playerId),
    ['o'],
  );
  // 交代文・守備位置の申告は他のパーサーの担当なので拾わない
  assert.deepEqual(parseSlotBatters('2回に6番の平川が奥田と交代', PS), []);
  assert.deepEqual(parseSlotBatters('2-5回の一塁は松田です', PS), []);
  // 打順が無い文、選手名が無い文は対象外
  assert.deepEqual(parseSlotBatters('7回は奥田です', PS), []);
  assert.deepEqual(parseSlotBatters('7回の8番は不明', PS), []);
  // 打順は1〜9のみ
  assert.deepEqual(parseSlotBatters('7回の12番は奥田です', PS), []);
});

test('parseInningRange: 「3-6回」「3回から6回」などの回の範囲を読む', () => {
  assert.deepEqual(parseInningRange('3-6回は山城だけですキャッチャー'), { from: 3, to: 6 });
  assert.deepEqual(parseInningRange('3〜6回はキャッチャー山城'), { from: 3, to: 6 });
  assert.deepEqual(parseInningRange('3回から6回まで山城がキャッチャー'), { from: 3, to: 6 });
  assert.deepEqual(parseInningRange('7回の守備はショート茂木'), { from: 7, to: 7 });
  assert.equal(parseInningRange('キャッチャーは山城です'), null);
});
test('parseDefensiveAlignment: 回の範囲つきの申告(3-6回)を toInning つきで拾う', () => {
  const PS = [{ id: 'y', name: '山城' }, { id: 'k', name: '河合' }];
  const rs = parseDefensiveAlignment('3-6回は山城だけですキャッチャー', PS);
  assert.equal(rs.length, 1);
  assert.deepEqual([rs[0].inning, rs[0].toInning, rs[0].playerId, rs[0].position], [3, 6, 'y', '捕']);
});
test('parseResultCorrections: 打席結果の語が無い文を結果修正にしない', () => {
  const PS = [{ id: 'y', name: '山城' }, { id: 'k', name: '河合' }];
  // 「〜です」で終わる守備位置の申告を「捕手 ヒット」と誤解釈していた
  assert.deepEqual(parseResultCorrections('3-6回は山城だけですキャッチャー', PS), []);
  assert.deepEqual(parseResultCorrections('2回から山城はキャッチャーです', PS), []);
});
test('isExplicitSubText: 交代語と2人の名前が同じ文にあるかを判定', () => {
  const txt = '2回は6番バッターがアウトの後に、キャッチャーは河合から山城に交代しました。3-6回は山城だけですキャッチャー。';
  assert.equal(isExplicitSubText(txt, ['河合', '山城']), true);
  // 交代語の無い守備位置の申告は「はっきり書かれた交代」ではない
  assert.equal(isExplicitSubText('2回から山城はキャッチャーです', ['松田', '山城']), false);
});

test('findPositionIssues: 同じ守備位置に2人・守る人が居ない位置を、発生している回の範囲つきで検出', () => {
  // 先発は正常。3回に捕手が交代したのに位置が一塁のままで、以降ずっと一塁2人・捕手不在。
  const POS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
  const starters = POS.map((p, i) => ({ order: i + 1, playerId: `s${i + 1}`, position: p }));
  const game = {
    startingLineup: starters,
    lineup: starters.map((s) => (s.order === 2 ? { ...s, playerId: 'sub1', position: '一' } : { ...s })),
    playLogs: [
      { kind: 'atbat', inning: 1, payload: { order: 1, playerId: 's1', result: 'out' } },
      { kind: 'sub', inning: 3, payload: { order: 2, in: 'sub1', out: 's2', kind: 'def', position: '一' } },
      { kind: 'atbat', inning: 5, payload: { order: 1, playerId: 's1', result: 'out' } },
    ],
  };
  const r = findPositionIssues(game);
  assert.deepEqual(r.duplicates, [{ position: '一', playerIds: ['sub1', 's3'], from: 3, to: 5 }]);
  assert.deepEqual(r.missing, [{ position: '捕', from: 3, to: 5 }]);
});

test('findPositionIssues: 正常な守備なら何も報告しない / 9人揃わない試合では不在を出さない', () => {
  const POS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
  const starters = POS.map((p, i) => ({ order: i + 1, playerId: `s${i + 1}`, position: p }));
  const ok = { startingLineup: starters, lineup: starters.map((s) => ({ ...s })), playLogs: [{ kind: 'atbat', inning: 1, payload: { order: 1 } }] };
  assert.deepEqual(findPositionIssues(ok), { duplicates: [], missing: [], sameSlots: [] });

  const few = { startingLineup: [], lineup: [{ order: 1, playerId: 'a', position: '投' }, { order: 2, playerId: 'b', position: '捕' }], playLogs: [] };
  const r = findPositionIssues(few);
  assert.deepEqual(r.duplicates, []);
  assert.deepEqual(r.missing, []);
});

test('findPositionIssues: 全員打ち(「打」)や控えは守備位置の重複として報告しない', () => {
  const POS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
  const starters = POS.map((p, i) => ({ order: i + 1, playerId: `s${i + 1}`, position: p }));
  const all = [...starters, { order: 10, playerId: 's10', position: '打' }, { order: 11, playerId: 's11', position: '打' }];
  const g = { startingLineup: all, lineup: all.map((s) => ({ ...s })), playLogs: [{ kind: 'atbat', inning: 1, payload: { order: 1 } }] };
  assert.deepEqual(findPositionIssues(g).duplicates, []);
});
test('findPositionIssues: 同じ選手が2つの打順に居る状態を専用に検出する', () => {
  const POS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
  const starters = POS.map((p, i) => ({ order: i + 1, playerId: `s${i + 1}`, position: p }));
  const g = {
    startingLineup: starters,
    lineup: starters.map((s) => (s.order === 5 ? { ...s, playerId: 'x' } : { ...s })),
    playLogs: [
      { kind: 'atbat', inning: 1, payload: { order: 1 } },
      { kind: 'sub', inning: 2, payload: { order: 2, in: 'x', out: 's2', position: '捕' } },
      { kind: 'sub', inning: 4, payload: { order: 5, in: 'x', out: 's5', position: '三' } },
      { kind: 'atbat', inning: 6, payload: { order: 1 } },
    ],
  };
  const r = findPositionIssues(g);
  assert.equal(r.sameSlots.length, 1);
  assert.equal(r.sameSlots[0].playerId, 'x');
  assert.deepEqual(r.sameSlots[0].orders, [2, 5]);
  // 同じ人が2枠に居るだけの状態を「2人が同じ位置」として報告しない
  assert.equal(r.duplicates.every((d) => new Set(d.playerIds).size >= 2), true);
});

test('parsePositionCorrections: 「先発守備位置は正しくはライト」= 回の指定なしで位置訂正', () => {
  const PS = [{ id: 's', name: '清水' }, { id: 'm', name: '松田' }];
  const rs = parsePositionCorrections('清水の先発守備位置がファーストになっていますが、正しくはライトでした', PS);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].playerId, 's');
  assert.equal(rs[0].position, '右'); // 「正しくは」以降の位置を採用(ファーストに引きずられない)
});
test('parsePositionCorrections: 回を含む文・2人出てくる文は交代扱いにして拾わない', () => {
  const PS = [{ id: 'y', name: '山城' }, { id: 'm', name: '松田' }];
  assert.equal(parsePositionCorrections('6回から守備のキャッチャーは山城から松田に替わりました', PS).length, 0);
  assert.equal(parsePositionCorrections('守備は山城から松田に交代', PS).length, 0);
});
test('parseResultCorrections: 「ゴロでなく犠飛で1点」を結果修正として解釈', () => {
  const rc = parseResultCorrections('なお、7回はセンターゴロではなく、センター犠牲フライで1点でした。');
  assert.equal(rc.length, 1);
  assert.equal(rc[0].inning, 7);
  assert.equal(rc[0].patch.result, 'sacFly');
  assert.equal(rc[0].patch.direction, 'CF');
  assert.equal(rc[0].patch.rbi, 1);
});
test('parseResultCorrections: 打者名つき・回の省略・短縮表記の方向を解釈', () => {
  const PS = [{ id: 'n', name: '中島' }, { id: 'u', name: '宇田川' }];
  const rs = parseResultCorrections('7回表の中島は中犠飛です。宇田川は四球です。', PS);
  assert.equal(rs.length, 2);
  // 1文目: 打者=中島、短縮表記「中犠飛」から方向CFも取る
  assert.deepEqual([rs[0].inning, rs[0].batterId, rs[0].patch.result, rs[0].patch.direction], [7, 'n', 'sacFly', 'CF']);
  // 2文目: 回が無くても直前の7回を引き継ぎ、打者=宇田川
  assert.deepEqual([rs[1].inning, rs[1].batterId, rs[1].patch.result], [7, 'u', 'bb']);
});

test('parseSubstitution: 「7回は髙島が投げました」= 投手1人でも登板として解釈(退く側は後で解決)', () => {
  const PS = [{ id: 't', name: '髙島' }, { id: 'u', name: '宇田川' }];
  const r = parseSubstitution('また7回は髙島が投げました', PS);
  assert.equal(r.ok, true);
  assert.equal(r.inning, 7);
  assert.equal(r.position, '投');
  assert.equal(r.inId, 't');
  assert.equal(r.outId, null); // 退く側は未指定(呼び出し側が直前投手に解決)
});
test('parseSubstitution: 守備位置が明示なら「代打」の否定文に釣られず守備交代', () => {
  const r = parseSubstitution('2回裏の6番打者を三振に取った後、キャッチャー河合が負傷で山城に交代。代打山城はそうでなく守備から', CORR_PLAYERS);
  assert.equal(r.ok, true);
  assert.equal(r.inning, 2);
  assert.equal(r.outId, 'kawai');
  assert.equal(r.inId, 'yamashiro');
  assert.equal(r.position, '捕');
  assert.equal(r.subKind, 'def'); // キャッチャー明示→守備交代(文中の「代打」に釣られない)
});
test('findTargetAtBat: その回の対象打者の打席を1件特定', () => {
  const game = { playLogs: [
    { id: 'a', kind: 'atbat', inning: 3, payload: { playerId: 'irimajiri', result: 'single' } },
    { id: 'b', kind: 'atbat', inning: 3, payload: { playerId: 'kawai', result: 'out' } },
    { id: 'c', kind: 'defense', inning: 3, payload: {} },
  ] };
  const parsed = parseBatterCorrection('3回の入交の打席は髙島', CORR_PLAYERS);
  const found = findTargetAtBat(game, parsed);
  assert.equal(found.ok, true);
  assert.equal(found.log.id, 'a');
});
test('findTargetAtBat: 回が文字列("3")でも数値の打席にマッチ(AI返り値対策)', () => {
  const game = { playLogs: [
    { id: 'a', kind: 'atbat', inning: 3, payload: { playerId: 'irimajiri', order: 5, result: 'single' } },
  ] };
  // inning は文字列、targetPlayerId 不一致でも targetOrder で救済
  const f1 = findTargetAtBat(game, { inning: '3', targetPlayerId: 'irimajiri' });
  assert.equal(f1.ok, true);
  const f2 = findTargetAtBat(game, { inning: '3', targetPlayerId: 'nobody', targetOrder: 5 });
  assert.equal(f2.ok, true);
});

// ---- 出場選手ボックススコアの伝統的な位置表記 ----
test('posChar: DHは指、擬似位置(打/控)は空', () => {
  assert.equal(posChar('二'), '二');
  assert.equal(posChar('DH'), '指');
  assert.equal(posChar('打'), '');
  assert.equal(posChar('控'), '');
});
test('buildLineupRows: 先発は括弧、代打→守備は「打中」、守備位置変更は「中左」', () => {
  const game = {
    startingLineup: [
      { order: 1, playerId: 'a', position: '中' },
      { order: 4, playerId: 'd', position: '一' },
    ],
    playLogs: [
      // 1番: 中堅→左翼へ移動
      { kind: 'position', payload: { order: 1, playerId: 'a', position: '左' } },
      // 4番: 代打eが出て、その後中堅を守る
      { kind: 'sub', payload: { order: 4, in: 'e', out: 'd', kind: 'ph', position: '中' } },
    ],
  };
  const rows = buildLineupRows(game);
  const slot1 = rows.find((r) => r.order === 1);
  const slot4 = rows.find((r) => r.order === 4);
  assert.equal(slot1.players[0].notation, '(中左)');
  assert.equal(slot4.players[0].notation, '(一)');
  assert.equal(slot4.players[1].notation, '打中');
  assert.equal(slot4.players[1].isStarter, false);
});
test('buildLineupRows: 先発スナップショット無し(過去試合)は交代のoutから先発を復元し重複しない', () => {
  const game = {
    // startingLineup 無し。現lineupは交代後(山城が4番)
    lineup: [{ order: 4, playerId: 'yamashiro', position: '捕' }],
    atBats: [
      { order: 4, playerId: 'kawai', result: 'single' },
      { order: 4, playerId: 'yamashiro', result: 'double' },
    ],
    playLogs: [
      { kind: 'sub', payload: { order: 4, in: 'yamashiro', out: 'kawai' } }, // kind/position無しの旧データ
    ],
  };
  const slot4 = buildLineupRows(game).find((r) => r.order === 4);
  assert.equal(slot4.players.length, 2); // 河合と山城の2行(重複しない)
  assert.equal(slot4.players[0].playerId, 'kawai');
  assert.equal(slot4.players[0].isStarter, true);
  assert.equal(slot4.players[0].notation, '(捕)'); // 先発は最終守備位置から推定し括弧つき正規表示
  assert.equal(slot4.players[1].playerId, 'yamashiro');
  assert.equal(slot4.players[1].notation, '捕'); // 交代選手は括弧なし
});
test('buildLineupRows/roleTag: 先発はバッジ無し・交代は回と役割つき、投手交代は救援', () => {
  const game = {
    startingLineup: [{ order: 6, playerId: 'takashima', position: '投' }],
    playLogs: [{ kind: 'sub', inning: 3, payload: { order: 6, in: 'udagawa', out: 'takashima', kind: 'def', position: '投' } }],
  };
  const slot6 = buildLineupRows(game).find((r) => r.order === 6);
  assert.equal(roleTag(slot6.players[0]), null); // 先発はバッジ無し
  assert.equal(slot6.players[0].inning, null);
  assert.equal(slot6.players[1].inning, 3); // 交代で入った回
  assert.equal(roleTag(slot6.players[1]), 'relief'); // 投手への守備交代=救援
  assert.equal(slot6.players[1].posCode, '投');
});

// ---- battersRebuild.js ----
test('findDuplicateAtBats: 同じ回に別々の打順で打席がある選手だけを検出する', () => {
  const game = { atBats: [
    { id: 'a', playerId: 'u', order: 6, result: 'out', snapshot: { inning: 7 } },
    { id: 'b', playerId: 'u', order: 8, result: 'bb', snapshot: { inning: 7 } }, // 別打順=あり得ない
    { id: 'c', playerId: 'x', order: 1, result: 'single', snapshot: { inning: 7 } },
  ] };
  assert.deepEqual(findDuplicateAtBats(game), [{ playerId: 'u', inning: 7, count: 2 }]);
});

test('findDuplicateAtBats: 同じ打順での複数打席(打者一巡)は正常として扱う', () => {
  const game = { atBats: [
    { id: 'a', playerId: 'u', order: 3, result: 'single', snapshot: { inning: 3 } },
    { id: 'b', playerId: 'u', order: 3, result: 'double', snapshot: { inning: 3 } },
  ] };
  assert.deepEqual(findDuplicateAtBats(game), []);
});

test('rebuildBatters: 1人を2打順に置く矛盾した交代を取り除いて元の打者へ戻す', () => {
  // 6番=宇田川(先発投手)。誤った交代で宇田川が8番にも入れられ、8番の打席まで奪っていた。
  const game = {
    startingLineup: [{ order: 6, playerId: 'u', position: '投' }, { order: 8, playerId: 'hira', position: '三' }],
    atBats: [
      { id: 'a1', playerId: 'u', order: 6, result: 'out', snapshot: { inning: 7 } },
      { id: 'a2', playerId: 'u', order: 8, result: 'out', snapshot: { inning: 7 } },
    ],
    playLogs: [
      { id: 'bad', kind: 'sub', inning: 7, payload: { order: 8, in: 'u', out: 'hira', kind: 'def', position: '二' } },
      { id: 'p1', kind: 'atbat', inning: 7, payload: { order: 6, playerId: 'u', atBatId: 'a1', result: 'out' } },
      { id: 'p2', kind: 'atbat', inning: 7, payload: { order: 8, playerId: 'u', atBatId: 'a2', result: 'out' } },
    ],
  };
  const n = rebuildBatters(game, (id) => id);
  assert.equal(n.removedSubs, 1); // 矛盾した交代ログを削除
  assert.equal(game.playLogs.some((l) => l.id === 'bad'), false);
  assert.equal(game.atBats[0].playerId, 'u');    // 6番はそのまま
  assert.equal(game.atBats[1].playerId, 'hira'); // 8番は本来の平川へ戻る
  assert.deepEqual(findDuplicateAtBats(game), []); // 矛盾が解消している
});

test('rebuildBatters: 交代の記録どおりに各打席の打者を振り直す', () => {
  // 8番: 平川(先発) → 5回から茂木。7回の打席が誤って宇田川に付いている。
  const game = {
    startingLineup: [{ order: 8, playerId: 'hira', position: '三' }],
    lineup: [{ order: 8, playerId: 'mogi', position: '三' }],
    atBats: [
      { id: 'a1', playerId: 'hira', order: 8, result: 'single', snapshot: { inning: 2 } },
      { id: 'a2', playerId: 'udagawa', order: 8, result: 'out', snapshot: { inning: 7 } },
    ],
    playLogs: [
      { kind: 'atbat', inning: 2, payload: { order: 8, playerId: 'hira', atBatId: 'a1', result: 'single' } },
      { kind: 'sub', inning: 5, payload: { order: 8, in: 'mogi', out: 'hira', kind: 'def', position: '三' } },
      { kind: 'atbat', inning: 7, payload: { order: 8, playerId: 'udagawa', atBatId: 'a2', result: 'out' } },
    ],
  };
  const n = rebuildBatters(game, (id) => id);
  assert.equal(n.atBats, 1); // 7回の1打席だけ直る
  assert.equal(game.atBats[0].playerId, 'hira'); // 交代前はそのまま
  assert.equal(game.atBats[1].playerId, 'mogi'); // 交代後は茂木へ
  assert.equal(game.playLogs[2].payload.playerId, 'mogi');
  assert.ok(game.updatedAt); // 同期に載るよう更新時刻を進める
});

test('findOrderBreaks/rebuildBatters: 打順の並びのズレを検出して振り直す', () => {
  // 1巡目は正しく、2巡目で「6番が3連続・4番が抜ける」ズレが入った状態を再現
  const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9, /* 2巡目 */ 1, 2, 3, 5, 6, 6, 6, 7, 8];
  const fixed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const game = {
    startingLineup: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((o) => ({ order: o, playerId: `s${o}` })),
    atBats: seq.map((o, i) => ({ id: `a${i}`, playerId: `s${o}`, order: o, result: 'out', snapshot: { inning: 1 + Math.floor(i / 3) } })),
    playLogs: seq.map((o, i) => ({ kind: 'atbat', inning: 1 + Math.floor(i / 3), payload: { order: o, playerId: `s${o}`, atBatId: `a${i}`, result: 'out' } })),
  };
  assert.ok(findOrderBreaks(game) > 0);
  assert.equal(canRebuildOrders(game), true); // ほぼ巡回しているので振り直して良い
  rebuildBatters(game, (id) => id);
  assert.equal(findOrderBreaks(game), 0);
  assert.deepEqual(game.atBats.map((a) => a.order), fixed);
  assert.deepEqual(game.playLogs.map((l) => l.payload.order), fixed);
});

test('canRebuildOrders: 打席を全部は記録していない試合では振り直さない(壊さない)', () => {
  // 要点だけ記録した試合(打順が飛び飛び)は巡回の前提が成り立たないので対象外
  const seq = [1, 5, 9, 3, 7, 2, 8, 4, 6, 1, 5];
  const game = {
    startingLineup: [], atBats: [],
    playLogs: seq.map((o, i) => ({ kind: 'atbat', inning: 1 + i, payload: { order: o, playerId: 'p', result: 'out' } })),
  };
  assert.ok(findOrderBreaks(game) > 0);
  assert.equal(canRebuildOrders(game), false);
});

test('findOrderBreaks: 正しい並び(9番の次は1番)はズレとみなさない', () => {
  const mk = (order, inning) => ({ kind: 'atbat', inning, payload: { order, playerId: 'p', result: 'out' } });
  const game = { startingLineup: [], atBats: [], playLogs: [mk(8, 3), mk(9, 3), mk(1, 3), mk(2, 4)] };
  assert.equal(findOrderBreaks(game), 0);
});

test('rebuildBatters: 既に正しければ何も変えない', () => {
  const game = {
    startingLineup: [{ order: 1, playerId: 'a', position: '中' }],
    atBats: [{ id: 'x', playerId: 'a', order: 1, result: 'single', snapshot: { inning: 1 } }],
    playLogs: [{ kind: 'atbat', inning: 1, payload: { order: 1, playerId: 'a', atBatId: 'x', result: 'single' } }],
  };
  assert.equal(rebuildBatters(game, (id) => id).total, 0);
  assert.equal(game.updatedAt, undefined);
});

// ---- boxscore.js ----
test('computeBoxScore: 実際に行われた回までを返す(7回で終了なら8・9回の空欄を出さない)', () => {
  const linescore = {};
  for (let i = 1; i <= 7; i++) linescore[String(i)] = { my: 1, opp: 0 };
  const game = { inning: 7, linescore, atBats: [], playLogs: [], myScore: 7, oppScore: 0 };
  const box = computeBoxScore(game);
  assert.equal(box.innings.length, 7);
  assert.equal(box.innings[6].inning, 7);
});

test('computeBoxScore: 延長は行われた回まで伸ばす', () => {
  const linescore = {};
  for (let i = 1; i <= 11; i++) linescore[String(i)] = { my: 0, opp: 0 };
  const game = { inning: 11, linescore, atBats: [], playLogs: [], myScore: 0, oppScore: 0 };
  assert.equal(computeBoxScore(game).innings.length, 11);
});

test('computeBoxScore: 安打と失策は同じプレイに同時に付く', () => {
  // 実際に起きた場面: 右翼へのツーベース。右翼手の送球が逸れて打者走者が三塁へ。
  // 記録規則では二塁打1と送球失策1が同時に付く。result は1つしか持てないので
  // 「安打か失策か」の二択になっていて、片方しか残せなかった。
  const game = {
    inning: 1, linescore: {}, myScore: 1, oppScore: 0,
    atBats: [
      { result: 'double', playError: { pos: '右', kind: 'throw' } },
      { result: 'single' },
    ],
    playLogs: [],
  };
  const box = computeBoxScore(game);
  assert.equal(box.my.h, 2, '二塁打は安打のまま数える');
  assert.equal(box.opp.e, 1, '相手の失策として1つ数える');
});

test('computeBoxScore: 出塁そのものが失策の回を二重に数えない', () => {
  const game = {
    inning: 1, linescore: {}, myScore: 0, oppScore: 0,
    // 出塁が失策(result='error')。playError は付けない
    atBats: [{ result: 'error' }],
    playLogs: [],
  };
  assert.equal(computeBoxScore(game).opp.e, 1, '失策は1つ');
  assert.equal(computeBoxScore(game).my.h, 0, '失策出塁は安打にしない');
});

test('computeBoxScore: 守備側の失策は自チームのEに入る', () => {
  const game = {
    inning: 1, linescore: {}, myScore: 0, oppScore: 2,
    atBats: [],
    playLogs: [
      // 相手の二塁打に、自軍の中堅手の送球失策が重なった
      { kind: 'defense', payload: { result: 'double', playError: { pos: '中', kind: 'throw' } } },
      { kind: 'defense', payload: { result: 'out' } },
    ],
  };
  const box = computeBoxScore(game);
  assert.equal(box.my.e, 1, '自チームの失策');
  assert.equal(box.opp.h, 1, '相手の安打はそのまま');
  assert.equal(box.opp.e, 0, '相手の失策にはしない');
});

// ---- lineupOrder.js ----
// 実際に起きたこと: 7番と8番を逆に組んだまま3回まで記録してしまった。
// 打席は画面に出ていた名前で残っているので、並びを直すだけでは記録が合わない。
const swapGame = () => ({
  lineup: [
    { order: 7, playerId: 'yamashita', position: '左' },
    { order: 8, playerId: 'kawahara', position: '遊' },
  ],
  startingLineup: [
    { order: 7, playerId: 'yamashita', position: '左' },
    { order: 8, playerId: 'kawahara', position: '遊' },
  ],
  atBats: [],
  playLogs: [
    { id: 'l1', kind: 'atbat', payload: { order: 7, playerId: 'yamashita' } },
    { id: 'l2', kind: 'atbat', payload: { order: 8, playerId: 'kawahara' } },
    { id: 'l3', kind: 'atbat', payload: { order: 7, playerId: 'yamashita' } },
  ],
});

test('swapOrderPlan: 打順と守備位置が選手について回る', () => {
  const p = swapOrderPlan(swapGame(), 7, 8);
  const s7 = p.lineup.find((l) => l.order === 7);
  const s8 = p.lineup.find((l) => l.order === 8);
  assert.equal(s7.playerId, 'kawahara', '7番が川原になる');
  assert.equal(s8.playerId, 'yamashita', '8番が山下になる');
  // 打順だけが入れ替わり、守る場所は変わらない
  assert.equal(s7.position, '遊', '川原は遊撃のまま');
  assert.equal(s8.position, '左', '山下は左翼のまま');
  assert.equal(p.startingLineup.find((l) => l.order === 7).playerId, 'kawahara',
    'スタメンの記録も直す(伝統表記がここから作られるため)');
});

test('swapOrderPlan: 記録済みの打席も本来の選手へ付け替える', () => {
  const p = swapOrderPlan(swapGame(), 7, 8);
  assert.equal(p.reassign.length, 3, '3打席とも動く');
  assert.deepEqual(p.reassign.find((r) => r.logId === 'l1'), { logId: 'l1', newPlayerId: 'kawahara' });
  assert.deepEqual(p.reassign.find((r) => r.logId === 'l2'), { logId: 'l2', newPlayerId: 'yamashita' });
  assert.deepEqual(p.reassign.find((r) => r.logId === 'l3'), { logId: 'l3', newPlayerId: 'kawahara' });
});

test('swapOrderPlan: 途中で入った代打の打席は動かさない', () => {
  // 枠だけを見て一律に付け替えると、代打の打席まで持っていってしまう
  const g = swapGame();
  g.playLogs.push({ id: 'l4', kind: 'atbat', payload: { order: 7, playerId: 'daida' } });
  const p = swapOrderPlan(g, 7, 8);
  assert.ok(!p.reassign.some((r) => r.logId === 'l4'), '代打の打席は残す');
  assert.equal(p.reassign.length, 3);
});

test('canSwapOrder: 隣どうしだけ。離れた枠へは動かさない', () => {
  const g = { lineup: [1, 2, 3, 4].map((n) => ({ order: n, playerId: `p${n}`, position: '' })) };
  assert.equal(canSwapOrder(g, 2, 3), true);
  assert.equal(canSwapOrder(g, 3, 2), true, '向きは問わない');
  assert.equal(canSwapOrder(g, 1, 3), false, '離れた枠は間が全部ずれるので断る');
  assert.equal(canSwapOrder(g, 2, 2), false);
  assert.equal(canSwapOrder(g, 4, 5), false, '無い枠とは入れ替えない');
  assert.equal(swapOrderPlan(g, 1, 3), null, '断ったときは計画も返さない');
});

test('weSeries: 規定回の表が続いている間は勝ち確にしない', () => {
  // 報告のあった場面: 9回表・1死・後攻が1点リード。勝率が100%と出ていた。
  // まだ2つアウトを取らないと試合は終わらない。
  // 原因は「次の打席が記録されていない=半回が終わった」と決めつけていたこと。
  const model = buildWinModel({
    dists: null, isHome: true, regulation: 9, halfStartKey: () => '000|0',
  });
  const mk = (outsBefore, outsOnPlay) => ({
    id: 'p1', gameId: 'g', inning: 9, isTop: true, kind: 'defense', text: '',
    payload: { beforeRunners: { 1: false, 2: false, 3: false }, outsBefore, outsOnPlay, runs: 0 },
  });
  // 自チーム(後攻)が1点リードしている状態を作る
  const lead = {
    id: 'p0', gameId: 'g', inning: 1, isTop: false, kind: 'atbat', text: '',
    payload: { beforeRunners: { 1: false, 2: false, 3: false }, outsBefore: 0, outsOnPlay: 0, runs: 1 },
  };

  // 「いま9回表の1死」であることは、試合の現在地(inning/isTop/outs)で表す
  const going = { id: 'g', inning: 9, isTop: true, outs: 1, runners: {}, playLogs: [lead, mk(0, 1)] };
  const wGoing = weSeries(going, model);
  const last = wGoing[wGoing.length - 1];
  assert.ok(last.we < 1, `1死ではまだ勝ち確にしない: ${last.we}`);
  assert.ok(last.we > 0.5, `1点リードなので優勢ではある: ${last.we}`);

  // 3つ目のアウトを取れば、規定回の表が終わって試合も終わる
  // 3アウトで半回が終わり、次の半回へ進んでいる
  const done = { id: 'g', inning: 9, isTop: false, outs: 0, runners: {}, playLogs: [lead, mk(2, 1)] };
  const wDone = weSeries(done, model);
  assert.equal(wDone[wDone.length - 1].we, 1, '2死からのアウトで試合終了');
});

test('weSeries: サヨナラは3アウトを待たずに終わる', () => {
  const model = buildWinModel({
    dists: null, isHome: true, regulation: 9, halfStartKey: () => '000|0',
  });
  // 9回裏、無死で1点入って後攻がリード = サヨナラ
  const walkOff = {
    id: 'g', inning: 9, isTop: false, outs: 0, status: 'finished', runners: {},
    playLogs: [{
      id: 'p1', gameId: 'g', inning: 9, isTop: false, kind: 'atbat', text: '',
      payload: { beforeRunners: { 1: false, 2: false, 3: true }, outsBefore: 0, outsOnPlay: 0, runs: 1 },
    }],
  };
  const w = weSeries(walkOff, model);
  assert.equal(w[w.length - 1].we, 1, 'アウトを待たずに勝ち');
});

test('logTextOf: 相手打者は、あとから入れた名前で読み替える', () => {
  // 名前は試合中に後から入る。記録した時点では記号しか無いので、文には
  // 「相手打者A(1番)」と焼き付いている。オーダーに名前が出ているのに
  // 試合経過だけ記号、という食い違いになっていた。
  const log = {
    kind: 'defense',
    text: '相手打者A(1番): 二塁凡打(アウト)',
    payload: { letter: 'A', order: 1 },
  };
  assert.equal(logTextOf({ oppNames: { A: '石田' } }, log), '石田(1番): 二塁凡打(アウト)');
  // 名前が入っていなければ記号のまま
  assert.equal(logTextOf({}, log), '相手打者A(1番): 二塁凡打(アウト)');
  assert.equal(logTextOf({ oppNames: { B: '田中' } }, log), '相手打者A(1番): 二塁凡打(アウト)',
    '別の記号の名前では読み替えない');
});

test('logTextOf: 自チームの打席や交代の行はそのまま', () => {
  const mine = { kind: 'atbat', text: '佐藤 右翼ヒット', payload: {} };
  assert.equal(logTextOf({ oppNames: { A: '石田' } }, mine), '佐藤 右翼ヒット');
  const sub = { kind: 'sub', text: '代打 鈴木', payload: {} };
  assert.equal(logTextOf({ oppNames: { A: '石田' } }, sub), '代打 鈴木');
  assert.equal(logTextOf({}, null), '', '行が無くても落ちない');
});

test('logTextOf: 文の途中に同じ形があっても、先頭だけを読み替える', () => {
  const log = {
    kind: 'defense',
    text: '相手打者A(1番): 二塁凡打(アウト) 相手打者A(1番)がアウト',
    payload: { letter: 'A' },
  };
  assert.equal(logTextOf({ oppNames: { A: '石田' } }, log),
    '石田(1番): 二塁凡打(アウト) 相手打者A(1番)がアウト');
});

test('finePlayOf: 失策と同じ形で読み出せる', () => {
  assert.equal(finePlayOf({}), null);
  assert.equal(finePlayOf({ finePlay: {} }), null, '位置が無ければ数えない');
  assert.equal(finePlayOf({ finePlay: { pos: 'DH' } }), null, '守備位置でなければ数えない');
  assert.deepEqual(finePlayOf({ finePlay: { pos: '遊' } }), { pos: '遊', playerId: null });
  assert.deepEqual(finePlayOf({ finePlay: { pos: '遊', playerId: 'p1' } }), { pos: '遊', playerId: 'p1' });
});

test('aggregateFielding: 自チームが守っていたときだけ、選手ごとに数える', () => {
  const games = [{
    id: 'g1',
    playLogs: [
      // 自チームの守備。誰の記録かは記録時点の playerId で決める
      { kind: 'defense', payload: { finePlay: { pos: '遊', playerId: 'p1' } } },
      { kind: 'defense', payload: { finePlay: { pos: '中', playerId: 'p2' } } },
      { kind: 'defense', payload: { playError: { pos: '遊', kind: 'throw', playerId: 'p1' } } },
      // 自チームの攻撃で相手の野手が見せた好守。相手の名前は持っていないので個人には付かない
      { kind: 'atbat', payload: { finePlay: { pos: '遊' } } },
      { kind: 'defense', payload: {} },
    ],
  }];
  const rows = aggregateFielding(games);
  const p1 = rows.find((r) => r.playerId === 'p1');
  const p2 = rows.find((r) => r.playerId === 'p2');
  assert.equal(p1.fine, 1);
  assert.equal(p1.errors, 1, '同じ選手の好守と失策は別に数える');
  assert.equal(p2.fine, 1);
  assert.equal(p2.errors, 0);
  assert.equal(rows.length, 2, '相手の野手は個人の記録にしない');
  assert.equal(p1.games, 1);
});

test('aggregateFielding: 同じ試合で複数回押しても試合数は1', () => {
  const games = [{
    id: 'g1',
    playLogs: [
      { kind: 'defense', payload: { finePlay: { pos: '遊', playerId: 'p1' } } },
      { kind: 'defense', payload: { finePlay: { pos: '遊', playerId: 'p1' } } },
    ],
  }];
  const [row] = aggregateFielding(games);
  assert.equal(row.fine, 2);
  assert.equal(row.games, 1);
});

test('rankFielding: 好守の多い順、同数なら失策の少ない順', () => {
  const rows = [
    { playerId: 'a', fine: 2, errors: 3 },
    { playerId: 'b', fine: 5, errors: 1 },
    { playerId: 'c', fine: 2, errors: 0 },
  ];
  assert.deepEqual(rankFielding(rows).map((r) => r.playerId), ['b', 'c', 'a']);
});

test('playErrorOf: 位置が無いもの・知らない位置は失策として数えない', () => {
  assert.equal(playErrorOf({}), null, '何も無ければ null');
  assert.equal(playErrorOf({ playError: { kind: 'throw' } }), null, '位置が無ければ数えない');
  assert.equal(playErrorOf({ playError: { pos: 'DH', kind: 'throw' } }), null, '守備位置でなければ数えない');
  assert.deepEqual(playErrorOf({ playError: { pos: '右', kind: 'throw' } }),
    { pos: '右', kind: 'throw', playerId: null });
  // 種類が抜けていても失策そのものは残す(捕球として扱う)
  assert.deepEqual(playErrorOf({ playError: { pos: '遊' } }), { pos: '遊', kind: 'field', playerId: null });
  // 自チームが守っていたときは誰の記録かまで残す
  assert.deepEqual(playErrorOf({ playError: { pos: '遊', kind: 'throw', playerId: 'p1' } }),
    { pos: '遊', kind: 'throw', playerId: 'p1' });
});

test('computeBoxScore: 開始直後でも最低1回分は返す', () => {
  const game = { inning: 1, linescore: {}, atBats: [], playLogs: [], myScore: 0, oppScore: 0 };
  const box = computeBoxScore(game);
  assert.equal(box.innings.length, 1);
  assert.equal(box.innings[0].played, false);
});

// ---- mergePlayers.js ----
test('remapPlayerInGame: 全ての参照を付け替え、updatedAtを進める(クラウド同期で元に戻らない)', () => {
  const game = {
    updatedAt: 1000, currentPitcherId: 'dup',
    lineup: [{ order: 9, playerId: 'dup', position: '左' }],
    startingLineup: [{ order: 9, playerId: 'dup', position: '三' }],
    atBats: [{ playerId: 'dup', order: 9 }],
    pitchingRecords: [{ playerId: 'dup', outsRecorded: 3 }],
    importedBatting: [{ playerId: 'dup', h: 1 }],
    importedPitching: [{ playerId: 'dup', outsRecorded: 3 }],
    retiredPlayerIds: ['dup'], usedPlayerIds: ['dup', 'keep'],
    runners: { 1: { playerId: 'dup' }, 2: null, 3: null },
    playLogs: [
      { kind: 'atbat', payload: { playerId: 'dup' } },
      { kind: 'sub', payload: { in: 'dup', out: 'other' } },
      { kind: 'defense', payload: { pitcherId: 'dup' } },
    ],
  };
  const touched = remapPlayerInGame(game, 'dup', 'keep', 2000);
  assert.equal(touched, true);
  assert.equal(game.updatedAt, 2000); // これが無いと同期のLWWで古い版に上書きされる
  assert.equal(game.lineup[0].playerId, 'keep');
  assert.equal(game.startingLineup[0].playerId, 'keep');
  assert.equal(game.atBats[0].playerId, 'keep');
  assert.equal(game.pitchingRecords[0].playerId, 'keep');
  assert.equal(game.importedBatting[0].playerId, 'keep');
  assert.equal(game.importedPitching[0].playerId, 'keep');
  assert.equal(game.currentPitcherId, 'keep');
  assert.equal(game.runners[1].playerId, 'keep');
  assert.deepEqual(game.retiredPlayerIds, ['keep']);
  assert.deepEqual(game.usedPlayerIds, ['keep']); // 重複は1つにまとまる
  assert.equal(game.playLogs[0].payload.playerId, 'keep');
  assert.equal(game.playLogs[1].payload.in, 'keep');
  assert.equal(game.playLogs[1].payload.out, 'other');
  assert.equal(game.playLogs[2].payload.pitcherId, 'keep');
});

test('remapPlayerInGame: 対象が居ない試合は updatedAt を変えない(無用な再送を防ぐ)', () => {
  const game = { updatedAt: 1000, lineup: [{ order: 1, playerId: 'x' }], playLogs: [] };
  assert.equal(remapPlayerInGame(game, 'dup', 'keep', 2000), false);
  assert.equal(game.updatedAt, 1000);
});

test('fillPlayerGaps: 残す側の空欄を統合する側の値で補完する', () => {
  const merged = fillPlayerGaps({ id: 'a', name: '平川', number: '', bats: 'R' }, { id: 'b', name: '平川', number: '31', bats: 'L' });
  assert.equal(merged.number, '31'); // 空欄は補完
  assert.equal(merged.bats, 'R');    // 既に値があれば残す側を優先
  assert.equal(merged.id, 'a');
});

test('buildLineupRows: 位置ログが無い守備位置変更も現lineupから表記に反映(打左→打左一)', () => {
  // 7番: 清水(先発右翼) → 5回に中島が代打(左翼)。その後 中島は一塁へ(lineupだけが一)。
  const game = {
    startingLineup: [{ order: 7, playerId: 'shimizu', position: '右' }],
    lineup: [{ order: 7, playerId: 'nakajima', position: '一' }],
    playLogs: [{ kind: 'sub', inning: 5, payload: { order: 7, in: 'nakajima', out: 'shimizu', kind: 'ph', position: '左' } }],
    atBats: [],
  };
  const slot7 = buildLineupRows(game).find((r) => r.order === 7);
  assert.equal(slot7.players[0].notation, '(右)');
  assert.equal(slot7.players[1].notation, '打左一'); // 代打→左翼→一塁
  assert.equal(slot7.players[1].posCode, '一');      // 最後に就いた守備位置
});

test('buildLineupRows: 打順を移った選手は fromOrder/toOrder が付き、途中出場と区別できる', () => {
  // 8番 平川(先発三塁) が5回からレフトへ。9番の奥田と入れ替わり、8番には茂木が入る。
  const game = {
    startingLineup: [
      { order: 8, playerId: 'hirakawa', position: '三' },
      { order: 9, playerId: 'okuda', position: '左' },
    ],
    lineup: [{ order: 8, playerId: 'mogi', position: '三' }, { order: 9, playerId: 'hirakawa', position: '左' }],
    playLogs: [
      { kind: 'sub', inning: 5, payload: { order: 8, in: 'mogi', out: 'hirakawa', kind: 'def', position: '三' } },
      { kind: 'sub', inning: 5, payload: { order: 9, in: 'hirakawa', out: 'okuda', kind: 'def', position: '左' } },
    ],
    atBats: [],
  };
  const rows = buildLineupRows(game);
  const slot8 = rows.find((r) => r.order === 8);
  const slot9 = rows.find((r) => r.order === 9);
  const hira8 = slot8.players.find((p) => p.playerId === 'hirakawa');
  const hira9 = slot9.players.find((p) => p.playerId === 'hirakawa');
  assert.equal(hira8.toOrder, 9);   // 8番の平川は「9番へ」移る
  assert.equal(hira9.fromOrder, 8); // 9番の平川は「8番より」= 途中出場ではない
  assert.equal(hira9.posCode, '左');
  // 本当に途中から出た選手には移動の印を付けない
  const mogi = slot8.players.find((p) => p.playerId === 'mogi');
  assert.equal(mogi.fromOrder, null);
  assert.equal(mogi.toOrder, null);
});

test('buildLineupRows: 同じ打順への再登板(リエントリー)は打順移動として扱わない', () => {
  const game = {
    startingLineup: [{ order: 6, playerId: 'takashima', position: '投' }],
    playLogs: [
      { kind: 'sub', inning: 3, payload: { order: 6, in: 'udagawa', out: 'takashima', kind: 'def', position: '投' } },
      { kind: 'sub', inning: 7, payload: { order: 6, in: 'takashima', out: 'udagawa', kind: 'def', position: '投' } },
    ],
  };
  const slot6 = buildLineupRows(game).find((r) => r.order === 6);
  assert.ok(slot6.players.every((p) => p.fromOrder === null && p.toOrder === null));
});

test('resolveStarters: startingLineup が無い過去試合でも交代のoutから先発と守備位置を復元', () => {
  // 7番: 清水(先発) → 5回に中島が代打。startingLineup は保存されていない。
  const game = {
    lineup: [{ order: 7, playerId: 'nakajima', position: '左' }],
    playLogs: [{ kind: 'sub', inning: 5, payload: { order: 7, in: 'nakajima', out: 'shimizu', kind: 'ph' } }],
    atBats: [],
  };
  const st = resolveStarters(game).find((s) => s.order === 7);
  assert.equal(st.playerId, 'shimizu'); // 交代のout=先発として復元される
  // 出場ツリー上も清水が先発行に来る(=守備位置訂正の対象にできる)
  const slot7 = buildLineupRows(game).find((r) => r.order === 7);
  assert.equal(slot7.players[0].playerId, 'shimizu');
  assert.equal(slot7.players[0].isStarter, true);
});

test('assignAtBatsByPlayer: 再登場した選手の打席が二重表示にならず、最初の行にまとまる', () => {
  // 6番: 髙島(先発) → 宇田川(3回) → 茂木(5回) → 宇田川(5回再登板) → 髙島(7回再登板)
  const rows = [{ order: 6, players: [
    { playerId: 'takashima', inning: null },
    { playerId: 'udagawa', inning: 3 },
    { playerId: 'mogi', inning: 5 },
    { playerId: 'udagawa', inning: 5 },
    { playerId: 'takashima', inning: 7 },
  ] }];
  const abs = [
    { playerId: 'takashima', result: 'double', snapshot: { inning: 2 } },
    { playerId: 'udagawa', result: 'single', snapshot: { inning: 4 } },
    { playerId: 'udagawa', result: 'bb', snapshot: { inning: 6 } },
    { playerId: 'takashima', result: 'out', snapshot: { inning: 7 } },
  ];
  const m = assignAtBatsByPlayer(rows, abs);
  const p = rows[0].players;
  assert.equal(m.get(p[0]).atBats.length, 2); // 髙島の2打席は先発行にまとまる
  assert.equal(m.get(p[1]).atBats.length, 2); // 宇田川の2打席は3回の行にまとまる
  assert.equal(m.get(p[4]).atBats.length, 0); // 再登板の行には重複させない
  assert.equal(m.get(p[3]).atBats.length, 0);
  assert.equal(m.get(p[4]).primary, false);
  assert.equal(m.get(p[4]).primaryOrder, 6);
  // 全打席がちょうど1回ずつ割り当てられている(重複も欠落もない)
  assert.equal(p.reduce((s, x) => s + m.get(x).atBats.length, 0), abs.length);
});

test('assignAtBatsByPlayer: 打順を移った選手の打撃結果が1行にまとまる', () => {
  // 8番 平川(先発三塁) が5回から9番レフトへ。打席は8番・9番の両方の回に発生。
  const rows = [
    { order: 8, players: [{ playerId: 'hirakawa', inning: null }, { playerId: 'mogi', inning: 5 }] },
    { order: 9, players: [{ playerId: 'okuda', inning: null }, { playerId: 'hirakawa', inning: 5 }] },
  ];
  const abs = [
    { playerId: 'hirakawa', order: 8, result: 'single', snapshot: { inning: 2 } },
    { playerId: 'hirakawa', order: 8, result: 'single', snapshot: { inning: 3 } },
    { playerId: 'hirakawa', order: 9, result: 'out', snapshot: { inning: 5 } }, // 移った先での打席
  ];
  const m = assignAtBatsByPlayer(rows, abs);
  const at8 = rows[0].players[0];
  const at9 = rows[1].players[1];
  assert.equal(m.get(at8).atBats.length, 3); // 3打席すべて8番の行へ
  assert.equal(m.get(at8).primary, true);
  assert.equal(m.get(at9).atBats.length, 0); // 移動先の行は空(0打数ではなく空欄表示)
  assert.equal(m.get(at9).primary, false);
  assert.equal(m.get(at9).primaryOrder, 8); // 「8番に記載」と案内できる
});

test('assignAtBatsByPlayer: 盗塁も同じ行にまとまる', () => {
  const rows = [{ order: 1, players: [{ playerId: 'a', inning: null }, { playerId: 'a', inning: 6 }] }];
  const sbLogs = [
    { kind: 'sb', inning: 2, payload: { playerId: 'a' } },
    { kind: 'sb', inning: 7, payload: { playerId: 'a' } },
  ];
  const m = assignAtBatsByPlayer(rows, [], sbLogs);
  assert.equal(m.get(rows[0].players[0]).sb, 2);
  assert.equal(m.get(rows[0].players[1]).sb, 0);
});

// ---- pitchingRebuild.js ----
// 以下のテストは全て「先攻(isHome:false)」= 自軍は裏(isTop:false)に守備、表(isTop:true)に攻撃。
// 相手の打席アウトを n 個ぶん並べるヘルパー。
const defOuts = (inning, n) => Array.from({ length: n }, () => ({
  kind: 'defense', inning, isTop: false, payload: { result: 'out', outType: 'ground', outsOnPlay: 1 },
}));
const pitGame = (over) => ({
  id: 'g', isHome: false, status: 'finished', myScore: 5, oppScore: 1,
  startingLineup: [{ order: 9, playerId: 'takashima', position: '投' }],
  pitchingRecords: [], playLogs: [], ...over,
});

test('rebuildPitchingStats: 完了した守備イニングは3アウトとして照合し記録漏れを補う', () => {
  // 1〜3回を投げ切っているが、2回だけ記録が2アウトしかない(走塁アウトの取りこぼし)
  const game = pitGame({ playLogs: [...defOuts(1, 3), ...defOuts(2, 2), ...defOuts(3, 3)] });
  const { records, filledOuts } = rebuildPitchingStats(game);
  assert.equal(filledOuts, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].playerId, 'takashima');
  assert.equal(records[0].outsRecorded, 9); // 2.2回ではなく3.0回になる
});

test('rebuildPitchingStats: 走塁アウト(outs付きrunnerログ)も投球回に数える', () => {
  const game = pitGame({
    status: 'ongoing',
    playLogs: [
      ...defOuts(1, 2),
      { kind: 'runner', inning: 1, isTop: false, text: '盗塁死', payload: { outs: 1 } },
      ...defOuts(2, 1), // 進行中の最終回は照合しない
    ],
  });
  const { records, filledOuts } = rebuildPitchingStats(game);
  assert.equal(filledOuts, 0); // 1回は走塁アウト込みで3アウト揃っている
  assert.equal(records[0].outsRecorded, 4); // 1.1回
});

test('rebuildPitchingStats: 記録漏れは回を締めた投手に付き、自軍攻撃の走塁アウトは数えない', () => {
  const game = pitGame({
    playLogs: [
      ...defOuts(1, 3),
      { kind: 'runner', inning: 1, isTop: true, text: '盗塁死', payload: { outs: 1 } }, // 自軍攻撃(表)→ 除外
      { kind: 'sub', inning: 2, isTop: false, payload: { order: 9, in: 'udagawa', out: 'takashima', kind: 'def', position: '投' } },
      ...defOuts(2, 2), // 2回は2アウトしか記録が無い → 締めた宇田川に1つ補う
    ],
  });
  const { records } = rebuildPitchingStats(game);
  const by = Object.fromEntries(records.map((r) => [r.playerId, r.outsRecorded]));
  assert.equal(by.takashima, 3); // 自軍攻撃の走塁アウトは加算されない
  assert.equal(by.udagawa, 3);
});

test('rebuildPitchingStats: 相手の打席を記録していない回には架空のアウトを足さない', () => {
  // 2回裏は暴投ログだけで打席が1つも記録されていない → 3アウトを勝手に足さない
  const game = pitGame({
    playLogs: [
      ...defOuts(1, 3),
      { kind: 'runner', inning: 2, isTop: false, text: '暴投', payload: { outs: 0 } },
      ...defOuts(3, 3),
    ],
  });
  const { records, filledOuts } = rebuildPitchingStats(game);
  assert.equal(filledOuts, 0);
  assert.equal(records[0].outsRecorded, 6);
});

test('rebuildPitchingStats: サヨナラ負けの最終回は3アウトに補完しない', () => {
  const game = pitGame({ myScore: 2, oppScore: 3, playLogs: [...defOuts(1, 3), ...defOuts(2, 1)] });
  const { records, filledOuts } = rebuildPitchingStats(game);
  assert.equal(filledOuts, 0);
  assert.equal(records[0].outsRecorded, 4); // 1.1回のまま
});

// ---- plays.js ----
test('proposeMoves: 単打は三塁・二塁走者が生還し一塁走者は二塁へ', () => {
  const { moves, batterTo } = proposeMoves('single', { 1: true, 2: true, 3: true });
  assert.equal(batterTo, 1);
  assert.deepEqual(moves, [{ from: 3, to: 4 }, { from: 2, to: 4 }, { from: 1, to: 2 }]);
});

test('proposeMoves: 四球は押し出しのみ進塁(一・三塁では三塁走者は動かない)', () => {
  const { moves } = proposeMoves('bb', { 1: true, 2: false, 3: true });
  assert.deepEqual(moves, [{ from: 1, to: 2 }]);
});

test('proposeMoves: 犠飛は各走者が1つ進む(3塁→得点/2塁→三塁/1塁→二塁)', () => {
  const { moves, batterTo } = proposeMoves('sacFly', { 1: true, 2: true, 3: true });
  assert.equal(batterTo, 'out');
  assert.deepEqual(moves, [{ from: 3, to: 4 }, { from: 2, to: 3 }, { from: 1, to: 2 }]);
  // 一塁のみでも二塁へ進むのが既定
  assert.deepEqual(proposeMoves('sacFly', { 1: true, 2: false, 3: false }).moves, [{ from: 1, to: 2 }]);
});

test('judgeAdvance: 走者が誰もアウトにならず1人以上進めば進塁打', () => {
  assert.equal(judgeAdvance([{ from: 1, to: 2 }]), true);
  assert.equal(judgeAdvance([{ from: 1, to: 2 }, { from: 3, to: 'out' }]), false);
  assert.equal(judgeAdvance([]), false);
});

test('batterDestOptions: 本塁打は本塁のみ・三振は振り逃げ可', () => {
  assert.deepEqual(batterDestOptions('hr'), [4]);
  assert.deepEqual(batterDestOptions('so'), ['out', 1]);
});

// ---- rules.js ----
const baseGame = {
  status: 'live', isHome: false, isTop: true, inning: 8,
  myScore: 3, oppScore: 1, rules: { innings: 7, mercy: [], pitchLimit: null, timeLimitMin: null },
};

test('gameEndCheck: 規定回終了+点差ありは regulation', () => {
  assert.equal(gameEndCheck(baseGame)?.type, 'regulation');
});

test('gameEndCheck: 規定回終了で同点は tie(延長続行可)', () => {
  assert.equal(gameEndCheck({ ...baseGame, myScore: 1 })?.type, 'tie');
});

test('gameEndCheck: 最終回裏に後攻リードで xwin', () => {
  const g = { ...baseGame, isHome: true, isTop: false, inning: 7, myScore: 5, oppScore: 2 };
  assert.equal(gameEndCheck(g)?.type, 'xwin');
});

test('gameEndCheck: コールド条件成立で mercy', () => {
  const g = {
    ...baseGame, inning: 6, myScore: 12, oppScore: 1,
    rules: { innings: 7, mercy: [{ after: 5, diff: 10 }], pitchLimit: null, timeLimitMin: null },
  };
  assert.equal(gameEndCheck(g)?.type, 'mercy');
});

test('initialPresetIdFor: 別エディションのプリセットは引き継がず既定に戻す', () => {
  assert.equal(initialPresetIdFor('gakudo6', '草野球'), 'kusa7');
  assert.equal(initialPresetIdFor('kusa7-120', '草野球'), 'kusa7-120');
  assert.equal(initialPresetIdFor('custom', '少年野球'), 'custom');
});

test('describeRules: ルールなしとフル指定の文言', () => {
  assert.match(describeRules(null), /ルール管理なし/);
  assert.match(
    describeRules({ innings: 6, mercy: [{ after: 4, diff: 10 }], pitchLimit: { perGame: 70 }, timeLimitMin: 90 }),
    /6回制・90分時間制限・4回10点差コールド・球数70球制限/
  );
});

// ---- stats.js ----
function syntheticGame() {
  // 打席2つ + 盗塁ログ(重盗=2ログ) + 生還ログ を持つ最小の試合
  return {
    atBats: [
      { playerId: 'p1', result: 'single', rbi: 1, pitchCount: 3, firstPitch: 'ball', snapshot: { runners: { 2: true } } },
      { playerId: 'p1', result: 'so', rbi: 0, pitchCount: 4, snapshot: { runners: {} } },
      { playerId: 'p2', result: 'bb', rbi: 0, pitchCount: 5, snapshot: { runners: {} } },
    ],
    playLogs: [
      // 重盗: 走者ごとに1ログ(store.jsxのRUNNER_EVENTが生成する形)
      { kind: 'sb', payload: { moves: [{ from: 1, to: 2 }], playerId: 'p2' } },
      { kind: 'sb', payload: { moves: [{ from: 2, to: 3 }], playerId: 'p1' } },
      { kind: 'sb', payload: { moves: [{ from: 2, to: 3 }], playerId: 'p1' } },
      { kind: 'run', payload: { playerId: 'p1' } },
    ],
  };
}

test('aggregateBatting: 重盗で走者全員に盗塁が付く(1人1ログ)', () => {
  const m = aggregateBatting([syntheticGame()]);
  assert.equal(m.p1.sb, 2);
  assert.equal(m.p2.sb, 1);
  assert.equal(m.p1.h, 1);
  assert.equal(m.p1.so, 1);
  assert.equal(m.p1.runs, 1);
  assert.equal(m.p2.bb, 1);
  assert.equal(m.p1.rispAB, 1); // 得点圏(二塁走者あり)での打数
  assert.equal(m.p1.rispH, 1);
});

test('battingMetrics: 打率・出塁率の分母定義', () => {
  const m = aggregateBatting([syntheticGame()]);
  const met = battingMetrics(m.p1);
  assert.equal(met.ba, 0.5); // 2打数1安打(四球なし)
  const met2 = battingMetrics(m.p2);
  assert.equal(met2.ba, null); // 打数0は null(表示は'-')
  assert.equal(met2.obp, 1); // 出塁率は四球を含む
});

test('pitchingMetrics: 防御率は既定で7回換算', () => {
  const met = pitchingMetrics({ outsRecorded: 21, earnedRuns: 2, hitsAllowed: 5, walks: 2, hitByPitch: 0, strikeouts: 6, abFaced: 25 });
  assert.equal(met.era, 2); // 自責2/7回 → 7回換算2.00
  assert.equal(met.whip, 1);
});

test('titleLeaders: 同数首位は全員返す', () => {
  const map = {
    a: { playerId: 'a', h: 5 },
    b: { playerId: 'b', h: 5 },
    c: { playerId: 'c', h: 3 },
  };
  const { leaders, value } = titleLeaders(map, 'h');
  assert.deepEqual(leaders.sort(), ['a', 'b']);
  assert.equal(value, 5);
});

// ---- i18n ----
test('translate: 言語別の解決とjaフォールバック', () => {
  assert.equal(translate('ja', 'tab.home'), 'ホーム');
  assert.equal(translate('en', 'tab.home'), 'Home');
  assert.equal(translate('xx', 'tab.home'), 'ホーム'); // 未知言語はjaへ
  assert.equal(translate('en', 'no.such.key'), 'no.such.key'); // 未定義キーはキー名を返す
});

// ---- 対戦成績(マッチアップ) ----
// 相手選手は試合ごとの記号で記録しているため、記号ではなく
// 「相手チーム名 + 相手選手名」で同一人物を辿れることを確かめる。
const mtGame = (id, opponent, oppNames, logs, oppPitcherLetter = 'A') => ({
  id, opponent, oppNames, oppPitcherLetter, status: 'finished', isHome: false,
  myScore: 5, oppScore: 3, playLogs: logs.map((l, i) => ({ id: `${id}-${i}`, ...l })),
});

test('oppPitcherByAtBat: 継投をまたいで、その打席の相手投手を割り出す', () => {
  const g = mtGame('g', 'X', { A: '田中', C: '鈴木' }, [
    { inning: 1, isTop: true, kind: 'atbat', payload: { playerId: 'p1', result: 'single' } },
    { inning: 5, isTop: true, kind: 'opppitcher', payload: { in: 'C', out: 'A' } },
    { inning: 5, isTop: true, kind: 'atbat', payload: { playerId: 'p1', result: 'double' } },
  ]);
  const m = oppPitcherByAtBat(g);
  assert.equal(m.get('g-0'), 'A'); // 交代前は先発
  assert.equal(m.get('g-2'), 'C'); // 交代後は継投した投手
});

test('buildMatchups: 記号が試合ごとに変わっても、名前で同一人物として積み上がる', () => {
  // 1試合目: 田中=A で登板 / 2試合目: 同じ田中が B で登板。チーム名には表記ゆれがある。
  const g1 = mtGame('g1', '上智大学女子野球部 Mamues', { A: '田中', B: '佐藤' }, [
    { inning: 1, isTop: true, kind: 'atbat', payload: { playerId: 'p1', result: 'single' } },
    { inning: 1, isTop: false, kind: 'defense', payload: { pitcherId: 'q1', letter: 'B', result: 'hr', runs: 1 } },
  ]);
  const g2 = mtGame('g2', '上智大学女子野球部Mamues', { B: '田中', A: '佐藤' }, [
    { inning: 2, isTop: true, kind: 'atbat', payload: { playerId: 'p1', result: 'out' } },
    { inning: 2, isTop: false, kind: 'defense', payload: { pitcherId: 'q1', letter: 'A', result: 'single' } },
  ], 'B');

  const { batting, pitching } = buildMatchups([g1, g2]);
  const vsTanaka = batting.find((r) => r.myPlayerId === 'p1' && r.oppName === '田中');
  assert.ok(vsTanaka, '田中との対戦がまとまっている');
  assert.deepEqual([vsTanaka.ab, vsTanaka.h, vsTanaka.games], [2, 1, 2]); // 2試合ぶんが1行に
  assert.equal(vsTanaka.avg.toFixed(3), '0.500');

  const vsSato = pitching.find((r) => r.myPlayerId === 'q1' && r.oppName === '佐藤');
  assert.deepEqual([vsSato.ab, vsSato.h, vsSato.hr, vsSato.games], [2, 2, 1, 2]);
});

test('buildMatchups: 名前が入っていない相手は通算に数えない', () => {
  const g = mtGame('g', 'X', {}, [
    { inning: 1, isTop: true, kind: 'atbat', payload: { playerId: 'p1', result: 'single' } },
    { inning: 1, isTop: false, kind: 'defense', payload: { pitcherId: 'q1', letter: 'B', result: 'single' } },
  ]);
  const { batting, pitching } = buildMatchups([g]);
  assert.deepEqual([batting.length, pitching.length], [0, 0]);
  assert.equal(oppPlayerKey(g, 'A'), null);
});

test('normalizeName / opponentSummaries: 表記ゆれを吸収してチーム別成績にまとめる', () => {
  assert.equal(normalizeName('上智大学女子野球部 Mamues'), normalizeName('上智大学女子野球部Ｍamues'));
  const rows = opponentSummaries([
    { id: 'a', opponent: '上智 Mamues', status: 'finished', myScore: 9, oppScore: 4 },
    { id: 'b', opponent: '上智Mamues', status: 'finished', myScore: 2, oppScore: 5 },
    { id: 'c', opponent: '上智Mamues', status: 'inprogress', myScore: 0, oppScore: 0 }, // 未了は除外
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].games, rows[0].win, rows[0].lose, rows[0].rs, rows[0].ra], [2, 1, 1, 11, 9]);
});

test('oppBaserunning: 相手の盗塁・盗塁死を走者の記号ごとに数える', () => {
  // 相手走者は letter で識別する。自軍走者(playerId側)は混ざらない。
  const g = { playLogs: [
    { id: 'a', kind: 'sb', isTop: false, text: '盗塁', payload: { letter: 'C', playerId: null } },
    { id: 'b', kind: 'sb', isTop: false, text: '盗塁', payload: { letter: 'C', playerId: null } },
    { id: 'c', kind: 'runner', isTop: false, text: '盗塁死', payload: { letter: 'C', playerId: null } },
    { id: 'd', kind: 'sb', isTop: false, text: '盗塁', payload: { letter: 'A', playerId: null } },
    { id: 'e', kind: 'sb', isTop: true, text: '盗塁', payload: { letter: null, playerId: 'p1' } }, // 自軍
    { id: 'f', kind: 'runner', isTop: false, text: '暴投', payload: { letter: 'A', playerId: null } }, // 盗塁ではない
  ] };
  const rows = oppBaserunning(g);
  assert.deepEqual(rows.map((r) => [r.letter, r.sb, r.cs, r.att]), [['C', 2, 1, 3], ['A', 1, 0, 1]]);
  assert.equal(rows[0].rate.toFixed(3), '0.667');
  // 走塁の記録が無い相手は行そのものが出ない(0と「記録なし」を混同しないため)
  assert.deepEqual(oppBaserunning({ playLogs: [] }), []);
});

// ---- 年度(4月始まり) ----
test('yearOfDate: 4月始まりで年度が切り替わる', () => {
  assert.equal(yearOfDate('2026-03-20'), 2025); // 3月はまだ前年度
  assert.equal(yearOfDate('2026-03-31'), 2025);
  assert.equal(yearOfDate('2026-04-01'), 2026);
  assert.equal(yearOfDate('2026-12-31'), 2026);
  // 開始月は設定で変えられる(1月=暦年 / 9月=北米式)
  assert.equal(yearOfDate('2026-03-20', 1), 2026);
  assert.equal(yearOfDate('2026-03-20', 9), 2025);
  assert.equal(yearOfDate('2026-09-01', 9), 2026);
  assert.equal(yearOfDate(null), null);
  assert.equal(yearOfDate('へんな日付'), null);
});

test('yearOfGame: 手入力の year が日付より優先される(合宿等で年度をまたぐ場合)', () => {
  assert.equal(yearOfGame({ date: '2026-03-20' }), 2025);
  assert.equal(yearOfGame({ date: '2026-03-20', year: 2026 }), 2026);
  assert.equal(yearOfGame({ date: '2026-03-20', year: '' }), 2025); // 空文字は未指定扱い
});

test('tenureByPlayer: 出場した試合から在籍期間を割り出す(手入力なし)', () => {
  const g = (date, ids) => ({
    id: date, date,
    playLogs: ids.map((id, i) => ({ id: `${date}-${i}`, kind: 'atbat', payload: { playerId: id } })),
    atBats: [], pitchingRecords: [],
  });
  const games = [
    g('2022-05-01', ['a', 'b']),
    g('2024-06-01', ['a', 'c']),
    g('2026-05-01', ['c']),
  ];
  const t = tenureByPlayer(games);
  assert.deepEqual([t.get('a').from, t.get('a').to, t.get('a').games], [2022, 2024, 2]);
  assert.deepEqual([t.get('b').from, t.get('b').to], [2022, 2022]);
  assert.deepEqual([t.get('c').from, t.get('c').to], [2024, 2026]);
  // 年度スコープでは、その年度に出ていない選手が外れる
  assert.equal(playedInYear(t, 'a', 2023), true);  // 2022–2024 の間
  assert.equal(playedInYear(t, 'a', 2026), false); // 卒業後
  assert.equal(playedInYear(t, 'c', 2026), true);
  assert.equal(playedInYear(t, '未登録', 2026), false);
  // 交代・投球の記録からも拾う
  const sub = { id: 's', date: '2025-05-01', playLogs: [{ id: 's0', kind: 'sub', payload: { in: 'x', out: 'y' } }] };
  const t2 = tenureByPlayer([sub]);
  assert.deepEqual([t2.get('x').from, t2.get('y').from], [2025, 2025]);
});

test('yearsInGames / yearLabel / isArchived', () => {
  const games = [{ date: '2026-04-01' }, { date: '2026-03-01' }, { date: '2024-08-01' }];
  assert.deepEqual(yearsInGames(games), [2026, 2025, 2024]); // 新しい順
  assert.equal(yearLabel(2025, 'ja'), '2025年度');
  assert.equal(yearLabel(2025, 'en'), '2025–26');
  assert.equal(yearLabel(2025, 'en', 1), '2025'); // 暦年なら年をまたがない
  assert.equal(isArchived({ archivedAt: null }), false);
  assert.equal(isArchived({ archivedAt: 1234 }), true);
  assert.equal(currentYear(4, new Date('2026-03-20T00:00:00')), 2025);
  assert.equal(currentYear(4, new Date('2026-04-20T00:00:00')), 2026);
});

test('scopedGames: 年度スコープは既定でも「その年度だけ」に絞る', () => {
  // 既定(value.year 未指定)でも全件が返ってしまうと、見出しは「2026年度」なのに
  // 中身は通算、という食い違いが起きる。トグルと集計で同じ既定を使う。
  const state = {
    settings: { yearStartMonth: 4 },
    games: {
      a: { id: 'a', date: '2026-06-10' },
      b: { id: 'b', date: '2026-03-10' }, // 3月 = 2025年度
      c: { id: 'c', date: '2024-06-10' },
    },
  };
  const all = Object.values(state.games);
  const now = currentYear(4);
  assert.equal(resolveYear(all, { scope: 'year' }, 4), [2026, 2025, 2024].includes(now) ? now : 2026);
  // 年度を明示すれば、その年度の試合だけ
  assert.deepEqual(scopedGames(state, { scope: 'year', year: 2026 }).map((g) => g.id), ['a']);
  assert.deepEqual(scopedGames(state, { scope: 'year', year: 2025 }).map((g) => g.id), ['b']);
  // 通算は全件、試合スコープは1件
  assert.equal(scopedGames(state, { scope: 'total' }).length, 3);
  assert.deepEqual(scopedGames(state, { scope: 'game', gameId: 'c' }).map((g) => g.id), ['c']);
  // 記録が1件も無いときだけ全件(空表示になるより素直)
  assert.equal(resolveYear([], { scope: 'year' }, 4), null);
});

// ---- 学年(入学年度から導出) ----
test('gradeOf / entryYearFromGrade: 学年は保存せず入学年度から導く', () => {
  const p = { entryYear: 2024 };
  assert.equal(gradeOf(p, 2024), 1);
  assert.equal(gradeOf(p, 2026), 3); // 年度が進めば学年も上がる(名簿の書き換え不要)
  assert.equal(gradeOf(p, 2023), 0); // 入学前
  assert.equal(gradeOf({}, 2026), null); // 未設定
  // 入力は「学年」、保存は「入学年度」
  assert.equal(entryYearFromGrade(1, 2026), 2026);
  assert.equal(entryYearFromGrade(3, 2026), 2024);
  assert.equal(entryYearFromGrade('', 2026), null);
});

test('willGraduate: 最終学年に達していれば、その年度で卒業', () => {
  const high = maxGradeOf('high'); // 高校3年
  assert.equal(high, 3);
  assert.equal(willGraduate({ entryYear: 2024 }, 2026, high), true);  // 3年
  assert.equal(willGraduate({ entryYear: 2025 }, 2026, high), false); // 2年
  assert.equal(willGraduate({}, 2026, high), false); // 学年未設定は自動判定しない
  assert.equal(maxGradeOf('elementary'), 6);
  assert.equal(maxGradeOf('university'), 4);
});

test('usesGrade / defaultSchoolType: 草野球では学年を使わない', () => {
  assert.equal(usesGrade('草野球'), false);
  assert.equal(usesGrade('ブカツ(中高大)'), true);
  assert.equal(usesGrade('少年野球'), true);
  assert.equal(defaultSchoolType('草野球'), null);
  assert.equal(defaultSchoolType('少年野球'), 'elementary');
  assert.equal(defaultSchoolType('ブカツ(中高大)'), 'high');
});

test('sortByGrade: 上級生から並び、未設定は末尾', () => {
  const ps = [
    { id: 'a', name: '1年', entryYear: 2026, number: '9' },
    { id: 'b', name: '未設定', number: '1' },
    { id: 'c', name: '3年', entryYear: 2024, number: '5' },
    { id: 'd', name: '3年若番', entryYear: 2024, number: '2' },
  ];
  assert.deepEqual(sortByGrade(ps, 2026).map((p) => p.name), ['3年若番', '3年', '1年', '未設定']);
});

// ---- 主将・副主将 ----
// reducer は JSX 側にあるため、ここでは同じ規則を関数として再現して固定する。
// (2人が主将になっている状態を作らせない、が守りたい不変条件)
function applyTeamRole(players, id, role) {
  const limit = role === 'captain' ? 1 : role === 'vice' ? 2 : 0;
  const others = players.filter((p) => p.id !== id && p.teamRole === role);
  const drop = new Set(others.slice(0, Math.max(0, others.length - (limit - 1))).map((p) => p.id));
  return players.map((p) => {
    if (p.id === id) return { ...p, teamRole: role };
    if (role && drop.has(p.id)) return { ...p, teamRole: '' };
    return p;
  });
}

test('主将は1人・副主将は2人まで', () => {
  let ps = [
    { id: 'a', teamRole: '' }, { id: 'b', teamRole: '' },
    { id: 'c', teamRole: '' }, { id: 'd', teamRole: '' },
  ];
  const roleOf = (list, id) => list.find((p) => p.id === id).teamRole;

  ps = applyTeamRole(ps, 'a', 'captain');
  assert.equal(roleOf(ps, 'a'), 'captain');
  // 別の選手を主将にすると、前の主将は自動で外れる
  ps = applyTeamRole(ps, 'b', 'captain');
  assert.equal(roleOf(ps, 'b'), 'captain');
  assert.equal(roleOf(ps, 'a'), '');
  assert.equal(ps.filter((p) => p.teamRole === 'captain').length, 1);

  // 副主将は2人まで並存できる
  ps = applyTeamRole(ps, 'c', 'vice');
  ps = applyTeamRole(ps, 'd', 'vice');
  assert.equal(ps.filter((p) => p.teamRole === 'vice').length, 2);
  // 3人目を付けると、いちばん古い1人が外れる
  ps = applyTeamRole(ps, 'a', 'vice');
  assert.equal(ps.filter((p) => p.teamRole === 'vice').length, 2);
  assert.equal(roleOf(ps, 'c'), '');
  // 主将は影響を受けない
  assert.equal(roleOf(ps, 'b'), 'captain');
});

test('opponentTeams: 表記ゆれをまとめ、最後に使った書き方を採用する', () => {
  const games = [
    { id: 'a', opponent: '上智 Mamues', date: '2025-05-01' },
    { id: 'b', opponent: '上智Mamues', date: '2026-07-24' },
    { id: 'c', opponent: '日大三高OB', date: '2026-06-01' },
    { id: 'd', opponent: '', date: '2026-01-01' },
  ];
  const rows = opponentTeams(games);
  assert.deepEqual(rows.map((r) => [r.name, r.games]), [['上智Mamues', 2], ['日大三高OB', 1]]);
  assert.equal(rows[0].lastDate, '2026-07-24'); // 最後に対戦した順
});

test('lastOppRoster: 直近の対戦から相手の並びを取り出す', () => {
  const mk = (id, date, names) => ({
    id, date, opponent: '上智Mamues',
    oppLineup: 'ABC'.split('').map((letter, i) => ({ order: i + 1, letter, position: '' })),
    oppNames: names, oppPositions: { A: '中' }, oppBatterHands: { A: 'L' }, oppPitcherHands: { B: 'R' },
    oppPitcherLetter: 'B',
  });
  const games = [mk('old', '2025-05-01', { A: '旧' }), mk('new', '2026-07-24', { A: '佐藤', B: '田中' })];
  const r = lastOppRoster(games, '上智 Mamues'); // 表記が揺れていても引ける
  assert.equal(r.fromGameId, 'new');
  assert.equal(r.namedCount, 2);
  assert.deepEqual(r.oppNames, { A: '佐藤', B: '田中' });
  assert.equal(r.oppBatterHands.A, 'L');
  assert.equal(r.lineup.length, 3);
  // 対戦したことのない相手は null
  assert.equal(lastOppRoster(games, '知らないチーム'), null);
  assert.equal(lastOppRoster(games, ''), null);
});

test('defaultYearStartMonth: 中学・高校の代は夏の大会後(9月)に替わる', () => {
  // 学校の年度は4月始まりだが、野球部の代は夏の大会で3年生が引退して秋から替わる。
  // 学年(入学年度から導出)とは別の軸なので、混ぜずに開始月で表す。
  assert.equal(defaultYearStartMonth('ブカツ(中高大)', 'high'), 8);
  assert.equal(defaultYearStartMonth('ブカツ(中高大)', 'junior'), 8);
  assert.equal(defaultYearStartMonth('ブカツ(中高大)', 'university'), 4); // 大学は年度末まで
  assert.equal(defaultYearStartMonth('少年野球', 'elementary'), 4);
  assert.equal(defaultYearStartMonth('草野球', null), 4);

  // 8月始まり: 7月の夏の大会は前の代の最後の試合、8月からは新チーム
  assert.equal(yearOfDate('2026-07-20', 8), 2025); // 夏の大会 = 2025年8月に始まった代
  assert.equal(yearOfDate('2026-08-01', 8), 2026); // 8月から新チーム
  assert.equal(yearOfDate('2026-06-01', 8), 2025); // 春も前の代
  // 呼び方も実感に合わせる(2025年8月に始まった代は2026年の夏に引退する)
  assert.equal(yearLabel(2025, 'ja', 8), '2026年度チーム');
  assert.equal(yearLabel(2025, 'ja', 9), '2026年度チーム');
  assert.equal(yearLabel(2025, 'ja', 4), '2025年度');
  assert.equal(yearLabel(2025, 'ja', 1), '2025年');
});

test('学年は学校年度(4月)、代は9月。混ぜると1年生が半年で2年生になる', () => {
  // 2026年4月に高校へ入学した1年生。学校年度 2026 で 1年
  const p = { entryYear: 2026 };
  assert.equal(gradeOf(p, 2026), 1);
  assert.equal(gradeOf(p, 2027), 2); // 翌年の4月に2年
  assert.equal(gradeOf(p, 2028), 3);

  // 代(9月始まり)の終わり時点の学校年度で引退を判定する
  //   代2025 = 2025年9月〜2026年8月 → 終わりは2026年8月 → 学校年度 2026
  assert.equal(schoolYearAtSeasonEnd(2025, 8), 2026);
  assert.equal(schoolYearAtSeasonEnd(2025, 9), 2026);
  assert.equal(schoolYearAtSeasonEnd(2025, 4), 2025); // 4月始まりなら同じ年度

  const high = maxGradeOf('high'); // 3
  // 2024年入学(2026年度に3年) → 代2025(2026年夏に終わる)で引退
  const senior = { entryYear: 2024 };
  assert.equal(gradeOf(senior, 2026), 3);
  assert.equal(willGraduate(senior, 2025, high, 8), true);
  // 2025年入学は、その代ではまだ2年なので引退しない
  assert.equal(willGraduate({ entryYear: 2025 }, 2025, high, 8), false);
  // その次の代では引退する
  assert.equal(willGraduate({ entryYear: 2025 }, 2026, high, 8), true);
});

test('代の呼び名はチームごとに上書きできる(「第75期」「山田の代」)', () => {
  // 既定の呼び方
  assert.equal(yearLabel(2025, 'ja', 8), '2026年度チーム');
  assert.equal(yearLabel(2025, 'ja', 4), '2025年度');
  // 上書き(伝統校の「期」、主将の名を取った呼び方)
  const custom = { 2025: '第75期', 2024: '山田の代' };
  assert.equal(yearLabel(2025, 'ja', 8, custom), '第75期');
  assert.equal(yearLabel(2024, 'ja', 8, custom), '山田の代');
  assert.equal(yearLabel(2023, 'ja', 8, custom), '2024年度チーム'); // 未設定は既定のまま
  // 空欄・空白だけの上書きは既定に戻す(消したつもりが空文字で残るのを防ぐ)
  assert.equal(yearLabel(2025, 'ja', 8, { 2025: '   ' }), '2026年度チーム');
  // 保存が文字列キーになっていても引ける
  assert.equal(yearLabel(2025, 'ja', 8, { '2025': '第75期' }), '第75期');
  // 設定からそのまま呼べる形
  assert.equal(labelOfYear(2025, { lang: 'ja', yearStartMonth: 8, yearLabels: custom }), '第75期');
  assert.equal(labelOfYear(2025, { lang: 'ja', yearStartMonth: 8 }), '2026年度チーム');
});

test('oppPlayerAtBats: 相手ひとりの打球を試合をまたいで集める(引っ張りは左右で反転)', () => {
  const mk = (id, letter, dir, result, outType) => ({ id, kind: 'defense', inning: 1, isTop: false,
    payload: { letter, direction: dir, result, outType } });
  const g1 = {
    id: 'g1', opponent: '上智', oppNames: { A: '佐藤' }, oppBatterHands: { A: 'L' }, // 左打者
    playLogs: [mk('a', 'A', 'RF', 'single', null), mk('b', 'A', 'CF', 'out', 'fly'), mk('c', 'A', 'LF', 'out', 'ground')],
  };
  // 別の試合では記号が変わっている(記号は試合ごとの識別子)
  const g2 = {
    id: 'g2', opponent: '上智', oppNames: { C: '佐藤' }, oppBatterHands: { C: 'L' },
    playLogs: [mk('d', 'C', '1B', 'double', null), { id: 'e', kind: 'sb', payload: { letter: 'C' } }],
  };
  const r = oppPlayerAtBats([g1, g2], '上智|佐藤');
  assert.equal(r.name, '佐藤');
  assert.equal(r.games, 2);              // 記号が変わっても同じ人として繋がる
  assert.equal(r.atBats.length, 4);
  assert.equal(r.sb, 1);
  // 左打者なので右方向(RF/1B)が引っ張り、左方向(LF)が逆方向
  assert.deepEqual([r.dir.pull, r.dir.center, r.dir.oppo], [2, 1, 1]);
  assert.deepEqual([r.kind.fly, r.kind.ground], [1, 1]);
  // SprayChart がそのまま読める形になっている
  assert.deepEqual(Object.keys(r.atBats[0]).sort(),
    ['contact', 'direction', 'hitAngle', 'hitDepth', 'id', 'outType', 'result']);
  // 右打者なら引っ張りと逆方向が入れ替わる
  const gR = { ...g1, oppBatterHands: { A: 'R' } };
  const rR = oppPlayerAtBats([gR], '上智|佐藤');
  assert.deepEqual([rR.dir.pull, rR.dir.oppo], [1, 1]);
  // 該当なしは null
  assert.equal(oppPlayerAtBats([g1], '上智|居ない'), null);
});

test('oppPlayerAtBats: 相手の打点と強さも渡す(渡さないと相手だけ団子のままになる)', () => {
  const g = {
    id: 'g', opponent: '上智', oppNames: { A: '佐藤' }, oppBatterHands: { A: 'R' },
    playLogs: [
      { id: 'a', kind: 'defense', payload: { letter: 'A', direction: 'LF', result: 'double', outType: 'liner', contact: 'hard', hitAngle: -28, hitDepth: 0.92 } },
      { id: 'b', kind: 'defense', payload: { letter: 'A', direction: 'SS', result: 'out', outType: 'ground', contact: 'weak', hitAngle: -14, hitDepth: 0.33 } },
      { id: 'c', kind: 'defense', payload: { letter: 'A', direction: 'CF', result: 'out', outType: 'fly' } }, // 強さ未記録
    ],
  };
  const r = oppPlayerAtBats([g], '上智|佐藤');
  assert.deepEqual([r.atBats[0].hitAngle, r.atBats[0].hitDepth], [-28, 0.92]);
  assert.equal(r.atBats[0].contact, 'hard');
  // 実際の落下点として図に置ける(守備位置からの推定ではない)
  assert.equal(ballOf(r.atBats[0]).exact, true);
  assert.equal(ballOf(r.atBats[2]).exact, false); // 打点なしは守備位置から
  // ハードヒット率の分母は「強さを記録した打球」だけ
  assert.deepEqual([r.hardHit, r.contactRecorded], [1, 2]);
});

test('oppBatteryStats: 相手捕手の盗塁阻止率と、投手の暴投・牽制を集める', () => {
  // 自軍はビジター(isHome=false)なので、自軍の攻撃は表
  const g = {
    id: 'g', opponent: '上智', isHome: false,
    oppLineup: [{ order: 4, letter: 'D', position: '捕' }, { order: 1, letter: 'A', position: '投' }],
    oppPositions: { D: '捕', A: '投' },
    oppNames: { D: '渡辺', A: '田中', E: '高橋' },
    oppPitcherLetter: 'A',
    playLogs: [
      { id: '1', kind: 'atbat', inning: 1, isTop: true, payload: { playerId: 'p0', result: 'bb' } },
      { id: '2', kind: 'sb', inning: 1, isTop: true, text: '盗塁', payload: { playerId: 'p0' } },
      { id: '3', kind: 'runner', inning: 2, isTop: true, text: '盗塁死', payload: { playerId: 'p1' } },
      { id: '4', kind: 'runner', inning: 2, isTop: true, text: '暴投', payload: {} },
      { id: '5', kind: 'runner', inning: 3, isTop: true, text: '捕逸', payload: {} },
      // 5回から捕手が交代
      { id: '6', kind: 'oppsub', inning: 5, isTop: true, payload: { order: 4, in: 'E', out: 'D' } },
      { id: '7', kind: 'sb', inning: 6, isTop: true, text: '盗塁', payload: { playerId: 'p0' } },
      { id: '8', kind: 'runner', inning: 6, isTop: true, text: '盗塁死', payload: { playerId: 'p2' } },
      // 相手の攻撃中(裏)の出来事は相手バッテリーの隙ではない
      { id: '9', kind: 'sb', inning: 3, isTop: false, text: '盗塁', payload: { letter: 'B' } },
    ],
  };
  const r = oppBatteryStats([g]);
  const watanabe = r.catchers.find((c) => c.name === '渡辺');
  const takahashi = r.catchers.find((c) => c.name === '高橋');
  assert.deepEqual([watanabe.sbAllowed, watanabe.caught, watanabe.att], [1, 1, 2]); // 交代前
  assert.equal(watanabe.csRate.toFixed(3), '0.500');
  assert.deepEqual([takahashi.sbAllowed, takahashi.caught], [1, 1]); // 交代後は別の捕手に付く
  const tanaka = r.pitchers.find((p) => p.name === '田中');
  assert.deepEqual([tanaka.wp, tanaka.bbHbp], [1, 1]);
  assert.equal(r.team.pb, 1);
  // 名前が入っていない相手は集計しない(誰の記録か特定できないため)
  assert.deepEqual(oppBatteryStats([{ ...g, oppNames: {} }]).catchers, []);
});

test('oppOffenseStats: 走ってくるチームか、送ってくるチームかを見る', () => {
  const on = (bases) => ({ 1: bases.includes(1) || null, 2: bases.includes(2) || null, 3: bases.includes(3) || null });
  const d = (id, letter, result, before, outs, pitchCount = 3) => ({ id, kind: 'defense', inning: 1, isTop: false,
    payload: { letter, result, beforeRunners: before, outsBefore: outs, pitchCount } });
  const g = {
    id: 'g', opponent: '上智', isHome: true, // 相手が後攻 = 相手の攻撃は裏... ではなく isHome は自軍。相手の攻撃は表
    oppLineup: [{ order: 1, letter: 'A' }, { order: 2, letter: 'B' }],
    oppNames: { A: '佐藤', B: '中村' },
    playLogs: [
      d('1', 'A', 'sacBunt', on([1]), 0),
      d('2', 'B', 'sacBunt', on([1]), 0),
      d('3', 'A', 'out', on([1]), 0),
      d('4', 'B', 'single', on([]), 0, 1),  // 初球打ち
      d('5', 'A', 'out', on([]), 1, 5),
      { id: '6', kind: 'sb', inning: 2, isTop: true, text: '盗塁', payload: { letter: 'A' } },
      { id: '7', kind: 'sb', inning: 3, isTop: true, text: '盗塁', payload: { letter: 'A' } },
      { id: '8', kind: 'runner', inning: 4, isTop: true, text: '盗塁死', payload: { letter: 'B' } },
      // 自軍の攻撃中(裏)の盗塁は相手の機動力ではない
      { id: '9', kind: 'sb', inning: 2, isTop: false, text: '盗塁', payload: { playerId: 'p0' } },
    ],
  };
  const r = oppOffenseStats([g]);
  assert.deepEqual([r.sb, r.cs, r.att], [2, 1, 3]);
  assert.equal(r.sbRate.toFixed(3), '0.667');
  assert.equal(r.sacBunt, 2);
  assert.equal(r.firstPitchRate.toFixed(1), '0.2'); // 5打席中1打席が初球
  // 無死一塁は3回あって、うち2回が送りバント
  const s = r.situations.find((x) => x.key === 'o0_1');
  assert.deepEqual([s.count, s.sac], [3, 2]);
  // 走ってくる打者(企図の多い順)
  assert.deepEqual(r.runners.map((x) => [x.name, x.sb, x.cs]), [['佐藤', 2, 0], ['中村', 0, 1]]);
  // 1回きりの場面は傾向とは言えないので出さない
  assert.equal(r.situations.every((x) => x.count >= 2), true);
});

// ---- ownScout.js: 同じ物差しを自軍に向ける ----
test('ownOffenseStats: 自軍の走る/送るの傾向(相手と同じ形で返す)', () => {
  const on = (bases) => ({ 1: bases.includes(1) || null, 2: bases.includes(2) || null, 3: bases.includes(3) || null });
  const ab = (id, playerId, result, before, outs, pitchCount = 3) => ({ id, kind: 'atbat', inning: 1, isTop: true,
    payload: { playerId, result, beforeRunners: before, outsBefore: outs, pitchCount } });
  const g = {
    id: 'g', opponent: '上智', isHome: false, // 自軍が先攻 = 自軍の攻撃は表
    playLogs: [
      ab('1', 'p1', 'sacBunt', on([1]), 0),
      ab('2', 'p2', 'sacBunt', on([1]), 0),
      ab('3', 'p1', 'out', on([1]), 0),
      ab('4', 'p2', 'single', on([]), 0, 1),   // 初球打ち
      ab('5', 'p1', 'bb', on([]), 1, 1),       // 四球は「振っていない」ので初球打ちに数えない
      { id: '6', kind: 'sb', inning: 2, isTop: true, text: '盗塁', payload: { playerId: 'p1' } },
      { id: '7', kind: 'sb', inning: 3, isTop: true, text: '盗塁', payload: { playerId: 'p1' } },
      { id: '8', kind: 'runner', inning: 4, isTop: true, text: '盗塁死', payload: { playerId: 'p2' } },
      // 相手の攻撃中(裏)の盗塁は自軍の機動力ではない
      { id: '9', kind: 'sb', inning: 2, isTop: false, text: '盗塁', payload: { letter: 'A' } },
    ],
  };
  const r = ownOffenseStats([g]);
  assert.deepEqual([r.sb, r.cs, r.att], [2, 1, 3]);
  assert.equal(r.sacBunt, 2);
  assert.equal(r.firstPitchRate.toFixed(1), '0.2'); // 5打席中、初球で振ったのは1打席(四球は除く)
  const s = r.situations.find((x) => x.key === 'o0_1');
  assert.deepEqual([s.count, s.sac], [3, 2]);
  assert.deepEqual(r.runners.map((x) => [x.playerId, x.sb, x.cs]), [['p1', 2, 0], ['p2', 0, 1]]);
});

test('ownBatteryStats: 回ごとの捕手を守備位置から確定し、盗塁阻止率を捕手ごとに出す', () => {
  const g = {
    id: 'g', opponent: '上智', isHome: false, // 自軍が先攻 = 守るのは裏
    startingLineup: [
      { order: 1, playerId: 'c1', position: '捕' },
      { order: 2, playerId: 'pit1', position: '投' },
    ],
    lineup: [
      { order: 1, playerId: 'c2', position: '捕' },
      { order: 2, playerId: 'pit2', position: '投' },
    ],
    playLogs: [
      { id: 'p0', kind: 'pitcher', inning: 1, isTop: false, payload: { in: 'pit1' } },
      // 1〜3回: c1 が捕手
      { id: '1', kind: 'sb', inning: 1, isTop: false, text: '盗塁', payload: { letter: 'A' } },
      { id: '2', kind: 'sb', inning: 2, isTop: false, text: '盗塁', payload: { letter: 'B' } },
      { id: '3', kind: 'runner', inning: 3, isTop: false, text: '盗塁死', payload: { letter: 'C' } },
      { id: '4', kind: 'runner', inning: 3, isTop: false, text: '暴投', payload: {} },
      // 4回から捕手交代
      { id: 'sub', kind: 'sub', inning: 4, isTop: false, payload: { order: 1, in: 'c2', out: 'c1', position: '捕' } },
      { id: 'pc', kind: 'pitcher', inning: 4, isTop: false, payload: { in: 'pit2', out: 'pit1' } },
      { id: '5', kind: 'runner', inning: 4, isTop: false, text: '盗塁死', payload: { letter: 'D' } },
      { id: '6', kind: 'runner', inning: 5, isTop: false, text: '捕逸', payload: {} },
      { id: '7', kind: 'runner', inning: 5, isTop: false, text: '牽制死', payload: { letter: 'E' } },
      // 自軍の攻撃中(表)に走られることはない。自軍が刺された記録を混ぜない
      { id: '8', kind: 'runner', inning: 2, isTop: true, text: '盗塁死', payload: { playerId: 'p9' } },
    ],
  };
  const r = ownBatteryStats([g]);
  const c1 = r.catchers.find((c) => c.playerId === 'c1');
  const c2 = r.catchers.find((c) => c.playerId === 'c2');
  assert.deepEqual([c1.sbAllowed, c1.caught, c1.att], [2, 1, 3]);
  assert.equal(c1.csRate.toFixed(3), '0.333');
  assert.deepEqual([c2.sbAllowed, c2.caught, c2.pb], [0, 1, 1]);
  assert.equal(c2.csRate, 1); // 1回試されて1回刺した
  // 暴投は交代前の投手、牽制死は交代後の投手に付く
  assert.equal(r.pitchers.find((p) => p.playerId === 'pit1').wp, 1);
  assert.equal(r.pitchers.find((p) => p.playerId === 'pit2').pickoff, 1);
});

test('ownBatteryStats: 走られていない捕手の阻止率は0%ではなくnull', () => {
  const g = {
    id: 'g', opponent: '上智', isHome: false,
    startingLineup: [{ order: 1, playerId: 'c1', position: '捕' }],
    lineup: [{ order: 1, playerId: 'c1', position: '捕' }],
    playLogs: [{ id: '1', kind: 'runner', inning: 1, isTop: false, text: '捕逸', payload: {} }],
  };
  const r = ownBatteryStats([g]);
  assert.equal(r.catchers[0].csRate, null);
  assert.equal(r.catchers[0].pb, 1);
});

// ---- battedBall.js: 打球の方向・深さ・強さ ----
test('padPointToBall: チップの位置は今までどおりの方向、深さは定位置/内野に落ちる', () => {
  // 守備位置のチップを押したときの値。チップは「定位置」の距離に置いてある
  for (const [k, v] of Object.entries(POS_BALL)) {
    assert.equal(nearestDirection(v.angle, v.depth), k, `${k} は自分自身に最も近いはず`);
  }
  assert.equal(depthBand(POS_BALL.LF.depth), 'normal');   // 左翼の定位置
  assert.equal(depthBand(POS_BALL.CF.depth), 'normal');   // 中堅の定位置
  assert.equal(depthBand(POS_BALL.SS.depth), 'infield');  // 遊撃は内野
  assert.equal(depthBand(POS_BALL.P.depth), 'infield');
  // 内野は実際の球場の比率へ。図の6割が内野だと、深さが効く外野が潰れる
  assert.ok(POS_BALL.SS.depth < 0.47, '遊撃は内野の土の内側');
  assert.equal(depthBand(1.05), 'over');                  // 柵越え
});

test('POS_BALL: 外野チップは「深い」の帯にかからない(頭を越えた当たりを吸わない)', () => {
  // チップは押すと吸着する <button> なので、深く置くと「外野の頭を越えた
  // 当たり」を狙った指がチップに吸われ、深い当たりが定位置として記録される。
  // チップの高さ26px ぶんが「深い」の内側境界(深さ0.86)より手前にあること。
  const H = 289;                       // 実機幅390pxのときのパッド高
  const py = (angle, depth) => ballToPadPoint(angle, depth).fy * H;
  for (const k of ['LF', 'CF', 'RF']) {
    const { angle, depth } = POS_BALL[k];
    const chipTop = py(angle, depth) - 13;   // チップ上端(高さ26pxの半分)
    const deepEdge = py(angle, 0.86);        // 「深い」の内側境界
    assert.ok(chipTop > deepEdge + 4,
      `${k}: チップ上端 ${chipTop.toFixed(1)} が「深い」の境界 ${deepEdge.toFixed(1)} に近すぎる`);
    // 前に出しすぎて「外野前」に落ちてもいけない(チップの名前は定位置)
    assert.equal(depthBand(depth), 'normal', `${k} は定位置の帯に入る`);
  }
  // 中堅はいちばん深く守る
  assert.ok(POS_BALL.CF.depth > POS_BALL.LF.depth);
  assert.equal(POS_BALL.LF.depth, POS_BALL.RF.depth, '左右は対称');
});

test('padPointToBall: ファウルゾーンは記録しない / 上辺はスタンド(柵越え)', () => {
  assert.equal(padPointToBall(0.02, 0.98).foul, true);  // 三塁線の外
  assert.equal(padPointToBall(0.98, 0.98).foul, true);  // 一塁線の外
  assert.equal(padPointToBall(0.5, 0.5).foul, false);
  // フェンスを図の内側に置いたので、上端はスタンド = 本塁打を押す場所になる
  const top = padPointToBall(0.5, 0);
  assert.equal(depthBand(top.depth), 'over');
  assert.ok(Math.abs(top.angle) < 0.001); // 上辺中央は中堅方向
  // フェンスそのものは図の中にあり、その少し内側は「フェンス際」
  assert.equal(depthBand(0.97), 'wall');
});

test('ballToPadPoint: 押した位置に戻せる(往復して同じ点になる)', () => {
  const b = padPointToBall(0.32, 0.24);
  const p = ballToPadPoint(b.angle, b.depth);
  assert.ok(Math.abs(p.fx - 0.32) < 1e-9);
  assert.ok(Math.abs(p.fy - 0.24) < 1e-9);
});

test('contactCandidate: 候補は出すが「分からない場面」では出さない', () => {
  assert.equal(contactCandidate('ground', 0.75), 'hard');  // 内野を抜けたゴロ
  assert.equal(contactCandidate('ground', 0.20), 'weak');  // 手前で止まった
  assert.equal(contactCandidate('ground', 0.40), null);    // 内野の普通のゴロは深さでは分からない
  assert.equal(contactCandidate('fly', 0.95), 'hard');
  assert.equal(contactCandidate('fly', 0.58), 'weak');
  assert.equal(contactCandidate(null, 0.9), null);         // 軌道が無ければ候補も出さない
  assert.equal(contactCandidate('fly', null), null);       // 深さが無ければ候補も出さない
});

test('ballOf: 角度があれば実座標、無ければ守備位置から補う', () => {
  const exact = ballOf({ hitAngle: -20, hitDepth: 0.9, direction: 'LF' });
  assert.deepEqual([exact.angle, exact.depth, exact.exact], [-20, 0.9, true]);
  const fallback = ballOf({ direction: 'LF' });
  assert.equal(fallback.exact, false);
  assert.equal(Math.round(fallback.angle), Math.round(POS_BALL.LF.angle));
  assert.equal(ballOf({ direction: null }), null); // 方向も無ければ図に置けない
});

test('chartPoint: 深さ1はフェンス上、深さ0は本塁、柵越えは図の外へ出る', () => {
  const near = (a, b, eps = 1) => Math.abs(a - b) <= eps;
  const home = chartPoint(0, 0);
  assert.deepEqual([Math.round(home[0]), Math.round(home[1])], [50, 90]);
  const cf = chartPoint(0, 1);
  assert.ok(near(cf[0], 50) && near(cf[1], 20), `中堅のフェンス ${cf}`);
  // ポールは図の幅にちょうど収まる(はみ出して切れない)
  const poleL = chartPoint(-45, 1);
  const poleR = chartPoint(45, 1);
  assert.ok(poleL[0] >= 0 && poleR[0] <= 100, `ポール ${poleL} ${poleR}`);
  // 柵越えはフェンスより外側(スタンド)に描かれる。柵の上に潰さない
  const hr = chartPoint(0, 1.1);
  assert.ok(hr[1] < cf[1], `柵越えは柵より外 ${hr[1]} < ${cf[1]}`);
  assert.ok(hr[1] > 0, `図の中には収まる ${hr[1]}`);
});

// ---- ファウルグラウンド ----
test('isFoul: ファウルは角度だけで決まる。角度の無い古い記録はフェア扱い', () => {
  assert.equal(isFoul(-46), true);
  assert.equal(isFoul(46), true);
  assert.equal(isFoul(-45), false);   // 線上はフェア
  assert.equal(isFoul(45), false);
  assert.equal(isFoul(0), false);
  assert.equal(isFoul(null), false);  // 古い記録(そもそもファウルを記録できなかった)
  assert.equal(isFoul(undefined), false);
});

test('allowsFoul: ファウルフライは凡打だけ。ファウルの安打とファウルの犠打は無い', () => {
  for (const r of ['out', 'error', 'sacFly']) assert.equal(allowsFoul(r), true, r);
  for (const r of ['single', 'double', 'triple', 'hr', 'sacBunt', 'bb', 'so']) {
    assert.equal(allowsFoul(r), false, r);
  }
});

test('ballOf: ファウルの打球には foul が立ち、守備位置からの推定はフェア扱い', () => {
  assert.equal(ballOf({ hitAngle: -62, hitDepth: 0.4 }).foul, true);
  assert.equal(ballOf({ hitAngle: -30, hitDepth: 0.4 }).foul, false);
  assert.equal(ballOf({ direction: '3B' }).foul, false);
});

test('zoneCounts: ファウルは区画に入れない(端の区画が水増しされない)', () => {
  const rows = [
    { hitAngle: -30, hitDepth: 0.9 },   // 左の深い(区画に入る)
    { hitAngle: -70, hitDepth: 0.4 },   // ファウル
    { hitAngle: 70, hitDepth: 0.4 },    // ファウル
  ];
  const { counts, placed } = zoneCounts(rows);
  assert.equal(placed, 1, 'ファウル2本は置かれない');
  assert.equal(counts.reduce((a, b) => a + b, 0), 1);
});

// ---- 入力パッドに重ねる目印(帯・くさび・波紋) ----
test('padPoint: パッドの割合座標と同じ場所を指す(viewBox は真円が保てる比率)', () => {
  // 比率がずれると同心円が楕円になる
  assert.equal(PAD_VB.h / PAD_VB.w, PAD_ASPECT);
  for (const [angle, depth] of [[0, 1], [-25.2, 0.808], [39.2, 0.347], [0, 0]]) {
    const f = ballToPadPoint(angle, depth);
    const [x, y] = padPoint(angle, depth);
    assert.ok(Math.abs(x - f.fx * PAD_VB.w) < 0.01 && Math.abs(y - f.fy * PAD_VB.h) < 0.01,
      `${angle}/${depth}: ${x},${y} vs ${f.fx * PAD_VB.w},${f.fy * PAD_VB.h}`);
  }
});

test('padWedge: 方向のくさびはスプレーチャートの区画と同じ5分割', () => {
  assert.deepEqual(padWedge(0), { i: 2, a1: -9, a2: 9 });
  assert.deepEqual(padWedge(-39.2), { i: 0, a1: -45, a2: -27 });
  assert.deepEqual(padWedge(39.2), { i: 4, a1: 27, a2: 45 });
  // 端をはみ出しても最後のくさびに丸める(ファウルぎりぎりで落ちない)
  assert.equal(padWedge(60).i, 4);
  assert.equal(padWedge(-60).i, 0);
});

test('padBandRange: 光らせる帯は深さの帯と一致し、柵越えは図の外周で止める', () => {
  assert.deepEqual(padBandRange(0.3), { key: 'infield', dIn: 0, dOut: 0.47 });
  assert.deepEqual(padBandRange(0.79), { key: 'normal', dIn: 0.65, dOut: 0.86 });
  const over = padBandRange(1.4);
  assert.equal(over.key, 'over');
  assert.equal(over.dIn, 1.0);
  assert.ok(Number.isFinite(over.dOut) && over.dOut <= 1.18, `外周で止める ${over.dOut}`);
});

test('PAD_STANDS_TOP: この高さより上はどの横位置にも芝が無い(札が図に被らない根拠)', () => {
  // 方向名はここより上に固定する。座標を計算しないので、札がどれだけ
  // 長くなっても切れない — 二度やらかした「枠外にはみ出す」の再発防止
  assert.ok(Math.abs(PAD_STANDS_TOP - 0.1404) < 0.001, `PAD_STANDS_TOP=${PAD_STANDS_TOP}`);
  // フェンス(深さ1)の頂点と一致する
  assert.ok(Math.abs(ballToPadPoint(0, 1).fy - PAD_STANDS_TOP) < 1e-9);
  // その高さでは、左端から右端までどこを見ても芝(深さ1以内)に入らない
  for (let fx = 0; fx <= 1.0001; fx += 0.02) {
    assert.ok(padPointToBall(fx, PAD_STANDS_TOP).depth >= 1,
      `fx=${fx.toFixed(2)} で深さ ${padPointToBall(fx, PAD_STANDS_TOP).depth.toFixed(3)}`);
  }
  // 1つ下(内側)には芝がある = 境目として正しい
  assert.ok(padPointToBall(0.5, PAD_STANDS_TOP + 0.02).depth < 1);
});

test('padSector / padArc: 有効な path を返し、内側が本塁のときは円弧を戻さない', () => {
  const band = padSector(-45, 45, 0.65, 0.86);
  assert.match(band, /^M[\d.]+,[\d.]+ A/);
  assert.equal((band.match(/A/g) || []).length, 2, '内外2本の円弧');
  // 内側が本塁(半径0)のくさびは、戻りが直線1本になる
  const wedge = padSector(-9, 9, 0, 1);
  assert.equal((wedge.match(/A/g) || []).length, 1, '外周だけ円弧');
  assert.match(padArc(-45, 45, 0.79), /^M[\d.]+,[\d.]+ A[\d.]+,[\d.]+ 0 0 1 [\d.]+,[\d.]+$/);
  assert.ok(!/NaN/.test(band + wedge + padArc(-45, 45, 1.18)));
});

test('zoneCounts: 角度と深さで区画に振り分け、古い記録も同じ図に入る', () => {
  const rows = [
    { hitAngle: -30, hitDepth: 0.95 }, // 左の深い
    { hitAngle: -30, hitDepth: 0.92 }, // 同じ区画
    { hitAngle: 0, hitDepth: 0.3 },    // 中の内野
    { direction: 'SS' },               // 深さなし → 守備位置から
    { direction: null },               // 図に置けない
  ];
  const { counts, placed } = zoneCounts(rows);
  assert.equal(placed, 4);
  assert.equal(counts.reduce((a, b) => a + b, 0), 4);
  assert.equal(counts[zoneOf(-30, 0.95)], 2);
  assert.ok(counts[zoneOf(0, 0.3)] >= 1);
});

test('aggregateBatting: ハードヒット率の分母は「強さを記録した打球」だけ', () => {
  const g = {
    atBats: [
      { playerId: 'p1', result: 'single', contact: 'hard' },
      { playerId: 'p1', result: 'out', contact: 'hard' },
      { playerId: 'p1', result: 'out', contact: 'weak' },
      { playerId: 'p1', result: 'out', contact: null },   // 未記録は分母に入れない
      { playerId: 'p1', result: 'so', contact: 'hard' },  // 三振はバットに当たっていない
      { playerId: 'p1', result: 'bb' },
    ],
  };
  const s = aggregateBatting([g]).p1;
  assert.equal(s.battedBalls, 4);      // 三振と四球は打球ではない
  assert.equal(s.contactRecorded, 3);  // 強さが入っているのは3打球
  assert.equal(s.hardHit, 2);
  assert.equal(s.weakHit, 1);
  const m = battingMetrics(s);
  assert.equal(m.hardHit.toFixed(3), '0.667');
});

test('battingMetrics: 強さの記録が1つも無ければ 0% ではなく null', () => {
  const g = { atBats: [{ playerId: 'p1', result: 'single' }, { playerId: 'p1', result: 'out' }] };
  const s = aggregateBatting([g]).p1;
  assert.equal(s.battedBalls, 2);
  assert.equal(s.contactRecorded, 0);
  assert.equal(battingMetrics(s).hardHit, null);
});

test('parseUtterance: 「レフト前にボテボテのゴロ」で方向・軌道・強さが入る', () => {
  const top = parseUtterance('レフト前にボテボテのゴロでヒット')[0];
  assert.equal(top.result, 'single');
  assert.equal(top.direction, 'LF');
  assert.equal(top.outType, 'ground'); // ヒットでも軌道を捨てない
  assert.equal(top.contact, 'weak');
});
test('parseUtterance: 「痛烈なライナー」は強い打球として拾う', () => {
  const top = parseUtterance('センターへ痛烈なライナーでヒット')[0];
  assert.equal(top.contact, 'hard');
  assert.equal(top.outType, 'liner');
});
test('parseUtterance: 強さを言わなければ未記録(平凡を勝手に入れない)', () => {
  assert.equal(parseUtterance('ライト前ヒット')[0].contact, null);
});

// ---- correctionParser: 打球の強さもあとから直せる ----
test('parseContact: 言い直しからも強さを読む(言われなければ未記録)', () => {
  assert.equal(parseContact('痛烈な当たりでした'), 'hard');
  assert.equal(parseContact('ボテボテのゴロ'), 'weak');
  assert.equal(parseContact('レフト前ヒット'), null);
});

test('parseResultCorrections: 強さだけの訂正は、結果に触れず強さだけ直す', () => {
  const players = [{ id: 'p1', name: '中島' }];
  const r = parseResultCorrections('中島の7回の当たりは痛烈に修正してください', players);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].patch, { contact: 'hard' });   // 結果も方向も触らない
  assert.equal(r[0].inning, 7);
  assert.equal(r[0].batterId, 'p1');
});

test('parseResultCorrections: 結果と強さを一度に直せる', () => {
  const players = [{ id: 'p1', name: '山田' }];
  const r = parseResultCorrections('山田の3回はボテボテのゴロに修正', players);
  assert.equal(r[0].patch.result, 'out');
  assert.equal(r[0].patch.outType, 'ground');
  assert.equal(r[0].patch.contact, 'weak');
});

test('parseResultCorrections: 強さを言っていない訂正では、強さの項目を送らない', () => {
  const players = [{ id: 'p1', name: '山田' }];
  const r = parseResultCorrections('山田の3回はセンター前ヒットに修正', players);
  // patch に contact が入ると、記録済みの強さを消してしまう
  assert.equal('contact' in r[0].patch, false);
});

test('parseResultCorrections: 三振に直すときは軌道と打点座標を消す(打球ではない)', () => {
  const players = [{ id: 'p1', name: '山田' }];
  const r = parseResultCorrections('山田の3回は三振に修正', players);
  assert.equal(r[0].patch.result, 'so');
  assert.deepEqual(
    [r[0].patch.outType, r[0].patch.contact, r[0].patch.hitAngle, r[0].patch.hitDepth],
    [null, null, null, null],
  );
});

test('playLabel: ファウルフライはログの1行でフェアと区別できる', () => {
  const foul = { hitAngle: -62 };
  assert.equal(playLabel('out', 'LF', 'fly', null, undefined, 'ja'), '左翼フライ・アウト');
  assert.equal(playLabel('out', 'LF', 'fly', null, undefined, 'ja', foul), '左翼フライ(ファウル)・アウト');
  assert.equal(playLabel('out', 'LF', 'fly', null, undefined, 'en', foul), 'LF Fly Out (foul)');
  // フェアの角度や、角度を持たない古い記録は今までどおり
  assert.equal(playLabel('out', 'LF', 'fly', null, undefined, 'ja', { hitAngle: -30 }), '左翼フライ・アウト');
  assert.equal(playLabel('out', 'LF', 'fly', null, undefined, 'ja', {}), '左翼フライ・アウト');
  // 三振には打球が無いので、うっかり角度が残っていても足さない
  assert.equal(playLabel('so', null, null, 'swinging', undefined, 'ja', foul), '空振り三振');
});

// ---- 守備位置(主・可) ----
test('playablePosition: 主と可を区別する。登録の無い位置は守れない', () => {
  const p = { position: '遊', subPositions: ['二', '三'] };
  assert.equal(playablePosition(p, '遊'), 'main');
  assert.equal(playablePosition(p, '二'), 'sub');
  assert.equal(playablePosition(p, '捕'), null);
  // 未登録の選手はどこも守れない扱い(AIには「守備位置の登録なし」と伝える)
  assert.equal(playablePosition({ position: '', subPositions: [] }, '遊'), null);
  assert.equal(playablePosition(null, '遊'), null);
  assert.equal(playablePosition(p, ''), null);
  // 古い記録(subPositions が無い)でも落ちない
  assert.equal(playablePosition({ position: '捕' }, '捕'), 'main');
  assert.equal(playablePosition({ position: '捕' }, '一'), null);
});

test('newPlayer: 守備位置の初期値は未設定。既定で勝手にどこかを守れることにしない', () => {
  const p = newPlayer('テスト');
  assert.equal(p.position, '');
  assert.deepEqual(p.subPositions, []);
  // 渡せば入る。配列は複製する(呼び出し側の配列と繋がらない)
  const subs = ['一'];
  const q = newPlayer('テスト2', '9', { position: '遊', subPositions: subs });
  assert.equal(q.position, '遊');
  assert.deepEqual(q.subPositions, ['一']);
  subs.push('二');
  assert.deepEqual(q.subPositions, ['一'], '呼び出し側の配列を書き換えても影響されない');
});

test('positionCoverage / uncoveredPositions: 守れる人数を主と可で分けて数える', () => {
  const roster = [
    { position: '捕', subPositions: [] },
    { position: '遊', subPositions: ['二', '捕'] },
    { position: '二', subPositions: [] },
  ];
  const cov = positionCoverage(roster);
  assert.deepEqual(cov['捕'], { main: 1, sub: 1, total: 2 });
  assert.deepEqual(cov['遊'], { main: 1, sub: 0, total: 1 });
  assert.deepEqual(cov['投'], { main: 0, sub: 0, total: 0 });
  // 誰も守れない位置が分かる = そのままではスタメンが組めない
  const holes = uncoveredPositions(roster);
  assert.ok(holes.includes('投') && holes.includes('一') && holes.includes('三'));
  assert.ok(!holes.includes('捕') && !holes.includes('遊') && !holes.includes('二'));
  // 全員そろえば穴は無い
  assert.deepEqual(uncoveredPositions(FIELD_POSITIONS.map((x) => ({ position: x, subPositions: [] }))), []);
  assert.deepEqual(uncoveredPositions([]).length, FIELD_POSITIONS.length);
});

test('FIELD_POSITIONS: DH・打・控は選手の属性ではないので登録の対象にしない', () => {
  assert.equal(FIELD_POSITIONS.length, 9);
  for (const x of ['DH', '打', '控']) assert.ok(!FIELD_POSITIONS.includes(x), x);
});

// ---- 今日のメンバー ----
test('attendeesOf: 未設定と空配列は「全員」。決めていないことと0人は別物ではない', () => {
  const ps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(attendeesOf({ attendees: null }, ps).length, 3, '古い試合は全員が来ていた扱い');
  assert.equal(attendeesOf({ attendees: [] }, ps).length, 3, 'まだ決めていない状態も全員扱い');
  assert.equal(attendeesOf(undefined, ps).length, 3);
  assert.deepEqual(attendeesOf({ attendees: ['a', 'c'] }, ps).map((p) => p.id), ['a', 'c']);
  // 名簿から消えた選手IDが残っていても落ちない
  assert.deepEqual(attendeesOf({ attendees: ['a', 'zzz'] }, ps).map((p) => p.id), ['a']);
});

test('lastAttendees: 直近の試合の参加者を返す。デモ試合は引き継がない', () => {
  const games = [
    { id: 'g1', date: '2026-05-01', attendees: ['a'] },
    { id: 'g2', date: '2026-06-01', attendees: ['a', 'b'] },
    { id: 'g0', date: '2026-06-10', attendees: null },
  ];
  assert.deepEqual(lastAttendees(games), ['a', 'b']);
  // デモデータの顔ぶれを本番の既定にしない
  assert.deepEqual(lastAttendees([...games, { id: 'demo-1', date: '2026-07-01', attendees: ['z'] }]), ['a', 'b']);
  // まだ1試合も記録が無ければ null(呼び出し側は全員を既定にする)
  assert.equal(lastAttendees([]), null);
  assert.equal(lastAttendees([{ id: 'x', date: '2026-01-01', attendees: [] }]), null);
});

test('newGame: 参加メンバーは既定で未設定。勝手に全員を書き込まない', () => {
  assert.equal(newGame().attendees, null);
  const g = newGame({ attendees: ['a', 'b'] });
  assert.deepEqual(g.attendees, ['a', 'b']);
});

// ---- 打順の自動セット ----
test('autoLineupFrom: メインを優先し、埋まらない位置だけサブで埋める', () => {
  const ps = FIELD_POSITIONS.map((pos, i) => ({ id: `p${i}`, position: pos, subPositions: [] }));
  const { lineup, unfilled } = autoLineupFrom(ps);
  assert.equal(unfilled.length, 0);
  // 全員が自分のメインの位置に付く
  for (const row of lineup) {
    const p = ps.find((x) => x.id === row.playerId);
    assert.equal(row.position, p.position, `${row.playerId} はメインの位置に付く`);
  }
  assert.deepEqual(lineup.map((x) => x.order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('autoLineupFrom: 候補が1人しかいない位置を先に押さえる', () => {
  // 捕手を守れるのは1人だけ。その人を一塁に取られると捕手が空く
  const ps = [
    { id: 'only', position: '捕', subPositions: ['一'] },
    { id: 'x', position: '', subPositions: ['一'] },
  ];
  const { lineup } = autoLineupFrom(ps);
  const only = lineup.find((r) => r.playerId === 'only');
  assert.equal(only.position, '捕', '1人しか守れない位置を優先して埋める');
  assert.equal(lineup.find((r) => r.playerId === 'x').position, '一');
});

test('autoLineupFrom: 守れない位置は空けたまま返す(別の人で埋めない)', () => {
  const ps = [
    { id: 'a', position: '遊', subPositions: [] },
    { id: 'b', position: '', subPositions: [] },
  ];
  const { lineup, unfilled } = autoLineupFrom(ps);
  assert.ok(unfilled.includes('捕') && unfilled.includes('投'));
  assert.equal(lineup.find((r) => r.playerId === 'a').position, '遊');
  // 守備位置の登録が無い選手は控えに回る。勝手にどこかを守らせない
  assert.equal(lineup.find((r) => r.playerId === 'b').position, '控');
});

test('autoLineupFrom: 人数が多くても打順は9人まで', () => {
  const ps = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, position: FIELD_POSITIONS[i % 9], subPositions: [] }));
  assert.equal(autoLineupFrom(ps).lineup.length, 9);
  assert.equal(autoLineupFrom([]).lineup.length, 0);
});

// ---- サブの優先順 ----
test('subRank: サブは書かれている順が優先度。先頭が0(最優先)', () => {
  const p = { position: '遊', subPositions: ['二', '三', '一'] };
  assert.equal(subRank(p, '二'), 0);
  assert.equal(subRank(p, '三'), 1);
  assert.equal(subRank(p, '一'), 2);
  assert.equal(subRank(p, '捕'), -1, 'サブに無い位置は -1');
  assert.equal(subRank(p, '遊'), -1, 'メインはサブの順番には入らない');
  assert.equal(subRank({}, '二'), -1);
});

test('autoLineupFrom: 同じ位置を守れる者どうしなら、上位に置いている選手が入る', () => {
  // 2人とも 二 と 三 を守れる。違いは順番だけなので、順番がそのまま効く
  const ps = [
    { id: '二が上', position: '', subPositions: ['二', '三'] },
    { id: '三が上', position: '', subPositions: ['三', '二'] },
  ];
  const { lineup } = autoLineupFrom(ps);
  assert.equal(lineup.find((r) => r.playerId === '二が上').position, '二');
  assert.equal(lineup.find((r) => r.playerId === '三が上').position, '三');

  // 順番を入れ替えれば、入る位置も入れ替わる(順番が本当に効いている)
  const swapped = [
    { id: '二が上', position: '', subPositions: ['三', '二'] },
    { id: '三が上', position: '', subPositions: ['二', '三'] },
  ];
  const l2 = autoLineupFrom(swapped).lineup;
  assert.equal(l2.find((r) => r.playerId === '二が上').position, '三');
  assert.equal(l2.find((r) => r.playerId === '三が上').position, '二');
});

test('autoLineupFrom: 守備位置が埋まることは、サブの順番より優先される', () => {
  // 高 は 二 を1番目に置いているが、三 を守れるのは 高 だけ。
  // 高 を 二 に入れると 三 が空くので、順番より「両方埋まる」を採る
  const ps = [
    { id: '低', position: '', subPositions: ['左', '中', '二'] },
    { id: '高', position: '', subPositions: ['二', '三'] },
  ];
  const { lineup, unfilled } = autoLineupFrom(ps);
  assert.equal(lineup.find((r) => r.playerId === '高').position, '三');
  assert.equal(lineup.find((r) => r.playerId === '低').position, '二');
  assert.ok(!unfilled.includes('二') && !unfilled.includes('三'), '両方とも埋まる');
});

test('autoLineupFrom: メインはサブの順番より常に優先される', () => {
  const ps = [
    { id: 'メイン持ち', position: '二', subPositions: [] },
    { id: 'サブ最優先', position: '', subPositions: ['二'] },
  ];
  const { lineup } = autoLineupFrom(ps);
  assert.equal(lineup.find((r) => r.playerId === 'メイン持ち').position, '二');
});


// ============================================================
// 守備位置の入れ替え(⇄)を交代として読まない
//
// 実際に起きた事故の再現テスト。「3回：三塁 本郷 ⇄ 捕手 宇田川（守備交代のみ、
// 打順変更なし）」が「本郷(4番)が退いて宇田川が入る」と読まれ、3番の宇田川が
// 以後ずっと4番として扱われた。あわせて、箇条書き番号での寸断と
// 回の引き継ぎ崩れも同じ指示文で起きていた。
// ============================================================
const SWAP_PLAYERS = ['佑一朗', '入交', '宇田川', '本郷', '髙島', '茂木', '磯野', '奥田', '境貴仁', '助っ人A', '助っ人B', '助っ人C']
  .map((name, i) => ({ id: `sw${i}`, name }));
const swId = (name) => SWAP_PLAYERS.find((p) => p.name === name).id;
const SWAP_TEXT = `【スコア修正指示】
■守備交代
1. 3回：三塁 本郷 ⇄ 捕手 宇田川（守備交代のみ、打順変更なし）
2. 5回裏開始：投手 髙島 ⇄ 遊撃 茂木（打順変更なし、髙島は5番のまま遊撃）
3. 5回裏9番打者時：投手 茂木 ⇄ 三塁 宇田川（茂木→三塁、宇田川→投手）
4. 6回表：3番 宇田川 → 助っ人A（代打出場）
5. 6回裏：
投手 宇田川 → 助っ人A
三塁 茂木 → 助っ人B（打順6番を引き継ぎ）
中堅 佑一朗 → 助っ人C（守備交代、打順1番を引き継ぎ）`;

test('入れ替え(⇄)は交代にしない — 打順を奪わせない', () => {
  const subs = parseSubstitutions(SWAP_TEXT, SWAP_PLAYERS);
  // 本郷 が退いて 宇田川 が入る、という交代は作られてはいけない
  assert.ok(
    !subs.some((s) => s.outId === swId('本郷') && s.inId === swId('宇田川')),
    '⇄ が「本郷→宇田川」の交代になっている(打順が奪われる)',
  );
  // 髙島⇄茂木、茂木⇄宇田川 も同様に交代ではない
  assert.ok(!subs.some((s) => s.outId === swId('髙島') && s.inId === swId('茂木')));
  assert.ok(!subs.some((s) => s.outId === swId('茂木') && s.inId === swId('宇田川')));
});

test('入れ替え(⇄)は「双方の守備位置の変更」として読む', () => {
  const sw = parsePositionSwaps(SWAP_TEXT, SWAP_PLAYERS);
  const at = (inn, name) => sw.filter((x) => x.inning === inn && x.playerId === swId(name)).map((x) => x.position);
  // 書かれている位置は「今の位置」で、2人がそれを交換する
  assert.deepEqual(at(3, '本郷'), ['捕'], '本郷は3回から捕手');
  assert.deepEqual(at(3, '宇田川'), ['三'], '宇田川は3回から三塁');
  assert.deepEqual(at(5, '髙島'), ['遊'], '髙島は5回から遊撃');
  // 5回は2度入れ替えている(茂木: 遊→投→三)。両方の指示が残る
  assert.deepEqual(at(5, '茂木'), ['投', '三']);
  assert.deepEqual(at(5, '宇田川'), ['投']);
});

test('箇条書きの番号で文が寸断されない — 回が正しく付く', () => {
  const subs = parseSubstitutions(SWAP_TEXT, SWAP_PLAYERS);
  // 「5. 6回裏：」の下に並ぶ3件は、すべて6回でなければならない(以前は3回になっていた)
  const helpers = subs.filter((s) => [swId('助っ人A'), swId('助っ人B'), swId('助っ人C')].includes(s.inId));
  assert.ok(helpers.length >= 3, `助っ人の交代が3件以上取れる (${helpers.length}件)`);
  for (const s of helpers) assert.equal(s.inning, 6, `${s.inName} が ${s.inning}回になっている`);
});

test('代打は守備位置が書かれていなくても交代として読む', () => {
  const subs = parseSubstitutions('6回表：3番 宇田川 → 助っ人A（代打出場）', SWAP_PLAYERS);
  const ph = subs.find((s) => s.subKind === 'ph');
  assert.ok(ph, '代打が交代として取れていない');
  assert.equal(ph.inning, 6);
  assert.equal(ph.outId, swId('宇田川'));
  assert.equal(ph.inId, swId('助っ人A'));
});

test('keepsBattingOrder: 打順を動かさない指示を見分ける', () => {
  assert.ok(keepsBattingOrder(SWAP_TEXT, ['本郷', '宇田川']), '打順変更なし を読めていない');
  assert.ok(keepsBattingOrder(SWAP_TEXT, ['髙島', '茂木']));
  // 打順を引き継ぐ(=動かす)交代は対象外
  assert.ok(!keepsBattingOrder(SWAP_TEXT, ['佑一朗', '助っ人C']));
});

test('入れ替え文から守備陣形の重複が出ない', () => {
  const aligns = parseDefensiveAlignment(SWAP_TEXT, SWAP_PLAYERS);
  const keys = aligns.map((a) => `${a.inning}|${a.playerId}`);
  assert.equal(new Set(keys).size, keys.length, `同じ回・同じ選手が重複している: ${keys.join(', ')}`);
});


// ============================================================
// 指示していない操作を勝手に作らない
//
// 実際の指示文から、頼んでいない「打順スロットの打者訂正」が3件生まれていた。
// 投手成績の説明文と、打席の付け替えの説明文を、打者の訂正として読んでいたため。
// ============================================================
test('投手成績の説明を打者の訂正として読まない', () => {
  // 「8番打者まで」は相手打者のこと。自軍の8番の打席とは関係がない
  assert.deepEqual(parseSlotBatters('茂木 2/3回（5回裏、8番打者まで） 失点3 自責3', SWAP_PLAYERS), []);
  assert.deepEqual(parseSlotBatters('宇田川 1/3回（5回裏、9番打者） 失点0 自責0', SWAP_PLAYERS), []);
});

test('打席の付け替えの説明を打者の訂正として読まない', () => {
  // 「宇田川の記録を助っ人Aへ移す」指示。逆向きに「6回の3番は宇田川」を作ってはいけない
  assert.deepEqual(
    parseSlotBatters('3番 宇田川：6回「捕邪」・7回「中2」の記録を助っ人Aへ移動', SWAP_PLAYERS),
    [],
  );
});

test('交代の矢印(→)を打者の訂正として読まない', () => {
  assert.deepEqual(parseSlotBatters('6回表：3番 宇田川 → 助っ人A（代打出場）', SWAP_PLAYERS), []);
});

test('投球回の分数(2/3回)を回番号として拾わない', () => {
  // 「2/3回」の分母を3回と読み、5回の出来事が3回に付く事故が起きた
  assert.equal(stripInningFractions('茂木 2/3回（5回裏、8番打者まで）').includes('3回'), false);
  assert.deepEqual(parseInningRange('茂木 2/3回（5回裏、8番打者まで）'), { from: 5, to: 5 });
});

test('指示文から、頼んでいない打者訂正が1件も出ない', () => {
  assert.deepEqual(parseSlotBatters(SWAP_TEXT, SWAP_PLAYERS), []);
});

test('explicitOrderChange: 「交代」だけでは打順移動の根拠にしない', () => {
  // 交代=入る側が退く側の打順に入ること。出場中の選手の打順が動くことではない
  assert.equal(explicitOrderChange('3回 三塁 本郷 ⇄ 捕手 宇田川（守備交代のみ）', ['本郷', '宇田川']), false);
  assert.equal(explicitOrderChange('2回に6番の平川が奥田と交代', ['平川', '奥田']), false);
  // 記録側の打順が本当に間違っているときだけ
  assert.equal(explicitOrderChange('宇田川と本郷の打順が逆になっています', ['宇田川', '本郷']), true);
  assert.equal(explicitOrderChange('宇田川の打順を修正してください', ['宇田川']), true);
});


// ============================================================
// 回の途中の継投で、投手成績が正しく分かれる
//
// 「5回、8番の後に投手の茂木と三塁の宇田川が入れ替え」を、打順を動かさずに
// 反映しても、茂木(1〜8番)と宇田川(9番)に分かれなければならない。
// RETRO_POSITION は位置ログしか作らず、投手成績が分かれない穴があった。
// reducer は JSX 側にあるためここでは呼べない。同じ判定に使う
// rebuildPitchingStats に、生成されるはずのログ列を与えて検証する。
// ============================================================
test('回の途中の継投: 相手8番の後で投手成績が分かれる', () => {
  const OUTS = { 3: 1, 6: 1, 9: 1 }; // 茂木が2アウト、宇田川が1アウト
  const logs = [];
  logs.push({ id: 'pc1', gameId: 'g', inning: 5, isTop: false, kind: 'pitcher', text: '', payload: { in: '茂木', out: '髙島' } });
  for (let o = 1; o <= 8; o++) {
    logs.push({ id: `d${o}`, gameId: 'g', inning: 5, isTop: false, kind: 'defense', text: '',
      payload: { order: o, result: OUTS[o] ? 'out' : 'single', outsOnPlay: OUTS[o] || 0, runs: 0 } });
  }
  logs.push({ id: 'pc2', gameId: 'g', inning: 5, isTop: false, kind: 'pitcher', text: '', payload: { in: '宇田川', out: '茂木' } });
  logs.push({ id: 'd9', gameId: 'g', inning: 5, isTop: false, kind: 'defense', text: '',
    payload: { order: 9, result: 'out', outsOnPlay: 1, runs: 0 } });

  const game = {
    id: 'g', isHome: true, playLogs: logs, atBats: [], pitchingRecords: [],
    startingLineup: [{ order: 5, playerId: '髙島', position: '投' }],
    lineup: [{ order: 5, playerId: '髙島', position: '投' }],
  };
  const { records } = rebuildPitchingStats(game);
  const outsOf = (id) => records.find((r) => r.playerId === id)?.outsRecorded ?? null;
  assert.equal(outsOf('茂木'), 2, '茂木は2/3回（1〜8番）');
  assert.equal(outsOf('宇田川'), 1, '宇田川は1/3回（9番のみ）');
});


// ============================================================
// 試合中に変わるルール(タイブレーク・守備人数・全員打ち)
//
// 草野球では「人が帰って8人になる」「時間が押して延長はタイブレーク」が
// 試合の途中で起きる。宣言した回より前の記録には効かせてはいけない。
// ============================================================
test('rulesAtInning: 変更は指定した回から効き、前の回には効かない', () => {
  const game = {
    inning: 8,
    rules: { innings: 7, mercy: [], fieldCount: 9 },
    ruleChanges: [
      { id: 'c1', at: 2, fromInning: 6, patch: { fieldCount: 8 } },
      { id: 'c2', at: 3, fromInning: 8, patch: { tiebreak: { fromInning: 8, runners: '2', order: 'cont', outs: 0 } } },
    ],
  };
  assert.equal(fieldCountAt(game, 5), 9, '5回はまだ9人');
  assert.equal(fieldCountAt(game, 6), 8, '6回から8人');
  assert.equal(fieldCountAt(game, 7), 8, '以降も8人');
  assert.equal(isTiebreakInning(game, 7), false, '7回はタイブレークではない');
  assert.equal(isTiebreakInning(game, 8), true, '8回からタイブレーク');
  // 土台のルールは消えない
  assert.equal(rulesAtInning(game, 8).innings, 7);
  assert.equal(currentRules(game).fieldCount, 8);
});

test('rulesAtInning: 同じ項目を2度変えると後の回のものが勝つ', () => {
  const game = {
    inning: 9,
    rules: { fieldCount: 9 },
    ruleChanges: [
      { id: 'a', at: 1, fromInning: 3, patch: { fieldCount: 8 } },
      { id: 'b', at: 2, fromInning: 6, patch: { fieldCount: 9 } },
    ],
  };
  assert.equal(fieldCountAt(game, 2), 9);
  assert.equal(fieldCountAt(game, 3), 8);
  assert.equal(fieldCountAt(game, 6), 9, '6回で9人に戻る');
});

test('rulesAtInning: 変更が無い試合・旧データでも壊れない', () => {
  assert.equal(fieldCountAt({}, 3), 9);
  assert.equal(fieldCountAt({ rules: { innings: 7 } }, 3), 9);
  assert.equal(isTiebreakInning({}, 9), false);
  assert.equal(rulesAtInning(null, 1), null);
});

test('diffLiveRules: 変わった項目だけを取り出す', () => {
  const prev = { fieldCount: 9, tiebreak: null, allBat: null };
  assert.deepEqual(diffLiveRules(prev, { ...prev }), {}, '同じなら空');
  assert.deepEqual(diffLiveRules(prev, { ...prev, fieldCount: 8 }), { fieldCount: 8 });
  const tb = { fromInning: 8, runners: '2', order: 'cont', outs: 0 };
  assert.deepEqual(diffLiveRules(prev, { ...prev, tiebreak: tb }), { tiebreak: tb });
  // 走者だけ変えても差分になる
  assert.deepEqual(
    diffLiveRules({ ...prev, tiebreak: tb }, { ...prev, tiebreak: { ...tb, runners: '12' } }),
    { tiebreak: { ...tb, runners: '12' } },
  );
  // やめたときは null
  assert.deepEqual(diffLiveRules({ ...prev, allBat: { size: 12 } }, prev), { allBat: null });
});

test('describeRulePatch: 履歴の1行', () => {
  assert.match(describeRulePatch({ fieldCount: 8 }), /守備 8人/);
  assert.match(describeRulePatch({ fieldCount: 9 }), /9人に戻した/);
  assert.match(describeRulePatch({ allBat: { size: 12 } }), /全員打ち 12人/);
  assert.match(describeRulePatch({ allBat: null }), /やめた/);
  assert.match(describeRulePatch({ tiebreak: { fromInning: 8, runners: '12', order: 'top', outs: 0 } }), /一・二塁.*先頭/);
  assert.match(describeRulePatch({ fieldCount: 8 }, 'en'), /8 fielders/);
});

test('runnersPlaced: 置く走者の人数', () => {
  assert.equal(runnersPlaced('2'), 1);
  assert.equal(runnersPlaced('12'), 2);
  assert.equal(runnersPlaced('23'), 2);
  assert.equal(runnersPlaced('123'), 3, '満塁は3人');
});

test('タイブレークの選択肢: 満塁とアウトカウント', () => {
  // 中学は満塁、一部アマチュアは1アウト満塁もある
  assert.ok(TIEBREAK_RUNNERS.includes('123'), '満塁が選べる');
  assert.equal(DEFAULT_TIEBREAK.runners, '12', '既定は一・二塁');
  assert.equal(DEFAULT_TIEBREAK.outs, 0, '既定はノーアウト');
  assert.equal(ALL_BAT_MAX, 18, '全員打ちは18人まで');
  assert.match(describeRulePatch({ tiebreak: { fromInning: 8, runners: '123', order: 'cont', outs: 1 } }), /ワンアウト満塁/);
  assert.match(describeRulePatch({ tiebreak: { fromInning: 8, runners: '12', order: 'cont', outs: 0 } }), /ノーアウト一・二塁/);
});

test('diffLiveRules: アウトカウントだけ変えても差分になる', () => {
  const prev = { fieldCount: 9, tiebreak: { fromInning: 8, runners: '12', order: 'cont', outs: 0 }, allBat: null };
  const next = { ...prev, tiebreak: { ...prev.tiebreak, outs: 1 } };
  assert.deepEqual(Object.keys(diffLiveRules(prev, next)), ['tiebreak']);
  // キーの並びが違うだけなら差分ではない
  const reordered = { ...prev, tiebreak: { outs: 0, order: 'cont', runners: '12', fromInning: 8 } };
  assert.deepEqual(diffLiveRules(prev, reordered), {});
});

// ---- 守備位置の警告を、宣言した人数に合わせて止める ----
// 打順9人・守備8人(遊撃が居ない)の布陣を、6回から8人と宣言した試合で作る。
function eightManGame(ruleChanges) {
  const POS = ['投', '捕', '一', '二', '三', '左', '中', '右'];
  const startingLineup = POS.map((position, i) => ({ order: i + 1, playerId: 'p' + i, position }));
  startingLineup.push({ order: 9, playerId: 'p8', position: '控' });
  return {
    id: 'g', isHome: true, atBats: [], pitchingRecords: [], startingLineup,
    lineup: startingLineup.map((l) => ({ ...l })),
    playLogs: [1, 2, 3, 4, 5, 6, 7].map((inning) => ({
      id: 'a' + inning, gameId: 'g', inning, isTop: true, kind: 'atbat', text: '',
      payload: { order: 1, playerId: 'p0', result: 'out' },
    })),
    rules: { fieldCount: 9 },
    ruleChanges,
  };
}

test('守備人数を宣言すると「守る人が居ない」警告が止まる', () => {
  // 宣言なし: 遊撃が不在という警告が出る(9人の布陣とみなされる)
  const before = findPositionIssues(eightManGame([]));
  assert.ok(before.missing.some((m) => m.position === '遊'), '宣言前は遊撃不在の警告が出る');
  // 6回から8人と宣言: 6回以降は出ないが、5回までは残る
  const after = findPositionIssues(eightManGame([{ id: 'c', at: 1, fromInning: 6, patch: { fieldCount: 8 } }]));
  const ss = after.missing.filter((m) => m.position === '遊');
  assert.ok(ss.length, '宣言より前の回の警告は残る');
  assert.ok(ss.every((m) => m.to <= 5), `6回以降に警告が残っている: ${JSON.stringify(ss)}`);
});

test('10人守備を宣言すると「同じ位置に2人」警告が止まる', () => {
  const POS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
  const mk = (ruleChanges) => {
    const startingLineup = POS.map((position, i) => ({ order: i + 1, playerId: 'p' + i, position }));
    startingLineup.push({ order: 10, playerId: 'p9', position: '中' }); // 4外野
    return {
      id: 'g', isHome: true, atBats: [], pitchingRecords: [], startingLineup,
      lineup: startingLineup.map((l) => ({ ...l })),
      playLogs: [{ id: 'a1', gameId: 'g', inning: 1, isTop: true, kind: 'atbat', text: '', payload: { order: 1, playerId: 'p0', result: 'out' } }],
      rules: { fieldCount: 9 }, ruleChanges,
    };
  };
  assert.ok(findPositionIssues(mk([])).duplicates.length, '宣言前は重複の警告が出る');
  assert.equal(
    findPositionIssues(mk([{ id: 'c', at: 1, fromInning: 1, patch: { fieldCount: 10 } }])).duplicates.length, 0,
    '10人守備を宣言したら重複の警告は出ない',
  );
});

test('全員打ち(12人打順)でも守備位置の不在警告が出ない', () => {
  const POS = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
  const startingLineup = POS.map((position, i) => ({ order: i + 1, playerId: 'p' + i, position }));
  for (let i = 0; i < 3; i++) startingLineup.push({ order: 10 + i, playerId: 'b' + i, position: '打' });
  const game = {
    id: 'g', isHome: true, atBats: [], pitchingRecords: [], startingLineup,
    lineup: startingLineup.map((l) => ({ ...l })),
    playLogs: [{ id: 'a1', gameId: 'g', inning: 1, isTop: true, kind: 'atbat', text: '', payload: { order: 1, playerId: 'p0', result: 'out' } }],
    rules: { fieldCount: 9, allBat: { size: 12 } }, ruleChanges: [],
  };
  const issues = findPositionIssues(game);
  assert.equal(issues.missing.length, 0, '守備は9つ埋まっているので不在は無い');
  assert.equal(issues.duplicates.length, 0, '「打」は重複として見ない');
});

// ---- タイブレークの自責点 ----
// 8回に3失点。うち置いた走者(二塁=1人)ぶんは自責点から外れる。
test('タイブレークの回は、置いた走者ぶんが自責点から外れる', () => {
  const mk = (ruleChanges) => ({
    id: 'g', isHome: true, atBats: [], pitchingRecords: [],
    startingLineup: [{ order: 1, playerId: 'P', position: '投' }],
    lineup: [{ order: 1, playerId: 'P', position: '投' }],
    playLogs: [
      { id: 'd1', gameId: 'g', inning: 8, isTop: true, kind: 'defense', text: '', payload: { order: 1, result: 'single', runs: 2, outsOnPlay: 0 } },
      { id: 'd2', gameId: 'g', inning: 8, isTop: true, kind: 'defense', text: '', payload: { order: 2, result: 'out', runs: 1, outsOnPlay: 3 } },
    ],
    rules: {}, ruleChanges,
  });
  const plain = rebuildPitchingStats(mk([])).records[0];
  assert.equal(plain.runs, 3);
  assert.equal(plain.earnedRuns, 3, '宣言前は失点=自責点');

  const tb = rebuildPitchingStats(mk([{ id: 'c', at: 1, fromInning: 8, patch: { tiebreak: { fromInning: 8, runners: '2', order: 'cont', outs: 0 } } }]));
  const rec = tb.records[0];
  assert.equal(rec.runs, 3, '失点は変わらない');
  assert.equal(rec.earnedRuns, 2, '置いた走者1人ぶんが自責点から外れる');
  assert.equal(tb.unearnedExcluded, 1);

  // 満塁なら3人ぶん。3失点すべてが自責点から外れる
  const loaded = rebuildPitchingStats(mk([{ id: 'c', at: 1, fromInning: 8, patch: { tiebreak: { fromInning: 8, runners: '123', order: 'cont', outs: 1 } } }]));
  assert.equal(loaded.records[0].runs, 3);
  assert.equal(loaded.records[0].earnedRuns, 0, '満塁は置いた走者3人ぶん');
});

// 置いた走者が塁上でアウトになると見立てが外れる。半回ごとに実数を入れて上書きできる。
test('タイブレーク: 置いた走者が何人還ったかを人が入れられる', () => {
  const mk = (scored) => ({
    id: 'g', isHome: true, atBats: [], pitchingRecords: [],
    startingLineup: [{ order: 1, playerId: 'P', position: '投' }],
    lineup: [{ order: 1, playerId: 'P', position: '投' }],
    playLogs: [
      { id: 'd1', gameId: 'g', inning: 8, isTop: true, kind: 'defense', text: '', payload: { order: 1, result: 'single', runs: 2, outsOnPlay: 0 } },
      { id: 'd2', gameId: 'g', inning: 8, isTop: true, kind: 'defense', text: '', payload: { order: 2, result: 'out', runs: 1, outsOnPlay: 3 } },
    ],
    rules: {}, tiebreakScored: scored,
    ruleChanges: [{ id: 'c', at: 1, fromInning: 8, patch: { tiebreak: { fromInning: 8, runners: '12', order: 'cont', outs: 0 } } }],
  });
  // 見立てのまま: 2人置いたので先の2点が自責点から外れる
  assert.equal(rebuildPitchingStats(mk(undefined)).records[0].earnedRuns, 1);
  // 置いた走者は1人しか還らなかった(もう1人は塁上でアウト)
  assert.equal(rebuildPitchingStats(mk({ '8T': 1 })).records[0].earnedRuns, 2);
  // 誰も還らなかった → 3点すべて自責点
  assert.equal(rebuildPitchingStats(mk({ '8T': 0 })).records[0].earnedRuns, 3);
  // 置いた人数を超える値は置いた人数で頭打ち
  assert.equal(rebuildPitchingStats(mk({ '8T': 9 })).records[0].earnedRuns, 1);
  // 別の半回の指定は効かない
  assert.equal(rebuildPitchingStats(mk({ '8B': 0 })).records[0].earnedRuns, 1);
  // 失点はどの場合も変わらない
  assert.equal(rebuildPitchingStats(mk({ '8T': 0 })).records[0].runs, 3);
});

test('halfKeyOf / placedRunsScored', () => {
  assert.equal(halfKeyOf(8, true), '8T');
  assert.equal(halfKeyOf(8, false), '8B');
  const g = { tiebreakScored: { '8T': 0, '9B': 2 } };
  assert.equal(placedRunsScored(g, 8, true), 0, '0は「見立てに任せる」ではなく「0人還った」');
  assert.equal(placedRunsScored(g, 9, false), 2);
  assert.equal(placedRunsScored(g, 7, true), null, '入れていなければ null');
  assert.equal(placedRunsScored({}, 8, true), null);
});

test('タイブレークでも、宣言した回より前は自責点が変わらない', () => {
  const logs = [7, 8].map((inning) => ({
    id: 'd' + inning, gameId: 'g', inning, isTop: true, kind: 'defense', text: '',
    payload: { order: 1, result: 'single', runs: 2, outsOnPlay: 3 },
  }));
  const game = {
    id: 'g', isHome: true, atBats: [], pitchingRecords: [], playLogs: logs,
    startingLineup: [{ order: 1, playerId: 'P', position: '投' }],
    lineup: [{ order: 1, playerId: 'P', position: '投' }],
    rules: {},
    ruleChanges: [{ id: 'c', at: 1, fromInning: 8, patch: { tiebreak: { fromInning: 8, runners: '23', order: 'top', outs: 0 } } }],
  };
  const rec = rebuildPitchingStats(game).records[0];
  assert.equal(rec.runs, 4);
  // 7回は2点とも自責、8回は2点のうち走者2人ぶんが外れて0
  assert.equal(rec.earnedRuns, 2);
});


// ============================================================
// 全員打ち: 宣言した人数ぶんの打順が組めること
//
// 「全員打ち18人」と宣言しても打順が9人のままなら、ルールは何も起きていないのと同じ。
// 打順を組む側が9人固定だったので、宣言が効いていなかった。
// ============================================================
test('allBatSize: 宣言した打順の人数', () => {
  assert.equal(allBatSize({}), 9, '宣言が無ければ9');
  assert.equal(allBatSize({ rules: { allBat: { size: 12 } }, inning: 1 }), 12);
  // 試合中に宣言した分も見る
  assert.equal(allBatSize({
    inning: 5, rules: {},
    ruleChanges: [{ id: 'a', at: 1, fromInning: 3, patch: { allBat: { size: 14 } } }],
  }), 14);
  // 9以下の指定は打順を縮めない
  assert.equal(allBatSize({ rules: { allBat: { size: 8 } } }), 9);
});

test('lineupSlotsFor: 来ている人数を超えては組めない', () => {
  const g = { rules: { allBat: { size: 18 } }, inning: 1 };
  assert.equal(lineupSlotsFor(g, 12), 12, '18人と宣言しても12人しか来ていなければ12人打順');
  assert.equal(lineupSlotsFor(g, 20), 18, '宣言した人数が上限');
  assert.equal(lineupSlotsFor(g, 5), 9, '9人は下回らない');
  assert.equal(lineupSlotsFor({}, 12), 9, '宣言が無ければ9人打順のまま');
});

test('autoLineupFrom: 全員打ちでは9人を超えて組み、余った人は「打」', () => {
  // 守備位置を登録していない選手ばかりの名簿(草野球でよくある)
  const players = Array.from({ length: 12 }, (_, i) => newPlayer({ name: `P${i + 1}` }));
  const normal = autoLineupFrom(players);
  assert.equal(normal.lineup.length, 9, 'ふつうは9人打順');
  assert.ok(normal.lineup.every((l) => l.position !== '打'), 'ふつうの試合で「打」は作らない');

  const all = autoLineupFrom(players, { max: 12, benchPosition: '打' });
  assert.equal(all.lineup.length, 12, '全員打ちは12人打順');
  assert.deepEqual(all.lineup.map((l) => l.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(all.lineup.some((l) => l.position === '打'), '守備に付かない人は「打」');
  assert.equal(all.lineup.filter((l) => l.position === '控').length, 0, '全員打ちに「控」は出さない');

  // 来ている人数が宣言に満たなければ、その人数まで
  assert.equal(autoLineupFrom(players.slice(0, 10), { max: 12, benchPosition: '打' }).lineup.length, 10);
});


// ============================================================
// 試合の流れ(得点期待値ベース)
// ============================================================
// 打席ログを組み立てる小道具。beforeRunners/outsBefore は実際の記録と同じ形。
function paLog(i, { inning = 1, isTop = true, kind = 'atbat', r = [0,0,0], outs = 0, runs = 0 } = {}) {
  return {
    id: 'p' + i, gameId: 'g', inning, isTop, kind, text: '',
    payload: { beforeRunners: { 1: !!r[0], 2: !!r[1], 3: !!r[2] }, outsBefore: outs, runs },
  };
}

test('stateKey: 24状態のキー', () => {
  assert.equal(stateKey({ 1: false, 2: false, 3: false }, 0), '000|0');
  assert.equal(stateKey({ 1: true, 2: true, 3: false }, 1), '110|1');
  assert.equal(stateKey({ 1: true, 2: true, 3: true }, 2), '111|2');
  assert.equal(Object.keys(BASE_RE).length, 24, '基準表は24状態');
});

test('基準表: 走者が進むほど・アウトが少ないほど期待値が高い', () => {
  // 形が壊れていると、流れの符号が逆になる場面が出る
  for (const outs of [0, 1, 2]) {
    assert.ok(BASE_RE[`000|${outs}`] < BASE_RE[`100|${outs}`], `${outs}死: 走者なし < 一塁`);
    assert.ok(BASE_RE[`100|${outs}`] < BASE_RE[`010|${outs}`], `${outs}死: 一塁 < 二塁`);
    assert.ok(BASE_RE[`110|${outs}`] < BASE_RE[`111|${outs}`], `${outs}死: 一二塁 < 満塁`);
  }
  for (const st of ['000', '100', '010', '111']) {
    assert.ok(BASE_RE[`${st}|0`] > BASE_RE[`${st}|1`], `${st}: 無死 > 1死`);
    assert.ok(BASE_RE[`${st}|1`] > BASE_RE[`${st}|2`], `${st}: 1死 > 2死`);
  }
});

test('buildRunExpectancy: 自分たちの記録から作り、回数が少ないうちは基準表寄り', () => {
  // 無死走者なしから始まり、その回に3点入った半回を10回ぶん
  const logs = [];
  let i = 0;
  for (let inn = 1; inn <= 10; inn++) {
    logs.push(paLog(i++, { inning: inn, r: [0,0,0], outs: 0, runs: 3 }));
    logs.push(paLog(i++, { inning: inn, r: [0,0,0], outs: 1, runs: 0 }));
    logs.push(paLog(i++, { inning: inn, r: [0,0,0], outs: 2, runs: 0 }));
  }
  const { re, samples, total, ownShare, level } = buildRunExpectancy([{ id: 'g', playLogs: logs }]);
  assert.equal(samples.get('000|0'), 10, '回数を持っている');
  assert.equal(total, 30);
  // 自前は3.0だが10回しかないので、基準表(0.48)との間に来る
  const v = re.get('000|0');
  assert.ok(v > BASE_RE['000|0'] && v < 3.0, `寄せがかかる: ${v}`);
  assert.ok(ownShare > 0 && ownShare < 0.5, `まだ基準表の影響が大きい: ${ownShare}`);
  // 一度も起きていない状態は、水準を合わせた土台のまま
  // (基準表そのままではない。この記録は半回3点なので土台の高さが上がっている)
  assert.equal(Number(re.get('111|0').toFixed(3)), Number((BASE_RE['111|0'] * level).toFixed(3)));
  assert.ok(level > 1, `点が入る記録なので土台は上がる: ${level}`);
});

test('buildRunExpectancy: タイブレークの回は混ぜない', () => {
  const mk = (ruleChanges) => ({
    id: 'g', rules: {}, ruleChanges,
    playLogs: [paLog(1, { inning: 8, r: [1,1,0], outs: 0, runs: 2 })],
  });
  assert.equal(buildRunExpectancy([mk([])]).samples.get('110|0'), 1);
  // 8回からタイブレーク = 無死一二塁は置いた走者なので、状態の意味が違う
  const tb = [{ id: 'c', at: 1, fromInning: 8, patch: { tiebreak: { fromInning: 8, runners: '12', order: 'cont', outs: 0 } } }];
  assert.equal(buildRunExpectancy([mk(tb)]).samples.get('110|0'), 0, 'タイブレークの状態は数えない');
});

test('flowSeries: 打席の前後で動いた分を、自チームから見た向きに揃える', () => {
  const re = null; // 基準表で計算
  // 自チームの攻撃: 無死走者なし(0.48) → 単打で無死一塁(0.86)。得点0
  const g1 = { id: 'g', playLogs: [
    paLog(1, { kind: 'atbat', r: [0,0,0], outs: 0, runs: 0 }),
    paLog(2, { kind: 'atbat', r: [1,0,0], outs: 0, runs: 0 }),
  ] };
  const s1 = flowSeries(g1, re);
  assert.ok(s1[0].delta > 0, '自チームが出塁したらプラス');
  assert.equal(Number(s1[0].delta.toFixed(2)), Number((BASE_RE['100|0'] - BASE_RE['000|0']).toFixed(2)));

  // 同じ動きでも守備側なら符号が反転する
  const g2 = { id: 'g', playLogs: [
    paLog(1, { kind: 'defense', r: [0,0,0], outs: 0, runs: 0 }),
    paLog(2, { kind: 'defense', r: [1,0,0], outs: 0, runs: 0 }),
  ] };
  assert.ok(flowSeries(g2, re)[0].delta < 0, '相手が出塁したらマイナス');

  // 得点は動きに足される
  const g3 = { id: 'g', playLogs: [
    paLog(1, { kind: 'atbat', r: [0,1,0], outs: 0, runs: 1 }),
    paLog(2, { kind: 'atbat', r: [0,0,0], outs: 0, runs: 0 }),
  ] };
  const s3 = flowSeries(g3, re);
  assert.equal(Number(s3[0].delta.toFixed(2)),
    Number((BASE_RE['000|0'] + 1 - BASE_RE['010|0']).toFixed(2)), '得点ぶんが乗る');

  // 積み上げ
  assert.equal(Number(s1[s1.length - 1].cum.toFixed(3)),
    Number(s1.reduce((t, x) => t + x.delta, 0).toFixed(3)));
});

test('flowSeries: 回が終わったら打席後の期待値は0', () => {
  // 2死走者なしで凡退 → 次の打席が無い = 回が終わった
  const g = { id: 'g', playLogs: [paLog(1, { kind: 'atbat', r: [0,0,0], outs: 2, runs: 0 })] };
  const s = flowSeries(g, null);
  assert.equal(Number(s[0].delta.toFixed(2)), Number((0 - BASE_RE['000|2']).toFixed(2)));
  assert.ok(s[0].delta < 0, '回が終わればマイナス');
});

test('flowRuns: 同じ向きに続いた区間をまとめる', () => {
  const series = [
    { id: 'a', delta: 0.4 }, { id: 'b', delta: 0.5 },   // 続けてプラス = 0.9
    { id: 'c', delta: -0.8 }, { id: 'd', delta: -0.9 }, // 続けてマイナス = -1.7
    { id: 'e', delta: 0.1 },                             // 小さいので拾わない
  ];
  const runs = flowRuns(series, 0.6);
  assert.equal(runs.length, 2, `区間は2つ: ${JSON.stringify(runs.map((r) => r.swing))}`);
  assert.ok(Math.abs(runs[0].swing) > Math.abs(runs[1].swing), '大きい順');
  assert.equal(runs[0].dir, -1, '一番大きいのはマイナス側');
  assert.equal(runs[0].n, 2, '2打席ぶん');
});

test('judgeFlowTags: 一致ではなく順番で測る', () => {
  // 打席1で大きくプラスに動く。その「前」に押した=予兆、「後」に押した=反応
  const mk = (tagAt) => {
    const logs = [];
    if (tagAt === 'before') logs.push({ id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } });
    logs.push(paLog(1, { kind: 'atbat', r: [0,1,0], outs: 0, runs: 2 }));
    logs.push(paLog(2, { kind: 'atbat', r: [0,0,0], outs: 0, runs: 0 }));
    if (tagAt === 'after') logs.push({ id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } });
    return { id: 'g', playLogs: logs };
  };
  const before = mk('before');
  const jb = judgeFlowTags(before, flowSeries(before, null));
  assert.equal(jb.verdict.tag, 'pre', '動く前に押したら予兆');
  assert.equal(jb.counts.pre, 1);

  const after = mk('after');
  const ja = judgeFlowTags(after, flowSeries(after, null));
  assert.equal(ja.verdict.tag, 'post', '動いた後に押したら反応(なぞっただけ)');
  assert.equal(ja.hitRate, 0, '当てた数には入らない');
});

test('judgeFlowTags: 何も起きなければ空振り。押していない動きも数えておく', () => {
  const logs = [
    { id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } },
    paLog(1, { kind: 'atbat', r: [0,0,0], outs: 0, runs: 0 }),
    paLog(2, { kind: 'atbat', r: [0,0,0], outs: 1, runs: 0 }),
  ];
  const g = { id: 'g', playLogs: logs };
  const j = judgeFlowTags(g, flowSeries(g, null));
  assert.equal(j.verdict.tag, 'miss', '動かなければ空振り');
  assert.equal(j.hitRate, 0);

  // 押さずに大きく動いた試合 = 押せていた動きは0
  const g2 = { id: 'g', playLogs: [
    paLog(1, { kind: 'atbat', r: [0,1,0], outs: 0, runs: 3 }),
    paLog(2, { kind: 'atbat', r: [0,0,0], outs: 0, runs: 0 }),
  ] };
  const j2 = judgeFlowTags(g2, flowSeries(g2, null));
  assert.equal(j2.hitRate, null, '押していなければ当てた割合は出さない');
  assert.equal(j2.catchRate, 0, '動いたのに押していないので押せていた割合は0');
});

test('judgeFlowTags: 確度は押した回数が分母', () => {
  // 打席1で大きく動く試合。動く前に押す = そのぶんが点になる
  const mk = (tagAt) => {
    const logs = [];
    if (tagAt === 'before') logs.push({ id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } });
    logs.push(paLog(1, { kind: 'atbat', r: [0, 1, 0], outs: 0, runs: 2 }));
    logs.push(paLog(2, { kind: 'atbat', r: [0, 0, 0], outs: 0, runs: 0 }));
    if (tagAt === 'after') logs.push({ id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } });
    return { id: 'g', playLogs: logs };
  };
  const before = mk('before');
  const jb = judgeFlowTags(before, flowSeries(before, null));
  assert.equal(jb.verdict.tag, 'pre', '動く前に押していれば読めた');
  assert.equal(jb.hitRate, 1, '押した1回のうち1回読めた');
  assert.ok(jb.moves.tag.gain > 0, `どれだけ動いたかも残す: ${jb.moves.tag.gain}`);

});

test('judgeFlowTags: 後追いは読めたに入らない。押したあとに動いていても', () => {
  // 大きく動いた「後」に押し、そのあとにも少し動く形。
  // ここを読めた扱いにすると、走者一掃の直後に押すのがいちばん得になってしまう。
  const g = {
    id: 'g',
    playLogs: [
      { id: 'a', kind: 'atbat', inning: 1, isTop: true, payload: {} },
      { id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } },
      { id: 'b', kind: 'atbat', inning: 1, isTop: true, payload: {} },
    ],
  };
  const series = [
    { id: 'a', log: g.playLogs[0], mine: true, delta: 0.30, we: 0.80 },
    { id: 'b', log: g.playLogs[2], mine: true, delta: 0.10, we: 0.90 },
  ];
  series.start = 0.50;
  const j = judgeFlowTags(g, series, { minSwing: 0.12, reactSwing: 0.07 });
  assert.equal(j.verdict.tag, 'post', '押す前にもう動いていたので後追い');
  assert.equal(j.hitRate, 0, '読めたには入らない');
  assert.equal(j.moves.tag.gain, 0, '押したあとに10ポイント動いていても読めたことにしない');
  assert.equal(j.moves.tag.plays.length, 0, '中身も出さない');
});

test('judgeFlowTags: 動かなければ読めたに入らない', () => {
  const logs = [
    { id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } },
    paLog(1, { kind: 'atbat', r: [0, 0, 0], outs: 0, runs: 0 }),
    paLog(2, { kind: 'atbat', r: [0, 0, 0], outs: 1, runs: 0 }),
  ];
  const g = { id: 'g', playLogs: logs };
  const j = judgeFlowTags(g, flowSeries(g, null));
  assert.equal(j.verdict.tag, 'miss');
  assert.equal(j.hitRate, 0, '押した回数は分母に残るので、読めた割合が下がる');
  assert.equal(j.moves.tag.gain, 0);
});

test('judgeFlowTags: 勝率の線なら、押した時点と山の勝率が実際の値で返る', () => {
  // 勝率そのものを持つ線を渡す(画面はこちらで呼んでいる)
  const g = {
    id: 'g',
    playLogs: [
      { id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } },
      { id: 'a', kind: 'atbat', inning: 1, isTop: true, payload: {} },
      { id: 'b', kind: 'atbat', inning: 1, isTop: true, payload: {} },
      { id: 'c', kind: 'atbat', inning: 1, isTop: true, payload: {} },
    ],
  };
  const series = [
    { id: 'a', log: g.playLogs[1], mine: true, delta: 0.20, we: 0.70 },
    { id: 'b', log: g.playLogs[2], mine: true, delta: 0.10, we: 0.80 },
    { id: 'c', log: g.playLogs[3], mine: true, delta: -0.30, we: 0.50 },
  ];
  series.start = 0.50;
  const j = judgeFlowTags(g, series, { minSwing: 0.12, reactSwing: 0.07 });
  const mv = j.moves.tag;
  assert.equal(mv.weAt, 0.50, '押した時点は線の出発点');
  assert.ok(Math.abs(mv.wePeak - 0.80) < 1e-9, `山は実際にあった値: ${mv.wePeak}`);
  // 窓の端まで足すと 0.20+0.10-0.30 = 0 になってしまう。山で測る
  assert.ok(Math.abs(mv.gain - 0.30) < 1e-9, `動いたのは30ポイント: ${mv.gain}`);
  assert.equal(mv.plays.length, 2, '山までの打席だけを中身にする');
});

test('judgeFlowTags: 「流れ切れた」が読めたときは勝率が下がって出る', () => {
  // 符号を付けて足し上げていた頃、下がったのが正解でも「+25pt」と出ていた。
  // 起点と山をそのまま出せば、下がったことが数字のまま読める。
  const g = {
    id: 'g',
    playLogs: [
      { id: 'tag', kind: 'flow', inning: 5, isTop: false, payload: { dir: 'down' } },
      { id: 'a', kind: 'defense', inning: 5, isTop: false, payload: { result: 'single', runs: 2 } },
    ],
  };
  const series = [{ id: 'a', log: g.playLogs[1], mine: false, delta: -0.25, we: 0.35 }];
  series.start = 0.60;
  const j = judgeFlowTags(g, series, { minSwing: 0.12, reactSwing: 0.07 });
  assert.equal(j.verdict.tag, 'pre', '相手へ傾くのを先に読めた');
  const m = j.moves.tag;
  assert.equal(m.weAt, 0.60);
  assert.ok(Math.abs(m.wePeak - 0.35) < 1e-9, `山は下がった側: ${m.wePeak}`);
  assert.ok(m.wePeak < m.weAt, '読めた「流れ切れた」は勝率が下がって出る');
});

test('judgeFlowTags: 大きさは「読めた回数」で割る', () => {
  // 3回押して、読めたのは1回。その1回で勝率が30ポイント動いた。
  // 押した回数(3)で割ると10ptになり、「どれくらい当たるか」でも
  // 「当たるとどれくらい大きいか」でもない数になる。
  const logs = [];
  const series = [];
  let we = 0.50;
  const push = (id, delta) => {
    we += delta;
    logs.push({ id, kind: 'atbat', inning: 1, isTop: true, payload: {} });
    series.push({ id, log: logs[logs.length - 1], mine: true, delta, we });
  };
  logs.push({ id: 't1', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } });
  push('a', 0.30);           // t1 は読めた(+30)
  logs.push({ id: 't2', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } });
  push('b', 0.00);           // t2 は動かず
  logs.push({ id: 't3', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } });
  push('c', 0.00);           // t3 も動かず
  series.start = 0.50;

  const g = { id: 'g', playLogs: logs };
  const j = judgeFlowTags(g, series, { minSwing: 0.12, reactSwing: 0.07 });
  assert.equal(j.counts.pre, 1, '読めたのは1回');
  assert.equal(j.tags.length, 3, '押したのは3回');
  assert.ok(Math.abs(j.hitRate - 1 / 3) < 1e-9, `確度は 1/3: ${j.hitRate}`);
  assert.ok(Math.abs(j.avgMove - 0.30) < 1e-9, `大きさは読めた1回ぶん: ${j.avgMove}`);
  assert.ok(Math.abs(j.avgMove - j.points / j.tags.length) > 0.1,
    '押した回数で割った値とは別物であること');
});

test('judgeFlowTags: 一度も読めていなければ大きさは出さない', () => {
  // 0で埋めると「平均0ポイント」になり、実績が無いのに数字が立つ
  const logs = [
    { id: 'tag', kind: 'flow', inning: 1, isTop: true, payload: { dir: 'up' } },
    paLog(1, { kind: 'atbat', r: [0, 0, 0], outs: 0, runs: 0 }),
  ];
  const g = { id: 'g', playLogs: logs };
  const j = judgeFlowTags(g, flowSeries(g, null));
  assert.equal(j.hitRate, 0, '確度は0');
  assert.equal(j.avgMove, null, '大きさは「—」にできるよう null');
});

test('lineupFromPast: DHのオーダーを読み込んだらDH制も一緒に引き継ぐ', () => {
  // これが抜けていたのが不具合の本体。打順だけ写して useDH を false のままにすると、
  // 「投」の候補が打者一覧になり、打順の外に居る投手を選ぶ手段が無くなる。
  const past = {
    pitcherId: 'p10',
    lineup: [
      { order: 1, playerId: 'p1', position: '捕' },
      { order: 2, playerId: 'p2', position: '一' },
      { order: 3, playerId: 'p3', position: 'DH' },
    ],
  };
  const ids = ['p1', 'p2', 'p3', 'p10'];
  const r = lineupFromPast(past, ids);
  assert.equal(r.useDH, true, 'DHが居ればDH制として読み込む');
  assert.equal(r.pitcherId, 'p10', '打順外の投手も引き継ぐ');
  assert.equal(r.selected.length, 3);

  // DHが居なければ今までどおり
  const noDh = { lineup: [{ order: 1, playerId: 'p1', position: '投' }] };
  const r2 = lineupFromPast(noDh, ids);
  assert.equal(r2.useDH, false);
  assert.equal(r2.pitcherId, '', 'DHなしのときは打順内の「投」を使うので、ここは空');
});

test('lineupFromPast: 打順に居る人や今日居ない人を投手にはしない', () => {
  const ids = ['p1', 'p2', 'p3'];
  // 過去の投手が今日は来ていない
  const gone = {
    pitcherId: 'p99',
    lineup: [
      { order: 1, playerId: 'p1', position: '捕' },
      { order: 2, playerId: 'p2', position: 'DH' },
    ],
  };
  assert.equal(lineupFromPast(gone, ids).pitcherId, '', '今日居ない人は投手にしない');

  // 過去の投手が今日は打順に入っている(DH制では投手は打順外でなければならない)
  const inOrder = {
    pitcherId: 'p1',
    lineup: [
      { order: 1, playerId: 'p1', position: '捕' },
      { order: 2, playerId: 'p2', position: 'DH' },
    ],
  };
  assert.equal(lineupFromPast(inOrder, ids).pitcherId, '', '打順に入っている人は投手にしない');
  assert.equal(lineupFromPast(inOrder, ids).useDH, true, 'DH制であることは保つ');
});

test('movePlays: 攻撃中に押したか守備中に押したかで中身を分ける', () => {
  const pa = (kind, result, runs = 0) => ({
    mine: kind === 'atbat',
    log: { kind, payload: { result, runs } },
  });
  // 自軍の攻撃で動いた
  const off = movePlays([pa('atbat', 'single'), pa('atbat', 'bb'), pa('atbat', 'double', 2)]);
  assert.equal(off.hits, 2, '安打2');
  assert.equal(off.onBase, 3, '四球も出塁に入る');
  assert.equal(off.runs, 2);
  assert.equal(off.allowedHits, 0, '守備側の数字は動かない');

  // 相手を抑えて動いた。同じ「勝率が上がった」でも中身は違う
  const def = movePlays([pa('defense', 'so'), pa('defense', 'out'), pa('defense', 'single')]);
  assert.equal(def.outs, 2, '2人抑えた');
  assert.equal(def.allowedHits, 1);
  assert.equal(def.hits, 0, '自軍の安打にはしない');
});

test('formatRate: 打率と同じ書き方', () => {
  assert.equal(formatRate(1), '1.000');
  assert.equal(formatRate(0.5), '.500');
  assert.equal(formatRate(0), '.000');
  assert.equal(formatRate(null), '—');
});


// ============================================================
// 甲子園の実測値(明治大学 2018年度卒業研究 / 2015〜2017年 全144試合)
//
// 論文は戦術別(ヒッティング/盗塁/バント)の値しか出していないので、
// 同論文の実行回数で重みを付けて戦術によらない値に直している。
// その計算がずれていないことを、論文の数字そのものから確かめる。
// ============================================================
test('甲子園の実測4状況: 論文の表から重み付けした値と一致する', () => {
  // [ヒッティング n,値], [盗塁 n,値], [バント n,値] → 期待するキー
  const rows = [
    { key: '100|0', h: [351, 0.90], s: [56, 0.71], b: [363, 0.69] },
    { key: '110|0', h: [62, 1.24], s: [1, 1.00], b: [67, 1.09] },
    { key: '100|1', h: [481, 0.54], s: [74, 0.66], b: [74, 0.49] },
    { key: '110|1', h: [241, 0.92], s: [2, 1.00], b: [10, 0.30] },
  ];
  for (const r of rows) {
    const n = r.h[0] + r.s[0] + r.b[0];
    const want = (r.h[0] * r.h[1] + r.s[0] * r.s[1] + r.b[0] * r.b[1]) / n;
    assert.equal(KOSHIEN_RE[r.key], Number(want.toFixed(2)), `${r.key}: ${want.toFixed(3)}`);
  }
  assert.equal(Object.keys(KOSHIEN_RE).length, 4, '論文にあるのは4状況だけ');
});

test('KOSHIEN_LEVEL: 重なる4状況の水準比を、出現回数で重み付けして求めている', () => {
  // 状況ごとの比を単純平均すると、1回しか起きない場面と600回起きる場面が
  // 同じ重さになる。合計どうしの比にすることでそれを避けている
  let ko = 0;
  let npb = 0;
  for (const [key, w] of Object.entries(KOSHIEN_WEIGHTS)) {
    ko += KOSHIEN_RE[key] * w;
    npb += BASE_RE[key] * w;
  }
  assert.equal(Number(ko.toFixed(2)), 1332.75, '甲子園側の重み付き合計');
  assert.equal(Number(npb.toFixed(2)), 1166.85, 'NPB側の重み付き合計');
  assert.equal(Number(KOSHIEN_LEVEL.toFixed(3)), 1.142);
  // 4状況のうち3つは甲子園のほうが高く、無死一二塁だけ低い(バントが半分以上)
  assert.ok(KOSHIEN_RE['110|0'] < BASE_RE['110|0'], '無死一二塁だけNPBより低い');
});

test('baseReFor: ブカツは実測4状況＋残り20状況に水準補正、他のエディションには持ち込まない', () => {
  const bukatsu = baseReFor('ブカツ(中高大)');
  assert.equal(bukatsu['100|0'], 0.79, '実測のある状況は甲子園の値そのもの');
  assert.equal(Object.keys(bukatsu).length, 24, '24状態そろっている');
  // 実測が無い20状況は、NPB値に水準比をかけて表の中の水準をそろえる。
  // 4状況だけ差し替えて残りをNPBのままにすると、1つの表に水準が2つ同居する
  for (const key of Object.keys(BASE_RE)) {
    if (isKoshienMeasured(key)) continue;
    assert.equal(
      bukatsu[key], Number((BASE_RE[key] * KOSHIEN_LEVEL).toFixed(2)),
      `${key}: NPB値 × ${KOSHIEN_LEVEL.toFixed(3)}`,
    );
    assert.ok(bukatsu[key] >= BASE_RE[key], `${key}: 補正で下がることはない`);
  }
  // 草野球・少年野球は実測が公開されていないので、NPBの値をそのまま使う
  for (const ed of ['草野球', '少年野球', null, undefined]) {
    for (const key of ['100|0', '000|0', '111|2']) {
      assert.equal(baseReFor(ed)[key], BASE_RE[key], `${ed} には持ち込まない`);
    }
  }
});

test('baseReFor: 実測と補正を混ぜても表の形が壊れない', () => {
  // 走者が進むほど高い / アウトが増えるほど低い、が崩れると流れの符号が狂う。
  // 出どころが3つ(甲子園実測・NPB×補正・自チーム)混ざる表なので、24状況すべて見る
  const order = ['000', '100', '010', '110', '001', '101', '011', '111'];
  const under = { '000': [], '100': ['000'], '010': ['000'], '001': ['000'],
    '110': ['100', '010'], '101': ['100', '001'], '011': ['010', '001'],
    '111': ['110', '101', '011'] };
  for (const ed of ['ブカツ(中高大)', '草野球']) {
    const b = baseReFor(ed);
    for (const outs of [0, 1, 2]) {
      for (const st of order) {
        for (const lo of under[st]) {
          assert.ok(b[`${st}|${outs}`] >= b[`${lo}|${outs}`], `${ed} ${outs}死: ${lo} <= ${st}`);
        }
      }
    }
    for (const st of order) {
      assert.ok(b[`${st}|0`] > b[`${st}|1`], `${ed} ${st}: 無死 > 1死`);
      assert.ok(b[`${st}|1`] > b[`${st}|2`], `${ed} ${st}: 1死 > 2死`);
    }
  }
});

test('buildRunExpectancy: エディションごとに土台が変わる', () => {
  const empty = [{ id: 'g', playLogs: [] }];
  assert.equal(Number(buildRunExpectancy(empty, 'ブカツ(中高大)').re.get('100|0').toFixed(2)), 0.79);
  assert.equal(Number(buildRunExpectancy(empty, '草野球').re.get('100|0').toFixed(2)), BASE_RE['100|0']);
});


// ============================================================
// チーム力(順位表なしで読める指標)
// ============================================================
// 半回を組み立てる小道具。r=[一,二,三], o=アウト, res=結果, runs=その打席で入った点
function half(inning, isTop, kind, rows) {
  return rows.map((r, i) => ({
    id: `${kind}${inning}${isTop ? 'T' : 'B'}${i}`, gameId: 'g', inning, isTop, kind, text: '',
    payload: {
      beforeRunners: { 1: !!r.r[0], 2: !!r.r[1], 3: !!r.r[2] },
      outsBefore: r.o, result: r.res || 'out', runs: r.runs || 0,
    },
  }));
}
const rowOf = (rows, key) => rows.find((r) => r.key === key);

test('決定力: 場面どおりなら1.00前後、返せなければ下がる', () => {
  // 無死一塁(0.86)から2ランで返した = 場面以上
  const good = { id: 'g', playLogs: [
    ...half(1, true, 'atbat', [
      { r: [1,0,0], o: 0, res: 'hr', runs: 2 },
      { r: [0,0,0], o: 0, res: 'out' },
    ]),
  ] };
  const g1 = rowOf(teamPower([good]), 'off.conversion');
  assert.ok(g1.value > 1, `場面以上に返したので1.00超: ${g1.value}`);
  assert.equal(g1.n, 1, '走者が居た打席だけ数える(2打席目は走者なし)');

  // 無死一塁から、何も起きずに回が終わった = 好機を潰した
  const bad = { id: 'g', playLogs: [
    ...half(1, true, 'atbat', [{ r: [1,0,0], o: 0, res: 'out' }]),
  ] };
  const b1 = rowOf(teamPower([bad]), 'off.conversion');
  assert.equal(b1.value, 0, '回が終われば分子は0');

  // 走者を置いたまま回を終えた = 残塁。1.00を下回る
  const stranded = { id: 'g', playLogs: [
    ...half(1, true, 'atbat', [
      { r: [1,0,0], o: 0, res: 'single' },
      { r: [1,1,0], o: 0, res: 'out' },
    ]),
  ] };
  assert.ok(rowOf(teamPower([stranded]), 'off.conversion').value < 1, '残塁は1.00未満');
});

test('決定力: 走者が居ない打席は好機に数えない', () => {
  const g = { id: 'g', playLogs: [
    ...half(1, true, 'atbat', [{ r: [0,0,0], o: 0, res: 'out' }, { r: [0,0,0], o: 1, res: 'out' }]),
  ] };
  assert.equal(rowOf(teamPower([g]), 'off.conversion').n, 0, '走者なしは母数に入らない');
  assert.equal(rowOf(teamPower([g]), 'off.conversion').value, null, '母数0なら値を出さない');
});

test('火消し力: 止めたほうが高くなる向きに揃っている', () => {
  // 相手が無死一塁から2点returned = 火消しできていない
  const leaky = { id: 'g', playLogs: [
    ...half(1, true, 'defense', [{ r: [1,0,0], o: 0, res: 'double', runs: 2 }]),
  ] };
  // 相手が無死一塁から無得点で回が終わった = 止めた
  const tight = { id: 'g', playLogs: [
    ...half(1, true, 'defense', [{ r: [1,0,0], o: 2, res: 'out' }]),
  ] };
  const a = rowOf(teamPower([leaky]), 'def.conversion').value;
  const b = rowOf(teamPower([tight]), 'def.conversion').value;
  assert.ok(b > a, `止めたほうが高い: 止めた${b} > 止めない${a}`);
  // 完全に抑えた回でも値が出る(割り算が壊れない)ことが要点
  assert.equal(b, 2, '完全に抑えたら上限の2.00');
  assert.ok(a < 1, `場面以上に返されたら1.00未満: ${a}`);
});

test('火消し力: 相手が場面どおりなら1.00になる', () => {
  // 無死一塁(0.86)から、次が無死一二塁(1.44)…は場面以上。
  // 場面どおり = 打席後の期待値+得点が打席前と釣り合うケースを作る
  const g = { id: 'g', playLogs: [
    ...half(1, true, 'defense', [
      { r: [1,0,0], o: 0, res: 'out' },   // 0.86 → 次 100|1 = 0.51
      { r: [1,0,0], o: 1, res: 'out' },   // 0.51 → 次 100|2 = 0.22
      { r: [1,0,0], o: 2, res: 'out' },   // 0.22 → 回終わり 0
    ]),
  ] };
  const v = rowOf(teamPower([g]), 'def.conversion').value;
  assert.ok(v > 1, `三者凡退で走者を還さなければ1.00超: ${v}`);
  assert.ok(v <= 2, '上限は2.00');
});

test('先頭出塁率と先頭封じ率が鏡になっている', () => {
  const g = { id: 'g', playLogs: [
    ...half(1, true, 'atbat', [{ r: [0,0,0], o: 0, res: 'single' }]),   // 先頭出塁 ○
    ...half(2, true, 'atbat', [{ r: [0,0,0], o: 0, res: 'out' }]),      // ×
    ...half(1, false, 'defense', [{ r: [0,0,0], o: 0, res: 'single' }]),// 相手先頭に出塁された
    ...half(2, false, 'defense', [{ r: [0,0,0], o: 0, res: 'out' }]),   // 抑えた
  ] };
  const rows = teamPower([g]);
  assert.equal(rowOf(rows, 'off.leadoff').value, 0.5, '自チームは2回中1回出塁');
  assert.equal(rowOf(rows, 'def.leadoff').value, 0.5, '相手先頭は2回中1回抑えた');
  // 「抑えた」側を数えているので、出塁されるほど下がる
  const leaky = { id: 'g', playLogs: [
    ...half(1, false, 'defense', [{ r: [0,0,0], o: 0, res: 'single' }]),
    ...half(2, false, 'defense', [{ r: [0,0,0], o: 0, res: 'bb' }]),
  ] };
  assert.equal(rowOf(teamPower([leaky]), 'def.leadoff').value, 0, '毎回出塁されたら0');
});

test('畳みかけ率 / 立ち直り率', () => {
  const g = { id: 'g', playLogs: [
    // 攻撃: 1回に得点 → 2回も得点(畳みかけ成功) → 3回は無得点(失敗)
    ...half(1, true, 'atbat', [{ r: [0,1,0], o: 0, res: 'single', runs: 1 }]),
    ...half(2, true, 'atbat', [{ r: [0,1,0], o: 0, res: 'single', runs: 1 }]),
    ...half(3, true, 'atbat', [{ r: [0,0,0], o: 0, res: 'out' }]),
    // 守備: 1回に失点 → 2回は無失点(立ち直り成功) → 3回も無失点だが直前が無失点なので母数外
    ...half(1, false, 'defense', [{ r: [0,1,0], o: 0, res: 'single', runs: 1 }]),
    ...half(2, false, 'defense', [{ r: [0,0,0], o: 0, res: 'out' }]),
    ...half(3, false, 'defense', [{ r: [0,0,0], o: 0, res: 'out' }]),
  ] };
  const rows = teamPower([g]);
  const pile = rowOf(rows, 'off.pileOn');
  assert.equal(pile.n, 2, '得点した回の次だけが母数(1回の次と2回の次)');
  assert.equal(pile.hit, 1, '2回は得点、3回は無得点');
  const bounce = rowOf(rows, 'def.bounceBack');
  assert.equal(bounce.n, 1, '失点した回の次だけが母数');
  assert.equal(bounce.value, 1, '2回を無失点で抑えた');
});

test('二死からの得点率: 二死まで行った回だけを母数にする', () => {
  const g = { id: 'g', playLogs: [
    // 二死から得点
    ...half(1, true, 'atbat', [{ r: [0,1,0], o: 2, res: 'single', runs: 1 }]),
    // 二死まで行ったが無得点
    ...half(2, true, 'atbat', [{ r: [0,0,0], o: 2, res: 'out' }]),
    // 二死まで行っていない(母数外)
    ...half(3, true, 'atbat', [{ r: [0,0,0], o: 0, res: 'out' }]),
  ] };
  const r = rowOf(teamPower([g]), 'off.twoOut');
  assert.equal(r.n, 2, '二死まで行った2回だけ');
  assert.equal(r.value, 0.5);
});

test('タイブレークの回はチーム力に混ぜない', () => {
  const mk = (ruleChanges) => ({
    id: 'g', rules: {}, ruleChanges,
    playLogs: half(8, true, 'atbat', [{ r: [1,1,0], o: 0, res: 'single', runs: 1 }]),
  });
  assert.equal(rowOf(teamPower([mk([])]), 'off.conversion').n, 1);
  const tb = [{ id: 'c', at: 1, fromInning: 8, patch: { tiebreak: { fromInning: 8, runners: '12', order: 'cont', outs: 0 } } }];
  assert.equal(rowOf(teamPower([mk(tb)]), 'off.conversion').n, 0, '置いた走者は好機ではない');
});

test('mostOff: 回数が足りないものは前に出さない', () => {
  const rows = [
    { pair: 'conv', key: 'a', side: 'off', value: 0.10, n: 3, kind: 'index' },   // 大きくずれるが3回だけ
    { pair: 'conv', key: 'b', side: 'def', value: 0.80, n: 50, kind: 'index' },
    { pair: 'lead', key: 'c', side: 'off', value: 0.50, n: 40, kind: 'pct' },
    { pair: 'lead', key: 'd', side: 'def', value: 0.50, n: 40, kind: 'pct' },
  ];
  const top = mostOff(rows, { minSamples: 10, top: 3 });
  assert.ok(!top.some((r) => r.key === 'a'), '回数が少ないものは出さない');
  assert.equal(top[0].key, 'b', '1.00から一番離れているもの');
});

test('formatPower: 1.00基準は小数2桁、割合は打率表記', () => {
  assert.equal(formatPower({ value: 0.85, kind: 'index' }), '0.85');
  assert.equal(formatPower({ value: 0.5, kind: 'pct' }), '.500');
  assert.equal(formatPower({ value: 1, kind: 'pct' }), '1.000');
  assert.equal(formatPower({ value: null }), '—');
});


// ============================================================
// ラインスコア: 終わった半回は0点でも数字を出す
//
// linescore は点が入った回にしか作られない。エントリの有無だけで
// 判定していたので、無得点で終わった表が、裏に移っても空欄のままだった。
// ============================================================
test('halfPlayed: 表が終わって裏に移ったら、表は0点でも表示する', () => {
  const g = { inning: 3, isTop: false, linescore: { 1: { my: 0, opp: 0 }, 2: { my: 0, opp: 0 } } };
  assert.equal(halfPlayed(g, 3, 'away', 0), true, '3回表は終わっている(裏に移った)');
  assert.equal(halfPlayed(g, 3, 'home', 0), false, '3回裏は進行中なのでまだ');
  assert.equal(halfPlayed(g, 2, 'away', 0), true, '過ぎた回は両方とも出す');
  assert.equal(halfPlayed(g, 2, 'home', 0), true);
  assert.equal(halfPlayed(g, 4, 'away', 0), false, 'まだ来ていない回は空');
  assert.equal(halfPlayed(g, 4, 'home', 0), false);
});

test('halfPlayed: 表が進行中なら、まだどちらも出さない(点が入るまで)', () => {
  const g = { inning: 3, isTop: true };
  assert.equal(halfPlayed(g, 3, 'away', 0), false, '表が進行中で無得点なら空');
  assert.equal(halfPlayed(g, 3, 'home', 0), false, '裏はまだ始まっていない');
  // 表の途中で点が入れば、その時点で出す
  assert.equal(halfPlayed(g, 3, 'away', 2), true, '点が入れば途中でも出す');
});

test('halfPlayed: 表が点を取っても、進行中の裏は空のまま', () => {
  // 「その回に点が入ったか」で見ると、まだ戦っていない裏に0が出てしまう
  const g = { inning: 3, isTop: false };
  assert.equal(halfPlayed(g, 3, 'away', 1), true, '終わった表は出す');
  assert.equal(halfPlayed(g, 3, 'home', 0), false, '進行中の裏は、自分が点を取るまで空');
  assert.equal(halfPlayed(g, 3, 'home', 1), true, '裏が点を取れば出す');
});

test('halfPlayed: 試合終了時は打った半回を出す', () => {
  const top = { inning: 7, isTop: true, status: 'finished' };
  assert.equal(halfPlayed(top, 7, 'away', 0), true, '表で終わったら表は出す');
  assert.equal(halfPlayed(top, 7, 'home', 0), false, '裏を戦っていないので出さない');
  const bottom = { inning: 7, isTop: false, status: 'finished' };
  assert.equal(halfPlayed(bottom, 7, 'away', 0), true);
  assert.equal(halfPlayed(bottom, 7, 'home', 0), true, '裏まで終わったら両方出す');
});

test('halfPlayed: 旧データ・空のgameでも壊れない', () => {
  assert.equal(halfPlayed({}, 1, 'away', 0), false);
  assert.equal(halfPlayed({ inning: 2, isTop: false }, 1, 'home', 0), true);
});


// ============================================================
// 投手欄で選んだ投手が、守備位置の判定に反映されること
//
// 投手はスタメン表に「投」として載っているとは限らない。スコア入力画面の
// 投手欄で選んだだけだと打順の守備位置は空のままで、
// 「投手を守る人が居ません」と警告され続けていた。
// ============================================================
test('投手欄で選んだ投手を「投」として数える', () => {
  // 打順9人。投だけ空(スタメン登録時に投手を入れていない)
  const POS = ['捕', '一', '二', '三', '遊', '左', '中', '右', '控'];
  const startingLineup = POS.map((position, i) => ({ order: i + 1, playerId: 'p' + i, position }));
  const mk = (extra) => ({
    id: 'g', isHome: true, atBats: [], pitchingRecords: [], startingLineup,
    lineup: startingLineup.map((l) => ({ ...l })),
    playLogs: [
      ...[1, 2, 3, 4].map((inning) => ({
        id: 'a' + inning, gameId: 'g', inning, isTop: true, kind: 'atbat', text: '',
        payload: { order: 1, playerId: 'p0', result: 'out' },
      })),
      ...extra,
    ],
    rules: {}, ruleChanges: [],
  });

  // 投手を一度も選んでいなければ、不在の警告は正しい
  const none = findPositionIssues(mk([]));
  assert.ok(none.missing.some((m) => m.position === '投'), '投手が居なければ警告する');

  // 投手欄で「米原」を選んだ = kind:'pitcher' のログが残る
  const withP = findPositionIssues(mk([
    { id: 'pc', gameId: 'g', inning: 1, isTop: true, kind: 'pitcher', text: '', payload: { in: '米原', out: null } },
  ]));
  assert.equal(withP.missing.filter((m) => m.position === '投').length, 0,
    `投手を選んでいれば警告しない: ${JSON.stringify(withP.missing)}`);
  // 他の位置の判定は変わらない
  assert.equal(withP.duplicates.length, 0, '重複の警告は増えない');
});

test('打順に居る投手は、その枠が「投」になる', () => {
  const startingLineup = [
    { order: 1, playerId: '米原', position: '控' },
    ...['捕', '一', '二', '三', '遊', '左', '中', '右'].map((position, i) => ({ order: i + 2, playerId: 'p' + i, position })),
  ];
  const game = {
    id: 'g', isHome: true, atBats: [], pitchingRecords: [], startingLineup,
    lineup: startingLineup.map((l) => ({ ...l })),
    playLogs: [
      { id: 'pc', gameId: 'g', inning: 1, isTop: true, kind: 'pitcher', text: '', payload: { in: '米原', out: null } },
      { id: 'a1', gameId: 'g', inning: 1, isTop: true, kind: 'atbat', text: '', payload: { order: 1, playerId: '米原', result: 'out' } },
    ],
    rules: {}, ruleChanges: [],
  };
  const align = alignmentByInning(game).get(1);
  const mine = align.find((s) => s.playerId === '米原');
  assert.equal(mine.position, '投', '打順に居るなら新しい枠を作らずその枠を投にする');
  assert.equal(mine.order, 1, '打順は変わらない');
  assert.equal(align.filter((s) => s.position === '投').length, 1, '投が2つにならない');
});

test('すでに「投」に誰か就いていれば、投手欄の値で上書きしない', () => {
  const startingLineup = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右']
    .map((position, i) => ({ order: i + 1, playerId: 'p' + i, position }));
  const game = {
    id: 'g', isHome: true, atBats: [], pitchingRecords: [], startingLineup,
    lineup: startingLineup.map((l) => ({ ...l })),
    playLogs: [{ id: 'a1', gameId: 'g', inning: 1, isTop: true, kind: 'atbat', text: '', payload: { order: 1, playerId: 'p0', result: 'out' } }],
    rules: {}, ruleChanges: [],
  };
  const align = alignmentByInning(game).get(1);
  assert.equal(align.filter((s) => s.position === '投').length, 1, '記録どおり1人だけ');
  assert.equal(align.find((s) => s.position === '投').playerId, 'p0', 'スタメンの投手のまま');
});

test('継投すると、その回から投手が入れ替わる', () => {
  const startingLineup = ['捕', '一', '二', '三', '遊', '左', '中', '右', '控']
    .map((position, i) => ({ order: i + 1, playerId: 'p' + i, position }));
  const game = {
    id: 'g', isHome: true, atBats: [], pitchingRecords: [], startingLineup,
    lineup: startingLineup.map((l) => ({ ...l })),
    playLogs: [
      { id: 'pc1', gameId: 'g', inning: 1, isTop: true, kind: 'pitcher', text: '', payload: { in: '米原', out: null } },
      { id: 'a1', gameId: 'g', inning: 1, isTop: true, kind: 'atbat', text: '', payload: { order: 1, playerId: 'p0', result: 'out' } },
      { id: 'pc2', gameId: 'g', inning: 3, isTop: true, kind: 'pitcher', text: '', payload: { in: '辻', out: '米原' } },
      { id: 'a3', gameId: 'g', inning: 3, isTop: true, kind: 'atbat', text: '', payload: { order: 1, playerId: 'p0', result: 'out' } },
    ],
    rules: {}, ruleChanges: [],
  };
  const by = alignmentByInning(game);
  assert.equal(by.get(1).find((s) => s.position === '投').playerId, '米原');
  assert.equal(by.get(2).find((s) => s.position === '投').playerId, '米原', '交代までは前の投手');
  assert.equal(by.get(3).find((s) => s.position === '投').playerId, '辻', '3回から新しい投手');
  assert.equal(findPositionIssues(game).missing.filter((m) => m.position === '投').length, 0);
});


// ============================================================
// 流れタグの判定: 窓の端まで足すと、動いたあと戻した分で打ち消される
//
// 実際に起きた不具合。ヒットの直後に押したのに「動かず」と判定された。
// 押した後に +1.29 動いていたのに、窓の最後にあった -0.54 まで足して
// 合計 +0.49 になり、しきい値0.5をわずかに下回っていた。
// ============================================================
test('流れタグ: 動いたあと戻しても、動いた事実を拾う', () => {
  const pa = (id, r, o, runs = 0) => ({
    id, gameId: 'g', inning: 5, isTop: true, kind: 'atbat', text: '',
    payload: { beforeRunners: { 1: !!r[0], 2: !!r[1], 3: !!r[2] }, outsBefore: o, runs },
  });
  const tag = { id: 'tag', gameId: 'g', inning: 5, isTop: true, kind: 'flow', text: '', payload: { dir: 'up' } };
  // 押した後: +0.37, +0.66 と上がってから -0.54 戻す(合計 +0.49)
  const g = { id: 'g', playLogs: [
    pa('x1', [0,0,0], 0), pa('x2', [0,0,0], 1), tag,
    pa('x3', [1,0,0], 1), pa('x4', [1,1,0], 1), pa('x5', [1,1,1], 1, 1),
  ] };
  const j = judgeFlowTags(g, flowSeries(g, null));
  assert.notEqual(j.verdict.tag, 'miss', '上がってから戻しただけで「動かず」にしない');
});

test('流れタグ: ヒットの直後に押したら「反応」', () => {
  const pa = (id, r, o, runs = 0) => ({
    id, gameId: 'g', inning: 5, isTop: true, kind: 'atbat', text: '',
    payload: { beforeRunners: { 1: !!r[0], 2: !!r[1], 3: !!r[2] }, outsBefore: o, runs },
  });
  const tag = { id: 'tag', gameId: 'g', inning: 5, isTop: true, kind: 'flow', text: '', payload: { dir: 'up' } };
  // 単打1本ぶん(0.3前後)でも「もう動いていた」として拾えないと、
  // ヒットを見てから押した人が「動かず」になってしまう。
  // ただし、そのあとさらに大きく動いたなら「その先を読めていた」なので予兆になる
  // (どちらが大きいかで決める)。ここは後が続かない形にして反応を確かめる。
  const after = { id: 'g', playLogs: [
    pa('x1', [0,0,0], 0), pa('x2', [0,0,0], 1), tag,
    pa('x3', [1,0,0], 1), pa('x4', [1,0,0], 2),
  ] };
  assert.equal(judgeFlowTags(after, flowSeries(after, null)).verdict.tag, 'post',
    'ヒットの後に押して、そのあとが続かなければ反応');

  // 同じ試合で、ヒットの前に押していれば予兆
  const before = { id: 'g', playLogs: [pa('x1', [0,0,0], 0), tag, pa('x2', [0,0,0], 1), pa('x3', [1,0,0], 1), pa('x4', [1,1,0], 1), pa('x5', [1,1,1], 1, 1)] };
  const jb = judgeFlowTags(before, flowSeries(before, null));
  assert.equal(jb.verdict.tag, 'pre', 'ヒットの前に押したら予兆');
  assert.equal(jb.hitRate, 1);
  assert.ok(jb.catchRate > 0, '事前に押せた区間として数える');
});

test('流れタグ: 本当に何も動かなければ「動かず」のまま', () => {
  const pa = (id, r, o) => ({
    id, gameId: 'g', inning: 5, isTop: true, kind: 'atbat', text: '',
    payload: { beforeRunners: { 1: !!r[0], 2: !!r[1], 3: !!r[2] }, outsBefore: o, runs: 0 },
  });
  const g = { id: 'g', playLogs: [
    { id: 'tag', gameId: 'g', inning: 5, isTop: true, kind: 'flow', text: '', payload: { dir: 'up' } },
    pa('x1', [0,0,0], 0), pa('x2', [0,0,0], 1), pa('x3', [0,0,0], 2),
  ] };
  assert.equal(judgeFlowTags(g, flowSeries(g, null)).verdict.tag, 'miss', '三者凡退なら動かず');
});


// ============================================================
// 単打の走者の既定は、打球方向で変わる
//
// レフト前ヒットの二塁走者は三塁で止まるのが普通(左翼は三塁に近く、
// 本塁への送球も短い)。方向を見ずに一律で生還させていた。
// ============================================================
test('単打: レフト前の二塁走者は三塁が既定', () => {
  const on2 = { 1: false, 2: true, 3: false };
  const to = (dir) => proposeMoves('single', on2, dir).moves.find((m) => m.from === 2)?.to;
  assert.equal(to('LF'), 3, 'レフト前は三塁で止まる');
  assert.equal(to('CF'), 4, 'センター前は生還');
  assert.equal(to('RF'), 4, 'ライト前は生還');
});

test('単打: 内野安打なら走者は1つずつ', () => {
  const loaded = { 1: true, 2: true, 3: true };
  for (const dir of ['P', 'C', '1B', '2B', '3B', 'SS']) {
    const mv = proposeMoves('single', loaded, dir).moves;
    assert.deepEqual(mv, [{ from: 3, to: 4 }, { from: 2, to: 3 }, { from: 1, to: 2 }], `${dir}: 外野へ抜けていないので1つずつ`);
  }
});

test('単打: 外野へ抜ければ三塁走者は生還、一塁走者は二塁', () => {
  const loaded = { 1: true, 2: true, 3: true };
  assert.deepEqual(proposeMoves('single', loaded, 'RF').moves,
    [{ from: 3, to: 4 }, { from: 2, to: 4 }, { from: 1, to: 2 }]);
  // レフト前は二塁走者だけが止まる
  assert.deepEqual(proposeMoves('single', loaded, 'LF').moves,
    [{ from: 3, to: 4 }, { from: 2, to: 3 }, { from: 1, to: 2 }]);
});

test('単打: 方向が分からないときは今までどおり(生還)', () => {
  const on2 = { 1: false, 2: true, 3: false };
  assert.equal(proposeMoves('single', on2).moves[0].to, 4, '引数を省いても壊れない');
  assert.equal(proposeMoves('single', on2, null).moves[0].to, 4);
});

test('単打以外は方向で変わらない', () => {
  const on2 = { 1: false, 2: true, 3: false };
  for (const r of ['double', 'triple', 'hr']) {
    assert.equal(proposeMoves(r, on2, 'LF').moves[0].to, 4, `${r} は二塁走者が生還`);
    assert.equal(proposeMoves(r, on2, 'RF').moves[0].to, 4);
  }
  // 四球は押し出しのみ(方向は無関係)
  assert.deepEqual(proposeMoves('bb', on2, 'LF').moves, [], '走者二塁だけなら四球で動かない');
});


// ============================================================
// 記録を直したとき、アウトと得点も直った内容に合わせる
//
// 回の途中で「ヒットだと思ったら凡打だった」を直しても、
// スコア入力画面のアウトカウント・得点はそのままだった。
// reducer は JSX 側にあるので、ここでは判定に使う部品を確かめる。
// ============================================================
test('打者がアウトになる結果かどうかは onBase で決まる', () => {
  // outsOnPlay の増減はこの判定で出している
  for (const r of ['single', 'double', 'triple', 'hr', 'bb', 'hbp', 'error', 'interference', 'obstruction']) {
    assert.equal(!RESULTS_FOR_OUT[r].onBase, false, `${r} は打者が出塁する`);
  }
  for (const r of ['out', 'so', 'sacBunt', 'sacFly', 'fieldInterference']) {
    assert.equal(!RESULTS_FOR_OUT[r].onBase, true, `${r} は打者がアウトになる`);
  }
});

test('結果を変えたときのアウト数の増減', () => {
  // ヒット→凡打 なら +1、凡打→ヒット なら -1、走者が刺された分は残す
  const delta = (before, after, was) => {
    const wasOut = !RESULTS_FOR_OUT[before].onBase;
    const nowOut = !RESULTS_FOR_OUT[after].onBase;
    return Math.max(0, was + (nowOut ? 1 : 0) - (wasOut ? 1 : 0));
  };
  assert.equal(delta('single', 'out', 0), 1, 'ヒット→凡打で1つ増える');
  assert.equal(delta('out', 'single', 1), 0, '凡打→ヒットで1つ減る');
  assert.equal(delta('single', 'double', 0), 0, 'ヒット同士なら変わらない');
  assert.equal(delta('out', 'so', 1), 1, 'アウト同士なら変わらない');
  // 併殺(打者+走者で2つ)からヒットに直しても、走者を刺した1つは残る
  assert.equal(delta('out', 'single', 2), 1, '走者を刺した分は残す');
  // マイナスにはしない
  assert.equal(delta('out', 'single', 0), 0);
});


// ============================================================
// 流れタグ: 直前にも動き、あとにも動いた場合はどちらが大きいかで決める
//
// 実際に起きた不具合。5回表が終わった時点で「流れ切れた」を押し、
// 5回裏に2失点した。読めていたのに「反応」と判定され、押せていた動きが0のままだった。
// 回の終わりに押すと「攻撃が終わった」動きが必ず直前にあるので、
// 直前だけを見て決めると、これから起きることを言い当てても評価されない。
// ============================================================
test('流れタグ: 回の終わりに押して、そのあと大きく動いたら予兆', () => {
  const own = (id, r, o, runs = 0) => ({
    id, gameId: 'g', inning: 5, isTop: true, kind: 'atbat', text: '',
    payload: { beforeRunners: { 1: !!r[0], 2: !!r[1], 3: !!r[2] }, outsBefore: o, runs },
  });
  const def = (id, r, o, runs = 0) => ({
    id, gameId: 'g', inning: 5, isTop: false, kind: 'defense', text: '',
    payload: { beforeRunners: { 1: !!r[0], 2: !!r[1], 3: !!r[2] }, outsBefore: o, runs },
  });
  const g = { id: 'g', playLogs: [
    own('a1', [0,0,0], 0), own('a2', [1,0,0], 0), own('a3', [1,1,0], 1), // 走者を残して表が終わる
    { id: 'tag', gameId: 'g', inning: 5, isTop: false, kind: 'flow', text: '', payload: { dir: 'down' } },
    def('b1', [0,0,0], 0), def('b2', [1,0,0], 0), def('b3', [1,1,0], 0, 2), // 裏に2失点
  ] };
  const j = judgeFlowTags(g, flowSeries(g, null));
  assert.equal(j.verdict.tag, 'pre', 'あとの動きのほうが大きいので予兆');
  assert.equal(j.hitRate, 1);
  // 押していない動きの母数は「その試合で起きた大きな動き」全部。向きは問わない。
  // この並びは表の攻撃(+0.41)と裏の失点(−2.41)で2区間ある。押したのは down だけなので
  // 言い当てたのは1つ、母数は2つ。押さなかった区間も母数に残る(成績には響かない)。
  assert.equal(j.swings.length, 2, '向きの違う大きな動きが2つある');
  assert.equal(j.caught, 1, '言い当てた区間として押せていた動きに入る');
  assert.equal(j.catchRate, 0.5);
});

test('流れタグ: 大きく動いた直後に押して、あとが静かなら反応のまま', () => {
  // 待ち伏せ(起きたことをなぞる)を予兆にしてはいけない
  const own = (id, r, o, runs = 0) => ({
    id, gameId: 'g', inning: 5, isTop: true, kind: 'atbat', text: '',
    payload: { beforeRunners: { 1: !!r[0], 2: !!r[1], 3: !!r[2] }, outsBefore: o, runs },
  });
  const g = { id: 'g', playLogs: [
    own('c1', [1,1,1], 0, 3), own('c2', [0,0,0], 0), // 走者一掃
    { id: 'tag', gameId: 'g', inning: 5, isTop: true, kind: 'flow', text: '', payload: { dir: 'up' } },
    own('c3', [0,0,0], 1), own('c4', [0,0,0], 2),   // あとは静か
  ] };
  assert.equal(judgeFlowTags(g, flowSeries(g, null)).verdict.tag, 'post');
});


// ============================================================
// 画面の打者と記録がずれていないか
//
// 実際に起きたこと。回の途中で打席を直したあと、次の回の攻撃で
// 実際の打者とアプリの打者が1人ずれたまま試合が進んでしまった。
// 打順は記録の並びで決まるので、最後に記録した打席の次が来るはず。
// そこと食い違っていれば、その場で気づけるようにする。
// ============================================================
const lineup9 = Array.from({ length: 9 }, (_, i) => ({ order: i + 1, playerId: 'p' + i, position: '左' }));
const paLogOf = (order, kind = 'atbat') => ({ id: `${kind}${order}${Math.random()}`, kind, inning: 1, isTop: true, payload: { order } });

test('expectedBatterIndex: 最後に記録した打席の次が来る', () => {
  assert.equal(expectedBatterIndex({ lineup: lineup9, playLogs: [paLogOf(1), paLogOf(2), paLogOf(3)] }), 3, '3番のあとは4番(index 3)');
  assert.equal(expectedBatterIndex({ lineup: lineup9, playLogs: [paLogOf(9)] }), 0, '9番のあとは1番に回る');
  assert.equal(expectedBatterIndex({ lineup: lineup9, playLogs: [] }), null, '記録が無ければ判断しない');
  assert.equal(expectedBatterIndex({ lineup: [], playLogs: [paLogOf(1)] }), null, '打順が無ければ判断しない');
});

test('batterDrift: ずれていればあるべき打順、合っていれば null', () => {
  const g = { lineup: lineup9, playLogs: [paLogOf(1), paLogOf(2), paLogOf(3)], batterIndex: 3 };
  assert.equal(batterDrift(g, true), null, '合っていれば何も出さない');
  assert.equal(batterDrift({ ...g, batterIndex: 4 }, true), 3, '1人先に進んでいたら3を返す');
  assert.equal(batterDrift({ ...g, batterIndex: 2 }, true), 3, '1人戻っていても3を返す');
  // 一巡をまたぐ
  const around = { lineup: lineup9, playLogs: [paLogOf(9)], batterIndex: 1 };
  assert.equal(batterDrift(around, true), 0, '9番のあとは1番のはず');
});

test('batterDrift: 相手側も同じように見る', () => {
  const oppLineup = Array.from({ length: 9 }, (_, i) => ({ order: i + 1, letter: 'ABCDEFGHI'[i] }));
  const g = { oppLineup, playLogs: [paLogOf(1, 'defense'), paLogOf(2, 'defense')], oppBatterIndex: 2 };
  assert.equal(expectedOppBatterIndex(g), 2);
  assert.equal(batterDrift(g, false), null);
  assert.equal(batterDrift({ ...g, oppBatterIndex: 5 }, false), 2);
});

test('batterDrift: 全員打ちで打順が9人より多くても回る', () => {
  const lineup12 = Array.from({ length: 12 }, (_, i) => ({ order: i + 1, playerId: 'p' + i, position: i < 9 ? '左' : '打' }));
  assert.equal(expectedBatterIndex({ lineup: lineup12, playLogs: [paLogOf(12)] }), 0, '12番のあとは1番');
  assert.equal(expectedBatterIndex({ lineup: lineup12, playLogs: [paLogOf(9)] }), 9, '9番のあとは10番');
});

test('batterDrift: 打順に無い番号が記録されていても壊れない', () => {
  // 打順を組み直した直後など、記録の打順が現在の打線に無いことがある
  assert.equal(expectedBatterIndex({ lineup: lineup9, playLogs: [paLogOf(15)] }), null);
  assert.equal(batterDrift({ lineup: lineup9, playLogs: [paLogOf(15)], batterIndex: 0 }, true), null, '判断できないときは黙る');
});

// ============================================================
// 故意四球(敬遠)
// ============================================================
test('敬遠: 四球の内訳として扱う(結果は bb のまま)', () => {
  assert.equal(resultLabelOf({ result: 'bb' }), '四球');
  assert.equal(resultLabelOf({ result: 'bb', intentional: true }), '敬遠');
  assert.equal(isIntentionalBB({ result: 'bb', intentional: true }), true);
  assert.equal(isIntentionalBB({ result: 'hbp', intentional: true }), false, '死球は敬遠ではない');
  // 三振の内訳はこれまでどおり
  assert.equal(resultLabelOf({ result: 'so', soType: 'looking' }), '見逃し三振');
  assert.equal(resultLabelOf({ result: 'single' }), 'ヒット');
});

test('敬遠: playLabel は方向を付けず呼び名だけ差し替える', () => {
  assert.equal(playLabel('bb', null, null, null, undefined, 'ja', { intentional: true }), '敬遠');
  assert.equal(playLabel('bb', null, null, null, undefined, 'ja'), '四球');
  assert.equal(playLabel('bb', null, null, null, undefined, 'en', { intentional: true }), 'IBB');
});

test('敬遠: 四球にも数え、内訳としても数える(出塁率の分母は変わらない)', () => {
  const mk = (intentional) => ({
    atBats: [
      { playerId: 'p1', result: 'bb', intentional, rbi: 0, snapshot: {} },
      { playerId: 'p1', result: 'single', rbi: 0, snapshot: {} },
    ],
    playLogs: [],
  });
  const plain = aggregateBatting([mk(false)]).p1;
  const ibb = aggregateBatting([mk(true)]).p1;
  assert.equal(plain.bb, 1);
  assert.equal(plain.ibb, 0);
  assert.equal(ibb.bb, 1, '敬遠も四球に数える');
  assert.equal(ibb.ibb, 1);
  assert.equal(battingMetrics(ibb).obp, battingMetrics(plain).obp, '出塁率は変わらない');
});

test('敬遠: 与四球に数えたうえで与故意四球にも入る', () => {
  const g = {
    playLogs: [
      { kind: 'pitcher', inning: 1, isTop: true, payload: { in: 'k1' } },
      { kind: 'defense', inning: 1, isTop: true, payload: { result: 'bb', intentional: true, outsOnPlay: 0, runs: 0 } },
      { kind: 'defense', inning: 1, isTop: true, payload: { result: 'bb', outsOnPlay: 0, runs: 0 } },
    ],
  };
  const { records } = rebuildPitchingStats(g);
  const pr = records.find((r) => r.playerId === 'k1');
  assert.equal(pr.walks, 2);
  assert.equal(pr.intentionalWalks, 1);
});

test('敬遠: 音声で「敬遠」と言えば四球+内訳として拾う', () => {
  const cands = parseUtterance('ろぐ、敬遠');
  const bb = cands.find((c) => c.result === 'bb');
  assert.ok(bb, '四球として拾う');
  assert.equal(bb.intentional, true);
  assert.equal(bb.label, '敬遠');
  const plain = parseUtterance('ろぐ、フォアボール').find((c) => c.result === 'bb');
  assert.equal(plain.intentional, false);
});

// ============================================================
// タイブレーク: 半回の頭に走者を置く
// ============================================================
const tbGame = (over = {}) => ({
  status: 'ongoing', inning: 10, isTop: true, isHome: false,
  runners: { 1: null, 2: null, 3: null }, outs: 0,
  batterIndex: 2, oppBatterIndex: 4,
  lineup: Array.from({ length: 9 }, (_, i) => ({ order: i + 1, playerId: 'p' + (i + 1) })),
  oppLineup: Array.from({ length: 9 }, (_, i) => ({ order: i + 1, letter: 'ABCDEFGHI'[i] })),
  playLogs: [],
  rules: { tiebreak: { fromInning: 10, runners: '12', order: 'cont', outs: 0 } },
  ...over,
});

test('タイブレーク: 継続打順なら先頭打者の前2人を一・二塁に置く', () => {
  const plan = tiebreakPlacement(tbGame());
  assert.ok(plan);
  assert.equal(plan.runners[2].playerId, 'p2', '1人前が二塁');
  assert.equal(plan.runners[1].playerId, 'p1', '2人前が一塁');
  assert.equal(plan.runners[3], null);
  assert.equal(plan.outs, 0);
  assert.equal(plan.runners[2].placed, true, '置いた走者だと分かる印を残す');
});

test('タイブレーク: 打順をまたいでも戻れる', () => {
  const plan = tiebreakPlacement(tbGame({ batterIndex: 0 }));
  assert.equal(plan.runners[2].playerId, 'p9', '1番の1人前は9番');
  assert.equal(plan.runners[1].playerId, 'p8');
});

test('タイブレーク: 満塁・1アウトも置ける', () => {
  const g = tbGame({ rules: { tiebreak: { fromInning: 10, runners: '123', order: 'cont', outs: 1 } } });
  const plan = tiebreakPlacement(g);
  assert.equal(plan.runners[3].playerId, 'p2');
  assert.equal(plan.runners[2].playerId, 'p1');
  assert.equal(plan.runners[1].playerId, 'p9');
  assert.equal(plan.outs, 1);
});

test('タイブレーク: 打順の先頭からなら1番に戻して9番・8番を置く', () => {
  const plan = tiebreakPlacement(tbGame({ rules: { tiebreak: { fromInning: 10, runners: '12', order: 'top', outs: 0 } } }));
  assert.equal(plan.batterIndex, 0);
  assert.equal(plan.runners[2].playerId, 'p9');
  assert.equal(plan.runners[1].playerId, 'p8');
});

test('タイブレーク: 裏(守備)の半回は相手の打順から置く', () => {
  const plan = tiebreakPlacement(tbGame({ isTop: false, currentPitcherId: 'k1' }));
  assert.equal(plan.runners[2].letter, 'D', '相手5番の1人前は4番=D');
  assert.equal(plan.runners[1].letter, 'C');
  assert.equal(plan.runners[2].playerId, null, '相手選手は記号で持つ');
  assert.equal(plan.runners[2].pitcherId, 'k1');
});

test('タイブレーク: 前の回・タイブレーク外・すでに走者ありでは置かない', () => {
  assert.equal(tiebreakPlacement(tbGame({ inning: 9 })), null, 'まだタイブレークの回ではない');
  assert.equal(tiebreakPlacement(tbGame({ rules: {} })), null, 'タイブレークではない試合');
  assert.equal(tiebreakPlacement(tbGame({ runners: { 1: null, 2: { playerId: 'p5' }, 3: null } })), null, 'すでに走者が居る');
  assert.equal(tiebreakPlacement(tbGame({ status: 'finished' })), null, '終わった試合には置かない');
});

test('タイブレーク: もう打席が記録されている半回には置かない', () => {
  const started = tbGame({ playLogs: [{ kind: 'atbat', inning: 10, isTop: true, payload: {} }] });
  assert.equal(tiebreakPlacement(started), null);
  // 相手の打席(守備側)は自分の攻撃の半回とは別物なので、判定を邪魔しない
  const otherHalf = tbGame({ playLogs: [{ kind: 'defense', inning: 10, isTop: true, payload: {} }] });
  assert.ok(tiebreakPlacement(otherHalf), '守備ログは自分の攻撃の半回を止めない');
});

test('タイブレーク: 回の途中で宣言しても、その回から効く(ruleChanges経由)', () => {
  const g = tbGame({
    rules: {},
    inning: 11,
    ruleChanges: [{ id: 'c1', fromInning: 10, patch: { tiebreak: { fromInning: 10, runners: '12', order: 'cont', outs: 0 } } }],
  });
  const plan = tiebreakPlacement(g);
  assert.ok(plan, '10回から宣言したタイブレークは11回にも効く');
  assert.equal(plan.runners[2].playerId, 'p2');
});

// ============================================================
// 記録員(スコアラー)の読みの実績
// ============================================================
// 勝率モデルはテストでも本番と同じ作り方で用意する
const scRe = (games) => {
  const { re } = buildRunExpectancy(games, '草野球');
  const { dists } = buildRunDists(games, '草野球', re);
  return buildWinModel({ dists, isHome: false, regulation: 9 });
};
// 流れが実際に動く形の試合を作る: 走者なし0アウトから走者が溜まって点が入る
const scGame = (id, scorerId, tags) => {
  const pa = (i, runners, outs, runs = 0) => ({
    id: `${id}-pa${i}`, kind: 'atbat', inning: 1, isTop: true,
    text: '打席', payload: { beforeRunners: runners, outsBefore: outs, runs },
  });
  return {
    id, scorerId,
    playLogs: [
      pa(1, { 1: false, 2: false, 3: false }, 0),
      ...tags,
      pa(2, { 1: true, 2: false, 3: false }, 0),
      pa(3, { 1: true, 2: true, 3: false }, 0),
      pa(4, { 1: true, 2: true, 3: true }, 0, 2),
      pa(5, { 1: true, 2: true, 3: false }, 0),
    ],
  };
};
const flowTag = (id, dir = 'up', scorerId) => ({
  id, kind: 'flow', inning: 1, isTop: true, text: 'タグ',
  payload: { dir, scorerId },
});

test('記録員: 押したタグが記録員に紐づく', () => {
  const g = scGame('g1', 's1', [flowTag('t1', 'up')]);
  const map = aggregateScorers([g], scRe([g]));
  assert.ok(map.s1, '試合の記録員に付く');
  assert.equal(map.s1.tags, 1);
  assert.equal(map.s1.games, 1);
  assert.equal(map.s1.pre + map.s1.post + map.s1.miss, 1, '判定はどれか1つに入る');
});

test('記録員: タグに焼き込まれた記録員が試合の記録員より優先される', () => {
  // 途中で記録員が代わっても、押した人のタグは押した人のもの
  const g = scGame('g2', 's1', [flowTag('t1', 'up', 's2')]);
  const map = aggregateScorers([g], scRe([g]));
  assert.equal(map.s2.tags, 1, '押した人に付く');
  assert.equal(map.s1?.tags || 0, 0, '試合の記録員には付かない');
  assert.equal(map.s1.games, 1, '試合単位の数は試合の記録員に付く');
});

test('記録員: 未設定の試合はタグがあっても実績にならない', () => {
  const g = scGame('g3', null, [flowTag('t1', 'up')]);
  const map = aggregateScorers([g], scRe([g]));
  assert.equal(Object.keys(map).length, 0, '誰の読みか分からないものは積み上げない');
});

test('記録員: 率は押した数で割る／押していなければ null', () => {
  const g = scGame('g4', 's1', []);
  const map = aggregateScorers([g], scRe([g]));
  assert.equal(map.s1.tags, 0);
  assert.equal(map.s1.hitRate, null, '0回を0割にしない');
});

test('記録員: 回数の足りない人は上位に出さない', () => {
  const many = { scorerId: 'a', tags: 10, pre: 6, hitRate: 0.6, games: 3 };
  const few = { scorerId: 'b', tags: 1, pre: 1, hitRate: 1, games: 1 };
  const ranked = rankScorers({ a: many, b: few }, 5);
  assert.equal(ranked[0].scorerId, 'a', '1回だけの満点を先頭にしない');
  assert.equal(ranked[1].scorerId, 'b');
});

test('流れ: RE24の積み上げは回の切れ目で点差と一致する(勝率へ移した理由)', () => {
  // 得点期待値の差を足し上げたものは、回の切れ目でそのときの点差と同じ値になる。
  // つまり流れの土台にはならない。この性質を固定しておく。
  const re = new Map(Object.entries(BASE_RE));
  const N = { 1: false, 2: false, 3: false };
  const R1 = { 1: true, 2: false, 3: false };
  let n = 0;
  const pa = (kind, inn, isTop, runners, outs, runs = 0) =>
    ({ id: 'p' + (++n), kind, inning: inn, isTop, text: '', payload: { beforeRunners: runners, outsBefore: outs, runs } });
  const logs = [
    // 1回表 自チーム 0点
    pa('atbat', 1, true, N, 0), pa('atbat', 1, true, N, 1), pa('atbat', 1, true, N, 2),
    // 1回裏 相手 2点
    pa('defense', 1, false, N, 0), pa('defense', 1, false, R1, 0), pa('defense', 1, false, R1, 1, 2),
    // 2回表 自チーム 3点
    pa('atbat', 2, true, N, 0), pa('atbat', 2, true, R1, 1, 3),
    // 2回裏 相手 0点
    pa('defense', 2, false, N, 0), pa('defense', 2, false, N, 1), pa('defense', 2, false, N, 2),
  ];
  const s = flowSeries({ playLogs: logs }, re);
  const at = (i) => Number(s[i].cum.toFixed(6));
  assert.equal(at(5), -2, '1回終了時は点差 -2 と一致する');
  assert.equal(at(10), 1, '2回終了時は点差 +1 と一致する');
  // 回の途中は塁上のぶんだけ振れる。そこが点差には出ない情報で、線を見る意味になる
  assert.equal(s[5].runs, 2, '点が入るのはこの打席');
  assert.ok(s[3].cum < s[2].cum, '相手に走者が出た時点で、点が入る前から下がっている');
});

test('流れ: 線の形をひとことで言う', () => {
  const mk = (rows) => rows.map(([we, diff], i) => ({ we, diff, inning: i + 1, isTop: true }));
  const sh = weShape(mk([[0.5, 0], [0.3, -1], [0.18, -2], [0.6, 1], [0.94, 3]]));
  assert.equal(sh.n, 5, '母数は打席数(経過時間は記録していない)');
  assert.equal(sh.lowest.we, 0.18, 'いちばん苦しかった打席');
  assert.equal(sh.highest.we, 0.94, 'いちばん良かった打席');
  // 割合は点差だけで決まる(勝率は後攻が最後に打つぶん偏るので割合には使わない)
  assert.equal(sh.aheadPct, 40);
  assert.equal(sh.tiedPct, 20);
  assert.equal(sh.behindPct, 40);
  assert.equal(sh.aheadPct + sh.tiedPct + sh.behindPct, 100);
  assert.equal(weShape([]), null);
});

// ============================================================
// 勝利期待値(WE)
// 流れの土台。RE24とちがい 50% が互角で、基準線が動かない
// ============================================================
const weModel = ({ isHome = false, regulation = 9, games = [] } = {}) => {
  const { re } = buildRunExpectancy(games, null);
  const { dists } = buildRunDists(games, null, re);
  return buildWinModel({ dists, isHome, regulation });
};
const EMPTY = { 1: false, 2: false, 3: false };

test('WE: 得点分布は平均と「0点で終わる確率」から組む', () => {
  const d = priorDist(0.48, SCORE_PROB['000|0']);
  const sum = d.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `合計が1になる: ${sum}`);
  const mean = d.reduce((a, b, k) => a + b * k, 0);
  assert.ok(Math.abs(mean - 0.48) < 0.02, `平均が指定どおり: ${mean}`);
  assert.ok(Math.abs(d[0] - (1 - SCORE_PROB['000|0'])) < 1e-9, '0点率が指定どおり');
  assert.equal(d.length, MAX_RUNS + 1);
  // 走者が詰まっているほど0点で終わりにくい
  assert.ok(priorDist(2.29, SCORE_PROB['111|0'])[0] < d[0]);
});

test('WE: 残りの半回を正しく並べる', () => {
  // 先攻(isHome=false)の1回表が進行中 → 次は1回裏から9回裏まで
  const r = remainingHalves(false, 1, true, 9);
  assert.equal(r.length, 17);
  assert.deepEqual(r[0], { inning: 1, isTop: false, mine: false });
  assert.deepEqual(r[16], { inning: 9, isTop: false, mine: false });
  // 9回表が進行中なら残りは9回裏だけ
  assert.deepEqual(remainingHalves(false, 9, true, 9), [{ inning: 9, isTop: false, mine: false }]);
  // 規定を過ぎた延長は「この回で決まる」とみなす
  assert.equal(remainingHalves(false, 11, true, 9).length, 1);
  // 最後の半回が終わっていれば残りは無い
  assert.equal(remainingHalves(false, 9, false, 9).length, 0);
});

test('WE: 試合開始は互角、点差に対して単調', () => {
  const we = weModel();
  const at = (diff) => we({ inning: 1, isTop: true, runners: EMPTY, outs: 0, diff });
  assert.ok(Math.abs(at(0) - 0.5) < 0.01, `開始は50%: ${at(0)}`);
  for (let d = -4; d < 4; d++) assert.ok(at(d) < at(d + 1), `点差が増えれば勝率も上がる (${d})`);
  // 対称性: 先攻・後攻が同じ回数打つ規定では、+dと-dが表裏になる
  assert.ok(Math.abs(at(3) + at(-3) - 1) < 0.01);
});

test('WE: 勝負がついた場面を正しく振り切る', () => {
  const we = weModel(); // 自チームは先攻
  // 9回裏2死、自チームが1点リード → ほぼ勝ち
  assert.ok(we({ inning: 9, isTop: false, runners: EMPTY, outs: 2, diff: 1 }) > 0.9);
  // 9回裏2死、自チームが1点ビハインド → 後攻が勝っているので負けが確定
  assert.equal(we({ inning: 9, isTop: false, runners: EMPTY, outs: 2, diff: -1 }), 0);
  // 走者を背負っているほど守り切りにくい
  const clean = we({ inning: 9, isTop: false, runners: EMPTY, outs: 2, diff: 1 });
  const jam = we({ inning: 9, isTop: false, runners: { 1: true, 2: true, 3: true }, outs: 2, diff: 1 });
  assert.ok(jam < clean, '満塁のほうが苦しい');
});

test('WE: 線は0〜100%に収まり、打席ごとの動きが線の差になる', () => {
  const we = weModel({ regulation: 2 });
  let n = 0;
  const pa = (kind, inn, isTop, runners, outs, runs = 0) =>
    ({ id: 'w' + (++n), kind, inning: inn, isTop, text: '', payload: { beforeRunners: runners, outsBefore: outs, runs } });
  const R1 = { 1: true, 2: false, 3: false };
  const logs = [
    pa('atbat', 1, true, EMPTY, 0), pa('atbat', 1, true, R1, 0), pa('atbat', 1, true, R1, 1, 2),
    pa('defense', 1, false, EMPTY, 0), pa('defense', 1, false, EMPTY, 1), pa('defense', 1, false, EMPTY, 2),
    pa('atbat', 2, true, EMPTY, 0), pa('atbat', 2, true, EMPTY, 1), pa('atbat', 2, true, EMPTY, 2),
    pa('defense', 2, false, EMPTY, 0), pa('defense', 2, false, EMPTY, 1), pa('defense', 2, false, EMPTY, 2),
  ];
  const s = weSeries({ playLogs: logs, isHome: false }, we);
  assert.equal(s.length, 12);
  for (const x of s) assert.ok(x.we >= 0 && x.we <= 1, `勝率は0〜1: ${x.we}`);
  // 2点入った打席は大きく上へ動く
  assert.ok(s[2].delta > 0.15, `得点した打席は大きく動く: ${s[2].delta}`);
  // 2点リードのまま終わったので最後は勝ち
  assert.equal(s[s.length - 1].we, 1);
  assert.equal(s[s.length - 1].diff, 2, '点差も持ち回る');
  // 守備側でも自チーム視点なので符号を反転しなくていい(相手を抑えれば上がる)
  assert.ok(s[5].we >= s[3].we, '相手を0点に抑えた半回は勝率が下がらない');
});

test('WE: 打席の動きは「前の勝率」と「後の勝率」の差', () => {
  // 画面は差ではなく前後をそのまま出す。差だけだと初見で何のことか分からない。
  // ここでは we - delta が「打席前の勝率」として取り出せることを固定する。
  const we = weModel({ regulation: 9 });
  let n = 0;
  const pa = (kind, inn, isTop, runners, outs, runs = 0) =>
    ({ id: 'm' + (++n), kind, inning: inn, isTop, text: '', payload: { beforeRunners: runners, outsBefore: outs, runs } });
  const R1 = { 1: true, 2: false, 3: false };
  const logs = [pa('atbat', 7, true, EMPTY, 0), pa('atbat', 7, true, R1, 0), pa('atbat', 7, true, R1, 1)];
  const s = weSeries({ playLogs: logs, isHome: false }, we);
  const before0 = we({ inning: 7, isTop: true, runners: EMPTY, outs: 0, diff: 0 });
  assert.ok(Math.abs((s[0].we - s[0].delta) - before0) < 1e-9, '1打席目の「前」は試合開始時の勝率');
  // 走者が出れば上がり、アウトが増えれば下がる
  assert.ok(s[0].delta > 0, 'ヒットで一塁に出れば上がる');
  assert.ok(s[1].delta < 0, 'アウトが増えれば下がる');
  // 前後の差がそのまま delta
  for (const x of s) assert.ok(Math.abs((x.we - (x.we - x.delta)) - x.delta) < 1e-12);
});

test('WE: タイブレークの回は「走者を置いて始まる」ぶんまで見る', () => {
  // 残りの半回を走者なしで畳むと、自分の回だけ走者ありに見えて勝率が跳ね上がる。
  // 両チームとも走者を置いて始まるので、同点なら互角のはず。
  const { re } = buildRunExpectancy([], null);
  const { dists } = buildRunDists([], null, re);
  const game = {
    isHome: false,
    rules: { innings: 9, tiebreak: { fromInning: 10, runners: '12', order: 'cont', outs: 0 } },
  };
  assert.equal(halfStartKeyOf(game, 10), '110|0', 'タイブレークの回は無死一二塁から始まる');
  assert.equal(halfStartKeyOf(game, 9), '000|0', 'その前の回はふつうに走者なしから');

  const naive = buildWinModel({ dists, isHome: false, regulation: 9 });
  const aware = buildWinModel({ dists, isHome: false, regulation: 9, halfStartKey: (i) => halfStartKeyOf(game, i) });
  const st = { inning: 10, isTop: true, runners: { 1: true, 2: true, 3: false }, outs: 0, diff: 0 };
  assert.ok(Math.abs(aware(st) - 0.5) < 0.01, `同点のタイブレーク開始は互角: ${aware(st)}`);
  assert.ok(naive(st) - aware(st) > 0.1, '走者を見落とすと先に攻める側が過大評価される');

  // 満塁・1アウト開始でも同じように互角から始まる
  const g2 = { isHome: false, rules: { innings: 7, tiebreak: { fromInning: 8, runners: '123', order: 'cont', outs: 1 } } };
  assert.equal(halfStartKeyOf(g2, 8), '111|1');
  const m2 = buildWinModel({ dists, isHome: false, regulation: 7, halfStartKey: (i) => halfStartKeyOf(g2, i) });
  const st2 = { inning: 8, isTop: true, runners: { 1: true, 2: true, 3: true }, outs: 1, diff: 0 };
  assert.ok(Math.abs(m2(st2) - 0.5) < 0.02, `1アウト満塁開始でも互角: ${m2(st2)}`);
});

// ============================================================
// 勝利貢献(WPA)と得点貢献(RE24)
// ============================================================
// 実際に成立する並びで作る(走者と得点とアウトが食い違うと、値の意味が確かめられない)
//  得点する回: A単打 → B2ランHR → C凡打 → D凡打 → E凡打
//  無得点の回: 三者凡退
const N0 = { 1: false, 2: false, 3: false };
const ON1 = { 1: true, 2: false, 3: false };
function contribGame(scoreInning = 3, innings = 7, id = 'g-contrib') {
  let n = 0;
  const pa = (kind, inn, isTop, runners, outs, runs, extra) =>
    ({ id: `${id}-${++n}`, kind, inning: inn, isTop, text: '',
       payload: { beforeRunners: runners, outsBefore: outs, runs, ...extra } });
  const logs = [];
  for (let i = 1; i <= innings; i++) {
    if (i === scoreInning) {
      logs.push(pa('atbat', i, true, N0, 0, 0, { playerId: 'A' }));   // 単打 → 一塁
      logs.push(pa('atbat', i, true, ON1, 0, 2, { playerId: 'B' }));  // 2ランHR → 走者なし
      logs.push(pa('atbat', i, true, N0, 0, 0, { playerId: 'C' }));   // 凡打
      logs.push(pa('atbat', i, true, N0, 1, 0, { playerId: 'D' }));
      logs.push(pa('atbat', i, true, N0, 2, 0, { playerId: 'E' }));
    } else {
      logs.push(pa('atbat', i, true, N0, 0, 0, { playerId: 'A' }));
      logs.push(pa('atbat', i, true, N0, 1, 0, { playerId: 'B' }));
      logs.push(pa('atbat', i, true, N0, 2, 0, { playerId: 'C' }));
    }
    for (const o of [0, 1, 2]) logs.push(pa('defense', i, false, N0, o, 0, { pitcherId: 'K1' }));
  }
  return { id, isHome: false, playLogs: logs };
}
const contribModel = () => {
  const { re } = buildRunExpectancy([], null);
  const { dists } = buildRunDists([], null, re);
  return { re, we: buildWinModel({ dists, isHome: false, regulation: 7 }) };
};

test('貢献: WPAの合計は「最終勝率 − 開始勝率」に一致する', () => {
  // これが崩れていたら、どこかで打席を数え落としているか二重に数えている
  const g = contribGame();
  const { re, we } = contribModel();
  const s = weSeries(g, we);
  const total = s.reduce((a, x) => a + x.delta, 0);
  const swing = s[s.length - 1].we - (s[0].we - s[0].delta);
  assert.ok(Math.abs(total - swing) < 1e-9, `合計=${total} / 差=${swing}`);
  assert.ok(Math.abs(total - 0.5) < 1e-9, '勝った試合は 開始50% → 100% で +0.5');

  // 選手ごとに割り振っても合計は変わらない
  const { bat, pit } = aggregateContrib([g], () => we, re);
  const byPlayer = [...bat, ...pit].reduce((a, x) => a + x.wpa, 0);
  assert.ok(Math.abs(byPlayer - total) < 1e-9, `割り振り後=${byPlayer}`);
});

test('貢献: 打者は打席に、投手は守備の打席に付く', () => {
  const g = contribGame();
  const { re, we } = contribModel();
  const { bat, pit } = aggregateContrib([g], () => we, re);

  assert.deepEqual(bat.map((x) => x.playerId).sort(), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(pit.map((x) => x.playerId), ['K1']);
  assert.equal(pit[0].bf, 21, '7回×3人');
  assert.equal(bat[0].games, 1);

  // 2ランHRを打った打者はプラス
  const b = bat.find((x) => x.playerId === 'B');
  assert.ok(b.wpa > 0, `HRの打者はプラス: ${b.wpa}`);
  // 打席ごとの合計なので、HR以外の凡打ぶんは差し引かれる(HR単体は約+1.6)
  assert.ok(b.re24 > 0.5, `2点入れた打者は得点貢献もプラス: ${b.re24}`);
  // 凡打しかしていない打者はマイナス
  const e = bat.find((x) => x.playerId === 'E');
  assert.ok(e.wpa < 0 && e.re24 < 0, `凡打だけの打者はマイナス: ${e.wpa}`);
  // 無失点で投げ切った投手は大きくプラス(自チーム視点なので反転は不要)
  assert.ok(pit[0].wpa > 0.3, `無失点完投はプラス: ${pit[0].wpa}`);
});

test('貢献: WPAとRE24は別物(場面の重みの有無)', () => {
  // 同じ2ランHRでも、WPAは回によって変わる。RE24は変わらない。
  const { re, we } = contribModel();
  const swingOf = (inn) => {
    const g = contribGame(inn, 7, `g${inn}`);
    const w = weSeries(g, we).find((x) => x.runs === 2);
    const r = flowSeries(g, re).find((x) => x.runs === 2);
    return { wpa: w.delta, re24: r.delta };
  };
  const early = swingOf(1);
  const late = swingOf(7);
  assert.ok(late.wpa > early.wpa + 0.02, `終盤のほうが勝率は大きく動く: 1回=${early.wpa} 7回=${late.wpa}`);
  assert.ok(Math.abs(late.re24 - early.re24) < 1e-9, '得点期待値の動きは回によらない');
});

test('貢献: 表示は符号つき、0にマイナスを付けない', () => {
  assert.equal(formatContrib(0.5), '+0.50');
  assert.equal(formatContrib(-0.5), '−0.50');
  assert.equal(formatContrib(0), '0.00');
  assert.equal(formatContrib(-0.001), '0.00', '四捨五入して0になったらマイナスを付けない');
  assert.equal(formatContrib(3.24, 1), '+3.2');
});

test('貢献: 並べ替えは勝利貢献の大きい順', () => {
  const rows = [{ playerId: 'a', wpa: 0.1, re24: 5 }, { playerId: 'b', wpa: 0.3, re24: 1 }, { playerId: 'c', wpa: 0.1, re24: 9 }];
  assert.deepEqual(rankContrib(rows).map((x) => x.playerId), ['b', 'c', 'a']);
});

test('WE: 同点で無失点に抑えた半回は、投手にマイナスが付かない', () => {
  // 半回の切れ目で「次の半回の頭」を走者なしで見ていると、タイブレークの回で
  // 「自分の回は走者なし・相手の回は走者あり」という非対称な見立てになり、
  // 三者凡退に抑えた投手にマイナスが付く。
  const N = { 1: false, 2: false, 3: false };
  const R12 = { 1: true, 2: true, 3: false };
  let n = 0;
  const pa = (kind, inn, isTop, runners, outs, runs, extra) =>
    ({ id: 'w' + (++n), kind, inning: inn, isTop, text: '',
       payload: { beforeRunners: runners, outsBefore: outs, runs, ...extra } });
  const logs = [];
  for (let i = 1; i <= 10; i++) {
    const tb = i >= 10;
    const start = tb ? R12 : N;
    for (const isTop of [true, false]) {
      const kind = isTop ? 'atbat' : 'defense';
      const who = isTop ? { playerId: 'BAT' } : { pitcherId: 'P' };
      logs.push(pa(kind, i, isTop, start, 0, 0, who));
      logs.push(pa(kind, i, isTop, tb ? R12 : N, 1, 0, who));
      logs.push(pa(kind, i, isTop, tb ? R12 : N, 2, 0, who));
    }
  }
  const game = {
    id: 'tie', isHome: false, playLogs: logs,
    rules: { innings: 9, tiebreak: { fromInning: 10, runners: '12', order: 'cont', outs: 0 } },
  };
  const { re } = buildRunExpectancy([], null);
  const { dists } = buildRunDists([], null, re);
  const we = buildWinModel({
    dists, isHome: false, regulation: 9, halfStartKey: (i) => halfStartKeyOf(game, i),
  });
  const s = weSeries(game, we);
  const halfSum = {};
  for (const x of s) {
    if (x.mine) continue;
    const k = x.inning;
    halfSum[k] = (halfSum[k] || 0) + x.delta;
  }
  for (const [inn, v] of Object.entries(halfSum)) {
    assert.ok(v > 0, `${inn}回裏を無失点に抑えてマイナスはあり得ない: ${v}`);
  }
  // タイブレークの回でも同じ(ここが直す前にマイナスだった)
  assert.ok(halfSum[10] > 0, `タイブレークの回も同じ: ${halfSum[10]}`);
});

test('WE: 状況キーは走者とアウトに戻せる', () => {
  assert.deepEqual(stateOfKey('000|0'), { runners: { 1: false, 2: false, 3: false }, outs: 0 });
  assert.deepEqual(stateOfKey('110|0'), { runners: { 1: true, 2: true, 3: false }, outs: 0 });
  assert.deepEqual(stateOfKey('111|1'), { runners: { 1: true, 2: true, 3: true }, outs: 1 });
  assert.deepEqual(stateOfKey(undefined), { runners: { 1: false, 2: false, 3: false }, outs: 0 });
  // stateKey と往復する
  for (const k of ['000|0', '100|2', '011|1', '111|0']) {
    const st = stateOfKey(k);
    assert.equal(stateKey(st.runners, st.outs), k);
  }
});


// ============================================================
// 相手との力の差
//
// 「得点期待値を0.85倍」ではなく「10回中何回勝てるか」で入れる。倍率は
// そこから逆に解くので、こちらが決めた数字ではなくなる。
// 確かめ方: 設定した勝率が、そのままプレイボール時点の勝率になっていること。
// ============================================================
const gapDists = () => {
  const { re } = buildRunExpectancy([], '草野球');
  return buildRunDists([], '草野球', re).dists;
};
const gapModel = (gap, opts = {}) => buildGapModel({
  dists: gapDists(),
  isHome: opts.isHome ?? false,
  regulation: opts.regulation ?? 7,
  halfStartKey: () => '000|0',
  gap,
});

test('チーム差: 設定した勝率が、そのまま開始時の勝率になる', () => {
  // これが成り立たないと、設定が効いているかを誰も確かめられない
  for (const g of TEAM_GAPS) {
    for (const isHome of [false, true]) {
      const m = gapModel(g.id, { isHome });
      assert.ok(Math.abs(m.opening - g.win) < 0.002,
        `${g.id}: 目標 ${g.win} に対し ${m.opening.toFixed(4)}`);
    }
  }
});

test('チーム差: 互角なら倍率はちょうど1で、いままでと1ビットも変わらない', () => {
  const m = gapModel('even');
  assert.equal(m.factor, 1, '互角は解かずに1と決め打つ');
  const dists = gapDists();
  for (const [k, d] of dists) {
    assert.deepEqual([...m.own.get(k)], [...d], `${k}: 攻撃時は素通し`);
    assert.deepEqual([...m.opp.get(k)], [...d], `${k}: 守備時は素通し`);
  }
});

test('チーム差: 格上ほど倍率が大きく、順番が入れ替わらない', () => {
  const fs = TEAM_GAPS.map((g) => gapModel(g.id).factor);
  for (let i = 1; i < fs.length; i++) {
    assert.ok(fs[i] < fs[i - 1], `${TEAM_GAPS[i].id} は1つ前より倍率が小さい`);
  }
  assert.ok(fs[0] > 1, '胸を借りる = 相手のほうが強い');
  assert.ok(fs[fs.length - 1] < 1, '胸を貸す = こちらのほうが強い');
});

test('チーム差: 攻撃時は下がり、守備時は上がる(表が2枚に割れる)', () => {
  const { re } = buildRunExpectancy([], '草野球');
  const m = gapModel('challenge');
  const { off, def } = gapTables(re, m.factor);
  for (const [k, v] of re) {
    assert.ok(off.get(k) < v, `${k}: 期待得点は下がる`);
    assert.ok(def.get(k) > v, `${k}: 期待失点は上がる`);
    // 同じ倍率で反対向きなので、掛け合わせると元に戻る
    assert.ok(Math.abs(off.get(k) * def.get(k) - v * v) < 1e-9, `${k}: 反対向きに同じだけ`);
  }
});

test('チーム差: 試合が短いほど、同じ勝率を作るのに大きな差が要る', () => {
  // 短い試合は番狂わせが起きやすい。手で倍率を決めていたら出てこない挙動
  for (const id of ['borrow', 'challenge']) {
    const short = gapModel(id, { regulation: 7 }).factor;
    const long = gapModel(id, { regulation: 9 }).factor;
    assert.ok(short > long, `${id}: 7回制(${short.toFixed(3)}) > 9回制(${long.toFixed(3)})`);
  }
});

test('チーム差: 平均を動かすと「1点以上入る確率」もついてくる', () => {
  // 平均だけ動かして0点率を据え置くと、「点は入りにくいが入ると大量点」に歪む
  const d = priorDist(0.5, 0.25);
  const up = scaleDist(d, 1.5);
  const mean = (a) => a.reduce((s, p, k) => s + p * k, 0);
  // priorDist は12点で打ち切るので、平均はその分わずかに足りない。
  // 見たいのは絶対値ではなく比なので、比で確かめる
  assert.ok(Math.abs(mean(up) / mean(d) - 1.5) < 1e-3, `平均は1.5倍になる: ${(mean(up) / mean(d)).toFixed(5)}`);
  assert.ok(1 - up[0] > 1 - d[0], '0点で終わる確率は下がる');
  // s ≒ RE^0.894 の関係(NPBの2つの表から測った傾き)
  assert.ok(Math.abs((1 - up[0]) - 0.25 * Math.pow(1.5, S_EXP)) < 1e-6);
  assert.deepEqual([...scaleDist(d, 1)], [...d], '倍率1なら何もしない');
});

test('チーム差: 指数0.894はNPBの2つの表から測った値で、よく合っている', () => {
  // 借り物の係数ではなく、載せている表そのものから出した値であること
  const keys = Object.keys(BASE_RE);
  let n = 0; let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (const k of keys) {
    const x = Math.log(BASE_RE[k]); const y = Math.log(SCORE_PROB[k]);
    n += 1; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  assert.equal(Number(slope.toFixed(3)), S_EXP, 'コードの指数は回帰の傾きと一致する');
});

test('チーム差: 5段階の勝率は両端を0/100%にしていない', () => {
  // 勝率0%からは動きようがない。WPAが全員ゼロになり、線が真っ平らになる
  for (const g of TEAM_GAPS) {
    assert.ok(g.win > 0 && g.win < 1, `${g.id}: ${g.win}`);
  }
  assert.equal(TEAM_GAPS.length, 5);
  assert.equal(gapOf('even').win, 0.5);
  assert.equal(gapOf('存在しないid').id, 'even', '知らない値は互角に倒す');
});

test('チーム差: 勝率モデルは攻撃側と守備側で別の分布を使える', () => {
  const dists = gapDists();
  const base = { isHome: false, regulation: 7, halfStartKey: () => '000|0' };
  const at = (we) => we({ inning: 1, isTop: true, runners: { 1: false, 2: false, 3: false }, outs: 0, diff: 0 });
  // oppDists を渡さなければ今までどおり(片方だけの分布)
  assert.ok(Math.abs(at(buildWinModel({ dists, ...base })) - 0.5) < 1e-9, '同じ分布なら五分');
  // 相手だけ強くすれば勝率は下がる
  const weaker = buildWinModel({ dists, oppDists: scaleDists(dists, 1.3), ...base });
  assert.ok(at(weaker) < 0.5, '相手の攻撃だけ上げれば勝率は下がる');
});

test('チーム差: 新しい試合の既定は互角', () => {
  assert.equal(newGame({}).teamGap, 'even');
  assert.equal(newGame({ teamGap: 'challenge' }).teamGap, 'challenge');
});


// ============================================================
// チーム差を入れたあとの穴(監査で見つけたもの)
// ============================================================

test('監査: 記録員の通算は、どの試合を開いていても同じ数字になる', () => {
  // 直した不具合。呼び出し側が「いま開いている試合のモデル」を1つ渡して
  // 全試合を数えていたので、先攻/後攻・規定回数・力の差が混ざり、
  // 同じ記録員の通算が「どの画面から見たか」で変わっていた
  const pa = (id, inn, isTop, kind, r, o, runs = 0) => ({
    id, gameId: 'x', inning: inn, isTop, kind, text: '',
    payload: { beforeRunners: { 1: !!r[0], 2: !!r[1], 3: !!r[2] }, outsBefore: o, runs },
  });
  const mk = (id, isHome, teamGap) => ({
    id, isHome, teamGap, scorerId: 's1', rules: { innings: 7 },
    playLogs: [
      pa('a1', 1, true, 'atbat', [0, 0, 0], 0),
      pa('a2', 1, true, 'atbat', [1, 0, 0], 0, 3),
      { id: 't1', gameId: id, inning: 1, isTop: true, kind: 'flow', text: '', payload: { dir: 'up' } },
      pa('a3', 1, true, 'atbat', [0, 0, 0], 1),
      pa('b1', 1, false, 'defense', [0, 0, 0], 0),
      pa('b2', 1, false, 'defense', [1, 1, 0], 0, 2),
    ],
  });
  const games = [mk('g1', false, 'even'), mk('g2', true, 'challenge')];
  const { re } = buildRunExpectancy([], '草野球');
  const { dists } = buildRunDists([], '草野球', re);
  const modelFor = (g) => buildWinModel({
    dists, isHome: !!g.isHome, regulation: 7, halfStartKey: () => '000|0',
  });

  const over = aggregateScorersOver(games, modelFor).s1;
  // 1試合ずつ数えて足したものと、まとめて数えたものが一致すること
  const one = aggregateScorersOver([games[0]], modelFor).s1;
  const two = aggregateScorersOver([games[1]], modelFor).s1;
  for (const k of ['games', 'tags', 'pre', 'post', 'miss', 'swings', 'caught']) {
    assert.equal(over[k], one[k] + two[k], `${k} が試合ごとの合計と一致する`);
  }
  // 壊れていたやり方(1つのモデルで全試合)は、渡すモデルによって答えが変わる。
  // 直したやり方は、どの試合から呼んでも同じ
  const viaG1 = aggregateScorersOver(games, modelFor).s1;
  const viaG2 = aggregateScorersOver([...games].reverse(), modelFor).s1;
  assert.deepEqual(
    ['games', 'tags', 'pre', 'swings', 'caught'].map((k) => viaG1[k]),
    ['games', 'tags', 'pre', 'swings', 'caught'].map((k) => viaG2[k]),
    '並び順にも開いている試合にも依らない',
  );
});

test('監査: 力の差を入れた試合は、流れタグのしきい値も一緒に縮む', () => {
  // 「胸を借りる」の試合は勝率が動ける幅そのものが狭い。互角前提の12%のままだと、
  // 記録員がどれだけ正しく読んでも「大きく動いた」が成立せず、勝率ポイントが0に沈む
  const even = swingScale({ teamGap: 'even' });
  assert.equal(even.minSwing, OPEN_MIN_SWING, '互角は今までどおり');
  assert.equal(even.reactSwing, OPEN_REACT_SWING);
  const hard = swingScale({ teamGap: 'borrow' });
  assert.ok(hard.minSwing < even.minSwing * 0.4, `胸を借りるは大きく縮む: ${hard.minSwing}`);
  // 縮めすぎると誤差を拾うので下限がある
  assert.ok(hard.minSwing >= OPEN_MIN_SWING * 0.25 - 1e-12, '下限を割らない');
  // 対称: 勝率5%と95%は同じだけ狭い
  assert.equal(swingScale({ teamGap: 'lend' }).minSwing, hard.minSwing);
  // 設定が無い古い試合は互角あつかい
  assert.equal(swingScale({}).minSwing, OPEN_MIN_SWING);
  assert.equal(swingScale(null).minSwing, OPEN_MIN_SWING);
});

test('監査: しきい値の縮め方が、実際の勝率の動きの縮み方と合っている', () => {
  // 4p(1-p) は思いつきではなく、実際の圧縮率に合っていることを確かめる
  const { re } = buildRunExpectancy([], '草野球');
  const { dists } = buildRunDists([], '草野球', re);
  const move = (gap) => {
    const m = buildGapModel({ dists, isHome: false, regulation: 7, halfStartKey: () => '000|0', gap });
    const a = m.we({ inning: 1, isTop: true, runners: { 1: false, 2: false, 3: false }, outs: 0, diff: 0 });
    const b = m.we({ inning: 1, isTop: true, runners: { 1: true, 2: true, 3: true }, outs: 0, diff: 0 });
    return b - a;
  };
  const ratio = move('borrow') / move('even');           // 実際の圧縮率
  const scaled = swingScale({ teamGap: 'borrow' }).minSwing / OPEN_MIN_SWING; // しきい値の縮め方
  assert.ok(Math.abs(ratio - scaled) < 0.1,
    `実際 ${ratio.toFixed(3)} としきい値 ${scaled.toFixed(3)} が近い`);
});

test('監査: ヒートマップの色の物差しが振り切れない', () => {
  // 上限を2.6に固定していたら、「胸を借りる」の守備時24マス中8マスが振り切れて
  // 全部おなじ真っ赤になり、どこが重い場面か読めなくなっていた
  const { re } = buildRunExpectancy([], '草野球');
  const { dists } = buildRunDists([], '草野球', re);
  for (const gap of ['even', 'challenge', 'borrow', 'lend']) {
    const m = buildGapModel({ dists, isHome: false, regulation: 7, halfStartKey: () => '000|0', gap });
    const { off, def } = gapTables(re, m.factor);
    const top = Math.max(2.6, ...[...off.values(), ...def.values()]);
    for (const [k, v] of def) assert.ok(v <= top, `${gap} ${k}: 守備時が物差しに収まる`);
    for (const [k, v] of off) assert.ok(v <= top, `${gap} ${k}: 攻撃時が物差しに収まる`);
    // 攻撃時と守備時で同じ物差しであること(別々だと「守備が赤い」の意味が消える)
    assert.ok(top >= Math.max(...[...def.values()]), '2枚の大きいほうに合わせる');
  }
});


// ============================================================
// 監査: 再集計で自責点の判定が消えていた
//
// 実際に起きうる筋道:
//   1. 失策絡みの失点を、記録員がその場で「非自責」と付ける(防御率に響かない)
//   2. あとから投手交代を直す → 投手成績の再集計が走る
//   3. 非自責の判定が読まれず、全部が自責に戻って防御率が黙って悪化する
// 判定はログに残っているので、再集計でも同じ数え方をする。
// ============================================================
const erGame = (payload) => ({
  id: 'g', isHome: true, status: 'finished', inning: 1, isTop: true,
  pitchingRecords: [{ id: 'r1', playerId: 'p1', runs: 0, earnedRuns: 0, outsRecorded: 0 }],
  startingPitcherId: 'p1', currentPitcherId: 'p1',
  playLogs: [
    { id: 'd1', kind: 'defense', inning: 1, isTop: true, payload },
    { id: 'd2', kind: 'defense', inning: 1, isTop: true, payload: { result: 'so', runs: 0, outsOnPlay: 3 } },
  ],
});
const erOf = (payload) => rebuildPitchingStats(erGame(payload)).records[0];

test('監査: 再集計しても「非自責」の判定が残る', () => {
  const r = erOf({ result: 'error', runs: 2, outsOnPlay: 0, unearnedRuns: { 2: true, 3: true }, unearnedBatter: true });
  assert.equal(r.runs, 2, '失点には入る');
  assert.equal(r.earnedRuns, 0, '自責点にはしない');
});

test('監査: 非自責が付いていない失点は、これまでどおり自責点', () => {
  const r = erOf({ result: 'single', runs: 2, outsOnPlay: 0 });
  assert.equal(r.earnedRuns, 2);
});

test('監査: 同じ打席で自責と非自責が混ざっても数を取り違えない', () => {
  const r = erOf({ result: 'single', runs: 2, outsOnPlay: 0, unearnedRuns: { 3: true } });
  assert.equal(r.earnedRuns, 1, '2失点のうち1つだけ外す');
});

test('監査: 非自責の印が失点数より多くても、自責点は負にならない', () => {
  const r = erOf({ result: 'error', runs: 1, outsOnPlay: 0, unearnedRuns: { 1: true, 2: true, 3: true }, unearnedBatter: true });
  assert.equal(r.earnedRuns, 0);
  assert.ok(r.earnedRuns >= 0);
});

test('監査: 再集計の数え方が、その場の記録(addRun)と同じになっている', () => {
  // live と再集計で食い違うと、画面を開き直すたびに防御率が変わる
  const cases = [
    { result: 'error', runs: 1, unearnedBatter: true, live: 0 },
    { result: 'error', runs: 1, unearnedBatter: false, live: 1 },
    { result: 'single', runs: 1, unearnedRuns: { 3: true }, live: 0 },
    { result: 'single', runs: 1, live: 1 },
  ];
  for (const c of cases) {
    const { live, ...payload } = c;
    assert.equal(erOf({ ...payload, outsOnPlay: 0 }).earnedRuns, live,
      `${c.result} runs=${c.runs}: その場の記録と一致する`);
  }
});


// ============================================================
// インフィールドフライ
//
// 一二塁(満塁を含む)・2アウト未満でしか宣告されない。打者は捕球されなくても
// アウトで、走者は自分の危険で進める。フライだが犠飛にはならない。
// 場面が成り立たないのに選べると、記録としてそのまま誤りになる。
// ============================================================
test('インフィールドフライ: 一二塁・2アウト未満のときだけ宣告されうる', () => {
  const on = (a, b, c) => ({ 1: a, 2: b, 3: c });
  assert.equal(infieldFlyPossible(on(1, 1, 0), 0), true, '一二塁・無死');
  assert.equal(infieldFlyPossible(on(1, 1, 0), 1), true, '一二塁・1死');
  assert.equal(infieldFlyPossible(on(1, 1, 1), 0), true, '満塁');
  assert.equal(infieldFlyPossible(on(1, 1, 0), 2), false, '2アウトでは宣告されない');
  assert.equal(infieldFlyPossible(on(1, 0, 0), 0), false, '一塁だけでは成立しない');
  assert.equal(infieldFlyPossible(on(0, 1, 0), 0), false, '二塁だけでは成立しない');
  assert.equal(infieldFlyPossible(on(0, 1, 1), 0), false, '二三塁は対象外(封殺の状況ではない)');
  assert.equal(infieldFlyPossible(on(0, 0, 0), 0), false, '走者なし');
  assert.equal(infieldFlyPossible(null, 0), false, '走者が無くても落ちない');
});

test('インフィールドフライ: 打数に数えるアウトで、犠飛にはならない', () => {
  // result は 'out' のまま。内訳(outType)だけが ifly。
  // 結果種別を増やすと打率の分母を通る道が二重になる
  assert.equal(OUT_TYPES.ifly, 'インフィールドフライ');
  assert.equal(RESULTS_FOR_OUT.out.ab, true, '打数に数える');
  assert.equal(RESULTS_FOR_OUT.out.onBase, false, '打者はアウト');
  // 犠飛の自動認定は outType === 'fly' が条件。ifly はそこに入らない
  assert.notEqual('ifly', 'fly');
});

test('インフィールドフライ: 表示名は全エディション共通', () => {
  // 少年野球で言い換えるのは併殺打(ゲッツー)だけ。規則の名前は変えない
  for (const ed of ['草野球', 'ブカツ(中高大)', '少年野球']) {
    assert.equal(outTypeLabel('ifly', ed), 'インフィールドフライ', ed);
  }
  assert.equal(outTypeLabel('dp', '少年野球'), 'ゲッツー', '併殺打だけは言い換える');
});


// ============================================================
// 音声: インフィールドフライ
//
// 実際に起きた不具合。「インフィールドフライ」と言うと「フライ・アウト」に
// なっていた。辞書に無いので、中に含まれる「フライ」だけが拾われていた。
// ============================================================
test('音声: インフィールドフライを言い当てる', () => {
  for (const say of ['インフィールドフライ', 'ショートへインフィールドフライ',
    'インフィールドフライアウト', 'インフィールドフライで1アウト', 'いんふぃーるどふらい']) {
    const c = parseUtterance(say)[0];
    assert.equal(c?.result, 'out', `${say}: アウト`);
    assert.equal(c?.outType, 'ifly', `${say}: インフィールドフライ`);
  }
  // 方向も一緒に読める
  assert.equal(parseUtterance('ショートへインフィールドフライ')[0].direction, 'SS');
});

test('音声: ただの「フライ」はインフィールドフライにしない', () => {
  for (const say of ['センターフライ', 'ショートフライ', 'ファウルフライ', '詰まったフライ']) {
    const c = parseUtterance(say)[0];
    assert.equal(c?.outType, 'fly', `${say}: ふつうのフライ`);
  }
});

test('音声: 「インフィールドヒット」を食わない', () => {
  // あいまい一致だと「インフィールドフライ」に化ける(10文字あるので「ヒット」より強い)。
  // 実際に「ふらい」と言っていなければ落とす、というガードが要る
  for (const say of ['インフィールドヒット', '内野安打']) {
    const c = parseUtterance(say)[0];
    assert.equal(c?.result, 'single', `${say}: 内野安打は単打`);
    assert.notEqual(c?.outType, 'ifly', `${say}: インフィールドフライにしない`);
  }
});

test('音声: インフィールドフライは画面で走者を確かめさせる', () => {
  // 打者は捕球されなくてもアウトで、走者は自分の危険で進める。
  // 走者の処理が割れるので、併殺と同じく確認を挟む
  assert.equal(needsComplexConfirm({ kind: 'play', result: 'out', outType: 'ifly' }), true);
  assert.equal(needsComplexConfirm({ kind: 'play', result: 'out', outType: 'dp' }), true);
  assert.equal(needsComplexConfirm({ kind: 'play', result: 'out', outType: 'fly' }), false);
});

test('音声: 軌道ではないので、ヒットには付かない', () => {
  // dp と同じ。「インフィールドフライ」と言いつつヒットと解釈された場合に
  // outType だけ残ると、打球の軌道として保存されてしまう
  const c = parseUtterance('インフィールドヒット')[0];
  assert.equal(c?.outType ?? null, null);
});


// ============================================================
// 音声辞書の点検で見つかったもの
// ============================================================

test('音声: 妨害3種を聞き取れる', () => {
  // スコア入力パッドには前からあるのに辞書に無く、「打撃妨害」が単打として
  // 通っていた。黙って別の記録になるのがいちばん困る
  const want = {
    打撃妨害: 'interference',
    キャッチャー妨害: 'interference',
    守備妨害: 'fieldInterference',
    走塁妨害: 'obstruction',
    オブストラクション: 'obstruction',
  };
  for (const [say, result] of Object.entries(want)) {
    const c = parseUtterance(say)[0];
    assert.equal(c?.result, result, `${say} → ${result}`);
  }
});

test('音声: 妨害3種は必ず画面で確かめる', () => {
  // 誰がアウトになり走者がどこまで進むかが場面で変わる
  for (const result of ['interference', 'fieldInterference', 'obstruction']) {
    assert.equal(needsComplexConfirm({ kind: 'play', result }), true, result);
  }
});

test('音声: 盗塁死を盗塁成功として記録しない', () => {
  // 「死」は盗塁死の判定には入っていたが、成功側の打ち消しに入っていなかった。
  // その結果、両方が同じ確からしさで並び、先に積まれた成功が勝っていた
  const cs = parseUtterance('盗塁死')[0];
  assert.equal(cs?.kind, 'cs', '盗塁死は盗塁死');
  for (const say of ['盗塁失敗', '盗塁でアウト', '二塁で刺された盗塁']) {
    assert.equal(parseUtterance(say)[0]?.kind, 'cs', say);
  }
  // 成功はこれまでどおり
  for (const say of ['盗塁成功', '盗塁', 'ダブルスチール']) {
    assert.equal(parseUtterance(say)[0]?.kind, 'sb', say);
  }
});

test('音声: 二盗・三盗も盗塁として拾う', () => {
  for (const say of ['二盗', '三盗']) {
    assert.equal(parseUtterance(say)[0]?.kind, 'sb', say);
  }
});

test('音声: 暴投・捕逸・牽制死・ボークを聞き取れる', () => {
  // 記録できる出来事なのに辞書に無く、「ワイルドピッチ」が単打、
  // 「パスボール」が四球として通っていた
  const want = {
    ワイルドピッチ: 'wp', 暴投: 'wp',
    パスボール: 'pb', 捕逸: 'pb',
    牽制死: 'pickoff', ピックオフ: 'pickoff',
    ボーク: 'balk',
  };
  for (const [say, kind] of Object.entries(want)) {
    const c = parseUtterance(say)[0];
    assert.equal(c?.kind, kind, `${say} → ${kind}`);
    assert.equal(c?.result ?? null, null, `${say} は打席結果ではない`);
  }
});

test('音声: 「ボーク」を「ボール」と取り違えない', () => {
  assert.equal(parseUtterance('ボーク')[0]?.kind, 'balk');
  assert.equal(parseUtterance('ボール')[0]?.pitchType, 'ball');
});

test('音声: 打席の結果は走者イベントに食われない', () => {
  // 走者イベントを先に見るようにしたので、ふつうの打撃が巻き込まれないこと
  const keep = {
    'ライト前ヒット': 'single', 'ショートゴロ': 'out', 'フォアボール': 'bb',
    'デッドボール': 'hbp', '見逃し三振': 'so', 'ショートのエラー': 'error',
    '送りバント': 'sacBunt', '犠牲フライ': 'sacFly', 'ライトへホームラン': 'hr',
  };
  for (const [say, result] of Object.entries(keep)) {
    assert.equal(parseUtterance(say)[0]?.result, result, say);
  }
});


// ============================================================
// 大きく動いた区間に「いちばん動いた1打席」を持たせる
//
// 「5打席で25%→44%」だけでは、あとから試合を思い出せない。
// 効くのは「誰が何をしたか」なので、区間の山になった打席を1つ控えておく。
// ============================================================
test('流れ: 大きく動いた区間は、いちばん動いた打席を持っている', () => {
  const s = (id, delta) => ({ id, delta, we: 0.5, inning: 1, isTop: true, log: { id } });
  // 上げ幅: 0.1 → 0.5 → 0.1 (真ん中がいちばん大きい)
  const runs = flowRuns([s('a', 0.1), s('b', 0.5), s('c', 0.1)], 0.6);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].peak.id, 'b', '山になった打席を持つ');
  assert.equal(runs[0].n, 3);
  assert.equal(Number(runs[0].swing.toFixed(2)), 0.7);
});

test('流れ: 1打席だけの区間は、その打席が山', () => {
  const s = (id, delta) => ({ id, delta, we: 0.5, inning: 1, isTop: true, log: { id } });
  const runs = flowRuns([s('a', 0.8)], 0.6);
  assert.equal(runs[0].peak.id, 'a');
});

test('流れ: 下げの区間でも、いちばん動いた打席は絶対値で選ぶ', () => {
  const s = (id, delta) => ({ id, delta, we: 0.5, inning: 1, isTop: true, log: { id } });
  const runs = flowRuns([s('a', -0.2), s('b', -0.7), s('c', -0.1)], 0.6);
  assert.equal(runs[0].peak.id, 'b');
  assert.equal(runs[0].dir, -1);
});

test('表示: 日本語のプレイ名に余計な空白を入れない', () => {
  // 「左翼 ホームラン」になっていた。凡打の行は元から空白なしで不揃いだった
  assert.equal(playLabel('single', 'LF', null, null, undefined, 'ja'), '左翼ヒット');
  assert.equal(playLabel('hr', 'LF', null, null, undefined, 'ja'), '左翼ホームラン');
  assert.equal(playLabel('out', 'SS', 'ground', null, undefined, 'ja'), '遊撃ゴロ・アウト');
  // 英語は語の区切りに空白が要る
  assert.equal(playLabel('single', 'LF', null, null, undefined, 'en'), 'LF Hit');
});


// ============================================================
// 区間のできごとを文章にする(下書き)
//
// 打席をそのまま「、」でつなぐと表になる。読めるが実況にも解説にもならない。
// 続けて打ち取った打者はまとめ、回が変わるところで文を切り、点は点差で
// 呼び分ける。回と勝率は左の欄に出ているので文章では繰り返さない。
// ============================================================
const nrT = (k, p) => translate('ja', k, p);
const nrNames = { p1: '平山', p2: '秦', p3: '若山', p4: '竹丸' };
const nrCtx = (score = {}) => ({
  nameOf: (id) => nrNames[id] || id, oppNameOf: (l) => l,
  edition: '草野球', lang: 'ja', t: nrT,
  innOf: (s) => `${s.inning}回${s.isTop ? '表' : '裏'}`,
  scoreBefore: (x) => score[x.id] || { my: 0, opp: 0 },
  teamName: '自チーム', oppName: '相手チーム',
});
const nrPa = (id, who, result, dir, runs, mine = true, delta = 0.08, inning = 1, isTop = true, order = null) => ({
  id, mine, delta, we: 0.5, inning, isTop,
  log: { id, payload: { playerId: who, letter: who, order, result, direction: dir, runs, beforeRunners: {} } },
});
const nrRun = (items) => ({ items, from: items[0], to: items[items.length - 1], n: items.length, dir: 1 });

test('物語: 回と勝率は繰り返さない(左の欄に出ている)', () => {
  const s = draftNarrative(nrRun([nrPa('a', 'p1', 'single', 'LF', 1)]), nrCtx({ a: { my: 0, opp: 0 } }));
  assert.ok(!s.includes('打席'), `打席数を繰り返さない: ${s}`);
  assert.ok(!s.includes('勝率'), `勝率を繰り返さない: ${s}`);
  assert.ok(!/^\d+回/.test(s), `回から始めない: ${s}`);
});

// ---- ブカツの学校区分 ----
// 中学・高校・大学は回数もコールドも球数制限も違う。選んだ区分が
// 試合開始時のルールの既定とAI記事の言い方の両方に効く。
test('学校区分: ブカツの既定ルールが中学・高校・大学で変わる', () => {
  assert.equal(defaultPresetIdForEdition('ブカツ(中高大)', 'junior'), 'chu7');
  assert.equal(defaultPresetIdForEdition('ブカツ(中高大)', 'high'), 'koko9');
  assert.equal(defaultPresetIdForEdition('ブカツ(中高大)', 'university'), 'daigaku9');
  // 中学は7回制で球数制限あり、高校は9回制でコールドあり
  assert.equal(presetById('chu7').rules.innings, 7);
  assert.equal(presetById('chu7').rules.pitchLimit.perGame, 100);
  assert.equal(presetById('koko9').rules.innings, 9);
  assert.ok(presetById('koko9').rules.mercy.length > 0);
  // 他のエディションは今までどおり
  assert.equal(defaultPresetIdForEdition('草野球'), 'kusa7');
  assert.equal(defaultPresetIdForEdition('少年野球'), 'gakudo6');
});

test('学校区分: 前の試合のプリセットは同じエディションのときだけ引き継ぐ', () => {
  // 高校の設定で、前回が中学のプリセットでも引き継ぐ(同じエディションなので
  // 記録員が意図して選んだとみなす)
  assert.equal(initialPresetIdFor('chu7', 'ブカツ(中高大)', 'high'), 'chu7');
  // 別のエディションのものは持ち込まない。区分の既定に戻る
  assert.equal(initialPresetIdFor('gakudo6', 'ブカツ(中高大)', 'university'), 'daigaku9');
  assert.equal(initialPresetIdFor(null, 'ブカツ(中高大)', 'junior'), 'chu7');
});

test('区分: エディションごとに選べるものが違う', () => {
  assert.deepEqual(kindsFor('ブカツ(中高大)'), ['junior', 'high', 'university']);
  assert.deepEqual(kindsFor('草野球'), ['kusa', 'shakaijin']);
  assert.deepEqual(kindsFor('少年野球'), ['elementary'], '少年野球は1つなので選ばせない');
});

test('区分: 保存先はエディションで分かれるが、読み書きは1か所', () => {
  // schoolType は学年と卒業の判定にも使う既存の設定。社会人の区分は混ぜられない
  assert.deepEqual(kindPatch('草野球', 'shakaijin'), { adultType: 'shakaijin' });
  assert.deepEqual(kindPatch('ブカツ(中高大)', 'high'), { schoolType: 'high' });
  // 読むときは1つの関数で済む
  assert.equal(kindOf({ edition: '草野球', adultType: 'shakaijin', schoolType: 'high' }), 'shakaijin',
    '草野球のときは schoolType を見ない');
  assert.equal(kindOf({ edition: 'ブカツ(中高大)', adultType: 'shakaijin', schoolType: 'junior' }), 'junior',
    'ブカツのときは adultType を見ない');
  assert.equal(kindOf({ edition: '草野球' }), 'kusa', '未設定は草野球');
  assert.equal(kindOf({ edition: 'ブカツ(中高大)' }), 'high', '未設定は高校');
  assert.equal(defaultKindFor('少年野球'), 'elementary');
});

test('区分: 草野球と社会人で既定ルールが変わる', () => {
  assert.equal(defaultPresetIdForEdition('草野球', 'kusa'), 'kusa7');
  assert.equal(defaultPresetIdForEdition('草野球', 'shakaijin'), 'shakaijin9');
  assert.equal(presetById('kusa7').rules.innings, 7);
  assert.equal(presetById('kusa7').rules.timeLimitMin, 90);
  assert.equal(presetById('shakaijin9').rules.innings, 9);
  assert.equal(presetById('shakaijin9').rules.timeLimitMin, null, '社会人の公式戦は時間制限なし');
});

test('区分: AI記事と表示名も草野球・社会人で分かれる', () => {
  assert.ok(editionForPrompt('草野球', 'shakaijin').includes('社会人野球'));
  assert.ok(editionForPrompt('草野球', 'kusa').includes('草野球'));
  assert.equal(editionLabel('草野球', 'shakaijin'), '社会人・クラブ');
  assert.equal(editionLabel('草野球', 'kusa'), '草野球');
  assert.equal(editionLabel('草野球'), '草野球・社会人', '未設定なら今までどおり両方を並べる');
});

test('学校区分: AI記事の言い方も区分ごとに変わる', () => {
  assert.equal(editionForPrompt('ブカツ(中高大)', 'high'), '高校野球');
  assert.equal(editionForPrompt('ブカツ(中高大)', 'university'), '大学野球');
  assert.ok(editionForPrompt('ブカツ(中高大)', 'junior').includes('中学'));
  // 区分が決まっていなければ、これまでどおり中高大とだけ伝える
  assert.equal(editionForPrompt('ブカツ(中高大)'), '中学・高校・大学の部活動の野球');
  assert.ok(newspaperPrompt('x', { edition: 'ブカツ(中高大)', schoolType: 'high' }).includes('高校野球'));
});

test('学校区分: ヘッダーの表示にも出る', () => {
  assert.equal(editionLabel('ブカツ(中高大)', 'high'), 'ブカツ(高校)');
  assert.equal(editionLabel('ブカツ(中高大)', 'junior'), 'ブカツ(中学)');
  assert.equal(editionLabel('ブカツ(中高大)'), 'ブカツ(中高大)', '未設定なら今までどおり');
  assert.equal(editionLabel('草野球', 'high'), '草野球・社会人', '草野球には付けない');
});

// ---- AIスポーツ新聞のプロンプト ----
// 報告のあった不具合: ブカツで大会を甲子園にしてあるのに、記事が
// 「手に汗握る草野球頂上決戦」「草野球の神も苦笑い」になっていた。
// プロンプトに「草野球の試合ですが」と直書きしてあり、エディションも
// 大会名も渡していなかった。
test('新聞: 種別を勝手に草野球にしない', () => {
  const p = newspaperPrompt('スコア: 4-3', { edition: 'ブカツ(中高大)', season: '甲子園' });
  assert.ok(!p.includes('草野球の試合'), `草野球と決めつけない: ${p.slice(0, 200)}`);
  assert.ok(p.includes('中学・高校・大学の部活動の野球'), '実際の種別を渡す');
  assert.ok(p.includes('甲子園'), '大会名を渡す');
});

test('新聞: 少年野球・草野球もそれぞれの言い方で渡る', () => {
  assert.equal(editionForPrompt('少年野球'), '少年野球(小学生)');
  assert.equal(editionForPrompt('草野球'), '草野球(社会人の趣味の野球)');
  assert.equal(editionForPrompt(undefined), '草野球(社会人の趣味の野球)', '未設定は既定のまま');
  assert.ok(newspaperPrompt('x', { edition: '少年野球' }).includes('少年野球(小学生)'));
});

test('新聞: 大会名が無いときは大会に触れさせない', () => {
  const p = newspaperPrompt('スコア: 4-3', { edition: '草野球', season: '' });
  assert.ok(p.includes('大会には触れないこと'), p.slice(0, 300));
});

test('新聞: 記録に無いことを書かせない歯止めを入れる', () => {
  // 記事に「捕逸を誘い」と書かれていたが、その別は渡していない
  const p = newspaperPrompt('スコア: 4-3', { edition: '草野球' });
  assert.ok(p.includes('勝手に決めない'), '種別・大会名を勝手に決めさせない');
  assert.ok(p.includes('段階'), '回戦・決勝を勝手に付けさせない');
  assert.ok(p.includes('事実として書かない'), '記録に無いことを書かせない');
});

test('物語: 犠打は「倒れ」ではない', () => {
  // 報告のあった場面: 8回の送りバントが「6番・松本がバントに倒れ」と書かれていた。
  // 実際は狙って走者を進めた成功したプレイで、試合を決めた1つだった。
  const items = [nrPa('a', 'p1', 'sacBunt', 'P', 0, true, 0.05, 8, false, 6)];
  const s = draftNarrative(nrRun(items), nrCtx());
  assert.ok(!s.includes('倒れ'), `打ち取られた言い方にしない: ${s}`);
  assert.ok(s.includes('送りバント'), `送りバントだと分かる: ${s}`);
  assert.ok(s.includes('6番・平山'), `打順と名前が出る: ${s}`);
});

test('物語: 犠打は「出塁」にもしない', () => {
  // 打ち取られた側から外すだけだと、今度は出塁した側にまとめられてしまう
  const items = [
    nrPa('a', 'p1', 'single', 'LF', 0, true, 0.05),
    nrPa('b', 'p2', 'sacBunt', 'P', 0, true, 0.03),
  ];
  const s = draftNarrative(nrRun(items), nrCtx());
  assert.ok(!/連打|続けて出塁/.test(s), `犠打を出塁にまとめない: ${s}`);
  assert.ok(s.includes('送りバント'), s);
});

test('物語: 点が入った犠打・犠飛は点の入り方で言う', () => {
  const items = [nrPa('a', 'p3', 'sacFly', 'CF', 1, true, 0.12)];
  const s = draftNarrative(nrRun(items), nrCtx({ a: { my: 0, opp: 0 } }));
  assert.ok(s.includes('犠牲フライ'), s);
  assert.ok(s.includes('先制'), `点の入り方はそのまま: ${s}`);
  assert.ok(!s.includes('倒れ'), s);
});

test('物語: 出塁していない打席で入った点は「その打席で取った」と書かない', () => {
  // 同じ文に「8番・山下の空振り三振で勝ち越し」と出ていた。三振が点を取ることはない。
  // 暴投・捕逸・失策で還っているので、その打席の「間に」入ったと書く。
  const items = [nrPa('a', 'p4', 'so', null, 1, true, 0.2)];
  const s = draftNarrative(nrRun(items), nrCtx({ a: { my: 0, opp: 0 } }));
  assert.ok(s.includes('の間に'), `打席の間に入ったと書く: ${s}`);
  assert.ok(!/三振で先制|三振で\d点/.test(s), `三振が点を取ったようには書かない: ${s}`);
});

test('物語: 出塁した打席の点は今までどおり「その打席で」', () => {
  const items = [nrPa('a', 'p1', 'single', 'LF', 1)];
  const s = draftNarrative(nrRun(items), nrCtx({ a: { my: 0, opp: 0 } }));
  assert.ok(!s.includes('の間に'), `安打は打った本人の点: ${s}`);
  assert.ok(s.includes('先制'), s);
});

test('物語: 相手の犠打は「打ち取った」にしない', () => {
  const items = [nrPa('a', 'C', 'sacBunt', 'P', 0, false, -0.04)];
  const s = draftNarrative(nrRun(items), nrCtx());
  assert.ok(!s.includes('打ち取'), `決められた側の言い方にする: ${s}`);
  assert.ok(s.includes('送りバント'), s);
});

test('物語: 続けて打ち取った打者はまとめる', () => {
  const items = [
    nrPa('1', 'C', 'out', 'SS', 0, false, -0.05),
    nrPa('2', 'D', 'out', '1B', 0, false, -0.05),
    nrPa('3', 'E', 'out', 'LF', 0, false, -0.05),
  ];
  const s = draftNarrative(nrRun(items), nrCtx());
  assert.equal(s, '相手チームのC、D、Eを連続で打ち取った。', s);
});

test('物語: 回が変わるところで文を切り、次の回を頭に置く', () => {
  const items = [
    nrPa('1', 'C', 'out', 'SS', 0, false, -0.05, 1, false),
    nrPa('2', 'p1', 'single', 'LF', 0, true, 0.12, 2, true),
  ];
  const s = draftNarrative(nrRun(items), nrCtx());
  assert.ok(s.includes('。続く2回表、'), s);
  assert.ok(s.includes('打ち取った'), '回をまたぐ手前は言い切る');
});

test('物語: 続けて出塁した打者は連打としてまとめる', () => {
  const items = ['a', 'b', 'c', 'd'].map((id, i) =>
    nrPa(id, `p${i + 1}`, 'single', '3B', 1, true, 0.06));
  const s = draftNarrative(nrRun(items), nrCtx({ a: { my: 0, opp: 0 } }));
  assert.equal(s, '自チームは平山、秦、若山、竹丸の4連打で4点、先制。', s);
});

test('物語: 点は点差で呼び分ける', () => {
  const one = (id, before, mine = true, runs = 1, result = 'single') =>
    draftNarrative(nrRun([nrPa(id, 'p1', result, 'LF', runs, mine, 0.15)]), nrCtx({ [id]: before }));
  assert.ok(one('a', { my: 0, opp: 0 }).includes('先制'), '0-0からは先制');
  assert.ok(one('b', { my: 2, opp: 3 }).includes('同点'), '1点差を追いついたら同点');
  assert.ok(one('c', { my: 2, opp: 3 }, true, 2).includes('逆転'), '追い越したら逆転');
  assert.ok(one('d', { my: 3, opp: 3 }).includes('勝ち越し'), '同点から勝てば勝ち越し');
  assert.ok(one('e', { my: 5, opp: 0 }, true, 2).includes('2点'), 'ただの追加点は点数だけ');
  // 守備側は失点として言う
  assert.ok(one('f', { my: 1, opp: 0 }, false, 2, 'hr').includes('逆転'), '逆転されたと言う');
  assert.ok(one('g', { my: 5, opp: 0 }, false, 2, 'hr').includes('失点'), '大差なら失点として言う');
});

test('物語: 2点以上のときは点数も残す', () => {
  // 「逆転」だけだと何点入ったのかが消える
  const s = draftNarrative(
    nrRun([nrPa('y', 'p2', 'double', 'LF', 2, true, 0.35)]),
    nrCtx({ y: { my: 2, opp: 3 } }),
  );
  assert.ok(s.includes('2点') && s.includes('逆転'), s);
});

test('物語: ほとんど動いていない区間は文にしない', () => {
  assert.equal(draftNarrative(nrRun([nrPa('x', 'p1', 'out', 'SS', 0, true, 0.001)]), nrCtx()), '');
  assert.equal(draftNarrative(null, nrCtx()), '');
  assert.equal(draftNarrative({ items: [] }, nrCtx()), '');
});

test('物語: 落とした打席は黙って消さない', () => {
  const items = Array.from({ length: 9 }, (_, i) =>
    nrPa(`m${i}`, `p${(i % 4) + 1}`, i % 2 ? 'out' : 'single', 'LF', 0, true, 0.05));
  const s = draftNarrative(nrRun(items), nrCtx());
  assert.ok(s.includes('ほか'), `拾わなかったぶんを書く: ${s}`);
});

test('物語: 記録員が書いた文があれば、そちらを使う', () => {
  const run = nrRun([nrPa('1', 'p1', 'single', 'LF', 0)]);
  assert.equal(noteKeyOf(run), '1', '区間の先頭打席のIDで引く');
  assert.equal(noteOf({ flowNotes: { 1: 'ベンチが静かになった' } }, run), 'ベンチが静かになった');
  assert.equal(noteOf({}, run), '', '書かれていなければ空(下書きに戻る)');
  // 打席を直して区間の切れ目が変わっても、記録は壊れずに下書きへ戻るだけ
  assert.equal(noteOf({ flowNotes: { 99: 'ずれた文' } }, run), '');
});

test('物語: 打順が記録されていれば「◯番・◎◎」と呼ぶ', () => {
  // 実況が必ず打順を言うのは、打線のどこで起きたかを一言で示すため
  const s = draftNarrative(
    nrRun([nrPa('a', 'p1', 'single', 'LF', 1, true, 0.15, 1, true, 4)]),
    nrCtx({ a: { my: 0, opp: 0 } }),
  );
  assert.ok(s.includes('4番・平山'), s);
});

test('物語: 打順が無い古い記録は、名前だけで呼ぶ', () => {
  const s = draftNarrative(
    nrRun([nrPa('a', 'p1', 'single', 'LF', 1, true, 0.15)]),
    nrCtx({ a: { my: 0, opp: 0 } }),
  );
  assert.ok(s.includes('平山') && !s.includes('番'), s);
});

test('物語: まとめた打者にも打順が付く', () => {
  const items = [
    nrPa('1', 'C', 'out', 'SS', 0, false, -0.05, 1, false, 3),
    nrPa('2', 'D', 'out', '1B', 0, false, -0.05, 1, false, 4),
  ];
  assert.equal(draftNarrative(nrRun(items), nrCtx()), '相手チームの3番・C、4番・Dを連続で打ち取った。');
});

test('物語: どちらのチームの打者かを必ず言う', () => {
  // 「打ち取った」なら相手、「倒れ」なら自チーム、と動詞で暗示はできるが、
  // 回をまたぐと2つの打線が続けて出てくるので、暗示だけでは読み手が追えない
  const items = [
    nrPa('1', 'C', 'out', 'SS', 0, false, -0.05, 10, false, 9),
    nrPa('2', 'D', 'out', '1B', 0, false, -0.05, 10, false, 1),
    nrPa('3', 'p1', 'single', 'LF', 0, true, 0.12, 11, true, 6),
  ];
  const s = draftNarrative(nrRun(items), nrCtx());
  assert.ok(s.startsWith('相手チームの'), `守備の区間は相手の名前から: ${s}`);
  assert.ok(s.includes('続く11回表、自チームは'), `攻撃に変わったら自チームの名前: ${s}`);
  // どちらのチームの打者かが、名前を見なくても分かること
  assert.ok(s.indexOf('相手チーム') < s.indexOf('自チーム'), s);
});

test('物語: 側が変わらない区間でも、どちらの打線かは言う', () => {
  const items = [
    nrPa('1', 'p1', 'out', 'SS', 0, true, -0.08, 10, true, 4),
    nrPa('2', 'p2', 'out', '2B', 0, true, -0.08, 10, true, 5),
  ];
  assert.equal(draftNarrative(nrRun(items), nrCtx()), '自チームは4番・平山、5番・秦が続けて倒れた。');
});

test('物語: チーム名が同じ側で二度続けて出ない', () => {
  // 側が変わったときだけ置く。毎回付けると文がうるさくなる
  const items = [
    nrPa('1', 'p1', 'single', 'LF', 0, true, 0.08, 1, true, 1),
    nrPa('2', 'p2', 'out', 'SS', 0, true, -0.05, 1, true, 2),
    nrPa('3', 'p3', 'single', 'CF', 1, true, 0.15, 1, true, 3),
  ];
  const s = draftNarrative(nrRun(items), nrCtx({ 3: { my: 0, opp: 0 } }));
  assert.equal(s.split('自チーム').length - 1, 1, `1回だけ: ${s}`);
});

test('物語: タイブレークの回は、走者を置いて始まったことを書く', () => {
  // 実際に読み違えが起きた。無死一二塁から死球で満塁になったのに、文章は
  // 「死球で出塁」としか書かず、なぜ勝率が18ポイントも動いたのか読めなかった
  const items = [
    nrPa('1', 'A', 'out', 'SS', 0, false, -0.07, 9, false, 7),
    nrPa('2', 'B', 'out', '1B', 0, false, -0.06, 9, false, 8),
    nrPa('3', 'p1', 'hbp', null, 0, true, 0.18, 10, true, 3),
  ];
  items[2].log.payload.beforeRunners = { 1: true, 2: true };
  const after = nrPa('4', 'p2', 'out', 'SS', 0, true, -0.05, 10, true, 4);
  after.log.payload.beforeRunners = { 1: true, 2: true, 3: true };
  const s = draftNarrative(nrRun(items), {
    ...nrCtx(),
    nextInHalf: (x) => (x.id === '3' ? after : null),
    tiebreakAt: (inn) => (inn >= 10 ? '110|0' : null),
  });
  assert.ok(s.includes('タイブレークの無死一二塁から'), `始まりの走者を書く: ${s}`);
  assert.ok(s.includes('満塁'), `死球で満塁になったことを書く: ${s}`);
});

test('物語: 区間の外まで見て塁状況を出す', () => {
  // 区間の最後の打席は、区間の中だけ見ても「次」が無い。試合全体の並びから引く
  const items = [nrPa('1', 'p1', 'single', 'LF', 0, true, 0.12, 3, true, 1)];
  const after = nrPa('2', 'p2', 'out', 'SS', 0, true, -0.04, 3, true, 2);
  after.log.payload.beforeRunners = { 1: true };
  const withNext = draftNarrative(nrRun(items), { ...nrCtx(), nextInHalf: () => after });
  assert.ok(withNext.includes('一塁'), `次の打席から塁状況を読む: ${withNext}`);
  // 引けないときは、これまでどおり塁状況なしで成立する
  const without = draftNarrative(nrRun(items), nrCtx());
  assert.ok(without.includes('出塁') && !without.includes('一塁'), without);
});

test('物語: タイブレークでない回には書かない', () => {
  const items = [nrPa('1', 'p1', 'single', 'LF', 0, true, 0.12, 3, true, 1)];
  const s = draftNarrative(nrRun(items), { ...nrCtx(), tiebreakAt: () => null });
  assert.ok(!s.includes('タイブレーク'), s);
});

test('物語: 犠牲フライを「続けて出塁」に混ぜない', () => {
  // 犠飛は点は入るが打者は出塁していない。まとめに混ぜると、塁に出ていない
  // 打者を出塁させたことになる
  const items = [
    nrPa('1', 'p1', 'single', 'LF', 0, true, 0.08, 5, true, 3),
    nrPa('2', 'p2', 'sacFly', 'CF', 1, true, 0.06, 5, true, 4),
  ];
  const s = draftNarrative(nrRun(items), nrCtx({ 2: { my: 2, opp: 2 } }));
  assert.ok(!s.includes('続けて出塁'), `犠飛は出塁ではない: ${s}`);
  assert.ok(s.includes('犠牲フライ'), s);
  // 実際に塁に出た打者どうしは、これまでどおりまとめる
  const hits = [
    nrPa('1', 'p1', 'single', 'LF', 1, true, 0.1, 5, true, 1),
    nrPa('2', 'p2', 'single', 'CF', 1, true, 0.1, 5, true, 2),
  ];
  assert.ok(draftNarrative(nrRun(hits), nrCtx({ 1: { my: 2, opp: 2 } })).includes('2連打'));
});

test('物語: タイブレークの走者は、その半回の先頭から始まる区間にだけ書く', () => {
  // 半回の途中から始まる区間に「無死一二塁から」と書くと、記録に無いことを
  // 書いたことになる
  const tb = { ...nrCtx(), tiebreakAt: (inn) => (inn >= 10 ? '110|0' : null) };
  const head = nrPa('1', 'p1', 'hbp', null, 0, true, 0.18, 10, true, 3);
  head.log.payload.beforeRunners = { 1: true, 2: true };
  head.log.payload.outsBefore = 0;
  assert.ok(draftNarrative(nrRun([head]), tb).includes('タイブレークの無死一二塁から'),
    '先頭の打席なら書く');

  const mid = nrPa('2', 'p1', 'single', 'LF', 1, true, 0.12, 10, true, 5);
  mid.log.payload.beforeRunners = { 1: true };
  mid.log.payload.outsBefore = 1;
  const s = draftNarrative(nrRun([mid]), tb);
  assert.ok(!s.includes('タイブレーク'), `途中から始まる区間には書かない: ${s}`);
});

test('物語: 新しい試合は書き直しの入れ物を持っている', () => {
  assert.deepEqual(newGame({}).flowNotes, {});
});


// ============================================================
// バックアップの書き出し
//
// 設定画面の中に閉じていたが、画面が落ちたときの逃げ道としても要る。
// 設定画面まで辿り着けない場面こそ、いちばん書き出したい。
// 中身は復元側と揃っていないと意味が無いので、形を固定しておく。
// ============================================================
test('バックアップ: 復元できる形を保つ', () => {
  const p = backupPayload({
    players: [{ id: 'a' }], members: [{ id: 'm' }], games: { g1: { id: 'g1' } },
    currentGameId: 'g1', settings: { teamName: 'X' }, demoLoaded: true,
  });
  // 識別子とversionは旧バージョンのアプリで復元するための約束。変えない
  assert.equal(p.app, 'aibss-baseball-scorer');
  assert.equal(p.version, 1);
  assert.deepEqual(Object.keys(p), [
    'app', 'version', 'exportedAt', 'players', 'members', 'games',
    'currentGameId', 'settings', 'demoLoaded',
  ]);
  assert.equal(p.currentGameId, 'g1');
  assert.equal(Object.keys(p.games).length, 1);
});

test('バックアップ: 状態が壊れていても書き出せる形になる', () => {
  // 落ちている最中に呼ばれる。ここでさらに落ちたら逃げ道が無くなる
  for (const bad of [null, undefined, {}, { games: null }]) {
    const p = backupPayload(bad);
    assert.equal(p.app, 'aibss-baseball-scorer');
    assert.deepEqual(p.players, []);
    assert.deepEqual(p.games, {});
    assert.doesNotThrow(() => JSON.stringify(p));
  }
});

test('バックアップ: ファイル名はASCIIのみ', () => {
  // 一部ブラウザは非ASCIIのdownload属性を無視する
  const name = backupFileName(new Date('2026-08-17T09:00:00Z'));
  assert.equal(name, 'aibss-backup_2026-08-17.json');
  assert.ok(/^[\x20-\x7E]+$/.test(name), name);
});


// ============================================================
// 土台の高さを、自分たちの得点環境に合わせる
//
// 少年野球には得点期待値の実測表も1試合平均得点も公開されていない。
// 「少年野球はNPBの◯倍」と書き入れると根拠のない数字になるので、倍率は
// 必ず自分たちの記録から出す。半回ごとに数えるので、24状況それぞれの平均より
// ずっと早く、その環境の高さに合う。
// ============================================================
const lvGame = (n, runsPerHalf, innings = 6) => ({
  id: `lv${n}`,
  playLogs: Array.from({ length: innings }, (_, i) => i + 1).flatMap((inn) =>
    [true, false].flatMap((isTop) =>
      Array.from({ length: 4 }, (_, k) => ({
        id: `${n}-${inn}-${isTop}-${k}`, kind: isTop ? 'atbat' : 'defense', inning: inn, isTop,
        payload: { beforeRunners: {}, outsBefore: Math.min(2, k), runs: k === 3 ? runsPerHalf : 0 },
      })))),
});

test('土台の水準: 記録が無ければ倍率は1（これまでどおり）', () => {
  const r = buildRunExpectancy([], '少年野球');
  assert.equal(r.level, 1);
  assert.equal(r.halfCount, 0);
  assert.equal(Number(r.re.get('000|0').toFixed(2)), BASE_RE['000|0']);
});

test('土台の水準: 点が入る環境ほど土台が高くなり、24状況すべてに効く', () => {
  const low = buildRunExpectancy([lvGame(1, 0), lvGame(2, 0)], '少年野球');
  const high = buildRunExpectancy([lvGame(1, 2), lvGame(2, 2)], '少年野球');
  assert.ok(high.level > low.level, `${high.level} > ${low.level}`);
  // 一度も起きていない状況にも、同じ倍率がかかっている
  for (const key of ['111|0', '011|2', '101|1']) {
    assert.equal(high.samples.get(key), 0, `${key} は一度も起きていない`);
    assert.equal(
      Number(high.re.get(key).toFixed(4)),
      Number((BASE_RE[key] * high.level).toFixed(4)),
      key,
    );
  }
});

test('土台の水準: 半回あたりの得点から出している', () => {
  const r = buildRunExpectancy([lvGame(1, 1)], '少年野球');
  assert.equal(r.halfCount, 12, '6回制なら12半回');
  assert.equal(r.halfRuns, 12, '半回1点 × 12');
  // 倍率 = (総得点 + K×土台) / (半回数 + K) / 土台
  const want = (r.halfRuns + LEVEL_K * BASE_RE['000|0']) / (r.halfCount + LEVEL_K) / BASE_RE['000|0'];
  assert.equal(Number(r.level.toFixed(4)), Number(want.toFixed(4)));
});

test('土台の水準: 倍率も寄せてあるので、1試合では振り切らない', () => {
  // 1試合の大量点で土台が跳ねると、そのあとの全部の数字が狂う
  const one = buildRunExpectancy([lvGame(1, 3)], '少年野球');
  const raw = (one.halfRuns / one.halfCount) / BASE_RE['000|0'];
  assert.ok(one.level < raw / 2, `生の比 ${raw.toFixed(2)} よりずっと控えめ: ${one.level.toFixed(2)}`);
  // 記録が増えるほど生の比へ近づく
  const many = buildRunExpectancy(Array.from({ length: 10 }, (_, i) => lvGame(i, 3)), '少年野球');
  assert.ok(many.level > one.level, '記録が増えるほど自分たちの環境へ寄る');
  assert.ok(many.levelShare > one.levelShare);
});

test('土台の水準: 壊れた記録でも外枠を越えない', () => {
  const absurd = buildRunExpectancy(Array.from({ length: 20 }, (_, i) => lvGame(i, 99)), '少年野球');
  assert.equal(absurd.level, LEVEL_MAX);
  const none = buildRunExpectancy(Array.from({ length: 20 }, (_, i) => lvGame(i, 0)), '少年野球');
  assert.equal(none.level, LEVEL_MIN);
});

test('土台の水準: 外枠は、ふつうの学童の得点環境を止めない', () => {
  // 半回1点(6回制で1チーム6点)は学童ではごく普通。ここで頭打ちになっていた
  const r = buildRunExpectancy(Array.from({ length: 6 }, (_, i) => lvGame(i, 1)), '少年野球');
  assert.ok(r.level < LEVEL_MAX, `頭打ちにならない: ${r.level}`);
  assert.ok(r.level > 1.8, `それでも土台はしっかり上がる: ${r.level}`);
});

test('土台の水準: ブカツは甲子園の補正の上に、自分たちの環境が乗る', () => {
  const games = Array.from({ length: 6 }, (_, i) => lvGame(i, 1, 7));
  const r = buildRunExpectancy(games, 'ブカツ(中高大)');
  // 土台は甲子園ベース(NPB×1.142)。そこへさらに自分たちの倍率がかかる
  assert.equal(Number(r.rawBase['100|0'].toFixed(2)), 0.79, '甲子園の実測値が土台');
  assert.equal(
    Number(r.re.get('111|2').toFixed(4)),
    Number((r.rawBase['111|2'] * r.level).toFixed(4)),
    '一度も起きていない状況は 甲子園ベース × 自分たちの倍率',
  );
});

test('土台の水準: 草野球のふつうのチームでは土台を大きく歪めない', () => {
  // 半回0.5点あたりなら、倍率は1の近くに収まってほしい
  const games = [lvGame(1, 0), lvGame(2, 1), lvGame(3, 0), lvGame(4, 1)];
  const r = buildRunExpectancy(games, '草野球');
  assert.ok(r.level > 0.9 && r.level < 1.5, `1の近くに収まる: ${r.level}`);
});

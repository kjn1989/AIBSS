// 純関数ロジックのユニットテスト(node:test / 依存追加なし)
// 実行: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeMoves, judgeAdvance, batterDestOptions } from '../src/lib/plays.js';
import { gameEndCheck, initialPresetIdFor, describeRules } from '../src/lib/rules.js';
import { aggregateBatting, aggregatePitching, battingMetrics, pitchingMetrics, titleLeaders, DETAIL_METRICS, detailRanking, defaultInningBasis } from '../src/lib/stats.js';
import { translate } from '../src/lib/i18n.js';
import { parseUtterance, prettifyTranscript, parseRunnerAdjust, needsRunnerConfirm, parseDirectionOnly, parseContact, playLabel } from '../src/lib/voiceParser.js';
import { parseBatterCorrection, findTargetAtBat, parseSubstitution, parseSubstitutions, parseBatterReassignments, parseResultCorrections, parsePositionCorrections, parseDefensiveAlignment, parseInningRange, parseSlotBatters, parseAtBatDeletions, parseShortResult, isExplicitSubText, inGamePlayerIds, preferInGamePlayers } from '../src/lib/correctionParser.js';
import { buildLineupRows, posChar, roleTag, assignAtBatsByPlayer, resolveStarters, findPositionIssues } from '../src/lib/lineupBox.js';
import { rebuildPitchingStats } from '../src/lib/pitchingRebuild.js';
import { newGame, allowsFoul } from '../src/lib/model.js';
import { buildOppLineupRows, oppBattingByLetter, oppPitcherLetters, oppPitchingStats, oppNameOf, oppLettersInGame, oppBaserunning } from '../src/lib/oppBox.js';
import { remapPlayerInGame, fillPlayerGaps } from '../src/lib/mergePlayers.js';
import { computeBoxScore } from '../src/lib/boxscore.js';
import { buildMatchups, opponentSummaries, oppPitcherByAtBat, oppPlayerKey, normalizeName, opponentTeams, lastOppRoster, oppPlayerAtBats, oppBatteryStats, oppOffenseStats } from '../src/lib/matchup.js';
import { yearOfDate, yearOfGame, yearsInGames, tenureByPlayer, playedInYear, isArchived, yearLabel, currentYear, resolveYear, scopedGames,
  gradeOf, entryYearFromGrade, willGraduate, sortByGrade, usesGrade, defaultSchoolType, maxGradeOf,
  defaultYearStartMonth, schoolYearAtSeasonEnd, currentSchoolYear, labelOfYear } from '../src/lib/year.js';

import { rebuildBatters, findDuplicateAtBats, findOrderBreaks, canRebuildOrders } from '../src/lib/battersRebuild.js';
import { ownOffenseStats, ownBatteryStats } from '../src/lib/ownScout.js';
import { padPointToBall, ballToPadPoint, nearestDirection, depthBand, contactCandidate, ballOf, chartPoint, zoneCounts, zoneOf, POS_BALL, PAD_VB, PAD_ASPECT, padPoint, padWedge, padBandRange, padLabelPoint, padSector, padArc, isFoul } from '../src/lib/battedBall.js';

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

test('padLabelPoint: 端に寄る札は中央揃えを解く(札の幅を知らなくてもはみ出さない)', () => {
  // ファウルまで含めて、どの角度でも枠の中に収まる置き方になる
  for (let angle = -89; angle <= 89; angle += 1.5) {
    const p = padLabelPoint(angle);
    assert.ok(['center', 'edge-l', 'edge-r'].includes(p.anchor), `${angle}: ${p.anchor}`);
    if (p.anchor === 'center') {
      // 中央揃えのままでよいのは、札の幅ぶんの余白がある内側だけ
      assert.ok(p.fx >= 0.17 && p.fx <= 0.83, `${angle}: fx=${p.fx}`);
    }
    assert.ok(p.fy >= 0.045 && p.fy <= 0.955, `${angle}: fy=${p.fy}`);
  }
  // 外を向く方向は端へ。ここを中央揃えのまま座標だけ引き戻すと、
  // 「ファウル 三塁」のように字数が増えた瞬間にまた切れていた
  assert.equal(padLabelPoint(-39.2).anchor, 'edge-l');
  assert.equal(padLabelPoint(39.2).anchor, 'edge-r');
  assert.equal(padLabelPoint(-70).anchor, 'edge-l');
  assert.equal(padLabelPoint(70).anchor, 'edge-r');
  // 中央寄りの打球は素のままの位置に置ける
  assert.equal(padLabelPoint(0).anchor, 'center');
  for (const angle of [-15, 15]) {
    const p = padLabelPoint(angle);
    assert.equal(p.anchor, 'center');
    assert.ok(Math.abs(p.fx - ballToPadPoint(angle, 1.1).fx) < 1e-9, `${angle} は素のまま`);
  }
  // くさびの中心ではなく実際の角度に置くので、角度が浅いほど中央寄りになる。
  // (くさび中心だと同じくさびの中はすべて同じ場所になってしまう)
  assert.ok(padLabelPoint(-15).fx > padLabelPoint(-20).fx, '角度が浅いほど中央寄り');
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

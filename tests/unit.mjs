// 純関数ロジックのユニットテスト(node:test / 依存追加なし)
// 実行: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeMoves, judgeAdvance, batterDestOptions } from '../src/lib/plays.js';
import { gameEndCheck, initialPresetIdFor, describeRules } from '../src/lib/rules.js';
import { aggregateBatting, aggregatePitching, battingMetrics, pitchingMetrics, titleLeaders, DETAIL_METRICS, detailRanking, defaultInningBasis } from '../src/lib/stats.js';
import { translate } from '../src/lib/i18n.js';
import { parseUtterance, prettifyTranscript, parseRunnerAdjust, needsRunnerConfirm, parseDirectionOnly } from '../src/lib/voiceParser.js';
import { parseBatterCorrection, findTargetAtBat, parseSubstitution, parseSubstitutions, parseBatterReassignments, parseResultCorrections, parsePositionCorrections, parseDefensiveAlignment, parseInningRange, parseSlotBatters, parseAtBatDeletions, parseShortResult, isExplicitSubText, inGamePlayerIds, preferInGamePlayers } from '../src/lib/correctionParser.js';
import { buildLineupRows, posChar, roleTag, assignAtBatsByPlayer, resolveStarters, findPositionIssues } from '../src/lib/lineupBox.js';
import { rebuildPitchingStats } from '../src/lib/pitchingRebuild.js';
import { newGame } from '../src/lib/model.js';
import { buildOppLineupRows, oppBattingByLetter, oppPitcherLetters, oppPitchingStats, oppNameOf, oppLettersInGame } from '../src/lib/oppBox.js';
import { remapPlayerInGame, fillPlayerGaps } from '../src/lib/mergePlayers.js';
import { computeBoxScore } from '../src/lib/boxscore.js';
import { buildMatchups, opponentSummaries, oppPitcherByAtBat, oppPlayerKey, normalizeName } from '../src/lib/matchup.js';
import { rebuildBatters, findDuplicateAtBats, findOrderBreaks, canRebuildOrders } from '../src/lib/battersRebuild.js';

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

// 純関数ロジックのユニットテスト(node:test / 依存追加なし)
// 実行: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeMoves, judgeAdvance, batterDestOptions } from '../src/lib/plays.js';
import { gameEndCheck, initialPresetIdFor, describeRules } from '../src/lib/rules.js';
import { aggregateBatting, battingMetrics, pitchingMetrics, titleLeaders } from '../src/lib/stats.js';
import { translate } from '../src/lib/i18n.js';
import { parseUtterance, prettifyTranscript, parseRunnerAdjust, needsRunnerConfirm, parseDirectionOnly } from '../src/lib/voiceParser.js';
import { parseBatterCorrection, findTargetAtBat, parseSubstitution, parseSubstitutions } from '../src/lib/correctionParser.js';
import { buildLineupRows, posChar, roleTag } from '../src/lib/lineupBox.js';

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

test('pitchingMetrics: 防御率は7回換算', () => {
  const met = pitchingMetrics({ outsRecorded: 21, earnedRuns: 2, hitsAllowed: 5, walks: 2, hitByPitch: 0, strikeouts: 6, abFaced: 25 });
  assert.equal(met.era7, 2); // 自責2/7回 → 7回換算2.00
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

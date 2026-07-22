// 純関数ロジックのユニットテスト(node:test / 依存追加なし)
// 実行: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeMoves, judgeAdvance, batterDestOptions } from '../src/lib/plays.js';
import { gameEndCheck, initialPresetIdFor, describeRules } from '../src/lib/rules.js';
import { aggregateBatting, battingMetrics, pitchingMetrics, titleLeaders } from '../src/lib/stats.js';
import { translate } from '../src/lib/i18n.js';
import { parseUtterance } from '../src/lib/voiceParser.js';

// ---- voiceParser.js: 投球コール ----
test('parseUtterance: 「空振り」単独は1ストライク(pitch)', () => {
  const top = parseUtterance('空振り')[0];
  assert.equal(top.kind, 'pitch');
  assert.equal(top.pitchType, 'strike');
});
test('parseUtterance: 「見逃し」単独も1ストライク(pitch)', () => {
  const top = parseUtterance('見逃し')[0];
  assert.equal(top.kind, 'pitch');
  assert.equal(top.pitchType, 'strike');
});
test('parseUtterance: 「空振り三振」は三振(so)で投球にならない', () => {
  const top = parseUtterance('空振り三振')[0];
  assert.equal(top.kind, 'play');
  assert.equal(top.result, 'so');
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

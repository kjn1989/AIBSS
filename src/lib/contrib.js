// ============================================================
// 勝利貢献(WPA)と得点貢献(RE24)
//
// 打率も打点も「どの場面だったか」を捨てている。9回2死同点の一打も、
// 大差がついた試合の1本も同じ1安打として数える。この2つはそこを分けて見る。
//
//  WPA … その打席で勝率をどれだけ動かしたか、を足し上げたもの。
//        場面の重さがそのまま入る。1試合ぶんを全員で足すと
//        「最終勝率 − 開始勝率」(勝ちなら +0.5)にぴったり一致する。
//  RE24… その打席で得点期待値をどれだけ動かしたか、を足し上げたもの。
//        場面の重み(何回か・点差はどうか)を外した「何点ぶん稼いだか」。
//
// 2つ並べると「実力」と「効いた場面」を分けて読める。片方だけだと、
// チャンスで回ってくることが多かっただけの選手が上に来る。
//
// WARは出せない。WARは「リーグ平均」と「控え選手なら何勝か」の2つを
// 基準にするが、自チームと対戦相手ぶんの記録しかないその基準を置けない。
// MLBの定数を借りると、根拠のない数字1つで全選手の値が一斉にずれる。
// ============================================================
import { weSeries, flowSeries } from './flow.js';

// modelFor(game) … その試合の勝率モデル(先攻/後攻・規定回数で変わる)
// re … 得点期待値表(RE24の計算に使う)
// 戻り値: { bat: { playerId -> {...} }, pit: { playerId -> {...} } }
export function aggregateContrib(games = [], modelFor, re) {
  const bat = {};
  const pit = {};
  for (const g of games || []) {
    if (!g || !Array.isArray(g.playLogs)) continue;
    const winExp = typeof modelFor === 'function' ? modelFor(g) : modelFor;
    if (typeof winExp !== 'function') continue;
    const wes = weSeries(g, winExp);
    if (!wes.length) continue;
    // RE24 は同じ打席の並びから引く(どちらも打席ログを順に見ている)
    const re24 = new Map(flowSeries(g, re).map((x) => [x.id, x.delta]));

    for (const x of wes) {
      const p = x.log?.payload || {};
      if (x.mine) {
        const id = p.playerId;
        if (!id) continue;
        const s = bat[id] || (bat[id] = { playerId: id, pa: 0, wpa: 0, re24: 0, games: new Set() });
        s.pa += 1;
        s.wpa += x.delta;
        s.re24 += re24.get(x.id) || 0;
        s.games.add(g.id);
      } else {
        // 守備側は「その打席を投げていた投手」に付く。
        // 勝率も得点期待値も自チーム視点なので、抑えれば増える(符号の反転は要らない)
        const id = p.pitcherId;
        if (!id) continue;
        const s = pit[id] || (pit[id] = { playerId: id, bf: 0, wpa: 0, re24: 0, games: new Set() });
        s.bf += 1;
        s.wpa += x.delta;
        s.re24 += re24.get(x.id) || 0;
        s.games.add(g.id);
      }
    }
  }
  const fix = (m) => Object.values(m).map((s) => ({ ...s, games: s.games.size }));
  return { bat: fix(bat), pit: fix(pit) };
}

// 勝利貢献の大きい順。同じなら得点貢献の大きい順
export const rankContrib = (rows) => [...rows].sort((a, b) => (b.wpa - a.wpa) || (b.re24 - a.re24));

// 符号つきで小数2桁。0.00 に「−」を付けない
export function formatContrib(v, digits = 2) {
  const n = Number(v) || 0;
  const s = n.toFixed(digits);
  return Number(s) > 0 ? `+${s}` : Number(s) < 0 ? s.replace('-', '−') : s.replace('-', '');
}

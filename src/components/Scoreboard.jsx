import React from 'react';
import { useStore, useT, usePlayerName, isMyTeamBatting } from '../state/store.jsx';
import { computeBoxScore } from '../lib/boxscore.js';
import { RESULTS } from '../lib/model.js';

// チーム名の頭文字(先頭グラフェム)。空なら控えの記号を返す。
function initialOf(name, fallback) {
  const s = (name || '').trim();
  return s ? Array.from(s)[0] : fallback;
}

// イニング別の安打数を {inning: count} で集計するヘルパ。
function hitsByInning(entries, inningOf) {
  const map = {};
  for (const e of entries) {
    const inn = inningOf(e);
    if (!inn) continue;
    map[inn] = (map[inn] || 0) + 1;
  }
  return map;
}

// ---- 両投手の球数(見るだけ・極小)。上=その回の投手 / 下=相対の投手 ----
function PitchLines({ game }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const myInitial = initialOf(state.settings.teamName, t('scoreboard.you').slice(0, 1));
  const oppInitial = initialOf(game.opponent, t('scoreboard.opponent').slice(0, 1));
  const limit = game.rules?.pitchLimit?.perGame || null;
  const warnAt = game.rules?.pitchLimit?.warnAt ?? (limit ? Math.max(1, limit - 10) : null);

  const myPr = game.currentPitcherId
    ? (game.pitchingRecords || []).find((r) => r.playerId === game.currentPitcherId)
    : null;
  const mine = game.currentPitcherId
    ? { ini: myInitial, who: nameOf(game.currentPitcherId), pitches: myPr?.pitches || 0 }
    : null;

  const oppLetter = game.oppPitcherLetter;
  const oppRec = oppLetter ? game.oppPitchers?.[oppLetter] : null;
  const opp = oppLetter
    ? { ini: oppInitial, who: oppLetter, pitches: oppRec?.pitches || 0 }
    : null;

  if (!mine && !opp) return null;

  // その回の投手 = 守備側(自軍打撃なら相手、守備なら自軍)。上に置く。
  const currentIsOpp = isMyTeamBatting(game);
  let primary = currentIsOpp ? opp : mine;
  let secondary = currentIsOpp ? mine : opp;
  if (!primary) { primary = secondary; secondary = null; }

  const line = (d, isPrimary) => {
    if (!d) return null;
    const pct = limit ? Math.min(100, Math.round((d.pitches / limit) * 100)) : 0;
    const level = !limit ? '' : d.pitches >= limit ? 'over' : d.pitches >= warnAt ? 'warn' : '';
    return (
      <div className={`led-pcline${isPrimary ? '' : ' dim'} ${level}`}>
        <span className="who"><span className="ini">{d.ini}</span>{d.who}</span>
        <span className="bar"><span className="fill" style={{ width: `${limit ? pct : 100}%` }} /></span>
        <span className="num"><b>{d.pitches}</b>{limit ? `/${limit}` : ''}{t('score.pitchesUnit')}</span>
      </div>
    );
  };

  return (
    <div className="led-pcpair">
      {line(primary, true)}
      {line(secondary, false)}
    </div>
  );
}

// ============================================================
// LEDスコアボード: 球場のラインスコアそのままの佇まいをトップに。
//  - 頭文字 / 回ごとの得点(各回の安打数を極小で上下に添える) / R・H・E合計
//  - 現在の回をハイライト、攻撃中チームの頭文字に「◂」マーカー
//  - 右にB/S/Oカウンター(O段は .out-dot でE2E・テスト互換を維持)
//  - 下段に両投手の球数(その回の投手=上/相対=下)
// ============================================================
export default function Scoreboard({ game }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();

  const myName = state.settings.teamName || t('scoreboard.you');
  const oppName = game.opponent || t('scoreboard.opponent');
  const box = computeBoxScore(game);

  // away = 表に攻撃するチーム(先攻), home = 裏に攻撃するチーム(後攻)
  const awayName = game.isHome ? oppName : myName;
  const homeName = game.isHome ? myName : oppName;
  const awayIni = initialOf(awayName, 'A');
  const homeIni = initialOf(homeName, 'H');

  // 表示イニング数(ルールの回数、延長は現在の回まで拡張)
  const nInn = Math.max(game.rules?.innings || 7, game.inning || 1);
  const innings = Array.from({ length: nInn }, (_, i) => i + 1);
  const cur = game.inning;
  const battingSide = game.isTop ? 'away' : 'home';

  // イニング別の安打数(自軍=atBats / 相手=defenseログ)を away/home に振り分け
  const myHits = hitsByInning(
    game.atBats.filter((ab) => RESULTS[ab.result]?.hit),
    (ab) => ab.snapshot?.inning,
  );
  const oppHits = hitsByInning(
    game.playLogs.filter((l) => l.kind === 'defense' && RESULTS[l.payload?.result]?.hit),
    (l) => l.inning,
  );
  const awayHits = game.isHome ? oppHits : myHits;
  const homeHits = game.isHome ? myHits : oppHits;

  const runOf = (side, i) => {
    const e = game.linescore?.[String(i)];
    const played = i < cur || (i === cur && !!e);
    if (!played) return '';
    const v = side === 'away' ? (game.isHome ? e?.opp : e?.my) : (game.isHome ? e?.my : e?.opp);
    return v ?? 0;
  };

  const awayTotals = game.isHome ? box.opp : box.my;
  const homeTotals = game.isHome ? box.my : box.opp;

  // B/S/O: 進行中打席の投球バッファと現在アウト数から点灯状態を作る
  const pitches = game.pending?.pitches || [];
  const balls = Math.min(pitches.filter((p) => p.type === 'ball').length, 3);
  const strikes = Math.min(
    pitches.filter((p) => p.type === 'strike').length + pitches.filter((p) => p.type === 'foul').length,
    2,
  );
  const dots = (n, total) => Array.from({ length: total }, (_, i) => i < n);

  const Row = ({ side, ini, totals, hits }) => {
    const on = side === battingSide;
    return (
      <tr className={on ? 'atbat' : ''}>
        <td className="ini">{ini}{on && <span className="bat">◂</span>}</td>
        {innings.map((i) => (
          <td key={i} className={`inn${i === cur ? ' now' : ''}`}>
            {side === 'away' && hits[i] ? <span className="ih">{hits[i]}</span> : null}
            <span className="rn">{runOf(side, i)}</span>
            {side === 'home' && hits[i] ? <span className="ih">{hits[i]}</span> : null}
          </td>
        ))}
        <td className="rc rv sep">{totals.r}</td>
        <td className="rc">{totals.h}</td>
        <td className="rc">{totals.e}</td>
      </tr>
    );
  };

  return (
    <div className="led-scoreboard">
      <div className="led-inn">
        {game.rules && game.inning > game.rules.innings && t('scoreboard.extra')}
        {t(game.isTop ? 'scoreboard.top' : 'scoreboard.bottom', { n: game.inning })}
      </div>

      <div className="led-board">
        <table className="led-ls">
          <thead>
            <tr>
              <th className="ini" />
              {innings.map((i) => <th key={i} className={`inn${i === cur ? ' now' : ''}`}>{i}</th>)}
              <th className="rc sep">R</th><th className="rc">H</th><th className="rc">E</th>
            </tr>
          </thead>
          <tbody>
            <Row side="away" ini={awayIni} totals={awayTotals} hits={awayHits} />
            <Row side="home" ini={homeIni} totals={homeTotals} hits={homeHits} />
          </tbody>
        </table>

        <div className="led-bso">
          <div className="r b"><b>B</b>{dots(balls, 3).map((v, i) => <i key={i} className={`d${v ? ' on' : ''}`} />)}</div>
          <div className="r s"><b>S</b>{dots(strikes, 2).map((v, i) => <i key={i} className={`d${v ? ' on' : ''}`} />)}</div>
          <div className="r o"><b>O</b>{dots(game.outs, 2).map((v, i) => <i key={i} className={`out-dot d${v ? ' on' : ''}`} />)}</div>
        </div>
      </div>

      <PitchLines game={game} />
    </div>
  );
}

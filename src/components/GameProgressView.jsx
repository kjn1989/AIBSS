import React from 'react';
import { useStore, usePlayerName, isMyTeamBatting } from '../state/store.jsx';
import { RESULTS } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import { computeBoxScore } from '../lib/boxscore.js';

// 打席結果のカテゴリ(色分け用)
function resultCategory(result) {
  const def = RESULTS[result];
  if (!def) return 'outres';
  if (def.hit) return 'hit';
  if (result === 'sacBunt' || result === 'sacFly') return 'sac';
  if (def.onBase) return 'onbase';
  return 'outres';
}

// 塁上の走者を丸で示す簡易ダイヤモンド(そのプレイ開始時点の状況)
function MiniDiamond({ runners }) {
  const on = (b) => (runners ? !!runners[b] : false);
  return (
    <svg viewBox="0 0 40 40" width="32" height="32" className="mini-diamond">
      <polygon points="20,6 34,20 20,34 6,20" fill="none" stroke="var(--border)" strokeWidth="2" />
      <circle cx="20" cy="6" r="4.5" fill={on(2) ? 'var(--gold)' : 'var(--bg-3)'} stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="34" cy="20" r="4.5" fill={on(1) ? 'var(--gold)' : 'var(--bg-3)'} stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="6" cy="20" r="4.5" fill={on(3) ? 'var(--gold)' : 'var(--bg-3)'} stroke="var(--border)" strokeWidth="1.5" />
    </svg>
  );
}

// B-S-O のカウント表示(データがない旧プレイでは何も出さない)
function CountDots({ balls, strikes, outsBefore }) {
  if (balls === undefined || balls === null) return null;
  return (
    <div className="mini-count">
      <div><b>B</b>{[0, 1, 2].map((i) => <i key={i} className={`mc-dot ball${i < balls ? ' on' : ''}`} />)}</div>
      <div><b>S</b>{[0, 1].map((i) => <i key={i} className={`mc-dot strike${i < strikes ? ' on' : ''}`} />)}</div>
      <div><b>O</b>{[0, 1].map((i) => <i key={i} className={`mc-dot out${i < outsBefore ? ' on' : ''}`} />)}</div>
    </div>
  );
}

// 打席系プレイ(kind: atbat/defense)の1件カード
function PlayCard({ log, nameOf, numberOf }) {
  const p = log.payload || {};
  const isDefense = log.kind === 'defense';
  const name = isDefense ? p.letter : nameOf(p.playerId);
  const number = isDefense ? null : numberOf(p.playerId);
  const category = resultCategory(p.result);
  const label = playLabel(p.result, p.direction, p.outType, p.soType);

  return (
    <div className="play-card">
      <div className="pc-head">
        <span className="rank-badge">{p.order ?? ''}</span>
        <span className="pc-name">{name}{number ? ` #${number}` : ''}</span>
        <span className={`pill pc-pill ${category}`}>{label}</span>
        {p.runs > 0 && (
          <span className="pill amber pc-score">
            {p.scoreAfter ? `${p.scoreAfter.my}-${p.scoreAfter.opp}` : `${p.runs}点`}
          </span>
        )}
      </div>
      <div className="pc-body">
        <MiniDiamond runners={p.beforeRunners} />
        <CountDots balls={p.balls} strikes={p.strikes} outsBefore={p.outsBefore} />
        <div className="pc-text">
          <div>{log.text}</div>
          {(p.moveLines || []).map((t, i) => <div key={i} className="dim">{t}</div>)}
        </div>
      </div>
    </div>
  );
}

// その他イベント(交代・投手交代・走者イベント等)の簡易行
function SimpleLogLine({ log }) {
  return <div className="log-line">{log.text}</div>;
}

function groupByHalfInning(playLogs) {
  const groups = [];
  for (const l of playLogs) {
    const key = `${l.inning}-${l.isTop}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, inning: l.inning, isTop: l.isTop, logs: [] };
      groups.push(g);
    }
    g.logs.push(l);
  }
  return groups.reverse(); // 新しい回を上に
}

// 試合結果タブにも埋め込めるよう、線分スコア+回別プレイを描画する中身部分
export function GameProgressContent({ game }) {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  const box = computeBoxScore(game);
  // 'run'ログは各プレイカード内のmoveLinesに既に含まれるため二重表示を避ける
  const groups = groupByHalfInning(game.playLogs.filter((l) => l.kind !== 'run'));
  const myTeamName = state.settings.teamName || 'マイチーム';
  const oppTeamName = game.opponent || '対戦相手';

  return (
    <div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="linescore-table">
          <thead>
            <tr>
              <th></th>
              {box.innings.map((i) => <th key={i.inning}>{i.inning}</th>)}
              <th>計</th><th>H</th><th>E</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="team">{game.isHome ? oppTeamName : myTeamName}</td>
              {box.innings.map((i) => (
                <td key={i.inning}>{i.played ? (game.isHome ? i.opp : i.my) : ''}</td>
              ))}
              <td className="num">{game.isHome ? box.opp.r : box.my.r}</td>
              <td className="num">{game.isHome ? box.opp.h : box.my.h}</td>
              <td className="num">{game.isHome ? box.opp.e : box.my.e}</td>
            </tr>
            <tr>
              <td className="team">{game.isHome ? myTeamName : oppTeamName}</td>
              {box.innings.map((i) => (
                <td key={i.inning}>{i.played ? (game.isHome ? i.my : i.opp) : ''}</td>
              ))}
              <td className="num">{game.isHome ? box.my.r : box.opp.r}</td>
              <td className="num">{game.isHome ? box.my.h : box.opp.h}</td>
              <td className="num">{game.isHome ? box.my.e : box.opp.e}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {groups.length === 0 && <div className="dim small" style={{ padding: '0 4px' }}>まだプレイがありません。</div>}

      {groups.map((grp) => {
        const battingTeam = (grp.isTop !== game.isHome) ? myTeamName : oppTeamName;
        return (
          <div key={grp.key} className="inning-group">
            <div className="inning-header">
              <b>{grp.inning}回{grp.isTop ? '表' : '裏'}</b>
              <span className="dim">{battingTeam}</span>
            </div>
            {[...grp.logs].reverse().map((log) =>
              log.kind === 'atbat' || log.kind === 'defense'
                ? <PlayCard key={log.id} log={log} nameOf={nameOf} numberOf={numberOf} />
                : <SimpleLogLine key={log.id} log={log} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// 独立した全画面ビュー(「試合経過」への遷移用)
export default function GameProgressView({ game, onClose }) {
  return (
    <div className="fullscreen-view">
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>← 戻る</button>
        <h2>試合経過</h2>
        <span style={{ width: 60 }} />
      </header>
      <div className="fullscreen-body">
        <GameProgressContent game={game} />
      </div>
    </div>
  );
}

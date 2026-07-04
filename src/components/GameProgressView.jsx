import React, { useState } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, OUT_TYPES, SO_TYPES } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import { computeBoxScore } from '../lib/boxscore.js';
import Sheet from './Sheet.jsx';

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
function PlayCard({ log, nameOf, numberOf, onEdit }) {
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
        {onEdit && (
          <button className="pc-edit-btn" onClick={() => onEdit(log)} aria-label="このプレイを修正">✎</button>
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

// ---- 過去プレイの事後編集シート ----
// 結果種別・方向・打点を後から修正/削除できる(成績は自動で再計算)。
// スコア・走者・投手成績はここでは変えず、必要なら手動修正機能を案内する。
function EditPlaySheet({ game, log, onClose }) {
  const { dispatch } = useStore();
  const p = log.payload || {};
  const [result, setResult] = useState(p.result);
  const [direction, setDirection] = useState(p.direction || null);
  const [outType, setOutType] = useState(p.outType || 'ground');
  const [soType, setSoType] = useState(p.soType || 'swinging');
  const [rbi, setRbi] = useState(p.rbi ?? null);
  const isAtBat = log.kind === 'atbat';

  const save = () => {
    dispatch({
      type: 'EDIT_PLAY_LOG',
      gameId: game.id,
      logId: log.id,
      patch: { result, direction, outType, soType, ...(isAtBat && rbi !== null ? { rbi } : {}) },
    });
    onClose();
  };

  const remove = () => {
    if (!window.confirm('このプレイを記録から削除しますか？(成績から除外されます)')) return;
    dispatch({ type: 'DELETE_PLAY_LOG', gameId: game.id, logId: log.id });
    onClose();
  };

  return (
    <Sheet title={`プレイの修正 (${log.inning}回${log.isTop ? '表' : '裏'})`} onClose={onClose}>
      <div className="section-title" style={{ marginTop: 0 }}>結果</div>
      <div className="grid3">
        {Object.entries(RESULTS).map(([k, def]) => (
          <button key={k} className={`small ${result === k ? 'primary' : ''}`} onClick={() => setResult(k)}>
            {def.label}
          </button>
        ))}
      </div>

      <div className="section-title">方向</div>
      <div className="grid3">
        {Object.entries(DIRECTIONS).map(([k, v]) => (
          <button key={k} className={`small ${direction === k ? 'primary' : ''}`} onClick={() => setDirection(direction === k ? null : k)}>
            {v}
          </button>
        ))}
      </div>

      {result === 'out' && (
        <>
          <div className="section-title">凡打の種類</div>
          <div className="grid2">
            {Object.entries(OUT_TYPES).map(([k, v]) => (
              <button key={k} className={`small ${outType === k ? 'primary' : ''}`} onClick={() => setOutType(k)}>{v}</button>
            ))}
          </div>
        </>
      )}
      {result === 'so' && (
        <>
          <div className="section-title">三振の種類</div>
          <div className="grid2">
            {Object.entries(SO_TYPES).map(([k, v]) => (
              <button key={k} className={`small ${soType === k ? 'primary' : ''}`} onClick={() => setSoType(k)}>{v}</button>
            ))}
          </div>
        </>
      )}

      {isAtBat && (
        <div className="flex mt12">
          <span className="small dim grow">打点</span>
          <div className="stepper">
            <button onClick={() => setRbi(Math.max(0, (rbi ?? p.rbi ?? 0) - 1))}>−</button>
            <span className="val">{rbi ?? p.rbi ?? 0}</span>
            <button onClick={() => setRbi(Math.min(4, (rbi ?? p.rbi ?? 0) + 1))}>＋</button>
          </div>
        </div>
      )}

      <div className="warn-box mt12">
        修正しても当時のスコア・走者・投手成績は自動では変わりません。
        必要なら「スコア修正」(スコア入力タブ)や投手の詳細調整(試合結果タブ)で合わせてください。
      </div>

      <button className="ghost danger mt8" style={{ width: '100%' }} onClick={remove}>🗑 このプレイを削除</button>
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>キャンセル</button>
        <button className="primary" onClick={save}>保存</button>
      </div>
    </Sheet>
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
export function GameProgressContent({ game, editable = false }) {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  const [editLog, setEditLog] = useState(null);
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
                ? (
                  <PlayCard
                    key={log.id}
                    log={log}
                    nameOf={nameOf}
                    numberOf={numberOf}
                    onEdit={editable ? setEditLog : null}
                  />
                )
                : <SimpleLogLine key={log.id} log={log} />
            )}
          </div>
        );
      })}

      {editLog && <EditPlaySheet game={game} log={editLog} onClose={() => setEditLog(null)} />}
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
        <GameProgressContent game={game} editable />
      </div>
    </div>
  );
}

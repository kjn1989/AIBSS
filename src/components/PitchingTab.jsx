import React, { useState } from 'react';
import { useStore, useCurrentGame, usePlayerName, isMyTeamBatting } from '../state/store.jsx';
import { formatIP } from '../lib/model.js';
import { aggregatePitching, pitchingMetrics } from '../lib/stats.js';
import GameScopeToggle, { scopedGames } from './GameScopeToggle.jsx';

// 1登板レコードの編集カード
function RecordCard({ game, pr }) {
  const { dispatch } = useStore();
  const nameOf = usePlayerName();
  const [detail, setDetail] = useState(false);

  const adjust = (patch) => dispatch({ type: 'ADJUST_PITCHING', gameId: game.id, recordId: pr.id, patch });
  const step = (field, delta, min = 0) => adjust({ [field]: Math.max(min, (pr[field] || 0) + delta) });

  return (
    <div className="card">
      <div className="flex">
        <span className="rank-badge">{pr.appearanceOrder}</span>
        <b className="grow" style={{ fontSize: 16 }}>
          {nameOf(pr.playerId)}
          {game.currentPitcherId === pr.playerId && <span className="pill green" style={{ marginLeft: 6 }}>登板中</span>}
        </b>
        <button
          className={`small ${pr.win ? 'primary' : 'ghost'}`}
          onClick={() => dispatch({ type: 'SET_DECISION', gameId: game.id, recordId: pr.id, decision: 'win', value: !pr.win, exclusive: true })}
        >
          勝
        </button>
        <button
          className={`small ${pr.save ? 'primary' : 'ghost'}`}
          onClick={() => dispatch({ type: 'SET_DECISION', gameId: game.id, recordId: pr.id, decision: 'save', value: !pr.save, exclusive: true })}
        >
          S
        </button>
        <button
          className={`small ${pr.hold ? 'primary' : 'ghost'}`}
          onClick={() => dispatch({ type: 'SET_DECISION', gameId: game.id, recordId: pr.id, decision: 'hold', value: !pr.hold, exclusive: false })}
        >
          H
        </button>
      </div>

      <div className="grid3 mt12 center small">
        <div><div className="dim">投球回</div><b style={{ fontSize: 18 }}>{formatIP(pr.outsRecorded)}</b></div>
        <div><div className="dim">失点</div><b style={{ fontSize: 18 }}>{pr.runs}</b></div>
        <div><div className="dim">自責点</div><b style={{ fontSize: 18 }}>{pr.earnedRuns}</b></div>
        <div><div className="dim">被安打</div><b>{pr.hitsAllowed}</b></div>
        <div><div className="dim">与四死球</div><b>{pr.walks + pr.hitByPitch}</b></div>
        <div><div className="dim">奪三振</div><b>{pr.strikeouts}</b></div>
      </div>
      <div className="center small dim mt8">投球数 {pr.pitches}</div>

      <div className="flex mt12">
        <span className="small dim grow">自責点の微調整</span>
        <div className="stepper">
          <button onClick={() => step('earnedRuns', -1)}>−</button>
          <span className="val">{pr.earnedRuns}</span>
          <button onClick={() => step('earnedRuns', +1)}>＋</button>
        </div>
      </div>

      <button className="ghost small mt8" onClick={() => setDetail(!detail)}>
        {detail ? '▲ 詳細調整を閉じる' : '▼ 詳細調整(投球回・被安打など)'}
      </button>
      {detail && (
        <div className="mt8">
          {[
            ['outsRecorded', '投球回(1/3単位)', (v) => formatIP(v)],
            ['runs', '失点', String],
            ['hitsAllowed', '被安打', String],
            ['abFaced', '被打数(被打率の分母)', String],
            ['walks', '与四球', String],
            ['hitByPitch', '与死球', String],
            ['strikeouts', '奪三振', String],
            ['pitches', '投球数', String],
          ].map(([field, label, fmt]) => (
            <div className="flex mt8" key={field}>
              <span className="small dim grow">{label}</span>
              <div className="stepper">
                <button onClick={() => step(field, -1)}>−</button>
                <span className="val">{fmt(pr[field] || 0)}</span>
                <button onClick={() => step(field, +1)}>＋</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// シーズン/試合の投手成績サマリー
function PitchingSummary() {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const [scope, setScope] = useState({ scope: 'season', gameId: null });
  const games = scopedGames(state, scope);
  const rows = Object.values(aggregatePitching(games)).filter((s) => s.outsRecorded > 0 || s.games > 0);

  return (
    <div>
      <GameScopeToggle value={scope} onChange={setScope} />
      <div className="card">
        <h2>投手成績一覧</h2>
        {rows.length === 0 ? (
          <div className="dim small">記録がありません。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="rank-table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>投手</th><th>回</th><th>防御率</th><th>被打率</th><th>WHIP</th><th>奪三振</th>
                  <th>与四死</th><th>被安</th><th>自責</th><th>勝</th><th>S</th><th>H</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const m = pitchingMetrics(s);
                  return (
                    <tr key={s.playerId}>
                      <td>{nameOf(s.playerId)}</td>
                      <td className="num">{formatIP(s.outsRecorded)}</td>
                      <td className="num">{m.era7 === null ? '-' : m.era7.toFixed(2)}</td>
                      <td className="num">{m.oba === null ? '-' : m.oba.toFixed(3).replace(/^0\./, '.')}</td>
                      <td className="num">{m.whip === null ? '-' : m.whip.toFixed(2)}</td>
                      <td className="num">{s.strikeouts}</td>
                      <td className="num">{s.walks + s.hitByPitch}</td>
                      <td className="num">{s.hitsAllowed}</td>
                      <td className="num">{s.earnedRuns}</td>
                      <td className="num">{s.wins}</td>
                      <td className="num">{s.saves}</td>
                      <td className="num">{s.holds}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PitchingTab() {
  const { state, dispatch } = useStore();
  const game = useCurrentGame();
  const nameOf = usePlayerName();
  const [nextPitcher, setNextPitcher] = useState('');

  if (!game || game.status === 'finished') return <PitchingSummary />;

  const records = [...game.pitchingRecords].sort((a, b) => a.appearanceOrder - b.appearanceOrder);
  const runnersOnWithPrev = !isMyTeamBatting(game) &&
    [1, 2, 3].some((b) => game.runners[b] && game.runners[b].pitcherId && game.runners[b].pitcherId !== nextPitcher);

  return (
    <div>
      <div className="card">
        <h2>登板・継投</h2>
        <div className="flex">
          <select className="grow" value={nextPitcher} onChange={(e) => setNextPitcher(e.target.value)}>
            <option value="">投手を選択...</option>
            {state.players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!nextPitcher || nextPitcher === game.currentPitcherId}
            onClick={() => {
              dispatch({
                type: 'SET_PITCHER', gameId: game.id, playerId: nextPitcher,
                label: game.currentPitcherId
                  ? `継投: ${nameOf(nextPitcher)} (← ${nameOf(game.currentPitcherId)})`
                  : `先発: ${nameOf(nextPitcher)}`,
              });
              setNextPitcher('');
            }}
          >
            {game.currentPitcherId ? '継投' : '先発登板'}
          </button>
        </div>
        {game.currentPitcherId && (
          <p className="small dim mt8">現在の投手: <b>{nameOf(game.currentPitcherId)}</b></p>
        )}
        {[1, 2, 3].some((b) => game.runners[b]) && !isMyTeamBatting(game) && (
          <div className="warn-box">
            走者を残して継投した場合、その走者の生還時に自責点の帰属(前投手/現投手)を確認するダイアログが表示されます。
          </div>
        )}
      </div>

      {records.length === 0 ? (
        <div className="big-note">まだ登板記録がありません。<br />守備開始時に投手を選択してください。</div>
      ) : (
        records.map((pr) => <RecordCard key={pr.id} game={game} pr={pr} />)
      )}
    </div>
  );
}

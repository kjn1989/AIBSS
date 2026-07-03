import React, { useState } from 'react';
import { useStore, usePlayerName, isMyTeamBatting } from '../state/store.jsx';
import { formatIP } from '../lib/model.js';

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

// 進行中の試合の登板・継投管理(成績タブに埋め込んで使う)
export function PitchingGameManagement({ game }) {
  const { state, dispatch } = useStore();
  const nameOf = usePlayerName();
  const [nextPitcher, setNextPitcher] = useState('');

  const records = [...game.pitchingRecords].sort((a, b) => a.appearanceOrder - b.appearanceOrder);

  return (
    <div>
      <div className="card">
        <h2>登板・継投({game.date} vs {game.opponent || '対戦相手'})</h2>
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

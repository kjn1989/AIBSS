import React, { useState } from 'react';
import { useStore, useCurrentGame, usePlayerName } from '../state/store.jsx';
import { POSITIONS } from '../lib/model.js';
import Sheet from './Sheet.jsx';

// ---- 初期オーダー編集(lineup未設定時) ----
function LineupEditor({ game }) {
  const { state, dispatch } = useStore();
  const [slots, setSlots] = useState(() =>
    Array.from({ length: 9 }, (_, i) => ({ order: i + 1, playerId: '', position: POSITIONS[i] || '控' }))
  );

  const autoFill = () => {
    const nine = state.players.slice(0, 9);
    setSlots(Array.from({ length: 9 }, (_, i) => ({
      order: i + 1,
      playerId: nine[i]?.id || '',
      position: POSITIONS[i] || '控',
    })));
  };

  const set = (i, patch) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const filled = slots.filter((s) => s.playerId);
  const dup = new Set(filled.map((s) => s.playerId)).size !== filled.length;

  return (
    <div className="card">
      <h2>スターティングオーダー登録</h2>
      {state.players.length === 0 && <div className="warn-box">⚙️ 設定タブで選手を登録してください。</div>}
      <button className="small mt8" onClick={autoFill} disabled={state.players.length === 0}>
        登録順に自動入力
      </button>
      {slots.map((s, i) => (
        <div className="row" key={s.order}>
          <span className="rank-badge">{s.order}</span>
          <select className="grow" value={s.playerId} onChange={(e) => set(i, { playerId: e.target.value })}>
            <option value="">選手を選択...</option>
            {state.players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select style={{ width: 84 }} value={s.position} onChange={(e) => set(i, { position: e.target.value })}>
            {POSITIONS.map((pos) => (
              <option key={pos} value={pos}>{pos}</option>
            ))}
          </select>
        </div>
      ))}
      {dup && <div className="warn-box">⚠️ 同じ選手が複数の打順に入っています。</div>}
      <button
        className="primary mt12"
        style={{ width: '100%' }}
        disabled={filled.length === 0 || dup}
        onClick={() => dispatch({ type: 'SET_LINEUP', gameId: game.id, lineup: slots.filter((s) => s.playerId) })}
      >
        この打順で確定
      </button>
    </div>
  );
}

// ---- 交代シート(代打・代走・守備交代) ----
function SubstituteSheet({ game, slot, onClose }) {
  const { state, dispatch } = useStore();
  const nameOf = usePlayerName();
  const [kind, setKind] = useState('ph'); // ph=代打 pr=代走 def=守備交代
  const [playerId, setPlayerId] = useState('');
  const [position, setPosition] = useState(slot.position);

  const inLineup = new Set(game.lineup.map((l) => l.playerId));
  const candidates = state.players.filter((p) => !inLineup.has(p.id));
  const isRetired = playerId && game.retiredPlayerIds.includes(playerId);
  const kindLabel = { ph: '代打', pr: '代走', def: '守備交代' }[kind];

  const runnerBase = [1, 2, 3].find((b) => game.runners[b]?.playerId === slot.playerId);

  return (
    <Sheet title={`${slot.order}番 ${nameOf(slot.playerId)} の交代`} onClose={onClose}>
      <div className="grid3">
        {[['ph', '代打'], ['pr', '代走'], ['def', '守備交代']].map(([k, label]) => (
          <button key={k} className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>

      {kind === 'pr' && !runnerBase && (
        <div className="warn-box mt8">この選手は現在塁上にいません。代走は塁上の走者に対して行います。</div>
      )}

      <div className="section-title">出場する選手</div>
      <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
        <option value="">選手を選択...</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}{game.retiredPlayerIds.includes(p.id) ? ' (⚠️出場済み)' : ''}
          </option>
        ))}
      </select>

      {isRetired && (
        <div className="warn-box">
          ⚠️ {nameOf(playerId)} は一度退いた選手です。公式ルールでは再出場できません(記録は継続可能)。
        </div>
      )}

      <div className="section-title">守備位置</div>
      <select value={position} onChange={(e) => setPosition(e.target.value)}>
        {POSITIONS.map((pos) => (
          <option key={pos} value={pos}>{pos}</option>
        ))}
      </select>

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>キャンセル</button>
        <button
          className="primary"
          disabled={!playerId}
          onClick={() => {
            dispatch({
              type: 'SUBSTITUTE',
              gameId: game.id,
              order: slot.order,
              playerId,
              position,
              asRunner: kind === 'pr',
              label: `${kindLabel}: ${nameOf(playerId)} (${slot.order}番 ${nameOf(slot.playerId)}に代わり)`,
            });
            onClose();
          }}
        >
          {kindLabel}で出場
        </button>
      </div>
    </Sheet>
  );
}

// ---- メイン ----
export default function OrderTab() {
  const { state, dispatch } = useStore();
  const game = useCurrentGame();
  const nameOf = usePlayerName();
  const [subSlot, setSubSlot] = useState(null);

  if (!game || game.status === 'finished') {
    return <div className="big-note">📋 スコア入力タブで試合を開始すると、オーダーを設定できます。</div>;
  }

  if (game.lineup.length === 0) return <LineupEditor game={game} />;

  return (
    <div>
      <div className="card">
        <h2>オーダー ({game.inning}回{game.isTop ? '表' : '裏'})</h2>
        {game.lineup.map((slot, i) => (
          <div className="row" key={slot.order}>
            <span className="rank-badge">{slot.order}</span>
            <div className="grow" onClick={() => setSubSlot(slot)} role="button">
              <b>{nameOf(slot.playerId)}</b>
              {i === game.batterIndex && <span className="pill blue" style={{ marginLeft: 6 }}>次打者</span>}
              {game.retiredPlayerIds.includes(slot.playerId) && <span className="pill amber" style={{ marginLeft: 6 }}>再出場</span>}
            </div>
            <select
              className="small"
              style={{ width: 84 }}
              value={slot.position}
              onChange={(e) => dispatch({ type: 'SET_POSITION', gameId: game.id, order: slot.order, position: e.target.value })}
            >
              {POSITIONS.map((pos) => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
            <button className="small" onClick={() => setSubSlot(slot)}>交代</button>
          </div>
        ))}
        <p className="small dim mt8">行をタップで代打・代走・守備交代。守備位置はその場で変更できます。</p>
      </div>

      {game.retiredPlayerIds.length > 0 && (
        <div className="card">
          <h2>退いた選手</h2>
          <div className="flex" style={{ flexWrap: 'wrap' }}>
            {game.retiredPlayerIds.map((id) => (
              <span key={id} className="pill">{nameOf(id)}</span>
            ))}
          </div>
        </div>
      )}

      {subSlot && <SubstituteSheet game={game} slot={subSlot} onClose={() => setSubSlot(null)} />}
    </div>
  );
}

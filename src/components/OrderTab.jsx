import React, { useState } from 'react';
import { useStore, useT, useCurrentGame, usePlayerName } from '../state/store.jsx';
import { POSITIONS } from '../lib/model.js';
import Sheet from './Sheet.jsx';
import LineupWizard from './LineupWizard.jsx';
import HeadCoachView from './HeadCoachView.jsx';

// ---- 交代シート(代打・代走・守備交代) ----
// スコア入力タブ(打者カード/走者タップ)からも再利用するため export する
export function SubstituteSheet({ game, slot, onClose, initialKind = 'ph' }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [kind, setKind] = useState(initialKind); // ph=代打 pr=代走 def=守備交代
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
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
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
  const [coachOpen, setCoachOpen] = useState(false);
  // AIスタメン提案は「草野球」エディション限定の機能
  const aiCoachEnabled = state.settings.edition === '草野球';

  // 公式クラウドの観戦(viewer)ロールは編集不可
  if (state.settings.officialTeamId && state.settings.officialRole === 'viewer') {
    return <div className="big-note">👀 観戦モード(閲覧専用)のため、オーダーの編集はできません。</div>;
  }

  if (!game || game.status === 'finished') {
    return <div className="big-note">📋 スコア入力タブで試合を開始すると、オーダーを設定できます。</div>;
  }

  // 試合が始まっているか(打席が記録されている or プレイログがある)
  const gameStarted = game.atBats.length > 0 ||
    game.playLogs.some((l) => ['atbat', 'defense', 'run', 'sb'].includes(l.kind));

  const coachBtn = aiCoachEnabled && <button className="small" onClick={() => setCoachOpen(true)}>🤖 AI提案</button>;
  const coachView = aiCoachEnabled && coachOpen && (
    <HeadCoachView game={game} canApply={!gameStarted} onClose={() => setCoachOpen(false)} />
  );

  if (game.lineup.length === 0) {
    return (
      <div>
        {aiCoachEnabled && (
          <div className="card">
            <div className="flex">
              <span className="grow small dim">打順に迷ったら、AIヘッドコーチが提案します。</span>
              {coachBtn}
            </div>
          </div>
        )}
        <LineupWizard game={game} />
        {coachView}
      </div>
    );
  }

  const rebuildLineup = () => {
    if (!window.confirm('オーダーを最初から組み直しますか？(現在の打順・守備位置はリセットされます)')) return;
    dispatch({ type: 'SET_LINEUP', gameId: game.id, lineup: [] });
  };

  return (
    <div>
      <div className="card">
        <div className="flex" style={{ marginBottom: 8 }}>
          <h2 className="grow" style={{ marginBottom: 0 }}>オーダー ({game.inning}回{game.isTop ? '表' : '裏'})</h2>
          {coachBtn}
          {!gameStarted && <button className="small" onClick={rebuildLineup}>↻ 組み直す</button>}
        </div>
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
      {coachView}
    </div>
  );
}

import React, { useState } from 'react';
import { useStore, useT, useCurrentGame, usePlayerName } from '../state/store.jsx';
import { POSITIONS, positionLabel, attendeesOf } from '../lib/model.js';
import { isArchived } from '../lib/year.js';
import { canWriteCloud } from '../lib/officialCloud.js';
import Sheet from './Sheet.jsx';
import LineupWizard from './LineupWizard.jsx';
import OppOrderCard, { OppSubstituteSheet } from './OppOrderCard.jsx';
import HeadCoachView from './HeadCoachView.jsx';
import AttendanceSheet from './AttendanceSheet.jsx';

// ---- 交代シート(代打・代走・守備交代) ----
// スコア入力タブ(打者カード/走者タップ)からも再利用するため export する
export function SubstituteSheet({ game, slot, onClose, initialKind = 'ph' }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const [kind, setKind] = useState(initialKind); // ph=代打 pr=代走 def=守備交代
  const [playerId, setPlayerId] = useState('');
  const [position, setPosition] = useState(slot.position);

  const inLineup = new Set(game.lineup.map((l) => l.playerId));
  const candidates = state.players.filter((p) => !inLineup.has(p.id));
  // リエントリーを認めている試合では、再出場は正常なので警告しない
  const isRetired = playerId && game.retiredPlayerIds.includes(playerId) && !game.allowReentry;
  const kindLabel = t(`order.sub.${kind}`);

  const runnerBase = [1, 2, 3].find((b) => game.runners[b]?.playerId === slot.playerId);

  return (
    <Sheet title={t('order.sub.title', { order: slot.order, name: nameOf(slot.playerId) })} onClose={onClose}>
      <div className="grid3">
        {['ph', 'pr', 'def'].map((k) => (
          <button key={k} className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>
            {t(`order.sub.${k}`)}
          </button>
        ))}
      </div>

      {kind === 'pr' && !runnerBase && (
        <div className="warn-box mt8">{t('order.sub.prNoRunner')}</div>
      )}

      <div className="section-title">{t('order.sub.playerIn')}</div>
      <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
        <option value="">{t('order.sub.selectPlayer')}</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}{game.retiredPlayerIds.includes(p.id) ? t('order.sub.usedMark') : ''}
          </option>
        ))}
      </select>

      {isRetired && (
        <div className="warn-box">
          {t('order.sub.retiredWarn', { name: nameOf(playerId) })}
        </div>
      )}

      <div className="section-title">{t('order.sub.position')}</div>
      <select value={position} onChange={(e) => setPosition(e.target.value)}>
        {POSITIONS.map((pos) => (
          <option key={pos} value={pos}>{positionLabel(pos, lang)}</option>
        ))}
      </select>

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button
          className="primary"
          disabled={!playerId || (kind === 'pr' && !runnerBase)}
          onClick={() => {
            dispatch({
              type: 'SUBSTITUTE',
              gameId: game.id,
              order: slot.order,
              playerId,
              position,
              kind, // ph=代打 / pr=代走 / def=守備交代(伝統表記の生成に使う)
              asRunner: kind === 'pr',
              label: t('order.sub.log', {
                kind: kindLabel, inName: nameOf(playerId), order: slot.order, outName: nameOf(slot.playerId),
              }),
            });
            onClose();
          }}
        >
          {t('order.sub.enter', { kind: kindLabel })}
        </button>
      </div>
    </Sheet>
  );
}

// ---- メイン ----
export default function OrderTab() {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const game = useCurrentGame();
  const nameOf = usePlayerName();
  const [subSlot, setSubSlot] = useState(null);
  const [attOpen, setAttOpen] = useState(false); // 今日のメンバーを直す
  const [oppSlot, setOppSlot] = useState(null); // 相手の交代シート
  const [team, setTeam] = useState('mine'); // 'mine' | 'opp'
  const [coachOpen, setCoachOpen] = useState(false);
  // AIスタメン提案は「草野球」エディション限定の機能
  const aiCoachEnabled = state.settings.edition === '草野球';

  // 公式クラウド接続中で書き込み権限が無い場合は編集不可(観戦、ロール未取得も安全側に閲覧専用)
  if (state.settings.officialTeamId && !canWriteCloud(state.settings)) {
    return <div className="big-note">{state.settings.officialRole === 'viewer' ? t('order.viewerOnly') : t('occ.permChecking')}</div>;
  }

  if (!game || game.status === 'finished') {
    return <div className="big-note">{t('order.noGame')}</div>;
  }

  // 試合が始まっているか(打席が記録されている or プレイログがある)
  const gameStarted = game.atBats.length > 0 ||
    game.playLogs.some((l) => ['atbat', 'defense', 'run', 'sb'].includes(l.kind));

  const coachBtn = aiCoachEnabled && <button className="small" onClick={() => setCoachOpen(true)}>{t('order.aiSuggest')}</button>;
  const coachView = aiCoachEnabled && coachOpen && (
    <HeadCoachView game={game} canApply={!gameStarted} onClose={() => setCoachOpen(false)} />
  );

  if (game.lineup.length === 0) {
    return (
      <div>
        {aiCoachEnabled && (
          <div className="card">
            <div className="flex">
              <span className="grow small dim">{t('order.aiHint')}</span>
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
    if (!window.confirm(t('order.rebuildConfirm'))) return;
    dispatch({ type: 'SET_LINEUP', gameId: game.id, lineup: [] });
  };

  const teamName = state.settings.teamName || t('box.myTeam');
  const oppName = game.opponent || t('restab.opponentFallback');
  const seg = (
    <div className="seg-control" role="tablist" aria-label={t('box.teamSwitch')}>
      <button role="tab" aria-selected={team === 'mine'} className={team === 'mine' ? 'on' : ''} onClick={() => setTeam('mine')}>{teamName}</button>
      <button role="tab" aria-selected={team === 'opp'} className={team === 'opp' ? 'on' : ''} onClick={() => setTeam('opp')}>{oppName}</button>
    </div>
  );

  if (team === 'opp') {
    return (
      <div>
        {seg}
        <OppOrderCard game={game} onSubstitute={setOppSlot} />
        {oppSlot && <OppSubstituteSheet game={game} slot={oppSlot} initialKind="def" onClose={() => setOppSlot(null)} />}
      </div>
    );
  }

  return (
    <div>
      {seg}
      <div className="card">
        <div className="flex" style={{ marginBottom: 8 }}>
          <h2 className="grow" style={{ marginBottom: 0 }}>
            {t('order.title', { inning: game.inning, half: t(game.isTop ? 'half.top' : 'half.bottom') })}
          </h2>
          {coachBtn}
          {!gameStarted && <button className="small" onClick={rebuildLineup}>{t('order.rebuild')}</button>}
        </div>
        {/* 参加メンバーは試合開始のときに決めるが、遅刻・早退があるので直せる必要がある。
            ここを直すと打順の自動セットとAIスタメン提案の対象も変わる */}
        <button className="small ghost att-edit" onClick={() => setAttOpen(true)}>
          {t('att.edit', { n: attendeesOf(game, state.players.filter((p) => !isArchived(p))).length })}
        </button>
        {attOpen && (
          <AttendanceSheet
            initial={game.attendees}
            confirmKey="att.save"
            onDone={(ids) => { dispatch({ type: 'SET_ATTENDEES', gameId: game.id, attendees: ids }); setAttOpen(false); }}
            onClose={() => setAttOpen(false)}
          />
        )}
        {game.lineup.map((slot, i) => (
          <div className="row" key={slot.order}>
            <span className="rank-badge">{slot.order}</span>
            <div className="grow" onClick={() => setSubSlot(slot)} role="button">
              <b>{nameOf(slot.playerId)}</b>
              {i === game.batterIndex && <span className="pill blue" style={{ marginLeft: 6 }}>{t('order.nextBatter')}</span>}
              {game.retiredPlayerIds.includes(slot.playerId) && <span className="pill amber" style={{ marginLeft: 6 }}>{t('order.reentry')}</span>}
            </div>
            <select
              className="small"
              style={{ width: 84 }}
              value={slot.position}
              onChange={(e) => dispatch({ type: 'SET_POSITION', gameId: game.id, order: slot.order, position: e.target.value })}
            >
              {POSITIONS.map((pos) => (
                <option key={pos} value={pos}>{positionLabel(pos, lang)}</option>
              ))}
            </select>
            <button className="small" onClick={() => setSubSlot(slot)}>{t('order.change')}</button>
          </div>
        ))}
        <p className="small dim mt8">{t('order.rowHint')}</p>
      </div>

      {game.retiredPlayerIds.length > 0 && (
        <div className="card">
          <h2>{t('order.retiredPlayers')}</h2>
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

import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { POSITIONS, positionLabel } from '../lib/model.js';
import { findPositionIssues } from '../lib/lineupBox.js';
import FullscreenView from './FullscreenView.jsx';

// 代打・代走で入った選手の守備位置を、その攻撃が終わった時点で確認する全画面ビュー。
// 代打がそのまま元の選手の位置に入ることもあれば、他の選手も含めて守備を組み替える
// こともあるため、打順ぜんぶを見ながら決められるようにする。
// 守備位置は '守' の9つ + DH/控 から選ぶ。重複・不在はその場で警告する。
const FIELD_POSITIONS = POSITIONS.filter((p) => p !== '打');

export default function DefenseCheckView({ game, newPlayerIds = [], onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  // 編集中の割り当て(打順→守備位置)。確定するまで試合データは変えない。
  const [draft, setDraft] = useState(() =>
    Object.fromEntries((game.lineup || []).map((l) => [l.order, l.position || ''])));

  const slots = [...(game.lineup || [])].sort((a, b) => a.order - b.order);
  const isNew = (pid) => newPlayerIds.includes(pid);

  // 入力中の内容で重複・不在をその場で判定する(確定後に気づくのを避ける)
  const preview = { lineup: slots.map((l) => ({ ...l, position: draft[l.order] || '' })) };
  const issues = findPositionIssues({ ...preview, startingLineup: [], playLogs: [] });
  const dupPositions = new Set(issues.duplicates.map((d) => d.position));

  const setPos = (order, position) => {
    setDraft((prev) => {
      const next = { ...prev };
      // 同じ守備位置に既に居る選手とは入れ替える(1タップで組み替えられるように)
      if (position && ['DH', '控'].includes(position) === false) {
        for (const [o, p] of Object.entries(next)) {
          if (p === position && Number(o) !== order) next[o] = prev[order] || '';
        }
      }
      next[order] = position;
      return next;
    });
  };

  const save = () => {
    for (const l of slots) {
      const pos = draft[l.order] || '';
      if (pos && pos !== l.position) dispatch({ type: 'SET_POSITION', gameId: game.id, order: l.order, position: pos });
    }
    onClose();
  };

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>{t('dc.later')}</button>
        <h2>{t('dc.title')}</h2>
        <button className="primary small" onClick={save}>{t('dc.confirm')}</button>
      </header>
      <div className="fullscreen-body">
        <p className="small dim" style={{ marginTop: 0 }}>{t('dc.desc', { inning: game.inning })}</p>

        {(issues.duplicates.length > 0 || issues.missing.length > 0) && (
          <div className="warn-box">
            ⚠️ {[
              ...issues.duplicates.map((d) => t('dc.dup', {
                pos: positionLabel(d.position, lang),
                names: d.playerIds.map((id) => nameOf(id)).join('・'),
              })),
              ...issues.missing.map((m) => t('dc.missing', { pos: positionLabel(m.position, lang) })),
            ].join(' ')}
          </div>
        )}

        <div className="card">
          {slots.map((l) => (
            <div className="row" key={l.order}>
              <span className="rank-badge">{l.order}</span>
              <span className="grow">
                {nameOf(l.playerId)}{numberOf(l.playerId) ? <span className="dim small"> #{numberOf(l.playerId)}</span> : ''}
                {isNew(l.playerId) && <span className="pill amber" style={{ marginLeft: 6 }}>{t('dc.newEntry')}</span>}
              </span>
              <select
                value={draft[l.order] || ''}
                onChange={(e) => setPos(l.order, e.target.value)}
                style={{ width: 92, borderColor: dupPositions.has(draft[l.order]) ? 'var(--amber)' : undefined }}
                aria-label={t('dc.posAria', { order: l.order })}
              >
                <option value="">—</option>
                {FIELD_POSITIONS.map((p) => (
                  <option key={p} value={p}>{positionLabel(p, lang)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <button className="primary" style={{ width: '100%' }} onClick={save}>{t('dc.confirm')}</button>
        <button className="ghost mt8" style={{ width: '100%' }} onClick={onClose}>{t('dc.later')}</button>
      </div>
    </FullscreenView>
  );
}

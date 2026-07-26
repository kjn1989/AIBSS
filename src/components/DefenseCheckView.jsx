import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { positionLabel } from '../lib/model.js';
import { findPositionIssues } from '../lib/lineupBox.js';
import { FIELD_SPOTS } from '../lib/fieldSpots.js';
import FullscreenView from './FullscreenView.jsx';
import Sheet from './Sheet.jsx';

// 代打・代走で入った選手の守備位置を、その攻撃が終わった時点で確認する全画面ビュー。
// 代打がそのまま元の選手の位置に入ることもあれば、他の選手も含めて守備を組み替える
// こともあるため、フィールド図でひと目で見えて、タップで入れ替えられるようにする。
export default function DefenseCheckView({ game, newPlayerIds = [], onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  // 編集中の割り当て(打順→守備位置)。確定するまで試合データは変えない。
  const [draft, setDraft] = useState(() =>
    Object.fromEntries((game.lineup || []).map((l) => [l.order, l.position || ''])));
  const [pickerPos, setPickerPos] = useState(null); // 割り当て中のポジション値

  const slots = [...(game.lineup || [])].sort((a, b) => a.order - b.order);
  const isNew = (pid) => newPlayerIds.includes(pid);
  const slotAt = (position) => slots.find((l) => draft[l.order] === position) || null;

  // DH制(打順の誰かが「指」)なら投手は打順外。フィールドには読み取り専用で出す。
  const dhMode = slots.some((l) => draft[l.order] === 'DH');
  const offPitcherId = dhMode && !slotAt('投')
    && game.currentPitcherId && !slots.some((l) => l.playerId === game.currentPitcherId)
    ? game.currentPitcherId : '';
  // 「打」(全員打ち)はフィールド上の守備位置ではないので図には出さない
  const spots = FIELD_SPOTS.filter((s) => s.value !== '打' && (dhMode || s.value !== 'DH'));

  // 入力中の内容で重複・不在をその場で判定する(確定後に気づくのを避ける)
  const preview = { lineup: slots.map((l) => ({ ...l, position: draft[l.order] || '' })) };
  const issues = findPositionIssues({ ...preview, startingLineup: [], playLogs: [] });
  const dupPositions = new Set(issues.duplicates.map((d) => d.position));

  const spotDisplay = (v) => {
    if (v === 'DH') return lang === 'ja' ? '指' : 'DH';
    if (lang === 'ja') return FIELD_SPOTS.find((s) => s.value === v)?.label || v;
    return positionLabel(v, 'en');
  };
  const posLabel = (v) => (!v ? '—' : spotDisplay(v));
  // 捕手は名前を丸の下に出す分だけフィールド下端に近づくので、少し上に置く
  const topOf = (spot) => (spot.value === '捕' ? '86%' : spot.top);

  // ある打順の選手をその守備位置へ。既にそこに居る選手とは持ち場を入れ替える。
  const assign = (position, order) => {
    setDraft((prev) => {
      const next = { ...prev };
      const from = prev[order] || '';
      if (position !== '控') {
        for (const [o, p] of Object.entries(prev)) {
          if (p === position && Number(o) !== order) next[o] = from;
        }
      }
      next[order] = position;
      return next;
    });
  };
  const clearPos = (position) => {
    setDraft((prev) => Object.fromEntries(
      Object.entries(prev).map(([o, p]) => [o, p === position ? '' : p])));
  };

  const save = () => {
    for (const l of slots) {
      const pos = draft[l.order] || '';
      // 9人ぶんの配置をここで作り切っているので、reducer側の自動入れ替えは使わない
      if (pos && pos !== l.position) dispatch({ type: 'SET_POSITION', gameId: game.id, order: l.order, position: pos, swap: false });
    }
    onClose();
  };

  // 守備位置が未定の選手(組み替えの取りこぼしに気づけるように図の下へ出す)
  const unassigned = slots.filter((l) => !draft[l.order] || draft[l.order] === '控');

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

        <div className="pos-field bf dc-field">
          <div className="bf-dirtfan" />
          <div className="bf-mound" />
          <div className="bf-line left" />
          <div className="bf-line right" />
          <div className="bf-basepath" />
          {spots.map((spot) => {
            if (spot.value === '投' && offPitcherId) {
              return (
                <div className="dc-spot fixed" key={spot.value} style={{ left: spot.left, top: topOf(spot) }}>
                  <span className="dc-pos">{spotDisplay(spot.value)}</span>
                  <span className="dc-name">{nameOf(offPitcherId)}</span>
                </div>
              );
            }
            const slot = slotAt(spot.value);
            const cls = [
              'dc-spot',
              slot ? 'taken' : 'empty',
              dupPositions.has(spot.value) ? 'dup' : '',
              slot && isNew(slot.playerId) ? 'fresh' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={spot.value}
                className={cls}
                style={{ left: spot.left, top: topOf(spot) }}
                onClick={() => setPickerPos(spot.value)}
                aria-label={t('dc.spotAria', { pos: spotDisplay(spot.value), name: slot ? nameOf(slot.playerId) : t('dc.empty') })}
              >
                <span className="dc-pos">{spotDisplay(spot.value)}</span>
                <span className="dc-name">{slot ? nameOf(slot.playerId) : t('dc.empty')}</span>
              </button>
            );
          })}
        </div>
        <p className="small dim dc-hint">{t('dc.tapHint')}</p>

        {unassigned.length > 0 && (
          <div className="card dc-bench">
            <div className="small dim" style={{ marginBottom: 6 }}>{t('dc.bench')}</div>
            {unassigned.map((l) => (
              <div className="row" key={l.order}>
                <span className="rank-badge">{l.order}</span>
                <span className="grow">
                  {nameOf(l.playerId)}
                  {numberOf(l.playerId) ? <span className="dim small"> #{numberOf(l.playerId)}</span> : ''}
                  {isNew(l.playerId) && <span className="pill amber" style={{ marginLeft: 6 }}>{t('dc.newEntry')}</span>}
                </span>
                <span className="pos-chip">{posLabel(draft[l.order])}</span>
              </div>
            ))}
          </div>
        )}

        <button className="primary" style={{ width: '100%' }} onClick={save}>{t('dc.confirm')}</button>
        <button className="ghost mt8" style={{ width: '100%' }} onClick={onClose}>{t('dc.later')}</button>

        {/* ポジションタップ時のメンバー選択ポップアップ */}
        {pickerPos && (
          <Sheet title={t('dc.pickTitle', { pos: spotDisplay(pickerPos) })} onClose={() => setPickerPos(null)}>
            <div className="picker-list">
              {slots.map((l) => {
                const here = draft[l.order] === pickerPos;
                return (
                  <button
                    key={l.order}
                    className={`picker-row${here ? ' current' : ''}`}
                    onClick={() => { assign(pickerPos, l.order); setPickerPos(null); }}
                  >
                    <span className="rank-badge">{l.order}</span>
                    <span className="grow" style={{ textAlign: 'left' }}>
                      {nameOf(l.playerId)}
                      {numberOf(l.playerId) && <span className="dim small"> #{numberOf(l.playerId)}</span>}
                      {isNew(l.playerId) && <span className="pill amber" style={{ marginLeft: 6 }}>{t('dc.newEntry')}</span>}
                    </span>
                    <span className={`pos-chip${here ? ' on' : ''}`}>{posLabel(draft[l.order])}</span>
                  </button>
                );
              })}
            </div>
            {slotAt(pickerPos) && (
              <button
                className="ghost danger mt8"
                style={{ width: '100%' }}
                onClick={() => { clearPos(pickerPos); setPickerPos(null); }}
              >
                {t('dc.clearPosition', { name: nameOf(slotAt(pickerPos).playerId) })}
              </button>
            )}
          </Sheet>
        )}
      </div>
    </FullscreenView>
  );
}

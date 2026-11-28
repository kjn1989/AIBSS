import React from 'react';
import { useStore, useT, usePlayerName } from '../state/store.jsx';
import { positionLabel } from '../lib/model.js';
import { FIELD_SPOTS } from '../lib/fieldSpots.js';
import Sheet from './Sheet.jsx';

// 守備につくたびに出す「いまの守備位置」。図で見て、そのままなら「これでOK」、
// 変えるなら「守備位置の交代」(図で組む画面)へ。守備の交代を入れ忘れたまま
// 次の回を記録してしまうのを防ぐ(守備の記録・失策・好守が別の人に付いてしまう)。
// 代打・代走を出した攻撃のあとは、この確認ではなく、組み替えの画面がそのまま開く
export default function DefenseConfirmSheet({ game, onOk, onChange, onNever }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const lineup = game.lineup || [];
  const dh = lineup.some((l) => l.position === 'DH');
  const at = (pos) => {
    const l = lineup.find((x) => x.position === pos);
    if (l) return l.playerId;
    if (pos === '投' && dh) return game.currentPitcherId || '';
    return '';
  };
  const spots = FIELD_SPOTS.filter((s) => s.value !== '打' && s.value !== 'DH');
  const label = (v) => (lang === 'ja' ? FIELD_SPOTS.find((s) => s.value === v)?.label || v : positionLabel(v, 'en'));
  const empty = spots.filter((s) => !at(s.value));
  return (
    <Sheet title={t('dq.title', { inning: game.inning, half: t(game.isTop ? 'half.top' : 'half.bottom') })} onClose={onOk}>
      <div className="pos-field bf dq-field">
        <div className="bf-dirtfan" />
        <div className="bf-mound" />
        <div className="bf-line left" />
        <div className="bf-line right" />
        <div className="bf-basepath" />
        {spots.map((s) => (
          <div key={s.value} className={`dq-spot${at(s.value) ? '' : ' empty'}`} style={{ left: s.left, top: s.value === '捕' ? '86%' : s.top }}>
            <span className="dq-pos">{label(s.value)}</span>
            <span className="dq-name">{at(s.value) ? nameOf(at(s.value)) : t('dc.empty')}</span>
          </div>
        ))}
      </div>
      {dh && (
        <p className="small dim" style={{ margin: '6px 0 0', textAlign: 'center' }}>
          {t('dq.dh', { name: nameOf(lineup.find((l) => l.position === 'DH')?.playerId) })}
        </p>
      )}
      {empty.length > 0 && <div className="warn-box mt8">{t('dc.missing', { pos: empty.map((s) => label(s.value)).join('・') })}</div>}
      <div className="dq-actions">
        <button className="primary big-btn" onClick={onOk}>{t('dq.ok')}</button>
        <button className="big-btn" onClick={onChange}>{t('dq.change')}</button>
      </div>
      <button className="small ghost mt8" style={{ width: '100%' }} onClick={onNever}>{t('dq.never')}</button>
    </Sheet>
  );
}

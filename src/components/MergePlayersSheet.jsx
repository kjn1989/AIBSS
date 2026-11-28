import React, { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import Sheet from './Sheet.jsx';

// 名前の書きまちがいで2人に分かれた選手を、1人にまとめる。
// 「髙島」と「高島」のような異体字は設定の上のほうで自動で見つけるが、
// 「島田」と「嶋田」のように別の名字としてもある組は自動では寄せない。そういうときはここで手で選ぶ。
// まとめる側の全試合の記録(打席・投球・守備・交代・出欠…)が残す側に付け替わり、まとめる側は名簿から消える。
export default function MergePlayersSheet({ onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [fromId, setFromId] = useState('');
  const [keepId, setKeepId] = useState('');

  // 選手ごとの記録の数(どちらに記録があるか見せる)
  const counts = useMemo(() => {
    const m = new Map();
    const add = (id) => { if (id) m.set(id, (m.get(id) || 0) + 1); };
    for (const g of Object.values(state.games)) {
      for (const ab of g.atBats || []) add(ab.playerId);
      for (const r of g.pitchingRecords || []) add(r.playerId);
    }
    return m;
  }, [state.games]);
  const players = [...state.players].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const label = (p) => `${p.name}${p.number ? ` #${p.number}` : ''}（${t('set.dupUses', { n: counts.get(p.id) || 0 })}）`;
  const from = state.players.find((p) => p.id === fromId);
  const keep = state.players.find((p) => p.id === keepId);
  const ok = from && keep && from.id !== keep.id;

  const run = () => {
    if (!ok) return;
    if (!window.confirm(t('merge.confirm', { from: label(from), keep: label(keep) }))) return;
    dispatch({ type: 'MERGE_PLAYERS', keepId: keep.id, mergeId: from.id });
    onClose();
  };

  return (
    <Sheet title={t('merge.title')} onClose={onClose}>
      <p className="small dim" style={{ marginTop: 0 }}>{t('merge.desc')}</p>
      <div className="section-title">{t('merge.from')}</div>
      <select value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label={t('merge.from')}>
        <option value="">{t('merge.pick')}</option>
        {players.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
      </select>
      <div className="section-title">{t('merge.keep')}</div>
      <select value={keepId} onChange={(e) => setKeepId(e.target.value)} aria-label={t('merge.keep')}>
        <option value="">{t('merge.pick')}</option>
        {players.filter((p) => p.id !== fromId).map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
      </select>
      {ok && <div className="warn-box mt8">{t('merge.preview', { from: from.name, keep: keep.name })}</div>}
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" disabled={!ok} onClick={run}>{t('merge.run')}</button>
      </div>
    </Sheet>
  );
}

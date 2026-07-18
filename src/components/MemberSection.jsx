import React, { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { MEMBER_ROLES, memberRoleLabel } from '../lib/model.js';
import ScoutCard from './ScoutCard.jsx';

// 参加メンバー(マネージャー/応援/スタッフ等): 試合に出なくても参加回数を記録し、名鑑も持てる
export default function MemberSection() {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const members = state.members || [];
  const [name, setName] = useState('');
  const [role, setRole] = useState(MEMBER_ROLES[0]);
  const [scoutId, setScoutId] = useState(null);
  // AI選手名鑑は「草野球」エディション限定の機能
  const scoutEnabled = state.settings.edition === '草野球';

  const add = () => {
    const n = name.trim();
    if (!n) return;
    dispatch({ type: 'ADD_MEMBER', name: n, role });
    setName('');
  };

  const setCount = (m, delta) => {
    const next = Math.max(0, (m.participation || 0) + delta);
    dispatch({ type: 'UPDATE_MEMBER', id: m.id, patch: { participation: next } });
  };

  const scoutMember = members.find((m) => m.id === scoutId);

  return (
    <div className="card">
      <h2>{t('member.title')} <span className="dim small">{t('member.titleSub')}</span></h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        {t('member.desc')}
        {scoutEnabled && t('member.scoutHint')}
      </p>

      <div className="flex" style={{ gap: 6, marginBottom: 12 }}>
        <input
          style={{ flex: 1 }}
          placeholder={t('member.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <select style={{ width: 120 }} value={role} onChange={(e) => setRole(e.target.value)}>
          {MEMBER_ROLES.map((r) => <option key={r} value={r}>{memberRoleLabel(r, lang)}</option>)}
        </select>
        <button className="small" onClick={add}>{t('action.add')}</button>
      </div>

      {members.length === 0 ? (
        <p className="small dim">{t('member.empty')}</p>
      ) : (
        members.map((m) => (
          <div className="row" key={m.id}>
            <div className="grow" onClick={() => scoutEnabled && setScoutId(m.id)} role={scoutEnabled ? 'button' : undefined}>
              <b style={{ color: 'var(--accent)' }}>{m.name}</b>
              <span className="pill" style={{ marginLeft: 6 }}>{memberRoleLabel(m.role, lang)}</span>
            </div>
            <div className="stepper" style={{ gap: 8 }}>
              <button className="small" onClick={() => setCount(m, -1)}>−</button>
              <span className="val" style={{ minWidth: 54, fontSize: 16 }}>{m.participation || 0}<span className="dim small">{t('member.timesUnit')}</span></span>
              <button className="small" onClick={() => setCount(m, +1)}>＋</button>
            </div>
            <button
              className="small ghost"
              style={{ color: 'var(--red)' }}
              onClick={() => {
                if (window.confirm(t('member.deleteConfirm', { name: m.name }))) dispatch({ type: 'DELETE_MEMBER', id: m.id });
              }}
            >
              {t('action.delete')}
            </button>
          </div>
        ))
      )}

      {scoutEnabled && scoutMember && (
        <ScoutCard player={scoutMember} saveType="UPDATE_MEMBER" onClose={() => setScoutId(null)} />
      )}
    </div>
  );
}

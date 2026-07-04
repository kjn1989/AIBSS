import React, { useState } from 'react';
import { useStore } from '../state/store.jsx';
import { MEMBER_ROLES } from '../lib/model.js';
import ScoutCard from './ScoutCard.jsx';

// 参加メンバー(マネージャー/応援/スタッフ等): 試合に出なくても参加回数を記録し、名鑑も持てる
export default function MemberSection() {
  const { state, dispatch } = useStore();
  const members = state.members || [];
  const [name, setName] = useState('');
  const [role, setRole] = useState(MEMBER_ROLES[0]);
  const [scoutId, setScoutId] = useState(null);

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
      <h2>参加メンバー <span className="dim small">(マネージャー・応援など)</span></h2>
      <p className="small dim" style={{ marginBottom: 10 }}>
        試合に出場しなくても、マネージャーや応援・宴会などでの参加回数を記録できます。名前をタップすると名鑑ページが開きます。
      </p>

      <div className="flex" style={{ gap: 6, marginBottom: 12 }}>
        <input
          style={{ flex: 1 }}
          placeholder="名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <select style={{ width: 120 }} value={role} onChange={(e) => setRole(e.target.value)}>
          {MEMBER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="small" onClick={add}>追加</button>
      </div>

      {members.length === 0 ? (
        <p className="small dim">まだ参加メンバーがいません。上の欄から追加してください。</p>
      ) : (
        members.map((m) => (
          <div className="row" key={m.id}>
            <div className="grow" onClick={() => setScoutId(m.id)} role="button">
              <b style={{ color: 'var(--accent)' }}>{m.name}</b>
              <span className="pill" style={{ marginLeft: 6 }}>{m.role}</span>
            </div>
            <div className="stepper" style={{ gap: 8 }}>
              <button className="small" onClick={() => setCount(m, -1)}>−</button>
              <span className="val" style={{ minWidth: 54, fontSize: 16 }}>{m.participation || 0}<span className="dim small">回</span></span>
              <button className="small" onClick={() => setCount(m, +1)}>＋</button>
            </div>
            <button
              className="small ghost"
              style={{ color: 'var(--red)' }}
              onClick={() => {
                if (window.confirm(`${m.name} を参加メンバーから削除しますか？`)) dispatch({ type: 'DELETE_MEMBER', id: m.id });
              }}
            >
              削除
            </button>
          </div>
        ))
      )}

      {scoutMember && (
        <ScoutCard player={scoutMember} saveType="UPDATE_MEMBER" onClose={() => setScoutId(null)} />
      )}
    </div>
  );
}

import React, { useState, useRef } from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { POSITIONS } from '../lib/model.js';

// 配列の要素を from→to へ移動した新配列を返す(純関数・テスト容易)
export function moveItem(arr, from, to) {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// フィールド上の守備位置の座標(FieldPad と同系統の配置)。value は POSITIONS の値。
const FIELD_SPOTS = [
  { value: '左', left: '16%', top: '30%' },
  { value: '中', left: '50%', top: '16%' },
  { value: '右', left: '84%', top: '30%' },
  { value: '遊', left: '34%', top: '46%' },
  { value: '二', left: '66%', top: '46%' },
  { value: '三', left: '18%', top: '63%' },
  { value: '一', left: '82%', top: '63%' },
  { value: '投', left: '50%', top: '66%' },
  { value: '捕', left: '50%', top: '89%' },
  { value: 'DH', left: '89%', top: '90%', label: '指' },
  { value: '打', left: '11%', top: '90%', label: '打', shared: true }, // 全員打ち(打撃のみ)。複数人可
];

// ============================================================
// スターティングオーダー設定ウィザード
// 1. 選手選択(タップで打順順に選択) 2. 並べ替え(ドラッグ/▲▼)
// 3. 守備位置(フィールドから選択) → 確定
// ============================================================
export default function LineupWizard({ game }) {
  const { state, dispatch } = useStore();
  const nameOf = usePlayerName();
  const [step, setStep] = useState(1);
  // selected: [{ playerId, position }] を打順順に保持
  const [selected, setSelected] = useState([]);

  const players = state.players.filter((p) => !p.id.startsWith('demo-'));
  const pastGames = Object.values(state.games)
    .filter((g) => g.id !== game.id && (g.lineup?.length > 0))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const selectedIds = new Set(selected.map((s) => s.playerId));

  const toggle = (pid) => {
    if (selectedIds.has(pid)) setSelected(selected.filter((s) => s.playerId !== pid));
    else if (selected.length < 20) setSelected([...selected, { playerId: pid, position: '' }]); // 全員打ちは最大20人
  };

  const autoSelectN = (n) => {
    setSelected(players.slice(0, n).map((p) => ({ playerId: p.id, position: '' })));
  };

  const loadFromPast = (gameId) => {
    const g = state.games[gameId];
    if (!g) return;
    // 存在する選手のみ引き継ぐ
    const existing = new Set(players.map((p) => p.id));
    const next = g.lineup
      .filter((l) => existing.has(l.playerId))
      .sort((a, b) => a.order - b.order)
      .map((l) => ({ playerId: l.playerId, position: l.position || '' }));
    setSelected(next);
  };

  const reorder = (from, to) => setSelected((prev) => moveItem(prev, from, to));

  const assignPosition = (idx, value) => {
    setSelected((prev) => prev.map((s, i) => {
      if (i === idx) return { ...s, position: value };
      // 同じ守備位置を他の選手が持っていたら空ける(1守備位置1人)。
      // '控'(ベンチ)と'打'(全員打ちの打撃のみ)は複数人OK。
      if (s.position === value && value !== '控' && value !== '打') return { ...s, position: '' };
      return s;
    }));
  };

  const confirm = () => {
    // 未割り当ての守備位置: 1〜9番はポジション順の既定、10番以降は「打」(全員打ち)
    const lineup = selected.map((s, i) => ({
      order: i + 1,
      playerId: s.playerId,
      position: s.position || (i < 9 ? POSITIONS[i] : '打'),
    }));
    dispatch({ type: 'SET_LINEUP', gameId: game.id, lineup });
  };

  return (
    <div>
      <StepHeader step={step} />

      {step === 1 && (
        <SelectStep
          players={players}
          selected={selected}
          selectedIds={selectedIds}
          nameOf={nameOf}
          numberOf={(id) => players.find((p) => p.id === id)?.number || ''}
          pastGames={pastGames}
          onToggle={toggle}
          onAutoSelect={autoSelectN}
          onLoadPast={loadFromPast}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <ReorderStep
          selected={selected}
          nameOf={nameOf}
          numberOf={(id) => players.find((p) => p.id === id)?.number || ''}
          onReorder={reorder}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <PositionStep
          selected={selected}
          nameOf={nameOf}
          numberOf={(id) => players.find((p) => p.id === id)?.number || ''}
          onAssign={assignPosition}
          onBack={() => setStep(2)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

function StepHeader({ step }) {
  const labels = ['選手選択', '打順並べ替え', '守備位置'];
  return (
    <div className="wizard-steps">
      {labels.map((l, i) => (
        <div key={l} className={`wizard-step${step === i + 1 ? ' active' : ''}${step > i + 1 ? ' done' : ''}`}>
          <span className="ws-num">{step > i + 1 ? '✓' : i + 1}</span>{l}
        </div>
      ))}
    </div>
  );
}

// ---- ステップ1: 選手をタップで打順順に選択 ----
function SelectStep({ players, selected, selectedIds, nameOf, numberOf, pastGames, onToggle, onAutoSelect, onLoadPast, onNext }) {
  const orderOf = (pid) => selected.findIndex((s) => s.playerId === pid) + 1;
  return (
    <div className="card">
      <div className="wizard-nav">
        <span className="grow" />
        <button className="primary" disabled={selected.length === 0} onClick={onNext}>次へ(打順の並べ替え)</button>
      </div>
      <h2>選手を打順順にタップ ({selected.length}人選択中)</h2>
      <p className="small dim" style={{ marginBottom: 6 }}>タップした順が打順になります。全員打ち(守備につかない打者)は最大20人までOK。</p>
      {players.length === 0 && <div className="warn-box">⚙️ 設定タブで選手を登録してください。</div>}

      {pastGames.length > 0 && (
        <div className="flex mt8">
          <span className="small dim">過去のオーダーを参照</span>
          <select
            className="grow"
            defaultValue=""
            onChange={(e) => { if (e.target.value) onLoadPast(e.target.value); e.target.value = ''; }}
          >
            <option value="">試合を選ぶ…</option>
            {pastGames.map((g) => (
              <option key={g.id} value={g.id}>{g.date} vs {g.opponent || '対戦相手'}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid2 mt8">
        <button className="small" onClick={() => onAutoSelect(9)} disabled={players.length === 0}>登録順に9人選択</button>
        <button className="small" onClick={() => onAutoSelect(Math.min(20, players.length))} disabled={players.length === 0}>全員選択(全員打ち)</button>
      </div>

      <div className="mt12">
        {players.map((p) => {
          const on = selectedIds.has(p.id);
          return (
            <button key={p.id} className={`select-row${on ? ' on' : ''}`} onClick={() => onToggle(p.id)}>
              <span className={`sel-badge${on ? ' on' : ''}`}>{on ? orderOf(p.id) : '＋'}</span>
              <span className="grow" style={{ textAlign: 'left' }}>{p.name}</span>
              {p.number && <span className="dim small">#{p.number}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- ステップ2: ドラッグ/▲▼で打順を並べ替え ----
function ReorderStep({ selected, nameOf, numberOf, onReorder, onBack, onNext }) {
  // ドラッグ中は配列を並べ替えず、各行を transform でスライドさせて
  // 「掴んだ行が指に追従し、他の行が隙間を空ける」動きをリアルタイムに見せる。
  // 確定(pointerup)時にだけ実際の並べ替えを反映する。
  const [drag, setDrag] = useState(null); // { idx, startY, curY, rowH }
  const rowRefs = useRef([]);

  const targetIndex = () => {
    if (!drag) return null;
    const delta = Math.round((drag.curY - drag.startY) / drag.rowH);
    return Math.max(0, Math.min(selected.length - 1, drag.idx + delta));
  };

  const onDown = (e, idx) => {
    const el = rowRefs.current[idx];
    const rowH = el ? el.getBoundingClientRect().height + 8 : 60; // 高さ + 行間
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag({ idx, startY: e.clientY, curY: e.clientY, rowH });
  };
  const onMove = (e) => {
    if (!drag) return;
    e.preventDefault();
    setDrag((d) => (d ? { ...d, curY: e.clientY } : d));
  };
  const onUp = () => {
    if (drag) {
      const to = targetIndex();
      if (to !== null && to !== drag.idx) onReorder(drag.idx, to);
    }
    setDrag(null);
  };

  const tIdx = targetIndex();
  const rowStyle = (i) => {
    if (!drag) return undefined;
    if (i === drag.idx) {
      // 掴んだ行: 指に1:1追従、浮かせる(transitionなし)
      return { transform: `translateY(${drag.curY - drag.startY}px)`, zIndex: 5, transition: 'none' };
    }
    // 他の行: ドラッグ元と挿入先の間にある行を1行分ずらして隙間を作る
    let shift = 0;
    if (drag.idx < tIdx && i > drag.idx && i <= tIdx) shift = -drag.rowH;
    else if (drag.idx > tIdx && i >= tIdx && i < drag.idx) shift = drag.rowH;
    return { transform: `translateY(${shift}px)` };
  };

  return (
    <div className="card">
      {/* ナビは上部に配置 */}
      <div className="wizard-nav">
        <button className="ghost" onClick={onBack}>戻る</button>
        <button className="primary" onClick={onNext}>次へ(守備位置)</button>
      </div>
      <h2>打順を並べ替え</h2>
      <p className="small dim" style={{ marginBottom: 8 }}>右端の ≡ を上下にドラッグ、または ▲▼ で入れ替えできます。</p>
      <div className="lineup-droparea">
        {selected.map((s, i) => (
          <div
            key={s.playerId}
            ref={(el) => (rowRefs.current[i] = el)}
            className={`lineup-row${drag?.idx === i ? ' dragging' : ''}`}
            style={rowStyle(i)}
          >
            <span className="rank-badge">{i + 1}</span>
            <span className="grow">{nameOf(s.playerId)} {numberOf(s.playerId) && <span className="dim small">#{numberOf(s.playerId)}</span>}</span>
            <div className="reorder-arrows">
              <button className="mini" disabled={i === 0} onClick={() => onReorder(i, i - 1)} aria-label="上へ">▲</button>
              <button className="mini" disabled={i === selected.length - 1} onClick={() => onReorder(i, i + 1)} aria-label="下へ">▼</button>
            </div>
            <button
              className="drag-handle"
              aria-label="ドラッグして並べ替え"
              onPointerDown={(e) => onDown(e, i)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              ≡
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- ステップ3: フィールドから守備位置を選択 ----
function PositionStep({ selected, nameOf, numberOf, onAssign, onBack, onConfirm }) {
  const [cur, setCur] = useState(0); // 現在割り当て中の打順index
  const curPlayer = selected[cur];
  // position値 → その位置を守っている選手のindex
  const holderOf = (value) => selected.findIndex((s) => s.position === value);

  const pick = (value) => {
    onAssign(cur, value);
    // 未割り当ての次の選手へ自動で進む
    const nextUnassigned = selected.findIndex((s, i) => i > cur && !s.position);
    if (nextUnassigned >= 0) setCur(nextUnassigned);
    else if (cur < selected.length - 1) setCur(cur + 1);
  };

  return (
    <div className="card">
      {/* ナビは上部に配置 */}
      <div className="wizard-nav">
        <button className="ghost" onClick={onBack}>戻る</button>
        <button className="primary" onClick={onConfirm}>このオーダーで確定</button>
      </div>
      <h2>守備位置を選択</h2>
      {/* 現在の選手ナビ */}
      <div className="pos-navbar">
        <button className="mini" disabled={cur === 0} onClick={() => setCur(cur - 1)} aria-label="前の選手">‹</button>
        <div className="pos-cur">
          <span className="rank-badge">{cur + 1}</span>
          <b>{nameOf(curPlayer.playerId)}</b>
          {numberOf(curPlayer.playerId) && <span className="dim small"> #{numberOf(curPlayer.playerId)}</span>}
          {curPlayer.position && <span className="pill blue" style={{ marginLeft: 6 }}>{curPlayer.position === 'DH' ? '指' : curPlayer.position}</span>}
        </div>
        <button className="mini" disabled={cur === selected.length - 1} onClick={() => setCur(cur + 1)} aria-label="次の選手">›</button>
      </div>

      {/* フィールド */}
      <div className="pos-field bf">
        <div className="bf-dirtfan" />
        <div className="bf-mound" />
        <div className="bf-line left" />
        <div className="bf-line right" />
        <div className="bf-basepath" />
        {FIELD_SPOTS.map((spot) => {
          const isCur = curPlayer.position === spot.value;
          // '打'(全員打ち)は複数人可。担当者名は出さず、人数を添える。
          if (spot.shared) {
            const count = selected.filter((s) => s.position === spot.value).length;
            return (
              <button
                key={spot.value}
                className={`pos-spot shared${isCur ? ' cur' : ''}`}
                style={{ left: spot.left, top: spot.top }}
                onClick={() => pick(spot.value)}
              >
                {spot.label}{count > 0 ? ` ${count}` : ''}
              </button>
            );
          }
          const holder = holderOf(spot.value);
          const taken = holder >= 0;
          return (
            <button
              key={spot.value}
              className={`pos-spot${isCur ? ' cur' : taken ? ' taken' : ''}`}
              style={{ left: spot.left, top: spot.top }}
              onClick={() => pick(spot.value)}
            >
              {taken ? nameOf(selected[holder].playerId) : (spot.label || spot.value)}
            </button>
          );
        })}
      </div>

      <button className="ghost small mt8" onClick={() => onAssign(cur, '')}>この選手の守備位置をクリア</button>
    </div>
  );
}

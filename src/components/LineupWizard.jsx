import React, { useState, useRef } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { positionLabel } from '../lib/model.js';
import Sheet from './Sheet.jsx';

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
  const t = useT();
  const nameOf = usePlayerName();
  const [step, setStep] = useState(1);
  // selected: [{ playerId, position }] を打順順に保持
  const [selected, setSelected] = useState([]);
  const [useDH, setUseDH] = useState(false); // DH制(投手は打たず、DHが代わりに打つ)
  const [pitcherId, setPitcherId] = useState(''); // DH制時の打順外の投手

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

  // ポジション P に打順index xi の選手を割り当てる。
  // Xが別ポジションを守っていて、Pに既に別の選手がいれば2人をスワップ(入れ替え)。
  // '打'(全員打ち)・'控'は複数人可なので単純設定。
  const assignPlayerToPosition = (position, xi) => {
    setSelected((prev) => {
      const arr = prev.map((s) => ({ ...s }));
      if (position === '打' || position === '控') {
        arr[xi].position = position;
        return arr;
      }
      const oldX = arr[xi].position;
      const H = arr.findIndex((s, i) => i !== xi && s.position === position);
      if (H >= 0) arr[H].position = oldX; // スワップ相手はXの元の位置へ
      arr[xi].position = position;
      return arr;
    });
  };
  // そのポジションを守っている選手を守備なし(空き)に戻す
  const clearPositionHolder = (position) => {
    setSelected((prev) => prev.map((s) => (s.position === position ? { ...s, position: '' } : s)));
  };

  const confirm = () => {
    // 未割り当ての守備位置の既定値:
    // DHなし → 投捕一二三遊左中右(投手も打つ)、DHあり → 捕一二三遊左中右+指(投手は打順外)、
    // 10番目以降(全員打ち)は「打」
    const DEF_NO_DH = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
    const DEF_DH = ['捕', '一', '二', '三', '遊', '左', '中', '右', 'DH'];
    const defaults = useDH ? DEF_DH : DEF_NO_DH;
    const lineup = selected.map((s, i) => ({
      order: i + 1,
      playerId: s.playerId,
      position: s.position || (i < 9 ? defaults[i] : '打'),
    }));
    dispatch({ type: 'SET_LINEUP', gameId: game.id, lineup });
    // 先発投手を確定: DH制なら打順外の投手、DHなしなら打順内で「投」を守る選手
    const pid = useDH ? pitcherId : (lineup.find((l) => l.position === '投')?.playerId || '');
    if (pid) {
      dispatch({ type: 'SET_PITCHER', gameId: game.id, playerId: pid, label: t('pt.starterLog', { name: nameOf(pid) }) });
    }
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
          useDH={useDH}
          onToggleDH={setUseDH}
          pitcherId={pitcherId}
          onPitcher={setPitcherId}
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
          onAssignPlayer={assignPlayerToPosition}
          onClearPosition={clearPositionHolder}
          onBack={() => setStep(2)}
          onConfirm={confirm}
          useDH={useDH}
          pitcherId={pitcherId}
        />
      )}
    </div>
  );
}

function StepHeader({ step }) {
  const t = useT();
  const labels = [t('lw.step1'), t('lw.step2'), t('lw.step3')];
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
function SelectStep({ players, selected, selectedIds, nameOf, numberOf, pastGames, onToggle, onAutoSelect, onLoadPast, onNext, useDH, onToggleDH, pitcherId, onPitcher }) {
  const t = useT();
  const orderOf = (pid) => selected.findIndex((s) => s.playerId === pid) + 1;
  const benchForPitcher = players.filter((p) => !selectedIds.has(p.id)); // 打順に入っていない選手=投手候補
  return (
    <div className="card">
      <div className="wizard-nav">
        <span className="grow" />
        <button className="primary" disabled={selected.length === 0} onClick={onNext}>{t('lw.nextReorder')}</button>
      </div>
      <h2>{t('lw.selectTitle', { n: selected.length })}</h2>
      <p className="small dim" style={{ marginBottom: 6 }}>{t('lw.selectHint')}</p>

      {/* DH制の有無 */}
      <div className="dh-toggle">
        <span className="grow small">{t('lw.dhLabel')}</span>
        <div className="toggle-row" style={{ width: 140, marginBottom: 0 }}>
          <button className={!useDH ? 'active' : ''} onClick={() => onToggleDH(false)}>{t('lw.dhOff')}</button>
          <button className={useDH ? 'active' : ''} onClick={() => onToggleDH(true)}>{t('lw.dhOn')}</button>
        </div>
      </div>
      {useDH && (
        <div className="flex mt8">
          <span className="small dim">{t('lw.pitcherOffOrder')}</span>
          <select className="grow" aria-label={t('lw.pitcherAria')} value={pitcherId} onChange={(e) => onPitcher(e.target.value)}>
            <option value="">{t('lw.chooseLater')}</option>
            {benchForPitcher.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.number ? ` #${p.number}` : ''}</option>
            ))}
          </select>
        </div>
      )}

      {players.length === 0 && <div className="warn-box">{t('score.registerFirst')}</div>}

      {pastGames.length > 0 && (
        <div className="flex mt8">
          <span className="small dim">{t('lw.refPast')}</span>
          <select
            className="grow"
            defaultValue=""
            onChange={(e) => { if (e.target.value) onLoadPast(e.target.value); e.target.value = ''; }}
          >
            <option value="">{t('lw.chooseGame')}</option>
            {pastGames.map((g) => (
              <option key={g.id} value={g.id}>{g.date} vs {g.opponent || t('restab.opponentFallback')}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid2 mt8">
        <button className="small" onClick={() => onAutoSelect(9)} disabled={players.length === 0}>{t('lw.auto9')}</button>
        <button className="small" onClick={() => onAutoSelect(Math.min(20, players.length))} disabled={players.length === 0}>{t('lw.autoAll')}</button>
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
  const t = useT();
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
        <button className="ghost" onClick={onBack}>{t('lw.back')}</button>
        <button className="primary" onClick={onNext}>{t('lw.nextPosition')}</button>
      </div>
      <h2>{t('lw.reorderTitle')}</h2>
      <p className="small dim" style={{ marginBottom: 8 }}>{t('lw.reorderHint')}</p>
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
              <button className="mini" disabled={i === 0} onClick={() => onReorder(i, i - 1)} aria-label={t('lw.up')}>▲</button>
              <button className="mini" disabled={i === selected.length - 1} onClick={() => onReorder(i, i + 1)} aria-label={t('lw.down')}>▼</button>
            </div>
            <button
              className="drag-handle"
              aria-label={t('lw.dragAria')}
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

// ---- ステップ3: フィールドの各ポジションをタップ → メンバーリストで割り当て/入れ替え ----
function PositionStep({ selected, nameOf, numberOf, onAssignPlayer, onClearPosition, onBack, onConfirm, useDH, pitcherId }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const [pickerPos, setPickerPos] = useState(null); // 割り当て中のポジション値
  const holderOf = (value) => selected.findIndex((s) => s.position === value);
  // DH制なら「投」は打順外の投手が守るので打者からは選べない。DHなしなら「指(DH)」は使わない。
  const spots = FIELD_SPOTS.filter((s) => (useDH ? s.value !== '投' : s.value !== 'DH'));
  // 選手の現在守備位置の表示(チップ)
  const posLabel = (v) => (!v ? t('lw.posNone') : v === 'DH' ? t('lw.posDh') : (lang === 'ja' ? v : positionLabel(v, 'en')));
  // フィールド上/ピッカー見出しの位置表記
  const spotDisplay = (v) => {
    if (v === 'DH') return t('lw.posDh');
    if (lang === 'ja') return FIELD_SPOTS.find((s) => s.value === v)?.label || v;
    return positionLabel(v, 'en');
  };

  return (
    <div className="card">
      {/* ナビは上部に配置 */}
      <div className="wizard-nav">
        <button className="ghost" onClick={onBack}>{t('lw.back')}</button>
        <button className="primary" onClick={onConfirm}>{t('lw.confirmLineup')}</button>
      </div>
      <h2>{t('lw.positionTitle')}</h2>
      <p className="small dim" style={{ marginBottom: 8 }}>
        {t('lw.positionHint')}
      </p>

      {/* フィールド */}
      <div className="pos-field bf">
        <div className="bf-dirtfan" />
        <div className="bf-mound" />
        <div className="bf-line left" />
        <div className="bf-line right" />
        <div className="bf-basepath" />
        {spots.map((spot) => {
          // '打'(全員打ち)は複数人可。担当者名は出さず人数を添える。
          if (spot.shared) {
            const count = selected.filter((s) => s.position === spot.value).length;
            return (
              <button
                key={spot.value}
                className="pos-spot shared"
                style={{ left: spot.left, top: spot.top }}
                onClick={() => setPickerPos(spot.value)}
              >
                {spotDisplay(spot.value)}{count > 0 ? ` ${count}` : ''}
              </button>
            );
          }
          const holder = holderOf(spot.value);
          const taken = holder >= 0;
          return (
            <button
              key={spot.value}
              className={`pos-spot${taken ? ' taken' : ''}`}
              style={{ left: spot.left, top: spot.top }}
              onClick={() => setPickerPos(spot.value)}
            >
              {taken ? nameOf(selected[holder].playerId) : spotDisplay(spot.value)}
            </button>
          );
        })}
        {/* DH制: 投手は打順外。フィールド上に読み取り専用で表示 */}
        {useDH && (
          <div className="pos-spot pitcher-fixed" style={{ left: '50%', top: '66%' }}>
            {pitcherId ? nameOf(pitcherId) : t('lw.pitcherTbd')}
          </div>
        )}
      </div>
      {useDH && (
        <p className="small dim mt8">{pitcherId ? t('lw.dhStarter', { name: nameOf(pitcherId) }) : t('lw.dhStarterLater')}</p>
      )}

      {/* ポジションタップ時のメンバー選択ポップアップ */}
      {pickerPos && (
        <Sheet title={t('lw.pickerTitle', { pos: spotDisplay(pickerPos) })} onClose={() => setPickerPos(null)}>
          <div className="picker-list">
            {selected.map((s, i) => {
              const here = s.position === pickerPos;
              return (
                <button
                  key={s.playerId}
                  className={`picker-row${here ? ' current' : ''}`}
                  onClick={() => { onAssignPlayer(pickerPos, i); setPickerPos(null); }}
                >
                  <span className="rank-badge">{i + 1}</span>
                  <span className="grow" style={{ textAlign: 'left' }}>
                    {nameOf(s.playerId)}{numberOf(s.playerId) && <span className="dim small"> #{numberOf(s.playerId)}</span>}
                  </span>
                  <span className={`pos-chip${here ? ' on' : ''}`}>{here ? t('lw.onDefense') : posLabel(s.position)}</span>
                </button>
              );
            })}
          </div>
          {pickerPos !== '打' && holderOf(pickerPos) >= 0 && (
            <button
              className="ghost danger mt8"
              style={{ width: '100%' }}
              onClick={() => { onClearPosition(pickerPos); setPickerPos(null); }}
            >
              {t('lw.clearPosition', { name: nameOf(selected[holderOf(pickerPos)].playerId) })}
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}

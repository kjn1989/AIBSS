import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { positionLabel, attendeesOf } from '../lib/model.js';
import { isArchived } from '../lib/year.js';
import { FIELD_SPOTS } from '../lib/fieldSpots.js';
import FullscreenView from './FullscreenView.jsx';
import Sheet from './Sheet.jsx';

// ============================================================
// 守備交代(フィールドの図で組む)
//
// 守備に就くときの交代は、たいてい何人かが一度に動く(代打を下げて守備固め、
// それに合わせて2人の位置が入れ替わる、投手も代わる…)。以前のこの画面は
// 打順にいる選手の位置を動かすことしかできず、控えを入れるにはオーダー画面と行き来が要った。
//
//   ・守備位置を押す → 「打順の選手」と「控えの選手」の両方から選べる
//       打順の選手を選ぶ … その位置にいた選手と持ち場を入れ替える
//       控えの選手を選ぶ … その位置にいた選手と交代(その選手の打順に入る)
//   ・マウンドも同じ。DH制なら投手だけが代わる
//   ・図の下に打順を並べ、変わった打順・位置に色を付ける(打順の整合性をその場で確かめる)
//   ・確定は1回(LINEUP_CHANGES)、取り消しも1回
// 代打・代走を出した攻撃のあとには自動で開き、守備中はスコア画面の「🔁 守備交代」から開く
// ============================================================
const UNIQUE = new Set(['投', '捕', '一', '二', '三', '遊', '左', '中', '右', 'DH']);

export default function DefenseCheckView({ game, newPlayerIds = [], onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  const slots = [...(game.lineup || [])].sort((a, b) => a.order - b.order);
  // 編集中の形。確定するまで試合データは変えない
  const [draft, setDraft] = useState(() => Object.fromEntries(slots.map((l) => [l.order, l.position || ''])));
  const [subs, setSubs] = useState({}); // { 打順: 入る選手ID }
  const [pitcher, setPitcher] = useState(game.currentPitcherId || ''); // DH制の打順外の投手
  const [pickerPos, setPickerPos] = useState(null);

  const playerAt = (l) => subs[l.order] || l.playerId;
  const slotAt = (position) => slots.find((l) => draft[l.order] === position) || null;
  const isNew = (pid) => newPlayerIds.includes(pid) || Object.values(subs).includes(pid);
  const dhMode = slots.some((l) => draft[l.order] === 'DH');
  const offPitcher = dhMode && !slotAt('投') ? pitcher : '';

  // 控え: 確定後の打順と投手に居ない人。退いた選手はリエントリーありの試合だけ
  const players = state.players.filter((p) => !isArchived(p));
  const here = new Set(attendeesOf(game, players).map((p) => p.id));
  const taken = new Set([...slots.map(playerAt), ...(offPitcher ? [offPitcher] : [])]);
  const leaving = new Set(slots.filter((l) => subs[l.order]).map((l) => l.playerId));
  const bench = players
    .filter((p) => !taken.has(p.id) && !leaving.has(p.id) && (game.allowReentry || !game.retiredPlayerIds.includes(p.id)))
    .sort((a, b) => (here.has(b.id) ? 1 : 0) - (here.has(a.id) ? 1 : 0));

  // 重なり・空き(確定前にその場で分かるように)
  const field = slots.map((l) => draft[l.order]).filter((p) => UNIQUE.has(p));
  const dup = [...new Set(field.filter((p, i) => field.indexOf(p) !== i))];
  const need = ['捕', '一', '二', '三', '遊', '左', '中', '右', ...(dhMode ? [] : ['投'])];
  const missing = slots.length >= 9 ? need.filter((p) => !field.includes(p)) : [];
  const dhAndP = dhMode && !!slotAt('投');

  const spotDisplay = (v) => {
    if (v === 'DH') return lang === 'ja' ? '指' : 'DH';
    if (lang === 'ja') return FIELD_SPOTS.find((s) => s.value === v)?.label || v;
    return positionLabel(v, 'en');
  };
  const posLabel = (v) => (!v ? '—' : spotDisplay(v));
  const topOf = (spot) => (spot.value === '捕' ? '86%' : spot.top);
  const spots = FIELD_SPOTS.filter((s) => s.value !== '打' && (dhMode || s.value !== 'DH'));

  // 打順の選手をその位置へ(そこにいた選手とは持ち場を入れ替える)
  const assign = (position, order) => setDraft((prev) => {
    const next = { ...prev };
    const from = prev[order] || '';
    if (UNIQUE.has(position)) for (const [o, p] of Object.entries(prev)) if (p === position && Number(o) !== order) next[o] = from;
    next[order] = position;
    return next;
  });
  // 控えの選手を、その位置にいた選手と交代させる(打順はそのまま引き継ぐ)
  const bringIn = (position, playerId) => {
    if (position === '投' && dhMode && !slotAt('投')) { setPitcher(playerId); return; }
    const holder = slotAt(position);
    if (!holder) return;
    setSubs((prev) => ({ ...prev, [holder.order]: playerId }));
  };
  const revert = (order) => setSubs((prev) => { const m = { ...prev }; delete m[order]; return m; });

  const changedPos = slots.filter((l) => (draft[l.order] || '') !== (l.position || ''));
  const nSubs = Object.keys(subs).length;
  const pitcherChanged = dhMode && pitcher && pitcher !== game.currentPitcherId;
  const nChanges = nSubs + changedPos.length + (pitcherChanged ? 1 : 0);
  const blocked = dup.length > 0 || dhAndP;

  const save = () => {
    if (!nChanges) { onClose(); return; }
    // 新しい投手(DHなしは「投」に入った選手、DH制は打順外の投手)
    const mound = slotAt('投');
    const nextPitcher = mound ? playerAt(mound) : pitcher;
    dispatch({
      type: 'LINEUP_CHANGES',
      gameId: game.id,
      subs: slots.filter((l) => subs[l.order]).map((l) => ({
        order: l.order, playerId: subs[l.order], kind: 'def',
        label: t('order.sub.log', { kind: t('order.sub.def'), inName: nameOf(subs[l.order]), order: l.order, outName: nameOf(l.playerId) }),
      })),
      positions: Object.fromEntries(changedPos.map((l) => [l.order, draft[l.order] || '控'])),
      pitcherId: dhMode ? pitcher || undefined : undefined,
      pitcherLabel: game.currentPitcherId
        ? t('pt.relievedLog', { name: nameOf(nextPitcher), prev: nameOf(game.currentPitcherId) })
        : t('pt.starterLog', { name: nameOf(nextPitcher) }),
    });
    onClose();
  };

  const pickHolder = pickerPos ? slotAt(pickerPos) : null;

  return (
    <FullscreenView>
      <header className="fullscreen-header">
        <button className="ghost small" onClick={onClose}>{t('dc.later')}</button>
        <h2>{newPlayerIds.length ? t('dc.title') : t('dc.titleManual')}</h2>
        <button className="primary small" disabled={blocked} onClick={save}>{t('dc.confirm')}</button>
      </header>
      <div className="fullscreen-body">
        <p className="small dim" style={{ marginTop: 0 }}>
          {newPlayerIds.length ? t('dc.desc', { inning: game.inning }) : t('dc.descManual')}
        </p>

        {(dup.length > 0 || missing.length > 0 || dhAndP) && (
          <div className="warn-box">
            ⚠️ {[
              ...dup.map((p) => t('dc.dup', {
                pos: positionLabel(p, lang),
                names: slots.filter((l) => draft[l.order] === p).map((l) => nameOf(playerAt(l))).join('・'),
              })),
              ...missing.map((p) => t('dc.missing', { pos: positionLabel(p, lang) })),
              ...(dhAndP ? [t('lc.dhAndP')] : []),
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
            const slot = slotAt(spot.value);
            const offMound = spot.value === '投' && offPitcher;
            const who = offMound ? offPitcher : slot ? playerAt(slot) : '';
            const changed = offMound ? pitcherChanged : slot && (subs[slot.order] || (draft[slot.order] || '') !== (slot.position || ''));
            const cls = [
              'dc-spot',
              who ? 'taken' : 'empty',
              dup.includes(spot.value) ? 'dup' : '',
              who && isNew(who) ? 'fresh' : '',
              changed ? 'changed' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={spot.value}
                className={cls}
                style={{ left: spot.left, top: topOf(spot) }}
                onClick={() => setPickerPos(spot.value)}
                aria-label={t('dc.spotAria', { pos: spotDisplay(spot.value), name: who ? nameOf(who) : t('dc.empty') })}
              >
                <span className="dc-pos">{spotDisplay(spot.value)}</span>
                <span className="dc-name">{who ? nameOf(who) : t('dc.empty')}</span>
              </button>
            );
          })}
        </div>
        <p className="small dim dc-hint">{t('dc.tapHint2')}</p>

        {/* 打順。変わった打順(交代)と位置を色で見せる */}
        <div className="card dc-order">
          <div className="small dim" style={{ marginBottom: 6 }}>{t('dc.orderTitle')}</div>
          {slots.map((l) => {
            const inId = subs[l.order];
            const moved = (draft[l.order] || '') !== (l.position || '');
            return (
              <div className={`row dc-order-row${inId ? ' sub' : moved ? ' moved' : ''}`} key={l.order}>
                <span className="rank-badge">{l.order}</span>
                <button className="grow dc-order-name" onClick={() => draft[l.order] && setPickerPos(draft[l.order])}>
                  {inId ? (<><s className="dim">{nameOf(l.playerId)}</s> → <b>{nameOf(inId)}</b></>) : <b>{nameOf(l.playerId)}</b>}
                  {numberOf(playerAt(l)) && <span className="dim small"> #{numberOf(playerAt(l))}</span>}
                </button>
                <span className={`pos-chip${moved ? ' on' : ''}`}>
                  {moved && l.position ? `${posLabel(l.position)}→` : ''}{posLabel(draft[l.order])}
                </span>
                {inId && <button className="small ghost" onClick={() => revert(l.order)} aria-label={t('lc.revert')}>↩</button>}
              </div>
            );
          })}
          {dhMode && offPitcher && (
            <div className={`row dc-order-row${pitcherChanged ? ' sub' : ''}`}>
              <span className="rank-badge">{t('paste.pitcherBadge')}</span>
              <span className="grow">
                {pitcherChanged ? (<><s className="dim">{nameOf(game.currentPitcherId)}</s> → <b>{nameOf(pitcher)}</b></>) : <b>{nameOf(pitcher)}</b>}
                <span className="dim small"> {t('lc.pitcherRow')}</span>
              </span>
            </div>
          )}
        </div>

        <button className="primary" style={{ width: '100%' }} disabled={blocked} onClick={save}>
          {nChanges ? t('dc.confirmN', { n: nChanges }) : t('dc.noChange')}
        </button>
        <button className="ghost mt8" style={{ width: '100%' }} onClick={onClose}>{t('dc.later')}</button>

        {pickerPos && (
          <Sheet title={t('dc.pickTitle', { pos: spotDisplay(pickerPos) })} onClose={() => setPickerPos(null)}>
            {(pickHolder || (pickerPos === '投' && offPitcher)) && (
              <p className="small dim" style={{ marginTop: 0 }}>
                {t('dc.nowHere', { name: nameOf(pickHolder ? playerAt(pickHolder) : offPitcher) })}
              </p>
            )}
            {(pickHolder || (pickerPos === '投' && dhMode)) && (
              <>
                <div className="section-title" style={{ marginTop: 0 }}>{t('dc.fromBench')}</div>
                {bench.length === 0 && <p className="small dim">{t('pc.noBench')}</p>}
                <div className="lc-chips">
                  {bench.map((p) => (
                    <button key={p.id} onClick={() => { bringIn(pickerPos, p.id); setPickerPos(null); }}>
                      {p.name}{game.retiredPlayerIds.includes(p.id) && <span className="small dim"> {t('lc.reentry')}</span>}
                    </button>
                  ))}
                </div>
                <p className="small dim" style={{ margin: '4px 0 0' }}>
                  {pickHolder ? t('dc.benchNote', { name: nameOf(playerAt(pickHolder)), order: pickHolder.order }) : t('dc.benchNoteDh')}
                </p>
              </>
            )}
            {!(pickerPos === '投' && dhMode && !pickHolder) && (
              <>
                <div className="section-title">{t('dc.fromLineup')}</div>
                <div className="picker-list">
                  {slots.map((l) => {
                    const on = draft[l.order] === pickerPos;
                    return (
                      <button
                        key={l.order}
                        className={`picker-row${on ? ' current' : ''}`}
                        onClick={() => { assign(pickerPos, l.order); setPickerPos(null); }}
                      >
                        <span className="rank-badge">{l.order}</span>
                        <span className="grow" style={{ textAlign: 'left' }}>
                          {nameOf(playerAt(l))}
                          {isNew(playerAt(l)) && <span className="pill amber" style={{ marginLeft: 6 }}>{t('dc.newEntry')}</span>}
                        </span>
                        <span className={`pos-chip${on ? ' on' : ''}`}>{posLabel(draft[l.order])}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {pickHolder && subs[pickHolder.order] && (
              <button className="ghost mt8" style={{ width: '100%' }} onClick={() => { revert(pickHolder.order); setPickerPos(null); }}>
                {t('dc.revertSub', { name: nameOf(pickHolder.playerId) })}
              </button>
            )}
          </Sheet>
        )}
      </div>
    </FullscreenView>
  );
}

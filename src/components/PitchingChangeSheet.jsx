import React, { useState } from 'react';
import { useStore, useT, usePlayerName } from '../state/store.jsx';
import { positionLabel, attendeesOf } from '../lib/model.js';
import { isArchived } from '../lib/year.js';
import Sheet from './Sheet.jsx';

// 自チームの投手交代。DHなしの試合では、投手は打順の中にいるので、
// 投手だけ代えると「打順の『投』の枠は前の投手のまま」になって打順と守備がずれていた。
// 新しい投手が打順のどこに入るか・前の投手がどうなるかを、ここで一緒に決める(LINEUP_CHANGES で1回に)。
//   控えの投手が登板 … 前の投手の打順に入る(既定) / 前の投手は別の守備位置へ回り、そこの野手が退く
//   打順の野手が登板 … 前の投手がその野手の守備位置へ / 前の投手は退き、控えがその守備位置へ
// DH制の試合(投手が打順の外)は、投手だけを代える(これまでどおり)
const FIELD = ['捕', '一', '二', '三', '遊', '左', '中', '右'];

export default function PitchingChangeSheet({ game, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const [pick, setPick] = useState(null); // { id, from: 'bench' | 'lineup' }
  const [plan, setPlan] = useState(0); // 選んだ形(下の options の番号)
  const [benchFor, setBenchFor] = useState(''); // 前の投手と代わって入る控え

  const cur = game.currentPitcherId;
  const lineup = game.lineup || [];
  const dh = lineup.some((l) => l.position === 'DH');
  const pSlot = !dh ? lineup.find((l) => l.position === '投') : null;
  const inLineup = new Set(lineup.map((l) => l.playerId));
  const players = state.players.filter((p) => !isArchived(p));
  const here = new Set(attendeesOf(game, players).map((p) => p.id));
  const usable = (p) => p.id !== cur && !inLineup.has(p.id) && (game.allowReentry || !game.retiredPlayerIds.includes(p.id));
  const bench = players.filter((p) => usable(p)).sort((a, b) => (here.has(b.id) ? 1 : 0) - (here.has(a.id) ? 1 : 0));
  const fielders = pSlot ? lineup.filter((l) => l !== pSlot && FIELD.includes(l.position)) : [];
  const pitches = (id) => (game.pitchingRecords || []).find((r) => r.playerId === id)?.pitches || 0;
  const pos = (p) => positionLabel(p, lang);

  const subLabel = (inId, order, outId) => t('order.sub.log', { kind: t('order.sub.def'), inName: nameOf(inId), order, outName: nameOf(outId) });
  const pitcherLabel = (id) => (cur ? t('pt.relievedLog', { name: nameOf(id), prev: nameOf(cur) }) : t('pt.starterLog', { name: nameOf(id) }));

  // 選んだ人ごとに、ありうる形を並べる。それぞれ { text, run() }
  const options = [];
  if (pick && pSlot && cur) {
    if (pick.from === 'bench') {
      options.push({
        text: t('pc.benchReplace', { name: nameOf(pick.id), order: pSlot.order, prev: nameOf(cur) }),
        action: { subs: [{ order: pSlot.order, playerId: pick.id, kind: 'def', label: subLabel(pick.id, pSlot.order, cur) }], positions: {} },
      });
      for (const f of fielders) {
        options.push({
          text: t('pc.benchMove', { prev: nameOf(cur), pos: pos(f.position), out: nameOf(f.playerId), name: nameOf(pick.id), order: f.order }),
          action: {
            subs: [{ order: f.order, playerId: pick.id, kind: 'def', label: subLabel(pick.id, f.order, f.playerId) }],
            positions: { [f.order]: '投', [pSlot.order]: f.position },
          },
        });
      }
    } else {
      const f = lineup.find((l) => l.playerId === pick.id);
      options.push({
        text: t('pc.fielderSwap', { name: nameOf(pick.id), prev: nameOf(cur), pos: pos(f.position) }),
        action: { subs: [], positions: { [f.order]: '投', [pSlot.order]: f.position } },
      });
      options.push({
        text: t('pc.fielderBench', { name: nameOf(pick.id), prev: nameOf(cur), pos: pos(f.position) }),
        needsBench: true,
        action: (b) => ({
          subs: [{ order: pSlot.order, playerId: b, kind: 'def', label: subLabel(b, pSlot.order, cur) }],
          positions: { [f.order]: '投', [pSlot.order]: f.position },
        }),
      });
    }
  }
  const chosen = options[plan] || null;
  const simple = pick && (!pSlot || !cur); // DH制・打順外の投手・先発を決めるとき
  const ready = simple || (chosen && (!chosen.needsBench || benchFor));

  const go = () => {
    if (simple) {
      dispatch({ type: 'SET_PITCHER', gameId: game.id, playerId: pick.id, label: pitcherLabel(pick.id) });
    } else {
      const a = chosen.needsBench ? chosen.action(benchFor) : chosen.action;
      dispatch({ type: 'LINEUP_CHANGES', gameId: game.id, ...a, pitcherLabel: pitcherLabel(pick.id) });
    }
    onClose();
  };

  const choose = (id, from) => { setPick({ id, from }); setPlan(0); setBenchFor(''); };

  return (
    <Sheet title={t('pc.title')} onClose={onClose}>
      {cur && <p className="small" style={{ marginTop: 0 }}>{t('pc.now', { name: nameOf(cur), n: pitches(cur) })}</p>}
      {dh && <p className="small dim" style={{ marginTop: 0 }}>{t('pc.dhNote')}</p>}

      <div className="section-title">{t('pc.fromBench')}</div>
      {bench.length === 0 && <p className="small dim">{t('pc.noBench')}</p>}
      <div className="lc-chips">
        {bench.map((p) => (
          <button key={p.id} className={pick?.id === p.id ? 'primary' : ''} onClick={() => choose(p.id, 'bench')}>
            {p.name}{!here.has(p.id) ? <span className="small dim"> *</span> : null}
          </button>
        ))}
      </div>
      {cur && fielders.length > 0 && (
        <>
          <div className="section-title">{t('pc.fromLineup')}</div>
          <div className="lc-chips">
            {fielders.map((f) => (
              <button key={f.order} className={pick?.id === f.playerId ? 'primary' : ''} onClick={() => choose(f.playerId, 'lineup')}>
                {nameOf(f.playerId)}<span className="small dim"> {pos(f.position)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {!cur && !dh && lineup.length > 0 && (
        <>
          <div className="section-title">{t('pc.fromLineup')}</div>
          <div className="lc-chips">
            {lineup.map((l) => (
              <button key={l.order} className={pick?.id === l.playerId ? 'primary' : ''} onClick={() => choose(l.playerId, 'lineup')}>{nameOf(l.playerId)}</button>
            ))}
          </div>
        </>
      )}

      {options.length > 0 && (
        <>
          <div className="section-title">{t('pc.how')}</div>
          <div className="pc-options">
            {options.map((o, i) => (
              <button key={i} className={`pc-opt${plan === i ? ' on' : ''}`} onClick={() => { setPlan(i); setBenchFor(''); }}>
                <span className="pc-radio">{plan === i ? '●' : '○'}</span>{o.text}
              </button>
            ))}
          </div>
          {chosen?.needsBench && (
            <div className="lc-chips mt8">
              {bench.filter((p) => p.id !== pick.id).map((p) => (
                <button key={p.id} className={benchFor === p.id ? 'primary' : ''} onClick={() => setBenchFor(p.id)}>{p.name}</button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" disabled={!ready} onClick={go}>{pick ? t('pc.go', { name: nameOf(pick.id) }) : t('pc.pick')}</button>
      </div>
    </Sheet>
  );
}

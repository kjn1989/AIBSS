import React, { useEffect, useState } from 'react';
import { useStore, useT, usePlayerName, isMyTeamBatting } from '../state/store.jsx';
import { POSITIONS, positionLabel, attendeesOf, uid, nextProvisionalNames } from '../lib/model.js';
import { isArchived } from '../lib/year.js';
import Sheet from './Sheet.jsx';

// 選手交代(オーダーの「選手交代」)。何人でも、守備位置の入れ替えも投手交代も、
// この1枚で決めて最後にまとめて確定する(LINEUP_CHANGES。取り消しも1回)。
//   ・交代する選手の行を押す → 控えの選手が並ぶ → 押せば入る
//   ・守備位置は選ぶと、その位置にいた選手と入れ替わる(重なりを作らない)
//   ・代打/代走/守備は場面から自動で決め、違えば押して直す
const UNIQUE = new Set(['投', '捕', '一', '二', '三', '遊', '左', '中', '右', 'DH']);
const KINDS = ['ph', 'pr', 'def'];

export default function LineupChangeSheet({ game, focusOrder = null, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const [subs, setSubs] = useState({}); // { [order]: { playerId, kind } }
  const [pos, setPos] = useState(() => Object.fromEntries(game.lineup.map((l) => [l.order, l.position])));
  const [pitcherId, setPitcherId] = useState(game.currentPitcherId || '');
  const [open, setOpen] = useState(focusOrder); // 控えを広げている行(打順 | 'P')
  const [newPeople, setNewPeople] = useState({}); // 名簿にない人 { 仮ID: 名前 }
  const [newName, setNewName] = useState('');

  // 名前を押して開いたときは、その打順が見えるところまで送る
  useEffect(() => {
    if (focusOrder == null) return;
    const el = document.querySelector('.sheet .lc-row.open');
    if (el) el.scrollIntoView({ block: 'center' });
  }, []);

  const nm = (id) => (id in newPeople ? (newPeople[id] || t('lc.newPerson')) : nameOf(id));
  const batting = isMyTeamBatting(game);
  const runnerIds = new Set([1, 2, 3].map((b) => game.runners[b]?.playerId).filter(Boolean));
  const defaultKind = (slot, i) => {
    if (!batting) return 'def';
    if (runnerIds.has(slot.playerId)) return 'pr';
    if (i === game.batterIndex) return 'ph';
    return 'def';
  };

  // 確定後の形
  const final = game.lineup.map((l) => ({ ...l, playerId: subs[l.order]?.playerId || l.playerId, position: pos[l.order] }));
  const finalDH = final.find((l) => l.position === 'DH');
  const moundSlot = final.find((l) => l.position === '投');
  const hadDH = game.lineup.some((l) => l.position === 'DH');
  const showPitcherRow = !!finalDH;

  // 控えの候補: 確定後の打順・投手に居ない人。退いた選手はリエントリーありの試合だけ
  const players = state.players.filter((p) => !isArchived(p));
  const here = new Set(attendeesOf(game, players).map((p) => p.id));
  const taken = new Set([...final.map((l) => l.playerId), ...(showPitcherRow ? [pitcherId] : [])]);
  const leaving = new Set(game.lineup.filter((l) => subs[l.order]).map((l) => l.playerId));
  const usable = (p) => !taken.has(p.id) && !leaving.has(p.id) && (game.allowReentry || !game.retiredPlayerIds.includes(p.id));
  const bench = players.filter((p) => usable(p) && here.has(p.id));
  const others = players.filter((p) => usable(p) && !here.has(p.id));

  const pick = (key, playerId) => {
    if (key === 'P') setPitcherId(playerId);
    else {
      const i = game.lineup.findIndex((l) => l.order === key);
      const slot = game.lineup[i];
      setSubs((prev) => {
        const m = { ...prev };
        if (playerId === slot.playerId) delete m[key];
        else m[key] = { playerId, kind: prev[key]?.kind || defaultKind(slot, i) };
        return m;
      });
    }
    setOpen(null);
    setNewName('');
  };
  const addNew = (key) => {
    const id = uid();
    setNewPeople((prev) => ({ ...prev, [id]: newName.trim() }));
    pick(key, id);
  };
  const setOnePos = (order, to) => setPos((prev) => {
    const m = { ...prev };
    const from = m[order];
    if (UNIQUE.has(to)) {
      const other = Object.keys(m).find((o) => Number(o) !== order && m[o] === to);
      if (other) m[other] = from;
    }
    m[order] = to;
    return m;
  });

  // 確かめる
  const dup = [...UNIQUE].filter((p) => final.filter((l) => l.position === p).length > 1);
  const dhAndP = !!(finalDH && moundSlot);
  const nextPitcher = finalDH ? pitcherId : (moundSlot?.playerId || game.currentPitcherId);
  const pitcherClash = !!(finalDH && pitcherId && final.some((l) => l.playerId === pitcherId && l !== finalDH));

  // 変更の一覧(確定前に見せる)
  const lines = [];
  for (const l of game.lineup) {
    const x = subs[l.order];
    if (x) lines.push(t('lc.subLine', { order: l.order, out: nameOf(l.playerId), in: nm(x.playerId), kind: t(`order.sub.${x.kind}`) }));
  }
  for (const l of game.lineup) {
    if (!subs[l.order] && pos[l.order] !== l.position) {
      lines.push(t('lc.posLine', { name: nameOf(l.playerId), from: positionLabel(l.position, lang), to: positionLabel(pos[l.order], lang) }));
    }
  }
  if (nextPitcher && nextPitcher !== game.currentPitcherId) {
    lines.push(t('lc.pitcherLine', { prev: game.currentPitcherId ? nameOf(game.currentPitcherId) : '—', name: nm(nextPitcher) }));
  }
  if (hadDH && !finalDH) lines.push(t('lc.dhEnds'));
  const changes = Object.keys(subs).length + game.lineup.filter((l) => !subs[l.order] && pos[l.order] !== l.position).length
    + (nextPitcher && nextPitcher !== game.currentPitcherId ? 1 : 0);
  const invalid = dup.length > 0 || dhAndP || pitcherClash;

  const confirm = () => {
    // 名簿にない人は、使ったぶんだけここで登録する(名前が空なら仮の名前)
    const used = new Set([...Object.values(subs).map((x) => x.playerId), nextPitcher]);
    let provisional = nextProvisionalNames(state.players, Object.keys(newPeople).length, lang);
    const names = {};
    for (const [id, name] of Object.entries(newPeople)) {
      if (!used.has(id)) continue;
      names[id] = name || provisional.shift();
      dispatch({ type: 'ADD_PLAYER', id, name, provisional: true });
    }
    const label = (id) => names[id] || nameOf(id);
    const changedPos = Object.fromEntries(game.lineup.filter((l) => pos[l.order] !== l.position).map((l) => [l.order, pos[l.order]]));
    dispatch({
      type: 'LINEUP_CHANGES',
      gameId: game.id,
      subs: game.lineup.filter((l) => subs[l.order]).map((l) => {
        const x = subs[l.order];
        return {
          order: l.order, playerId: x.playerId, kind: x.kind,
          label: t('order.sub.log', { kind: t(`order.sub.${x.kind}`), inName: label(x.playerId), order: l.order, outName: nameOf(l.playerId) }),
        };
      }),
      positions: changedPos,
      pitcherId: finalDH ? pitcherId : undefined,
      pitcherLabel: game.currentPitcherId
        ? t('pt.relievedLog', { name: label(nextPitcher), prev: nameOf(game.currentPitcherId) })
        : t('pt.starterLog', { name: label(nextPitcher) }),
    });
    onClose();
  };

  const benchPanel = (key, current) => (
    <div className="lc-bench">
      {bench.length === 0 && others.length === 0 && <p className="small dim" style={{ margin: 0 }}>{t('lc.noBench')}</p>}
      {bench.length > 0 && (
        <div className="lc-chips">
          {bench.map((p) => (
            <button key={p.id} onClick={() => pick(key, p.id)}>
              {p.name}{game.retiredPlayerIds.includes(p.id) && <span className="small dim"> {t('lc.reentry')}</span>}
            </button>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <>
          <div className="small dim lc-sub">{t('lc.others')}</div>
          <div className="lc-chips dimmer">
            {others.map((p) => <button key={p.id} onClick={() => pick(key, p.id)}>{p.name}</button>)}
          </div>
        </>
      )}
      <div className="lc-new">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('lc.newNamePh')} maxLength={20} />
        <button className="small" onClick={() => addNew(key)}>{t('lc.newAdd')}</button>
      </div>
      {current && <button className="small ghost" style={{ width: '100%' }} onClick={() => pick(key, current)}>{t('lc.revert')}</button>}
    </div>
  );

  return (
    <Sheet title={t('lc.title')} onClose={onClose}>
      <p className="small dim" style={{ marginTop: 0 }}>{t('lc.hint')}</p>
      <div className="lc-list">
        {game.lineup.map((l) => {
          const x = subs[l.order];
          const moved = pos[l.order] !== l.position;
          return (
            <React.Fragment key={l.order}>
              <div className={`lc-row${x ? ' changed' : moved ? ' moved' : ''}${open === l.order ? ' open' : ''}`}>
                <span className="rank-badge">{l.order}</span>
                <button className="lc-name" onClick={() => { setOpen(open === l.order ? null : l.order); setNewName(''); }}>
                  {x ? (<><s className="dim">{nameOf(l.playerId)}</s> → <b>{nm(x.playerId)}</b></>) : <b>{nameOf(l.playerId)}</b>}
                  {!x && <span className="lc-tap">{t('lc.tapToSub')}</span>}
                </button>
                <select
                  className={`small${dup.includes(pos[l.order]) ? ' bad' : ''}`}
                  value={pos[l.order]}
                  onChange={(e) => setOnePos(l.order, e.target.value)}
                  aria-label={t('order.sub.position')}
                >
                  {POSITIONS.map((p) => <option key={p} value={p}>{positionLabel(p, lang)}</option>)}
                </select>
              </div>
              {x && (
                <div className="lc-kinds">
                  {KINDS.map((k) => (
                    <button key={k} className={x.kind === k ? 'on' : ''} onClick={() => setSubs((prev) => ({ ...prev, [l.order]: { ...prev[l.order], kind: k } }))}>
                      {t(`order.sub.${k}`)}
                    </button>
                  ))}
                </div>
              )}
              {open === l.order && benchPanel(l.order, x ? l.playerId : null)}
            </React.Fragment>
          );
        })}
        {showPitcherRow && (
          <>
            <div className={`lc-row${pitcherId !== (game.currentPitcherId || '') ? ' changed' : ''}${open === 'P' ? ' open' : ''}`}>
              <span className="rank-badge">{t('paste.pitcherBadge')}</span>
              <button className="lc-name" onClick={() => { setOpen(open === 'P' ? null : 'P'); setNewName(''); }}>
                {pitcherId !== (game.currentPitcherId || '') && game.currentPitcherId
                  ? (<><s className="dim">{nameOf(game.currentPitcherId)}</s> → <b>{nm(pitcherId)}</b></>)
                  : <b>{pitcherId ? nm(pitcherId) : '—'}</b>}
                <span className="small dim"> {t('lc.pitcherRow')}</span>
              </button>
            </div>
            {open === 'P' && benchPanel('P', pitcherId !== (game.currentPitcherId || '') ? game.currentPitcherId : null)}
          </>
        )}
      </div>

      {dup.length > 0 && <div className="warn-box mt8">{t('lc.dupPos', { list: dup.map((p) => positionLabel(p, lang)).join('・') })}</div>}
      {dhAndP && <div className="warn-box mt8">{t('lc.dhAndP')}</div>}
      {pitcherClash && <div className="warn-box mt8">{t('lc.pitcherClash')}</div>}
      {lines.length > 0 && (
        <div className="lc-summary">
          {lines.map((s, i) => <div key={i} className="small">・{s}</div>)}
        </div>
      )}
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" disabled={!changes || invalid} onClick={confirm}>
          {changes ? t('lc.confirm', { n: changes }) : t('lc.noChange')}
        </button>
      </div>
    </Sheet>
  );
}

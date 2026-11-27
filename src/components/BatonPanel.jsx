import { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { lockedFor, holdsBaton, recorderName, saveRecorderName, unsentLogs, knownRecorders } from '../lib/baton.js';
import Sheet from './Sheet.jsx';
import { LiveLinkSheet, ScorerInviteSheet } from './LiveLinkPanel.jsx';

// 記録のバトン(lib/baton.js)の画面側。
// 進行中の試合を記録できるのは1台だけ。ほかの端末には「いま誰が記録中か」と
// 交代のボタンを出す。

const cloudOn = (state) => !!state.cloudStatus && state.cloudStatus !== 'off';

// 別の端末が記録中のとき。compact は入力画面以外(オーダー等)に置く短い版
export function BatonLocked({ game, compact = false }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(recorderName());
  if (!lockedFor(game)) return null;
  const who = game.recorder?.name || t('baton.otherDevice');
  // つながっていない間に引き継ぐと、相手の最新の記録を見ないまま上書きする。
  // クラウドを使っているチームでは、つながっているときだけ引き継げる
  const offline = cloudOn(state) && state.cloudStatus !== 'on';
  const take = () => {
    saveRecorderName(name);
    dispatch({ type: 'TAKE_BATON', gameId: game.id, name });
    setOpen(false);
  };
  return (
    <div className="baton-box locked">
      <b>{t('baton.lockedTitle', { name: who })}</b>
      <p className="small">{t(compact ? 'baton.lockedCompact' : 'baton.lockedBody')}</p>
      {!open && (
        <button className="primary" style={{ width: '100%' }} onClick={() => setOpen(true)} disabled={offline}>
          {t('baton.take')}
        </button>
      )}
      {offline && <p className="small dim mt8">{t('baton.offline')}</p>}
      {open && (
        <div className="baton-take">
          <label className="small dim">{t('baton.yourName')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('baton.yourNamePh')} maxLength={20} />
          <p className="small dim mt8">{t('baton.takeNote', { name: who })}</p>
          <div className="grid2 mt8">
            <button onClick={() => setOpen(false)}>{t('action.cancel')}</button>
            <button className="primary" onClick={take}>{t('baton.takeConfirm')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 電波の無い間に付けた記録が、引き継いだ相手の記録で置き換わったとき
export function BatonConflict({ game }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const mine = (state.batonConflicts || {})[game?.id];
  if (!mine) return null;
  const n = unsentLogs(mine, game).length;
  const who = game.recorder?.name || t('baton.otherDevice');
  const keep = (which) => {
    if (!window.confirm(t(which === 'mine' ? 'baton.keepMineConfirm' : 'baton.keepTheirsConfirm', { name: who, n }))) return;
    dispatch({ type: 'RESOLVE_BATON_CONFLICT', gameId: game.id, keep: which, name: recorderName() });
  };
  return (
    <div className="baton-box conflict">
      <b>{t('baton.conflictTitle', { name: who })}</b>
      <p className="small">{t('baton.conflictBody', { n })}</p>
      <div className="grid2">
        <button onClick={() => keep('theirs')}>{t('baton.keepTheirs', { name: who })}</button>
        <button onClick={() => keep('mine')}>{t('baton.keepMine')}</button>
      </div>
    </div>
  );
}

// 攻守交代で自動的にバトンを渡す設定(任意・初期は無効)
function BatonPlanSheet({ game, onClose }) {
  const { dispatch } = useStore();
  const t = useT();
  const people = knownRecorders(game);
  const plan = game.batonPlan || { on: false };
  const [on, setOn] = useState(!!plan.on);
  const [mode, setMode] = useState(plan.mode === 'sides' ? 'sides' : 'rotate');
  const [off, setOff] = useState(plan.offense?.id || game.recorder?.id || '');
  const [def, setDef] = useState(plan.defense?.id || people.find((p) => p.id !== game.recorder?.id)?.id || '');
  // 順番に回すとき: 1人目は今の記録係。2人目・3人目は選ぶ(3人目は空でもよい)
  const initRot = (plan.rotation || []).map((r) => r.id);
  const [r1, setR1] = useState(initRot[0] || game.recorder?.id || '');
  const [r2, setR2] = useState(initRot[1] || people.find((p) => p.id !== (initRot[0] || game.recorder?.id))?.id || '');
  const [r3, setR3] = useState(initRot[2] || '');
  const [every, setEvery] = useState(String(plan.every || 1));
  const pick = (id) => people.find((p) => p.id === id) || null;
  const label = (p) => p.name || t('baton.otherDevice');
  const rotation = [r1, r2, r3].filter(Boolean).filter((id, i, a) => a.indexOf(id) === i).map(pick).filter(Boolean);
  const valid = !on || (mode === 'sides' ? !!off && !!def : rotation.length >= 2);
  const save = () => {
    dispatch({
      type: 'SET_BATON_PLAN', gameId: game.id,
      plan: !on ? { on: false }
        : mode === 'sides' ? { on: true, mode: 'sides', offense: pick(off), defense: pick(def) }
          : { on: true, mode: 'rotate', rotation, every: Number(every) },
    });
    onClose();
  };
  const select = (value, set, { optional = false } = {}) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      {optional && <option value="">{t('baton.planNone')}</option>}
      {people.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
    </select>
  );
  return (
    <Sheet title={t('baton.planTitle')} onClose={onClose}>
      <p className="small dim" style={{ marginTop: 0 }}>{t('baton.planNote')}</p>
      <div className="toggle-row">
        <button className={!on ? 'active' : ''} onClick={() => setOn(false)}>{t('baton.planOff')}</button>
        <button className={on ? 'active' : ''} onClick={() => setOn(true)} disabled={people.length < 2}>{t('baton.planOn')}</button>
      </div>
      {people.length < 2 && <p className="small dim">{t('baton.planNeedTwo')}</p>}
      {on && people.length >= 2 && (
        <>
          <label className="small dim mt8" style={{ display: 'block' }}>{t('baton.planMode')}</label>
          <div className="toggle-row">
            <button className={mode === 'rotate' ? 'active' : ''} onClick={() => setMode('rotate')}>{t('baton.planRotate')}</button>
            <button className={mode === 'sides' ? 'active' : ''} onClick={() => setMode('sides')}>{t('baton.planSides')}</button>
          </div>
          {mode === 'rotate' ? (
            <>
              <label className="small dim mt8" style={{ display: 'block' }}>{t('baton.planFirst')}</label>
              {select(r1, setR1)}
              <label className="small dim mt8" style={{ display: 'block' }}>{t('baton.planSecond')}</label>
              {select(r2, setR2)}
              <label className="small dim mt8" style={{ display: 'block' }}>{t('baton.planThird')}</label>
              {select(r3, setR3, { optional: true })}
              <label className="small dim mt8" style={{ display: 'block' }}>{t('baton.planEvery')}</label>
              <select value={every} onChange={(e) => setEvery(e.target.value)}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{t('baton.planEveryN', { n })}</option>)}
              </select>
              {rotation.length >= 2 && (
                <p className="small mt8">{t('baton.planPreview', { order: rotation.map(label).join(' → '), n: every })}</p>
              )}
              {rotation.length < 2 && <p className="small dim mt8">{t('baton.planNeedTwoPick')}</p>}
            </>
          ) : (
            <>
              <label className="small dim mt8" style={{ display: 'block' }}>{t('baton.planOffense')}</label>
              {select(off, setOff)}
              <label className="small dim mt8" style={{ display: 'block' }}>{t('baton.planDefense')}</label>
              {select(def, setDef)}
            </>
          )}
          <p className="small dim mt8">{t('baton.planWarn')}</p>
        </>
      )}
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={save} disabled={!valid}>{t('action.save')}</button>
      </div>
    </Sheet>
  );
}

// 自分が記録係のとき(クラウドでほかの端末とつながっているチームだけに出す)
export function BatonMine({ game }) {
  const { state } = useStore();
  const t = useT();
  const [liveOpen, setLiveOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  if (!cloudOn(state) || !holdsBaton(game) || game.status !== 'ongoing') return null;
  return (
    <div className="baton-mine small">
      <div>{t('baton.mine')}</div>
      {/* 観戦リンクと記録員リンクは横一列に並べて、入力画面の縦の場所を取らない */}
      {state.settings.officialTeamId && (
        <div className="baton-links">
          {/* ログイン不要のライブ観戦リンク。試合中に思いついたときすぐ配れるように、ここにも置く */}
          <button className="small" onClick={() => setLiveOpen(true)}>{t('livelink.btn')}</button>
          {/* 記録係の招待リンク。作れるのはオーナーだけなので、オーナーの端末にだけ出す */}
          {state.settings.officialRole === 'owner' && (
            <button className="small" onClick={() => setInviteOpen(true)}>{t('scorerlink.btn')}</button>
          )}
        </div>
      )}
      {liveOpen && <LiveLinkSheet teamId={state.settings.officialTeamId} onClose={() => setLiveOpen(false)} />}
      {inviteOpen && <ScorerInviteSheet teamId={state.settings.officialTeamId} onClose={() => setInviteOpen(false)} />}
      {/* 記録係を自動で回す設定は、設定の画面(BatonPlanCard)に置く。入力画面はボタンを減らす */}
    </div>
  );
}

// 設定の画面に置く「記録係を自動で回す」。進行中の試合で、この端末が記録係のときだけ出す
// (設定を変えられるのは記録している端末だけ)
export function BatonPlanCard() {
  const { state } = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const game = state.currentGameId ? state.games[state.currentGameId] : null;
  if (!game || !cloudOn(state) || !holdsBaton(game) || game.status !== 'ongoing') return null;
  return (
    <div className="card">
      <h2>{t('baton.planCardTitle')}</h2>
      <p className="small dim" style={{ marginTop: 0 }}>{t('baton.planCardDesc', { opp: game.opponent || '—' })}</p>
      <button style={{ width: '100%' }} onClick={() => setOpen(true)}>
        {t(game.batonPlan?.on ? 'baton.planBtnOn' : 'baton.planBtn')}
      </button>
      {open && <BatonPlanSheet game={game} onClose={() => setOpen(false)} />}
    </div>
  );
}

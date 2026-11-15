import { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { lockedFor, holdsBaton, recorderName, saveRecorderName, unsentLogs } from '../lib/baton.js';

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

// 自分が記録係のとき(クラウドでほかの端末とつながっているチームだけに出す)
export function BatonMine({ game }) {
  const { state } = useStore();
  const t = useT();
  if (!cloudOn(state) || !holdsBaton(game) || game.status !== 'ongoing') return null;
  return <div className="baton-mine small">{t('baton.mine')}</div>;
}

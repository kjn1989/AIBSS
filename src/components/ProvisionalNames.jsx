import { useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { isProvisional } from '../lib/model.js';
import { isArchived } from '../lib/year.js';
import Sheet from './Sheet.jsx';

// 仮の選手(名前がまだ)に名前を入れる。
// 登録なしで始めた試合や、交代で名簿に居ない人を入れたあとの後始末を、
// 試合中でも試合後でも同じ形でできるようにする。

// 1人ぶんの入力。名簿にすでに居る人だった場合は、その人に記録をまとめる
export function NamePlayerSheet({ player, game = null, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const [name, setName] = useState(isProvisional(player) ? '' : player.name);
  const [number, setNumber] = useState(player.number || '');
  const [existing, setExisting] = useState('');
  // まとめ先の候補: 名前のある現役の選手。いまの試合に出ている人は除く
  // (同じ人が打順に2回入ることになる)
  const inGame = new Set([...(game?.lineup || []).map((l) => l.playerId), ...(game?.usedPlayerIds || [])]);
  const registered = state.players.filter((p) => p.id !== player.id && !isProvisional(p) && !isArchived(p)
    && !p.id.startsWith('demo-') && !inGame.has(p.id));
  const save = () => {
    if (existing) {
      dispatch({ type: 'MERGE_PLAYERS', keepId: existing, mergeId: player.id });
    } else {
      dispatch({ type: 'UPDATE_PLAYER', id: player.id, patch: { name: name.trim(), number: number.trim(), provisional: false } });
    }
    onClose();
  };
  return (
    <Sheet title={t('prov.sheetTitle', { name: player.name })} onClose={onClose}>
      <label className="small dim">{t('prov.name')}</label>
      <input value={name} onChange={(e) => { setName(e.target.value); setExisting(''); }} placeholder={t('set.playerName')} autoFocus />
      <label className="small dim mt8" style={{ display: 'block' }}>{t('prov.number')}</label>
      <input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" style={{ maxWidth: 120 }} />
      {registered.length > 0 && (
        <>
          <div className="section-title">{t('prov.orExisting')}</div>
          <select value={existing} onChange={(e) => setExisting(e.target.value)}>
            <option value="">{t('prov.pickExisting')}</option>
            {registered.map((p) => <option key={p.id} value={p.id}>{p.name}{p.number ? ` #${p.number}` : ''}</option>)}
          </select>
        </>
      )}
      <p className="small dim mt8">{t('prov.sheetNote')}</p>
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" disabled={!existing && !name.trim()} onClick={save}>{t('prov.save')}</button>
      </div>
    </Sheet>
  );
}

// 名前を入れるボタン(仮の選手のときだけ出る)
export function NameButton({ playerId, game = null, className = 'small' }) {
  const { state } = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !isProvisional(player)) return null;
  return (
    <>
      {/* 行そのものが押せる場所(オーダーの行は交代を開く)に置かれるので、押したことを親へ伝えない。
          シートは portal で body に出るが、React のイベントは親へ伝わるので、シート側も止める */}
      <button className={`name-btn ${className}`} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{t('prov.enter')}</button>
      {open && (
        <span onClick={(e) => e.stopPropagation()}>
          <NamePlayerSheet player={player} game={game} onClose={() => setOpen(false)} />
        </span>
      )}
    </>
  );
}

// 名前がまだの選手の一覧。入れ忘れが残らないよう、ホームと試合結果に出す
export default function ProvisionalNames({ game = null }) {
  const { state } = useStore();
  const t = useT();
  const [editing, setEditing] = useState(null);
  const list = state.players.filter((p) => isProvisional(p) && !isArchived(p));
  if (!list.length) return null;
  const orderOf = (id) => (game?.lineup || []).find((l) => l.playerId === id)?.order;
  return (
    <div className="card prov-card">
      <h2>{t('prov.title', { n: list.length })}</h2>
      <p className="small dim" style={{ marginTop: 0 }}>{t('prov.note')}</p>
      {list.map((p) => (
        <div className="row" key={p.id}>
          <div className="grow">
            <b>{p.name}</b>
            {orderOf(p.id) && <span className="small dim" style={{ marginLeft: 8 }}>{t('prov.order', { n: orderOf(p.id) })}</span>}
          </div>
          <button className="small primary" onClick={() => setEditing(p)}>{t('prov.enter')}</button>
        </div>
      ))}
      {editing && <NamePlayerSheet player={editing} game={game} onClose={() => setEditing(null)} />}
    </div>
  );
}

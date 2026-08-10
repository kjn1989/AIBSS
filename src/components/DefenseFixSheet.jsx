import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { FIELD_POSITIONS } from '../lib/model.js';
import { inGamePlayerIds } from '../lib/correctionParser.js';
import Sheet from './Sheet.jsx';

// ---- 守備・交代を直す ----
// 守備まわりの修正は、アプリの中では別々の3操作になっている。
//   先発の登録ミス   → FIX_STARTING_POSITION(回を伴わない)
//   途中からの位置変更 → RETRO_POSITION(回を伴う。交代ではない)
//   選手交代          → RETRO_SUBSTITUTE(回を伴う)
// これを1つのフォームに混ぜると、何が起きるか押すまで決まらない。
// 「回を入れたのに先発が変わった」「位置だけ直したいのに交代が作られた」が起きる。
// だから何を直したいのかを先に選ばせて、必要な項目だけ出し、保存前に結果を言い切る。

const KINDS = ['start', 'from', 'sub'];
const SUB_KINDS = ['def', 'ph', 'pr'];

export default function DefenseFixSheet({ game, playerId, order, currentPos, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const [kind, setKind] = useState(null);
  const [pos, setPos] = useState(currentPos || '');
  const [inning, setInning] = useState(Math.max(1, Number(game.inning) || 1));
  const [inId, setInId] = useState('');
  const [subKind, setSubKind] = useState('def');

  const lastInning = Math.max(
    Number(game.inning) || 1,
    ...(game.playLogs || []).map((l) => Number(l.inning) || 0),
  );
  const innings = Array.from({ length: Math.max(lastInning, 1) }, (_, i) => i + 1);

  // 交代で入る人は、まだ試合に出ていないのが普通。未出場を先に出す
  const inGame = inGamePlayerIds(game);
  const bench = state.players.filter((p) => !p.archived && !inGame.has(p.id));
  const playing = state.players.filter((p) => !p.archived && inGame.has(p.id) && p.id !== playerId);

  const preview = () => {
    if (!kind) return '';
    if (!pos) return t('df.pickPos');
    if (kind === 'start') return t('df.pvStart', { name: nameOf(playerId), from: currentPos || '—', to: pos });
    if (kind === 'from') return t('df.pvFrom', { inning, name: nameOf(playerId), to: pos });
    if (!inId) return t('df.pickIn');
    return t('df.pvSub', { inning, inName: nameOf(inId), outName: nameOf(playerId), to: pos, kind: t(`df.sub_${subKind}`) });
  };

  const save = () => {
    if (!kind || !pos) return;
    if (kind === 'start') {
      dispatch({ type: 'FIX_STARTING_POSITION', gameId: game.id, playerId, position: pos });
    } else if (kind === 'from') {
      dispatch({ type: 'RETRO_POSITION', gameId: game.id, order, playerId, position: pos, inning });
    } else {
      if (!inId) return;
      dispatch({
        type: 'RETRO_SUBSTITUTE', gameId: game.id, order, outId: playerId, inId,
        position: pos, subKind, inning,
        label: t('df.subLog', { inName: nameOf(inId), order, outName: nameOf(playerId) }),
      });
      // 投手が代わると投球回の割り振りが変わる
      if (pos === '投') dispatch({ type: 'RECOMPUTE_PITCHING', gameId: game.id });
    }
    onClose();
  };

  return (
    <Sheet title={t('df.title')} onClose={onClose}>
      <p className="small dim" style={{ margin: '0 0 12px' }}>
        {order ? `${order}${t('gp.nlOrderSuffix')} ` : ''}{nameOf(playerId)}
        {currentPos ? `（${currentPos}）` : ''}
      </p>

      <div className="section-title" style={{ marginTop: 0 }}>{t('df.whatToFix')}</div>
      <div className="df-cards">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`df-card${kind === k ? ' on' : ''}`}
            onClick={() => setKind(k)}
          >
            <b>{t(`df.k_${k}`)}</b>
            <span>{t(`df.d_${k}`)}</span>
          </button>
        ))}
      </div>

      {kind && (
        <>
          {kind !== 'start' && (
            <>
              <div className="section-title">{t('df.fromInning')}</div>
              <div className="chips-row">
                {innings.map((n) => (
                  <button key={n} className={`small ${inning === n ? 'primary' : ''}`} onClick={() => setInning(n)}>
                    {t('gp.nlInningOne', { n })}
                  </button>
                ))}
              </div>
            </>
          )}

          {kind === 'sub' && (
            <>
              <div className="section-title">{t('df.whoIn')}</div>
              <select className="small" style={{ width: '100%' }} value={inId} onChange={(e) => setInId(e.target.value)}>
                <option value="">{t('df.pickIn')}</option>
                {bench.length > 0 && (
                  <optgroup label={t('df.grpBench')}>
                    {bench.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                )}
                {playing.length > 0 && (
                  <optgroup label={t('df.grpPlaying')}>
                    {playing.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                )}
              </select>
              <div className="section-title">{t('df.subKind')}</div>
              <div className="chips-row">
                {SUB_KINDS.map((k) => (
                  <button key={k} className={`small ${subKind === k ? 'primary' : ''}`} onClick={() => setSubKind(k)}>
                    {t(`df.sub_${k}`)}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="section-title">{t(`df.posLbl_${kind}`)}</div>
          <div className="chips-row">
            {FIELD_POSITIONS.map((p) => (
              <button key={p} className={`small ${pos === p ? 'primary' : ''}`} onClick={() => setPos(p)}>{p}</button>
            ))}
          </div>

          <div className="df-preview">{preview()}</div>
          <div className="keep-box">{t(`df.keep_${kind}`)}</div>

          <div className="sheet-actions">
            <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
            <button className="primary" onClick={save}>{t('action.save')}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

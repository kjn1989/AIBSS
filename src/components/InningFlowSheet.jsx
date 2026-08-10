import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { oppNameOf } from '../lib/oppBox.js';
import { isPlateAppearance, timingAnchor } from '../lib/logOrder.js';
import Sheet from './Sheet.jsx';

// ---- 回の流れ ----
// 交代は打席と打席の「間」に起きるので、打順×イニングのマス目では表せない。
// スコアシートのマスだけを直せるようにしても、「5回の何番の後で代わったか」は
// 永久に直せないまま残る。ログの並び順そのものがその情報なので、
// この画面では起きた順に並べ、交代の行を上下に動かせるようにする。
//
// 打席の行は動かせない。打順は野球のルールで決まっていて人が並べ替えるもの
// ではなく、動かせるようにすると打順の並びを壊す操作をこちらから用意することになる。
// 順番がおかしいときは、打った選手を選び直すか、余分な打席を削除して直す。

const ICON = {
  atbat: '⚾', defense: '⚾', sub: '⇄', oppsub: '⇄',
  pitcher: '⇄', opppitcher: '⇄', sb: '走', run: '◆',
  runner: '走', change: '—', note: '📝',
};
const isPa = isPlateAppearance;

export default function InningFlowSheet({ game, inning, onClose, onEditLog }) {
  const { dispatch } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  // 自軍が攻める半回。後攻なら裏に打つ
  const offTop = !game.isHome;
  const [half, setHalf] = useState(offTop); // true=表を見る
  const [openId, setOpenId] = useState(null);

  const logs = (game.playLogs || []).filter(
    (l) => Number(l.inning) === Number(inning) && !!l.isTop === !!half && l.kind !== 'game',
  );

  const whoOf = (l) => {
    const p = l.payload || {};
    if (l.kind === 'defense') return `${p.order ? `${p.order}${t('gp.nlOrderSuffix')} ` : ''}${oppNameOf(game, p.letter)}`;
    if (l.kind === 'atbat') return `${p.order ? `${p.order}${t('gp.nlOrderSuffix')} ` : ''}${nameOf(p.playerId)}`;
    return l.text;
  };
  const resOf = (l) => {
    if (!isPa(l)) return '';
    // log.text は「名前 結果」の形。名前は左に出しているので結果側だけを取る
    const nm = l.kind === 'defense' ? oppNameOf(game, l.payload?.letter) : nameOf(l.payload?.playerId);
    return String(l.text || '').replace(nm, '').trim();
  };
  // 交代のタイミングは行の位置そのもの。動かしたら表示も追従させる
  // (固定の文言にすると、並べ替えた瞬間に嘘になる)
  const timingOf = (i) => {
    const a = timingAnchor(logs, i);
    return a ? t('flow.afterWho', { who: whoOf(a) }) : t('flow.atHead');
  };

  const move = (log, dir) => {
    dispatch({ type: 'MOVE_PLAY_LOG', gameId: game.id, logId: log.id, dir });
    setOpenId(null);
  };
  const remove = (log) => {
    if (!window.confirm(t('gp.deleteConfirm'))) return;
    dispatch({ type: 'DELETE_PLAY_LOG', gameId: game.id, logId: log.id });
    setOpenId(null);
  };

  return (
    <Sheet title={t('flow.title', { inning })} onClose={onClose}>
      <p className="small dim" style={{ margin: '0 0 10px' }}>{t('flow.lead')}</p>

      <div className="flow-half">
        <button className={half === offTop ? 'primary' : ''} onClick={() => setHalf(offTop)}>{t('flow.offense')}</button>
        <button className={half !== offTop ? 'primary' : ''} onClick={() => setHalf(!offTop)}>{t('flow.defense')}</button>
      </div>

      {logs.length === 0 && <p className="small dim mt12">{t('flow.empty')}</p>}

      <div className="flow-list">
        {logs.map((l, i) => (
          <React.Fragment key={l.id}>
            <button
              type="button"
              className={`flow-ev k-${l.kind}${openId === l.id ? ' open' : ''}`}
              onClick={() => setOpenId(openId === l.id ? null : l.id)}
            >
              <span className="fe-ic">{ICON[l.kind] || '・'}</span>
              <span className="fe-who">{whoOf(l)}</span>
              {resOf(l) && <span className="fe-res">{resOf(l)}</span>}
              {!isPa(l) && <span className="fe-tag">{timingOf(i)}</span>}
            </button>

            {openId === l.id && (
              <div className="flow-box">
                {isPa(l) ? (
                  <>
                    <div className="grid2">
                      <button className="small" onClick={() => { onEditLog(l); setOpenId(null); }}>{t('flow.editPa')}</button>
                      <button className="small danger" onClick={() => remove(l)}>{t('action.delete')}</button>
                    </div>
                    <p className="small dim mt8" style={{ marginBottom: 0 }}>{t('flow.paFixed')}</p>
                  </>
                ) : (
                  <div className="grid3">
                    <button className="small" disabled={i === 0} onClick={() => move(l, -1)}>{t('flow.up')}</button>
                    <button className="small" disabled={i === logs.length - 1} onClick={() => move(l, 1)}>{t('flow.down')}</button>
                    <button className="small danger" onClick={() => remove(l)}>{t('action.delete')}</button>
                  </div>
                )}
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

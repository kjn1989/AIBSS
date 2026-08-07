import React, { useState } from 'react';
import Sheet from './Sheet.jsx';
import { useStore, useT } from '../state/store.jsx';
import { lastAttendees } from '../lib/model.js';
import { isArchived } from '../lib/year.js';

// ============================================================
// 今日のメンバー
//
// 登録選手が全員その試合に来るわけではない。来ていない選手を含めたまま
// 打順を組むと、居ない人が自動セットされ、AIスタメン提案にも出てくる。
//
// 既定は「前回来ていた人」。チームの顔ぶれは週ごとに大きく変わらないので、
// 毎回まっさらから選ぶより、前回からの差分だけ直すほうが手数が少ない。
// 初回だけは前回が無いので全員から始める。
// ============================================================
export default function AttendanceSheet({ initial, onDone, onClose, confirmKey = 'att.start' }) {
  const { state } = useStore();
  const t = useT();
  const players = state.players.filter((p) => !isArchived(p));
  const prev = lastAttendees(Object.values(state.games));

  const [ids, setIds] = useState(() => {
    if (Array.isArray(initial) && initial.length) return new Set(initial);
    if (prev && prev.length) {
      // 前回の参加者のうち、いまも名簿に居る人だけ(退部・卒業した人は外す)
      const alive = new Set(players.map((p) => p.id));
      const kept = prev.filter((id) => alive.has(id));
      if (kept.length) return new Set(kept);
    }
    return new Set(players.map((p) => p.id));
  });

  const toggle = (id) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setIds(next);
  };
  const n = players.filter((p) => ids.has(p.id)).length;
  // 前回から何人変えたか。差分で見せると「前回と同じでよいか」の判断が速い
  const prevSet = prev ? new Set(prev) : null;
  const changed = prevSet
    ? players.filter((p) => ids.has(p.id) !== prevSet.has(p.id)).length
    : 0;

  return (
    <Sheet title={t('att.title')} onClose={onClose}>
      <div className="att-count">
        <b>{n}</b>
        <span>
          {t('att.people')}
          {prev && prev.length > 0 && (
            <i>{changed === 0 ? t('att.samePrev') : t('att.diffPrev', { n: changed })}</i>
          )}
        </span>
        <button className="small ghost" onClick={() => setIds(new Set(players.map((p) => p.id)))}>
          {t('att.all')}
        </button>
      </div>

      <div className="att-list">
        {players.map((p) => {
          const on = ids.has(p.id);
          return (
            <div
              key={p.id}
              className={`att-row${on ? ' on' : ''}`}
              role="checkbox"
              aria-checked={on}
              tabIndex={0}
              onClick={() => toggle(p.id)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(p.id); }
              }}
            >
              <span className="att-box">✓</span>
              <span className="att-name">{p.name}</span>
              {p.number ? <span className="att-num">#{p.number}</span> : null}
              <span className="att-pos">{p.position || '—'}</span>
            </div>
          );
        })}
        {players.length === 0 && <div className="dim small">{t('att.noPlayers')}</div>}
      </div>

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={() => onDone([...ids])}>
          {t(confirmKey, { n })}
        </button>
      </div>
    </Sheet>
  );
}

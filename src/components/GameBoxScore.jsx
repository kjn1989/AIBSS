import React from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { aggregateBatting } from '../lib/stats.js';
import { buildLineupRows, roleTag, posFull } from '../lib/lineupBox.js';

// 出場選手のボックススコア(打順ツリー方式)。
// 引き算のデザイン: 先発はバッジ無しでシンプルに。交代で入った選手にだけ「回」と役割
// (代打/代走/守備/救援)のバッジを付け、L字コネクタで打順に紐づけて系譜を可視化する。
// 成績はカード内2段構造(上段=選手情報 / 下段右寄せ=成績)でスマホ幅でも崩れない。
export default function GameBoxScore({ game }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  const rows = buildLineupRows(game);
  if (!rows.length) return null;
  const bat = aggregateBatting([game]); // playerId -> このゲームの打撃成績

  const roleLabel = { ph: t('box.rolePh'), pr: t('box.rolePr'), def: t('box.roleDef'), relief: t('box.roleRelief') };
  const statLine = (pid) => {
    const s = bat[pid];
    if (!s || !s.pa) return null;
    const parts = [t('box.abN', { n: s.ab }), t('box.hN', { n: s.h })];
    if (s.rbi) parts.push(t('box.rbiN', { n: s.rbi }));
    if (s.hr) parts.push(t('box.hrN', { n: s.hr }));
    if (s.sb) parts.push(t('box.sbN', { n: s.sb }));
    return parts.join(' ');
  };

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('box.title')}</div>
      <p className="small dim" style={{ marginTop: 0 }}>{t('box.desc2')}</p>
      <div className="bx-tree">
        {rows.map((slot) => (
          <div className="bx-slot" key={slot.order}>
            <div className="bx-ord">{slot.order}</div>
            <div className="bx-players">
              {slot.players.map((p, i) => {
                const tag = roleTag(p);
                const sl = statLine(p.playerId);
                return (
                  <div className={`bx-card${i > 0 ? ' sub' : ''}`} key={`${p.playerId}-${i}`}>
                    <div className="bx-top">
                      {p.inning != null && <span className="bx-inn">{t('box.inningN', { n: p.inning })}</span>}
                      {tag && <span className={`bx-role ${tag}`}>{roleLabel[tag]}</span>}
                      {p.posCode && <span className="bx-pos">{posFull(p.posCode, lang)}</span>}
                      <span className="bx-name">{nameOf(p.playerId)}{numberOf(p.playerId) ? <span className="bx-num">#{numberOf(p.playerId)}</span> : ''}</span>
                    </div>
                    <div className="bx-bottom">{sl || t('box.noPa')}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

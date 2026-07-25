import React from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { aggregateBatting } from '../lib/stats.js';
import { buildLineupRows } from '../lib/lineupBox.js';

// 出場選手のボックススコア(登場順・伝統的な位置表記つき)。
// 交代/リエントリーで打者がズレても、選手ごとに1行ずつ並ぶので誰が打ったか一目でわかる。
export default function GameBoxScore({ game }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const numberOf = (id) => state.players.find((p) => p.id === id)?.number || '';
  const rows = buildLineupRows(game);
  if (!rows.length) return null;
  const bat = aggregateBatting([game]); // playerId -> このゲームの打撃成績
  const v = (pid, k) => bat[pid]?.[k] || 0;

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('box.title')}</div>
      <p className="small dim" style={{ marginTop: 0 }}>{t('box.desc')}</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="box-table">
          <thead>
            <tr>
              <th>{t('box.order')}</th><th>{t('box.pos')}</th><th className="left">{t('box.player')}</th>
              <th>{t('box.ab')}</th><th>{t('box.h')}</th><th>{t('box.rbi')}</th><th>{t('box.hr')}</th><th>{t('box.sb')}</th><th>{t('box.so')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((slot) => slot.players.map((pl, idx) => (
              <tr key={`${slot.order}-${pl.playerId}-${idx}`} className={idx > 0 ? 'sub-row' : ''}>
                <td className="ord">{idx === 0 ? slot.order : ''}</td>
                <td className="notation">{pl.notation}</td>
                <td className="left pname">{nameOf(pl.playerId)}{numberOf(pl.playerId) ? <span className="dim"> #{numberOf(pl.playerId)}</span> : ''}</td>
                <td className="num">{v(pl.playerId, 'ab')}</td>
                <td className="num">{v(pl.playerId, 'h')}</td>
                <td className="num">{v(pl.playerId, 'rbi')}</td>
                <td className="num">{v(pl.playerId, 'hr')}</td>
                <td className="num">{v(pl.playerId, 'sb')}</td>
                <td className="num">{v(pl.playerId, 'so')}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

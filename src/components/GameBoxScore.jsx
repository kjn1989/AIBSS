import React from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS } from '../lib/model.js';
import { buildLineupRows, roleTag, posFull, assignAtBatsByPlayer } from '../lib/lineupBox.js';

// 1登場ぶんの打席群(+盗塁数)から表示用の打撃ラインを作る。
// aggregateBatting と同じ判定基準(打数・安打・本塁打)を打席サブセットに適用する。
function lineFromBucket(atBats, sb) {
  let pa = 0; let ab = 0; let h = 0; let rbi = 0; let hr = 0;
  for (const a of atBats) {
    const def = RESULTS[a.result];
    if (!def) continue;
    pa += 1;
    if (def.ab) ab += 1;
    if (def.hit) h += 1;
    if (a.result === 'hr') hr += 1;
    rbi += a.rbi || 0;
  }
  return { pa, ab, h, rbi, hr, sb };
}

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
  const sbLogs = (game.playLogs || []).filter((l) => l.kind === 'sb');
  // 打撃成績は「1人=1行」に集約(打順を移った選手が複数カードに分散しないように)
  const assigned = assignAtBatsByPlayer(rows, (game.atBats || []).filter((ab) => ab.result), sbLogs);

  const roleLabel = { ph: t('box.rolePh'), pr: t('box.rolePr'), def: t('box.roleDef'), relief: t('box.roleRelief') };
  const statLine = (s) => {
    if (!s || (!s.pa && !s.sb)) return null;
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
                const bucket = assigned.get(p) || { atBats: [], sb: 0, primary: true, primaryOrder: slot.order };
                // 集約先でないカードは、成績の代わりに「◯番に記載」と案内する
                const sl = bucket.primary
                  ? statLine(lineFromBucket(bucket.atBats, bucket.sb))
                  : t('box.statsInOrder', { n: bucket.primaryOrder });
                return (
                  <div className={`bx-card${i > 0 ? ' sub' : ''}`} key={`${p.playerId}-${i}`}>
                    <div className="bx-top">
                      {p.inning != null && <span className="bx-inn">{t('box.inningN', { n: p.inning })}</span>}
                      {/* 打順を移ってきた選手は「◯番より」。途中出場ではなく出場を続けていることを示す */}
                      {p.fromOrder != null
                        ? <span className="bx-role move">{t('box.fromOrder', { n: p.fromOrder })}</span>
                        : tag && <span className={`bx-role ${tag}`}>{roleLabel[tag]}</span>}
                      {p.posCode && <span className="bx-pos">{posFull(p.posCode, lang)}</span>}
                      <span className="bx-name">{nameOf(p.playerId)}{numberOf(p.playerId) ? <span className="bx-num">#{numberOf(p.playerId)}</span> : ''}</span>
                      {p.toOrder != null && <span className="bx-move">{t('box.toOrder', { n: p.toOrder })}</span>}
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

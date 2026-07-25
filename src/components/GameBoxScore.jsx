import React from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS } from '../lib/model.js';
import { buildLineupRows, roleTag, posFull, distributeToAppearances } from '../lib/lineupBox.js';

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
        {rows.map((slot) => {
          // 同一選手の再登場で成績が二重表示にならないよう、打席・盗塁を登場行ごとに振り分ける。
          const abs = game.atBats.filter((ab) => ab.order === slot.order && ab.result);
          const { abBuckets, sbCounts } = distributeToAppearances(slot.players, abs, sbLogs);
          return (
          <div className="bx-slot" key={slot.order}>
            <div className="bx-ord">{slot.order}</div>
            <div className="bx-players">
              {slot.players.map((p, i) => {
                const tag = roleTag(p);
                const sl = statLine(lineFromBucket(abBuckets[i], sbCounts[i]));
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
          );
        })}
      </div>
    </div>
  );
}

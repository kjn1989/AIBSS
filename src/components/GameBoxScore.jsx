import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS, formatIP } from '../lib/model.js';
import { buildLineupRows, roleTag, posFull, assignAtBatsByPlayer } from '../lib/lineupBox.js';
import { buildOppLineupRows, oppBattingByLetter, oppPitcherLetters, oppPitchingStats, oppNameOf, oppHasName } from '../lib/oppBox.js';
import Sheet from './Sheet.jsx';

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
//
// 自軍/相手をセグメントコントロールで切り替える。相手も同じツリー形式で見せる
// (自軍の投手記録をつけている時点で、相手の打席結果はすべて記録されているため)。
export default function GameBoxScore({ game }) {
  const { state } = useStore();
  const t = useT();
  const [team, setTeam] = useState('mine'); // 'mine' | 'opp'
  const myName = state.settings.teamName || t('box.myTeam');
  const oppName = game.opponent || t('restab.opponentFallback');
  const hasOpp = (game.playLogs || []).some((l) => l.kind === 'defense');

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('box.title')}</div>
      {hasOpp && (
        <div className="seg-control" role="tablist" aria-label={t('box.teamSwitch')}>
          <button role="tab" aria-selected={team === 'mine'} className={team === 'mine' ? 'on' : ''} onClick={() => setTeam('mine')}>{myName}</button>
          <button role="tab" aria-selected={team === 'opp'} className={team === 'opp' ? 'on' : ''} onClick={() => setTeam('opp')}>{oppName}</button>
        </div>
      )}
      {team === 'mine' ? <MyTree game={game} /> : <OppTree game={game} />}
    </div>
  );
}

// ---- 自軍: 打順ツリー × 成績(通算成績のある登録選手) ----
function MyTree({ game }) {
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

  return (
    <>
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
                  ? statLine(lineFromBucket(bucket.atBats, bucket.sb), t)
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
    </>
  );
}

// ---- 相手: 同じ打順ツリー × その試合の成績 ----
// 相手選手は記号(A〜B…)で記録されている。タップで実名に書き換えられる。
function OppTree({ game }) {
  const t = useT();
  const [editing, setEditing] = useState(null); // 編集中の記号
  const rows = buildOppLineupRows(game);
  const stats = oppBattingByLetter(game);
  const pitchers = oppPitcherLetters(game);
  if (!rows.length) return null;

  const card = (p, i, key) => {
    const s = stats.get(p.letter);
    const named = oppHasName(game, p.letter);
    return (
      <button className={`bx-card opp${i > 0 ? ' sub' : ''}`} key={key} onClick={() => setEditing(p.letter)}>
        <div className="bx-top">
          {p.inning != null && <span className="bx-inn">{t('box.inningN', { n: p.inning })}</span>}
          {/* 相手の交代は種別(代打/守備)まで記録していないため、中立に「途中出場」とする */}
          {!p.isStarter && <span className="bx-role def">{t('box.oppSub')}</span>}
          {pitchers.includes(p.letter) && <span className="bx-pos">{t('box.oppPitcher')}</span>}
          <span className="bx-name">
            {oppNameOf(game, p.letter)}
            {named && <span className="bx-num">{p.letter}</span>}
          </span>
          <span className="bx-edit" aria-hidden>✎</span>
        </div>
        <div className="bx-bottom">{statLine(s, t) || t('box.noPa')}</div>
      </button>
    );
  };

  // 打順に出てこない投手(打順外の継投)は下に別枠で出す
  const inTree = new Set(rows.flatMap((r) => r.players.map((p) => p.letter)));
  const extraPitchers = pitchers.filter((l) => !inTree.has(l));

  return (
    <>
      <p className="small dim" style={{ marginTop: 0 }}>{t('box.oppDesc')}</p>
      <div className="bx-tree">
        {rows.map((slot) => (
          <div className="bx-slot" key={slot.order}>
            <div className="bx-ord">{slot.order}</div>
            <div className="bx-players">
              {slot.players.map((p, i) => card(p, i, `${p.letter}-${i}`))}
            </div>
          </div>
        ))}
        {extraPitchers.length > 0 && (
          <div className="bx-slot">
            <div className="bx-ord">{t('box.oppPitcher')}</div>
            <div className="bx-players">
              {extraPitchers.map((letter, i) => card({ letter, inning: null, isStarter: true }, 0, `p-${letter}-${i}`))}
            </div>
          </div>
        )}
      </div>
      <OppPitching game={game} onEdit={setEditing} />
      {editing && <OppNameSheet game={game} letter={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// 相手投手のその試合の成績。球数は記録済み、それ以外は自軍の打席から逆算している。
function OppPitching({ game, onEdit }) {
  const t = useT();
  const rows = oppPitchingStats(game).filter((r) => r.bf > 0 || r.pitches > 0);
  if (!rows.length) return null;
  return (
    <div className="opp-pit">
      <div className="section-title">{t('box.oppPitchTitle')}</div>
      <table className="split-table opp-pit-table">
          <thead>
            <tr>
              <th className="sp-lbl">{t('ss.pitcher')}</th>
              <th>{t('ss.ip')}</th><th>{t('ss.runs')}</th><th>{t('ss.pHits')}</th>
              <th>{t('ss.bbhbp')}</th><th>{t('ss.k')}</th><th>{t('ss.pitches')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.letter}>
                <td className="sp-lbl">
                  <button className="opp-name-btn" onClick={() => onEdit(r.letter)}>{oppNameOf(game, r.letter)} <span aria-hidden>✎</span></button>
                </td>
                <td>{formatIP(r.outs)}</td>
                <td>{r.runs}</td>
                <td>{r.h}</td>
                <td>{r.bb + r.hbp}</td>
                <td>{r.k}</td>
                <td>{r.pitches || '-'}</td>
              </tr>
            ))}
          </tbody>
      </table>
      <p className="small dim" style={{ marginBottom: 0 }}>{t('box.oppPitchNote')}</p>
    </div>
  );
}

// 相手選手の名前を書き換えるシート。開いたらすぐ入力でき、Enter か「保存」で閉じる。
function OppNameSheet({ game, letter, onClose }) {
  const { dispatch } = useStore();
  const t = useT();
  const [name, setName] = useState((game.oppNames || {})[letter] || '');
  const save = () => {
    dispatch({ type: 'SET_OPP_NAME', gameId: game.id, letter, name });
    onClose();
  };
  return (
    <Sheet title={t('box.oppNameTitle', { letter })} onClose={onClose}>
      <p className="small dim" style={{ marginTop: 0 }}>{t('box.oppNameHint')}</p>
      <input
        autoFocus
        value={name}
        placeholder={t('box.oppNamePlaceholder', { letter })}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        style={{ width: '100%' }}
        aria-label={t('box.oppNameTitle', { letter })}
      />
      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={save}>{t('action.save')}</button>
      </div>
    </Sheet>
  );
}

// 「2打数1安打」のような1行。打席がまだ無ければ null。
function statLine(s, t) {
  if (!s || (!s.pa && !s.sb)) return null;
  const parts = [t('box.abN', { n: s.ab }), t('box.hN', { n: s.h })];
  if (s.rbi) parts.push(t('box.rbiN', { n: s.rbi }));
  if (s.hr) parts.push(t('box.hrN', { n: s.hr }));
  if (s.sb) parts.push(t('box.sbN', { n: s.sb }));
  return parts.join(' ');
}

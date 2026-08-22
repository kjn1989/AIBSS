import React, { useState } from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS, formatIP, resultCategory, multiOutLabel } from '../lib/model.js';
import { shortLabel } from '../lib/notation.js';
import { computeBoxScore } from '../lib/boxscore.js';
import { buildLineupRows, assignAtBatsByPlayer } from '../lib/lineupBox.js';
import { buildOppLineupRows, oppBattingByLetter, oppPitcherLetters, oppPitchingStats, oppNameOf } from '../lib/oppBox.js';
import FullscreenView from './FullscreenView.jsx';
import EditPlaySheet from './EditPlaySheet.jsx';
import InningFlowSheet from './InningFlowSheet.jsx';
import FlowView from './FlowView.jsx';
import DefenseFixSheet from './DefenseFixSheet.jsx';
import PitchingFixSheet from './PitchingFixSheet.jsx';
import LiveRulesSheet from './LiveRulesSheet.jsx';

// 打席結果の超短縮表記(スコアシートのセル用): 例「中安」「遊ゴ」「左本」「四球」/ 英語は "LF1B" 等。
// editionが少年野球のときは 併殺→ゲ, エラー→エ の親しみ表記。
// 印刷用スコアシート: 打順×イニングのマトリクス + 線分スコア + 投手成績
export default function ScoreSheetView({ game, onClose }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const nameOf = usePlayerName();
  const box = computeBoxScore(game);
  const edition = state.settings.edition;
  const teamName = state.settings.teamName || t('restab.teamFallback');
  const oppName = game.opponent || t('restab.opponentFallback');
  // イニング列は線分スコアと同じ「実際に行われた回」に揃える(見出しと中身のズレも防ぐ)。
  // 打席が記録されている回が線分スコアより先まである場合はそこまで伸ばす。
  const lastAb = game.atBats.reduce((m, ab) => Math.max(m, ab.snapshot?.inning || 0), 0);
  const lastDef = (game.playLogs || []).reduce((m, l) => (l.kind === 'defense' ? Math.max(m, Number(l.inning) || 0) : m), 0);
  const lastInning = Math.max(box.innings.length, lastAb, lastDef, 1);
  const innings = Array.from({ length: lastInning }, (_, i) => i + 1);

  // 打順スロットごとに、出場選手を「登場順」で各自1行に分ける(伝統的なスコアブック方式)。
  // 位置=(先発)/打(代打)/走(代走)+守備位置。
  // 打撃結果は「1人=1行」に集約する(打順を移った選手が複数行に分散しないように)。
  const rows = buildLineupRows(game);
  const rowsByOrder = new Map(rows.map((r) => [r.order, r.players]));
  // 出場表に無いが打席がある選手を補完(過去データの取りこぼし防止)
  const blank = { notation: '—', isStarter: false, role: 'def', inning: null, posCode: null, fromOrder: null, toOrder: null };
  for (const ab of game.atBats) {
    if (!ab.result || ab.order == null) continue;
    let players = rowsByOrder.get(ab.order);
    if (!players) {
      players = [];
      rowsByOrder.set(ab.order, players);
      rows.push({ order: ab.order, players });
    }
    if (!players.some((p) => p.playerId === ab.playerId)) {
      players.push({ ...blank, playerId: ab.playerId, isStarter: players.length === 0 });
    }
  }
  const assigned = assignAtBatsByPlayer(rows, game.atBats.filter((ab) => ab.result));

  const slots = [];
  for (let order = 1; order <= 9; order++) {
    const players = rowsByOrder.get(order) || [];
    if (players.length === 0) continue;
    const playerRows = players.map((p) => {
      const bucket = assigned.get(p) || { atBats: [], primary: true, primaryOrder: order };
      const pabs = bucket.atBats;
      const byInning = {};
      for (const ab of pabs) {
        const inn = ab.snapshot?.inning || 1;
        (byInning[inn] = byInning[inn] || []).push({
          txt: shortLabel(ab, edition, lang, t),
          cat: resultCategory(ab.result),
          multi: multiOutLabel(ab.outsOnPlay || 0),
          abId: ab.id, // 押されたマスから打席ログを一意に引くための手掛かり
        });
      }
      return {
        ...p,
        byInning,
        // 集約先でない行は打撃欄を空にする(0打数と紛らわしくしない)
        totals: bucket.primary ? {
          ab: pabs.filter((a) => RESULTS[a.result]?.ab).length,
          h: pabs.filter((a) => RESULTS[a.result]?.hit).length,
          rbi: pabs.reduce((s, a) => s + (a.rbi || 0), 0),
        } : null,
        primaryOrder: bucket.primaryOrder,
      };
    });
    slots.push({ order, playerRows });
  }

  // 修正モード。押せるのは「戻る・印刷」だけ、という状態を既定にして、
  // 明示的に入ったときだけ表全体を触れるようにする(見せている最中の誤タップを防ぐ)
  const [editing, setEditing] = useState(false);
  const [editLog, setEditLog] = useState(null);
  const [draft, setDraft] = useState(null); // まだ存在しない打席を足すとき
  const [flowInn, setFlowInn] = useState(null); // 回の流れ(交代のタイミングを直す)
  const [defFix, setDefFix] = useState(null); // 守備・交代(何を直すかを先に選ばせる)
  const [pitFix, setPitFix] = useState(null); // 投手成績(記録から計算した値と並べて見せる)
  // 試合の流れは、試合が終わってから振り返るもののほうが多い。
  // スコア入力画面にしか入口が無いと、終わった試合では二度と見られなかった
  const [showFlow, setShowFlow] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false); // 試合ルール(9人でないのが正しい試合はここで宣言する)
  const logById = new Map((game.playLogs || []).map((l) => [l.id, l]));
  const logByAtBat = new Map();
  for (const l of game.playLogs || []) {
    if (l.kind === 'atbat' && l.payload?.atBatId) logByAtBat.set(l.payload.atBatId, l);
  }
  // 押されたマスから編集対象のログを引く。旧データで atBatId が無い場合は開かない
  const openCell = (c) => {
    const log = c.logId ? logById.get(c.logId) : logByAtBat.get(c.abId);
    if (log) setEditLog(log);
  };
  // マス1つ=打席1つ。マスの中の表記をそのまま押せるようにして、
  // 「何打席目か」を言葉で特定する工程を無くす
  // 空のマスからは、記録されていなかった打席を足せる。
  // 1巡して回ってきた打席の書き漏らしや、打順を飛ばしそびれた穴を埋めるため。
  const addNode = (playerId, order, inning) => (
    <button
      type="button"
      className="ss-cell-add"
      onClick={() => setDraft({ inning, playerId, order })}
      aria-label={t('ss.addCell', { inning })}
    >＋</button>
  );

  // イニングの数字から「回の流れ」を開く。交代は打席の間に起きるので、
  // マス目だけでは「何番の後で代わったか」を永久に直せない
  const innHead = (i) => (editing ? (
    <button type="button" className="ss-inn-btn" onClick={() => setFlowInn(i)} aria-label={t('flow.title', { inning: i })}>{i}</button>
  ) : i);

  const cellNode = (c, key) => (editing ? (
    <button
      key={key}
      type="button"
      className={`ss-cell ss-cell-btn ${c.cat}`}
      onClick={() => openCell(c)}
      aria-label={t('ss.editCell', { label: c.txt })}
    >
      {c.txt}{c.multi ? <b className="ss-mp" title={c.multi}>⚡</b> : ''}
    </button>
  ) : (
    <span key={key} className={`ss-cell ${c.cat}`}>{c.txt}{c.multi ? <b className="ss-mp" title={c.multi}>⚡</b> : ''}</span>
  ));

  const records = [...game.pitchingRecords].sort((a, b) => a.appearanceOrder - b.appearanceOrder);

  // ---- 相手チーム: 記号(A〜T)で記録された打席を、同じ打順マトリクスに組む ----
  // 相手の打席は 'defense' ログに全部残っているので、自軍と同じ形で並べられる。
  const oppPitchers = oppPitcherLetters(game);
  const oppCells = new Map(); // letter -> { [inning]: [cell] }
  for (const l of game.playLogs || []) {
    if (l.kind !== 'defense') continue;
    const p = l.payload || {};
    if (!p.letter || !RESULTS[p.result]) continue;
    const inn = Number(l.inning) || 1;
    const m = oppCells.get(p.letter) || {};
    (m[inn] = m[inn] || []).push({
      txt: shortLabel(p, edition, lang, t),
      cat: resultCategory(p.result),
      multi: multiOutLabel(p.outsOnPlay || 0),
      logId: l.id,
    });
    oppCells.set(p.letter, m);
  }
  const oppStats = oppBattingByLetter(game);
  const oppSlots = buildOppLineupRows(game).map((row) => ({
    order: row.order,
    playerRows: row.players.map((p) => ({
      letter: p.letter,
      // 守備位置は任意入力。未入力なら投手/途中出場の印だけ付ける
      notation: p.posCode || (oppPitchers.includes(p.letter) ? t('ss.oppP') : (p.isStarter ? '' : t('ss.oppSub'))),
      byInning: oppCells.get(p.letter) || {},
      totals: oppStats.get(p.letter) || null,
    })),
  })).filter((s) => s.playerRows.length);
  const hasOpp = oppCells.size > 0;
  // 相手投手: 球数は記録済み、その他は自軍の打席から逆算(自責点は追えないので出さない)
  // 相手投手の成績は打席記録から導いているだけなので、人が決めた値は上書きとして持つ
  const oppFix = game.oppPitchingFix || {};
  const oppPit = oppPitchingStats(game)
    .map((r) => ({ ...r, ...(oppFix[r.letter] || {}), fixed: !!oppFix[r.letter] }))
    .filter((r) => r.bf > 0 || r.pitches > 0 || oppFix[r.letter]);

  return (
    <FullscreenView>
      <header className="fullscreen-header no-print">
        <button className="ghost small" onClick={onClose}>{t('action.back')}</button>
        <h2>{t('ss.title')}</h2>
        <button className="ghost small" onClick={() => window.print()}>{t('ss.print')}</button>
        <button
          className={`small ss-editbtn${editing ? ' on' : ''}`}
          onClick={() => setEditing((v) => !v)}
        >{editing ? t('ss.editDone') : t('ss.editStart')}</button>
      </header>
      {editing && (
        <div className="ss-edithint no-print">
          {t('ss.editHint')}
          {/* 「9人揃っていない」「同じ位置に2人」は記録の誤りではなくルールのことがある */}
          <button className="small" onClick={() => setRulesOpen(true)}>{t('lr.open')}</button>
        </div>
      )}
      {rulesOpen && <LiveRulesSheet game={game} onClose={() => setRulesOpen(false)} />}
      <div className="fullscreen-body">
        <div className={`scoresheet-root${editing ? ' ss-edit' : ''}`}>
          <div className="ss-title">
            <b>{teamName} vs {oppName}</b>
            <span>{game.date} / {game.status === 'finished' ? t('ss.finished') : t('score.logInning', { inning: game.inning, half: t(game.isTop ? 'half.top' : 'half.bottom') })}</span>
          </div>

          <table className="ss-table ss-line">
            <thead>
              <tr>
                <th></th>
                {innings.map((i) => <th key={i}>{i}</th>)}
                <th>{t('gp.total')}</th><th>{t('gp.h')}</th><th>{t('gp.e')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="ss-team" title={game.isHome ? oppName : teamName}>{game.isHome ? oppName : teamName}</td>
                {innings.map((n) => { const i = box.innings[n - 1]; return <td key={n}>{i?.played ? (game.isHome ? i.opp : i.my) : ''}</td>; })}
                <td><b>{game.isHome ? box.opp.r : box.my.r}</b></td>
                <td>{game.isHome ? box.opp.h : box.my.h}</td>
                <td>{game.isHome ? box.opp.e : box.my.e}</td>
              </tr>
              <tr>
                <td className="ss-team" title={game.isHome ? teamName : oppName}>{game.isHome ? teamName : oppName}</td>
                {innings.map((n) => { const i = box.innings[n - 1]; return <td key={n}>{i?.played ? (game.isHome ? i.my : i.opp) : ''}</td>; })}
                <td><b>{game.isHome ? box.my.r : box.opp.r}</b></td>
                <td>{game.isHome ? box.my.h : box.opp.h}</td>
                <td>{game.isHome ? box.my.e : box.opp.e}</td>
              </tr>
            </tbody>
          </table>

          {slots.length > 0 && hasOpp && <div className="ss-team-head">{teamName}</div>}
          {slots.length > 0 && (
            <table className="ss-table ss-matrix">
              <thead>
                <tr>
                  <th>{t('ss.order')}</th><th>{t('box.pos')}</th><th className="ss-name">{t('stats.player')}</th>
                  {innings.map((i) => <th key={i}>{innHead(i)}</th>)}
                  <th>{t('ss.ab')}</th><th>{t('ss.hits')}</th><th>{t('ss.rbi')}</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s) => s.playerRows.map((pr, ri) => (
                  <tr key={`${s.order}-${pr.playerId}-${ri}`} className={ri > 0 ? 'ss-sub' : ''}>
                    <td>{ri === 0 ? s.order : ''}</td>
                    {/* 打順を移った選手は「←8」「→9」で移動元/先を示し、途中出場と区別できるようにする */}
                    <td className="ss-pos">
                      {editing ? (
                        <button
                          type="button"
                          className="ss-row-btn"
                          onClick={() => setDefFix({ playerId: pr.playerId, order: pr.primaryOrder ?? s.order, pos: pr.posCode || '' })}
                          aria-label={t('df.title')}
                        >{pr.notation}</button>
                      ) : pr.notation}
                      {pr.fromOrder != null && <span className="ss-move" title={t('box.fromOrder', { n: pr.fromOrder })}>←{pr.fromOrder}</span>}
                      {pr.toOrder != null && <span className="ss-move" title={t('box.toOrder', { n: pr.toOrder })}>→{pr.toOrder}</span>}
                    </td>
                    <td className="ss-name" title={nameOf(pr.playerId)}>
                      {editing ? (
                        <button
                          type="button"
                          className="ss-row-btn"
                          onClick={() => setDefFix({ playerId: pr.playerId, order: pr.primaryOrder ?? s.order, pos: pr.posCode || '' })}
                          aria-label={t('df.title')}
                        >{nameOf(pr.playerId)}</button>
                      ) : nameOf(pr.playerId)}
                    </td>
                    {innings.map((i) => (
                      <td key={i}>
                        {(pr.byInning[i] || []).map((c, ci) => (
                          <React.Fragment key={ci}>
                            {ci > 0 && <span className="ss-sep">/</span>}
                            {cellNode(c, ci)}
                          </React.Fragment>
                        ))}
                        {editing && !(pr.byInning[i] || []).length && addNode(pr.playerId, pr.primaryOrder ?? s.order, i)}
                      </td>
                    ))}
                    {/* 集約先でない行は空欄。打撃成績はその選手の主たる行(位置欄の←印の打順)にまとめている */}
                    <td>{pr.totals ? pr.totals.ab : ''}</td>
                    <td>{pr.totals ? pr.totals.h : ''}</td>
                    <td>{pr.totals ? pr.totals.rbi : ''}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          )}

          {/* 相手チームの打席マトリクス(記号のままでも、名前を入れていればその名前で) */}
          {hasOpp && oppSlots.length > 0 && (
            <>
              <div className="ss-team-head">{oppName}</div>
              <table className="ss-table ss-matrix">
                <thead>
                  <tr>
                    <th>{t('ss.order')}</th><th>{t('box.pos')}</th><th className="ss-name">{t('stats.player')}</th>
                    {innings.map((i) => <th key={i}>{innHead(i)}</th>)}
                    <th>{t('ss.ab')}</th><th>{t('ss.hits')}</th><th>{t('ss.rbi')}</th>
                  </tr>
                </thead>
                <tbody>
                  {oppSlots.map((s) => s.playerRows.map((pr, ri) => (
                    <tr key={`opp-${s.order}-${pr.letter}-${ri}`} className={ri > 0 ? 'ss-sub' : ''}>
                      <td>{ri === 0 ? s.order : ''}</td>
                      <td className="ss-pos">{pr.notation}</td>
                      <td className="ss-name" title={oppNameOf(game, pr.letter)}>{oppNameOf(game, pr.letter)}</td>
                      {innings.map((i) => (
                        <td key={i}>
                          {(pr.byInning[i] || []).map((c, ci) => (
                            <React.Fragment key={ci}>
                              {ci > 0 && <span className="ss-sep">/</span>}
                              {cellNode(c, ci)}
                            </React.Fragment>
                          ))}
                        </td>
                      ))}
                      <td>{pr.totals ? pr.totals.ab : ''}</td>
                      <td>{pr.totals ? pr.totals.h : ''}</td>
                      <td>{pr.totals ? pr.totals.rbi : ''}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </>
          )}

          {/* 2チーム分を並べたときは、投手成績がどちらのものか分かるように名前を添える */}
          {records.length > 0 && hasOpp && <div className="ss-team-head">{teamName}</div>}
          {records.length > 0 && (
            <table className="ss-table">
              <thead>
                <tr>
                  <th>{t('ss.pitcher')}</th><th>{t('ss.ip')}</th><th>{t('ss.runs')}</th><th>{t('ss.er')}</th><th>{t('ss.pHits')}</th><th>{t('ss.bbhbp')}</th><th>{t('ss.k')}</th><th>{t('ss.pitches')}</th><th>{t('ss.wsh')}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((pr) => (
                  <tr key={pr.id}>
                    <td className="ss-name" title={nameOf(pr.playerId)}>
                      {editing ? (
                        <button type="button" className="ss-row-btn" onClick={() => setPitFix({ side: 'own', id: pr.playerId })} aria-label={t('pf.title')}>
                          {nameOf(pr.playerId)}
                        </button>
                      ) : nameOf(pr.playerId)}
                    </td>
                    <td>{formatIP(pr.outsRecorded)}</td>
                    <td>{pr.runs}</td>
                    <td>{pr.earnedRuns}</td>
                    <td>{pr.hitsAllowed}</td>
                    <td>{pr.walks + pr.hitByPitch}</td>
                    <td>{pr.strikeouts}</td>
                    <td>{pr.pitches}</td>
                    <td>{[pr.win && t('pt.win'), pr.save && t('pt.save'), pr.hold && t('pt.hold')].filter(Boolean).join(' ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {oppPit.length > 0 && (
            <>
              <div className="ss-team-head">{oppName}</div>
              <table className="ss-table">
                <thead>
                  <tr>
                    <th>{t('ss.pitcher')}</th><th>{t('ss.ip')}</th><th>{t('ss.runs')}</th><th>{t('ss.pHits')}</th><th>{t('ss.bbhbp')}</th><th>{t('ss.k')}</th><th>{t('ss.pitches')}</th>
                  </tr>
                </thead>
                <tbody>
                  {oppPit.map((r) => (
                    <tr key={r.letter}>
                      <td className="ss-name" title={oppNameOf(game, r.letter)}>
                        {editing ? (
                          <button type="button" className="ss-row-btn" onClick={() => setPitFix({ side: 'opp', id: r.letter })} aria-label={t('pf.title')}>
                            {oppNameOf(game, r.letter)}{r.fixed ? ' ✎' : ''}
                          </button>
                        ) : <>{oppNameOf(game, r.letter)}{r.fixed ? ' ✎' : ''}</>}
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
            </>
          )}

          <div className="ss-after">
            <button type="button" className="ss-flowbtn" onClick={() => setShowFlow(true)}>
              {t('ss.openFlow')}
            </button>
            <p className="small dim">{t('ss.openFlowNote')}</p>
          </div>

          <div className="ss-footer">{t('ss.footer')}</div>
        </div>
      </div>
      {showFlow && <FlowView game={game} onClose={() => setShowFlow(false)} />}
      {editLog && <EditPlaySheet game={game} log={editLog} onClose={() => setEditLog(null)} />}
      {draft && <EditPlaySheet game={game} draft={draft} onClose={() => setDraft(null)} />}
      {defFix && (
        <DefenseFixSheet
          game={game}
          playerId={defFix.playerId}
          order={defFix.order}
          currentPos={defFix.pos}
          onClose={() => setDefFix(null)}
        />
      )}
      {pitFix && (
        <PitchingFixSheet
          game={game}
          side={pitFix.side}
          id={pitFix.id}
          onClose={() => setPitFix(null)}
          onOpenFlow={(n) => { setPitFix(null); setFlowInn(n); }}
        />
      )}
      {flowInn != null && (
        <InningFlowSheet
          game={game}
          inning={flowInn}
          onClose={() => setFlowInn(null)}
          onEditLog={(l) => { setFlowInn(null); setEditLog(l); }}
        />
      )}
    </FullscreenView>
  );
}

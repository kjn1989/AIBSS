import React from 'react';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, formatIP, resultCategory, multiOutLabel } from '../lib/model.js';
import { computeBoxScore } from '../lib/boxscore.js';
import FullscreenView from './FullscreenView.jsx';

// 打席結果の超短縮表記(スコアシートのセル用): 例「中安」「遊ゴ」「左本」「四球」/ 英語は "LF1B" 等。
// editionが少年野球のときは 併殺→ゲ, エラー→エ の親しみ表記。
function shortLabel(ab, edition, lang, t) {
  if (lang === 'en') {
    const d = ab.direction ? t(`dir.${ab.direction}`) : '';
    switch (ab.result) {
      case 'single': return `${d}1B`;
      case 'double': return `${d}2B`;
      case 'triple': return `${d}3B`;
      case 'hr': return `${d}HR`;
      case 'out': return `${d}${{ ground: 'GO', fly: 'FO', liner: 'LO', dp: 'DP' }[ab.outType] || 'GO'}`;
      case 'so': return ab.soType === 'looking' ? 'ꓘ' : 'K';
      case 'bb': return 'BB';
      case 'hbp': return 'HBP';
      case 'error': return `${d}E`;
      case 'sacBunt': return 'SAC';
      case 'sacFly': return `${d}SF`;
      case 'interference': return 'INT';
      case 'obstruction': return 'OBS';
      case 'fieldInterference': return 'FINT';
      default: return RESULTS[ab.result]?.short || '';
    }
  }
  const dir = ab.direction ? DIRECTIONS[ab.direction][0] : '';
  const dpShort = edition === '少年野球' ? 'ゲ' : '併';
  switch (ab.result) {
    case 'single': return `${dir}安`;
    case 'double': return `${dir}2`;
    case 'triple': return `${dir}3`;
    case 'hr': return `${dir}本`;
    case 'out': return `${dir}${{ ground: 'ゴ', fly: '飛', liner: '直', dp: dpShort }[ab.outType] || 'ゴ'}`;
    case 'so': return ab.soType === 'looking' ? '見三振' : '三振';
    case 'bb': return '四球';
    case 'hbp': return '死球';
    case 'error': return `${dir}エ`;
    case 'sacBunt': return '犠打';
    case 'sacFly': return `${dir}犠飛`;
    case 'interference': return '打妨';
    case 'obstruction': return '走妨';
    case 'fieldInterference': return '守妨';
    default: return RESULTS[ab.result]?.short || '';
  }
}

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
  const maxInning = Math.max(9, game.inning || 1);
  const innings = Array.from({ length: maxInning }, (_, i) => i + 1);

  // 打順スロットごとに: 出場した選手(打席順) + イニング別の結果short
  const slots = [];
  for (let order = 1; order <= 9; order++) {
    const abs = game.atBats.filter((ab) => ab.order === order && ab.result);
    const playerIds = [];
    for (const ab of abs) if (!playerIds.includes(ab.playerId)) playerIds.push(ab.playerId);
    const lineupPid = game.lineup.find((l) => l.order === order)?.playerId;
    if (lineupPid && !playerIds.includes(lineupPid)) playerIds.push(lineupPid);
    if (playerIds.length === 0 && abs.length === 0) continue;
    const byInning = {};
    for (const ab of abs) {
      const inn = ab.snapshot?.inning || 1;
      (byInning[inn] = byInning[inn] || []).push({
        txt: shortLabel(ab, edition, lang, t),
        cat: resultCategory(ab.result),
        multi: multiOutLabel(ab.outsOnPlay || 0),
      });
    }
    const totals = {
      ab: abs.filter((a) => RESULTS[a.result]?.ab).length,
      h: abs.filter((a) => RESULTS[a.result]?.hit).length,
      rbi: abs.reduce((s, a) => s + (a.rbi || 0), 0),
    };
    slots.push({ order, playerIds, byInning, totals });
  }

  const records = [...game.pitchingRecords].sort((a, b) => a.appearanceOrder - b.appearanceOrder);

  return (
    <FullscreenView>
      <header className="fullscreen-header no-print">
        <button className="ghost small" onClick={onClose}>{t('action.back')}</button>
        <h2>{t('ss.title')}</h2>
        <button className="primary small" onClick={() => window.print()}>{t('ss.print')}</button>
      </header>
      <div className="fullscreen-body">
        <div className="scoresheet-root">
          <div className="ss-title">
            <b>{teamName} vs {oppName}</b>
            <span>{game.date} / {game.status === 'finished' ? t('ss.finished') : t('score.logInning', { inning: game.inning, half: t(game.isTop ? 'half.top' : 'half.bottom') })}</span>
          </div>

          <table className="ss-table">
            <thead>
              <tr>
                <th></th>
                {innings.map((i) => <th key={i}>{i}</th>)}
                <th>{t('gp.total')}</th><th>{t('gp.h')}</th><th>{t('gp.e')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="ss-team">{game.isHome ? oppName : teamName}</td>
                {box.innings.map((i) => <td key={i.inning}>{i.played ? (game.isHome ? i.opp : i.my) : ''}</td>)}
                <td><b>{game.isHome ? box.opp.r : box.my.r}</b></td>
                <td>{game.isHome ? box.opp.h : box.my.h}</td>
                <td>{game.isHome ? box.opp.e : box.my.e}</td>
              </tr>
              <tr>
                <td className="ss-team">{game.isHome ? teamName : oppName}</td>
                {box.innings.map((i) => <td key={i.inning}>{i.played ? (game.isHome ? i.my : i.opp) : ''}</td>)}
                <td><b>{game.isHome ? box.my.r : box.opp.r}</b></td>
                <td>{game.isHome ? box.my.h : box.opp.h}</td>
                <td>{game.isHome ? box.my.e : box.opp.e}</td>
              </tr>
            </tbody>
          </table>

          {slots.length > 0 && (
            <table className="ss-table ss-matrix">
              <thead>
                <tr>
                  <th>{t('ss.order')}</th><th className="ss-name">{t('stats.player')}</th>
                  {innings.map((i) => <th key={i}>{i}</th>)}
                  <th>{t('ss.ab')}</th><th>{t('ss.hits')}</th><th>{t('ss.rbi')}</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s) => (
                  <tr key={s.order}>
                    <td>{s.order}</td>
                    <td className="ss-name">{s.playerIds.map((id) => nameOf(id)).join(' → ')}</td>
                    {innings.map((i) => (
                      <td key={i}>
                        {(s.byInning[i] || []).map((c, ci) => (
                          <React.Fragment key={ci}>
                            {ci > 0 && <span className="ss-sep">/</span>}
                            <span className={`ss-cell ${c.cat}`}>{c.txt}{c.multi ? <b className="ss-mp" title={c.multi}>⚡</b> : ''}</span>
                          </React.Fragment>
                        ))}
                      </td>
                    ))}
                    <td>{s.totals.ab}</td>
                    <td>{s.totals.h}</td>
                    <td>{s.totals.rbi}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

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
                    <td className="ss-name">{nameOf(pr.playerId)}</td>
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

          <div className="ss-footer">{t('ss.footer')}</div>
        </div>
      </div>
    </FullscreenView>
  );
}

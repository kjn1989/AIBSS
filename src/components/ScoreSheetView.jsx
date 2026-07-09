import React from 'react';
import { useStore, usePlayerName } from '../state/store.jsx';
import { RESULTS, DIRECTIONS, formatIP } from '../lib/model.js';
import { computeBoxScore } from '../lib/boxscore.js';
import FullscreenView from './FullscreenView.jsx';

// 打席結果の超短縮表記(スコアシートのセル用): 例「中安」「遊ゴ」「左本」「四球」
function shortLabel(ab) {
  const dir = ab.direction ? DIRECTIONS[ab.direction][0] : '';
  switch (ab.result) {
    case 'single': return `${dir}安`;
    case 'double': return `${dir}2`;
    case 'triple': return `${dir}3`;
    case 'hr': return `${dir}本`;
    case 'out': return `${dir}${{ ground: 'ゴ', fly: '飛', liner: '直', dp: '併' }[ab.outType] || 'ゴ'}`;
    case 'so': return ab.soType === 'looking' ? '見三振' : '三振';
    case 'bb': return '四球';
    case 'hbp': return '死球';
    case 'error': return `${dir}失`;
    case 'sacBunt': return '犠打';
    case 'sacFly': return `${dir}犠飛`;
    case 'interference': return '打妨';
    default: return RESULTS[ab.result]?.short || '';
  }
}

// 印刷用スコアシート: 打順×イニングのマトリクス + 線分スコア + 投手成績
export default function ScoreSheetView({ game, onClose }) {
  const { state } = useStore();
  const nameOf = usePlayerName();
  const box = computeBoxScore(game);
  const teamName = state.settings.teamName || 'マイチーム';
  const oppName = game.opponent || '対戦相手';
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
      (byInning[inn] = byInning[inn] || []).push(shortLabel(ab));
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
        <button className="ghost small" onClick={onClose}>← 戻る</button>
        <h2>スコアシート</h2>
        <button className="primary small" onClick={() => window.print()}>🖨 印刷</button>
      </header>
      <div className="fullscreen-body">
        <div className="scoresheet-root">
          <div className="ss-title">
            <b>{teamName} vs {oppName}</b>
            <span>{game.date} / {game.status === 'finished' ? '試合終了' : `${game.inning}回${game.isTop ? '表' : '裏'}`}</span>
          </div>

          <table className="ss-table">
            <thead>
              <tr>
                <th></th>
                {innings.map((i) => <th key={i}>{i}</th>)}
                <th>計</th><th>H</th><th>E</th>
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
                  <th>打順</th><th className="ss-name">選手</th>
                  {innings.map((i) => <th key={i}>{i}</th>)}
                  <th>打数</th><th>安打</th><th>打点</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s) => (
                  <tr key={s.order}>
                    <td>{s.order}</td>
                    <td className="ss-name">{s.playerIds.map((id) => nameOf(id)).join(' → ')}</td>
                    {innings.map((i) => <td key={i}>{(s.byInning[i] || []).join('/')}</td>)}
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
                  <th>投手</th><th>回</th><th>失点</th><th>自責</th><th>被安</th><th>四死</th><th>三振</th><th>球数</th><th>勝S H</th>
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
                    <td>{[pr.win && '勝', pr.save && 'S', pr.hold && 'H'].filter(Boolean).join(' ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="ss-footer">AI-BASE — AI野球スコア&成績</div>
        </div>
      </div>
    </FullscreenView>
  );
}

import React, { useMemo } from 'react';
import { useT } from '../state/store.jsx';
import { tournamentRecord, tournamentOf } from '../lib/tournament.js';
import { aggregateBatting, aggregatePitching, defaultInningBasis, fmtAvg } from '../lib/stats.js';
import { formatIP } from '../lib/model.js';

// 大会のまとめ(戦績・各試合のスコア・チームの打撃と投手)。
// 成績タブの「大会」と、試合結果タブ(その試合の大会)の両方で使う。
// onPick を渡すと、試合の行を押してその試合を開ける
export default function TournamentSummary({ games = [], title = null, onPick = null, currentId = null }) {
  const t = useT();
  const rec = tournamentRecord(games);
  const team = useMemo(() => {
    const bat = Object.values(aggregateBatting(games));
    const pit = Object.values(aggregatePitching(games));
    const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
    const ab = sum(bat, 'ab'); const h = sum(bat, 'h');
    const bb = sum(bat, 'bb'); const hbp = sum(bat, 'hbp'); const sf = sum(bat, 'sacFly');
    const outs = sum(pit, 'outsRecorded'); const er = sum(pit, 'earnedRuns');
    const basis = defaultInningBasis(games);
    return {
      avg: ab ? h / ab : null,
      obp: ab + bb + hbp + sf ? (h + bb + hbp) / (ab + bb + hbp + sf) : null,
      hr: sum(bat, 'hr'), sb: sum(bat, 'sb'), h,
      ip: outs, era: outs ? (er / (outs / 3)) * basis : null, basis,
      k: sum(pit, 'strikeouts'),
    };
  }, [games]);
  if (!games.length) return null;
  const mark = (g) => {
    if (g.status !== 'finished') return { c: 'ongoing', s: t('tour.ongoing') };
    if (g.myScore > g.oppScore) return { c: 'w', s: '○' };
    if (g.myScore < g.oppScore) return { c: 'l', s: '●' };
    return { c: 'd', s: '△' };
  };
  // 「AABC2026 第2戦」から大会名を外した残り(第2戦)を試合の呼び名にする
  const roundOf = (g) => {
    const s = String(g.season || '').trim();
    const name = tournamentOf(s);
    const rest = s.slice(name.length).replace(/^[\s　\-ー－:：・/／(（]+|[)）]$/g, '').trim();
    return rest || g.date;
  };
  return (
    <div className="tour-card">
      {title && <div className="tour-title">🏆 {title}</div>}
      <div className="tour-record">
        <b>{t('tour.record', { w: rec.w, l: rec.l, d: rec.d })}</b>
        <span className="small dim">{t('tour.runs', { rs: rec.rs, ra: rec.ra })}</span>
      </div>
      <div className="tour-games">
        {games.map((g) => {
          const m = mark(g);
          return (
            <button
              key={g.id}
              className={`tour-game${g.id === currentId ? ' on' : ''}`}
              onClick={onPick ? () => onPick(g.id) : undefined}
              disabled={!onPick}
            >
              <span className="tg-round">{roundOf(g)}</span>
              <span className="tg-opp">vs {g.opponent || t('restab.opponentFallback')}</span>
              <span className={`tg-mark ${m.c}`}>{m.s}</span>
              <b className="tg-score">{g.myScore}-{g.oppScore}</b>
            </button>
          );
        })}
      </div>
      <div className="tour-team">
        <div><span>{t('tour.avg')}</span><b>{team.avg === null ? '-' : fmtAvg(team.avg)}</b></div>
        <div><span>{t('tour.obp')}</span><b>{team.obp === null ? '-' : fmtAvg(team.obp)}</b></div>
        <div><span>{t('tour.hits')}</span><b>{team.h}</b></div>
        <div><span>{t('tour.sb')}</span><b>{team.sb}</b></div>
        <div><span>{t('tour.era', { basis: team.basis })}</span><b>{team.era === null ? '-' : team.era.toFixed(2)}</b></div>
        <div><span>{t('tour.ip')}</span><b>{formatIP(team.ip)}</b></div>
      </div>
    </div>
  );
}

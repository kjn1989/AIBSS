import React from 'react';
import { useStore, useT, usePlayerName, isMyTeamBatting, currentBatter, currentOppBatter } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, fmtAvg } from '../lib/stats.js';
import { resultCategory, multiOutLabel, positionLabel, formatIP, isSimpleGame } from '../lib/model.js';
import { playLabel } from '../lib/voiceParser.js';
import { oppNameOf, oppPositionOf } from '../lib/oppBox.js';

// 野球中継のような「いまの打者」の表示。
//   名前・打順・守備位置 / 今日の打席の結果 / 今日の成績(打率・打点・得点など)/ 通算打率
// 観戦ページ・見るだけの端末・記録する端末の打者カードで同じものを使う。
const EMPTY = { pa: 0, ab: 0, h: 0, rbi: 0, runs: 0, bb: 0, hbp: 0, so: 0, hr: 0, sb: 0 };

// 今日の成績の文字列。分母が0のとき打率は出さない(.000 と区別する)
export function todayLine(s) {
  return { ab: s.ab, h: s.h, avg: s.ab > 0 ? s.h / s.ab : null };
}

export function BatterStats({ game, playerId, season = true }) {
  const { state } = useStore();
  const t = useT();
  const today = aggregateBatting([game])[playerId] || EMPTY;
  const line = todayLine(today);
  // 通算は、この端末に保存されている試合の合計。観戦ページは見ている試合しか持たないので出さない
  let career = null;
  if (season && !window.__AIBSS_NO_PERSIST__) {
    const others = Object.values(state.games).filter((g) => g.id !== game.id && !String(g.id).startsWith('demo-'));
    const c = aggregateBatting([...others, game])[playerId];
    if (c && c.ab > 0) career = c.h / c.ab;
  }
  if (!today.pa && career === null) return <div className="bs-line dim small">{t('cb.noPaYet')}</div>;
  return (
    <div className="bs-line">
      <span className="bs-main"><b>{t('cb.today')}</b> {t('cb.abh', { ab: line.ab, h: line.h })}{line.avg !== null && <span className="bs-avg"> {fmtAvg(line.avg)}</span>}</span>
      <span className="bs-chip"><i>{t('cb.rbi')}</i><b>{today.rbi}</b></span>
      <span className="bs-chip"><i>{t('cb.runs')}</i><b>{today.runs}</b></span>
      {(today.bb + today.hbp) > 0 && <span className="bs-chip"><i>{t('cb.bb')}</i><b>{today.bb + today.hbp}</b></span>}
      {today.so > 0 && <span className="bs-chip"><i>{t('cb.so')}</i><b>{today.so}</b></span>}
      {today.hr > 0 && <span className="bs-chip"><i>{t('cb.hr')}</i><b>{today.hr}</b></span>}
      {today.sb > 0 && <span className="bs-chip"><i>{t('cb.sb')}</i><b>{today.sb}</b></span>}
      {career !== null && <span className="bs-chip career"><i>{t('cb.career')}</i><b>{fmtAvg(career)}</b></span>}
    </div>
  );
}

// 自チームの守備中の投手の、今日の投球内容(投球回・球数・被安打・奪三振・四死球・失点)。
// かんたん記録の試合は球数を数えていないので、球数は出さない(0球と誤解されるため)
export function PitcherStats({ game, playerId, showName = false }) {
  const t = useT();
  const nameOf = usePlayerName();
  if (!playerId) return null;
  const s = aggregatePitching([game])[playerId];
  const simple = isSimpleGame(game);
  return (
    <div className="bs-line ps-line">
      <span className="bs-main"><b>{showName ? `${t('cb.pitcher')} ${nameOf(playerId)}` : t('cb.pitcherToday')}</b>{' '}{t('cb.ip', { ip: formatIP(s?.outsRecorded || 0) })}</span>
      {!simple && <span className="bs-chip"><i>{t('cb.pitches')}</i><b>{s?.pitches || 0}</b></span>}
      <span className="bs-chip"><i>{t('cb.hitsAllowed')}</i><b>{s?.hitsAllowed || 0}</b></span>
      <span className="bs-chip"><i>{t('cb.k')}</i><b>{s?.strikeouts || 0}</b></span>
      <span className="bs-chip"><i>{t('cb.bb')}</i><b>{(s?.walks || 0) + (s?.hitByPitch || 0)}</b></span>
      <span className="bs-chip"><i>{t('cb.runsAllowed')}</i><b>{s?.runs || 0}</b></span>
    </div>
  );
}

export function PaChips({ items, edition, lang }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="atbat-history">
      {items.map((it, i) => (
        <span className={`hist-chip ${resultCategory(it.result)}`} key={it.id}>
          {i + 1}. {playLabel(it.result, it.direction, it.outType, it.soType, edition, lang, { hitAngle: it.hitAngle, intentional: it.intentional })}
          {multiOutLabel(it.outsOnPlay || 0) && <span className="mini-badge"> ⚡</span>}
        </span>
      ))}
    </div>
  );
}

export default function CurrentBatter({ game }) {
  const { state } = useStore();
  const t = useT();
  const nameOf = usePlayerName();
  const lang = state.settings.lang || 'ja';
  const edition = state.settings.edition;
  if (!game || game.status !== 'ongoing') return null;
  if (isMyTeamBatting(game)) {
    const b = currentBatter(game);
    if (!b) return null;
    return (
      <div className="card sit-card cb-card">
        <div className="sit-row">
          <span className="rank-badge">{b.order}</span>
          <div className="sit-batter"><div className="sit-main">
            <span className="nm">{nameOf(b.playerId)}</span>
            <span className="pos">{positionLabel(b.position, lang)}</span>
          </div></div>
          <span className="small dim">{t('cb.atBat')}</span>
        </div>
        <BatterStats game={game} playerId={b.playerId} />
        <PaChips items={game.atBats.filter((ab) => ab.playerId === b.playerId)} edition={edition} lang={lang} />
      </div>
    );
  }
  const o = currentOppBatter(game);
  if (!o) return null;
  const pos = oppPositionOf(game, o.letter);
  return (
    <div className="card sit-card cb-card">
      <div className="sit-row">
        <span className="rank-badge">{o.order}</span>
        <div className="sit-batter"><div className="sit-main">
          <span className="nm">{oppNameOf(game, o.letter)}</span>
          {pos && <span className="pos">{pos}</span>}
        </div></div>
        <span className="small dim">{t('cb.oppAtBat')}</span>
      </div>
      <PaChips
        items={game.playLogs.filter((l) => l.kind === 'defense' && l.payload.letter === o.letter).map((l) => ({ id: l.id, ...l.payload }))}
        edition={edition}
        lang={lang}
      />
      <PitcherStats game={game} playerId={game.currentPitcherId} showName />
    </div>
  );
}

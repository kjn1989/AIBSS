import React, { useState, useMemo } from 'react';
import SalaryRanking from './SalaryRanking.jsx';
import { useStore, usePlayerName, useT } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching, aggregateFielding, rankFielding, pitchingMetrics, DETAIL_METRICS, detailRanking, battingMetrics, fmtAvg, mLabel, defaultInningBasis } from '../lib/stats.js';
import { formatIP } from '../lib/model.js';
import GameScopeToggle, { scopedGames } from './GameScopeToggle.jsx';
import TeamPowerCard from './TeamPowerCard.jsx';
import ScorerCard from './ScorerCard.jsx';
import ContribCard from './ContribCard.jsx';
import { tenureByPlayer, isArchived, DEFAULT_YEAR_START_MONTH } from '../lib/year.js';
import PlayerView from './PlayerView.jsx';
import MemberSection from './MemberSection.jsx';
import TitleCards from './TitleCards.jsx';
import MatchupCard from './MatchupCard.jsx';
import BatteryCard from './BatteryCard.jsx';
import OffenseCard from './OffenseCard.jsx';

// 成績・詳細ランキング(10大メトリクス) + 投手成績(旧「投手」タブを統合)
export default function StatsTab() {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const statTr = (key) => t(`stat.${key}`);
  const nameOf = usePlayerName();
  // 既定は年度(いまのチーム)。通算を既定にすると卒業生の混ざった一覧が初手で出てしまう
  const [scope, setScope] = useState({ scope: 'year', gameId: null, year: null });
  const [metricKey, setMetricKey] = useState('ba');
  const [playerId, setPlayerId] = useState(null); // 選手個人ページ
  // 防御率・奪三振率の基準イニング。既定は試合のルール(7回制/9回制)から。
  // 全体設定にはせず、その指標を見ている画面でその場で切り替えられるようにする。
  const [basis, setBasis] = useState(null);

  const games = scopedGames(state, scope);
  const autoBasis = useMemo(() => defaultInningBasis(games), [games]);
  const inningBasis = basis ?? autoBasis;
  // 選べる基準: 7回・9回 + そのチームの実際の回数(学童6回など)
  const basisOptions = [...new Set([7, 9, autoBasis])].sort((a, b) => a - b);
  // 在籍期間は全試合から算出する(スコープで絞った試合だけだと期間が縮んでしまう)
  const tenure = useMemo(
    () => tenureByPlayer(Object.values(state.games), state.settings.yearStartMonth || DEFAULT_YEAR_START_MONTH),
    [state.games, state.settings.yearStartMonth],
  );
  // 通算では卒業生も並ぶので在籍期間を添える。年度・試合では自明なので出さない
  const tenureOf = scope.scope === 'total'
    ? (id) => { const t = tenure.get(id); if (!t) return ''; const p = state.players.find((x) => x.id === id);
        return isArchived(p) ? `${t.from}–${t.to}` : `${t.from}–`; }
    : null;
  const batting = useMemo(() => aggregateBatting(games), [games]);
  const pitching = useMemo(() => aggregatePitching(games), [games]);
  const fielding = useMemo(() => rankFielding(aggregateFielding(games)), [games]);

  const metric = DETAIL_METRICS.find((m) => m.key === metricKey);
  const rows = useMemo(() => detailRanking(metric, batting, pitching, statTr, inningBasis), [metric, batting, pitching, lang, inningBasis]);

  const batMetrics = DETAIL_METRICS.filter((m) => m.type === 'bat');
  const pitMetrics = DETAIL_METRICS.filter((m) => m.type === 'pit');

  return (
    <div>
      <GameScopeToggle value={scope} onChange={setScope} />

      {/* タイトルホルダー(👑)。ホームから移設 */}
      <TitleCards games={games} />

      {/* チーム力: 他チームではなく「その場面」と比べるので順位表が要らない */}
      <TeamPowerCard games={games} />
      <ContribCard games={games} />
      <ScorerCard games={games} />

      <div className="section-title">{t('stats.battingMetrics')}</div>
      <div className="grid3">
        {batMetrics.map((m) => (
          <button key={m.key} className={`small ${metricKey === m.key ? 'primary' : ''}`} onClick={() => setMetricKey(m.key)}>
            {mLabel(m, lang).split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="section-title">{t('stats.pitchingMetrics')}</div>
      <div className="grid3">
        {pitMetrics.map((m) => (
          <button key={m.key} className={`small ${metricKey === m.key ? 'primary' : ''}`} onClick={() => setMetricKey(m.key)}>
            {mLabel(m, lang).split(' ')[0]}
          </button>
        ))}
      </div>

      <div className="card mt16">
        <h2>{t('stats.ranking', { label: mLabel(metric, lang) })} {metric.higherBetter ? '' : t('stats.lowerBetter')}</h2>
        {/* 回数換算の指標だけ、ここで基準イニングを選べる(7回制/9回制で意味が変わるため) */}
        {metric.perInning && (
          <div className="basis-pick">
            <span className="small dim">{t('stats.basis')}</span>
            <div className="seg-control mini" role="tablist" aria-label={t('stats.basis')}>
              {basisOptions.map((n) => (
                <button
                  key={n} role="tab" aria-selected={inningBasis === n}
                  className={inningBasis === n ? 'on' : ''}
                  onClick={() => setBasis(n)}
                >
                  {t('stats.basisN', { n })}
                </button>
              ))}
            </div>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="dim small">{t('stats.noData')}</div>
        ) : (
          <table className="rank-table">
            <thead>
              <tr>
                <th>{t('stats.rank')}</th>
                <th>{t('stats.player')}</th>
                <th style={{ textAlign: 'right' }}>{mLabel(metric, lang).split(' ')[0]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId} onClick={() => setPlayerId(r.playerId)} role="button">
                  <td><span className="rank-badge">{r.rank}</span></td>
                  <td>
                    {nameOf(r.playerId)}
                    <div className="dim small">{r.detail}</div>
                  </td>
                  <td className="num">{r.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <BattingSummaryTable batting={batting} nameOf={nameOf} onOpenPlayer={setPlayerId} tenureOf={tenureOf} />
      <PitchingSummaryTable pitching={pitching} nameOf={nameOf} onOpenPlayer={setPlayerId} tenureOf={tenureOf} basis={inningBasis} lang={lang} />
      <FieldingSummaryTable rows={fielding} nameOf={nameOf} onOpenPlayer={setPlayerId} tenureOf={tenureOf} />
      <MatchupCard games={games} onOpenPlayer={setPlayerId} />
      <BatteryCard games={games} />
      <OffenseCard games={games} />
      <SalaryRanking nameOf={nameOf} onOpenPlayer={setPlayerId} />
      <p className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>
        {t('stats.tapHint')}
      </p>

      <MemberSection />

      {playerId && <PlayerView playerId={playerId} games={games} onClose={() => setPlayerId(null)} />}
    </div>
  );
}

// 全員の打撃成績一覧。プロ野球の個人打撃成績と同じ並びの項目を全部出す。
// 横に長いので名前の列は固定し、見出しを押すとその項目で並べ替える
const BAT_COLS = [
  { k: 'avg', v: (s, m) => m.ba, f: fmtAvg },
  { k: 'g', v: (s) => s.g },
  { k: 'pa', v: (s) => s.pa },
  { k: 'ab', v: (s) => s.ab },
  { k: 'runs', v: (s) => s.runs },
  { k: 'h', v: (s) => s.h },
  { k: 'double', v: (s) => s.double },
  { k: 'triple', v: (s) => s.triple },
  { k: 'hr', v: (s) => s.hr },
  { k: 'tb', v: (s) => s.tb },
  { k: 'rbi', v: (s) => s.rbi },
  { k: 'sb', v: (s) => s.sb },
  { k: 'cs', v: (s) => s.cs },
  { k: 'sac', v: (s) => s.sacBunt || 0 },
  { k: 'sf', v: (s) => s.sacFly || 0 },
  { k: 'bb', v: (s) => s.bb },
  { k: 'hbp', v: (s) => s.hbp },
  { k: 'so', v: (s) => s.so },
  { k: 'gidp', v: (s) => s.gidp || 0 },
  { k: 'obp', v: (s, m) => m.obp, f: fmtAvg },
  { k: 'slg', v: (s, m) => m.slg, f: fmtAvg },
  { k: 'ops', v: (s, m) => m.ops, f: (x) => (x === null ? '-' : x.toFixed(3)) },
];
function BattingSummaryTable({ batting, nameOf, onOpenPlayer, tenureOf }) {
  const t = useT();
  const [sortKey, setSortKey] = useState('h');
  const col = BAT_COLS.find((c) => c.k === sortKey) || BAT_COLS[5];
  const rows = Object.values(batting)
    .filter((s) => s.pa > 0)
    .map((s) => ({ s, m: battingMetrics(s) }))
    .sort((a, b) => ((col.v(b.s, b.m) ?? -1) - (col.v(a.s, a.m) ?? -1)) || (b.s.pa - a.s.pa));
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h2>{t('stats.battingTable')}</h2>
      <p className="small dim" style={{ marginTop: 0 }}>{t('stats.batTableHint')}</p>
      <div className="bat-full-wrap">
        <table className="rank-table bat-full">
          <thead>
            <tr>
              <th>{t('stats.player')}</th>
              {BAT_COLS.map((c) => (
                <th key={c.k} className={c.k === sortKey ? 'on' : ''} onClick={() => setSortKey(c.k)} role="button">
                  {t(`stats.bcol.${c.k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, m }) => (
              <tr key={s.playerId} onClick={() => onOpenPlayer?.(s.playerId)} role="button">
                <td className="bat-name">
                  {nameOf(s.playerId)}
                  {tenureOf?.(s.playerId) && <span className="tenure">{tenureOf(s.playerId)}</span>}
                </td>
                {BAT_COLS.map((c) => {
                  const x = c.v(s, m);
                  return <td key={c.k} className={`num${c.k === sortKey ? ' on' : ''}`}>{c.f ? c.f(x ?? null) : (x ?? 0)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 守備の記録。打った・投げたは残るのに、守った記録が選手に付いていなかった。
// ファインプレーと失策は「守備がふつうではなかった」の裏表なので並べて出す。
// 押した回数そのものなので、率にはしない(分母になる「守備機会」を持っていない)。
function FieldingSummaryTable({ rows, nameOf, onOpenPlayer, tenureOf }) {
  const t = useT();
  // 誰も押していない = この機能をまだ使っていない。空の表は出さない
  if (!rows?.length) return null;
  return (
    <div className="card">
      <h2>{t('stats.fieldingTable')}</h2>
      <p className="small dim" style={{ marginTop: -4 }}>{t('stats.fieldingNote')}</p>
      <table className="rank-table">
        <thead>
          <tr>
            <th>{t('stats.col.fielder')}</th>
            <th className="num">{t('stats.col.fine')}</th>
            <th className="num">{t('stats.col.e')}</th>
            <th className="num">{t('stats.col.g')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.playerId} onClick={() => onOpenPlayer?.(s.playerId)} role="button">
              <td style={{ color: 'var(--accent)', fontWeight: 700 }}>
                {nameOf(s.playerId)}
                {tenureOf?.(s.playerId) && <span className="tenure">{tenureOf(s.playerId)}</span>}
              </td>
              <td className="num"><b>{s.fine ? `✦${s.fine}` : '—'}</b></td>
              <td className="num">{s.errors || '—'}</td>
              <td className="num">{s.games}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 全員の投手成績一覧。打撃成績一覧と同じく全項目を出し、名前の列を固定・見出しで並べ替え
const f2 = (x) => (x === null || x === undefined ? '-' : x.toFixed(2));
const PIT_COLS = [
  { k: 'era', v: (s, m) => m.era, f: f2, asc: true },
  { k: 'g', v: (s) => s.games },
  { k: 'w', v: (s) => s.wins },
  { k: 'sv', v: (s) => s.saves },
  { k: 'hld', v: (s) => s.holds },
  { k: 'ip', v: (s) => s.outsRecorded, f: (x) => formatIP(x || 0) },
  // 相手の打席を記録していない試合しかない投手は、0ではなく「-」(数えていないだけ)
  { k: 'bf', v: (s) => (s.bf ? s.bf : null), f: (x) => (x === null ? '-' : x) },
  { k: 'np', v: (s) => s.pitches },
  { k: 'ha', v: (s) => s.hitsAllowed },
  { k: 'hra', v: (s) => (s.bf ? (s.hrAllowed || 0) : null), f: (x) => (x === null ? '-' : x) },
  { k: 'k', v: (s) => s.strikeouts },
  { k: 'bb', v: (s) => s.walks },
  { k: 'hbp', v: (s) => s.hitByPitch },
  { k: 'r', v: (s) => s.runs },
  { k: 'er', v: (s) => s.earnedRuns },
  { k: 'whip', v: (s, m) => m.whip, f: f2, asc: true },
  { k: 'oba', v: (s, m) => m.oba, f: fmtAvg, asc: true },
  { k: 'k7', v: (s, m) => m.k7, f: f2 },
  { k: 'kbb', v: (s, m) => m.kbb, f: f2 },
];
function PitchingSummaryTable({ pitching, nameOf, onOpenPlayer, tenureOf, basis, lang }) {
  const t = useT();
  const [sortKey, setSortKey] = useState('ip');
  const col = PIT_COLS.find((c) => c.k === sortKey) || PIT_COLS[5];
  const val = (r) => col.v(r.s, r.m);
  const rows = Object.values(pitching)
    .filter((s) => s.outsRecorded > 0 || s.games > 0)
    .map((s) => ({ s, m: pitchingMetrics(s, basis, lang) }))
    .sort((a, b) => {
      const x = val(a); const y = val(b);
      // 率が出ない(投球回0)人は、並べ方にかかわらず下へ
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (col.asc ? x - y : y - x) || (b.s.outsRecorded - a.s.outsRecorded);
    });
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h2>{t('stats.pitchingTable')}</h2>
      <p className="small dim" style={{ marginTop: 0 }}>{t('stats.batTableHint')}</p>
      <div className="bat-full-wrap">
        <table className="rank-table bat-full">
          <thead>
            <tr>
              <th>{t('stats.col.pitcher')}</th>
              {PIT_COLS.map((c) => (
                <th key={c.k} className={c.k === sortKey ? 'on' : ''} onClick={() => setSortKey(c.k)} role="button">
                  {t(`stats.pcol.${c.k}`, { basis })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, m }) => (
              <tr key={s.playerId} onClick={() => onOpenPlayer?.(s.playerId)} role="button">
                <td className="bat-name">
                  {nameOf(s.playerId)}
                  {tenureOf?.(s.playerId) && <span className="tenure">{tenureOf(s.playerId)}</span>}
                </td>
                {PIT_COLS.map((c) => {
                  const x = c.v(s, m);
                  return <td key={c.k} className={`num${c.k === sortKey ? ' on' : ''}`}>{c.f ? c.f(x ?? null) : (x ?? 0)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small dim mt8">{t('stats.pitTableNote', { basis })}</p>
    </div>
  );
}

import React, { useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { aggregateBatting, aggregatePitching } from '../lib/stats.js';
import { isArchived } from '../lib/year.js';
import { teamSalaries, formatSalary, clampTop, SALARY_TOP_DEFAULT, SALARY_TOP_MAX } from '../lib/salary.js';

// 推定年俸は、そのチームの全試合の成績から出す(名鑑とランキングで同じ数字にするため)
export function useTeamSalaries() {
  const { state } = useStore();
  const games = useMemo(() => Object.values(state.games), [state.games]);
  const batting = useMemo(() => aggregateBatting(games), [games]);
  const pitching = useMemo(() => aggregatePitching(games), [games]);
  const top = clampTop(state.settings.salaryTopOku ?? SALARY_TOP_DEFAULT);
  const players = useMemo(() => state.players.filter((p) => !isArchived(p)), [state.players]);
  return { rows: useMemo(() => teamSalaries(players, batting, pitching, top), [players, batting, pitching, top]), top };
}

const PRESETS = [1, 3, 5, 10, 30, 100];

// 成績タブの下のほうに、たたんで置く「チーム推定年俸ランキング」
export default function SalaryRanking({ nameOf, onOpenPlayer }) {
  const { state, dispatch } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const { rows, top } = useTeamSalaries();
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.man, 0);
  const setTop = (v) => dispatch({ type: 'UPDATE_SETTINGS', patch: { salaryTopOku: clampTop(v) } });
  return (
    <details className="card salary-card">
      <summary><b>{t('salary.rankTitle')}</b> <span className="small dim">{t('salary.total', { total: formatSalary(total, lang) })}</span></summary>
      <table className="mt8">
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} onClick={() => onOpenPlayer?.(r.playerId)} style={{ cursor: onOpenPlayer ? 'pointer' : undefined }}>
              <td className="num" style={{ width: 28 }}>{r.rank}</td>
              <td>{nameOf(r.playerId)}<div className="dim small">{t('salary.points', { pt: r.points })}</div></td>
              <td className="num"><b>{formatSalary(r.man, lang)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt12">
        <label className="small"><b>{t('salary.topLabel')}</b></label>
        <div className="flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="number" min="0.1" max={SALARY_TOP_MAX} step="0.1" style={{ width: 90 }}
            value={top} onChange={(e) => e.target.value !== '' && setTop(e.target.value)}
            aria-label={t('salary.topLabel')}
          />
          <span className="small">{t('salary.okuUnit')}</span>
          {PRESETS.map((v) => (
            <button key={v} type="button" className={`small ${top === v ? 'primary' : ''}`} onClick={() => setTop(v)}>{t('salary.preset', { v })}</button>
          ))}
        </div>
      </div>
      <p className="small dim mt8">{t('salary.how')}</p>
    </details>
  );
}

// 名鑑に出す「推定年俸」。選手として登録されていない人(マネージャー等)には出さない
export function SalaryBadge({ playerId }) {
  const { state } = useStore();
  const t = useT();
  const lang = state.settings.lang || 'ja';
  const { rows } = useTeamSalaries();
  const r = rows.find((x) => x.playerId === playerId);
  if (!r) return null;
  return (
    <div className="scout-salary">
      <span>{t('salary.label')}</span> <b>{formatSalary(r.man, lang)}</b>
      <span className="small"> {t('salary.rankOf', { rank: r.rank, n: rows.length })}</span>
    </div>
  );
}

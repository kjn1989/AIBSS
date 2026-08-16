import React, { useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildRunExpectancy, reOf, stateKey, SHRINK_K } from '../lib/flow.js';
import Sheet from './Sheet.jsx';

// ---- 期待得点・期待失点の解説 ----
// 「防いだ失点」も「得点貢献」も「試合の流れ」も、全部この24通りの表から出ている。
// 表を見せずに数字だけ出すと、当たっているのかどうかを誰も確かめられない。
// だから表そのものを画面に置く。自分たちの記録から作った値なので、
// 「うちのチームは無死一塁からこれくらい」が読める。

// 走者の並びは「塁が進むほど下」。8通り × 3アウト = 24通り
export const RUNNER_ROWS = [
  { key: '000', runners: { 1: false, 2: false, 3: false } },
  { key: '100', runners: { 1: true, 2: false, 3: false } },
  { key: '010', runners: { 1: false, 2: true, 3: false } },
  { key: '001', runners: { 1: false, 2: false, 3: true } },
  { key: '110', runners: { 1: true, 2: true, 3: false } },
  { key: '101', runners: { 1: true, 2: false, 3: true } },
  { key: '011', runners: { 1: false, 2: true, 3: true } },
  { key: '111', runners: { 1: true, 2: true, 3: true } },
];

export default function ReTableSheet({ games, onClose }) {
  const { state } = useStore();
  const t = useT();
  const edition = state.settings.edition || '草野球';

  const { re, samples, total, ownShare } = useMemo(() => {
    const real = (games || Object.values(state.games || {}))
      .filter((g) => g && !String(g.id).startsWith('demo-'));
    return buildRunExpectancy(real, edition);
  }, [games, state.games, edition]);

  const val = (row, outs) => reOf(re, stateKey(row.runners, outs));
  const n = (row, outs) => samples.get(stateKey(row.runners, outs)) || 0;

  // 例は表の実値から作る(文章だけ固定値にすると、表と食い違ったときに気づけない)
  const empty0 = val(RUNNER_ROWS[0], 0);
  const first0 = val(RUNNER_ROWS[1], 0);
  const first1 = val(RUNNER_ROWS[1], 1);

  return (
    <Sheet title={t('ret.title')} onClose={onClose}>
      <p className="small">{t('ret.what')}</p>
      <p className="small dim">{t('ret.what2', { v: empty0.toFixed(2) })}</p>

      <div className="section-title">{t('ret.tableTitle')}</div>
      <p className="small dim" style={{ marginTop: -4 }}>{t('ret.tableNote')}</p>
      <div className="ret-wrap">
        <table className="ret-table">
          <thead>
            <tr>
              <th>{t('ret.situation')}</th>
              <th className="num">{t('ret.out0')}</th>
              <th className="num">{t('ret.out1')}</th>
              <th className="num">{t('ret.out2')}</th>
            </tr>
          </thead>
          <tbody>
            {RUNNER_ROWS.map((row) => (
              <tr key={row.key}>
                <td className="ret-sit">{t(`ret.r.${row.key}`)}</td>
                {[0, 1, 2].map((o) => (
                  <td key={o} className="num">
                    <b>{val(row, o).toFixed(2)}</b>
                    <i>{t('ret.times', { n: n(row, o) })}</i>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">{t('ret.sameTitle')}</div>
      <p className="small">{t('ret.same')}</p>

      <div className="section-title">{t('ret.useTitle')}</div>
      <p className="small">{t('ret.formula')}</p>
      {/* 例も表の実値から組む */}
      <div className="ret-ex">
        <div className="ret-ex-row">
          <span>{t('ret.ex1', { a: empty0.toFixed(2), b: first0.toFixed(2) })}</span>
          <b className="up">+{(first0 - empty0).toFixed(2)}</b>
        </div>
        <div className="ret-ex-row">
          <span>{t('ret.ex2', { a: first0.toFixed(2), b: first1.toFixed(2) })}</span>
          <b className="down">{(first1 - first0).toFixed(2).replace('-', '−')}</b>
        </div>
        <div className="ret-ex-row">
          <span>{t('ret.ex3', { a: empty0.toFixed(2) })}</span>
          <b className="up">+{empty0.toFixed(2)}</b>
        </div>
        <div className="ret-ex-row">
          <span>{t('ret.ex4', { a: empty0.toFixed(2) })}</span>
          <b className="down">{(empty0 - 1).toFixed(2).replace('-', '−')}</b>
        </div>
      </div>

      <div className="section-title">{t('ret.srcTitle')}</div>
      <p className="small dim">
        {t('ret.src', { n: total, pct: Math.round(ownShare * 100), k: SHRINK_K })}
      </p>
      {/* 数字は根拠が書いていないと嘘くさくなる。どこが実測でどこが借り物かを言い切る */}
      <div className="we-part warn">
        <div className="we-layer-head">
          <b>{t('ret.baseTitle')}</b>
          <span className="src-badge borrowed">{t('we.src.borrowed')}</span>
        </div>
        <p className="small dim">{t('ret.srcBase')}</p>
        <p className="small dim">{t('ret.srcKoshien2')}</p>
      </div>
      <p className="small dim mt8">{t('ret.srcTiebreak')}</p>

      <div className="sheet-actions">
        <button className="primary" style={{ width: '100%' }} onClick={onClose}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

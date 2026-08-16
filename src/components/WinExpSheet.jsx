import React, { useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildRunExpectancy, stateKey, SHRINK_K } from '../lib/flow.js';
import { buildRunDists, distOf, SCORE_PROB, MAX_RUNS, MAX_DIFF } from '../lib/winExp.js';
import { RUNNER_ROWS } from './ReTableSheet.jsx';
import Sheet from './Sheet.jsx';

// ---- 勝率の作り方の解説 ----
// 勝率は3段の上に乗っている。そのうち実測なのは1段だけで、残りは
// 借りてきた値と、こちらの設計上の選択。どれがどれかを画面で言わないと、
// 「勝率7%」がどこまで信じてよい数字なのか誰にも分からない。
//
// だからこのシートでは、出す数字に必ず出どころの札を付ける:
//   実測 … 自分たちの記録から数えたもの
//   土台 … 実測ではない借り物(記録が貯まれば薄まる)
//   選択 … こちらが決めた計算のやり方

function Badge({ kind, t }) {
  return <span className={`src-badge ${kind}`}>{t(`we.src.${kind}`)}</span>;
}

export default function WinExpSheet({ games, onClose }) {
  const { state } = useStore();
  const t = useT();
  const edition = state.settings.edition || '草野球';

  const { reOwn, distOwn, dists } = useMemo(() => {
    const real = (games || Object.values(state.games || {}))
      .filter((g) => g && !String(g.id).startsWith('demo-'));
    const { re, ownShare } = buildRunExpectancy(real, edition);
    const d = buildRunDists(real, edition, re);
    return { reOwn: ownShare, distOwn: d.ownShare, dists: d.dists };
  }, [games, state.games, edition]);

  const empty0 = distOf(dists, '000|0');
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  // 5点以上はまとめる(1つずつ出しても読めない)
  const tail = empty0.slice(5).reduce((a, b) => a + b, 0);
  const mean = empty0.reduce((a, b, k) => a + b * k, 0);

  return (
    <Sheet title={t('we.title')} onClose={onClose}>
      <p className="small">{t('we.what')}</p>

      {/* ---- 3段の構造。どれが実測でどれが借り物かを最初に言う ---- */}
      <div className="section-title">{t('we.layersTitle')}</div>
      <div className="we-layer">
        <div className="we-layer-head"><b>{t('we.l1')}</b><Badge kind="mixed" t={t} /></div>
        <p className="small dim">{t('we.l1d')}</p>
      </div>
      <div className="we-layer">
        <div className="we-layer-head"><b>{t('we.l2')}</b><Badge kind="calc" t={t} /></div>
        <p className="small dim">{t('we.l2d')}</p>
      </div>
      <div className="we-layer">
        <div className="we-layer-head"><b>{t('we.l3')}</b><Badge kind="rule" t={t} /></div>
        <p className="small dim">{t('we.l3d')}</p>
      </div>

      {/* ---- ①の中身を分解する ---- */}
      <div className="section-title">{t('we.insideTitle')}</div>
      <div className="we-part">
        <div className="we-layer-head"><b>{t('we.p1')}</b><Badge kind="measured" t={t} /></div>
        <p className="small dim">{t('we.p1d', { pct: Math.round(reOwn * 100) })}</p>
      </div>
      <div className="we-part warn">
        <div className="we-layer-head"><b>{t('we.p2')}</b><Badge kind="borrowed" t={t} /></div>
        <p className="small dim">{t('we.p2d')}</p>
      </div>
      <div className="we-part warn">
        <div className="we-layer-head"><b>{t('we.p3')}</b><Badge kind="chosen" t={t} /></div>
        <p className="small dim">{t('we.p3d')}</p>
      </div>
      <div className="we-part">
        <div className="we-layer-head"><b>{t('we.p4')}</b><Badge kind="measured" t={t} /></div>
        <p className="small dim">{t('we.p4d', { pct: Math.round(distOwn * 100), k: SHRINK_K })}</p>
      </div>

      {/* ---- 借り物の表そのものを出す ---- */}
      <div className="section-title">{t('we.probTitle')}</div>
      <p className="small dim" style={{ marginTop: -4 }}>{t('we.probNote')}</p>
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
                    <b>{Math.round((SCORE_PROB[stateKey(row.runners, o)] ?? 0) * 100)}%</b>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- いま実際に使われている分布 ---- */}
      <div className="section-title">{t('we.distTitle')}</div>
      <p className="small dim" style={{ marginTop: -4 }}>{t('we.distNote')}</p>
      <div className="we-dist">
        {[0, 1, 2, 3, 4].map((k) => (
          <div className="we-dist-row" key={k}>
            <span>{t('we.runsK', { k })}</span>
            <i style={{ width: `${Math.min(100, empty0[k] * 100)}%` }} />
            <b>{pct(empty0[k])}</b>
          </div>
        ))}
        <div className="we-dist-row">
          <span>{t('we.runs5')}</span>
          <i style={{ width: `${Math.min(100, tail * 100)}%` }} />
          <b>{pct(tail)}</b>
        </div>
      </div>
      <p className="small dim mt8">{t('we.distMean', { v: mean.toFixed(3) })}</p>

      {/* ---- 手で検算できる例 ---- */}
      <div className="section-title">{t('we.checkTitle')}</div>
      <p className="small">{t('we.checkLead')}</p>
      <div className="ret-ex">
        <div className="ret-ex-row">
          <span>{t('we.check1', { p0: pct(empty0[0]) })}</span>
          <b>{(empty0[0] * 0.5).toFixed(4)}</b>
        </div>
        <div className="ret-ex-row">
          <span>{t('we.check2', { p0: pct(empty0[0]), p1: pct(empty0[1]) })}</span>
          <b>{(empty0[0] + empty0[1] * 0.5).toFixed(4)}</b>
        </div>
      </div>

      {/* ---- していないこと ---- */}
      <div className="section-title">{t('we.limitTitle')}</div>
      <ul className="we-limits">
        <li>{t('we.limit1')}</li>
        <li>{t('we.limit2')}</li>
        <li>{t('we.limit3')}</li>
        <li>{t('we.limit4', { runs: MAX_RUNS, diff: MAX_DIFF })}</li>
      </ul>

      <div className="sheet-actions">
        <button className="primary" style={{ width: '100%' }} onClick={onClose}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

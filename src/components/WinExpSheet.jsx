import React, { useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildRunExpectancy, stateKey, SHRINK_K } from '../lib/flow.js';
import { buildRunDists, distOf, buildWinModel, SCORE_PROB, MAX_RUNS, MAX_DIFF } from '../lib/winExp.js';
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

  // ---- Σ を手で追えるようにする ----
  // 式だけ見せても伝わらない。実際の確率で1行ずつ掛けて足し、最後にモデルの
  // 答えと突き合わせる。数字を書き込まずその場で計算するので、記録が貯まって
  // 分布が変われば、この例の数字も一緒に動く(食い違いようがない)。
  const sigma = useMemo(() => {
    const term = (x) => (x > 0 ? 1 : x === 0 ? 0.5 : 0);
    // 表を短く保つため、この点数以上はまとめる。
    // まとめた行の勝率は、確率で重み付けした平均にする。4点のときの勝率で
    // 代表させると、5点以上のぶんを取りこぼして合計がモデルとズレる
    const CAP = 4;
    const lump = (k) => (k === CAP ? empty0.slice(CAP).reduce((a, b) => a + b, 0) : empty0[k]);
    const lumpW = (wOf) => {
      let p = 0;
      let pw = 0;
      for (let k = CAP; k < empty0.length; k += 1) { p += empty0[k]; pw += empty0[k] * wOf(k); }
      return p > 0 ? pw / p : wOf(CAP);
    };
    // 例1: 最終回の裏、1点ビハインドの攻撃。点数から勝ち負けが直に決まる
    const ex1 = [];
    let sum1 = 0;
    for (let k = 0; k <= CAP; k += 1) {
      const p = lump(k);
      const w = k === CAP ? lumpW((j) => term(-1 + j)) : term(-1 + k);
      sum1 += p * w;
      ex1.push({ k, p, w, diff: -1 + k, mul: p * w });
    }
    // 例2: 最終回の表。勝ち負けの代わりに「そのあとの半回を畳んだ値」を入れる
    const after = (diff) => {
      let s2 = 0;
      for (let j = 0; j < empty0.length; j += 1) s2 += empty0[j] * term(diff - j);
      return s2;
    };
    const ex2 = [];
    let sum2 = 0;
    for (let k = 0; k <= CAP; k += 1) {
      const p = lump(k);
      const w = k === CAP ? lumpW(after) : after(k);
      sum2 += p * w;
      ex2.push({ k, p, w, mul: p * w });
    }
    // モデルの答えと突き合わせる。ズレたらどちらかが壊れている
    const homeWe = buildWinModel({ dists, isHome: true, regulation: 7, halfStartKey: () => '000|0' });
    const awayWe = buildWinModel({ dists, isHome: false, regulation: 7, halfStartKey: () => '000|0' });
    const none = { 1: false, 2: false, 3: false };
    return {
      cap: CAP, ex1, sum1, ex2, sum2,
      model1: homeWe({ inning: 7, isTop: false, runners: none, outs: 0, diff: -1 }),
      model2: awayWe({ inning: 7, isTop: true, runners: none, outs: 0, diff: 0 }),
      ladder: [0, 1, 2, 3].map((d) => ({ d, w: after(d) })),
    };
  }, [dists, empty0]);
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

      {/* ---- Σ を1行ずつ追う ---- */}
      <div className="section-title">{t('we.sigmaTitle')}</div>
      <p className="small">{t('we.sigmaLead')}</p>

      <div className="we-part">
        <b className="small">{t('we.sigmaEx1')}</b>
        <p className="small dim">{t('we.sigmaEx1Lead')}</p>
        <div className="ret-wrap">
          <table className="sig-table">
            <thead>
              <tr>
                <th>{t('we.sig.k')}</th>
                <th className="num">{t('we.sig.p')}</th>
                <th>{t('we.sig.res')}</th>
                <th className="num">{t('we.sig.w')}</th>
                <th className="num">{t('we.sig.mul')}</th>
              </tr>
            </thead>
            <tbody>
              {sigma.ex1.map((r) => (
                <tr key={r.k}>
                  <td>{r.k === sigma.cap ? t('we.sig.kPlus', { k: r.k }) : t('we.runsK', { k: r.k })}</td>
                  <td className="num">{pct(r.p)}</td>
                  <td>{t(r.diff > 0 ? 'we.sig.win' : r.diff === 0 ? 'we.sig.tie' : 'we.sig.lose')}</td>
                  <td className="num">{r.w.toFixed(1)}</td>
                  <td className="num">{pct(r.mul)}</td>
                </tr>
              ))}
              <tr className="sig-sum">
                <td colSpan={4}><b>{t('we.sig.sum')}</b></td>
                <td className="num"><b>{pct(sigma.sum1)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small dim mt8">{t('we.sigmaCheck', { v: pct(sigma.model1) })}</p>
      </div>

      <div className="we-part">
        <b className="small">{t('we.sigmaPm')}</b>
        <p className="small dim">{t('we.sigmaPmText')}</p>
      </div>

      <div className="we-part">
        <b className="small">{t('we.sigmaEx2')}</b>
        <p className="small dim">{t('we.sigmaEx2Lead')}</p>
        <div className="ret-ex">
          {sigma.ladder.map((r) => (
            <div className="ret-ex-row" key={r.d}>
              <span>{t('we.sig.diff', { d: r.d === 0 ? '±0' : `+${r.d}` })}</span>
              <b>{pct(r.w)}</b>
            </div>
          ))}
        </div>
        <div className="ret-wrap mt8">
          <table className="sig-table">
            <thead>
              <tr>
                <th>{t('we.sig.k')}</th>
                <th className="num">{t('we.sig.p')}</th>
                <th className="num">{t('we.sig.then')}</th>
                <th className="num">{t('we.sig.mul')}</th>
              </tr>
            </thead>
            <tbody>
              {sigma.ex2.map((r) => (
                <tr key={r.k}>
                  <td>{r.k === sigma.cap ? t('we.sig.kPlus', { k: r.k }) : t('we.runsK', { k: r.k })}</td>
                  <td className="num">{pct(r.p)}</td>
                  <td className="num">{pct(r.w)}</td>
                  <td className="num">{pct(r.mul)}</td>
                </tr>
              ))}
              <tr className="sig-sum">
                <td colSpan={3}><b>{t('we.sig.sum')}</b></td>
                <td className="num"><b>{pct(sigma.sum2)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small dim mt8">{t('we.sigmaCheck', { v: pct(sigma.model2) })}</p>
        <p className="small dim">{t('we.sigmaEven')}</p>
      </div>

      <div className="we-part warn">
        <b className="small">{t('we.sigmaWhy')}</b>
        <p className="small dim">
          {t('we.sigmaWhyText', { p0: pct(empty0[0]), mean: mean.toFixed(3) })}
        </p>
      </div>

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

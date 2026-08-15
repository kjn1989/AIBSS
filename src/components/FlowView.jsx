import React, { useMemo } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildRunExpectancy, flowSeries, flowRuns, judgeFlowTags, formatRate, KOSHIEN_RE, KOSHIEN_SOURCE } from '../lib/flow.js';
import Sheet from './Sheet.jsx';

// ---- 試合の流れ ----
// 縦軸は点差ではなく「そこまでにどちらへどれだけ傾いたかの積み重ね」。
// 山と谷が、人が「流れが変わった」と言っている区間にあたる。
// スコアラーが押したタグ(▲▼)を同じ線の上に重ねるので、
// 「動く前に押せていたか」がそのまま目で見える。

// 目盛りの無い線は「なんとなく上がっている」以上のことを伝えない。
// 縦は点(得点期待値)、横は回。両方に数字を置く。
const W = 300;      // 線を描く幅
const H = 132;
const PADL = 34;    // 縦軸の数字を置く余白
const PADB = 16;    // 回のラベルを置く余白

function Chart({ series, tags, order, t, innLabel }) {
  if (!series.length) return null;
  const vals = series.map((s) => s.cum);
  const hi = Math.max(0.5, ...vals);
  const lo = Math.min(-0.5, ...vals);
  const span = hi - lo;
  const x = (i) => PADL + (series.length < 2 ? W / 2 : (i / (series.length - 1)) * W);
  const y = (v) => ((hi - v) / span) * H;
  const zero = y(0);

  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.cum).toFixed(1)}`).join('');
  const area = `${line}L${x(series.length - 1).toFixed(1)},${zero.toFixed(1)}L${x(0).toFixed(1)},${zero.toFixed(1)}Z`;

  const marks = tags.map((tg) => {
    const at = order.get(tg.id) ?? 0;
    let i = series.findIndex((s) => (order.get(s.id) ?? 0) > at);
    if (i < 0) i = series.length - 1;
    return { tg, i: Math.max(0, i) };
  });

  // 回の変わり目。ここが1つも無い試合は、回が進んでいない(アウトが記録されていない)
  const bounds = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i].inning !== series[i - 1].inning || series[i].isTop !== series[i - 1].isTop) {
      bounds.push({ i, s: series[i] });
    }
  }
  // 縦軸に置く数字。上端・0・下端の3つで足りるが、
  // 片側にしか振れていない試合では下端と0が重なるので、近すぎるものは省く
  const ticks = [hi, 0, lo].filter((v, i, a) => a.findIndex((u) => Math.abs(y(u) - y(v)) < 14) === i);

  return (
    <div className="fv-chart">
      <svg viewBox={`0 0 ${PADL + W + 6} ${H + PADB}`} width="100%" height="164"
        role="img" aria-label={t('fv.chartAlt')}>
        <defs>
          <linearGradient id="fvUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </linearGradient>
          <clipPath id="fvTop"><rect x="0" y="0" width={PADL + W + 6} height={zero} /></clipPath>
          <clipPath id="fvBot"><rect x="0" y={zero} width={PADL + W + 6} height={H - zero} /></clipPath>
        </defs>

        {/* 縦軸: 数字と目安の線 */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PADL} y1={y(v)} x2={PADL + W} y2={y(v)}
              stroke="var(--border)" strokeWidth="1" strokeDasharray={v === 0 ? '0' : '2 4'} />
            <text x={PADL - 5} y={y(v) + 3.5} fontSize="9" textAnchor="end"
              fill="var(--text-dim)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* 横軸: 回の変わり目 */}
        {bounds.map((b) => (
          <g key={b.i}>
            <line x1={x(b.i)} y1="0" x2={x(b.i)} y2={H} stroke="var(--border)" strokeWidth="1" />
            <text x={x(b.i)} y={H + 11} fontSize="8.5" textAnchor="middle" fill="var(--text-dim)">
              {b.s.inning}{b.s.isTop ? '表' : '裏'}
            </text>
          </g>
        ))}
        <text x={PADL} y={H + 11} fontSize="8.5" textAnchor="middle" fill="var(--text-dim)">
          {series[0].inning}{series[0].isTop ? '表' : '裏'}
        </text>

        <path d={area} fill="url(#fvUp)" clipPath="url(#fvTop)" />
        <path d={area} fill="var(--amber)" fillOpacity="0.18" clipPath="url(#fvBot)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
        {marks.map(({ tg, i }) => (
          <g key={tg.id}>
            <line x1={x(i)} y1={y(series[i].cum)} x2={x(i)} y2={tg.payload?.dir === 'down' ? H : 0}
              stroke={tg.payload?.dir === 'down' ? 'var(--amber)' : 'var(--green)'}
              strokeWidth="1" strokeOpacity="0.5" />
            <circle cx={x(i)} cy={y(series[i].cum)} r="3.5"
              fill={tg.payload?.dir === 'down' ? 'var(--amber)' : 'var(--green)'} />
          </g>
        ))}
      </svg>
      <div className="fv-axis">
        <span style={{ color: 'var(--green)' }}>{t('fv.toUs')}</span>
        <span className="fv-unit">{t('fv.unit')}</span>
        <span style={{ color: 'var(--amber)' }}>{t('fv.toThem')}</span>
      </div>
    </div>
  );
}

export default function FlowView({ game, onClose }) {
  const { state } = useStore();
  const t = useT();

  // 得点期待値は「自分たちの試合」から作る。相手の打席も材料になる。
  const edition = state.settings.edition || '草野球';
  const { re, total, ownShare } = useMemo(() => {
    const games = Object.values(state.games || {}).filter((g) => g && !String(g.id).startsWith('demo-'));
    return buildRunExpectancy(games.length ? games : [game], edition);
  }, [state.games, game, edition]);
  const usesKoshien = edition === 'ブカツ(中高大)';

  const series = useMemo(() => flowSeries(game, re), [game, re]);
  const judged = useMemo(() => judgeFlowTags(game, series), [game, series]);
  const swings = useMemo(() => flowRuns(series, 0.6).slice(0, 3), [series]);

  const order = useMemo(() => {
    const m = new Map();
    (game.playLogs || []).forEach((l, i) => m.set(l.id, i));
    return m;
  }, [game.playLogs]);

  const cum = series.length ? series[series.length - 1].cum : 0;
  const VD = { pre: t('fv.pre'), post: t('fv.post'), miss: t('fv.miss') };
  const innOf = (s) => t(s.isTop ? 'scoreboard.top' : 'scoreboard.bottom', { n: s.inning });
  // 全部の打席が同じ半回に入っている = 回が進んでいない
  const oneHalf = series.length > 0
    && series.every((s) => s.inning === series[0].inning && s.isTop === series[0].isTop);

  return (
    <Sheet title={t('fv.title')} onClose={onClose}>
      {series.length === 0 ? (
        <p className="small dim">{t('fv.empty')}</p>
      ) : (
        <>
          <p className="small dim" style={{ margin: '0 0 10px' }}>{t('fv.lead')}</p>
          <Chart series={series} tags={judged.tags} order={order} t={t} />
          {/* 回が1つも進んでいない = アウトが記録されていない。
              このとき線は必ず右肩上がりになり、流れとして読めない */}
          {oneHalf && series.length > 8 && (
            <div className="warn-box mt8">{t('fv.stuck', { inn: innOf(series[0]) })}</div>
          )}
          <div className="fv-now">
            <b style={{ color: cum >= 0 ? 'var(--green)' : 'var(--amber)' }}>
              {cum >= 0 ? t('fv.nowUs', { v: cum.toFixed(1) }) : t('fv.nowThem', { v: Math.abs(cum).toFixed(1) })}
            </b>
            <div className="small dim">{t('fv.nowNote')}</div>
          </div>

          {/* 人が「流れが変わった」と言うのは1本ではなく続いた区間。そこを言葉にする */}
          {swings.length > 0 && (
            <>
              <div className="section-title">{t('fv.swingTitle')}</div>
              <div className="fv-swings">
                {swings.map((sw) => (
                  <div className={`fv-swing ${sw.dir > 0 ? 'up' : 'down'}`} key={sw.from.id}>
                    <b>{innOf(sw.from) === innOf(sw.to) ? innOf(sw.from) : `${innOf(sw.from)}〜${innOf(sw.to)}`}</b>
                    <span>{t(sw.dir > 0 ? 'fv.swingUs' : 'fv.swingThem', { n: sw.n, v: Math.abs(sw.swing).toFixed(1) })}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 答え合わせ。測るのは一致ではなく順番 */}
          <div className="section-title">{t('fv.checkTitle')}</div>
          {judged.tags.length === 0 ? (
            <p className="small dim" style={{ marginTop: -2 }}>{t('fv.noTags')}</p>
          ) : (
            <>
              <div className="fv-rates">
                <div className="fv-rate">
                  <b>{t('fv.hitRate')}</b>
                  <div className="v num">{formatRate(judged.hitRate)}</div>
                  <div className="n">{t('fv.hitRateNote', { a: judged.counts.pre, b: judged.tags.length })}</div>
                </div>
                <div className="fv-rate">
                  <b>{t('fv.catchRate')}</b>
                  <div className="v num">{formatRate(judged.catchRate)}</div>
                  <div className="n">{t('fv.catchRateNote', { a: judged.caught, b: judged.swings.length })}</div>
                </div>
              </div>
              <p className="small dim mt8">{t('fv.verdictNote')}</p>
              <p className="small dim">{t('fv.pairNote')}</p>
              <div className="fv-tags">
                {judged.tags.map((tg) => (
                  <div className={`fv-tag ${tg.payload?.dir === 'down' ? 'down' : 'up'}`} key={tg.id}>
                    <span className="tg">{tg.payload?.dir === 'down' ? '▼' : '▲'}</span>
                    <span className="wh">{t(tg.isTop ? 'scoreboard.top' : 'scoreboard.bottom', { n: tg.inning })}</span>
                    <span className="bd">{tg.text}</span>
                    <span className={`vd ${judged.verdict[tg.id]}`}>{VD[judged.verdict[tg.id]]}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="fv-src">
            <b>{t('fv.srcTitle')}</b>
            {total > 0
              ? t('fv.srcOwn', { n: total, pct: Math.round(ownShare * 100) })
              : t('fv.srcBase')}
            {usesKoshien && (
              <><br />{t('fv.srcKoshien', {
                n: KOSHIEN_SOURCE.states, data: KOSHIEN_SOURCE.data, where: KOSHIEN_SOURCE.where,
              })}</>
            )}
          </div>
        </>
      )}

      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

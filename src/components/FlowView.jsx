import React, { useMemo, useRef, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildRunExpectancy, weSeries, flowRuns, judgeFlowTags, formatRate, weShape, KOSHIEN_RE, KOSHIEN_SOURCE } from '../lib/flow.js';
import { buildRunDists } from '../lib/winExp.js';
import { buildGapModel } from '../lib/teamGap.js';
import { currentRules } from '../lib/rules.js';
import { halfStartKeyOf } from '../lib/tiebreak.js';
import { aggregateScorers, scorerName } from '../lib/scorers.js';
import ScorerPicker from './ScorerPicker.jsx';
import TeamGapPicker from './TeamGapPicker.jsx';
import HeatmapSheet from './HeatmapSheet.jsx';
import ReTableSheet from './ReTableSheet.jsx';
import WinExpSheet from './WinExpSheet.jsx';
import { computeBoxScore, hitsByInning } from '../lib/boxscore.js';
import Sheet from './Sheet.jsx';

// ---- 試合の流れ ----
// 縦軸は点差ではなく「そこまでにどちらへどれだけ傾いたかの積み重ね」。
// 山と谷が、人が「流れが変わった」と言っている区間にあたる。
// スコアラーが押したタグ(▲▼)を同じ線の上に重ねるので、
// 「動く前に押せていたか」がそのまま目で見える。

// 目盛りの無い線は「なんとなく上がっている」以上のことを伝えない。
// 縦は点(得点期待値)、横は回。両方に数字を置く。
// 線分スコアの列を、線の回の区切りにぴったり重ねるための座標。
// 表と線が同じ数字(PADL / W / PADR)を使うので、幅が食い違いようがない。
const W = 262;      // 線を描く幅
const H = 132;
const PADL = 44;    // 縦軸の数字・チーム名を置く左の余白
const PADR = 68;    // 計/H/E を置く右の余白
const PADB = 16;    // 回のラベルを置く余白
const VBW = PADL + W + PADR;   // viewBox の全幅。表の%換算もこれで割る
const pctOf = (u) => `${(u / VBW) * 100}%`;

// ---- 線に幅を合わせた線分スコア ----
// 回ごとの列幅を等分にすると、線(横軸は打席)とズレて「5回の列の下が線の5回ではない」
// 表になってしまう。そこで線を描くのに使った x() をそのまま列幅に使う。
// 打席が多かった回は列も広くなるので、落ちている位置とその回の失点が真下で揃う。
//
// cols … [{ inning, left, width }] いずれも viewBox 単位
function AlignedLinescore({ game, cols, t }) {
  const { state } = useStore();
  const box = computeBoxScore(game);
  const myName = state.settings.teamName || t('restab.teamFallback');
  const oppName = game.opponent || t('restab.opponentFallback');
  const away = game.isHome ? oppName : myName; // 先攻(表)
  const home = game.isHome ? myName : oppName;
  const initial = (n, fb) => (String(n || '').trim() ? Array.from(String(n).trim())[0] : fb);

  const byInning = new Map(box.innings.map((i) => [i.inning, i]));
  // 回別の安打数。スコアボードと同じ数え方・同じ置き方(得点の脇に小さく)にする
  const { my: myHits, opp: oppHits } = hitsByInning(game);
  // 線に出ていない回が線分スコアにあるなら、重ねると嘘になる。そのときは並べない
  const covered = cols.every((c) => byInning.has(c.inning));
  const extra = box.innings.some((i) => !cols.some((c) => c.inning === i.inning));
  if (!cols.length || !covered || extra) return null;

  const cell = (i, top) => {
    if (!i || !i.played) return '';
    const mine = top !== !!game.isHome;
    return mine ? i.my : i.opp;
  };
  const row = (label, full, top) => {
    const mine = top !== !!game.isHome;
    const hits = mine ? myHits : oppHits;
    return (
    <div className="fvls-row">
      <span className="fvls-team" style={{ width: pctOf(PADL) }} title={full}>
        {initial(full, '?')}
      </span>
      {cols.map((c) => (
        <span key={c.inning} className="fvls-cell" style={{ width: pctOf(c.width) }}>
          {/* 安打数の置き方はスコアボードと同じ。先攻は得点の上、後攻は下。
              無い回も行は取っておく(得点の位置が回ごとにブレない) */}
          {top && <i>{hits[c.inning] || '\u00a0'}</i>}
          <b>{cell(byInning.get(c.inning), top)}</b>
          {!top && <i>{hits[c.inning] || '\u00a0'}</i>}
        </span>
      ))}
      <span className="fvls-tot" style={{ width: pctOf(PADR) }}>
        <b>{mine ? box.my.r : box.opp.r}</b>
        <i>{mine ? box.my.h : box.opp.h}</i>
        <i>{mine ? box.my.e : box.opp.e}</i>
      </span>
    </div>
    );
  };

  return (
    <div className="fv-line-score" aria-label={t('fv.lsAlt')}>
      <div className="fvls-row head">
        <span className="fvls-team" style={{ width: pctOf(PADL) }} />
        {cols.map((c) => (
          <span key={c.inning} className="fvls-cell" style={{ width: pctOf(c.width) }}>{c.inning}</span>
        ))}
        <span className="fvls-tot" style={{ width: pctOf(PADR) }}>
          <b>{t('gp.total')}</b><i>{t('gp.h')}</i><i>{t('gp.e')}</i>
        </span>
      </div>
      {row('away', away, true)}
      {row('home', home, false)}
    </div>
  );
}

function Chart({ series, tags, order, t, linescore, opening }) {
  const svgRef = useRef(null);
  // 押した打席。線を見て「ここは何%?」と思ったときに読めるようにする
  const [sel, setSel] = useState(null);
  if (!series.length) return null;
  // 縦軸は勝率なので 0〜100% で固定する。試合ごとに目盛りが伸び縮みしないので、
  // 別の試合の線と同じ目で見られる
  const x = (i) => PADL + (series.length < 2 ? W / 2 : (i / (series.length - 1)) * W);
  const y = (v) => (1 - Math.max(0, Math.min(1, v))) * H;
  const half = y(0.5);

  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.we).toFixed(1)}`).join('');
  const area = `${line}L${x(series.length - 1).toFixed(1)},${half.toFixed(1)}L${x(0).toFixed(1)},${half.toFixed(1)}Z`;

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
      // 回の変わり目は下の線分スコアの区切りとつながるので、半回の区切りより濃く引く
      bounds.push({ i, s: series[i], newInning: series[i].inning !== series[i - 1].inning });
    }
  }
  const ticks = [1, 0.5, 0];

  // ---- 横軸のラベル ----
  // 延長までいくと半回は20を超える。全部に「10表」と書くと文字が重なって読めない。
  // まず半回すべてに間隔が取れるか見て、取れなければ回の頭(表)だけの数字に落とす。
  const halves = [{ i: 0, s: series[0] }, ...bounds];
  const spaced = (list, min) => {
    const out = [];
    let last = -Infinity;
    for (const c of list) {
      if (x(c.i) - last >= min) { out.push(c); last = x(c.i); }
    }
    return out;
  };
  // ---- 回ごとの列の位置と幅(線分スコアに渡す) ----
  // 回の左端は「その回の最初の打席」の x。線に引いてある区切り線と同じ位置になる。
  // 最後の回だけは線の右端まで伸ばす。
  const innStarts = [];
  for (let i = 0; i < series.length; i++) {
    if (!i || series[i].inning !== series[i - 1].inning) innStarts.push({ inning: series[i].inning, i });
  }
  const cols = innStarts.map((c, k) => {
    const left = x(c.i);
    const right = k + 1 < innStarts.length ? x(innStarts[k + 1].i) : PADL + W;
    return { inning: c.inning, left, width: Math.max(0, right - left) };
  });

  const halfText = (s) => `${s.inning}${s.isTop ? t('fv.axisTop') : t('fv.axisBottom')}`;
  const roomy = spaced(halves, 26);
  const xLabels = roomy.length === halves.length
    ? halves.map((c) => ({ i: c.i, text: halfText(c.s) }))
    : spaced(halves.filter((c) => c.s.isTop), 16).map((c) => ({ i: c.i, text: String(c.s.inning) }));
  const inningsOnly = xLabels.length !== halves.length;

  // 押した位置にいちばん近い打席を選ぶ(指で押すので、点の上ぴったりは狙えない)
  const pickAt = (clientX) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const ux = ((clientX - rect.left) / rect.width) * VBW;
    const ratio = series.length < 2 ? 0 : (ux - PADL) / W;
    const i = Math.round(ratio * (series.length - 1));
    setSel(Math.max(0, Math.min(series.length - 1, i)));
  };

  const cur = sel === null ? null : series[sel];
  const pct = (v) => `${Math.round(v * 100)}%`;

  return (
    <div className="fv-chart">
      <svg ref={svgRef} viewBox={`0 0 ${VBW} ${H + PADB}`} width="100%" height="164"
        role="img" aria-label={t('fv.chartAlt')} style={{ touchAction: 'none' }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); pickAt(e.clientX); }}
        onPointerMove={(e) => { if (e.buttons) pickAt(e.clientX); }}>
        <defs>
          <linearGradient id="fvUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </linearGradient>
          <clipPath id="fvTop"><rect x="0" y="0" width={VBW} height={half} /></clipPath>
          <clipPath id="fvBot"><rect x="0" y={half} width={VBW} height={H - half} /></clipPath>
        </defs>

        {/* 相手との力の差を入れた試合の開始時の水準。0-0でも35%から始まるので、
            この線が無いと「押されている」と読み違える。線より上なら予想を上回っている */}
        {opening != null && Math.abs(opening - 0.5) > 0.01 && (
          <g>
            <line x1={PADL} y1={y(opening)} x2={PADL + W} y2={y(opening)}
              stroke="var(--accent-2)" strokeWidth="1.2" strokeDasharray="5 3" opacity="0.85" />
            <text x={PADL + W} y={y(opening) - 3} fontSize="8" textAnchor="end"
              fill="var(--accent-2)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t('gap.startLine', { pct: Math.round(opening * 100) })}
            </text>
          </g>
        )}

        {/* 縦軸: 勝率。50%が互角の線 */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PADL} y1={y(v)} x2={PADL + W} y2={y(v)}
              stroke="var(--border)" strokeWidth="1" strokeDasharray={v === 0.5 ? '0' : '2 4'} />
            <text x={PADL - 5} y={y(v) + 3.5} fontSize="9" textAnchor="end"
              fill="var(--text-dim)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {pct(v)}
            </text>
          </g>
        ))}

        {/* 横軸: 回の変わり目。線は全部に引き、数字は重ならない分だけ置く */}
        {bounds.map((b) => (
          <line key={b.i} x1={x(b.i)} y1="0" x2={x(b.i)} y2={H}
            stroke="var(--border)" strokeWidth="1" strokeOpacity={b.newInning ? 1 : 0.45} />
        ))}
        {xLabels.map((c) => (
          <text key={c.i} x={x(c.i)} y={H + 11} fontSize="8.5" textAnchor="middle" fill="var(--text-dim)">
            {c.text}
          </text>
        ))}

        <path d={area} fill="url(#fvUp)" clipPath="url(#fvTop)" />
        <path d={area} fill="var(--amber)" fillOpacity="0.18" clipPath="url(#fvBot)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
        {marks.map(({ tg, i }) => (
          <g key={tg.id}>
            <line x1={x(i)} y1={y(series[i].we)} x2={x(i)} y2={tg.payload?.dir === 'down' ? H : 0}
              stroke={tg.payload?.dir === 'down' ? 'var(--amber)' : 'var(--green)'}
              strokeWidth="1" strokeOpacity="0.5" />
            <circle cx={x(i)} cy={y(series[i].we)} r="3.5"
              fill={tg.payload?.dir === 'down' ? 'var(--amber)' : 'var(--green)'} />
          </g>
        ))}

        {/* 押した打席 */}
        {cur && (
          <g pointerEvents="none">
            <line x1={x(sel)} y1="0" x2={x(sel)} y2={H} stroke="var(--text)" strokeWidth="1" strokeOpacity="0.55" />
            <circle cx={x(sel)} cy={y(cur.we)} r="5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {/* 線だけでは「何が起きて動いたのか」が分からない。見慣れた線分スコアを
          線のすぐ下に置くと、落ちている回とその回の失点が目で結びつく。
          回の区切り線が上下でつながって見えるよう、軸の説明より前に置く */}
      {linescore ? linescore(cols) : null}
      <div className="fv-axis">
        <span style={{ color: 'var(--green)' }}>{t('fv.toUs')}</span>
        <span className="fv-unit">{t('fv.unit')}</span>
        <span style={{ color: 'var(--amber)' }}>{t('fv.toThem')}</span>
      </div>
      {inningsOnly && <p className="small dim fv-axis-note">{t('fv.axisInningsOnly')}</p>}
      {cur ? (
        <div className="fv-read">
          <div className="fv-read-head">
            <b>{t(cur.isTop ? 'scoreboard.top' : 'scoreboard.bottom', { n: cur.inning })}</b>
            <span className="fv-read-text">{cur.log?.text || ''}</span>
          </div>
          {/* 「+8pt」だけでは何のことか分からない。引いた結果ではなく、
              引いた元(打席の前と後の勝率)をそのまま見せる */}
          <div className="fv-read-nums">
            <span className="fv-move">
              {t('fv.thisPa')}
              <b>{pct(cur.we - cur.delta)}</b>
              <i className={cur.delta >= 0 ? 'up' : 'down'}>→</i>
              <b className={cur.delta >= 0 ? 'up' : 'down'}>{pct(cur.we)}</b>
            </span>
          </div>
        </div>
      ) : (
        <p className="small dim fv-tap-hint">{t('fv.tapHint')}</p>
      )}
    </div>
  );
}

export default function FlowView({ game, onClose }) {
  const { state, dispatch } = useStore();
  const t = useT();
  // 線の土台になっている24通りの表そのものを、ここからも開けるようにする
  const [showRe, setShowRe] = useState(false);
  const [showWe, setShowWe] = useState(false);
  const [showHeat, setShowHeat] = useState(false);

  // 得点期待値は「自分たちの試合」から作る。相手の打席も材料になる。
  const edition = state.settings.edition || '草野球';
  const { re, total, ownShare } = useMemo(() => {
    const games = Object.values(state.games || {}).filter((g) => g && !String(g.id).startsWith('demo-'));
    return buildRunExpectancy(games.length ? games : [game], edition);
  }, [state.games, game, edition]);
  const usesKoshien = edition === 'ブカツ(中高大)';

  // 勝率モデル。得点分布も「自分たちの試合」から作る(相手の打席も材料になる)。
  // 相手との力の差を入れている試合は、その設定どおりの勝率から始まるように
  // 得点の倍率を解いたうえでモデルを作る(互角なら倍率1で、いままでと同じ)
  const { winExp, opening, factor } = useMemo(() => {
    const games = Object.values(state.games || {}).filter((g) => g && !String(g.id).startsWith('demo-'));
    const { dists } = buildRunDists(games.length ? games : [game], edition, re);
    const m = buildGapModel({
      dists,
      isHome: !!game.isHome,
      regulation: currentRules(game)?.innings || 7,
      halfStartKey: (inn) => halfStartKeyOf(game, inn),
      gap: game.teamGap || 'even',
    });
    return { winExp: m.we, opening: m.opening, factor: m.factor };
  }, [state.games, game, edition, re, game.teamGap]);

  // 線の縦軸は勝率。50%が互角で、基準線が動かない
  const series = useMemo(() => weSeries(game, winExp), [game, winExp]);
  // しきい値は勝率(0〜1)の単位。1本のヒットで5%前後動くので、
  // 「大きく動いた」は12%、「もう動いていた」は7%あたりに置く
  const judged = useMemo(() => judgeFlowTags(game, series, { minSwing: 0.12, reactSwing: 0.07 }), [game, series]);
  const swings = useMemo(() => flowRuns(series, 0.12).slice(0, 3), [series]);

  const order = useMemo(() => {
    const m = new Map();
    (game.playLogs || []).forEach((l, i) => m.set(l.id, i));
    return m;
  }, [game.playLogs]);

  // その記録員のここまでの実績(この試合だけでは読みの当たり外れは分からない)
  const career = useMemo(() => {
    if (!game.scorerId) return null;
    const games = Object.values(state.games || {}).filter((g) => g && !String(g.id).startsWith('demo-'));
    return aggregateScorers(games, winExp)[game.scorerId] || null;
  }, [state.games, game.scorerId, winExp]);

  const shape = useMemo(() => weShape(series), [series]);
  const over = game.status === 'finished';
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
          <Chart
            series={series} tags={judged.tags} order={order} t={t}
            linescore={(cols) => <AlignedLinescore game={game} cols={cols} t={t} />}
            opening={opening}
          />
          {/* 相手との力の差。ここで変えると線の出発点がその場で動くので、
              設定が効いているかがその場で分かる */}
          <div className="fv-scorer fv-gap mt8">
            <span className="small dim">{t('gap.label')}</span>
            <TeamGapPicker
              compact
              value={game.teamGap || 'even'}
              onChange={(id) => dispatch({ type: 'SET_TEAM_GAP', gameId: game.id, gap: id })}
            />
            {(game.teamGap || 'even') !== 'even' && (
              <p className="small dim mt8">
                {t('gap.applied', {
                  name: t(`gap.${game.teamGap}`),
                  pct: Math.round(opening * 100),
                  f: factor.toFixed(3),
                })}
              </p>
            )}
            <button className="small mt8" style={{ width: '100%' }} onClick={() => setShowHeat(true)}>
              {t('hm.open')}
            </button>
          </div>
          {/* 回が1つも進んでいない = アウトが記録されていない。
              このとき線は必ず右肩上がりになり、流れとして読めない */}
          {oneHalf && series.length > 8 && (
            <div className="warn-box mt8">{t('fv.stuck', { inn: innOf(series[0]) })}</div>
          )}
          {/* 線の終値は出さない。半回ごとにデルタが打ち消し合うので、回の切れ目では
              積み上げ値は「そのときの点差」と同じ値になる。終値を見出しに出しても、
              すぐ上のスコアボードを分かりにくい単位で言い直しているだけになる。
              スコアボードに書いていないのは「どちらに傾いていた時間が長いか」と
              「どこが底で、どこまで押し返したか」なので、そこを言う */}
          {shape && (
            <div className="fv-now">
              <div className="fv-peaks">
                <span>{t('fv.lowPoint', { inn: innOf(shape.lowest), v: Math.round(shape.lowest.we * 100) })}</span>
                <span>{t('fv.highPoint', { inn: innOf(shape.highest), v: Math.round(shape.highest.we * 100) })}</span>
              </div>
              {/* 割合は点差だけで決まるので、どちらが先攻でも偏らない。
                  勝率のほうは後攻が最後に打つぶん同点でも50%を割るので、割合には使わない。
                  すぐ上に勝率(%)が並ぶので、この%が何の割合かを見出しと実数で必ず示す */}
              <div className="section-title fv-lead-title">{t('fv.leadTitle', { n: shape.n })}</div>
              <div className="fv-lead">
                <span>
                  <i>{t('fv.leadAhead')}</i>
                  <b className="up">{shape.aheadPct}%</b>
                  <u>{t('fv.leadPa', { n: shape.ahead })}</u>
                </span>
                <span>
                  <i>{t('fv.leadTied')}</i>
                  <b>{shape.tiedPct}%</b>
                  <u>{t('fv.leadPa', { n: shape.tied })}</u>
                </span>
                <span>
                  <i>{t('fv.leadBehind')}</i>
                  <b className="down">{shape.behindPct}%</b>
                  <u>{t('fv.leadPa', { n: shape.behind })}</u>
                </span>
              </div>
              <div className="small dim">{t('fv.leadNote')}</div>
            </div>
          )}

          {/* 人が「流れが変わった」と言うのは1本ではなく続いた区間。そこを言葉にする */}
          {swings.length > 0 && (
            <>
              <div className="section-title">{t('fv.swingTitle')}</div>
              <div className="fv-swings">
                {swings.map((sw) => (
                  <div className={`fv-swing ${sw.dir > 0 ? 'up' : 'down'}`} key={sw.from.id}>
                    <b>{innOf(sw.from) === innOf(sw.to) ? innOf(sw.from) : `${innOf(sw.from)}〜${innOf(sw.to)}`}</b>
                    <span>{t('fv.swingRange', {
                      n: sw.n,
                      a: Math.round((sw.from.we - sw.from.delta) * 100),
                      b: Math.round(sw.to.we * 100),
                    })}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 答え合わせ。測るのは一致ではなく順番 */}
          <div className="section-title">{t('fv.checkTitle')}</div>
          {/* 流れタグは記録員の読みそのもの。誰の読みかが分からないと、
              当たったのか外したのかが個人の実績として積み上がらない */}
          <div className="fv-scorer">
            <span className="small dim">{t('scorer.label')}</span>
            <ScorerPicker
              compact
              value={game.scorerId || null}
              onChange={(id) => dispatch({ type: 'SET_GAME_SCORER', gameId: game.id, scorerId: id })}
            />
            {career && career.tags > 0 && (
              <p className="small dim mt8">
                {t('scorer.career', {
                  name: scorerName(state.settings, game.scorerId),
                  n: career.tags,
                  hit: formatRate(career.hitRate),
                  catch: formatRate(career.catchRate),
                })}
              </p>
            )}
          </div>
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
            <button className="small mt8" style={{ width: '100%' }} onClick={() => setShowWe(true)}>
              {t('we.open')}
            </button>
            <button className="small mt8" style={{ width: '100%' }} onClick={() => setShowRe(true)}>
              {t('ret.open')}
            </button>
          </div>
        </>
      )}

      {showRe && <ReTableSheet onClose={() => setShowRe(false)} />}
      {showWe && <WinExpSheet onClose={() => setShowWe(false)} />}
      {showHeat && <HeatmapSheet game={game} onClose={() => setShowHeat(false)} />}

      <div className="sheet-actions">
        <button className="primary" onClick={onClose}>{t('action.close')}</button>
      </div>
    </Sheet>
  );
}

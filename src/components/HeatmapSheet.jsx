import React, { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildRunExpectancy, stateKey, SHRINK_K, LEVEL_K } from '../lib/flow.js';
import { buildRunDists } from '../lib/winExp.js';
import { currentRules } from '../lib/rules.js';
import { halfStartKeyOf } from '../lib/tiebreak.js';
import { buildGapModel, gapTables, gapOf } from '../lib/teamGap.js';
import { KOSHIEN_LEVEL } from '../lib/flow.js';
import ReTableSheet from './ReTableSheet.jsx';
import { RUNNER_ROWS } from './ReTableSheet.jsx';
import Sheet from './Sheet.jsx';

// ---- 24通りをヒートマップで ----
// 表の数字を縦に読むのは訓練が要る。色にすると「どこが重い場面か」が一目で入る。
// チーム差を入れると攻撃時と守備時で表が分かれるので、2枚をタブで切り替える。
//
// 色は得点期待値そのものに対応させる(0点=青 → 満塁級=赤)。
// 物差しは攻撃時と守備時で必ず共通にする。別々にすると「守備のほうが赤い」が
// 力の差なのか色の付け方なのか分からなくなる。
//
// 上限を2.6に固定していたら、「胸を借りる」(倍率2.49)の試合で守備時の24マス中
// 8マスが上限を振り切り、全部おなじ真っ赤になって読めなくなっていた。
// 2枚のうち大きいほうの最大値から決める。
const MIN_TOP = 2.6;
const topOf = (off, def) =>
  Math.max(MIN_TOP, ...[...off.values(), ...def.values()]);

function heat(v, top) {
  const x = Math.max(0, Math.min(1, v / top));
  // 青(220) → 緑(120) → 黄(60) → 赤(0)
  const hue = 220 - 220 * Math.pow(x, 0.85);
  return `hsl(${hue.toFixed(0)} 62% ${(46 - 8 * x).toFixed(0)}%)`;
}

export default function HeatmapSheet({ game, games, onClose }) {
  const { state } = useStore();
  const t = useT();
  const edition = state.settings.edition || '草野球';
  const [side, setSide] = useState('off');
  const [pick, setPick] = useState(null);
  const [showRe, setShowRe] = useState(false);

  const { off, def, top, factor, opening, gap, total, ownShare, level, halfCount, halfRuns, rawBase } = useMemo(() => {
    const real = (games || Object.values(state.games || {}))
      .filter((g) => g && !String(g.id).startsWith('demo-'));
    const { re, total, ownShare, level, halfCount, halfRuns, rawBase } = buildRunExpectancy(real, edition);
    const { dists } = buildRunDists(real, edition, re);
    const id = game?.teamGap || 'even';
    const m = buildGapModel({
      dists,
      isHome: !!game?.isHome,
      regulation: currentRules(game)?.innings || 7,
      halfStartKey: (inn) => halfStartKeyOf(game, inn),
      gap: id,
    });
    const tables = gapTables(re, m.factor);
    return { ...tables, top: topOf(tables.off, tables.def), factor: m.factor, opening: m.opening, gap: id, total, ownShare, level, halfCount, halfRuns, rawBase };
  }, [game, games, state.games, edition]);

  const table = side === 'off' ? off : def;
  const even = (key) => (side === 'off' ? off.get(key) * factor : def.get(key) / factor);
  const rules = currentRules(game);
  const innings = rules?.innings || 7;
  const g = gapOf(gap);
  const split = gap !== 'even';
  const school = edition === 'ブカツ(中高大)';

  return (
    <Sheet title={t('hm.title')} onClose={onClose}>
      <p className="small">{split ? t('hm.split', { name: t(`gap.${gap}`) }) : t('hm.same')}</p>

      {split && (
        <div className="toggle-row">
          <button className={side === 'off' ? 'active' : ''} onClick={() => { setSide('off'); setPick(null); }}>
            {t('hm.off')}
          </button>
          <button className={side === 'def' ? 'active' : ''} onClick={() => { setSide('def'); setPick(null); }}>
            {t('hm.def')}
          </button>
        </div>
      )}

      <p className="small dim mt8">{t('hm.tapNote')}</p>
      <div className="hm-wrap">
        <div className="hm-grid">
          {[0, 1, 2].map((o) => (
            <React.Fragment key={o}>
              <div className="hm-rowlab">{t('hm.out', { n: o })}</div>
              {RUNNER_ROWS.map((row) => {
                const key = stateKey(row.runners, o);
                const v = table.get(key) || 0;
                const on = pick === key;
                return (
                  <button
                    key={key}
                    className={`hm-cell${on ? ' on' : ''}`}
                    style={{ background: heat(v, top) }}
                    onClick={() => setPick(on ? null : key)}
                    aria-label={t('hm.cell', { sit: t(`ret.r.${row.key}`), outs: o, v: v.toFixed(2) })}
                  >
                    {v.toFixed(2)}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
          <div className="hm-rowlab" />
          {RUNNER_ROWS.map((row) => (
            <div className="hm-collab" key={row.key}>{t(`ret.r.${row.key}`)}</div>
          ))}
        </div>
      </div>

      {/* 押したマスの数字。互角のときとの差も出す(何がどれだけ動いたかが本題なので) */}
      {pick && (
        <div className="hm-read">
          <b>{t('hm.cell', {
            sit: t(`ret.r.${pick.slice(0, 3)}`),
            outs: pick.slice(-1),
            v: (table.get(pick) || 0).toFixed(2),
          })}</b>
          {split && (
            <p className="small dim">
              {t('hm.vsEven', {
                v: even(pick).toFixed(2),
                d: `${table.get(pick) >= even(pick) ? '+' : '−'}${Math.abs(table.get(pick) - even(pick)).toFixed(2)}`,
              })}
            </p>
          )}
        </div>
      )}

      {/* ---- 倍率の出どころ。ここを書かないと「格上にしたら数字が動いた」で終わる ---- */}
      {split && (
        <>
          <div className="section-title">{t('hm.solveTitle')}</div>
          <div className="we-part">
            <div className="we-layer-head">
              <b>{t('gap.applied', { name: t(`gap.${gap}`), pct: (opening * 100).toFixed(0), f: factor.toFixed(3) })}</b>
              <span className="src-badge calc">{t('we.src.calc')}</span>
            </div>
            <p className="small dim">
              {t('hm.solve', {
                name: t(`gap.${gap}`),
                w: Math.round(g.win * 10),
                pct: (opening * 100).toFixed(0),
                f: factor.toFixed(3),
              })}
            </p>
            <p className="small dim">{t('hm.solveInn', { inn: innings, inn2: innings === 9 ? 7 : 9, name: t(`gap.${gap}`) })}</p>
          </div>
        </>
      )}

      {/* この表がどこから来ているか。倍率の根拠だけ書いて土台の出どころが
          抜けていると、色の付いた数字が宙に浮く */}
      <div className="section-title">{t('hm.srcTitle')}</div>
      <div className="we-part">
        <div className="we-layer-head">
          <b>{t('ret.srcTitle')}</b>
          <span className="src-badge mixed">{t('we.src.mixed')}</span>
        </div>
        <p className="small dim">
          {t('ret.src', { n: total, pct: Math.round(ownShare * 100), k: SHRINK_K })}
        </p>
        <p className="small dim">{t('ret.srcBase')}</p>
        <p className="small dim">
          {t('ret.level', {
            lv: level.toFixed(3),
            halves: halfCount,
            runs: halfRuns,
            own: halfCount ? (halfRuns / halfCount).toFixed(2) : '—',
            base: (rawBase['000|0'] || 0).toFixed(2),
          })}
        </p>
        {school && <p className="small dim">{t('ret.srcKoshien2')}</p>}
        {school && (
          <p className="small dim">
            {t('ret.srcKoshienLevel', {
              lv: KOSHIEN_LEVEL.toFixed(3),
              pct: Math.round((KOSHIEN_LEVEL - 1) * 100),
            })}
          </p>
        )}
      </div>
      <button className="small mt8" style={{ width: '100%' }} onClick={() => setShowRe(true)}>
        {t('ret.open')}
      </button>

      <div className="section-title">{t('hm.limitTitle')}</div>
      <ul className="we-limits">
        <li>{t('hm.limit1')}</li>
        <li>{t('hm.limit2')}</li>
        <li>{t('hm.limit3')}</li>
      </ul>
      <p className="small dim mt8">{t('gap.swingNote')}</p>
      <p className="small dim">{t('gap.statsNote')}</p>

      <div className="sheet-actions">
        <button className="primary" style={{ width: '100%' }} onClick={onClose}>{t('action.close')}</button>
      </div>
      {showRe && <ReTableSheet games={games} onClose={() => setShowRe(false)} />}
    </Sheet>
  );
}

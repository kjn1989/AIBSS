import React, { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import {
  currentRules, diffLiveRules, describeRulePatch, runnersPlaced, DEFAULT_TIEBREAK,
  FIELD_COUNT_MIN, FIELD_COUNT_MAX, ALL_BAT_MIN, ALL_BAT_MAX,
  TIEBREAK_RUNNERS, TIEBREAK_ORDERS, TIEBREAK_OUTS,
} from '../lib/rules.js';
import Sheet from './Sheet.jsx';

// ---- 試合ルール(タイブレーク・守備人数・全員打ち) ----
// この3つは「試合前に決まっていることが多いが、当日その場で決まることもある」。
// 人が帰って8人になる、時間が押して延長はタイブレークにする、途中から全員打ちにする。
// だから試合前だけでなく試合中にも決められて、しかも「何回から」が要る。
//
// 「何回から」は2種類あって混ざりやすい:
//   この変更を効かせる回   … 守備人数・全員打ちが変わった回(終わった回も選べる=言い忘れの遡り)
//   タイブレークを始める回 … 大会要項で決まっている回。宣言した回とは別物
// なので見出しを分け、履歴も項目ごとに正しい回で残す。

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || lo));
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

function Chips({ items, value, onChange, label }) {
  return (
    <div className="chips-row" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.k} className={`small${String(it.k) === String(value) ? ' primary' : ''}`}
          aria-pressed={String(it.k) === String(value)} onClick={() => onChange(it.k)}
        >
          {it.n}
        </button>
      ))}
    </div>
  );
}

function SwitchRow({ on, onToggle, title, hint }) {
  return (
    <div className="lr-row">
      <div className="lr-t">
        <b>{title}</b>
        <span>{hint}</span>
      </div>
      <button
        type="button" className="lr-sw" aria-pressed={on} aria-label={title}
        onClick={() => onToggle(!on)}
      />
    </div>
  );
}

export default function LiveRulesSheet({ game, draft, onDraft, onClose, defaultInning, regulationInnings }) {
  const { dispatch } = useStore();
  const t = useT();
  const preGame = !game;
  const base = useMemo(() => (preGame ? (draft || {}) : currentRules(game) || {}), [game, draft, preGame]);

  const [tb, setTb] = useState(() => base.tiebreak || null);
  const [fieldCount, setFieldCount] = useState(() => clampInt(base.fieldCount || 9, FIELD_COUNT_MIN, FIELD_COUNT_MAX));
  const [allBat, setAllBat] = useState(() => base.allBat || null);
  const [from, setFrom] = useState(() => clampInt(defaultInning || game?.inning || 1, 1, 99));
  const [saved, setSaved] = useState('');

  // 変更を効かせられる回。まだ来ていない回も1つ先まで選べる(次の回からにする)
  const lastInning = Math.max(
    Number(game?.inning) || 1,
    ...(game?.playLogs || []).map((l) => Number(l.inning) || 0),
  );
  const scopeInnings = range(1, Math.max(lastInning + 1, Number(game?.rules?.innings) || 7));
  // タイブレークは延長まで伸びる
  const tbInnings = range(1, Math.max(12, lastInning + 2));

  const next = { tiebreak: tb, fieldCount, allBat };
  const patch = diffLiveRules(
    { tiebreak: base.tiebreak || null, fieldCount: base.fieldCount || 9, allBat: base.allBat || null },
    next,
  );
  const changed = Object.keys(patch).length > 0;

  const innLabel = (n) => t('lr.inningN', { n });
  const runnerName = (k) => t(`lr.runner.${k}`);
  const orderName = (k) => t(`lr.order.${k}`);
  const outsName = (k) => t(`lr.outs.${k}`);

  // タイブレークは規定回を投げ切った後から始まるのがふつう(7回制なら8回)。
  // 試合中に決めるなら、少なくとも今の回より先から。
  const regulation = Number(regulationInnings || game?.rules?.innings) || 7;
  const setTbOn = (on) => setTb(on
    ? { fromInning: clampInt(Math.max(regulation + 1, lastInning + 1), 1, 99), ...DEFAULT_TIEBREAK }
    : null);
  const setAllOn = (on) => setAllBat(on ? { size: ALL_BAT_MIN } : null);

  const save = () => {
    if (preGame) {
      onDraft?.({ ...draft, tiebreak: tb, fieldCount, allBat });
      onClose();
      return;
    }
    if (!changed) { setSaved(t('lr.noChange')); return; }
    // タイブレークは「始まる回」から、他は「宣言した回」から効く
    if ('tiebreak' in patch) {
      dispatch({
        type: 'SET_LIVE_RULES', gameId: game.id,
        fromInning: tb ? tb.fromInning : from,
        patch: { tiebreak: patch.tiebreak },
      });
    }
    const rest = {};
    for (const k of ['fieldCount', 'allBat']) if (k in patch) rest[k] = patch[k];
    if (Object.keys(rest).length) {
      dispatch({ type: 'SET_LIVE_RULES', gameId: game.id, fromInning: from, patch: rest });
    }
    onClose();
  };

  const changes = [...(game?.ruleChanges || [])].sort((a, b) => (a.fromInning - b.fromInning) || (a.at - b.at));

  return (
    <Sheet title={t('lr.title')} onClose={onClose}>
      <p className="small dim" style={{ margin: '0 0 12px' }}>
        {preGame ? t('lr.introPre') : t('lr.introMid')}
      </p>

      {/* すでに何を変えたかは、次を決める前の材料。だから操作より先に置く */}
      {changes.length > 0 && (
        <>
          <div className="section-title">{t('lr.hist.title')}</div>
          <p className="small dim" style={{ marginTop: -4 }}>{t('lr.hist.sub')}</p>
          <div className="lr-hist">
            {changes.map((c) => (
              <div className="lr-histrow" key={c.id}>
                <b>{t('lr.fromN', { n: c.fromInning })}</b>
                <span>{c.text || describeRulePatch(c.patch)}</span>
                <button
                  className="small ghost"
                  onClick={() => dispatch({ type: 'REMOVE_RULE_CHANGE', gameId: game.id, changeId: c.id })}
                >
                  {t('action.delete')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {!preGame && (
        <>
          <div className="section-title">{t('lr.scopeTitle')}</div>
          <Chips
            label={t('lr.scopeTitle')} value={from} onChange={setFrom}
            items={scopeInnings.map((n) => ({ k: n, n: innLabel(n) }))}
          />
          <p className="small dim mt8">{t('lr.scopeHint')}</p>
        </>
      )}

      {/* ---- タイブレーク ---- */}
      <div className="section-title">{t('lr.tb.title')}</div>
      <p className="small dim" style={{ marginTop: -4 }}>{t('lr.tb.sub')}</p>
      <SwitchRow on={!!tb} onToggle={setTbOn} title={t('lr.tb.use')} hint={t('lr.tb.useHint')} />
      {tb && (
        <div className="lr-detail">
          <label className="small dim">{t('lr.tb.from')}</label>
          <Chips
            label={t('lr.tb.from')} value={tb.fromInning}
            onChange={(v) => setTb({ ...tb, fromInning: v })}
            items={tbInnings.map((n) => ({ k: n, n: innLabel(n) }))}
          />
          <label className="small dim mt8" style={{ display: 'block' }}>{t('lr.tb.outs')}</label>
          <Chips
            label={t('lr.tb.outs')} value={Number(tb.outs) || 0}
            onChange={(v) => setTb({ ...tb, outs: v })}
            items={TIEBREAK_OUTS.map((k) => ({ k, n: outsName(k) }))}
          />
          <label className="small dim mt8" style={{ display: 'block' }}>{t('lr.tb.runners')}</label>
          <Chips
            label={t('lr.tb.runners')} value={tb.runners}
            onChange={(v) => setTb({ ...tb, runners: v })}
            items={TIEBREAK_RUNNERS.map((k) => ({ k, n: runnerName(k) }))}
          />
          <label className="small dim mt8" style={{ display: 'block' }}>{t('lr.tb.order')}</label>
          <div className="toggle-row" style={{ marginBottom: 8 }}>
            {TIEBREAK_ORDERS.map((k) => (
              <button key={k} className={tb.order === k ? 'active' : ''} onClick={() => setTb({ ...tb, order: k })}>
                {orderName(k)}
              </button>
            ))}
          </div>
          <div className="keep-box">
            <b>{t('lr.effect')}</b> {t('lr.tb.effect', { n: runnersPlaced(tb.runners) })}
          </div>
        </div>
      )}

      {/* ---- 全員打ち ---- */}
      <div className="section-title">{t('lr.ab.title')}</div>
      <p className="small dim" style={{ marginTop: -4 }}>{t('lr.ab.sub')}</p>
      <SwitchRow on={!!allBat} onToggle={setAllOn} title={t('lr.ab.use')} hint={t('lr.ab.useHint')} />
      {allBat && (
        <div className="lr-detail">
          <label className="small dim">{t('lr.ab.size')}</label>
          <Chips
            label={t('lr.ab.size')} value={allBat.size}
            onChange={(v) => setAllBat({ size: v })}
            items={range(ALL_BAT_MIN, ALL_BAT_MAX).map((n) => ({ k: n, n: t('lr.peopleN', { n }) }))}
          />
          <div className="keep-box"><b>{t('lr.effect')}</b> {t('lr.ab.effect')}</div>
        </div>
      )}

      {/* ---- 守備の人数 ---- */}
      <div className="section-title">{t('lr.fc.title')}</div>
      <p className="small dim" style={{ marginTop: -4 }}>{t('lr.fc.sub')}</p>
      <Chips
        label={t('lr.fc.title')} value={fieldCount} onChange={setFieldCount}
        items={range(FIELD_COUNT_MIN, FIELD_COUNT_MAX).map((n) => ({ k: n, n: t('lr.peopleN', { n }) }))}
      />
      <div className="keep-box">
        {fieldCount === 9 ? t('lr.fc.normal')
          : fieldCount < 9 ? <><b>{t('lr.effect')}</b> {t('lr.fc.short', { n: 9 - fieldCount })}</>
            : <><b>{t('lr.effect')}</b> {t('lr.fc.extra')}</>}
      </div>

      {/* ---- 保存前のまとめ ---- */}
      <div className="lr-sum">
        <b>{t('lr.summary')}</b>
        <div>{tb ? t('lr.sum.tbOn', { n: tb.fromInning, o: outsName(Number(tb.outs) || 0), r: runnerName(tb.runners), b: orderName(tb.order) }) : t('lr.sum.tbOff')}</div>
        <div>{fieldCount === 9 ? t('lr.sum.fcNormal') : t('lr.sum.fc', { n: fieldCount, from: preGame ? 1 : from })}</div>
        <div>{allBat ? t('lr.sum.abOn', { n: allBat.size, from: preGame ? 1 : from }) : t('lr.sum.abOff')}</div>
        {!preGame && changed && <div className="dim">{t('lr.sum.keepBefore', { n: Math.max(1, from - 1) })}</div>}
      </div>
      {saved && <div className="keep-box mt8">{saved}</div>}

      <div className="sheet-actions">
        <button className="ghost" onClick={onClose}>{t('action.cancel')}</button>
        <button className="primary" onClick={save}>{preGame ? t('action.save') : t('lr.apply')}</button>
      </div>
    </Sheet>
  );
}

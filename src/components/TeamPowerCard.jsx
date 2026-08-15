import React, { useMemo, useState } from 'react';
import { useStore, useT } from '../state/store.jsx';
import { buildRunExpectancy } from '../lib/flow.js';
import { teamPower, mostOff, formatPower } from '../lib/teamPower.js';

// ---- チーム力 ----
// チーム打率も順位も、他のチームと比べないと良し悪しが分からない。
// ここでは比べる相手を「その場面そのもの」に変えているので、
// リーグも順位表も要らず、1試合でも20試合でも同じ意味で読める。
//
// 指標を20個並べたら誰も見ないので、最初に出すのは「いま一番ずれている3つ」だけ。
// 残りは開いて見る。回数は必ず併記する(5回しかない場面の57%には意味がない)。

const MIN_SAMPLES = 10;

function Bar({ row }) {
  // 決定力/火消し力は1.00が基準なので、その左右への振れを見せる。
  // 割合は0〜1をそのまま。
  const v = row.value;
  if (v == null) return <div className="tp-bar" />;
  if (row.kind === 'index') {
    const pct = Math.max(0, Math.min(1, v / 2)); // 0〜2 を 0〜100%
    const good = v >= 1;
    return (
      <div className="tp-bar">
        <i className="tp-mid" />
        <i className={`tp-fill ${good ? 'good' : 'bad'}`} style={{ left: good ? '50%' : `${pct * 100}%`, width: `${Math.abs(pct - 0.5) * 100}%` }} />
      </div>
    );
  }
  return (
    <div className="tp-bar">
      <i className="tp-fill good" style={{ left: 0, width: `${v * 100}%` }} />
    </div>
  );
}

function Row({ row, t }) {
  const thin = row.n > 0 && row.n < MIN_SAMPLES;
  // 守備側は相手の打席を記録していないと出ない。原因が分かるように言う
  const none = row.n === 0;
  return (
    <div className={`tp-row${thin ? ' thin' : ''}`}>
      <div className="tp-head">
        <b>{t(`tp.${row.key}`)}</b>
        <span className="tp-val num">{formatPower(row)}</span>
      </div>
      <Bar row={row} />
      <div className="tp-note">
        {t(`tp.${row.key}.note`)}
        {!none && (
          <span className="tp-n num">
            {row.hit != null ? t('tp.nOf', { a: row.hit, b: row.n }) : t('tp.nTimes', { n: row.n })}
          </span>
        )}
      </div>
      {thin && <div className="tp-thin">{t('tp.tooFew', { n: MIN_SAMPLES })}</div>}
      {none && <div className="tp-thin">{t(row.side === 'def' ? 'tp.needDefense' : 'tp.needOffense')}</div>}
    </div>
  );
}

export default function TeamPowerCard({ games, title }) {
  const { state } = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);

  const edition = state.settings.edition || '草野球';
  const { re, total, ownShare } = useMemo(
    () => buildRunExpectancy(games, edition),
    [games, edition],
  );
  const rows = useMemo(() => teamPower(games, re), [games, re]);
  const top = useMemo(() => mostOff(rows, { minSamples: MIN_SAMPLES, top: 3 }), [rows]);

  const any = rows.some((r) => r.value != null);
  if (!any) {
    return (
      <div className="card">
        <h2>{title || t('tp.title')}</h2>
        <p className="small dim">{t('tp.empty')}</p>
      </div>
    );
  }

  const PAIRS = ['lead', 'conv', 'streak', 'twoout'];
  const byPair = (p, side) => rows.find((r) => r.pair === p && r.side === side);

  return (
    <div className="card tp-card">
      <div className="flex">
        <h2 className="grow">{title || t('tp.title')}</h2>
        <button className="small" onClick={() => setOpen((v) => !v)}>
          {open ? t('tp.collapse') : t('tp.expand')}
        </button>
      </div>
      <p className="small dim" style={{ marginTop: -4 }}>{t('tp.lead')}</p>

      {/* 20個並べたら誰も見ない。まず「いま一番ずれている3つ」 */}
      {!open && (
        top.length > 0 ? (
          <>
            <div className="section-title">{t('tp.topTitle')}</div>
            <div className="tp-list">
              {top.map((r) => <Row key={r.key} row={r} t={t} />)}
            </div>
          </>
        ) : (
          <p className="small dim mt8">{t('tp.notYet', { n: MIN_SAMPLES })}</p>
        )
      )}

      {/* 攻撃と守備はきれいに鏡になる */}
      {open && (
        <div className="tp-pairs">
          {PAIRS.map((p) => (
            <div className="tp-pair" key={p}>
              <div className="tp-pairname">{t(`tp.pair.${p}`)}</div>
              <div className="tp-mirror">
                <Row row={byPair(p, 'off')} t={t} />
                <Row row={byPair(p, 'def')} t={t} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="fv-src">
        <b>{t('tp.srcTitle')}</b>
        {t('tp.src', { n: total, pct: Math.round(ownShare * 100) })}
      </div>
    </div>
  );
}

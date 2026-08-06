import React, { useMemo, useState } from 'react';
import { RESULTS } from '../lib/model.js';
import { useT } from '../state/store.jsx';
import {
  ballOf, chartPoint, chartFan, zonePath, zoneCenter, zoneCounts,
  ZONE_SLICES, ZONE_RINGS, CHART_MAX, DEPTH_BANDS,
} from '../lib/battedBall.js';

// ============================================================
// 打球分布(スプレーチャート)
//
// これまでは9つの守備位置に点を寄せて少し散らしていたので、
// 1シーズンぶんを出すと各位置に点が重なって団子になっていた。
// 打点の角度・深さが記録されていれば実際の場所に置く。
// 角度が無い古い記録は守備位置から補うので、同じ図に並べられる。
//
// 見せ方は「1本ずつ」を基本にして、「区画」も選べるようにする。
// 区画は角度5×深さ3で件数の濃淡をつけ、数字も入れる。
// 濃淡だけだと印象論になるが、数字が入っていれば正確に読める。
//
// 色: 安打は青の濃さの階段(単打→本塁打で濃く・大きく)、凡打は淡いグレー。
// 単打=青/二塁打=緑/三塁打=紫 は、順番のあるものに順番のない色を
// 割り当てていた。階段にすると色数は減るのに情報は増える。
// ============================================================

const HIT_COLORS = {
  single: '#7cb7f2',
  double: '#3b8ede',
  triple: 'var(--accent-2)',
  hr: 'var(--gold)',
};
// 長打ほど大きく。順番のあるものは大きさでも順番を出す
const HIT_SIZE = { single: 1.0, double: 1.22, triple: 1.42, hr: 1.6 };

// 打点が記録されていない古い打席は、同じ守備位置だと1点に完全に重なってしまう。
// idから決まるゆらぎを与えて散らす(再描画で点が動かないように決定的にする)。
// 実際に押された打点にはゆらぎを入れない。
function jitter(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return [((h % 1000) / 1000 - 0.5) * 7, (((h >> 10) % 1000) / 1000 - 0.5) * 7];
}

function dotColor(ab) {
  if (HIT_COLORS[ab.result]) return HIT_COLORS[ab.result];
  if (ab.result === 'out' || ab.result === 'so') return 'var(--text-dim)';
  return 'var(--text-dim)';
}

// 件数の濃淡。暗い芝の上で「多い」がすぐ読めるよう青→琥珀→朱にする
function heat(k) {
  if (k <= 0) return 'rgba(255,255,255,0.03)';
  const stops = [[88, 166, 255], [210, 153, 34], [248, 81, 73]];
  const x = Math.min(1, k) * 2;
  const i = Math.min(1, Math.floor(x));
  const u = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  const c = [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * u));
  return `rgba(${c.join(',')},${(0.12 + 0.62 * Math.min(1, k)).toFixed(3)})`;
}

const FILTERS = [
  { key: 'all', match: () => true },
  { key: 'hit', match: (ab) => !!RESULTS[ab.result]?.hit },
  { key: 'ground', match: (ab) => ab.outType === 'ground' },
  { key: 'fly', match: (ab) => ab.outType === 'fly' || ab.outType === 'liner' },
  { key: 'hard', match: (ab) => ab.contact === 'hard' },
];

export default function SprayChart({ atBats, title, bats }) {
  const t = useT();
  const [view, setView] = useState('dot');
  const [filter, setFilter] = useState('all');

  // ファウルはこの図に入れない。扇の外に落ちるので図として壊れるうえ、
  // 引っ張り/流しはフェアの打球についての割合なので、混ぜると意味が変わる。
  // 黙って捨てると気づけないので、本数は下の脚注で必ず言う
  const all = useMemo(() => (atBats || []).filter((ab) => ballOf(ab)), [atBats]);
  const fouls = useMemo(() => all.filter((ab) => ballOf(ab).foul).length, [all]);
  const placeable = useMemo(() => all.filter((ab) => !ballOf(ab).foul), [all]);
  // 絞り込みの選択肢は、そのデータで意味があるものだけ出す
  const usable = useMemo(
    () => FILTERS.filter((f) => f.key === 'all' || placeable.some(f.match)),
    [placeable],
  );
  const active = usable.some((f) => f.key === filter) ? filter : 'all';
  const rows = useMemo(
    () => placeable.filter(FILTERS.find((f) => f.key === active).match),
    [placeable, active],
  );

  const hits = rows.filter((ab) => RESULTS[ab.result]?.hit).length;
  const exact = rows.filter((ab) => ballOf(ab).exact).length;

  // 点の大きさと濃さは本数から決める。同じ大きさのまま増やすと団子になる
  const k = Math.max(0, Math.min(1, (rows.length - 20) / 200));
  const base = 2.6 - 1.15 * k;
  const op = 0.95 - 0.3 * k;
  const stroked = rows.length <= 60;

  const { counts } = useMemo(() => zoneCounts(rows), [rows]);
  const maxCount = Math.max(1, ...counts);

  // 引っ張り/中/流しの内訳。本数がいくら増えても壊れない読み方として下に置く
  const split = useMemo(() => {
    let pull = 0; let mid = 0; let oppo = 0;
    for (const ab of rows) {
      const b = ballOf(ab);
      // 左打者は右方向が引っ張り
      const a = bats === 'L' ? -b.angle : b.angle;
      if (a < -15) pull += 1;
      else if (a > 15) oppo += 1;
      else mid += 1;
    }
    return { pull, mid, oppo, total: Math.max(1, rows.length) };
  }, [rows, bats]);

  return (
    <div className="card">
      <h2>
        {title || t('spray.title')}{' '}
        <span className="dim small">{t('spray.summary', { n: rows.length, h: hits })}</span>
      </h2>
      {placeable.length === 0 ? (
        <div className="dim small">
          {t('spray.empty')}
          {fouls > 0 && <> {t('spray.foulNote', { n: fouls })}</>}
        </div>
      ) : (
        <>
          <div className="spray-controls">
            <div className="seg-control mini" role="tablist" aria-label={t('spray.view')}>
              <button role="tab" aria-selected={view === 'dot'} className={view === 'dot' ? 'on' : ''} onClick={() => setView('dot')}>
                {t('spray.viewDot')}
              </button>
              <button role="tab" aria-selected={view === 'zone'} className={view === 'zone' ? 'on' : ''} onClick={() => setView('zone')}>
                {t('spray.viewZone')}
              </button>
            </div>
            {usable.length > 1 && (
              <div className="spray-filters">
                {usable.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`chip-sm${active === f.key ? ' on' : ''}`}
                    aria-pressed={active === f.key}
                    onClick={() => setFilter(f.key)}
                  >
                    {t(`spray.f.${f.key}`)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 図は入力パッドと同じ作り。フェンスを内側に置き、外にスタンドを描く。
              柵が外周だと柵越えの打球を柵の上に押し込むしかなく、本塁打が
              「フェンス際の当たり」と同じ場所に見えてしまっていた */}
          <svg viewBox="0 0 100 92" className="spray-chart">
            <rect x="0" y="0" width="100" height="92" fill="#1c2129" />
            {/* 芝と土は彩度を落とす。画面でいちばん明るいものはデータであるべき */}
            <path d={chartFan(1)} fill="#3a3026" />
            <path d={chartFan(0.955)} fill="#1f3a2a" />
            <path d={chartFan(DEPTH_BANDS[0].max)} fill="#3b3025" />
            {/* 柵。これより外はスタンド = 柵越え */}
            <path d={chartFan(1)} fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="1.2" />
            {/* 内野のベースパス。二塁は深さ0.39(実際の本塁→二塁 39m / フェンス 100m) */}
            <path
              d={`M${chartPoint(0, 0.02).join(',')} L${chartPoint(-45, 0.276).join(',')} L${chartPoint(0, 0.39).join(',')} L${chartPoint(45, 0.276).join(',')} Z`}
              fill="none" stroke="rgba(242,237,228,.42)" strokeWidth="1.2"
            />
            <line x1="50" y1="90" x2={chartPoint(-45, 1).at(0)} y2={chartPoint(-45, 1).at(1)} stroke="rgba(242,237,228,.42)" strokeWidth="1" />
            <line x1="50" y1="90" x2={chartPoint(45, 1).at(0)} y2={chartPoint(45, 1).at(1)} stroke="rgba(242,237,228,.42)" strokeWidth="1" />

            {view === 'zone'
              ? counts.map((c, idx) => {
                const si = idx % ZONE_SLICES;
                const ri = Math.floor(idx / ZONE_SLICES);
                const [cx, cy] = zoneCenter(si, ri);
                return (
                  <g key={idx}>
                    <path d={zonePath(si, ri)} fill={heat(c / maxCount)} stroke="rgba(255,255,255,.16)" strokeWidth="0.35" />
                    {c > 0 && (
                      <text
                        x={cx.toFixed(2)} y={(cy + 1.6).toFixed(2)} textAnchor="middle"
                        fontSize="4.6" fontWeight="700" fill="#fff"
                        style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,.55)', strokeWidth: '1.1px', fontFamily: 'ui-monospace, Menlo, monospace' }}
                      >
                        {c}
                      </text>
                    )}
                  </g>
                );
              })
              : rows.map((ab) => {
                const b = ballOf(ab);
                const [px, py] = chartPoint(b.angle, Math.min(b.depth, CHART_MAX));
                const [jx, jy] = b.exact ? [0, 0] : jitter(ab.id);
                const isHit = !!RESULTS[ab.result]?.hit;
                return (
                  <circle
                    key={ab.id}
                    cx={(px + jx).toFixed(2)}
                    cy={(py + jy).toFixed(2)}
                    r={(base * (HIT_SIZE[ab.result] || 0.84)).toFixed(2)}
                    fill={dotColor(ab)}
                    stroke={stroked ? 'rgba(0,0,0,0.35)' : 'none'}
                    strokeWidth={stroked ? 0.35 : 0}
                    opacity={(isHit ? op : op * 0.6).toFixed(2)}
                  />
                );
              })}
          </svg>

          {view === 'zone' ? (
            <div className="heat-ramp">
              <span>{t('spray.few')}</span>
              <i style={{ background: `linear-gradient(90deg, ${heat(0.02)}, ${heat(0.5)}, ${heat(1)})` }} />
              <span>{t('spray.many')}</span>
            </div>
          ) : (
            <div className="spray-legend">
              <span><i style={{ background: HIT_COLORS.single, width: 8, height: 8 }} />{t('spray.single')}</span>
              <span><i style={{ background: HIT_COLORS.double, width: 10, height: 10 }} />{t('spray.double')}</span>
              <span><i style={{ background: 'var(--accent-2)', width: 11, height: 11 }} />{t('spray.triple')}</span>
              <span><i style={{ background: 'var(--gold)', width: 12, height: 12 }} />{t('spray.hr')}</span>
              <span><i style={{ background: 'var(--text-dim)', width: 8, height: 8, opacity: 0.6 }} />{t('spray.out')}</span>
            </div>
          )}

          <div className="dirbar" style={{ marginTop: 12 }}>
            <i className="pull" style={{ width: `${(split.pull / split.total) * 100}%` }} />
            <i className="mid" style={{ width: `${(split.mid / split.total) * 100}%` }} />
            <i className="oppo" style={{ width: `${(split.oppo / split.total) * 100}%` }} />
          </div>
          <div className="dirlab">
            <span>{t('spray.pull')} {Math.round((split.pull / split.total) * 100)}%</span>
            <span>{t('spray.center')} {Math.round((split.mid / split.total) * 100)}%</span>
            <span>{t('spray.oppo')} {Math.round((split.oppo / split.total) * 100)}%</span>
          </div>

          <p className="foot-note">
            {view === 'zone'
              ? t('spray.zoneNote', { s: ZONE_SLICES, r: ZONE_RINGS.length - 1 })
              : t('spray.exactNote', { n: exact, total: rows.length })}
            {fouls > 0 && <> {t('spray.foulNote', { n: fouls })}</>}
          </p>
        </>
      )}
    </div>
  );
}

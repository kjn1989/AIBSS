import React, { useState, useMemo } from 'react';
import { aggregateBatting, battingMetrics } from '../lib/stats.js';

// 成績推移グラフ: 試合を重ねるごとの通算打率/出塁率/OPSの推移をSVG折れ線で表示
const METRICS = [
  { key: 'ba', label: '打率', max: 1 },
  { key: 'obp', label: '出塁率', max: 1 },
  { key: 'ops', label: 'OPS', max: 2 },
];

export default function TrendChart({ games, playerId }) {
  const [metricKey, setMetricKey] = useState('ba');
  const metric = METRICS.find((m) => m.key === metricKey);

  // 各試合終了時点の通算値を計算(古い順に累積)
  const points = useMemo(() => {
    const sorted = [...games].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      const upTo = sorted.slice(0, i + 1);
      const s = aggregateBatting(upTo)[playerId];
      if (!s || s.ab === 0) continue;
      const m = battingMetrics(s);
      const v = m[metricKey];
      if (v === null || v === undefined) continue;
      out.push({ date: sorted[i].date, value: v, game: sorted[i] });
    }
    return out;
  }, [games, playerId, metricKey]);

  const W = 320;
  const H = 140;
  const PAD = { l: 34, r: 12, t: 12, b: 22 };
  const maxV = Math.max(metric.max * 0.5, ...points.map((p) => p.value)) * 1.1;
  const x = (i) => PAD.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v) => H - PAD.b - (v / maxV) * (H - PAD.t - PAD.b);
  const fmt = (v) => v.toFixed(3).replace(/^0\./, '.');

  return (
    <div className="card">
      <h2>成績推移</h2>
      <div className="grid3" style={{ marginBottom: 10 }}>
        {METRICS.map((m) => (
          <button key={m.key} className={`small ${metricKey === m.key ? 'primary' : ''}`} onClick={() => setMetricKey(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      {points.length < 2 ? (
        <div className="dim small">2試合以上の記録が貯まると推移が表示されます。</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart">
          {/* 目盛り(横線) */}
          {[0.25, 0.5, 0.75, 1].map((f) => {
            const v = maxV * f;
            return (
              <g key={f}>
                <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
                <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fill="var(--text-dim)">{fmt(v)}</text>
              </g>
            );
          })}
          {/* 折れ線 */}
          <polyline
            points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill="var(--accent)" />
          ))}
          {/* 最新値ラベル */}
          <text
            x={x(points.length - 1)}
            y={y(points[points.length - 1].value) - 7}
            textAnchor="end"
            fontSize="10"
            fontWeight="800"
            fill="var(--gold)"
          >
            {fmt(points[points.length - 1].value)}
          </text>
          {/* X軸: 最初と最後の日付 */}
          <text x={PAD.l} y={H - 8} fontSize="8" fill="var(--text-dim)">{points[0].date?.slice(5)}</text>
          <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="8" fill="var(--text-dim)">
            {points[points.length - 1].date?.slice(5)}
          </text>
        </svg>
      )}
    </div>
  );
}

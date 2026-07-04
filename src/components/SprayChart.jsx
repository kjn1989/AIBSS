import React from 'react';
import { RESULTS } from '../lib/model.js';

// 打球方向スプレーチャート: 記録済みの打球方向(atBat.direction)を
// フィールド図に打点として描画する。単打=青 / 二塁打=緑 / 三塁打=紫 / 本塁打=金 / 凡打=赤 / その他(失策・犠打等)=琥珀。
const POS = {
  LF: [20, 26], CF: [50, 14], RF: [80, 26],
  '3B': [24, 52], SS: [38, 40], '2B': [62, 40], '1B': [76, 52],
  P: [50, 60], C: [50, 86],
};

// atBat.idから決定的なジッターを生成(再描画で点が動かないように)
function jitter(id, range = 7) {
  let h = 0;
  for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const dx = ((h % 1000) / 1000 - 0.5) * range;
  const dy = (((h >> 10) % 1000) / 1000 - 0.5) * range;
  return [dx, dy];
}

const HIT_COLORS = { single: 'var(--accent)', double: 'var(--green)', triple: 'var(--purple)', hr: 'var(--gold)' };

function dotColor(ab) {
  if (HIT_COLORS[ab.result]) return HIT_COLORS[ab.result];
  if (ab.result === 'out' || ab.result === 'so') return 'var(--red)';
  return 'var(--text-dim)';
}

export default function SprayChart({ atBats, title }) {
  const withDir = (atBats || []).filter((ab) => ab.direction && POS[ab.direction]);
  const hits = withDir.filter((ab) => RESULTS[ab.result]?.hit).length;

  return (
    <div className="card">
      <h2>{title || 'スプレーチャート'} <span className="dim small">({withDir.length}打球 / 安打{hits})</span></h2>
      {withDir.length === 0 ? (
        <div className="dim small">打球方向つきの記録がまだありません。</div>
      ) : (
        <>
          <svg viewBox="0 0 100 92" className="spray-chart">
            {/* 外野芝 */}
            <path d="M50,90 L2,42 Q50,-14 98,42 Z" fill="#2a6e3a" />
            {/* 内野の土(扇形) */}
            <path d="M50,90 L20,60 Q50,28 80,60 Z" fill="#75593d" />
            {/* ベースパス */}
            <path d="M50,84 L26,60 L50,36 L74,60 Z" fill="none" stroke="#f2ede4" strokeWidth="1.4" />
            {/* ファウルライン */}
            <line x1="50" y1="90" x2="2" y2="42" stroke="#f2ede4" strokeWidth="1" />
            <line x1="50" y1="90" x2="98" y2="42" stroke="#f2ede4" strokeWidth="1" />
            {withDir.map((ab) => {
              const [x, y] = POS[ab.direction];
              const [dx, dy] = jitter(ab.id);
              return (
                <circle
                  key={ab.id}
                  cx={x + dx}
                  cy={y + dy}
                  r="2.4"
                  fill={dotColor(ab)}
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth="0.4"
                  opacity="0.92"
                />
              );
            })}
          </svg>
          <div className="spray-legend">
            <span><i style={{ background: 'var(--accent)' }} />単打</span>
            <span><i style={{ background: 'var(--green)' }} />二塁打</span>
            <span><i style={{ background: 'var(--purple)' }} />三塁打</span>
            <span><i style={{ background: 'var(--gold)' }} />本塁打</span>
            <span><i style={{ background: 'var(--red)' }} />アウト</span>
            <span><i style={{ background: 'var(--text-dim)' }} />失策・犠打等</span>
          </div>
        </>
      )}
    </div>
  );
}

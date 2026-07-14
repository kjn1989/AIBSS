import React from 'react';

// ============================================================
// AI-BASE DIAMOND ブランドマーク(ロゴ5a「Scoreboard Matrix Lockup」の忠実な再現)
// - DiamondIcon: 内野ダイヤモンド+点線オービット+塁ノード+本塁ノード(favicon/ヘッダー共用の単一マスター)
// - LedWordmark: 「AI◆BASE」をLEDドットマトリクスで描画(フォントを使わず5×7ビットマップ)
// 数値(色・比率・ドットパターン)はデザイン確定仕様に準拠。SVGで解像度非依存に構築する。
// ============================================================

export const BRAND_COLORS = {
  bg: '#0A0D10',
  gold: '#E8B44C',
  teal: '#2DD4BF',
  ivory: '#F5F1E6',
  aiGold: '#F4D9A0',
  off: 'rgba(255,255,255,0.05)',
};

// ---- ① ダイヤモンドアイコン(viewBox 0 0 128 128) ----
// favicon/PWAアイコンとヘッダーの両方でこの1つのSVGを共用する(単一マスター)。
export function DiamondIcon({ size = 32, showOrbit = true, className, ...rest }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      aria-hidden="true"
      {...rest}
    >
      {showOrbit && (
        <circle
          cx="64" cy="64" r="54"
          stroke={BRAND_COLORS.gold} strokeWidth="1.5"
          pathLength="360" strokeDasharray="2 7"
          fill="none" opacity="0.45"
        />
      )}
      <path
        d="M64 20 L108 64 L64 108 L20 64 Z"
        stroke={BRAND_COLORS.gold} strokeWidth="5" fill="none" strokeLinejoin="round"
      />
      <circle cx="64" cy="20" r="7" fill={BRAND_COLORS.teal} />
      <circle cx="108" cy="64" r="7" fill={BRAND_COLORS.teal} />
      <circle cx="64" cy="108" r="7" fill={BRAND_COLORS.teal} />
      <circle cx="20" cy="64" r="7" fill={BRAND_COLORS.teal} />
      <circle cx="64" cy="64" r="9" fill={BRAND_COLORS.ivory} />
    </svg>
  );
}

// ---- ② LEDワードマーク「AI◆BASE」(5×7ドットマトリクス。フォント不使用) ----
// 1=点灯 0=消灯。過去に「BASE」の先頭Aが抜けるバグがあったため、文字列は必ず
// AI + ◆(セパレータ) + B,A,S,E の4文字であることをこの配列自体で保証する。
const GLYPH_5x7 = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
};
// ◆セパレータ(3×3): 中央+上下左右の5灯(プラス/菱形形)
const SEP_3x3 = ['010', '101', '010'];

const WORD_AI = ['A', 'I'];
const WORD_BASE = ['B', 'A', 'S', 'E'];

// 1文字ぶんのドットグリッドをrectで描画
function Glyph({ pattern, x, dot, gap, color, glow }) {
  const cell = dot + gap;
  const rects = [];
  pattern.forEach((row, r) => {
    [...row].forEach((bit, c) => {
      const on = bit === '1';
      rects.push(
        <rect
          key={`${r}-${c}`}
          x={x + c * cell}
          y={r * cell}
          width={dot}
          height={dot}
          rx={Math.max(0.5, dot * 0.2)}
          fill={on ? color : BRAND_COLORS.off}
          filter={on && glow ? 'url(#ledGlow)' : undefined}
        />
      );
    });
  });
  return <>{rects}</>;
}

// dot/gap(px)でサイズ調整可能。letterGap=文字間、sepGap=セパレータ前後の間隔。
// glow=true で微光フィルタを付与(小サイズでは視認性が下がるため既定offを推奨)。
export function LedWordmark({ dot = 15, gap = 4, letterGap = 6, sepGap = 6, glow = false, className }) {
  const cols = 5;
  const cell = dot + gap;
  const letterW = cols * dot + (cols - 1) * gap;
  const sepDot = Math.max(1.5, dot * 0.6);
  const sepGapPx = Math.max(1, gap * 0.75);
  const sepCell = sepDot + sepGapPx;
  const sepW = 3 * sepDot + 2 * sepGapPx;

  let x = 0;
  const parts = [];
  WORD_AI.forEach((ch, i) => {
    parts.push({ ch, x, word: 'AI' });
    x += letterW + (i < WORD_AI.length - 1 ? letterGap : 0);
  });
  const sepX = x + sepGap;
  x = sepX + sepW + sepGap;
  WORD_BASE.forEach((ch, i) => {
    parts.push({ ch, x, word: 'BASE' });
    x += letterW + (i < WORD_BASE.length - 1 ? letterGap : 0);
  });
  const totalW = x;
  const totalH = 7 * dot + 6 * gap;

  return (
    <svg className={className} width={totalW} height={totalH} viewBox={`0 0 ${totalW} ${totalH}`} aria-hidden="true">
      {glow && (
        <defs>
          <filter id="ledGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation={dot * 0.35} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      {parts.map((p, i) => (
        <Glyph
          key={i}
          pattern={GLYPH_5x7[p.ch]}
          x={p.x}
          dot={dot}
          gap={gap}
          color={p.word === 'AI' ? BRAND_COLORS.aiGold : BRAND_COLORS.ivory}
          glow={glow}
        />
      ))}
      {/* ◆セパレータ(3x3・中央のみ縦方向centering) */}
      {SEP_3x3.map((row, r) =>
        [...row].map((bit, c) => {
          const on = bit === '1';
          const yOff = (totalH - (3 * sepDot + 2 * sepGapPx)) / 2;
          return (
            <rect
              key={`sep-${r}-${c}`}
              x={sepX + c * sepCell}
              y={yOff + r * sepCell}
              width={sepDot}
              height={sepDot}
              rx={Math.max(0.5, sepDot * 0.2)}
              fill={on ? BRAND_COLORS.teal : BRAND_COLORS.off}
              filter={on && glow ? 'url(#ledGlow)' : undefined}
            />
          );
        })
      )}
    </svg>
  );
}

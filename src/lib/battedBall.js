// ============================================================
// 打球の記録(方向・深さ・強さ)
//
// これまで打球は「9つの守備位置のどれか」しか残っていなかった。
// そのため右前のポテンヒットと右中間を破る二塁打が同じ「右翼」になり、
// スプレーチャートも9か所の団子になっていた。
//
// ここでは打点を極座標で持つ:
//   hitAngle … 本塁から見た角度(度)。中堅=0、三塁線=-45、一塁線=+45
//   hitDepth … フェンスまでの距離を1とした比率(1を超えると柵越え)
//   contact  … 打球の強さ weak/normal/hard(未記録は null)
//
// 極座標にするのは、描画側の図の大きさや形に依存しないため。
// 図が変わっても記録は変わらない。逆に画面の座標で持つと、図を直した
// 瞬間に過去の記録の意味が変わってしまう。
//
// direction(9つの守備位置)は今までどおり併せて保存する。
// 既存の集計・引っ張り率・守備シフト分析がそのまま動き、
// 角度のない古い記録も同じ画面に並べられる。
// ============================================================

// ---- 入力パッドの幾何(FieldPad の CSS と一致させること) ----
// .field-pad { aspect-ratio: 10 / 9.2 } / 本塁 = left:50% top:101%
export const PAD_ASPECT = 0.92;
const HOME_X = 0.5;
const HOME_Y = 1.01 * PAD_ASPECT;
// パッド上での「フェンス」までの距離(幅を1とする単位)。
// 上辺中央がちょうど柵に当たるように取る。
const PAD_FENCE = 0.93;

// 守備位置のチップの座標(%)。FieldPad の POSITIONS と一致させること。
export const POS_PCT = {
  LF: [18, 27], CF: [50, 15], RF: [82, 27],
  '3B': [20, 61], SS: [36, 46], '2B': [64, 46], '1B': [80, 61],
  P: [50, 71], C: [50, 90],
};

// パッド内の位置(0〜1の割合)を、幅を1とする座標に直す
function toUnit(fx, fy) {
  return { x: fx, y: fy * PAD_ASPECT };
}

// パッドを押した位置 → { angle, depth, foul }
export function padPointToBall(fx, fy) {
  const u = toUnit(fx, fy);
  const dx = u.x - HOME_X;
  const dy = HOME_Y - u.y;
  const angle = (Math.atan2(dx, dy) * 180) / Math.PI;
  const depth = Math.hypot(dx, dy) / PAD_FENCE;
  return { angle, depth, foul: Math.abs(angle) > 45 };
}

// 逆変換。既に選ばれている打点をパッド上に描き戻すときに使う
export function ballToPadPoint(angle, depth) {
  const rad = (angle * Math.PI) / 180;
  const r = depth * PAD_FENCE;
  const x = HOME_X + r * Math.sin(rad);
  const y = HOME_Y - r * Math.cos(rad);
  return { fx: x, fy: y / PAD_ASPECT };
}

// 守備位置ごとの角度・深さ(チップを押したときの値)。
// チップはちょうど「内野」「定位置」の距離に置いてあるので、
// 今までどおりチップを押した人は今までどおりの記録になる。
export const POS_BALL = Object.fromEntries(
  Object.entries(POS_PCT).map(([k, [l, tp]]) => {
    const b = padPointToBall(l / 100, tp / 100);
    return [k, { angle: b.angle, depth: b.depth }];
  }),
);

// 押した点にいちばん近いチップ = 記録される方向。
// 角度で区切るのではなく「画面上で一番近いチップ」にするのは、
// 押した直後に光るチップと必ず一致させるため(説明が要らない)。
export function nearestDirection(angle, depth) {
  const rad = (angle * Math.PI) / 180;
  const p = { x: depth * PAD_FENCE * Math.sin(rad), y: depth * PAD_FENCE * Math.cos(rad) };
  let best = null;
  let bestD = Infinity;
  for (const [k, v] of Object.entries(POS_BALL)) {
    const r2 = (v.angle * Math.PI) / 180;
    const q = { x: v.depth * PAD_FENCE * Math.sin(r2), y: v.depth * PAD_FENCE * Math.cos(r2) };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

// ---- 深さの帯 ----
// 数字(85.3m)ではなく言葉で出す。ベンチからの目分量に数字を付けると
// 実測したかのように見えてしまうため。
export const DEPTH_BANDS = [
  { key: 'infield', max: 0.62 },
  { key: 'shallow', max: 0.73 },
  { key: 'normal', max: 0.86 },
  { key: 'deep', max: 0.97 },
  { key: 'wall', max: Infinity },
];
export function depthBand(depth) {
  if (depth == null) return null;
  return (DEPTH_BANDS.find((b) => depth < b.max) || DEPTH_BANDS[DEPTH_BANDS.length - 1]).key;
}

// ---- 打球の強さ ----
export const CONTACTS = ['weak', 'normal', 'hard'];
export const TRAJECTORIES = ['ground', 'liner', 'fly'];

// マスの呼び名。「ゴロ＋弱い」を組み立てさせず、実際に口にする言葉を置く。
// i18n キーは battedBall.cell.<軌道>.<強さ>
export const CELL_KEYS = TRAJECTORIES.flatMap((tr) => CONTACTS.map((c) => `${tr}.${c}`));

// 深さと軌道から、いちばんありそうな強さを1つ提案する。
// これは「候補」であって記録ではない。押さずに確定した打席は未記録のまま。
// 押していないものを普通として数え始めると、ハードヒット率がすぐ嘘になる。
export function contactCandidate(outType, depth) {
  if (depth == null || !outType) return null;
  if (outType === 'ground') {
    if (depth >= 0.62) return 'hard';   // 内野を抜けた
    if (depth <= 0.40) return 'weak';   // 手前で止まった
    return null;                        // 内野の普通のゴロは深さでは分からない
  }
  if (outType === 'fly') {
    if (depth >= 0.90) return 'hard';
    if (depth <= 0.70) return 'weak';   // 外野の前に落ちる/詰まった
    return null;
  }
  if (outType === 'liner') {
    if (depth >= 0.78) return 'hard';
    if (depth <= 0.55) return 'weak';
    return null;
  }
  return null;
}

// ---- 描画側の幾何(スプレーチャート: viewBox 100x92 / 本塁 (50,90)) ----
export const CHART = { hx: 50, hy: 90, w: 100, h: 92 };

// フェンスは二次ベジエ (2,42)-(50,-14)-(98,42)。
// 角度ごとの距離を先に作っておき、極座標から一発で図上の点に直せるようにする。
const FENCE_TABLE = (() => {
  const rows = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240;
    const u = 1 - t;
    const x = u * u * 2 + 2 * u * t * 50 + t * t * 98;
    const y = u * u * 42 + 2 * u * t * -14 + t * t * 42;
    const dx = x - CHART.hx;
    const dy = CHART.hy - y;
    rows.push({ angle: (Math.atan2(dx, dy) * 180) / Math.PI, r: Math.hypot(dx, dy) });
  }
  return rows;
})();

export function fenceRadius(angle) {
  const first = FENCE_TABLE[0];
  const last = FENCE_TABLE[FENCE_TABLE.length - 1];
  if (angle <= first.angle) return first.r;
  if (angle >= last.angle) return last.r;
  for (let i = 1; i < FENCE_TABLE.length; i++) {
    if (FENCE_TABLE[i].angle >= angle) {
      const a = FENCE_TABLE[i - 1];
      const b = FENCE_TABLE[i];
      const k = (angle - a.angle) / (b.angle - a.angle || 1);
      return a.r + (b.r - a.r) * k;
    }
  }
  return last.r;
}

// 極座標 → スプレーチャート上の点
export function chartPoint(angle, depth) {
  const rad = (angle * Math.PI) / 180;
  const r = depth * fenceRadius(angle);
  return [CHART.hx + r * Math.sin(rad), CHART.hy - r * Math.cos(rad)];
}

// 打席1件から描画用の極座標を取り出す。
// 角度がなければ守備位置から補う(古い記録も同じ図に並べるため)。
// 戻り値の exact で「実際に押された点」か「守備位置からの推定」かが分かる。
export function ballOf(ab) {
  if (ab && ab.hitAngle != null && ab.hitDepth != null) {
    return { angle: ab.hitAngle, depth: ab.hitDepth, exact: true };
  }
  const p = ab && POS_BALL[ab.direction];
  if (!p) return null;
  return { angle: p.angle, depth: p.depth, exact: false };
}

// ---- 区画(角度5 × 深さ3) ----
// 数が増えたら1本ずつではなく区画の濃淡で見せる。
// 濃淡だけだと印象論になるので件数も併記する。日本のスコアブックに
// 昔からある「打球方向図」と同じ考え方。
export const ZONE_SLICES = 5;
export const ZONE_RINGS = [0, 0.62, 0.86, Infinity]; // 内野 / 外野前〜定位置 / 深い〜柵際
export const ZONE_COUNT = ZONE_SLICES * (ZONE_RINGS.length - 1);

export function zoneOf(angle, depth) {
  const si = Math.max(0, Math.min(ZONE_SLICES - 1, Math.floor((angle + 45) / (90 / ZONE_SLICES))));
  let ri = 0;
  while (ri < ZONE_RINGS.length - 2 && depth >= ZONE_RINGS[ri + 1]) ri += 1;
  return si + ri * ZONE_SLICES;
}

// 区画の輪郭(SVG path)。半径がフェンスの形に沿うので、外周が図とぴったり合う
export function zonePath(si, ri) {
  const step = 90 / ZONE_SLICES;
  const t0 = -45 + si * step;
  const t1 = t0 + step;
  const f0 = ZONE_RINGS[ri];
  const f1 = ZONE_RINGS[ri + 1] === Infinity ? 1.06 : ZONE_RINGS[ri + 1];
  let d = '';
  for (let i = 0; i <= 12; i++) {
    const th = t0 + ((t1 - t0) * i) / 12;
    const [x, y] = chartPoint(th, f1);
    d += `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }
  for (let i = 12; i >= 0; i--) {
    const th = t0 + ((t1 - t0) * i) / 12;
    const [x, y] = chartPoint(th, f0);
    d += `L${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

// 区画の中心(件数の数字を置く場所)
export function zoneCenter(si, ri) {
  const step = 90 / ZONE_SLICES;
  const th = -45 + si * step + step / 2;
  const f1 = ZONE_RINGS[ri + 1] === Infinity ? 1.06 : ZONE_RINGS[ri + 1];
  return chartPoint(th, (ZONE_RINGS[ri] + f1) / 2);
}

// 打席の集まりから区画ごとの件数を作る
export function zoneCounts(atBats = []) {
  const counts = new Array(ZONE_COUNT).fill(0);
  let placed = 0;
  for (const ab of atBats) {
    const b = ballOf(ab);
    if (!b) continue;
    counts[zoneOf(b.angle, Math.min(b.depth, 1.05))] += 1;
    placed += 1;
  }
  return { counts, placed };
}

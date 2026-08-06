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
//
// フェンスを図の外周ではなく内側に置く。理由は2つ:
//   1) 柵の外(スタンド)を描けるので、本塁打を押す場所ができる。
//      フェンスが外周だと「柵越え」を押す場所がそもそも無かった。
//   2) 実際の球場の比率(本塁→二塁 約39m / フェンス 約100m)に合わせると
//      内野が縮み、深さが効いてくる外野に面積が回る。
//      以前は縦の6割が内野で、柵際は図の3%しかなく狙って押せなかった。
export const PAD_FENCE = 0.80;

// 守備位置のチップ。極座標(角度・深さ)を正とする。
// 深さはフェンスまでを1とした比率なので、図の縮尺を変えても意味が変わらない。
// 外野は実際の定位置(75〜85%)がそのまま「定位置」の帯に入る。
export const POS_BALL = {
  LF: { angle: -25.2, depth: 0.808 },
  CF: { angle: 0, depth: 0.851 },
  RF: { angle: 25.2, depth: 0.808 },
  SS: { angle: -15.5, depth: 0.384 },
  '2B': { angle: 15.5, depth: 0.384 },
  '3B': { angle: -39.2, depth: 0.347 },
  '1B': { angle: 39.2, depth: 0.347 },
  P: { angle: 0, depth: 0.202 },
  C: { angle: 0, depth: 0.074 },
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

// チップを描く位置(パッド内の割合)。極座標から毎回引き直すので、
// 縮尺を変えてもチップと当たり判定がずれない。
export const POS_PAD = Object.fromEntries(
  Object.entries(POS_BALL).map(([k, v]) => [k, ballToPadPoint(v.angle, v.depth)]),
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
// 境界は実際の球場に合わせる: 内野の土の縁が約47m、外野手の定位置が75〜85m。
export const DEPTH_BANDS = [
  { key: 'infield', max: 0.47 },
  { key: 'shallow', max: 0.65 },
  { key: 'normal', max: 0.86 },
  { key: 'deep', max: 0.95 },
  { key: 'wall', max: 1.0 },
  { key: 'over', max: Infinity }, // 柵越え
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
    if (depth >= 0.55) return 'hard';   // 内野を抜けた
    if (depth <= 0.28) return 'weak';   // 手前で止まった
    return null;                        // 内野の普通のゴロは深さでは分からない
  }
  if (outType === 'fly') {
    if (depth >= 0.88) return 'hard';
    if (depth <= 0.62) return 'weak';   // 外野の前に落ちる/詰まった
    return null;
  }
  if (outType === 'liner') {
    if (depth >= 0.76) return 'hard';
    if (depth <= 0.50) return 'weak';
    return null;
  }
  return null;
}

// ---- 描画側の幾何(スプレーチャート: viewBox 100x92 / 本塁 (50,90)) ----
//
// 入力パッドと同じ作りにする。フェンスを図の外周ではなく内側に置き、
// 外にスタンドを描く。以前は柵が外周だったので、柵越えの打球を柵の上に
// 押し込むしかなく、本塁打が「フェンス際の当たり」と同じ場所に見えていた。
// 縮尺も実際の球場に合わせる(内野が縦の6割を占めていた)。
export const CHART = { hx: 50, hy: 90, w: 100, h: 92 };
// フェンスまでの距離(図の単位)。左右のポールが図の幅にちょうど収まり、
// 中堅の柵の上に20ぶんスタンドが残る大きさにする
export const CHART_FENCE = 70;
// 内野の土の縁(深さ0.47)と、スタンドの外側(この深さで切って描く)
export const CHART_DIRT = DEPTH_BANDS[0].max;
export const CHART_MAX = 1.18;

// 極座標 → スプレーチャート上の点。フェンスは角度によらず同じ距離(円形)。
// 入力パッドと同じ扱いにしておかないと、押した位置と出る位置がずれる。
export function chartPoint(angle, depth) {
  const rad = (angle * Math.PI) / 180;
  const r = depth * CHART_FENCE;
  return [CHART.hx + r * Math.sin(rad), CHART.hy - r * Math.cos(rad)];
}

// 深さ d の円弧を、扇形(ファウルライン内)として描くための path。
// 芝・土・ワーニングゾーンの塗り分けに使う
export function chartFan(depth) {
  const [lx, ly] = chartPoint(-45, depth);
  const [rx, ry] = chartPoint(45, depth);
  const r = (depth * CHART_FENCE).toFixed(2);
  return `M${CHART.hx},${CHART.hy} L${lx.toFixed(2)},${ly.toFixed(2)} A${r},${r} 0 0 1 ${rx.toFixed(2)},${ry.toFixed(2)} Z`;
}

// 打席1件から描画用の極座標を取り出す。
// 角度がなければ守備位置から補う(古い記録も同じ図に並べるため)。
// 戻り値の exact で「実際に押された点」か「守備位置からの推定」かが分かる。
export function ballOf(ab) {
  if (ab && ab.hitAngle != null && ab.hitDepth != null) {
    return { angle: ab.hitAngle, depth: ab.hitDepth, exact: true, foul: isFoul(ab.hitAngle) };
  }
  const p = ab && POS_BALL[ab.direction];
  if (!p) return null;
  return { angle: p.angle, depth: p.depth, exact: false, foul: false };
}

// ファウルかどうかは角度だけで決まる。専用の項目を足さないのは、
// 足すと「角度はファウルなのに項目はフェア」という食い違いが起こりうるため。
// 角度の無い古い記録はフェア扱い(そもそもファウルを記録できなかった)。
export const isFoul = (angle) => angle != null && Math.abs(angle) > 45;

// ---- 区画(角度5 × 深さ3) ----
// 数が増えたら1本ずつではなく区画の濃淡で見せる。
// 濃淡だけだと印象論になるので件数も併記する。日本のスコアブックに
// 昔からある「打球方向図」と同じ考え方。
export const ZONE_SLICES = 5;
export const ZONE_RINGS = [0, 0.47, 0.86, Infinity]; // 内野 / 外野前〜定位置 / 深い〜柵際
export const ZONE_COUNT = ZONE_SLICES * (ZONE_RINGS.length - 1);

export function zoneOf(angle, depth) {
  const si = Math.max(0, Math.min(ZONE_SLICES - 1, Math.floor((angle + 45) / (90 / ZONE_SLICES))));
  let ri = 0;
  while (ri < ZONE_RINGS.length - 2 && depth >= ZONE_RINGS[ri + 1]) ri += 1;
  return si + ri * ZONE_SLICES;
}

// 区画の輪郭(SVG path)。chartPoint 経由なので、外周がフェンスとぴったり合う
export function zonePath(si, ri) {
  const step = 90 / ZONE_SLICES;
  const t0 = -45 + si * step;
  const t1 = t0 + step;
  const f0 = ZONE_RINGS[ri];
  const f1 = ZONE_RINGS[ri + 1] === Infinity ? CHART_MAX : ZONE_RINGS[ri + 1];
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
  const f1 = ZONE_RINGS[ri + 1] === Infinity ? CHART_MAX : ZONE_RINGS[ri + 1];
  return chartPoint(th, (ZONE_RINGS[ri] + f1) / 2);
}

// 打席の集まりから区画ごとの件数を作る
export function zoneCounts(atBats = []) {
  const counts = new Array(ZONE_COUNT).fill(0);
  let placed = 0;
  for (const ab of atBats) {
    const b = ballOf(ab);
    // ファウルには区画が無い(区画はフェアゾーンの5分割)。
    // zoneOf は範囲外を端の区画に丸めるので、入れると端の件数が水増しされる
    if (!b || b.foul) continue;
    counts[zoneOf(b.angle, Math.min(b.depth, 1.05))] += 1;
    placed += 1;
  }
  return { counts, placed };
}

// ---- 入力パッドに重ねる目印の幾何(viewBox 1000 × 920) ----
//
// 押した点を拡大して見せる(ルーペ)のはやめた。芝には拡大するほどの細部が
// 無く、レンズは図の1/3を覆うだけで情報が増えなかった。
// 代わりに、指で隠れる半径(およそ25px)の外側に目印を置く。層は2つ:
//
//   粗い層 … いまいる深さの帯と方向のくさびが光る。何が記録されるかが
//            図の広い面積で分かるので、遠目でも指が乗っていても読める
//   精密な層 … 打点を中心にした同心円。中心が指で隠れていても、輪の対称性
//              から目が中心を復元する(人の視覚がとくに得意な処理)
//
// 帯は「定位置」までしか言えないので、いまの正確な深さを弧1本で足す。
// この弧はそのまま左の深さ目盛りへ届く。
//
// viewBox の縦横比は PAD_ASPECT と一致させること。ずれると円が楕円になる。
export const PAD_VB = { w: 1000, h: 1000 * PAD_ASPECT };
export const PAD_MAX = 1.18;          // スタンドまで描く深さ
// ファウルグラウンドを描く角度。パッドの下の隅で ±89度まで届くので、
// そこまで塗っておけば「押せる場所」と絵が食い違わない
export const PAD_FOUL_MAX = 89;
export const PAD_LABEL_DEPTH = 1.10;  // 方向名を置く深さ(柵の外)

const padHome = { x: PAD_VB.w * HOME_X, y: PAD_VB.w * HOME_Y };
export const padRadius = (depth) => depth * PAD_FENCE * PAD_VB.w;
export function padPoint(angle, depth) {
  const rad = (angle * Math.PI) / 180;
  const r = padRadius(depth);
  return [padHome.x + r * Math.sin(rad), padHome.y - r * Math.cos(rad)];
}

const f1 = (n) => n.toFixed(1);

// 深さ depth の円弧(角度 a1 → a2)
export function padArc(a1, a2, depth) {
  const [x1, y1] = padPoint(a1, depth);
  const [x2, y2] = padPoint(a2, depth);
  const r = f1(padRadius(depth));
  return `M${f1(x1)},${f1(y1)} A${r},${r} 0 0 1 ${f1(x2)},${f1(y2)}`;
}

// 帯(内外の深さ) × 角度 のセクター。帯・くさび・その重なりを同じ式で描く
export function padSector(a1, a2, dIn, dOut) {
  const [ox1, oy1] = padPoint(a1, dOut);
  const [ox2, oy2] = padPoint(a2, dOut);
  const [ix2, iy2] = padPoint(a2, dIn);
  const [ix1, iy1] = padPoint(a1, dIn);
  const rO = f1(padRadius(dOut));
  const rI = padRadius(dIn);
  const back = rI > 0.5
    ? `A${f1(rI)},${f1(rI)} 0 0 0 ${f1(ix1)},${f1(iy1)}`
    : `L${f1(ix1)},${f1(iy1)}`;
  return `M${f1(ox1)},${f1(oy1)} A${rO},${rO} 0 0 1 ${f1(ox2)},${f1(oy2)} `
    + `L${f1(ix2)},${f1(iy2)} ${back} Z`;
}

// 方向のくさび。スプレーチャートの区画(ZONE_SLICES)と同じ5分割にして、
// 入力のときに光る範囲と、あとから見る集計の粒度を揃える
export function padWedge(angle) {
  const step = 90 / ZONE_SLICES;
  const i = Math.max(0, Math.min(ZONE_SLICES - 1, Math.floor((angle + 45) / step)));
  return { i, a1: -45 + i * step, a2: -45 + (i + 1) * step };
}

// いま光らせる深さの帯の内外。柵越えは無限なので図の外周で止める
export function padBandRange(depth) {
  const i = DEPTH_BANDS.findIndex((b) => depth < b.max);
  const k = i < 0 ? DEPTH_BANDS.length - 1 : i;
  const max = DEPTH_BANDS[k].max;
  return {
    key: DEPTH_BANDS[k].key,
    dIn: k === 0 ? 0 : DEPTH_BANDS[k - 1].max,
    dOut: Math.min(max === Infinity ? PAD_MAX : max, PAD_MAX),
  };
}

// 方向名を置く位置(パッド内の割合)。打点の真上(打球が飛んでいく先)の
// スタンドに置く。くさびの中心ではなく実際の角度に置くのは、名前が最寄りの
// チップ(9分割)で決まるのに対し、くさびは5分割なので、両者がずれると
// 「左翼」の札が三塁寄りの角に出てしまうため。
//
// 一塁・三塁の方向はそのままだと図の外に出て、枠に切られて字が読めない。
// 中央揃えのまま座標を引き戻すやり方だと、札の幅ぶんの余白を知っている
// 必要があり、「ファウル 三塁」のように字数が増えた瞬間にまた切れる。
// そこで端に近いときは中央揃えをやめて枠の端に寄せる。
// こうすると札がどれだけ長くても、はみ出しようがない。
export function padLabelPoint(angle, margin = 0.17) {
  const p = ballToPadPoint(angle, PAD_LABEL_DEPTH);
  const fy = Math.max(0.045, Math.min(0.955, p.fy));
  if (p.fx < margin) return { anchor: 'edge-l', fx: 0, fy };
  if (p.fx > 1 - margin) return { anchor: 'edge-r', fx: 1, fy };
  return { anchor: 'center', fx: p.fx, fy };
}

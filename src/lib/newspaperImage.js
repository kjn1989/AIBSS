// ============================================================
// (チーム名)速報！: AIが書いた記事(見出し/本文/講評)＋任意の写真を
// Canvasで「スポーツ新聞の一面」風レイアウトに合成しPNGを生成する。
// ※ Geminiは画像を生成しない(テキストのみ)。レイアウト・配色はすべて自作。
//
// 構成: マスト(チーム名速報！+右上ロゴ) → 見出し → 赤リード →
//       イニング別ボックススコア → 写真 → 本文 → 記者の目 → フッター
// 写真は枠(レターボックス)を出さず実比率で配置:
//  - 横長写真 → 全幅の大きなトップ写真(バナー)
//  - 縦・スクエア写真 → 右に配置し、本文を左に回り込ませて余白を埋める
// ============================================================
import { computeBoxScore } from './boxscore.js';

const W = 840;
const M = 48; // 余白
const CW = W - M * 2; // 本文幅 = 744
const GAP = 22; // 写真と本文の間隔

const SANS = (px, weight = 900) => `${weight} ${px}px 'Hiragino Sans', sans-serif`;
const HEAD_FONT = (px) => `bold ${px}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
const BODY_FONT = (px) => `${px}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;

const CAPTION_H = 20;
const BODY_FS = 22;
const BODY_LH = 34;

// 日本語(スペース区切りなし)を幅で折り返す
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

// 本文をレイアウト(0基準のy)。floatPhoto={leftColW, photoH}指定時は、写真の高さぶんだけ
// 左カラム幅(leftColW)で折り返し、写真より下は全幅に戻す(縦写真の回り込み)。
function layoutBody(measure, text, floatPhoto) {
  measure.font = BODY_FONT(BODY_FS);
  const narrowUntil = floatPhoto ? floatPhoto.photoH : 0;
  const narrowW = floatPhoto ? floatPhoto.leftColW : CW;
  const lines = [];
  const chars = [...String(text ?? '')];
  let y = 0, i = 0;
  while (i < chars.length) {
    const maxW = y < narrowUntil ? narrowW : CW;
    let line = '';
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === '\n') { i++; break; }
      if (measure.measureText(line + ch).width > maxW && line) break;
      line += ch; i++;
    }
    lines.push({ text: line, y });
    y += BODY_LH;
  }
  const bodyEnd = y;
  const regionH = floatPhoto ? Math.max(bodyEnd, floatPhoto.photoH + CAPTION_H) : bodyEnd;
  return { lines, regionH };
}

// ブランドロゴ(点線オービット+ダイヤ+塁ノード)を中心(cx,cy)にsize pxで描く。
function drawLogo(ctx, cx, cy, size) {
  const s = size / 128;
  const P = (px, py) => [cx + (px - 64) * s, cy + (py - 64) * s];
  ctx.save();
  ctx.strokeStyle = 'rgba(242,161,95,0.6)';
  ctx.lineWidth = 1.4 * s;
  ctx.setLineDash([2 * s, 7 * s]);
  ctx.beginPath();
  ctx.arc(cx, cy, 54 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 5 * s;
  ctx.lineJoin = 'round';
  const d = [[64, 20], [108, 64], [64, 108], [20, 64]].map(([x, y]) => P(x, y));
  ctx.beginPath();
  ctx.moveTo(d[0][0], d[0][1]);
  for (let i = 1; i < d.length; i++) ctx.lineTo(d[i][0], d[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#2DD4BF';
  for (const [x, y] of [[64, 20], [108, 64], [64, 108], [20, 64]]) {
    const [px, py] = P(x, y);
    ctx.beginPath();
    ctx.arc(px, py, 7 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#E8B44C';
  const [hx, hy] = P(64, 64);
  ctx.beginPath();
  ctx.arc(hx, hy, 8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function fitFont(measure, text, maxW, startPx, fontOf, minPx = 11) {
  let px = startPx;
  measure.font = fontOf(px);
  while (px > minPx && measure.measureText(text).width > maxW) {
    px -= 1;
    measure.font = fontOf(px);
  }
  return px;
}

export async function generateNewspaperImage({ article, game, teamName, photo }) {
  const measure = document.createElement('canvas').getContext('2d');

  // ---- 写真の向き判定 ----
  const hasPhoto = !!photo;
  const wide = hasPhoto && photo.width >= photo.height * 1.15; // 横長→全幅バナー
  const portrait = hasPhoto && !wide; // 縦・スクエア→右配置+本文回り込み

  // ---- マストヘッド「(チーム名) 速報！」を幅に合わせて自動縮小(右上ロゴぶんを避ける) ----
  const logoSize = 54;
  const mastMaxW = CW - 2 * (logoSize + 18);
  const mastText = `${teamName} 速報！`;
  const mastFs = fitFont(measure, mastText, mastMaxW, 58, (px) => SANS(px), 28);
  const mastH = mastFs + 12;

  // ---- 見出し・リード(常に全幅) ----
  measure.font = HEAD_FONT(40);
  const headlineLines = wrap(measure, article.headline, CW);
  measure.font = HEAD_FONT(22);
  const subheadLines = wrap(measure, article.subhead, CW);
  const headBlock = headlineLines.length * 50;
  const leadBlock = subheadLines.length * 30;

  // ---- ボックススコア(プレイした回だけ=空白マス無し) ----
  const box = computeBoxScore(game);
  const playedInnings = box.innings.filter((v) => v.played);
  const innings = playedInnings.length ? playedInnings : box.innings;
  const rowH = 34;
  const tableH = rowH * 3;

  // ---- 写真+本文 ----
  let bannerH = 0, photoW = 0, photoH = 0, leftColW = 0;
  let bodyLayout, mediaH;
  if (wide) {
    bannerH = Math.round(CW * photo.height / photo.width);
    bodyLayout = layoutBody(measure, article.body, null);
    mediaH = bannerH + 6 + CAPTION_H + 12 + bodyLayout.regionH;
  } else if (portrait) {
    photoW = Math.round(CW * 0.44);
    photoH = Math.round(photoW * photo.height / photo.width);
    leftColW = CW - photoW - GAP;
    bodyLayout = layoutBody(measure, article.body, { leftColW, photoH });
    mediaH = bodyLayout.regionH;
  } else {
    bodyLayout = layoutBody(measure, article.body, null);
    mediaH = bodyLayout.regionH;
  }

  measure.font = BODY_FONT(20);
  const commentLines = article.comment ? wrap(measure, article.comment, CW - 20) : [];

  // ---- 総高さ ----
  let H = M + 10;
  H += mastH + 8 + 24 + 20; // マスト + 罫 + 日付行 + 罫
  H += headBlock + 6 + leadBlock + 12; // 見出し + リード
  H += tableH + 8 + 22 + 20; // スコア表 + 結果ラベル
  H += mediaH + 12; // 写真 + 本文
  if (commentLines.length) H += 28 + commentLines.length * 28 + 12;
  H += 8 + 28; // フッター
  H += M;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = '#f5f1e6';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#141414';

  let y = M + 10;

  // ---- マストヘッド + 右上ロゴ ----
  ctx.textAlign = 'center';
  ctx.font = SANS(mastFs);
  ctx.fillText(mastText, W / 2, y + mastFs * 0.82);
  drawLogo(ctx, W - M - logoSize / 2, y + mastH / 2, logoSize);
  y += mastH;
  ctx.fillStyle = '#141414';
  ctx.fillRect(M, y, CW, 3);
  y += 8;
  ctx.font = BODY_FONT(16);
  ctx.fillText(`${game.date}　|　号外　|　第1号`, W / 2, y + 16);
  y += 24;
  ctx.fillRect(M, y, CW, 1);
  y += 20;
  ctx.textAlign = 'left';

  // ---- 見出し ----
  ctx.font = HEAD_FONT(40);
  ctx.fillStyle = '#141414';
  for (const line of headlineLines) { ctx.fillText(line, M, y + 40); y += 50; }
  y += 6;
  // ---- 赤リード ----
  ctx.font = HEAD_FONT(22);
  ctx.fillStyle = '#b3402f';
  for (const line of subheadLines) { ctx.fillText(line, M, y + 22); y += 30; }
  ctx.fillStyle = '#141414';
  y += 12;

  // ---- スコア表 + 結果ラベル ----
  drawBoxScore(ctx, measure, M, y, CW, rowH, innings, box, game, teamName);
  y += tableH + 8;
  const rlabel = game.myScore > game.oppScore ? '勝利' : game.myScore < game.oppScore ? '敗北' : '引き分け';
  ctx.textAlign = 'center';
  ctx.font = HEAD_FONT(18);
  ctx.fillStyle = '#141414';
  ctx.fillText(`${teamName} ${game.myScore}-${game.oppScore} ${game.opponent || '対戦相手'}　—　${rlabel}`, W / 2, y + 18);
  ctx.textAlign = 'left';
  y += 22 + 20;

  // ---- 写真 + 本文 ----
  const drawBody = (startY) => {
    ctx.font = BODY_FONT(BODY_FS);
    ctx.fillStyle = '#141414';
    for (const ln of bodyLayout.lines) ctx.fillText(ln.text, M, startY + ln.y + BODY_FS);
  };
  if (wide) {
    ctx.drawImage(photo, M, y, CW, bannerH);
    let cy = y + bannerH + 6;
    ctx.fillStyle = '#555';
    ctx.font = BODY_FONT(15);
    ctx.fillText(`▲ ${teamName} vs ${game.opponent || '対戦相手'}（${game.date}）`, M, cy + 14);
    ctx.fillStyle = '#141414';
    cy += CAPTION_H + 12;
    drawBody(cy);
    y = cy + bodyLayout.regionH + 12;
  } else if (portrait) {
    const px = M + leftColW + GAP;
    ctx.drawImage(photo, px, y, photoW, photoH);
    ctx.fillStyle = '#555';
    ctx.font = BODY_FONT(13);
    ctx.fillText(`▲ ${teamName} vs ${game.opponent || '対戦相手'}`, px, y + photoH + 14);
    ctx.fillStyle = '#141414';
    drawBody(y); // 本文は写真の左に回り込み、写真より下は全幅
    y += mediaH + 12;
  } else {
    drawBody(y);
    y += mediaH + 12;
  }

  // ---- 記者の目(講評) ----
  if (commentLines.length) {
    ctx.font = HEAD_FONT(18);
    ctx.fillText('― 記者の目 ―', M, y + 18);
    y += 28;
    ctx.font = BODY_FONT(20);
    for (const line of commentLines) {
      ctx.fillText(line, M + 16, y + 20);
      y += 28;
    }
    y += 12;
  }

  // ---- フッター ----
  ctx.fillStyle = '#141414';
  ctx.fillRect(M, y, CW, 1);
  y += 8;
  ctx.fillStyle = '#555';
  ctx.font = BODY_FONT(16);
  ctx.fillText('AI-BASE DIAMOND — AI野球スコア&成績', M, y + 16);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// イニング別ボックススコア表(先攻=上段。R/H/Eは右端で強調)。innings=表示する回(空白マス無し)
function drawBoxScore(ctx, measure, x, y, w, rowH, innings, box, game, teamName) {
  const oppName = game.opponent || '対戦相手';
  const innN = innings.length;
  const cols = innN + 3; // + R H E
  const teamColW = 150;
  const cellW = (w - teamColW) / cols;
  const tableH = rowH * 3;
  const rheX = x + teamColW + innN * cellW;

  const myRow = { name: teamName, inn: innings.map((v) => v.my), r: box.my.r, h: box.my.h, e: box.my.e };
  const oppRow = { name: oppName, inn: innings.map((v) => v.opp), r: box.opp.r, h: box.opp.h, e: box.opp.e };
  const topRow = game.isHome ? oppRow : myRow; // 先攻(ビジター)を上段に
  const botRow = game.isHome ? myRow : oppRow;

  ctx.strokeStyle = 'rgba(20,20,20,0.22)';
  ctx.lineWidth = 1;
  for (let i = 1; i < innN; i++) { const vx = x + teamColW + i * cellW; line(ctx, vx, y, vx, y + tableH); }
  for (let i = 1; i < 3; i++) { const vx = rheX + i * cellW; line(ctx, vx, y, vx, y + tableH); }
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, tableH);
  line(ctx, x + teamColW, y, x + teamColW, y + tableH);
  line(ctx, rheX, y, rheX, y + tableH);
  line(ctx, x, y + rowH, x + w, y + rowH);
  line(ctx, x, y + rowH * 2, x + w, y + rowH * 2);

  const cx = (col) => x + teamColW + col * cellW + cellW / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = SANS(14, 700);
  ctx.fillStyle = '#141414';
  for (let i = 0; i < innN; i++) ctx.fillText(String(innings[i].inning), cx(i), y + rowH / 2);
  ctx.fillText('R', cx(innN), y + rowH / 2);
  ctx.fillText('H', cx(innN + 1), y + rowH / 2);
  ctx.fillText('E', cx(innN + 2), y + rowH / 2);

  const rows = [topRow, botRow];
  for (let r = 0; r < 2; r++) {
    const row = rows[r];
    const ry = y + rowH * (r + 1) + rowH / 2;
    ctx.textAlign = 'left';
    const nameFs = fitFont(measure, row.name, teamColW - 16, 17, HEAD_FONT, 11);
    ctx.font = HEAD_FONT(nameFs);
    ctx.fillText(row.name, x + 10, ry);
    ctx.textAlign = 'center';
    ctx.font = SANS(16, 600);
    for (let i = 0; i < innN; i++) ctx.fillText(String(row.inn[i]), cx(i), ry);
    ctx.font = SANS(18, 800);
    ctx.fillText(String(row.r), cx(innN), ry);
    ctx.font = SANS(16, 600);
    ctx.fillText(String(row.h), cx(innN + 1), ry);
    ctx.fillText(String(row.e), cx(innN + 2), ry);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// 画像を共有(Web Share) / 不可ならダウンロード
export async function shareNewspaperImage(blob, game) {
  if (!blob) return;
  const file = new File([blob], `AIスポーツ新聞_${game.date}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'AIスポーツ新聞' });
      return;
    } catch {
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// (チーム名)速報！: AIが書いた記事(見出し/本文/講評)＋任意の写真を
// Canvasで「スポーツ新聞の一面」風レイアウトに合成しPNGを生成する。
// ※ Geminiは画像を生成しない(テキストのみ)。レイアウト・配色はすべて自作。
//
// 写真は枠(レターボックス)を出さず実比率で配置:
//  - 横長写真 → 全幅の大きなトップ写真(バナー)
//  - 縦・スクエア写真 → L字回り込み(右に写真・左に見出し+リード)
// マストヘッド右上にブランドロゴ、本文下にイニング別ボックススコアを配置。
// ============================================================
import { computeBoxScore } from './boxscore.js';

const W = 840;
const M = 48; // 余白
const CW = W - M * 2; // 本文幅 = 744

const SANS = (px, weight = 900) => `${weight} ${px}px 'Hiragino Sans', sans-serif`;
const HEAD_FONT = (px) => `bold ${px}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;
const BODY_FONT = (px) => `${px}px 'Hiragino Mincho ProN', 'Yu Mincho', serif`;

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

// ブランドロゴ(点線オービット+ダイヤ+塁ノード)を中心(cx,cy)にsize pxで描く。
// 新聞紙面向けに、ダイヤは黒インク・塁ノードはティール・本塁は金・オービットは淡いオレンジ。
function drawLogo(ctx, cx, cy, size) {
  const s = size / 128;
  const P = (px, py) => [cx + (px - 64) * s, cy + (py - 64) * s];
  ctx.save();
  // オービット(点線円)
  ctx.strokeStyle = 'rgba(242,161,95,0.6)';
  ctx.lineWidth = 1.4 * s;
  ctx.setLineDash([2 * s, 7 * s]);
  ctx.beginPath();
  ctx.arc(cx, cy, 54 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // ダイヤ枠(黒インク)
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 5 * s;
  ctx.lineJoin = 'round';
  const d = [[64, 20], [108, 64], [64, 108], [20, 64]].map(([x, y]) => P(x, y));
  ctx.beginPath();
  ctx.moveTo(d[0][0], d[0][1]);
  for (let i = 1; i < d.length; i++) ctx.lineTo(d[i][0], d[i][1]);
  ctx.closePath();
  ctx.stroke();
  // 塁ノード(ティール)
  ctx.fillStyle = '#2DD4BF';
  for (const [x, y] of [[64, 20], [108, 64], [64, 108], [20, 64]]) {
    const [px, py] = P(x, y);
    ctx.beginPath();
    ctx.arc(px, py, 7 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // 本塁ノード(金)
  ctx.fillStyle = '#E8B44C';
  const [hx, hy] = P(64, 64);
  ctx.beginPath();
  ctx.arc(hx, hy, 8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 幅に収まるフォントサイズを返す(serif/sans兼用: fontOf(px)でフォント文字列を作る)
function fitFont(measure, text, maxW, startPx, fontOf, minPx = 12) {
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
  const lshape = hasPhoto && !wide; // 縦・スクエア→L字回り込み

  // ---- マストヘッド「(チーム名) 速報！」を幅に合わせて自動縮小(右上ロゴぶんを避ける) ----
  const logoSize = 54;
  const mastMaxW = CW - 2 * (logoSize + 18);
  const mastText = `${teamName} 速報！`;
  let mastFs = 58;
  measure.font = SANS(mastFs);
  while (mastFs > 28 && measure.measureText(mastText).width > mastMaxW) {
    mastFs -= 2;
    measure.font = SANS(mastFs);
  }
  const mastH = mastFs + 12;

  // ---- L字の寸法(縦写真のとき) ----
  const gap = 22;
  let pcolW = 0, pcolH = 0;
  let leftW = CW;
  if (lshape) {
    pcolW = Math.round(CW * 0.46);
    pcolH = Math.round(pcolW * photo.height / photo.width);
    leftW = CW - pcolW - gap;
  }

  // ---- テキスト折返し ----
  const headFs = lshape ? 34 : 40;
  const headLh = lshape ? 44 : 50;
  measure.font = HEAD_FONT(headFs);
  const headlineLines = wrap(measure, article.headline, leftW);
  measure.font = HEAD_FONT(22);
  const subheadLines = wrap(measure, article.subhead, leftW);
  measure.font = BODY_FONT(22);
  const bodyLines = wrap(measure, article.body, CW);
  measure.font = BODY_FONT(20);
  const commentLines = article.comment ? wrap(measure, article.comment, CW - 20) : [];

  const headBlock = headlineLines.length * headLh;
  const subBlock = subheadLines.length * 30;
  const leftTextH = headBlock + 6 + subBlock;
  const captionH = 20;

  let bannerH = 0;
  let topBlockH;
  if (wide) {
    bannerH = Math.round(CW * photo.height / photo.width);
    topBlockH = leftTextH + 12 + bannerH + 6 + captionH;
  } else if (lshape) {
    topBlockH = Math.max(pcolH + 6 + captionH, leftTextH);
  } else {
    topBlockH = leftTextH;
  }

  // ---- ボックススコア表の寸法 ----
  const box = computeBoxScore(game);
  const rowH = 34;
  const tableH = rowH * 3; // ヘッダ + 2チーム

  // ---- 総高さ算出(描画のy加算と一致させる) ----
  let H = M + 10;
  H += mastH + 8 + 24 + 20; // マスト + 罫 + 日付行 + 罫
  H += topBlockH + 12;
  H += bodyLines.length * 34 + 12;
  H += tableH + 8 + 22 + 20; // 線スコア表 + 結果ラベル
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

  // ---- マストヘッド: (チーム名) 速報！ + 右上ロゴ ----
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

  const caption = `▲ ${teamName} vs ${game.opponent || '対戦相手'}（${game.date}）`;
  const topY = y;

  const drawHeadAndLead = (x, startY) => {
    let ly = startY;
    ctx.font = HEAD_FONT(headFs);
    ctx.fillStyle = '#141414';
    for (const line of headlineLines) { ctx.fillText(line, x, ly + headFs); ly += headLh; }
    ly += 6;
    ctx.font = HEAD_FONT(22);
    ctx.fillStyle = '#b3402f';
    for (const line of subheadLines) { ctx.fillText(line, x, ly + 22); ly += 30; }
    ctx.fillStyle = '#141414';
    return ly;
  };

  if (wide) {
    let ly = drawHeadAndLead(M, topY);
    ly += 12;
    ctx.drawImage(photo, M, ly, CW, bannerH);
    ly += bannerH + 6;
    ctx.fillStyle = '#555';
    ctx.font = BODY_FONT(15);
    ctx.fillText(caption, M, ly + 14);
    ctx.fillStyle = '#141414';
  } else if (lshape) {
    drawHeadAndLead(M, topY);
    const px = M + leftW + gap;
    ctx.drawImage(photo, px, topY, pcolW, pcolH);
    ctx.fillStyle = '#555';
    ctx.font = BODY_FONT(13);
    ctx.fillText(`▲ ${teamName} vs ${game.opponent || '対戦相手'}`, px, topY + pcolH + 14);
    ctx.fillStyle = '#141414';
  } else {
    drawHeadAndLead(M, topY);
  }
  y = topY + topBlockH + 12;

  // ---- 本文 ----
  ctx.font = BODY_FONT(22);
  ctx.fillStyle = '#141414';
  for (const line of bodyLines) {
    ctx.fillText(line, M, y + 22);
    y += 34;
  }
  y += 12;

  // ---- ボックススコア表(イニング別 R/H/E) ----
  drawBoxScore(ctx, measure, M, y, CW, rowH, box, game, teamName);
  y += tableH + 8;
  // 結果ラベル(中央)
  const rlabel = game.myScore > game.oppScore ? '勝利' : game.myScore < game.oppScore ? '敗北' : '引き分け';
  ctx.textAlign = 'center';
  ctx.font = HEAD_FONT(18);
  ctx.fillStyle = '#141414';
  ctx.fillText(`${teamName} ${game.myScore}-${game.oppScore} ${game.opponent || '対戦相手'}　—　${rlabel}`, W / 2, y + 18);
  ctx.textAlign = 'left';
  y += 22 + 20;

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

// イニング別ボックススコア表を描く(先攻=上段。R/H/Eは右端で強調)
function drawBoxScore(ctx, measure, x, y, w, rowH, box, game, teamName) {
  const oppName = game.opponent || '対戦相手';
  const innN = box.innings.length;
  const cols = innN + 3; // + R H E
  const teamColW = 150;
  const cellW = (w - teamColW) / cols;
  const tableH = rowH * 3;
  const rheX = x + teamColW + innN * cellW;

  const myRow = { name: teamName, inn: box.innings.map((v) => v.my), r: box.my.r, h: box.my.h, e: box.my.e };
  const oppRow = { name: oppName, inn: box.innings.map((v) => v.opp), r: box.opp.r, h: box.opp.h, e: box.opp.e };
  const played = box.innings.map((v) => v.played);
  const topRow = game.isHome ? oppRow : myRow; // 先攻(ビジター)を上段に
  const botRow = game.isHome ? myRow : oppRow;

  // 薄い縦罫(イニング間・RHE間)
  ctx.strokeStyle = 'rgba(20,20,20,0.22)';
  ctx.lineWidth = 1;
  for (let i = 1; i < innN; i++) { const vx = x + teamColW + i * cellW; line(ctx, vx, y, vx, y + tableH); }
  for (let i = 1; i < 3; i++) { const vx = rheX + i * cellW; line(ctx, vx, y, vx, y + tableH); }
  // 太罫(外枠・チーム列・RHE区切り・行区切り)
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

  // ヘッダ行: イニング番号 + R H E
  ctx.font = SANS(14, 700);
  ctx.fillStyle = '#141414';
  for (let i = 0; i < innN; i++) ctx.fillText(String(box.innings[i].inning), cx(i), y + rowH / 2);
  ctx.fillText('R', cx(innN), y + rowH / 2);
  ctx.fillText('H', cx(innN + 1), y + rowH / 2);
  ctx.fillText('E', cx(innN + 2), y + rowH / 2);

  // チーム2行
  const rows = [topRow, botRow];
  for (let r = 0; r < 2; r++) {
    const row = rows[r];
    const ry = y + rowH * (r + 1) + rowH / 2;
    // チーム名(左寄せ・幅に合わせて縮小)
    ctx.textAlign = 'left';
    const nameFs = fitFont(measure, row.name, teamColW - 16, 17, HEAD_FONT, 11);
    ctx.font = HEAD_FONT(nameFs);
    ctx.fillText(row.name, x + 10, ry);
    ctx.textAlign = 'center';
    // イニング得点(未到達は空欄)
    ctx.font = SANS(16, 600);
    for (let i = 0; i < innN; i++) ctx.fillText(played[i] ? String(row.inn[i]) : '', cx(i), ry);
    // R(強調) H E
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

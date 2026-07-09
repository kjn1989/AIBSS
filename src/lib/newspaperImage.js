// ============================================================
// AIスポーツ新聞: AIが書いた記事(見出し/本文/講評)＋任意の写真を
// Canvasで「スポーツ新聞の一面」風レイアウトに合成しPNGを生成する。
// ※ Geminiは画像を生成しない(テキストのみ)。レイアウト・配色はすべて自作。
// ============================================================

const W = 840;
const M = 48; // 余白
const CW = W - M * 2; // 本文幅

const MAST_FONT = (px) => `900 ${px}px 'Hiragino Sans', sans-serif`;
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

export async function generateNewspaperImage({ article, game, teamName, photo }) {
  const measure = document.createElement('canvas').getContext('2d');

  measure.font = HEAD_FONT(40);
  const headlineLines = wrap(measure, article.headline, CW);
  measure.font = HEAD_FONT(22);
  const subheadLines = wrap(measure, article.subhead, CW);
  measure.font = BODY_FONT(22);
  const bodyLines = wrap(measure, article.body, CW);
  measure.font = BODY_FONT(20);
  const commentLines = article.comment ? wrap(measure, article.comment, CW - 20) : [];
  const photoH = photo ? 300 : 0;

  // 描画時のy加算と一致させて総高を算出
  let H = M + 10;
  H += 60 + 8 + 24 + 20; // マストヘッド+罫+日付+罫
  H += headlineLines.length * 50 + 4;
  H += subheadLines.length * 30 + 12;
  if (photo) H += photoH + 6 + 24;
  H += bodyLines.length * 34 + 12;
  H += 72 + 20; // スコアボックス
  if (commentLines.length) H += 28 + commentLines.length * 28 + 12;
  H += 8 + 28; // フッター
  H += M;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // 背景(新聞紙のクリーム色)
  ctx.fillStyle = '#f5f1e6';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#141414';

  let y = M + 10;

  // マストヘッド
  ctx.textAlign = 'center';
  ctx.font = MAST_FONT(54);
  ctx.fillText('AI-BSS スポーツ', W / 2, y + 44);
  y += 60;
  ctx.fillStyle = '#141414';
  ctx.fillRect(M, y, CW, 3);
  y += 8;
  ctx.font = BODY_FONT(16);
  ctx.fillText(`${game.date}　|　${teamName} 号外　|　第1号`, W / 2, y + 16);
  y += 24;
  ctx.fillRect(M, y, CW, 1);
  y += 20;

  // 見出し
  ctx.textAlign = 'left';
  ctx.font = HEAD_FONT(40);
  for (const line of headlineLines) {
    ctx.fillText(line, M, y + 40);
    y += 50;
  }
  y += 4;

  // 小見出し(色つきリード)
  ctx.font = HEAD_FONT(22);
  ctx.fillStyle = '#b3402f';
  for (const line of subheadLines) {
    ctx.fillText(line, M, y + 24);
    y += 30;
  }
  ctx.fillStyle = '#141414';
  y += 12;

  // 写真(任意)
  if (photo) {
    const bx = M, by = y, bw = CW, bh = photoH;
    const r = Math.min(bw / photo.width, bh / photo.height);
    const iw = photo.width * r, ih = photo.height * r;
    ctx.fillStyle = '#ddd7c7';
    ctx.fillRect(bx, by, bw, bh);
    ctx.drawImage(photo, bx + (bw - iw) / 2, by + (bh - ih) / 2, iw, ih);
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    y += bh + 6;
    ctx.fillStyle = '#555';
    ctx.font = BODY_FONT(15);
    ctx.fillText(`▲ ${teamName} vs ${game.opponent || '対戦相手'}（${game.date}）`, M, y + 14);
    ctx.fillStyle = '#141414';
    y += 24;
  }

  // 本文
  ctx.font = BODY_FONT(22);
  for (const line of bodyLines) {
    ctx.fillText(line, M, y + 22);
    y += 34;
  }
  y += 12;

  // スコアボックス
  const boxH = 72;
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 2;
  ctx.strokeRect(M, y, CW, boxH);
  ctx.textAlign = 'center';
  ctx.font = HEAD_FONT(32);
  ctx.fillText(`${teamName}  ${game.myScore} - ${game.oppScore}  ${game.opponent || '対戦相手'}`, W / 2, y + 34);
  const rlabel = game.myScore > game.oppScore ? '勝利' : game.myScore < game.oppScore ? '敗北' : '引き分け';
  ctx.font = BODY_FONT(18);
  ctx.fillText(rlabel, W / 2, y + 60);
  ctx.textAlign = 'left';
  y += boxH + 20;

  // 記者の目(講評)
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

  // フッター
  ctx.fillStyle = '#141414';
  ctx.fillRect(M, y, CW, 1);
  y += 8;
  ctx.fillStyle = '#555';
  ctx.font = BODY_FONT(16);
  ctx.fillText('AI-BSS — AI野球スコア&成績', M, y + 16);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
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

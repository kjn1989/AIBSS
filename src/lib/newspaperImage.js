// ============================================================
// (チーム名)速報！: AIが書いた記事(見出し/本文/講評)＋任意の写真を
// Canvasで「スポーツ新聞の一面」風レイアウトに合成しPNGを生成する。
// ※ Geminiは画像を生成しない(テキストのみ)。レイアウト・配色はすべて自作。
//
// 写真は枠(レターボックス)を出さず実比率で配置:
//  - 横長写真 → 全幅の大きなトップ写真(バナー)
//  - 縦・スクエア写真 → L字回り込み(右に写真・左に見出し+リード)
// ============================================================

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

export async function generateNewspaperImage({ article, game, teamName, photo }) {
  const measure = document.createElement('canvas').getContext('2d');

  // ---- 写真の向き判定 ----
  const hasPhoto = !!photo;
  const wide = hasPhoto && photo.width >= photo.height * 1.15; // 横長→全幅バナー
  const lshape = hasPhoto && !wide; // 縦・スクエア→L字回り込み

  // ---- マストヘッド「(チーム名) 速報！」を幅に合わせて自動縮小 ----
  const mastText = `${teamName} 速報！`;
  let mastFs = 58;
  measure.font = SANS(mastFs);
  while (mastFs > 30 && measure.measureText(mastText).width > CW) {
    mastFs -= 2;
    measure.font = SANS(mastFs);
  }
  const mastH = mastFs + 12;

  // ---- L字の寸法(縦写真のとき) ----
  const gap = 22;
  let pcolW = 0, pcolH = 0;
  let leftW = CW; // 見出し・リードの折返し幅(L字時は左カラム幅)
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

  // 写真+見出しの「トップブロック」高さ
  let bannerH = 0;
  let topBlockH;
  if (wide) {
    bannerH = Math.round(CW * photo.height / photo.width);
    topBlockH = leftTextH + 12 + bannerH + 6 + captionH;
  } else if (lshape) {
    const photoSideH = pcolH + 6 + captionH;
    topBlockH = Math.max(photoSideH, leftTextH);
  } else {
    topBlockH = leftTextH;
  }

  // ---- 総高さ算出(描画のy加算と一致させる) ----
  let H = M + 10;
  H += mastH + 8 + 24 + 20; // マスト + 罫 + 日付行 + 罫
  H += topBlockH + 12;
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

  // ---- マストヘッド: (チーム名) 速報！ ----
  ctx.textAlign = 'center';
  ctx.font = SANS(mastFs);
  ctx.fillText(mastText, W / 2, y + mastFs * 0.82);
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

  const drawHeadAndLead = (x, startY, width) => {
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
    // 見出し+リード(全幅)→ 全幅トップ写真(枠なし)
    let ly = drawHeadAndLead(M, topY, CW);
    ly += 12;
    ctx.drawImage(photo, M, ly, CW, bannerH);
    ly += bannerH + 6;
    ctx.fillStyle = '#555';
    ctx.font = BODY_FONT(15);
    ctx.fillText(caption, M, ly + 14);
    ctx.fillStyle = '#141414';
  } else if (lshape) {
    // 左: 見出し+リード / 右: 縦写真(枠なし)
    drawHeadAndLead(M, topY, leftW);
    const px = M + leftW + gap;
    ctx.drawImage(photo, px, topY, pcolW, pcolH);
    ctx.fillStyle = '#555';
    ctx.font = BODY_FONT(13);
    ctx.fillText(`▲ ${teamName} vs ${game.opponent || '対戦相手'}`, px, topY + pcolH + 14);
    ctx.fillStyle = '#141414';
  } else {
    // 写真なし: 見出し+リード(全幅)
    drawHeadAndLead(M, topY, CW);
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

  // ---- スコアボックス ----
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

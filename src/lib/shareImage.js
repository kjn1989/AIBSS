// ============================================================
// 試合ハイライトのSNS共有用画像(PNG)をCanvasで生成する
// ============================================================

const W = 800;

function drawRow(ctx, y, emoji, label, body) {
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, y - 34);
  ctx.lineTo(W - 60, y - 34);
  ctx.stroke();
  ctx.font = '22px sans-serif';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'left';
  ctx.fillText(`${emoji} ${label}`, 60, y);
  ctx.font = 'bold 27px sans-serif';
  ctx.fillStyle = '#e6edf3';
  ctx.fillText(body, 60, y + 38);
  return y + 92;
}

// 長すぎる行は省略記号で切る
function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

export function generateHighlightImage(game, h, teamName) {
  const rows = [];
  if (h.clutch) rows.push(['🔥', '決勝・勝ち越し打', h.clutch.label]);
  if (h.topBatter) {
    rows.push(['🏅', 'MVP', `${h.topBatter.name} (${h.topBatter.h}安打 ${h.topBatter.rbi}打点${h.topBatter.hr ? ` ${h.topBatter.hr}本塁打` : ''})`]);
  }
  if (h.topPitcher) rows.push(['💪', h.topPitcher.tag, `${h.topPitcher.name} ${h.topPitcher.line}`]);
  for (const t of (h.extraBaseHits || []).slice(0, 3)) rows.push(['⚡', '見どころ', t]);

  const H = 430 + rows.length * 92 + 80;
  const canvas = document.createElement('canvas');
  const scale = 2; // 高解像度(Retina)
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // 背景
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0d1117');
  grad.addColorStop(1, '#161b30');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // 上部アクセントライン
  ctx.fillStyle = '#e3b341';
  ctx.fillRect(0, 0, W, 8);

  // ヘッダー
  ctx.textAlign = 'center';
  ctx.font = '24px sans-serif';
  ctx.fillStyle = '#8b949e';
  ctx.fillText(`⚾ ${game.date}`, W / 2, 70);
  ctx.font = 'bold 34px sans-serif';
  ctx.fillStyle = '#e6edf3';
  ctx.fillText(ellipsize(ctx, `${teamName}  vs  ${game.opponent || '対戦相手'}`, W - 100), W / 2, 122);

  // スコア
  ctx.font = 'bold 120px sans-serif';
  ctx.fillStyle = '#e3b341';
  ctx.fillText(`${game.myScore} - ${game.oppScore}`, W / 2, 260);

  // 勝敗ピル
  const resultLabel = h.resultLabel;
  const pillColor = resultLabel === '勝利' ? '#3fb950' : resultLabel === '敗北' ? '#f85149' : '#8b949e';
  ctx.fillStyle = pillColor;
  const pw = 150;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(W / 2 - pw / 2, 292, pw, 52, 26);
    ctx.fill();
  } else {
    ctx.fillRect(W / 2 - pw / 2, 292, pw, 52); // roundRect未対応ブラウザ
  }
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(resultLabel, W / 2, 328);

  // 明細行
  let y = 430;
  for (const [emoji, label, body] of rows) {
    ctx.font = 'bold 27px sans-serif';
    y = drawRow(ctx, y, emoji, label, ellipsize(ctx, body, W - 120));
  }

  // フッター
  ctx.textAlign = 'center';
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#8b949e';
  ctx.fillText('AIBSS — 音声実況スコアラー', W / 2, H - 30);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// 画像を共有(Web Share API) / 不可ならダウンロードにフォールバック
export async function shareHighlightImage(game, h, teamName) {
  const blob = await generateHighlightImage(game, h, teamName);
  if (!blob) return;
  const file = new File([blob], `試合結果_${game.date}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '試合結果' });
      return;
    } catch {
      return; // ユーザーキャンセル
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

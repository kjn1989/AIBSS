// AI-BASE 高視認性LEDロゴ資産の生成(LINE等の小さな丸アイコンでも読める最終ロゴデータ)。
// 実行: node scripts/gen-brand-assets.mjs
// 出力: public/brand/ 配下に
//   - wordmark-led-hd.svg      … AI◆BASE ワードマーク単体(透過背景)
//   - icon-lockup.svg          … 1024x1024 正方形ロックアップ(ダイヤ+ワードマーク、円形クロップ安全圏内)
//   - icon-lockup-1024.png     … 上記のPNG版(SNSアイコンにそのまま使える)
//
// ※ドットパターン・色は src/components/BrandMark.jsx が単一マスター。
//   ここは静的資産の書き出し専用で、グリフを変更する場合は両方を更新すること。
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/brand');
fs.mkdirSync(outDir, { recursive: true });

// ---- BrandMark.jsx と同一のデザイン定数(高視認性LED仕様) ----
const C = { bg: '#0A0D10', gold: '#E8B44C', teal: '#2DD4BF', ivory: '#F5F1E6', aiGold: '#F4D9A0', off: 'rgba(255,255,255,0.05)', orbit: '#F2A15F' };
const GLYPH = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
};
const SEP = ['010', '101', '010'];

// 高視認性LEDワードマークのSVGマークアップを生成(dot大きめ・gap狭め・高輝度グロウ)
function wordmarkSvg({ dot = 16, gap = 2, letterGap = 6, sepGap = 6, id = 'g' } = {}) {
  const cell = dot + gap;
  const letterW = 5 * dot + 4 * gap;
  const sepDot = dot * 0.6;
  const sepGapPx = Math.max(0.5, gap * 0.75);
  const sepCell = sepDot + sepGapPx;
  const sepW = 3 * sepDot + 2 * sepGapPx;
  const totalH = 7 * dot + 6 * gap;

  const rects = [];
  const rx = Math.max(0.5, dot * 0.2).toFixed(2);
  const glyph = (ch, gx, color) => {
    GLYPH[ch].forEach((row, r) => {
      [...row].forEach((bit, c) => {
        const on = bit === '1';
        rects.push(
          `<rect x="${(gx + c * cell).toFixed(2)}" y="${(r * cell).toFixed(2)}" width="${dot}" height="${dot}" rx="${rx}"` +
            ` fill="${on ? color : C.off}"${on ? ` filter="url(#${id})"` : ''}/>`
        );
      });
    });
  };

  let x = 0;
  glyph('A', x, C.aiGold); x += letterW + letterGap;
  glyph('I', x, C.aiGold); x += letterW;
  const sepX = x + sepGap;
  const sepY = (totalH - (3 * sepDot + 2 * sepGapPx)) / 2;
  SEP.forEach((row, r) => {
    [...row].forEach((bit, c) => {
      const on = bit === '1';
      rects.push(
        `<rect x="${(sepX + c * sepCell).toFixed(2)}" y="${(sepY + r * sepCell).toFixed(2)}" width="${sepDot.toFixed(2)}" height="${sepDot.toFixed(2)}" rx="${(sepDot * 0.2).toFixed(2)}"` +
          ` fill="${on ? C.teal : C.off}"${on ? ` filter="url(#${id})"` : ''}/>`
      );
    });
  });
  x = sepX + sepW + sepGap;
  for (const ch of ['B', 'A', 'S', 'E']) {
    glyph(ch, x, C.ivory);
    x += letterW + (ch !== 'E' ? letterGap : 0);
  }
  const totalW = x;
  const filter =
    `<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%">` +
    `<feGaussianBlur stdDeviation="${(dot * 0.45).toFixed(2)}" result="blur"/>` +
    `<feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  return { w: totalW, h: totalH, body: rects.join('\n  '), filter };
}

// ダイヤモンドアイコン(十字線なし・薄オレンジの点線オービット)を任意位置に描くマークアップ
function diamondSvg() {
  return (
    `<circle cx="64" cy="64" r="54" stroke="${C.orbit}" stroke-width="1.5" pathLength="360" stroke-dasharray="2 7" fill="none" opacity="0.3"/>` +
    `<path d="M64 20 L108 64 L64 108 L20 64 Z" stroke="${C.gold}" stroke-width="5" fill="none" stroke-linejoin="round"/>` +
    `<circle cx="64" cy="20" r="7" fill="${C.teal}"/><circle cx="108" cy="64" r="7" fill="${C.teal}"/>` +
    `<circle cx="64" cy="108" r="7" fill="${C.teal}"/><circle cx="20" cy="64" r="7" fill="${C.teal}"/>` +
    `<circle cx="64" cy="64" r="9" fill="${C.ivory}"/>`
  );
}

// ① ワードマーク単体(透過)
{
  const wm = wordmarkSvg({ id: 'ledGlowWm' });
  const pad = 24; // グロウの滲みが切れないよう余白
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${wm.w + pad * 2} ${wm.h + pad * 2}">\n` +
    `<defs>${wm.filter}</defs>\n  ${wm.body}\n</svg>\n`;
  fs.writeFileSync(path.join(outDir, 'wordmark-led-hd.svg'), svg);
  console.log('generated wordmark-led-hd.svg', `(${wm.w.toFixed(0)}x${wm.h.toFixed(0)})`);
}

// ② 正方形ロックアップ(1024x1024)。円形クロップされても中央の安全圏(約720px)に収まる配置
{
  const wm = wordmarkSvg({ id: 'ledGlowLk' });
  const wmW = 620; // ワードマークの表示幅
  const s = wmW / wm.w;
  const wmH = wm.h * s;
  const dia = 400; // ダイヤモンドの表示サイズ
  const diaY = 190;
  const wmY = diaY + dia + 64;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">\n` +
    `<defs>${wm.filter}</defs>\n` +
    `<rect width="1024" height="1024" fill="${C.bg}"/>\n` +
    `<g transform="translate(${(1024 - dia) / 2} ${diaY}) scale(${dia / 128})">${diamondSvg()}</g>\n` +
    `<g transform="translate(${(1024 - wmW) / 2} ${wmY}) scale(${s.toFixed(4)})">\n  ${wm.body}\n</g>\n` +
    `</svg>\n`;
  fs.writeFileSync(path.join(outDir, 'icon-lockup.svg'), svg);
  console.log('generated icon-lockup.svg', `(wordmark ${wmW}x${wmH.toFixed(0)} @y=${wmY})`);
}

// ③ ロックアップPNG(1024) — SNSアイコンにそのまま使える形式
{
  function resolveChromium() {
    const base = '/opt/pw-browsers';
    const candidates = [path.join(base, 'chromium')];
    for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
      if (d.startsWith('chromium-')) candidates.push(path.join(base, d, 'chrome-linux', 'chrome'));
    }
    for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    return undefined;
  }
  const browser = await chromium.launch({ executablePath: resolveChromium() });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  const svg = fs.readFileSync(path.join(outDir, 'icon-lockup.svg'), 'utf-8');
  await page.setContent(`<!doctype html><body style="margin:0">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body>`);
  await page.screenshot({ path: path.join(outDir, 'icon-lockup-1024.png'), clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  await browser.close();
  console.log('generated icon-lockup-1024.png');
}

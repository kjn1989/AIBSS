// AI-BASE DIAMOND のPWAアイコン(PNG)を public/favicon.svg と同じデザインから生成する。
// 実行: node scripts/gen-icons.mjs  (playwright-core + 同梱chromiumを使用)
// - icon-192/512: maskable対応のため角丸なし全面背景(OS側が切り抜く)
// - apple-touch-icon(180): iOSが角丸を付けるため同じく角丸なし
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'public/favicon.svg'), 'utf-8')
  .replace('rx="28"', 'rx="0"'); // PNGアイコンは全面塗り(maskable/角丸はOS側で処理)

// 環境によりchromiumの置き場所が異なるため候補から解決する
function resolveChromium() {
  const base = '/opt/pw-browsers';
  const candidates = [path.join(base, 'chromium')];
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (d.startsWith('chromium-')) candidates.push(path.join(base, d, 'chrome-linux', 'chrome'));
  }
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return undefined; // playwright既定の解決に任せる
}

const browser = await chromium.launch({ executablePath: resolveChromium() });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });

const targets = [
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-192.png', size: 192 },
  { file: 'apple-touch-icon.png', size: 180 },
];

for (const { file, size } of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`
  );
  await page.screenshot({ path: path.join(root, 'public', file), clip: { x: 0, y: 0, width: size, height: size } });
  console.log('generated', file);
}

await browser.close();

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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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

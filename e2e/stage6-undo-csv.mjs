// 第6段階スモークテスト: Undo(履歴スタック)・CSV出力・クラウド設定UI
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('dialog', (d) => d.accept());

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// 準備
await page.click('button[aria-label="設定"]');
for (const name of ['青木', '木村', '斎藤']) {
  await page.fill('input[placeholder="選手名"]', name);
  await page.click('button:has-text("追加")');
}
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'アンドゥーズ');
await page.click('button:has-text("試合開始")');
await page.click('button:has-text("登録選手から打順を自動セット")');
await page.waitForTimeout(200);

// ==== Undo: 投球1球 → 取り消し ====
await page.click('.count-btns .ball');
await page.waitForTimeout(100);
console.log('undo bar:', (await page.textContent('.undo-bar button')).trim());
console.log('count before undo:', (await page.textContent('.count-display')).replace(/\s+/g, ' ').trim());
await page.click('.undo-bar button');
await page.waitForTimeout(100);
console.log('count after undo:', (await page.textContent('.count-display')).replace(/\s+/g, ' ').trim());

// ==== Undo: 打席確定 → 取り消し ====
await page.click('.result-pad button:has-text("本塁打")');
await page.waitForSelector('.sheet');
await page.click('.dir-pad button:has-text("中堅")');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);
let scores = await page.$$eval('.scoreboard .score', (els) => els.map((e) => e.textContent));
console.log('after HR:', scores, '/ undo:', (await page.textContent('.undo-bar button')).trim());
await page.click('.undo-bar button');
await page.waitForTimeout(200);
scores = await page.$$eval('.scoreboard .score', (els) => els.map((e) => e.textContent));
console.log('after UNDO of HR:', scores);

// ==== CSV出力 ====
// データを1件作ってから出力
await page.click('.result-pad button:has-text("単打")');
await page.waitForSelector('.sheet');
await page.click('.dir-pad button:has-text("左翼")');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);

await page.click('button[aria-label="設定"]');
await page.waitForSelector('.card h2:has-text("CSV出力・共有")');
const dl = page.waitForEvent('download');
await page.click('.row:has-text("打者成績") button:has-text("DL")');
const download = await dl;
const path = await download.path();
const { readFileSync } = await import('fs');
const csv = readFileSync(path, 'utf-8');
console.log('CSV filename:', download.suggestedFilename());
console.log('CSV head:', csv.split('\r\n')[0].slice(0, 80), '...');
console.log('CSV rows:', csv.split('\r\n').length, '(ヘッダー+選手行)');
console.log('CSV row1:', csv.split('\r\n')[1]);

// 打席詳細CSV(スナップショット列)
const dl2 = page.waitForEvent('download');
await page.click('.row:has-text("打席詳細") button:has-text("DL")');
const d2 = await dl2;
const csv2 = readFileSync(await d2.path(), 'utf-8');
console.log('atBat CSV header:', csv2.split('\r\n')[0]);
console.log('atBat CSV row1:', csv2.split('\r\n')[1]);

// ==== クラウド設定UI ====
const cloudCard = await page.isVisible('.card h2:has-text("クラウド共有")');
console.log('cloud card visible:', cloudCard);
await page.fill('textarea', '{ invalid json');
const warned = await page.isVisible('.warn-box:has-text("configを解釈できません")');
console.log('invalid config warning:', warned);
const startBtn = await page.isDisabled('button:has-text("共有を開始")');
console.log('start button disabled with invalid config:', startBtn);

await page.screenshot({ path: '/tmp/claude-0/-home-user-MADO/e7a9de65-64b1-5dc7-a891-ba106228f17e/scratchpad/stage6.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

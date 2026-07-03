// 第1段階スモークテスト: レンダリング + デモデータ投入 + ランキング表示
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
console.log('title:', await page.title());
console.log('header:', await page.textContent('.app-header h1'));

// 設定を開いてデモデータ投入
await page.click('button[aria-label="設定"]');
await page.click('text=デモデータを投入');
await page.waitForTimeout(300);

// ホームに戻る
await page.click('.tabbar button:has-text("ホーム")');
await page.waitForTimeout(300);
const cards = await page.$$eval('.title-card', (els) => els.length);
console.log('title cards:', cards);
const firstCard = await page.textContent('.title-card');
console.log('first card:', firstCard);

// 試合単位トグル
await page.click('.toggle-row button:has-text("試合単位")');
await page.waitForTimeout(200);
const options = await page.$$eval('select option', (els) => els.map((e) => e.textContent));
console.log('game options:', options);

await page.screenshot({ path: '/tmp/claude-0/-home-user-MADO/e7a9de65-64b1-5dc7-a891-ba106228f17e/scratchpad/stage1-home.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

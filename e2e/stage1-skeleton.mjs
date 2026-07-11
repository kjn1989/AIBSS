// 第1段階スモークテスト: レンダリング + デモデータ投入 + 新ホーム(クイックスタート) + ランキング表示
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://localhost:4173/', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
console.log('title:', await page.title());
console.log('header:', (await page.textContent('.app-header h1')).trim());

// 初回ホーム: オンボーディング(3ステップ+デモ)と試合開始ボタン
console.log('初回: 試合開始ボタン:', (await page.locator('text=新しい試合を開始').count()) > 0);
console.log('初回: はじめての方へ:', (await page.locator('text=はじめての方へ').count()) > 0);

// ホームからデモデータ投入
await page.click('text=🎮 まずはデモデータで試してみる');
await page.waitForTimeout(400);
console.log('デモ後: 勝敗サマリー:', (await page.locator('text=これまでの成績').count()) > 0);
console.log('デモ後: 最近の試合 行数:', await page.locator('.card:has(h2:has-text("最近の試合")) .row').count());

// ホームの導線ボタン → 成績タブ(タイトルカードは成績タブへ移設)
await page.click('text=📊 成績・ランキング');
await page.waitForTimeout(300);
const cards = await page.$$eval('.title-card', (els) => els.length);
console.log('title cards(成績タブ):', cards);
const firstCard = await page.textContent('.title-card');
console.log('first card:', firstCard);

// 試合単位トグル(成績タブのスコープ切替)
await page.click('.toggle-row button:has-text("試合単位")');
await page.waitForTimeout(200);
const options = await page.$$eval('select option', (els) => els.map((e) => e.textContent));
console.log('game options:', options);

console.log('errors:', errors.length ? errors : 'none');
await browser.close();

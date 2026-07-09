// iOSシート問題の修正検証: 確定ボタンが常に可視・背景スクロールロック・portal描画
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// iPhone 12/13/14相当の小さめビューポートで検証
const page = await browser.newPage({ viewport: { width: 390, height: 660 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('dialog', (d) => d.accept());

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// 準備: 選手+守備開始で走者ありの長いシートを再現
await page.click('button[aria-label="設定"]');
for (const name of ['青木', '木村']) {
  await page.fill('input[placeholder="選手名"]', name);
  await page.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
}
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'テスト');
await page.click('.toggle-row button:has-text("後攻")');
await page.click('button:has-text("試合開始")');
await page.waitForSelector('.scoreboard');
// 走者を2人置く(単打×2) → 二塁打シート = 最長パターン
for (let i = 0; i < 2; i++) {
  await page.click('.result-pad button:has-text("単打")');
  await page.waitForSelector('.sheet');
  await page.click('.dir-pad button:has-text("左翼")');
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(200);
}

// 二塁打シートを開く(打球方向+走者2人+打者+確認カード = 画面より長い)
await page.click('.result-pad button:has-text("二塁打")');
await page.waitForSelector('.sheet');
await page.waitForTimeout(500); // スライドアップアニメーション完了を待つ

// 1. シートが body 直下(portal)に描画されているか
const isPortal = await page.$eval('.sheet-overlay', (el) => el.parentElement === document.body);
console.log('portal to body:', isPortal);

// 2. 確定ボタンがビューポート内に見えているか(スクロールなしで)
const btn = await page.$('.sheet-actions button:has-text("確定")');
const box = await btn.boundingBox();
const vp = page.viewportSize();
console.log('confirm button box:', box, 'viewport:', vp);
console.log('confirm visible in viewport:', box && box.y >= 0 && box.y + box.height <= vp.height);

// 3. 背景スクロールがロックされているか
const mainOverflow = await page.$eval('.main', (el) => getComputedStyle(el).overflow);
const bodyClass = await page.evaluate(() => document.body.className);
console.log('main overflow while sheet open:', mainOverflow, '/ body class:', bodyClass);

// 4. シート内をスクロールしても背景(.main)が動かないか
const mainScrollBefore = await page.$eval('.main', (el) => el.scrollTop);
await page.mouse.move(195, 300);
await page.mouse.wheel(0, 400);
await page.waitForTimeout(200);
const mainScrollAfter = await page.$eval('.main', (el) => el.scrollTop);
console.log('main scrollTop before/after wheel on sheet:', mainScrollBefore, '/', mainScrollAfter, '→ locked:', mainScrollBefore === mainScrollAfter);

// 5. 方向選択→確定が正常に押せるか
await page.click('.dir-pad button:has-text("右翼")');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);
console.log('confirm tap worked, sheet closed:', !(await page.$('.sheet')));

// 6. シートを閉じたらスクロールロック解除
const mainOverflowAfter = await page.$eval('.main', (el) => getComputedStyle(el).overflow);
console.log('main overflow after close:', mainOverflowAfter);

await page.screenshot({ path: '/tmp/claude-0/-home-user-MADO/e7a9de65-64b1-5dc7-a891-ba106228f17e/scratchpad/stage8.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

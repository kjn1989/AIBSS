// 代打・代走のスコア入力タブからの実行を検証
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.click('button[aria-label="設定"]');
for (const n of ['青木','木村','斎藤','松本','井上','林','清水','山口','森','池田','橋本']) {
  await page.fill('input[placeholder="選手名"]', n); await page.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
}
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'T');
await page.click('button:has-text("試合開始")');
await page.click('button:has-text("登録選手から打順を自動セット")');
await page.waitForTimeout(200);
// 単打で走者を置く
await page.click('.result-pad button:has-text("単打")');
await page.waitForSelector('.sheet');
await page.click('.field-pad button:has-text("左翼")');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);
// === 代走: 一塁走者(青木)タップ → 代走を送る → 池田 ===
await page.click('.base.b1');
await page.waitForSelector('.sheet');
console.log('PR button:', (await page.textContent('.sheet button.primary')).trim());
await page.click('.sheet button:has-text("代走を送る")');
await page.waitForSelector('.sheet select');
console.log('kind preselected 代走:', await page.$eval('.sheet .grid3 button.primary', (el) => el.textContent));
await page.selectOption('.sheet select', { label: '池田' });
await page.click('button:has-text("代走で出場")');
await page.waitForTimeout(200);
console.log('runner on 1st after PR:', await page.textContent('.base.b1'));
// === 代打: 打者カード → 打者変更 → 代打を送る → 橋本 ===
await page.click('.pill.blue');
await page.waitForSelector('.sheet');
await page.click('.sheet button:has-text("代打を送る")');
await page.waitForSelector('.sheet select');
await page.selectOption('.sheet select', { label: '橋本' });
await page.click('button:has-text("代打で出場")');
await page.waitForTimeout(200);
console.log('current batter after PH:', (await page.textContent('.card .flex b')).trim());
const logs = await page.$$eval('.log-line', (els) => els.slice(0, 3).map((e) => e.textContent.trim()));
console.log('logs:', logs);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

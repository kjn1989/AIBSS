// 第5段階スモークテスト: 音声実況(テキスト入力経由)→確認カード→反映
// ヘッドレス環境ではマイクが使えないため、FAB→テキスト実況入力の経路で検証する。
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

// 準備: 選手・試合・打順
await page.click('button[aria-label="設定"]');
for (const name of ['青木', '木村', '斎藤']) {
  await page.fill('input[placeholder="選手名"]', name);
  await page.click('button:has-text("追加")');
}
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'ボイスナイン');
await page.click('button:has-text("試合開始")');
await page.click('button:has-text("登録選手から打順を自動セット")');
await page.waitForTimeout(200);

const speak = async (text) => {
  await page.click('.voice-fab');
  await page.waitForSelector('.sheet');
  await page.fill('input[placeholder="またはテキストで実況を入力"]', text);
  await page.click('button:has-text("解釈")');
  await page.waitForSelector('.confirm-card .q');
  return (await page.textContent('.confirm-card .q')).trim();
};

// 1. センター前ヒット → 確認カード → 1タップ確定
let q = await speak('センター深くに抜けた単打');
console.log('確認カード:', q);
await page.click('.cand button.top');
await page.waitForTimeout(200);
console.log('runner on 1st:', await page.textContent('.base.b1'));

// 2. 際どいけどフォアボール
q = await speak('際どいけどフォアボール');
console.log('確認カード:', q);
await page.click('.cand button.top');
await page.waitForTimeout(200);
console.log('after BB: b1=', await page.textContent('.base.b1'), 'b2=', await page.textContent('.base.b2'));

// 3. サードがエラー → 修正フロー(走者・方向を修正して確定)
q = await speak('サードがエラー');
console.log('確認カード:', q);
const candList = await page.$$eval('.cand button', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
console.log('候補:', candList);
await page.click('.cand button:has-text("修正して確定")');
await page.waitForSelector('.sheet-actions button:has-text("確定")');
console.log('PlaySheet opened for edit');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);

// 4. ショートゴロ(凡打)
q = await speak('ショートゴロ');
console.log('確認カード:', q);
await page.click('.cand button.top');
await page.waitForTimeout(200);
const outs = await page.$$eval('.out-dot.on', (els) => els.length);
console.log('outs:', outs);

// 5. 投球のみ「ボール」
q = await speak('ボール');
console.log('確認カード:', q);
await page.click('.cand button.top');
await page.waitForTimeout(200);
console.log('count:', (await page.textContent('.count-display')).replace(/\s+/g, ' ').trim());

// 6. 盗塁
q = await speak('盗塁成功');
console.log('確認カード:', q);
await page.click('.cand button.top');
await page.waitForTimeout(200);

// ログ確認
const logs = await page.$$eval('.log-line', (els) => els.slice(0, 6).map((e) => e.textContent.trim()));
console.log('logs:', logs);

await page.screenshot({ path: '/tmp/claude-0/-home-user-MADO/e7a9de65-64b1-5dc7-a891-ba106228f17e/scratchpad/stage5.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

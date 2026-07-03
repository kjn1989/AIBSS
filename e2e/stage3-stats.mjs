// 第3段階スモークテスト: 10大メトリクスの表示確認
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// デモデータ投入
await page.click('button[aria-label="設定"]');
await page.click('text=デモデータを投入');
await page.click('.tabbar button:has-text("成績")');
await page.waitForSelector('.rank-table');

// 10メトリクスを順に切り替えて先頭行を表示
const metrics = ['打率', '得点圏打率', 'OPS', '進塁打成功率', 'PPA', 'クラッチ打数', '初球安打率', '防御率', 'WHIP', 'K/BB'];
for (const m of metrics) {
  await page.click(`.grid3 button:has-text("${m}")`);
  await page.waitForTimeout(150);
  const title = await page.textContent('.card h2');
  const first = await page.$('.rank-table tbody tr');
  const row = first ? (await first.textContent()).replace(/\s+/g, ' ').trim() : '(データなし)';
  console.log(`${title.trim()} → ${row}`);
}

// 試合単位に切り替え
await page.click('.toggle-row button:has-text("試合単位")');
await page.waitForTimeout(200);
console.log('game scope rows:', await page.$$eval('.rank-table tbody tr', (els) => els.length));

await page.screenshot({ path: '/tmp/claude-0/-home-user-MADO/e7a9de65-64b1-5dc7-a891-ba106228f17e/scratchpad/stage3-stats.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

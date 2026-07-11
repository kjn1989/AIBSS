// 追加スタッツ検証: 出塁率・被打率・ホールド・セーブ
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

// デモデータで詳細ランキングを確認
await page.click('button[aria-label="設定"]');
await page.click('text=デモデータを投入');
await page.click('.tabbar button:has-text("成績")');
await page.waitForSelector('.rank-table');

for (const m of ['出塁率', '被打率', 'ホールド', 'セーブ']) {
  await page.click(`.grid3 button:has-text("${m}")`);
  await page.waitForTimeout(150);
  const title = (await page.textContent('.card h2')).trim();
  const first = await page.$('.rank-table tbody tr');
  const row = first ? (await first.textContent()).replace(/\s+/g, ' ').trim() : '(データなし)';
  console.log(`${title} → ${row}`);
}

// 成績タブのホールド王カード(タイトルカードはホームから成績タブへ移設)
const holdCard = await page.$('.title-card:has-text("ホールド王")');
console.log('ホールド王カード:', holdCard ? (await holdCard.textContent()).replace(/\s+/g, ' ').trim() : 'なし');

// 実試合で被打数の自動集計とHトグルを確認
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.click('button[aria-label="設定"]');
for (const name of ['青木', '木村']) {
  await page.fill('input[placeholder="選手名"]', name);
  await page.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
}
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'テスト');
await page.click('.toggle-row button:has-text("後攻")'); // 守備から開始
await page.click('button:has-text("試合開始")');
await page.waitForSelector('.scoreboard');
// 先発投手セット
await page.selectOption('.card select', { label: '青木' });
await page.waitForTimeout(200);
// 相手打者: 単打(被打数+1) → 三振(被打数+1) → 四球(被打数変わらず)
for (const [btn, dir] of [['単打', '左翼'], ['三振', null], ['四球', null]]) {
  await page.click(`.result-pad button:has-text("${btn}")`);
  await page.waitForSelector('.sheet');
  if (dir) await page.click(`.dir-pad button:has-text("${dir}")`);
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(200);
}
await page.click('.tabbar button:has-text("試合結果")');
const card = (await page.textContent('.card:has(.rank-badge):has(.stepper)')).replace(/\s+/g, ' ');
console.log('投手カード:', card.slice(0, 100));
// Hトグル
await page.click('.card button:has-text("H")');
await page.waitForTimeout(100);
console.log('H toggled ok');

console.log('errors:', errors.length ? errors : 'none');
await browser.close();

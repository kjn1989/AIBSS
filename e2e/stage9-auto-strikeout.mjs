// 自動三振/四球・見逃し/空振り選択・振り逃げの検証
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
  await page.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
}
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'テスト');
await page.click('button:has-text("試合開始")');
await page.click('button:has-text("登録選手から打順を自動セット")');
await page.waitForTimeout(200);

// ==== 1. ストライク×2 → ヒント表示 → 3球目ストライクで三振カード ====
await page.click('.count-btns .strike');
await page.click('.count-btns .strike');
console.log('hint shown:', await page.isVisible('.pill.amber:has-text("次のストライクで三振")'));
await page.click('.count-btns .strike');
await page.waitForSelector('.sheet');
console.log('strikeout card:', (await page.textContent('.sheet .q')).trim());
// 見逃し三振を選んで確定
await page.click('.sheet button:has-text("見逃し三振")');
await page.click('.sheet-actions button:has-text("三振アウトで確定")');
await page.waitForTimeout(200);
const log1 = await page.textContent('.log-line');
console.log('log:', log1.trim(), '/ outs:', await page.$$eval('.out-dot.on', (e) => e.length));

// ==== 2. ファウル2球 + ストライク1球 でも三振カード ====
await page.click('.count-btns .foul');
await page.click('.count-btns .foul');
await page.click('.count-btns .strike');
await page.waitForSelector('.sheet');
console.log('K via fouls+strike card shown: true');
// 空振り(デフォルト)のまま確定
await page.click('.sheet-actions button:has-text("三振アウトで確定")');
await page.waitForTimeout(200);
console.log('log:', (await page.textContent('.log-line')).trim());
// 投球数確認(F,F,S=3球のはず。水増しされていないか)
await page.click('button[aria-label="設定"]');
const dl = page.waitForEvent('download');
await page.click('.row:has-text("打席詳細") button:has-text("DL")');
const { readFileSync } = await import('fs');
const csv = readFileSync(await (await dl).path(), 'utf-8');
const rows = csv.split('\r\n');
console.log('CSV結果/投球数/シーケンス:', rows.slice(1).map((r) => { const c = r.split(','); return `${c[5]}:${c[10]}球:${c[13]}`; }).join(' | '));

// ==== 3. 誤タップ取り消し ====
await page.click('.tabbar button:has-text("スコア入力")');
await page.click('.count-btns .strike');
await page.click('.count-btns .strike');
await page.click('.count-btns .strike');
await page.waitForSelector('.sheet');
await page.click('.sheet-actions button:has-text("誤タップ")');
await page.waitForTimeout(200);
console.log('after mistap-undo count:', (await page.textContent('.count-display')).replace(/\s+/g, ' ').trim());

// ==== 4. 振り逃げ ====
await page.click('.count-btns .strike'); // 3球目 → カード
await page.waitForSelector('.sheet');
await page.click('.sheet button:has-text("振り逃げ")');
await page.waitForSelector('.sheet-actions button:has-text("確定")');
console.log('furinige PlaySheet summary:', (await page.textContent('.confirm-card .q')).trim());
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);
console.log('runner on 1st (振り逃げ):', await page.textContent('.base.b1'));
console.log('outs after furinige:', await page.$$eval('.out-dot.on', (e) => e.length), '(2のまま増えないのが正)');
console.log('log:', (await page.textContent('.log-line')).trim());

// ==== 5. 3ボール→4球目で四球シート ====
for (let i = 0; i < 3; i++) await page.click('.count-btns .ball');
console.log('BB hint:', await page.isVisible('.pill.green:has-text("次のボールで四球")'));
await page.click('.count-btns .ball');
await page.waitForSelector('.sheet');
console.log('walk sheet title:', (await page.textContent('.sheet h3')).trim());
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);
console.log('after BB: b1=', await page.textContent('.base.b1'), 'b2=', await page.textContent('.base.b2'));

await page.screenshot({ path: '/tmp/claude-0/-home-user-MADO/e7a9de65-64b1-5dc7-a891-ba106228f17e/scratchpad/stage9.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

// 第2段階スモークテスト
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

// 選手登録
await page.click('button[aria-label="設定"]');
for (const name of ['青木', '木村', '斎藤', '松本', '井上']) {
  await page.fill('input[placeholder="選手名"]', name);
  await page.click('button:has-text("追加")');
}
console.log('players added');

// 試合開始
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'テストナイン');
await page.click('.toggle-row button:has-text("先攻")');
await page.click('button:has-text("試合開始")');
await page.waitForSelector('.scoreboard');
console.log('game started, inning:', await page.textContent('.scoreboard .inning'));

// 打順自動セット
await page.click('button:has-text("登録選手から打順を自動セット")');
await page.waitForSelector('.rank-badge');
console.log('batter:', (await page.textContent('.card .flex b')));

// 投球: ボール→ストライク→単打
await page.click('.count-btns .ball');
await page.click('.count-btns .strike');
const count = await page.textContent('.count-display');
console.log('count:', count.replace(/\s+/g, ' '));

// 単打 → 方向: 中堅 → 確定
await page.click('.result-pad button:has-text("単打")');
await page.waitForSelector('.sheet');
await page.click('.dir-pad button:has-text("中堅")');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);
const b1 = await page.textContent('.base.b1');
console.log('runner on 1st:', b1);

// 四球(走者一塁 → 一二塁)
await page.click('.result-pad button:has-text("四球")');
await page.waitForSelector('.sheet');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);
console.log('after BB: 1st=', await page.textContent('.base.b1'), '2nd=', await page.textContent('.base.b2'));

// 凡打(進塁打判定が出るか) — 遊撃ゴロ、走者そのまま
await page.click('.result-pad button:has-text("凡打")');
await page.waitForSelector('.sheet');
await page.click('.dir-pad button:has-text("遊撃")');
console.log('adv toggle visible:', await page.isVisible('button:has-text("進塁打ではない")'));
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);

// アウトカウント確認
const outs = await page.$$eval('.out-dot.on', (els) => els.length);
console.log('outs:', outs);

// 盗塁: 一塁走者タップ → 盗塁成功
await page.click('.base.b1');
await page.waitForSelector('.sheet');
await page.click('button:has-text("盗塁成功")');
await page.waitForTimeout(200);
console.log('after SB: 2nd occupied =', await page.$eval('.base.b2', (el) => el.classList.contains('occupied')));

// 三振×2 → チェンジ(3アウト)
for (let i = 0; i < 2; i++) {
  await page.click('.result-pad button:has-text("三振")');
  await page.waitForSelector('.sheet');
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(200);
}
console.log('after 3 outs, inning:', (await page.textContent('.scoreboard .inning')).trim(), '(守備に切替)');
console.log('defense mode:', await page.isVisible('select'));

// 本塁打テスト用に手動チェンジで攻撃へ戻す
await page.click('button:has-text("手動チェンジ")');
await page.waitForTimeout(200);
console.log('back to offense, inning:', (await page.textContent('.scoreboard .inning')).trim());

// 本塁打
await page.click('.result-pad button:has-text("本塁打")');
await page.waitForSelector('.sheet');
await page.click('.dir-pad button:has-text("左翼")');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);
const scores = await page.$$eval('.scoreboard .score', (els) => els.map((e) => e.textContent));
console.log('scores after HR:', scores);

// プレイログ確認
const logs = await page.$$eval('.log-line', (els) => els.slice(0, 4).map((e) => e.textContent));
console.log('logs:', logs);

await page.screenshot({ path: '/tmp/claude-0/-home-user-MADO/e7a9de65-64b1-5dc7-a891-ba106228f17e/scratchpad/stage2-score.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

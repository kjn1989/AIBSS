// 第4段階スモークテスト: オーダー設定・代打・投手記録・継投時の自責点帰属
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

// 選手登録(11人)
await page.click('button[aria-label="設定"]');
for (const name of ['青木', '木村', '斎藤', '松本', '井上', '林', '清水', '山口', '森', '池田', '橋本']) {
  await page.fill('input[placeholder="選手名"]', name);
  await page.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
}

// 試合開始(後攻 = 1回表は守備)
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'テストナイン');
await page.click('.toggle-row button:has-text("後攻")');
await page.click('button:has-text("試合開始")');
await page.waitForSelector('.scoreboard');

// ==== オーダータブで打順を設定(ウィザード: 選手選択→並べ替え→守備位置) ====
await page.click('.tabbar button:has-text("オーダー")');
await page.click('button:has-text("登録順に9人選択")');
await page.click('button:has-text("次へ(打順の並べ替え)")');
await page.click('button:has-text("次へ(守備位置)")');
await page.click('button:has-text("このオーダーで確定")');
await page.waitForSelector('.card h2:has-text("オーダー")');
console.log('lineup set');

// ==== 先発投手はオーダー確定時に自動設定される(打順1番=青木が投を守る) ====
await page.click('.tabbar button:has-text("試合結果")');
await page.waitForSelector('.pill.green'); // 青木が登板中
console.log('starter: 青木 登板中(オーダー確定で自動設定)');

// ==== 守備で被安打→継投→継承走者生還 ====
await page.click('.tabbar button:has-text("スコア入力")');
// 相手打者: 単打(走者一塁 = 青木の責任走者)
await page.click('.result-pad button:has-text("単打")');
await page.waitForSelector('.sheet');
await page.click('.dir-pad button:has-text("左翼")');
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);

// 継投: 木村へ
await page.click('.tabbar button:has-text("試合結果")');
await page.selectOption('.card:has(h2:has-text("登板・継投")) select', { label: '木村' });
await page.click('button:has-text("継投")');
await page.waitForTimeout(200);
console.log('relief: 木村');

// 相手打者: 二塁打 → 一塁走者(青木の責任)が生還するように設定
await page.click('.tabbar button:has-text("スコア入力")');
await page.click('.result-pad button:has-text("二塁打")');
await page.waitForSelector('.sheet');
await page.click('.dir-pad button:has-text("右翼")');
// 一塁走者を生還に変更
await page.click('.runner-move .dests button:has-text("生還")');
await page.waitForTimeout(100);
// 自責点帰属セクションの確認
const erSection = await page.isVisible('.section-title:has-text("自責点の帰属")');
const inheritedPill = await page.isVisible('.pill.amber:has-text("継投跨ぎ")');
console.log('ER attribution dialog:', erSection, '/ inherited badge:', inheritedPill);
const prevBtn = await page.textContent('.grid2 button:has-text("前投手")');
console.log('choices:', prevBtn.trim(), '/', (await page.textContent('.grid2 button:has-text("現投手")')).trim());
// 前投手(青木)に帰属(デフォルト) → 確定
await page.click('.sheet-actions button:has-text("確定")');
await page.waitForTimeout(200);

// 試合結果タブで自責点の反映を確認
await page.click('.tabbar button:has-text("試合結果")');
const cards = await page.$$eval('.card', (els) =>
  els.filter((e) => e.querySelector('.rank-badge') && e.querySelector('.stepper')).map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 90))
);
console.log('pitching records:');
for (const c of cards) console.log(' ', c);

// 自責点の手動微調整(+1)
await page.click('.card .stepper button:has-text("＋")');
await page.waitForTimeout(100);
console.log('after manual ER adjust: ok');

// ==== 代打テスト(攻撃回へ) ====
await page.click('.tabbar button:has-text("スコア入力")');
await page.click('button:has-text("手動チェンジ")'); // 1回裏(自チーム攻撃)へ
await page.waitForTimeout(200);
await page.click('.tabbar button:has-text("オーダー")');
await page.click('.card .row button:has-text("交代")'); // 1番 青木
await page.waitForSelector('.sheet');
await page.click('.sheet .grid3 button:has-text("代打")');
await page.selectOption('.sheet select', { label: '池田' });
await page.click('button:has-text("代打で出場")');
await page.waitForTimeout(200);
const firstRow = await page.textContent('.card .row');
console.log('after PH, slot1:', firstRow.replace(/\s+/g, ' ').slice(0, 60));

// 再出場警告: 青木を再び出す
await page.click('.card .row button:has-text("交代")');
await page.waitForSelector('.sheet');
const opt = await page.textContent('.sheet select option:has-text("青木")');
console.log('retired option label:', opt.trim());
await page.selectOption('.sheet select', { label: opt.trim() });
const warned = await page.isVisible('.sheet .warn-box');
console.log('re-entry warning shown:', warned);
await page.click('.sheet-actions button.ghost'); // キャンセル

await page.screenshot({ path: '/tmp/claude-0/-home-user-MADO/e7a9de65-64b1-5dc7-a891-ba106228f17e/scratchpad/stage4.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();

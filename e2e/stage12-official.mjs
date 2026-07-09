// 第12段階: AI-BSS公式クラウド(Supabase版)のUI状態検証
// バックエンド無しで検証できる範囲: 未設定時の「準備中」表示 / 設定時のログインUI /
// 招待リンクの参加オーバーレイ表示。
// フル同期フロー(ログイン→チーム登録→招待→参加→双方向同期→RLS拒否)は
// 実プロジェクトで手動確認する(docs/supabase-setup.md 手順5)。
// ※Firebase版時代はエミュレータで11項目の自動検証を行っていた(git履歴のstage12参照)。
import { chromium } from 'playwright-core';

const DUMMY_CONFIG = JSON.stringify({ url: 'https://dummy.supabase.co', anonKey: 'dummy-anon-key' });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));

// ---- 1. 設定なし → 「準備中」 ----
await page.goto('http://localhost:4173/', { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.click('[aria-label="設定"]');
await page.waitForSelector('text=AI-BSS公式クラウド');
console.log('1. 未設定時に準備中表示:', (await page.locator('text=準備中です').count()) > 0 ? 'OK' : 'NG');

// ---- 2. 設定あり → メール+パスワードのログインUI ----
await page.evaluate((cfg) => localStorage.setItem('bbscorer.officialConfig', cfg), DUMMY_CONFIG);
await page.reload({ waitUntil: 'load' });
await page.click('[aria-label="設定"]');
await page.waitForSelector('.card:has(h2:has-text("公式クラウド")) input[type="email"]', { timeout: 10000 });
console.log('2. 設定時にログインUI表示: OK');
console.log('   パスワード欄あり:', (await page.locator('.card:has(h2:has-text("公式クラウド")) input[type="password"]').count()) > 0 ? 'OK' : 'NG');

// ---- 3. 招待リンク(?ct=) → 参加オーバーレイ+ログイン欄 ----
await page.goto('http://localhost:4173/?ct=dummy-token', { waitUntil: 'load' });
await page.waitForSelector('text=チームに参加 (AI-BSS公式クラウド)', { timeout: 10000 });
await page.waitForSelector('.invite-overlay input[type="email"]', { timeout: 10000 });
console.log('3. 招待リンクで参加オーバーレイ+ログイン欄表示: OK');
await page.click('text=今はしない');
console.log('   オーバーレイを閉じられる:', (await page.locator('.invite-overlay').count()) === 0 ? 'OK' : 'NG');

console.log('errors:', errors.length ? errors : 'none');
await browser.close();

// 画面の整理(屋外モード・設定の順序・説明の畳み・前回と同じ打順)のe2e。
// 守りたいこと:
//  - 屋外モードは1タップで切り替わり、再読み込みしても残る
//  - 設定は選手登録が一番上で、ふだん触らない設定は畳まれている
//  - 長い説明は「？」を押すまで出ない
//  - 2試合目は「前回と同じ打順で始める」で1タップで始まる
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function resolveChromium() {
  const base = '/opt/pw-browsers';
  const candidates = [path.join(base, 'chromium')];
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (d.startsWith('chromium-')) candidates.push(path.join(base, d, 'chrome-linux', 'chrome'));
  }
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return undefined;
}
const PORT = 4211;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 500)); }

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok' : 'NG'} - ${n}${c ? '' : ' :: ' + d}`); if (!c) fail++; };
const b = await chromium.launch({ executablePath: resolveChromium() });
try {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  p.on('pageerror', (e) => { console.log('EXC:', e.message); fail++; });
  p.on('dialog', (d) => d.accept());
  const W = (ms) => p.waitForTimeout(ms);
  await p.goto(URL_, { waitUntil: 'load' }); await W(900);

  // ---- 屋外モード ----
  const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('最初は暗い配色', (await bg()) !== 'rgb(255, 255, 255)');
  await p.click('.outdoor-toggle'); await W(400);
  ok('屋外モードで明るい配色になる', (await bg()) === 'rgb(255, 255, 255)', await bg());
  ok('html に印が付く', await p.evaluate(() => document.documentElement.hasAttribute('data-outdoor')));
  await p.reload({ waitUntil: 'load' }); await W(900);
  ok('再読み込みしても残る', (await bg()) === 'rgb(255, 255, 255)');
  await p.click('.outdoor-toggle'); await W(300);
  ok('もう一度押すと戻る', (await bg()) !== 'rgb(255, 255, 255)');

  // ---- 設定の順序と畳み ----
  await p.click('button[aria-label="設定"]'); await W(500);
  const heads = await p.evaluate(() => [...document.querySelectorAll('.main h2')].map((h) => h.innerText).slice(0, 3));
  ok('選手登録がいちばん上に出る', heads.some((h) => h.includes('選手登録')) && heads.findIndex((h) => h.includes('選手登録')) <= 1, JSON.stringify(heads));
  ok('詳しい設定は畳まれている', !(await p.locator('.adv-settings').evaluate((d) => d.open)));
  ok('デモデータの入口は畳みの外に残る', await p.locator('button:has-text("デモデータを投入")').isVisible());

  // ---- 説明は「？」の中 ----
  await p.fill('.add-form input[placeholder="選手名"]', '青木'); await p.click('.add-form button.primary'); await W(200);
  await p.fill('.add-form input[placeholder="選手名"]', '井上'); await p.click('.add-form button.primary'); await W(200);
  await p.click('nav button:has-text("スコア入力")'); await W(400);
  const hintText = '押している方をもう一度押すと未指定に戻ります';
  ok('試合種別の説明は最初は出ない', !(await p.locator('.main').innerText()).includes(hintText));
  await p.locator('.hint-btn').first().click(); await W(200);
  ok('「？」を押すと説明が出る', (await p.locator('.main').innerText()).includes(hintText));

  // ---- 1試合目を作って、2試合目は前回と同じ打順 ----
  await p.click('.mode-opt:has-text("かんたん")');
  await p.fill('input[placeholder="対戦相手名"]', '一戦目');
  await p.click('button:has-text("試合開始")'); await W(600);
  await p.click('.sheet-actions button.primary'); await W(600);
  ok('1試合目には「前回と同じ」は出ない', (await p.locator('button:has-text("前回と同じ打順で始める")').count()) === 0);
  await p.click('button:has-text("登録選手から打順を自動セット")'); await W(500);
  await p.click('button:has-text("試合終了")'); await W(800);
  await p.locator('.sheet-overlay button:has-text("閉じる")').first().click(); await W(500);
  await p.fill('input[placeholder="対戦相手名"]', '二戦目');
  await p.click('button:has-text("試合開始")'); await W(600);
  await p.click('.sheet-actions button.primary'); await W(600);
  const same = p.locator('button:has-text("前回と同じ打順で始める")');
  ok('2試合目に「前回と同じ打順で始める（2人）」が出る', (await same.count()) === 1 && (await same.innerText()).includes('2人'), (await p.locator('.main').innerText()).slice(0, 300));
  const first = await p.evaluate(() => null);
  await same.click(); await W(500);
  ok('そのまま1番打者から始まる', (await p.locator('.sit-main .nm').innerText()).length > 0);
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ ui PASS' : `\n✗ ui FAIL (${fail})`);
process.exit(fail ? 1 : 0);

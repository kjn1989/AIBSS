// 名簿の貼り付けのe2e。
// 守りたいこと:
//  - 利用者が実際に送ってきた形の名簿が、そのまま打順と守備位置になる
//  - 書き方が揺れていても読める
//  - 登録済みの選手は二重に登録しない
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
const PORT = 4208;
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
  const main = () => p.locator('.main').innerText();
  await p.goto(URL_, { waitUntil: 'load' }); await W(900);

  // ---- 設定で、書き方の揺れた名簿を登録する ----
  await p.click('button[aria-label="設定"]'); await W(400);
  await p.click('button:has-text("名簿を貼り付けてまとめて登録")'); await W(400);
  await p.fill('.paste-area', '①入交 ショート\n２．磯野(1B)\n3番 捕 山城\n・河合／サード');
  await W(300);
  let sheet = await p.locator('.sheet').innerText();
  ok('読み取った人数が出る', sheet.includes('読み取った 4 人'), sheet.slice(0, 300));
  ok('揺れた書き方から名前と位置が読めている',
    ['入交', '磯野', '山城', '河合'].every((n) => sheet.includes(n)) && !sheet.includes('ショート') && !sheet.includes('1B'), sheet.slice(0, 400));
  await p.click('.sheet-actions button.primary'); await W(500);
  ok('選手が4人登録される', (await main()).includes('選手登録 (4人)'), (await main()).slice(0, 200));

  // ---- 試合で、利用者の実例をそのまま貼って打順を組む ----
  await p.click('nav button:has-text("スコア入力")'); await W(400);
  await p.click('.mode-opt:has-text("かんたん")');
  await p.fill('input[placeholder="対戦相手名"]', '名簿練習');
  await p.click('button:has-text("試合開始")'); await W(600);
  await p.click('.sheet-actions button.primary'); await W(600);
  await p.click('button:has-text("名簿を貼り付けて打順を組む")'); await W(400);
  await p.fill('.paste-area', '1 入交（遊）\n2 磯野（一）\n3 山城（捕）\n4 河合（三）\n5 中島（中）\n6 奥田（左）\n7 橘木（二）\n8 藤田（投）\n9 部長（右）');
  await W(300);
  sheet = await p.locator('.sheet').innerText();
  ok('登録済み4人・新規5人と分かる', (sheet.match(/登録済み/g) || []).length === 4 && sheet.includes('新しく 5 人を登録'), sheet.slice(-300));
  await p.click('.sheet-actions button.primary'); await W(700);
  ok('1番打者が入交で始まる', (await p.locator('.sit-main .nm').innerText()) === '入交');

  await p.click('nav button:has-text("オーダー")'); await W(600);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.main .row')]
    .map((r) => [r.querySelector('b')?.textContent, r.querySelector('select')?.value]).filter((x) => x[0] && x[1]));
  ok('打順と守備位置が名簿どおり',
    JSON.stringify(rows) === JSON.stringify([['入交', '遊'], ['磯野', '一'], ['山城', '捕'], ['河合', '三'], ['中島', '中'], ['奥田', '左'], ['橘木', '二'], ['藤田', '投'], ['部長', '右']]),
    JSON.stringify(rows));

  await p.click('button[aria-label="設定"]'); await W(400);
  ok('選手は9人(二重登録なし)', (await main()).includes('選手登録 (9人)'), (await main()).slice(0, 200));

  // ---- オーダータブから、空白で位置を書いた名簿(利用者の実例2)で組み直す ----
  await p.click('nav button:has-text("オーダー")'); await W(500);
  await p.click('button:has-text("名簿を貼り付けて打順を組む")'); await W(400);
  await p.fill('.paste-area', '1 黒瀬　捕\n2 大槻　遊\n3 藤田　投\n4 川越　三\n5 芳賀 啓介　二\n6 吉元　一\n7 山浦　左\n8 星野　右\n9 中島　中');
  await W(300);
  ok('今の打順が置き換わると書いてある', (await p.locator('.sheet').innerText()).includes('置き換わります'));
  await p.click('.sheet-actions button.primary'); await W(700);
  const rows2 = await p.evaluate(() => [...document.querySelectorAll('.main .row')]
    .map((r) => [r.querySelector('b')?.textContent, r.querySelector('select')?.value]).filter((x) => x[0] && x[1]));
  ok('空白区切りの名簿でも打順と守備位置が組まれる',
    JSON.stringify(rows2) === JSON.stringify([['黒瀬', '捕'], ['大槻', '遊'], ['藤田', '投'], ['川越', '三'], ['芳賀 啓介', '二'], ['吉元', '一'], ['山浦', '左'], ['星野', '右'], ['中島', '中']]),
    JSON.stringify(rows2));

  // 「投」の藤田が先発投手になっている(守りに入ったとき、投手を選び直さなくてよい)
  await p.click('nav button:has-text("スコア入力")'); await W(400);
  for (let i = 0; i < 3; i++) { await p.click('.result-pad button:has-text("三振")'); await W(300); const o = p.locator('.sheet-actions button:has-text("確定")'); if (await o.count()) { await o.click(); await W(400); } }
  await W(400);
  ok('守りに入ると投手が藤田になっている', (await p.locator('select.pitcher-select').inputValue().then((v) => p.locator(`select.pitcher-select option[value="${v}"]`).innerText())) === '藤田');
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ roster paste PASS' : `\n✗ roster paste FAIL (${fail})`);
process.exit(fail ? 1 : 0);

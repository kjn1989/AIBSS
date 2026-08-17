// 画面が落ちたときの受け皿 e2e
// 守りたいこと:
//  - 描画エラーで真っ白にならず、受け皿が出る
//  - 「記録は消えていない」と先に言う
//  - バックアップをその場で書き出せる(再読み込みで直らないときの唯一の逃げ道)
//  - タブバーは生きていて、別のタブへ移れば記録は続けられる
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
const PORT = 4213;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 500)); }

let failures = 0;
const check = (n, c, d = '') => { console.log(`${c ? 'ok' : 'NG'} - ${n}${c ? '' : ` :: ${d}`}`); if (!c) failures++; };
const browser = await chromium.launch({ executablePath: resolveChromium() });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  // 描画エラーは console に出る(意図的に落としているので、失敗にはしない)
  page.on('pageerror', () => {});

  // まず普通に立ち上げて、データを入れておく
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(600); }

  // ---- わざと落とす ----
  await page.goto(`${URL_}?selftest=crash`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  const crash = page.locator('.crash');
  check('真っ白にならず受け皿が出る', (await crash.count()) === 1);
  const txt = await crash.innerText();
  check('記録は消えていないと先に言う', txt.includes('記録は消えていません'), txt.slice(0, 200));
  check('別の画面へ移れると書いてある', txt.includes('別の画面'), txt.slice(0, 300));
  // 逃げ道の順番。再読み込みで直らない場合はバックアップしか手が無いので、先に置く
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.crash button')].map((b) => b.textContent.trim()));
  check('バックアップが再読み込みより先にある',
    order.findIndex((x) => x.includes('バックアップ')) < order.findIndex((x) => x.includes('再読み込み')),
    JSON.stringify(order));

  // ---- その場でバックアップを書き出せる ----
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await crash.locator('button:has-text("バックアップ")').click();
  const file = await dl;
  check('バックアップが書き出せる', !!file, String(file));
  if (file) {
    check('ファイル名が復元できる形', /^aibss-backup_\d{4}-\d{2}-\d{2}\.json$/.test(file.suggestedFilename()),
      file.suggestedFilename());
    const p2 = await file.path();
    const json = JSON.parse(fs.readFileSync(p2, 'utf8'));
    check('中身が復元できる形', json.app === 'aibss-baseball-scorer' && json.version === 1,
      JSON.stringify({ app: json.app, version: json.version }));
    check('試合が入っている', Object.keys(json.games || {}).length > 0,
      String(Object.keys(json.games || {}).length));
  }
  await page.waitForTimeout(400);
  check('保存できたと伝える', (await crash.innerText()).includes('保存しました'));

  // ---- 技術的な内容も見られる(問い合わせのときに要る) ----
  await crash.locator('summary').click();
  await page.waitForTimeout(300);
  check('何が起きたか見られる', (await crash.locator('pre').innerText()).includes('selftest'));

  // ---- タブバーは生きていて、別のタブへ移れば使える ----
  const tabs = await page.locator('nav.tabbar button').count();
  check('タブバーが生きている', tabs >= 5, String(tabs));
  await page.click('nav button:has-text("成績")');
  await page.waitForTimeout(900);
  check('別のタブは普通に開く', (await page.locator('.crash').count()) === 0);
  check('別のタブに中身がある', (await page.locator('.main').innerText()).length > 20);

  // ---- 落ちるタブへ戻れば、また受け皿が出る(黙って壊れたままにしない) ----
  await page.click('nav button:has-text("ホーム")');
  await page.waitForTimeout(700);
  check('落ちる画面へ戻れば、また受け皿が出る', (await page.locator('.crash').count()) === 1);

  // ---- 仕掛けが無ければ、当然どこも落ちない ----
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  check('普段は受け皿が出ない', (await page.locator('.crash').count()) === 0);

  console.log(failures === 0 ? '\n✓ crash guard PASS' : `\n✗ crash guard FAIL (${failures})`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);

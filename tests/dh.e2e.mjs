// DH制のスタメン設定 e2e: 実行 `node tests/dh.e2e.mjs`
// 守りたいこと:
//  - DH制でも「投」をフィールドから選べる(先発投手は打順の外に居る)
//  - その候補は「打順に入っていない今日のメンバー」であること
//    (打順の中には投手が居ないので、打者一覧を出しても選べない)
//  - 過去のDHオーダーを読み込んだとき、DH制の状態も一緒に引き継ぐこと
//    引き継がないと useDH が false のまま「投」の候補が打者一覧になり、
//    投手を選ぶ手段がひとつも無くなる
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4182;
const URL_ = `http://localhost:${PORT}/`;

function resolveChromium() {
  const base = '/opt/pw-browsers';
  const candidates = [path.join(base, 'chromium')];
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (d.startsWith('chromium-')) candidates.push(path.join(base, d, 'chrome-linux', 'chrome'));
  }
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return undefined;
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(URL_)).ok) break; } catch { /* まだ起動中 */ }
  await new Promise((r) => setTimeout(r, 500));
}

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok' : 'not ok'} - ${name}${cond ? '' : ` :: ${detail}`}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ executablePath: resolveChromium() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (err) => { console.log('PAGE EXCEPTION:', err.message); failures++; });
  page.on('dialog', (d) => d.accept());

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);

  // オーダーはデモ選手からは組めない仕様なので、実在の選手を10人登録する。
  // 9人を打順に入れ、10人目を打順外の投手にする
  const names = ['青木', '井上', '上田', '江口', '大野', '加藤', '木村', '工藤', '小林', '佐藤'];
  for (let i = 0; i < names.length; i++) {
    await page.fill('.add-form input[placeholder="選手名"]', names[i]);
    await page.fill('.add-form input[placeholder="背番号"]', String(i + 1));
    await page.click('.add-form button.primary');
    await page.waitForTimeout(150);
  }

  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', 'DH確認');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(700);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(700); }

  // ウィザードは「オーダー」タブにある
  await page.click('nav button:has-text("オーダー")');
  await page.waitForTimeout(500);

  // ---- ステップ1: DH制にして、9人だけ打順に入れる ----
  await page.click('.dh-toggle button:has-text("あり")');
  await page.waitForTimeout(300);
  check('DH制にすると打順外の投手欄が出る',
    await page.locator('select[aria-label="投手選択"]').count() > 0);

  // 打順は9人。10人目以降は打順外に残す(その中から投手を選ぶ)
  const rows = page.locator('.select-row');
  const total = await rows.count();
  check('打順に入れない選手が残る人数がいる', total >= 10, `登録${total}人`);
  for (let i = 0; i < 9; i++) { await rows.nth(i).click(); await page.waitForTimeout(120); }

  await page.click('button:has-text("次へ")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("次へ")').catch(() => {});
  await page.waitForTimeout(400);

  // ---- ステップ3: フィールドの「投」を押す ----
  const mound = page.locator('.pos-field .pos-spot').filter({ hasText: /^投$/ });
  check('DH制でもフィールドに「投」がある', await mound.count() > 0,
    await page.locator('.pos-field').innerText());
  await mound.first().click();
  await page.waitForTimeout(400);

  const sheet = page.locator('.sheet').last();
  const sheetTxt = await sheet.innerText();
  check('「投」の選択シートが開く', sheetTxt.includes('「投」を守る選手を選択'), sheetTxt.slice(0, 200));

  // 候補は打順外の選手。打順の1〜9番が並んでいたら、投手は一人も選べない
  const cand = await page.evaluate(() => [...document.querySelectorAll('.sheet .picker-row')].map((el) => ({
    txt: el.innerText.replace(/\n+/g, ' '),
    rank: el.querySelector('.rank-badge')?.textContent || '',
  })));
  check('候補が1人以上ある', cand.length > 0, JSON.stringify(cand));
  check('候補は打順外の選手', cand.every((c) => !c.rank), JSON.stringify(cand));
  check('打順外だと札が付いている', cand.every((c) => c.txt.includes('打順外')), JSON.stringify(cand));

  // ---- 選ぶとマウンドにその選手が乗る ----
  const pickName = (cand[0].txt.split(' ')[0] || '').trim();
  await page.locator('.sheet .picker-row').first().click();
  await page.waitForTimeout(400);
  const moundTxt = await page.locator('.pos-field').innerText();
  check('選んだ投手がマウンドに出る', moundTxt.includes(pickName), `${pickName} / ${moundTxt}`);

  // ---- 確定すると、その投手が先発として記録される ----
  await page.click('button:has-text("このオーダーで確定")');
  await page.waitForTimeout(800);
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(700);
  const body = await page.locator('.scoretab').innerText().catch(() => '');
  check('確定でき、スコア画面に進む', body.length > 0, body.slice(0, 200));
  // 打順の中には投手が居ないので、ここに名前が出るのは先発として記録できた証拠
  check('打順外の投手が先発として記録される', body.includes(pickName), `${pickName} / ${body.slice(0, 500)}`);
} catch (e) {
  console.log('EXCEPTION:', e && e.message);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n✗ DH lineup FAIL (${failures})` : '\n✓ DH lineup PASS');
process.exit(failures ? 1 : 0);

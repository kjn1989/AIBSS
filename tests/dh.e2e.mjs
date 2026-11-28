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

// 画面が落ちていないか。エラー境界が例外を握るので pageerror では拾えず、
// 「要素が見つからない」という別の顔で出てくる。原因が読めるように名指しする。
let pageRef = null;
const crashGuard = async (where) => {
  if (!pageRef) return false;
  if (await pageRef.locator('.crash').count()) {
    check(`画面が落ちていない (${where})`, false, await pageRef.locator('.crash').innerText());
    return true;
  }
  return false;
};

const browser = await chromium.launch({ executablePath: resolveChromium() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  pageRef = page;
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
  await page.click('button:has-text("くわしく")').catch(() => {}); // 既存のテストは1球ごとの記録が前提
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

  // ---- DHカード: いまの状態が出て、DHを解除できる ----
  await page.click('nav button:has-text("オーダー")');
  await page.waitForTimeout(600);
  const dhCard = page.locator('.dh-card');
  check('オーダーにDH制のカードが出る', await dhCard.count() === 1);
  const dhTxt = await dhCard.innerText().catch(() => '');
  check('カードに投手の名前が出る', dhTxt.includes(`投手: ${pickName}`), dhTxt);
  await dhCard.locator('button:has-text("DHを解除する")').click();
  await page.waitForTimeout(400);
  const opt = page.locator('.sheet .dh-opts').nth(1).locator('button').first();
  const optTxt = (await opt.innerText()).replace(/\n+/g, ' ');
  const newP = optTxt.split(' が投手に')[0].trim();
  check('解除シートに「◯◯が投手に」が出る', !!newP && optTxt.includes('へ'), optTxt);
  await opt.click();
  await page.waitForTimeout(700);
  const after = await page.locator('.main').innerText();
  check('解除後はDHが打順から消え、解除済みと出る', after.includes('DHを解除しました') && !(await page.locator('.dh-card').count()), after.slice(0, 400));
  check('前の投手は退いた選手に入る', after.includes(pickName), after.slice(0, 600));
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(700);
  const body2 = await page.locator('.scoretab').innerText().catch(() => '');
  check('打順の野手が新しい投手になる', body2.includes(newP), `${newP} / ${body2.slice(0, 400)}`);

  // ---- 大谷ルール: DHの選手を先発投手にもできる(まっさらな端末で) ----
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const pg = await ctx2.newPage();
  pg.on('pageerror', (err) => { console.log('PAGE EXCEPTION:', err.message); failures++; });
  pg.on('dialog', (d) => d.accept());
  await pg.goto(URL_, { waitUntil: 'load' }); await pg.waitForTimeout(800);
  await pg.click('button[aria-label="設定"]'); await pg.waitForTimeout(400);
  for (let i = 0; i < names.length; i++) {
    await pg.fill('.add-form input[placeholder="選手名"]', names[i]);
    await pg.fill('.add-form input[placeholder="背番号"]', String(i + 1));
    await pg.click('.add-form button.primary'); await pg.waitForTimeout(120);
  }
  await pg.click('nav button:has-text("スコア入力")'); await pg.waitForTimeout(400);
  await pg.click('button:has-text("くわしく")').catch(() => {});
  await pg.fill('input[placeholder="対戦相手名"]', '大谷確認');
  await pg.click('button:has-text("試合開始")'); await pg.waitForTimeout(700);
  const att2 = pg.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att2.count()) { await pg.click('.sheet-actions button.primary'); await pg.waitForTimeout(700); }
  await pg.click('nav button:has-text("オーダー")'); await pg.waitForTimeout(500);
  await pg.click('.dh-toggle button:has-text("あり")'); await pg.waitForTimeout(300);
  const r2 = pg.locator('.select-row');
  for (let i = 0; i < 9; i++) { await r2.nth(i).click(); await pg.waitForTimeout(100); }
  await pg.click('button:has-text("次へ")'); await pg.waitForTimeout(400);
  await pg.click('button:has-text("次へ")').catch(() => {}); await pg.waitForTimeout(400);
  // まず「指」(DH)に1人を置く
  await pg.locator('.pos-field .pos-spot').filter({ hasText: /^指$/ }).first().click();
  await pg.waitForTimeout(400);
  const dhName = (await pg.locator('.sheet .picker-row').first().innerText()).replace(/^\d+\s*/, '').split(/\s|\n/)[0];
  await pg.locator('.sheet .picker-row').first().click();
  await pg.waitForTimeout(400);
  await pg.locator('.pos-field .pos-spot').filter({ hasText: /^投$/ }).first().click();
  await pg.waitForTimeout(400);
  const two = pg.locator('.sheet .picker-row').filter({ hasText: '大谷ルール' });
  check('投手の候補にDHの選手(大谷ルール)が出る', await two.count() === 1, await pg.locator('.sheet').last().innerText());
  if (await two.count()) {
    await two.click(); await pg.waitForTimeout(400);
    await pg.click('button:has-text("このオーダーで確定")'); await pg.waitForTimeout(800);

    const c2 = await pg.locator('.dh-card').innerText().catch(() => '');
    check('DH兼投手だとカードに「兼ねています」と出る', c2.includes(`${dhName} が投手とDHを兼ねています`), `${dhName} / ${c2}`);
  }
  await ctx2.close();

} catch (e) {
  // 要素が見つからない失敗は、たいてい画面が落ちている。
  // エラー境界が例外を握るので pageerror では拾えず、原因が読めなくなる
  await crashGuard('例外時').catch(() => {});
  console.log('EXCEPTION:', e && e.message);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n✗ DH lineup FAIL (${failures})` : '\n✓ DH lineup PASS');
process.exit(failures ? 1 : 0);

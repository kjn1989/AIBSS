// 試合中に打順の並びを直す e2e: 実行 `node tests/fixorder.e2e.mjs`
//
// 実際に起きたこと: 7番と8番を逆に組んだまま3回まで記録してしまった。
// 打席は画面に出ていた名前で残っているので、並びを直すだけでは記録が合わない。
// 交代では直せない(同じ選手が2枠を占める途中の状態を SUBSTITUTE が止める)。
//
// 守りたいこと:
//  - 試合中でも打順の並びを直せること
//  - すでに記録した打席が、本来の選手へ一緒に移ること
//  - 何件動くのかを、押す前に見せること
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4186;
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pageRef = page;
  page.on('pageerror', (err) => { console.log('PAGE EXCEPTION:', err.message); failures++; });
  page.on('dialog', (d) => d.accept());

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(500); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', '打順直し');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(700);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(700); }
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(500); }

  // ---- 1番から順に打たせて、1番の打席を記録に残す ----
  const play = async () => {
    await page.click('.result-pad button:has-text("ヒット")');
    await page.waitForTimeout(300);
    const coach = page.locator('.pad-coach button');
    if (await coach.count()) { await coach.click(); await page.waitForTimeout(150); }
    const f = page.locator('.field-pad button.field-pos').first();
    if (await f.count()) { await f.click(); await page.waitForTimeout(550); }
    const ok = page.locator('.sheet-actions button:has-text("確定")');
    if (await ok.count()) { await ok.click(); await page.waitForTimeout(450); }
  };
  await play();
  await play();

  // ---- オーダータブへ。1番と2番の名前を覚えておく ----
  await page.click('nav button:has-text("オーダー")');
  await page.waitForTimeout(600);
  const nameAt = async (n) => (await page.locator('.card .row').nth(n - 1).locator('b').innerText()).trim();
  const before1 = await nameAt(1);
  const before2 = await nameAt(2);
  check('打順に2人以上いる', !!before1 && !!before2, `${before1} / ${before2}`);

  // ---- 打順を直すモード ----
  const fixBtn = page.locator('button:has-text("打順の並びを直す")');
  check('打順を直す口がある', await fixBtn.count() > 0);
  await fixBtn.click();
  await page.waitForTimeout(400);
  check('交代とは別物だと書いてある',
    (await page.locator('.card').first().innerText()).includes('交代を使って'),
    (await page.locator('.card').first().innerText()).slice(0, 400));

  // 1番の行の▼で、2番と入れ替える
  await page.locator('.card .row').nth(0).locator('.ord-move button:has-text("▼")').click();
  await page.waitForTimeout(500);
  const ask = page.locator('.sheet').last();
  const askTxt = await ask.innerText();
  check('確認が出る', askTxt.includes('入れ替え'), askTxt.slice(0, 300));
  check('何件の記録が動くか出ている', /\d+件/.test(askTxt), askTxt.slice(0, 300));
  check('両方の名前が出ている', askTxt.includes(before1) && askTxt.includes(before2), askTxt.slice(0, 300));

  await ask.locator('button:has-text("入れ替える")').click();
  await page.waitForTimeout(700);

  check('1番と2番が入れ替わった', await nameAt(1) === before2 && await nameAt(2) === before1,
    `${await nameAt(1)} / ${await nameAt(2)}`);

  // ---- 記録済みの打席も移っている ----
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(600);
  const all = page.locator('button:has-text("すべて見る")');
  if (await all.count()) { await all.first().click(); await page.waitForTimeout(400); }
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll('.log-line')].map((el) => el.innerText.replace(/\n+/g, ' ')));
  check('打席の記録が2件残っている', lines.length >= 2, JSON.stringify(lines));
  const joined = lines.join(' | ');
  check('記録の一覧に両方の名前が残っている',
    joined.includes(before1) && joined.includes(before2), joined);
  // 一覧は新しい順に出る。古いほう(末尾)が1打席目
  const pa = lines.filter((l) => l.includes(before1) || l.includes(before2));
  const first = pa[pa.length - 1] || '';
  const second = pa[0] || '';
  // 1打席目は「元の1番」で記録されていた。入れ替えたので元の2番のものになる
  check('1打席目が入れ替わった側の選手になっている',
    first.includes(before2) && !first.includes(before1), `1打席目=${first} :: ${joined}`);
  check('2打席目も入れ替わっている',
    second.includes(before1) && !second.includes(before2), `2打席目=${second} :: ${joined}`);


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
console.log(failures ? `\n✗ fix order FAIL (${failures})` : '\n✓ fix order PASS');
process.exit(failures ? 1 : 0);

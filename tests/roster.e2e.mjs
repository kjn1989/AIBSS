// 名簿e2e: 投/打の列見出しと、選手をまとめて整理する(アーカイブ・削除)
// 実行: npm run test:e2e
// 守りたいこと:
//  - 削除は取り消せない。名簿の行から直接消せてはいけない(確認を必ず挟む)
//  - 投/打の列見出しが、実際のセレクトの真上から動かない
//  - アーカイブは可逆(戻せる)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4175;
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.on('pageerror', (e) => { console.log('PAGE EXCEPTION:', e.message); failures++; });

  await page.goto(URL_, { waitUntil: 'load' });
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = (await indexedDB.databases?.()) || [];
    await Promise.all(dbs.map((d) => new Promise((res) => {
      const r = indexedDB.deleteDatabase(d.name);
      r.onsuccess = res; r.onerror = res; r.onblocked = res;
    })));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(800); }

  // ---- 取り消せない操作が名簿の行に無い ----
  const rowText = await page.locator('.roster-list .row').first().innerText();
  check('名簿の行に削除ボタンが無い', !rowText.includes('🗑'), rowText);
  check('名簿の行にアーカイブボタンが無い', !rowText.includes('📥'), rowText);

  // ---- 投/打の列見出しが、セレクトの真上にある ----
  const alignment = () => page.evaluate(() => {
    const heads = [...document.querySelectorAll('.roster-colhead i, .grade-head .hand-cols i')].slice(0, 2);
    const sels = [...document.querySelector('.roster-list .row').querySelectorAll('.hand-select')];
    if (heads.length !== 2 || sels.length !== 2) return null;
    const cx = (e) => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; };
    return {
      text: heads.map((h) => h.textContent).join(''),
      off: heads.map((h, i) => Math.round(Math.abs(cx(h) - cx(sels[i])))),
    };
  });
  const a1 = await alignment();
  check('区切りが無い版は一覧の直上に列見出しを出す', a1 && a1.text === '投打', JSON.stringify(a1));
  check('列見出しがセレクトの真上にある', a1 && a1.off.every((d) => d <= 1), JSON.stringify(a1));

  await page.locator('button:has-text("ブカツ")').first().click();
  await page.waitForTimeout(600);
  const nHeads = await page.locator('.grade-head').count();
  const cols = await page.locator('.grade-head .hand-cols').allInnerTexts();
  check('学年の区切りすべてに投/打が載る',
    nHeads > 0 && cols.length === nHeads && cols.every((x) => x.replace(/\s/g, '') === '投打'),
    JSON.stringify({ nHeads, cols }));
  check('区切りがある版では一覧の直上には出さない', (await page.locator('.roster-colhead').count()) === 0);
  const a2 = await alignment();
  check('ブカツ版でも列見出しがセレクトの真上にある', a2 && a2.off.every((d) => d <= 1), JSON.stringify(a2));

  // ---- まとめて整理する ----
  await page.locator('button:has-text("選手をまとめて整理する")').click();
  await page.waitForTimeout(500);
  const total = await page.locator('.mg-row').count();
  check('在籍者が並ぶ', total > 0, `${total}`);
  check('誰も選んでいなければ実行できない', await page.locator('.mg-bar .go').isDisabled());
  check('誰も選んでいなければ削除できない', await page.locator('.mg-bar .del').isDisabled());

  await page.locator('.mg-row').first().click();
  await page.waitForTimeout(250);
  check('選ぶと実行ボタンに人数が出る',
    (await page.locator('.mg-bar .go').innerText()).includes('1人'),
    await page.locator('.mg-bar .go').innerText());

  // 削除は必ず確認を挟み、やめれば1人も消えない
  await page.locator('.mg-bar .del').click();
  await page.waitForTimeout(400);
  check('削除は確認を挟む', (await page.locator('.mg-confirm-row').count()) === 1);
  await page.locator('.sheet-actions button:has-text("やめる")').click();
  await page.waitForTimeout(350);
  check('やめると誰も消えない', (await page.locator('.mg-row').count()) === total,
    `${await page.locator('.mg-row').count()} / ${total}`);

  // アーカイブは可逆
  await page.locator('.mg-bar .go').click();
  await page.waitForTimeout(400);
  check('アーカイブすると在籍から外れる', (await page.locator('.mg-row').count()) === total - 1);
  const tabs = page.locator('.sheet .lens-row button');
  await tabs.nth(1).click();
  await page.waitForTimeout(350);
  check('アーカイブ済みタブに移る', (await page.locator('.mg-row').count()) === 1);
  await page.locator('.mg-row').first().click();
  await page.waitForTimeout(200);
  await page.locator('.mg-bar .go').click();
  await page.waitForTimeout(400);
  check('戻すと在籍に返る', (await page.locator('.mg-row').count()) === 0);
  await tabs.first().click();
  await page.waitForTimeout(350);
  check('在籍が元の人数に戻る', (await page.locator('.mg-row').count()) === total,
    `${await page.locator('.mg-row').count()} / ${total}`);

  // 確認まで進めば実際に消える
  await page.locator('.mg-row').last().click();
  await page.waitForTimeout(200);
  await page.locator('.mg-bar .del').click();
  await page.waitForTimeout(400);
  await page.locator('.sheet-actions button:has-text("記録ごと削除する")').click();
  await page.waitForTimeout(500);
  check('確認すれば削除できる', (await page.locator('.mg-row').count()) === total - 1,
    `${await page.locator('.mg-row').count()} / ${total - 1}`);

  check('横はみ出しなし', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
} finally {
  await browser.close();
  server.kill();
}
console.log(failures === 0 ? '\n✓ roster PASS' : `\n✗ roster ${failures} 件 NG`);
process.exit(failures === 0 ? 0 : 1);

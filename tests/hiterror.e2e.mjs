// 安打と失策が同じプレイに付く e2e: 実行 `node tests/hiterror.e2e.mjs`
//
// 記録規則では、安打かどうかは打球そのもので決まり、そのあと守備が乱れて
// 余分に進んだぶんは失策になる。つまり1つのプレイに安打と失策が同時に付く。
//   例) 右翼へのツーベース。右翼手の送球が逸れて打者走者が三塁へ。
//       → 打者は二塁打、右翼手に送球失策1
// result は1つしか持てないので、以前は「安打か失策か」の二択だった。
//
// 守りたいこと:
//  - 安打を選んだままで失策を足せること
//  - 打った記録は安打のまま(失策に化けない)
//  - ラインスコアのEが1つ増えること
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4184;
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
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(500); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', '安打と失策');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(700);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(700); }
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(500); }

  // ---- ツーベースを記録する ----
  await page.click('.result-pad button:has-text("ツーベース")');
  await page.waitForTimeout(400);
  const coach = page.locator('.pad-coach button');
  if (await coach.count()) { await coach.click(); await page.waitForTimeout(200); }
  // 右翼へ
  const rf = page.locator('.field-pad button.field-pos:has-text("右")').first();
  if (await rf.count()) { await rf.click(); } else { await page.locator('.field-pad button.field-pos').first().click(); }
  await page.waitForTimeout(600);

  const sheet = page.locator('.sheet').last();
  check('失策の欄が出ている', (await sheet.innerText()).includes('このプレイで失策'),
    (await sheet.innerText()).slice(0, 400));

  // ---- 送球失策を足す ----
  await page.locator('.play-error button:has-text("送球")').click();
  await page.waitForTimeout(300);
  const pos = await page.locator('.pe-pos button.primary').count();
  check('打った方向の野手が最初から選ばれている', pos === 1, `選択中=${pos}`);
  const posName = await page.locator('.pe-pos button.primary').innerText();
  check('右翼の失策として選ばれている', posName === '右', posName);

  const q = await page.locator('.confirm-card').innerText();
  check('確認文にツーベースが残っている', q.includes('ツーベース'), q);
  check('確認文に失策も出る', q.includes('失策'), q);

  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(800);

  // ---- 打った記録は安打のまま、Eが1つ増えている ----
  // 自チームは先攻(away)。R/H/E は行末の3つ
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.led-ls tr')].map((r) => ({
      cells: [...r.querySelectorAll('th,td')].map((c) => c.textContent.trim()),
      away: !!r.querySelector('td.ini'),
    })));
  const head = rows.find((r) => r.cells.includes('H') && r.cells.includes('E'));
  check('ラインスコアにH/Eの欄がある', !!head, JSON.stringify(rows.map((r) => r.cells)));
  const hi = head.cells.indexOf('H');
  const ei = head.cells.indexOf('E');
  const me = rows.find((r) => r.away && r.cells.length === head.cells.length);
  check('安打が1本ついている(失策に化けていない)', me?.cells[hi] === '1',
    JSON.stringify(rows.map((r) => r.cells)));
  check('相手のEが1つ増えている',
    rows.some((r) => r !== head && r.cells[ei] === '1'), JSON.stringify(rows.map((r) => r.cells)));

  const log = await page.locator('.scoretab').innerText();
  check('記録の文にも失策が残る', log.includes('失'), log.slice(0, 600));
} catch (e) {
  console.log('EXCEPTION:', e && e.message);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n✗ hit+error FAIL (${failures})` : '\n✓ hit+error PASS');
process.exit(failures ? 1 : 0);

// 盗塁死の間にほかの走者が生還・進塁する場面を、1回で記録できることのe2e。
// 守りたいこと:
//  - 一三塁で一塁走者を押すと「盗塁死＋その間に三塁走者が生還」が出て、押すと
//    アウト+1・得点+1・塁が空く、が一度に入る
//  - 盗塁死は刺された走者(一塁走者)に付き、生還は別の行になる(盗塁死が三塁走者に付かない)
//  - 1回の取り消しで両方とも戻る
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
const PORT = 4219;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 500)); }

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok' : 'NG'} - ${n}${c ? '' : ' :: ' + d}`); if (!c) fail++; };
const b = await chromium.launch({ executablePath: resolveChromium() });
try {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  p.on('pageerror', (e) => { console.log('EXC:', e.message); fail++; });
  const W = (ms) => p.waitForTimeout(ms);
  await p.goto(URL_, { waitUntil: 'load' }); await W(900);
  await p.click('button[aria-label="設定"]'); await W(400);
  await p.locator('button:has-text("デモデータを投入")').click(); await W(600);
  await p.click('nav button:has-text("スコア入力")'); await W(400);
  await p.click('.mode-opt:has-text("かんたん")');
  await p.fill('input[placeholder="対戦相手名"]', '挟殺');
  await p.click('button:has-text("試合開始")'); await W(700);
  const att = p.locator('.sheet').filter({ hasText: '今日のメンバー' }); if (await att.count()) { await p.click('.sheet-actions button.primary'); await W(600); }
  await p.locator('button:has-text("登録選手から打順を自動セット")').click(); await W(500);

  // 三塁打 → 四球 で一三塁
  await p.locator('.result-pad button:has-text("スリーベース")').first().click(); await W(400);
  const coach = p.locator('.pad-coach button'); if (await coach.count()) { await coach.click(); await W(150); }
  await p.locator('.field-pad button.field-pos').nth(7).click(); await W(800);
  await p.locator('.sheet-actions button:has-text("確定")').click(); await W(500);
  await p.locator('.result-pad button:has-text("四球")').first().click(); await W(700);
  const on = (bn) => p.locator(`.sit-card .field-diamond-crop.mini .base.b${bn}.occupied`).count();
  ok('一三塁になる', (await on(1)) === 1 && (await on(3)) === 1);
  const outs = () => p.evaluate(() => document.querySelectorAll('.led-bso .r.o i.on').length);
  const outs0 = await outs();
  // 自チームの得点(ラインスコアの1回の数字)
  const runs1 = () => p.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((r) => r.querySelector('td.ini'));
    return Number(row?.querySelector('td.inn .rn')?.textContent.trim() || 0);
  });
  const r0 = await runs1();

  // 小さいダイヤ → 大きな図で一塁 → 「盗塁死＋その間に三塁走者が生還」
  await p.locator('.sit-card .field-diamond-crop.mini').first().click(); await W(400);
  await p.click('.sheet .base-pick .base.b1'); await W(400);
  const combo = p.locator('.sheet .cs-combo').first();
  ok('一塁走者のシートに「盗塁死＋その間に三塁走者が生還」が出る', (await combo.innerText()).includes('三塁走者が生還'), await combo.innerText().catch(() => ''));
  await combo.click(); await W(600);
  ok('アウトが1つ増える', (await outs()) === outs0 + 1, `${outs0} → ${await outs()}`);
  ok('塁が空く', (await on(1)) === 0 && (await on(3)) === 0);
  ok('三塁走者の得点が入る', (await runs1()) === r0 + 1, `${r0} → ${await runs1()}`);
  const logs = (await p.locator('.log-line').allInnerTexts()).join(' | ');
  ok('試合経過に「盗塁死」と「盗塁死の間に生還」が別々に出る', logs.includes('盗塁死の間に生還') && /盗塁死(?!の間)/.test(logs), logs);

  // 1回の取り消しで両方戻る
  await p.locator('button.undo-op').first().click();
  await W(500);
  ok('取り消すと一三塁に戻る', (await on(1)) === 1 && (await on(3)) === 1);

  // ---- 細かく指定: 暴投で三塁走者だけ生還、一塁走者はそのまま ----
  const outsA = await outs();
  const rA = await runs1();
  await p.locator('.sit-card .field-diamond-crop.mini').first().click(); await W(400);
  await p.click('.sheet .base-pick .base.b3'); await W(400);
  await p.click('.sheet button:has-text("細かく指定")'); await W(300);
  await p.click('.custom-runner .cr-chips button:has-text("暴投")'); await W(150);
  // 三塁走者は最初から「生還」が選ばれている。一塁走者は「そのまま」
  const rows = p.locator('.custom-runner .cr-row');
  ok('細かく指定に走者が2人並ぶ', (await rows.count()) === 2);
  await rows.nth(0).locator('button:has-text("生還")').click();
  await rows.nth(1).locator('button:has-text("そのまま")').click();
  await p.click('.custom-runner button:has-text("この内容で記録する")'); await W(600);
  ok('暴投で三塁走者だけ生還(1点・一塁はそのまま・アウトは増えない)', (await runs1()) === rA + 1 && (await on(1)) === 1 && (await on(3)) === 0 && (await outs()) === outsA,
    `runs ${rA}→${await runs1()} b1=${await on(1)} b3=${await on(3)} outs ${outsA}→${await outs()}`);
  ok('試合経過に「暴投」と出る', (await p.locator('.log-line').first().innerText()).includes('暴投'), await p.locator('.log-line').first().innerText());

  // ---- 盗塁＋悪送球で三塁へ(一塁走者だけのとき) ----
  await p.locator('.sit-card .field-diamond-crop.mini').first().click(); await W(400);
  await p.click('.sheet .base-pick .base.b1'); await W(400);
  await p.click('.sheet button:has-text("盗塁＋悪送球で三塁へ")'); await W(600);
  ok('盗塁＋悪送球で三塁へ進む', (await on(3)) === 1 && (await on(1)) === 0);
  const ll = (await p.locator('.log-line').allInnerTexts()).slice(0, 3).join(' | ');
  ok('盗塁と「悪送球で進塁」が別々に残る', ll.includes('悪送球で進塁') && ll.includes('盗塁'), ll);

  // ---- 「この走者が得点」は暴投ではなく「進塁」として残る ----
  await p.locator('.sit-card .field-diamond-crop.mini').first().click(); await W(400);
  await p.click('.sheet .base-pick .base.b3'); await W(400);
  await p.click('.sheet button:has-text("この走者が得点")'); await W(600);
  ok('「この走者が得点」は暴投と記録されない', !(await p.locator('.log-line').first().innerText()).includes('暴投'), await p.locator('.log-line').first().innerText());
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ cs + run PASS' : `\n✗ cs + run FAIL (${fail})`);
process.exit(fail ? 1 : 0);

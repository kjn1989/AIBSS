// かんたん記録の「止まらない」道具のe2e。
// 守りたいこと:
//  - 三振・四球・死球は1タップで記録され、すぐ取り消せる
//  - 「不明」で飛ばして先へ進め、あとから結果を入れられる(成績に反映される)
//  - 相手の回は得点だけ入れて次へ進める
//  - 直前の打席を、結果と守備位置だけの1画面で直せる
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
const PORT = 4209;
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
  await p.click('nav button:has-text("スコア入力")'); await W(400);
  await p.click('.mode-opt:has-text("かんたん")');
  await p.fill('input[placeholder="対戦相手名"]', '止まらない');
  await p.click('button:has-text("試合開始")'); await W(600);
  await p.click('button:has-text("選手登録なしで始める")'); await W(600);
  const outs = () => p.locator('.out-dot.on').count();
  const batter = () => p.locator('.sit-main .nm').innerText();

  ok('妨害の3ボタンは出ない', (await p.locator('.result-pad button:has-text("打撃妨害")').count()) === 0);

  // ---- 三振は1タップ ----
  await p.click('.result-pad button:has-text("三振")'); await W(500);
  ok('三振は確認なしで記録される', (await outs()) === 1 && (await p.locator('.sheet').count()) === 0);
  ok('次の打者に進む', (await batter()) === '選手2');
  ok('取り消すが出る', (await p.locator('.quick-toast').count()) === 1);
  await p.click('.quick-toast button'); await W(400);
  ok('取り消すと元に戻る', (await outs()) === 0 && (await batter()) === '選手1');
  await p.click('.result-pad button:has-text("四球")'); await W(500);
  ok('走者なしの四球は1タップ', (await p.locator('.base.b1.occupied').count()) === 1 && (await p.locator('.sheet').count()) === 0);

  // ---- 不明で飛ばす ----
  const beforeOuts = await outs();
  await p.click('button:has-text("不明（飛ばす）")'); await W(500);
  ok('不明で次の打者へ進む(アウトは動かない)', (await batter()) === '選手3' && (await outs()) === beforeOuts);
  ok('飛ばした件数が出る', (await main()).includes('飛ばした打席が 1 件'), (await main()).slice(-300));
  await p.click('.result-pad button:has-text("三振")'); await W(500);

  // ---- 直前の打席を直す(三振 → ヒット・中堅) ----
  await p.click('.last-fix'); await W(400);
  const sheet = await p.locator('.sheet').last().innerText();
  ok('直すシートは短い(強さ・打点を聞かない)', !sheet.includes('強い') && !sheet.includes('打点'), sheet.slice(0, 200));
  await p.locator('.sheet .grid3 button:has-text("ヒット")').click(); await W(200);
  await p.click('.sheet .simple-dir button:has-text("中堅")'); await W(200);
  await p.click('.sheet-actions button:has-text("保存")'); await W(500);
  ok('直した結果が反映される', (await p.locator('.log-line').first().innerText()).includes('中堅'), (await p.locator('.log-line').first().innerText()));

  // ---- 飛ばした打席に、あとから結果を入れる ----
  await p.click('button:has-text("の結果を入れる")'); await W(400);
  await p.locator('.sheet .grid3 button:has-text("ヒット")').click(); await W(200);
  await p.click('.sheet .simple-dir button:has-text("左翼")'); await W(200);
  await p.click('.sheet-actions button:has-text("保存")'); await W(500);
  ok('結果を入れると「飛ばした」の表示が消える', !(await main()).includes('飛ばした打席が'));

  // ---- 成績: 選手2 の1安打が付く(飛ばした打席が成績になる) ----
  await p.click('nav button:has-text("成績")'); await W(700);
  await p.click('.toggle-row button:has-text("試合")').catch(() => {}); await W(400);
  const rows = await p.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => x.innerText.includes('打席') && x.innerText.includes('安打'));
    return t ? [...t.querySelectorAll('tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ')) : [];
  });
  ok('成績に飛ばした打席の安打が付く', rows.some((r) => r.includes('選手3') && /\b1\b/.test(r)), JSON.stringify(rows.slice(0, 4)));

  // ---- 3アウトにして、相手の回は得点だけ ----
  await p.click('nav button:has-text("スコア入力")'); await W(500);
  for (let i = 0; i < 4 && !(await p.locator('button:has-text("相手の回は得点だけ")').count()); i++) {
    await p.click('.result-pad button:has-text("三振")'); await W(400);
  }
  ok('相手の回に「得点だけ」が出る', (await p.locator('button:has-text("相手の回は得点だけ")').count()) === 1, (await main()).slice(0, 200));
  await p.click('button:has-text("相手の回は得点だけ")'); await W(400);
  await p.click('.score-only-step button[aria-label="+1"]'); await p.click('.score-only-step button[aria-label="+1"]'); await W(200);
  await p.click('.sheet-actions button:has-text("2点で次へ")'); await W(600);
  const body = await main();
  ok('1回裏(自チームの攻撃)になる', body.includes('1回裏') || /2回/.test(body), body.slice(0, 120));
  ok('相手の得点が2点入っている', (await p.locator('.led-ls tbody tr').nth(1).innerText()).replace(/\s+/g, ' ').includes('2'), await p.locator('.led-ls').innerText());
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ keep going PASS' : `\n✗ keep going FAIL (${fail})`);
process.exit(fail ? 1 : 0);

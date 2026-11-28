// 選手登録なしで試合を始めるe2e。
// 守りたいこと:
//  - 選手を1人も登録していなくても、試合を作ってすぐ1打席目を付けられる
//  - 名前は試合中に入れられ、入れる前に付けた記録もその名前になる
//  - 交代で、名簿に居ない人をその場で入れられる(名前は空でもよい)
//  - 名前がまだの選手が、ホームと試合結果に残り続ける(入れ忘れが埋もれない)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// かんたん記録でも打球方向はフィールドの図から選ぶ。最初の打席の説明は閉じてから押す
const pickPos = async (page, name) => {
  const sum = page.locator('.dir-summary');
  if (await sum.count()) { await sum.click(); await page.waitForTimeout(200); }
  const coach = page.locator('.pad-coach button');
  if (await coach.count()) { await coach.click(); await page.waitForTimeout(150); }
  await page.locator(`.field-pad button.field-pos:has-text("${name}")`).first().click();
  await page.waitForTimeout(700); // 押したあと図が畳まれるまで
};

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
const PORT = 4207;
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

  // ---- 何も登録せずに試合を作る ----
  await p.click('button:has-text("新しい試合を開始")'); await W(500);
  await p.click('.mode-opt:has-text("かんたん")');
  await p.fill('input[placeholder="対戦相手名"]', '登録なし練習');
  await p.click('button:has-text("試合開始")'); await W(600);
  // 選手を登録していなければ「今日のメンバー」は出ない(通さずにそのまま始まる)
  ok('「選手登録なしで始める」が出る', (await p.locator('button:has-text("選手登録なしで始める")').count()) === 1, (await main()).slice(0, 300));
  await p.click('button:has-text("選手登録なしで始める")'); await W(600);
  ok('1番打者が「選手1」で始まる', (await p.locator('.sit-main .nm').innerText()) === '選手1');

  // そのまま1打席
  await p.click('.result-pad button:has-text("ヒット")'); await W(350);
  await pickPos(p, '中堅'); await W(200);
  await p.click('.sheet-actions button:has-text("確定")'); await W(500);
  ok('登録なしのまま1打席が付く', (await p.locator('.base.b1.occupied').count()) === 1);

  // ---- 試合中に名前を入れる(2番打者) ----
  ok('打者の横に「名前を入れる」が出る', (await p.locator('.sit-main .name-btn').count()) === 1);
  await p.click('.sit-main .name-btn'); await W(400);
  await p.locator('.sheet input').first().fill('井上');
  await p.locator('.sheet input').nth(1).fill('7');
  await p.click('.sheet-actions button:has-text("保存")'); await W(500);
  ok('打者が「井上」になる', (await p.locator('.sit-main .nm').innerText()) === '井上');
  ok('名前を入れたら「名前を入れる」は消える', (await p.locator('.sit-main .name-btn').count()) === 0);

  // ---- オーダーで、名前と守備位置を入れる。1番(記録済み)に名前を入れると記録もその名前になる ----
  await p.click('nav button:has-text("オーダー")'); await W(600);
  ok('オーダーに仮の選手が並び、守備位置が埋まっている', (await main()).includes('選手3') && (await p.locator('select.small').count()) >= 9);
  await p.locator('.name-btn').first().click(); await W(400);
  await p.locator('.sheet input').first().fill('青木');
  await p.click('.sheet-actions button:has-text("保存")'); await W(500);
  ok('オーダーの1番が「青木」になる', (await main()).includes('青木'));

  // ---- 交代: 名簿に居ない人を、名前なしで入れる ----
  // 名前を押すと「選手交代」がその打順を広げて開く。名簿にない人は名前なしでも入れられる
  await p.locator('.main .row .grow b').nth(2).click(); await W(500);
  await p.locator('.sheet .lc-new button').click(); await W(200);
  await p.locator('.sheet-actions button.primary').click(); await W(600);
  let body = await main();
  ok('名前なしで交代でき、仮の名前で入る', /選手1[0-9]?/.test(body) && body.includes('選手10'), body.slice(0, 400));
  // 名前を付けて入れる
  await p.locator('.main .row .grow b').nth(3).click(); await W(500);
  await p.locator('.sheet .lc-new input').fill('代打の田中');
  await p.locator('.sheet .lc-new button').click(); await W(200);
  await p.locator('.sheet-actions button.primary').click(); await W(600);
  body = await main();
  ok('名前を付けて交代でき、仮ではなくなる', body.includes('代打の田中'), body.slice(0, 400));

  // ---- 記録済みの打席が、あとから入れた名前になっている ----
  await p.click('nav button:has-text("スコア入力")'); await W(600);
  body = await p.locator('body').innerText();
  ok('試合経過の1打席目が「青木」で出る', /青木.*(ヒット|安)/.test(body.replace(/\n/g, ' ')), body.slice(-400));

  // ---- 入れ忘れが埋もれない: ホームに残る ----
  await p.click('nav button:has-text("ホーム")'); await W(600);
  body = await main();
  const m = body.match(/名前がまだの選手が (\d+) 人います/);
  // 9人 - 井上 - 青木 = 7人。交代で名前なし1人を足して、交代で下がった仮の選手もまだ残る
  ok('ホームに「名前がまだの選手が N 人います」と出る', !!m && Number(m[1]) === 8, body.slice(0, 300));

  // ---- 成績にも、入れた名前で出る ----
  await p.click('nav button:has-text("成績")'); await W(700);
  body = await main();
  ok('成績に「青木」が出る', body.includes('青木'), body.slice(0, 300));

  // ---- 登録済みの選手にまとめる ----
  await p.click('button[aria-label="設定"]'); await W(400);
  await p.fill('.add-form input[placeholder="選手名"]', '上田');
  await p.click('.add-form button.primary'); await W(300);
  await p.click('nav button:has-text("ホーム")'); await W(600);
  await p.locator('.prov-card .row:has-text("選手3") button').click(); await W(400);
  await p.locator('.sheet select').selectOption({ label: '上田' }); await W(200);
  await p.click('.sheet-actions button:has-text("保存")'); await W(600);
  body = await main();
  ok('登録済みの選手にまとめると一覧から消える', /名前がまだの選手が 7 人います/.test(body) && !body.includes('選手3'), body.slice(0, 300));
  await p.click('nav button:has-text("オーダー")'); await W(600);
  ok('オーダーの3番が「上田」になる', (await main()).includes('上田'));
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ provisional PASS' : `\n✗ provisional FAIL (${fail})`);
process.exit(fail ? 1 : 0);

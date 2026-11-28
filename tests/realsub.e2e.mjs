// 実際の試合の流れでの交代のe2e(代打 → 守備固めと守備の組み替え → 継投 → 相手の継投)。
// 守りたいこと:
//  - 代打を出した攻撃のあと、守備の図が開き、控えの選手を図から入れられる(打順を引き継ぐ)
//  - 守備中はスコア画面の「🔁 守備交代」から同じ図が開き、マウンドで継投できる
//  - DHなしの継投は打順と連動する(新しい投手が前の投手の打順に入る/野手と入れ替え)
//  - 相手の投手交代は「2番手」のボタン1つ。記号(A〜T)は出ない
//  - まとめた交代は1回の取り消しで戻る
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
const PORT = 4235;
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
  const rowsNow = () => p.evaluate(() => [...document.querySelectorAll('.main .row')]
    .map((r) => [r.querySelector('b')?.textContent, r.querySelector('select')?.value]).filter((x) => x[0] && x[1]));
  const so = async (n) => { for (let i = 0; i < n; i++) { await p.click('.result-pad button:has-text("三振")'); await W(300); const cf = p.locator('.sheet-actions button:has-text("確定")'); if (await cf.count()) { await cf.click(); await W(300); } } };
  await p.goto(URL_, { waitUntil: 'load' }); await W(900);
  await p.click('button[aria-label="設定"]'); await W(400);
  await p.click('button:has-text("名簿を貼り付けてまとめて登録")'); await W(400);
  await p.fill('.paste-area', '青木\n井上\n上田\n江口\n大野\n加藤\n木村\n工藤\n藤田\n代打男\n守備職人\n深町');
  await W(300); await p.click('.sheet-actions button.primary'); await W(500);
  await p.click('nav button:has-text("スコア入力")'); await W(400);
  await p.click('.mode-opt:has-text("かんたん")');
  await p.fill('input[placeholder="対戦相手名"]', '交代の流れ');
  await p.click('button:has-text("試合開始")'); await W(600);
  const att = p.locator('.sheet-actions button.primary'); if (await att.count()) { await att.click(); await W(600); }
  await p.click('button:has-text("名簿を貼り付けて打順を組む")'); await W(400);
  await p.fill('.paste-area', '1 青木（中）\n2 井上（二）\n3 上田（一）\n4 江口（三）\n5 大野（遊）\n6 加藤（左）\n7 木村（右）\n8 工藤（捕）\n9 藤田（投）');
  await W(300); await p.click('.sheet-actions button.primary'); await W(700);

  // ---- 相手の投手: 「先発」と出て、記号は出ない ----
  const oppBtn = p.locator('.sit-pitcher .opp-pitch-btn').first();
  ok('相手投手は「先発」と出る(記号のAではない)', (await oppBtn.innerText()).includes('先発'), await oppBtn.innerText());
  await oppBtn.click(); await W(400);
  const os = p.locator('.sheet').last();
  ok('相手の投手交代は「2番手 に交代」のボタン1つ', await os.locator('.big-btn:has-text("2番手 に交代")').count() === 1, await os.innerText());
  await os.locator('.big-btn').click(); await W(400);
  ok('交代すると「2番手」になる', (await p.locator('.sit-pitcher .opp-pitch-btn').first().innerText()).includes('2番手'));
  // (かんたんモードはスコアボードに球数の段を出さないので、ここでは見ない)

  // ---- 1番三振 → 2番に代打 → 2人三振でチェンジ ----
  await so(1);
  await p.click('.sit-changebtn'); await W(300);
  await p.click('.sheet button:has-text("代打")'); await W(400);
  await p.locator('.sheet select').first().selectOption({ label: '代打男' }); await W(200);
  await p.locator('.sheet-actions button.primary').click(); await W(500);
  await so(2); await W(600);

  // ---- 守備の図が自動で開く。代打男(二)→ 守備職人、上田(一)と江口(三)を入れ替え ----
  ok('代打のあと、守備の図が開く', await p.locator('.dc-field').count() === 1);
  await p.locator('.dc-spot').filter({ hasText: '代打男' }).click(); await W(300);
  ok('守備位置を押すと控えの選手が出る', (await p.locator('.sheet').last().innerText()).includes('控えの選手と交代'));
  await p.locator('.sheet .lc-chips button:has-text("守備職人")').click(); await W(300);
  await p.locator('.dc-spot').filter({ hasText: '上田' }).click(); await W(300);
  await p.locator('.sheet .picker-row').filter({ hasText: '江口' }).click(); await W(300);
  const ord = await p.locator('.dc-order').innerText();
  ok('打順の一覧に、交代(2番 代打男→守備職人)と位置の入れ替えが色付きで出る', ord.includes('守備職人') && (await p.locator('.dc-order-row.sub').count()) === 1 && (await p.locator('.dc-order-row.moved').count()) === 2, ord);
  await p.locator('.fullscreen-body button.primary:has-text("件の交代・変更を確定")').click(); await W(600);

  await p.click('nav button:has-text("オーダー")'); await W(500);
  let rows = await rowsNow();
  ok('守備職人が2番(二)に入り、上田が三・江口が一',
    JSON.stringify(rows.slice(0, 4)) === JSON.stringify([['青木', '中'], ['守備職人', '二'], ['上田', '三'], ['江口', '一']]), JSON.stringify(rows));

  // ---- 守備中の「🔁 守備交代」→ マウンドで深町に継投(9番の打順に入る) ----
  await p.click('nav button:has-text("スコア入力")'); await W(500);
  await p.locator('.def-change-btn').click(); await W(400);
  ok('守備中は「🔁 守備交代」から同じ図が開く', await p.locator('.dc-field').count() === 1);
  await p.locator('.dc-spot').filter({ hasText: '藤田' }).click(); await W(300);
  await p.locator('.sheet .lc-chips button:has-text("深町")').click(); await W(300);
  await p.locator('.fullscreen-body button.primary:has-text("件の交代・変更を確定")').click(); await W(600);
  ok('投手が深町になる', (await p.locator('.my-pitch-btn b').innerText()) === '深町');
  await p.click('nav button:has-text("オーダー")'); await W(500);
  rows = await rowsNow();
  ok('深町は9番(投)に入り、藤田は退く', JSON.stringify(rows[8]) === JSON.stringify(['深町', '投']) && (await p.locator('.main').innerText()).includes('藤田'), JSON.stringify(rows));

  // ---- 1回の取り消しで継投が戻る ----
  await p.click('nav button:has-text("スコア入力")'); await W(500);
  const undo = p.locator('button.undo-op').first();
  ok('取り消しは「選手交代」1回分', (await undo.innerText()).includes('選手交代'), await undo.innerText());
  await undo.click(); await W(500);
  ok('取り消すと投手が藤田に戻る', (await p.locator('.my-pitch-btn b').innerText()) === '藤田');

  // ---- 投手欄から継投: 一塁の江口が登板し、藤田が一塁へ(入れ替え) ----
  await p.locator('.my-pitch-btn').click(); await W(400);
  const ps = p.locator('.sheet').last();
  ok('投手交代に「控えから」と「打順の野手から」が出る', (await ps.innerText()).includes('控えから登板') && (await ps.innerText()).includes('打順の野手が登板'));
  await ps.locator('.lc-chips button').filter({ hasText: '江口' }).click(); await W(300);
  ok('野手が登板するときの形が選べる', (await ps.locator('.pc-opt').count()) === 2, await ps.innerText());
  await ps.locator('.sheet-actions button.primary').click(); await W(600);
  await p.click('nav button:has-text("オーダー")'); await W(500);
  rows = await rowsNow();
  ok('江口が投手(4番)、藤田が一塁(9番)', JSON.stringify(rows[3]) === JSON.stringify(['江口', '投']) && JSON.stringify(rows[8]) === JSON.stringify(['藤田', '一']), JSON.stringify(rows));
  await p.click('nav button:has-text("スコア入力")'); await W(500);
  ok('投手欄も江口', (await p.locator('.my-pitch-btn b').innerText()) === '江口');
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  if (process.env.SHOT) { await p.screenshot({ path: process.env.SHOT }); await p.locator('.def-change-btn').click(); await W(400); await p.screenshot({ path: process.env.SHOT.replace('.png', 'b.png'), fullPage: true }); }
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ realistic substitutions PASS' : `\n✗ realistic substitutions FAIL (${fail})`);
process.exit(fail ? 1 : 0);

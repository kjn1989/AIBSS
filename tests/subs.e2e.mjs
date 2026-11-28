// 選手交代(オーダーの「選手交代」・まとめて確定)のe2e。
// 守りたいこと:
//  - 代打・投手交代・守備位置の入れ替え・名簿にない人を、1枚で決めて1回で確定できる
//  - 代打/代走/守備の種類は場面から自動で付く
//  - 守備位置は選ぶと入れ替わり、重ならない
//  - 1回の取り消しで全部戻る
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
const PORT = 4231;
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
  const rowsNow = () => p.evaluate(() => [...document.querySelectorAll('.main .row')]
    .map((r) => [r.querySelector('b')?.textContent, r.querySelector('select')?.value]).filter((x) => x[0] && x[1]));
  await p.goto(URL_, { waitUntil: 'load' }); await W(900);

  // 12人を登録(9人が打順、3人が控え)
  await p.click('button[aria-label="設定"]'); await W(400);
  await p.click('button:has-text("名簿を貼り付けてまとめて登録")'); await W(400);
  await p.fill('.paste-area', '青木\n井上\n上田\n江口\n大野\n加藤\n木村\n工藤\n藤田\n代打男\n深町\n守備職人');
  await W(300);
  await p.click('.sheet-actions button.primary'); await W(500);

  await p.click('nav button:has-text("スコア入力")'); await W(400);
  await p.click('.mode-opt:has-text("かんたん")');
  await p.fill('input[placeholder="対戦相手名"]', '交代練習');
  await p.click('button:has-text("試合開始")'); await W(600);
  const att = p.locator('.sheet-actions button.primary'); if (await att.count()) { await att.click(); await W(600); }
  await p.click('button:has-text("名簿を貼り付けて打順を組む")'); await W(400);
  await p.fill('.paste-area', '1 青木（中）\n2 井上（二）\n3 上田（一）\n4 江口（三）\n5 大野（遊）\n6 加藤（左）\n7 木村（右）\n8 工藤（捕）\n9 藤田（投）');
  await W(300);
  await p.click('.sheet-actions button.primary'); await W(700);
  // 1人目が三振。次は2番の井上
  await p.click('.result-pad button:has-text("三振")'); await W(400);
  const cf = p.locator('.sheet-actions button:has-text("確定")'); if (await cf.count()) { await cf.click(); await W(400); }

  await p.click('nav button:has-text("オーダー")'); await W(500);
  await p.click('button.lc-open'); await W(400);
  const sh = p.locator('.sheet').last();
  ok('選手交代のシートが開く', (await sh.innerText()).includes('交代する選手を押して'));

  // 2番 井上 → 代打男(打席の打者なので「代打」が自動で付く)
  await sh.locator('.lc-row').nth(1).locator('.lc-name').click(); await W(200);
  const benchTxt = await sh.locator('.lc-bench').innerText();
  ok('控えが並ぶ(代打男・深町・守備職人)', ['代打男', '深町', '守備職人'].every((n) => benchTxt.includes(n)), benchTxt);
  await sh.locator('.lc-bench button:has-text("代打男")').click(); await W(200);
  ok('打席の打者の交代は「代打」になる', (await sh.locator('.lc-kinds button.on').first().innerText()) === '代打');

  // 9番 藤田(投) → 深町。投手交代も一緒に
  await sh.locator('.lc-row').nth(8).locator('.lc-name').click(); await W(200);
  ok('入った選手は控えから消える', !(await sh.locator('.lc-bench').innerText()).includes('代打男'));
  await sh.locator('.lc-bench button:has-text("深町")').click(); await W(200);

  // 3番 上田を「右」へ → 右の木村が一塁に入れ替わる
  await sh.locator('.lc-row').nth(2).locator('select').selectOption('右'); await W(200);
  ok('守備位置は入れ替わる(木村が一へ)', (await sh.locator('.lc-row').nth(6).locator('select').inputValue()) === '一');

  // 5番 大野 → 名簿にない人(新顔)
  await sh.locator('.lc-row').nth(4).locator('.lc-name').click(); await W(200);
  await sh.locator('.lc-new input').fill('新顔');
  await sh.locator('.lc-new button').click(); await W(200);

  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT.replace('.png', 'a.png') });
  const sum = await sh.locator('.lc-summary').innerText();
  ok('確定前に変更の一覧が出る', sum.includes('2番 井上 → 代打男(代打)') && sum.includes('9番 藤田 → 深町') && sum.includes('投手: 藤田 → 深町') && sum.includes('5番 大野 → 新顔'), sum);
  const btn = sh.locator('.sheet-actions button.primary');
  ok('件数がボタンに出る', (await btn.innerText()).includes('6件'), await btn.innerText());
  await btn.click(); await W(600);

  const rows = await rowsNow();
  ok('打順と守備位置がまとめて変わる',
    JSON.stringify(rows) === JSON.stringify([['青木', '中'], ['代打男', '二'], ['上田', '右'], ['江口', '三'], ['新顔', '遊'], ['加藤', '左'], ['木村', '一'], ['工藤', '捕'], ['深町', '投']]),
    JSON.stringify(rows));
  const m = await main();
  ok('入った「新顔」は今日のメンバーに加わる(12人→13人)', (await main()).includes('今日のメンバー（13人）'), (await main()).slice(0, 300));
  ok('退いた選手に井上・大野・藤田', ['井上', '大野', '藤田'].every((n) => m.slice(m.indexOf('退いた選手')).includes(n)), m.slice(m.indexOf('退いた選手')));

  // 投手は深町、取り消しは1回で全部戻る
  await p.click('nav button:has-text("スコア入力")'); await W(500);
  const undo = p.locator('button.undo-op').first();
  ok('取り消しボタンが「選手交代」', (await undo.innerText()).includes('選手交代'), await undo.innerText());
  await undo.click(); await W(500);
  await p.click('nav button:has-text("オーダー")'); await W(500);
  const back = await rowsNow();
  ok('1回の取り消しで全部戻る',
    JSON.stringify(back) === JSON.stringify([['青木', '中'], ['井上', '二'], ['上田', '一'], ['江口', '三'], ['大野', '遊'], ['加藤', '左'], ['木村', '右'], ['工藤', '捕'], ['藤田', '投']]),
    JSON.stringify(back));

  // 名前を押しても、その打順の控えを広げた状態で開く
  await p.locator('.main .row').nth(3).locator('.grow').click(); await W(400);
  ok('名前を押すと、その打順を広げて開く', await p.locator('.sheet .lc-row.open').count() === 1 && (await p.locator('.sheet .lc-row.open').innerText()).includes('江口'));
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });

  // ---- DH制: 打順の外の投手を、同じシートで代える(DHはそのまま) ----
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const q = await ctx2.newPage();
  q.on('pageerror', (e) => { console.log('EXC:', e.message); fail++; });
  await q.goto(URL_, { waitUntil: 'load' }); await q.waitForTimeout(900);
  await q.click('button[aria-label="設定"]'); await q.waitForTimeout(400);
  await q.click('button:has-text("名簿を貼り付けてまとめて登録")'); await q.waitForTimeout(400);
  await q.fill('.paste-area', '大槻\n髙島\n伊山\n大道\n千葉\n岩崎\n清水\n中島\n黒瀬\n藤田\n深町');
  await q.waitForTimeout(300);
  await q.click('.sheet-actions button.primary'); await q.waitForTimeout(500);
  await q.click('nav button:has-text("スコア入力")'); await q.waitForTimeout(400);
  await q.click('.mode-opt:has-text("かんたん")');
  await q.fill('input[placeholder="対戦相手名"]', 'タイ代表');
  await q.click('button:has-text("試合開始")'); await q.waitForTimeout(600);
  const a2 = q.locator('.sheet-actions button.primary'); if (await a2.count()) { await a2.click(); await q.waitForTimeout(600); }
  await q.click('button:has-text("名簿を貼り付けて打順を組む")'); await q.waitForTimeout(400);
  await q.fill('.paste-area', '1番 6大槻\n2番 5髙島\n3番 4伊山\n4番 8大道\n5番 3千葉\n6番 DH岩崎\n7番 9清水\n8番 7中島\n9番 2黒瀬\n\n投手 藤田');
  await q.waitForTimeout(300);
  await q.click('.sheet-actions button.primary'); await q.waitForTimeout(700);
  await q.click('nav button:has-text("オーダー")'); await q.waitForTimeout(500);
  if (process.env.SHOT) await q.screenshot({ path: process.env.SHOT.replace('.png', 'o.png') });
  await q.click('button.lc-open'); await q.waitForTimeout(400);
  const s2 = q.locator('.sheet').last();
  const prow = s2.locator('.lc-row').filter({ hasText: '投手(打順の外)' });
  ok('DH制では「投手(打順の外)」の行が出る', await prow.count() === 1 && (await prow.innerText()).includes('藤田'));
  await prow.locator('.lc-name').click(); await q.waitForTimeout(200);
  await s2.locator('.lc-bench button:has-text("深町")').click(); await q.waitForTimeout(200);
  ok('一覧に「投手: 藤田 → 深町」', (await s2.locator('.lc-summary').innerText()).includes('投手: 藤田 → 深町'));
  await s2.locator('.sheet-actions button.primary').click(); await q.waitForTimeout(600);
  const dhc = await q.locator('.dh-card').innerText().catch(() => '');
  ok('DHのまま投手が深町に代わる', dhc.includes('DH: 岩崎') && dhc.includes('投手: 深町'), dhc);
  await ctx2.close();
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ substitutions PASS' : `\n✗ substitutions FAIL (${fail})`);
process.exit(fail ? 1 : 0);

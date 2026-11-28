// 表記ちがい・書きまちがいで2人に分かれた選手をまとめるe2e。
// 守りたいこと:
//  - 「髙島」と「高島」は同じ人の候補として出て、正しい字を選んでまとめられる
//  - まとめると成績が1人に合わさる(打席数が足し算になる)
//  - 別の名字にもある組(島田/嶋田)は自動では出さず、手で選んでまとめられる
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
const PORT = 4232;
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
  const paOf = (name) => p.evaluate((nm) => {
    const t = [...document.querySelectorAll('table.rank-table')].find((x) => x.innerText.includes('打席'));
    if (!t) return null;
    const rows = [...t.querySelectorAll('tbody tr')].filter((r) => r.children[0].innerText.trim().startsWith(nm));
    const i = [...t.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim() === '打席');
    return rows.map((r) => Number(r.children[i].innerText));
  }, name);
  await p.goto(URL_, { waitUntil: 'load' }); await W(900);

  await p.click('nav button:has-text("スコア入力")'); await W(400);
  await p.click('.mode-opt:has-text("かんたん")');
  await p.fill('input[placeholder="対戦相手名"]', '統合練習');
  await p.click('button:has-text("試合開始")'); await W(600);
  const att = p.locator('.sheet-actions button.primary'); if (await att.count()) { await att.click(); await W(600); }
  await p.click('button:has-text("名簿を貼り付けて打順を組む")'); await W(400);
  await p.fill('.paste-area', '1 髙島（中）\n2 高島（二）\n3 島田（一）\n4 嶋田（三）\n5 大野（遊）\n6 加藤（左）\n7 木村（右）\n8 工藤（捕）\n9 藤田（投）');
  await W(300);
  await p.click('.sheet-actions button.primary'); await W(700);
  for (let i = 0; i < 4; i++) {
    await p.click('.result-pad button:has-text("三振")'); await W(350);
    const cf = p.locator('.sheet-actions button:has-text("確定")'); if (await cf.count()) { await cf.click(); await W(350); }
  }

  await p.click('nav button:has-text("成績")'); await W(600);
  ok('まとめる前は島田に1打席、嶋田は0', JSON.stringify(await paOf('島田')) === '[1]' && JSON.stringify(await paOf('嶋田')) === '[]');
  ok('まとめる前は髙島と高島が別々', JSON.stringify(await paOf('髙島')) === '[1]' && JSON.stringify(await paOf('高島')) === '[1]', `${await paOf('髙島')} / ${await paOf('高島')}`);

  // 設定: 「髙島 / 高島」が同じ人の候補として出る
  await p.click('button[aria-label="設定"]'); await W(500);
  const card = p.locator('.card').filter({ hasText: '髙島 / 高島' });
  ok('設定に「髙島 / 高島」が同じ人の候補として出る', await card.count() === 1);
  ok('島田と嶋田は自動では出さない', await p.locator('.card').filter({ hasText: '島田 / 嶋田' }).count() === 0 && await p.locator('.card').filter({ hasText: '嶋田 / 島田' }).count() === 0);
  if (process.env.SHOT) { await card.scrollIntoViewIfNeeded(); await p.screenshot({ path: process.env.SHOT }); }
  await card.locator('button:has-text("「髙島」にまとめる")').click(); await W(600);
  ok('まとめると候補が消える', await p.locator('.card').filter({ hasText: '髙島 / 高島' }).count() === 0);

  await p.click('nav button:has-text("成績")'); await W(600);
  ok('成績が髙島1人に合わさる(打席1+1=2)', JSON.stringify(await paOf('髙島')) === '[2]' && JSON.stringify(await paOf('高島')) === '[]', `${await paOf('髙島')} / ${await paOf('高島')}`);

  // 手で選んでまとめる: 島田 → 嶋田
  await p.click('button[aria-label="設定"]'); await W(500);
  await p.click('button:has-text("名前の書きまちがいで分かれた選手をまとめる")'); await W(400);
  const sh = p.locator('.sheet').last();
  const optOf = async (sel, nm) => sel.locator('option').filter({ hasText: nm }).first().getAttribute('value');
  const s1 = sh.locator('select').nth(0); await s1.selectOption(await optOf(s1, '島田'));
  const s2 = sh.locator('select').nth(1); await s2.selectOption(await optOf(s2, '嶋田'));
  ok('まとめる内容が出る', (await sh.innerText()).includes('「島田」の記録をすべて「嶋田」に付け替え'));
  await sh.locator('.sheet-actions button.primary').click(); await W(600);
  await p.click('nav button:has-text("成績")'); await W(600);
  // 3つ目の三振でチェンジなので、打席があるのは1〜3番(島田は1打席、嶋田は0)
  ok('島田の記録が嶋田に移る', JSON.stringify(await paOf('嶋田')) === '[1]' && JSON.stringify(await paOf('島田')) === '[]', `${await paOf('嶋田')} / ${await paOf('島田')}`);

  // オーダーにも残す側の名前で出る
  await p.click('nav button:has-text("オーダー")'); await W(500);
  const m = await p.locator('.main').innerText();
  ok('オーダーも残す側の名前になる', m.includes('髙島') && !/(^|\n)高島/.test(m) && m.includes('嶋田') && !/(^|\n)島田/.test(m), m.slice(0, 400));
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ merge players PASS' : `\n✗ merge players FAIL (${fail})`);
process.exit(fail ? 1 : 0);

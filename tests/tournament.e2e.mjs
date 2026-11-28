// 大会のまとめのe2e。
// 守りたいこと:
//  - 「AABC2026 初戦」「AABC2026 第2戦」「AABC2026 第3戦」が AABC2026 という1つの大会にまとまる
//  - 試合結果タブに大会の戦績・各試合のスコアが出て、押すとその試合が開く
//  - 成績タブの「大会」で、3試合ぶんの選手の成績が合わさる
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
const PORT = 4233;
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
  await p.goto(URL_, { waitUntil: 'load' }); await W(900);
  await p.click('button[aria-label="設定"]'); await W(400);
  await p.click('button:has-text("名簿を貼り付けてまとめて登録")'); await W(400);
  await p.fill('.paste-area', '大槻\n髙島\n伊山\n大道\n千葉\n岩崎\n清水\n中島\n黒瀬');
  await W(300);
  await p.click('.sheet-actions button.primary'); await W(500);

  // 3試合。1試合目は練習試合(別の大会名)を挟んで、混ざらないことも見る
  const plays = [
    { opp: 'タイ', season: 'AABC2026 初戦', hits: 0 },
    { opp: '練習相手', season: '練習試合', hits: 1 },
    { opp: 'ベトナム', season: 'AABC2026 第2戦', hits: 1 },
    { opp: '韓国', season: 'AABC2026 第3戦', hits: 2 },
  ];
  for (const g of plays) {
    await p.click('nav button:has-text("スコア入力")'); await W(500);
    await p.click('.mode-opt:has-text("かんたん")');
    await p.fill('input[placeholder="対戦相手名"]', g.opp);
    await p.fill('input[placeholder="例: 2026春季大会"]', g.season);
    await p.click('button:has-text("試合開始")'); await W(600);
    const att = p.locator('.sheet-actions button.primary'); if (await att.count()) { await att.click(); await W(600); }
    await p.click('button:has-text("登録選手から打順を自動セット")').catch(() => {}); await W(500);
    for (let i = 0; i < g.hits; i++) {
      await p.click('.result-pad button:has-text("ヒット")'); await W(350);
      const coach = p.locator('.pad-coach button'); if (await coach.count()) { await coach.click(); await W(150); }
      await p.locator('.field-pad button.field-pos').nth(6).click(); await W(500);
      const cf = p.locator('.sheet-actions button:has-text("確定")'); if (await cf.count()) { await cf.click(); await W(400); }
    }
    await p.click('.result-pad button:has-text("三振")'); await W(350);
    const cf2 = p.locator('.sheet-actions button:has-text("確定")'); if (await cf2.count()) { await cf2.click(); await W(350); }
    await p.locator('button:has-text("試合終了")').last().click(); await W(700);
    // 終了後に出るハイライトのシートを閉じる
    const ov = p.locator('.sheet-overlay');
    if (await ov.count()) { await ov.first().click({ position: { x: 5, y: 5 } }); await W(400); }
    await p.click('nav button:has-text("ホーム")'); await W(400);
  }

  // 試合結果: 大会のまとめ
  await p.click('nav button:has-text("試合結果")'); await W(600);
  const sel = p.locator('.card select').first();
  const optVal = await sel.locator('option').filter({ hasText: 'AABC2026 第2戦' }).first().getAttribute('value');
  await sel.selectOption(optVal); await W(500);
  const tour = p.locator('.tour-card');
  ok('試合結果に大会のまとめが出る', await tour.count() === 1);
  const tt = (await tour.innerText()).replace(/\n+/g, ' ');
  ok('大会名は AABC2026 にまとまり、3試合が並ぶ', tt.includes('AABC2026') && (await tour.locator('.tour-game').count()) === 3 && !tt.includes('練習相手'), tt);
  ok('各試合の呼び名(初戦・第2戦・第3戦)と相手が出る', ['初戦', '第2戦', '第3戦', 'タイ', 'ベトナム', '韓国'].every((x) => tt.includes(x)), tt);
  ok('チームの安打は3試合の合計(0+1+2=3)', /安打\s*3/.test(tt), tt);
  await tour.locator('.tour-game').filter({ hasText: '韓国' }).click(); await W(500);
  ok('試合を押すとその試合が開く', (await p.locator('.card select').first().locator('option:checked').innerText()).includes('韓国'));

  // 成績: 大会
  await p.click('nav button:has-text("成績")'); await W(600);
  await p.click('.toggle-row button:has-text("大会")'); await W(500);
  const opt = await p.locator('select').first().locator('option:checked').innerText();
  ok('成績タブに「大会」があり、AABC2026(全3試合)を選べる', opt.includes('AABC2026') && opt.includes('3'), opt);
  const pa = await p.evaluate(() => {
    const t = document.querySelector('table.bat-full');
    if (!t) return null;
    const hs = [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim());
    const ih = hs.indexOf('安打');
    return [...t.querySelectorAll('tbody tr')].reduce((a, r) => a + Number(r.children[ih].innerText), 0);
  });
  ok('大会の打撃成績は3試合の合計(練習試合の安打は入らない)', pa === 3, String(pa));
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  if (process.env.SHOT) { await p.click('nav button:has-text("試合結果")'); await W(500); await p.locator('.tour-card').scrollIntoViewIfNeeded(); await p.screenshot({ path: process.env.SHOT }); }
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ tournament PASS' : `\n✗ tournament FAIL (${fail})`);
process.exit(fail ? 1 : 0);

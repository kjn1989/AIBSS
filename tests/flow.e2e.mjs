// 試合の流れ e2e: 勝率の線・線分スコアの重ね合わせ・打席の読み取り
// 実行: npm run test:e2e
// 守りたいこと:
//  - 縦軸は勝率(0〜100%)で、50%が互角の線として出ている
//  - 線分スコアの列が、線の回の区切りとぴったり重なっている
//    (等分にすると「5回の列の下が線の5回ではない」表になる)
//  - 打席を押すと、その打席の前と後の勝率が両方読める
//    (差だけだと、その概念を知らない人には何のことか分からない)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;
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
  page.on('dialog', (d) => d.accept()); // 手動チェンジの確認

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(400); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', '流れ確認');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(600);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(600); }
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(400); }

  const play = async (label) => {
    const btn = page.locator(`.result-pad button:has-text("${label}")`).first();
    if (!(await btn.isEnabled().catch(() => false))) return false;
    await btn.click();
    await page.waitForTimeout(300);
    const coach = page.locator('.pad-coach button');
    if (await coach.count()) { await coach.click(); await page.waitForTimeout(150); }
    const f = page.locator('.field-pad button.field-pos').first();
    if (await f.count()) { await f.click(); await page.waitForTimeout(550); }
    const ok = page.locator('.sheet-actions button:has-text("確定")');
    if (await ok.count()) { await ok.click(); await page.waitForTimeout(400); }
    return true;
  };
  const change = async () => { await page.click('button:has-text("手動チェンジ")'); await page.waitForTimeout(600); };

  // 打席数の違う回を作る(回ごとに列幅が変わることを見たいので、あえて数を変える)
  for (const l of ['ヒット', 'ヒット', 'ヒット', 'ホームラン', '凡打', '凡打', '凡打']) await play(l);
  await change();
  for (const l of ['凡打', '凡打', '凡打']) await play(l);
  await change();
  for (const l of ['ヒット', 'ヒット', '凡打', '凡打', '凡打']) await play(l);
  await change();

  await page.click('button:has-text("試合の流れを見る")');
  await page.waitForTimeout(900);
  const sheet = page.locator('.sheet').last();
  check('流れシートが開く', (await sheet.innerText()).includes('試合の流れ'));

  // --- 縦軸は勝率 ---
  const chartTxt = await page.locator('.fv-chart').innerText();
  check('縦軸に100%/50%/0%が出ている',
    chartTxt.includes('100%') && chartTxt.includes('50%') && chartTxt.includes('0%'), chartTxt.slice(0, 200));
  check('勝率だと書いてある', (await sheet.innerText()).includes('勝つ確率'));

  // --- 線分スコアが線と重なっている ---
  const geo = await page.evaluate(() => {
    const svg = document.querySelector('.fv-chart svg');
    const cells = [...document.querySelectorAll('.fvls-row.head .fvls-cell')]
      .map((c) => ({ n: c.textContent, l: c.getBoundingClientRect().left, w: c.getBoundingClientRect().width }));
    // 回の区切りに引いてある縦線(上端から下端まで通っているもの)
    const bounds = [...svg.querySelectorAll('line')]
      .filter((l) => l.getAttribute('y1') === '0' && l.getAttribute('y2') === '132')
      .map((l) => l.getBoundingClientRect().left);
    return { cells, bounds };
  });
  check('線分スコアが回ごとに出ている', geo.cells.length >= 3, `列数=${geo.cells.length}`);
  // 2回目以降の列は、線に引いてある区切りと同じ位置から始まる
  const offBy = geo.cells.slice(1).map((c) => Math.min(...geo.bounds.map((b) => Math.abs(b - c.l))));
  check('列の左端が線の回の区切りと一致する',
    offBy.every((d) => d < 1.5), `ズレ=${offBy.map((d) => d.toFixed(2)).join(', ')}px`);
  // 打席数が違えば列幅も違う(等分になっていない = 線に合わせている証拠)
  const widths = geo.cells.map((c) => c.w);
  check('打席数の多い回ほど列が広い',
    Math.max(...widths) - Math.min(...widths) > 8, widths.map((w) => w.toFixed(1)).join(', '));

  // --- 回別の安打数も出る(スコアボードと同じ置き方) ---
  const hits = await page.evaluate(() => {
    const row = document.querySelectorAll('.fvls-row:not(.head)')[0]; // 先攻(この試合では自チーム)
    return [...row.querySelectorAll('.fvls-cell')].map((c) => ({
      run: c.querySelector('b')?.textContent || '',
      hit: (c.querySelector('i')?.textContent || '').trim(),
    }));
  });
  check('回別の安打数が出ている', hits.some((h) => h.hit !== ''), JSON.stringify(hits));
  check('1回は4安打(記録どおり)', hits[0]?.hit === '4', JSON.stringify(hits[0]));
  check('三者凡退の回は安打欄が空', hits[1]?.hit === '', JSON.stringify(hits[1]));
  check('得点と安打が別の数字として出ている', hits[0]?.run === '4' && hits[0]?.hit === '4', JSON.stringify(hits[0]));

  // --- 打席を押すと前後の勝率が読める ---
  const box = await page.locator('.fv-chart svg').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(400);
  const read = await page.locator('.fv-read').innerText();
  check('押した打席の内容が出る', read.includes('回'), read);
  check('前と後の勝率が両方出ている', (read.match(/\d+%/g) || []).length >= 2, read);
  check('勝率だと分かる言葉が付いている', read.includes('勝率'), read);

  // --- 横あふれなし ---
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('横あふれなし', !over);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\n✓ flow PASS' : `\n✗ flow FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

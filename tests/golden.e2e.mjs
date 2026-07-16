// ゴールデンパスe2e: デモ投入→試合開始→単打→併殺打→四球→盗塁→四球→重盗→三振→チェンジ→成績検証
// 実行: npm run test:e2e (ビルド済み dist を vite preview で配信して検証する)
// 過去の実バグの再発防止を兼ねる:
//  - 併殺打で3アウトになる二重計上 (2026-07)
//  - 重盗で2人目の走者に盗塁が付かない (2026-07)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
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

// ---- preview サーバ起動 ----
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL_);
      if (r.ok) return;
    } catch { /* まだ起動中 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('preview server did not start');
};

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok' : 'NG'} - ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) failures++;
};

const browser = await (async () => {
  await waitUp();
  return chromium.launch({ executablePath: resolveChromium() });
})();

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (err) => { console.log('PAGE EXCEPTION:', err.message); failures++; });

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // --- デモデータ投入 & 試合開始 ---
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(400); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', 'ゴールデンパス');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(500);
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(400); }

  const outs = () => page.locator('.out-dot.on').count();
  const baseOn = (b) => page.locator(`.base.b${b}.occupied`).count();
  const confirmSheet = async () => {
    await page.click('.sheet-actions button:has-text("確定")');
    await page.waitForTimeout(450);
  };
  const playResult = async (label, { direction = true } = {}) => {
    await page.click(`.result-pad button:has-text("${label}")`);
    await page.waitForTimeout(350);
    if (direction) {
      const f = page.locator('.field-pad button.field-pos').first();
      if (await f.count()) { await f.click(); await page.waitForTimeout(250); }
    }
  };

  // --- 1. 単打 → 一塁に走者 ---
  await playResult('ヒット');
  await confirmSheet();
  check('単打後: 一塁に走者', (await baseOn(1)) === 1);

  // --- 2. 併殺打 → 2アウト(3アウト二重計上の再発防止)・回は継続 ---
  await playResult('凡打');
  await page.click('.sheet button:has-text("ダブルプレー")');
  await page.waitForTimeout(250);
  await confirmSheet();
  check('併殺打後: アウトは2', (await outs()) === 2, `actual=${await outs()}`);
  check('併殺打後: まだ1回表', (await page.locator('body').innerText()).includes('1回表'));
  check('併殺打後: 塁上に走者なし', (await baseOn(1)) + (await baseOn(2)) + (await baseOn(3)) === 0);

  // --- 3. 四球 → 一塁へ ---
  await playResult('四球', { direction: false });
  await confirmSheet();
  check('四球後: 一塁に走者', (await baseOn(1)) === 1);

  // --- 4. 盗塁(単独) 一塁→二塁 ---
  await page.click('.base.b1');
  await page.waitForTimeout(350);
  await page.click('.sheet button:has-text("盗塁成功")');
  await page.waitForTimeout(450);
  check('盗塁後: 二塁に走者・一塁は空く', (await baseOn(2)) === 1 && (await baseOn(1)) === 0);

  // --- 5. 四球 → 一・二塁 ---
  await playResult('四球', { direction: false });
  await confirmSheet();
  check('2つ目の四球後: 一・二塁', (await baseOn(1)) === 1 && (await baseOn(2)) === 1);

  // --- 6. 重盗 → 二・三塁(2人目の盗塁記録の再発防止) ---
  await page.click('.base.b1');
  await page.waitForTimeout(350);
  await page.click('.sheet button:has-text("盗塁成功")'); // 重盗表示のボタン
  await page.waitForTimeout(450);
  check('重盗後: 二・三塁', (await baseOn(2)) === 1 && (await baseOn(3)) === 1);

  // --- 7. 三振 → 3アウトでチェンジ ---
  await playResult('三振', { direction: false });
  await confirmSheet();
  const body = await page.locator('body').innerText();
  check('三振後: 1回裏に交代しアウト0', body.includes('1回裏') && (await outs()) === 0);

  // --- 8. 成績検証(試合単位スコープでこの試合のみ) ---
  await page.click('nav button:has-text("成績")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("試合単位")');
  await page.waitForTimeout(400);
  // 試合選択UIがあれば最新(この試合)を選ぶ。既定で最新が選ばれる想定でテキストを確認
  const statsText = await page.locator('body').innerText();
  check('成績: 対象試合が表示されている', statsText.includes('ゴールデンパス'));

  // 打撃成績一覧テーブルから 盗塁列(最終列)を合計: 単独1 + 重盗2 = 3
  const sbValues = await page.$$eval('table', (tables) => {
    const t = tables.find((x) => x.innerText.includes('盗') && x.innerText.includes('打席'));
    if (!t) return null;
    return [...t.querySelectorAll('tbody tr')].map((tr) => {
      const cells = [...tr.querySelectorAll('td')];
      return Number(cells[cells.length - 1]?.textContent || 0);
    });
  });
  const sbTotal = (sbValues || []).reduce((a, b) => a + b, 0);
  const sbPlayers = (sbValues || []).filter((v) => v > 0).length;
  check('成績: 盗塁合計=3(重盗で2人に付与)', sbTotal === 3, `actual=${sbTotal}`);
  check('成績: 盗塁記録者は2人', sbPlayers === 2, `actual=${sbPlayers}`);

  console.log(failures === 0 ? '\n✓ golden path PASS' : `\n✗ golden path FAIL (${failures})`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);

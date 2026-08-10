// スコアシート直接修正e2e: シートのマスを押してその打席を直す
// 実行: npm run test:e2e
// 守りたいこと:
//  - 修正モードに入るまでマスは押せない(人に見せている最中の誤タップを防ぐ)
//  - 押したマスがそのまま編集対象になる(「何打席目か」を言葉で特定する工程を無くす)
//  - 直した結果がシートの表記にそのまま出る(成績も再計算される)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4176;
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

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // --- デモ投入 → 試合開始 ---
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(400); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', 'シート修正');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(500);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(500); }
  await page.waitForTimeout(400);
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(400); }

  // --- 打席を2つ作る(1人目=ヒット、2人目=四球) ---
  const playHit = async () => {
    await page.click('.result-pad button:has-text("ヒット")');
    await page.waitForTimeout(350);
    const coach = page.locator('.pad-coach button');
    if (await coach.count()) { await coach.click(); await page.waitForTimeout(200); }
    const f = page.locator('.field-pad button.field-pos').first();
    if (await f.count()) { await f.click(); await page.waitForTimeout(800); }
    await page.click('.sheet-actions button:has-text("確定")');
    await page.waitForTimeout(450);
  };
  await playHit();
  await page.click('.result-pad button:has-text("四球")');
  await page.waitForTimeout(300);
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(450);

  // --- スコアシートを開く ---
  await page.click('nav button:has-text("試合結果")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("スコアシートを開く")');
  await page.waitForTimeout(700);

  check('シートが開く', (await page.locator('.scoresheet-root').count()) === 1);
  const filled = () => page.locator('.ss-matrix .ss-cell').filter({ hasText: /\S/ });
  check('打席のマスが出ている', (await filled().count()) >= 2, `n=${await filled().count()}`);

  // --- 修正モードに入るまでは押せない ---
  check('既定では押せない', (await page.locator('.ss-cell-btn').count()) === 0);
  check('修正するボタンがある', (await page.locator('.ss-editbtn').count()) === 1);

  await page.click('.ss-editbtn');
  await page.waitForTimeout(400);
  check('修正モードで押せるようになる', (await page.locator('.ss-cell-btn').count()) >= 2,
    `n=${await page.locator('.ss-cell-btn').count()}`);
  check('やることが書いてある', (await page.locator('.ss-edithint').innerText()).includes('押して'));

  // --- 押したマスがそのまま編集対象になる ---
  const first = page.locator('.ss-cell-btn').first();
  const beforeTxt = (await first.innerText()).trim();
  await first.click();
  await page.waitForTimeout(600);
  check('打席の編集シートが開く', (await page.locator('.sheet').count()) >= 1);
  const sheetText = await page.locator('.sheet').last().innerText();
  check('その打席の回が見出しに出る', /回/.test(sheetText), sheetText.slice(0, 60));

  // --- 結果を「三振」に直すと、シートの表記も変わる ---
  await page.click('.sheet button:has-text("三振")');
  await page.waitForTimeout(300);
  await page.click('.sheet-actions button:has-text("保存")');
  await page.waitForTimeout(700);
  check('編集シートが閉じる', (await page.locator('.sheet').count()) === 0);
  const afterTxt = (await page.locator('.ss-cell-btn').first().innerText()).trim();
  check('マスの表記が変わる', afterTxt !== beforeTxt, `${beforeTxt} → ${afterTxt}`);
  check('三振になっている', afterTxt.includes('三振'), afterTxt);

  // --- 修正モードを抜けると、また押せなくなる ---
  await page.click('.ss-editbtn');
  await page.waitForTimeout(300);
  check('完了で押せなくなる', (await page.locator('.ss-cell-btn').count()) === 0);
  check('ヒントも消える', (await page.locator('.ss-edithint').count()) === 0);

  // --- 空のマスから、記録されていなかった打席を足せる ---
  await page.click('.ss-editbtn');
  await page.waitForTimeout(400);
  const before = await filled().count();
  check('空マスに＋が出る', (await page.locator('.ss-cell-add').count()) > 0,
    `n=${await page.locator('.ss-cell-add').count()}`);
  await page.locator('.ss-cell-add').first().click();
  await page.waitForTimeout(600);
  check('打席を足すシートが開く', (await page.locator('.sheet').last().innerText()).includes('打席を足す'));
  check('新規では削除ボタンを出さない', (await page.locator('.sheet button:has-text("このプレイを削除")').count()) === 0);
  // 閉じただけでは何も増えない(保存するまで書き込まない)
  await page.click('.sheet-actions button:has-text("キャンセル")');
  await page.waitForTimeout(500);
  check('閉じただけでは増えない', (await filled().count()) === before, `${before} → ${await filled().count()}`);

  await page.locator('.ss-cell-add').first().click();
  await page.waitForTimeout(600);
  await page.click('.sheet button:has-text("四球")');
  await page.waitForTimeout(300);
  await page.click('.sheet-actions button:has-text("保存")');
  await page.waitForTimeout(700);
  check('打席が1つ増える', (await filled().count()) === before + 1, `${before} → ${await filled().count()}`);
  check('足した打席が表に出る',
    (await page.locator('.ss-matrix').first().innerText()).includes('四球'));
  await page.click('.ss-editbtn');
  await page.waitForTimeout(300);

  // --- 回の流れ: 交代のタイミングを直せる ---
  await page.click('.ss-editbtn');
  await page.waitForTimeout(400);
  check('イニングの数字が押せる', (await page.locator('.ss-inn-btn').count()) > 0,
    `n=${await page.locator('.ss-inn-btn').count()}`);
  await page.locator('.ss-inn-btn').first().click();
  await page.waitForTimeout(600);
  const flow = page.locator('.sheet').last();
  check('回の流れが開く', (await flow.innerText()).includes('回の流れ'));
  check('攻撃と守備を切り替えられる', (await page.locator('.flow-half button').count()) === 2);
  check('出来事が並ぶ', (await page.locator('.flow-ev').count()) > 0,
    `n=${await page.locator('.flow-ev').count()}`);

  // 打席の行には上下移動を出さない(打順を壊す操作をこちらから用意しない)
  await page.locator('.flow-ev.k-atbat').first().click();
  await page.waitForTimeout(300);
  check('打席は上下に動かせない', (await page.locator('.flow-box button:has-text("1つ上へ")').count()) === 0);
  check('打席は編集へ飛べる', (await page.locator('.flow-box button:has-text("この打席を直す")').count()) === 1);
  check('動かせない理由が書いてある', (await page.locator('.flow-box').innerText()).includes('打順で決まる'));

  // 打席の行から編集シートへ繋がる
  await page.click('.flow-box button:has-text("この打席を直す")');
  await page.waitForTimeout(600);
  check('流れから打席編集へ飛べる', (await page.locator('.sheet').last().innerText()).includes('回'));
  await page.click('.sheet-actions button:has-text("キャンセル")');
  await page.waitForTimeout(400);

  // --- 横はみ出しがない ---
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('横はみ出しなし', !over);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\n✓ scoresheet PASS' : `\n✗ scoresheet FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

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

  // 試合の流れは、試合を選んだこの場所から直接見られる
  // (スコアシートを開かないと辿り着けないと、振り返りの動線として遠い)
  const resFlow = page.locator('button:has-text("試合の流れを見る")');
  check('試合結果からも流れを開ける', (await resFlow.count()) >= 1);
  await resFlow.first().click();
  await page.waitForTimeout(700);
  check('試合結果から開いた流れシートが出る', (await page.locator('.sheet:has-text("試合の流れ")').count()) >= 1);
  await page.locator('.sheet').last().locator('button:has-text("閉じる"), .sheet-close').first().click();
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

  // --- 守備・交代: 何を直すかを先に選ばせる ---
  // 前のブロックで修正モードに入ったままなので、ここでは切り替えない
  check('選手名のマスが押せる', (await page.locator('.ss-row-btn').count()) > 0,
    `n=${await page.locator('.ss-row-btn').count()}`);
  await page.locator('.ss-row-btn').nth(1).click();
  await page.waitForTimeout(600);
  check('守備・交代のシートが開く', (await page.locator('.sheet').last().innerText()).includes('守備・交代を直す'));
  check('3つから選ばせる', (await page.locator('.df-card').count()) === 3,
    `n=${await page.locator('.df-card').count()}`);
  check('選ぶまで保存を出さない', (await page.locator('.sheet .sheet-actions button:has-text("保存")').count()) === 0);

  // 先発の登録ミスは回を聞かない
  await page.locator('.df-card').first().click();
  await page.waitForTimeout(300);
  check('先発の訂正は回を聞かない', !(await page.locator('.sheet').last().innerText()).includes('何回から'));
  check('正しい守備位置を聞く', (await page.locator('.sheet').last().innerText()).includes('正しい守備位置'));
  await page.click('.sheet .chips-row button:has-text("右")');
  await page.waitForTimeout(250);
  check('何が起きるかを先に言う', (await page.locator('.df-preview').innerText()).includes('先発の位置'),
    await page.locator('.df-preview').innerText());
  check('交代は作らないと明記', (await page.locator('.keep-box').innerText()).includes('交代の記録は作りません'));

  // 途中からの位置変更は回を聞く / 打順は動かないと明記
  await page.locator('.df-card').nth(1).click();
  await page.waitForTimeout(300);
  check('途中からは回を聞く', (await page.locator('.sheet').last().innerText()).includes('何回から'));
  check('打順は動かないと明記', (await page.locator('.keep-box').innerText()).includes('打順は動きません'));

  // 交代は入る選手も聞く
  await page.locator('.df-card').nth(2).click();
  await page.waitForTimeout(300);
  check('交代は入る選手も聞く', (await page.locator('.sheet select').count()) > 0);
  check('名簿と出場中を分ける', (await page.locator('.sheet optgroup').count()) >= 1,
    `n=${await page.locator('.sheet optgroup').count()}`);

  // 先発の守備位置を実際に直す
  await page.locator('.df-card').first().click();
  await page.waitForTimeout(300);
  const posBefore = (await page.locator('.ss-matrix').first().innerText()).slice(0, 200);
  await page.click('.sheet .chips-row button:has-text("右")');
  await page.click('.sheet-actions button:has-text("保存")');
  await page.waitForTimeout(700);
  check('シートが閉じる', (await page.locator('.sheet').count()) === 0);
  check('位置欄が変わる', (await page.locator('.ss-matrix').first().innerText()).slice(0, 200) !== posBefore);
  await page.click('.ss-editbtn');
  await page.waitForTimeout(300);

  // --- 投手成績: 記録から計算した値と並べ、手で直した値は人の判断を優先する ---
  await page.click('.ss-editbtn');
  await page.waitForTimeout(400);
  const pitBtn = page.locator('.ss-table:not(.ss-matrix):not(.ss-line) .ss-row-btn').first();
  check('投手欄が押せる', (await pitBtn.count()) > 0, `n=${await pitBtn.count()}`);
  await pitBtn.click();
  await page.waitForTimeout(600);
  const pf = page.locator('.sheet').last();
  check('投手成績のシートが開く', (await pf.innerText()).includes('投手成績を直す'));
  check('記録どおりと言うだけ', (await page.locator('.pf-box').innerText()).includes('記録どおり'),
    await page.locator('.pf-box').innerText());
  check('記録どおりなら振り直しを勧めない', (await page.locator('.pf-box button').count()) === 0);
  check('記録どおりなら戻す道は出さない', (await page.locator('.pf-undo').count()) === 0);
  check('主ボタンは保存', (await page.locator('.sheet-actions button.primary').innerText()).trim() === '保存',
    await page.locator('.sheet-actions button.primary').innerText());

  // 手で直すと、その判断を優先する言い方に変わる
  await page.locator('.pf-field .stepper button').last().click();
  await page.waitForTimeout(300);
  check('手で決めた値と言う', (await page.locator('.pf-box').innerText()).includes('手で決めた値'),
    await page.locator('.pf-box').innerText());
  check('このままで大丈夫と言う', (await page.locator('.pf-box').innerText()).includes('このままで大丈夫'));
  check('箱にボタンを置かない', (await page.locator('.pf-box button').count()) === 0);
  check('主ボタンが「この内容で直す」', (await page.locator('.sheet-actions button.primary').innerText()).trim() === 'この内容で直す',
    await page.locator('.sheet-actions button.primary').innerText());
  check('戻す道は薄文字で下に', (await page.locator('.pf-undo').count()) === 1);
  const undoY = await page.locator('.pf-undo').evaluate((e) => e.getBoundingClientRect().top);
  const saveY = await page.locator('.sheet-actions button.primary').evaluate((e) => e.getBoundingClientRect().top);
  check('戻すは主ボタンより下', undoY > saveY, `undo=${undoY} save=${saveY}`);

  // 保存すると表の数字が変わる
  await page.click('.sheet-actions button.primary');
  await page.waitForTimeout(700);
  check('投手シートが閉じる', (await page.locator('.sheet').count()) === 0);
  await page.click('.ss-editbtn');
  await page.waitForTimeout(300);

  // ============================================================
  // 試合の流れは、終わった試合でも見られる
  // スコア入力画面にしか入口が無いと、終わった試合では二度と開けない
  // ============================================================
  // 試合結果タブは全画面シートの裏に残っているので、シート内のボタンに限って探す
  const flowBtn = page.locator('.ss-after button:has-text("試合の流れを見る")');
  check('スコアシートから流れを開ける', (await flowBtn.count()) === 1);
  await flowBtn.first().click();
  await page.waitForTimeout(700);
  const fv = page.locator('.sheet:has-text("試合の流れ")');
  check('流れシートが開く', (await fv.count()) >= 1);
  const fvTxt = await fv.first().innerText();
  check('記録員を決められる', fvTxt.includes('記録員'), fvTxt.slice(0, 400));
  // グラフを押すと数字が出る
  const chart = page.locator('.fv-chart svg');
  if (await chart.count()) {
    const box = await chart.first().boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.waitForTimeout(400);
    }
  }
  check('グラフを押すと打席の数字が出る', (await page.locator('.fv-read').count()) >= 1);
  // 線と線分スコアの中身は flow.e2e.mjs で見る。ここは入口が生きていることだけ
  check('線のすぐ下に線分スコアがある', (await page.locator('.fv-chart .fv-line-score').count()) === 1);
  await page.locator('.sheet').last().locator('button:has-text("閉じる"), .sheet-close').first().click();
  await page.waitForTimeout(500);

  // --- 横はみ出しがない ---
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('横はみ出しなし', !over);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\n✓ scoresheet PASS' : `\n✗ scoresheet FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

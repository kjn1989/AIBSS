// 打球ごとの守備の記録 e2e: 実行 `node tests/hiterror.e2e.mjs`
// 前半は安打と失策が同じプレイに付くこと、後半はファインプレーが選手に残ること。
//
// 記録規則では、安打かどうかは打球そのもので決まり、そのあと守備が乱れて
// 余分に進んだぶんは失策になる。つまり1つのプレイに安打と失策が同時に付く。
//   例) 右翼へのツーベース。右翼手の送球が逸れて打者走者が三塁へ。
//       → 打者は二塁打、右翼手に送球失策1
// result は1つしか持てないので、以前は「安打か失策か」の二択だった。
//
// 守りたいこと:
//  - 安打を選んだままで失策を足せること
//  - 打った記録は安打のまま(失策に化けない)
//  - ラインスコアのEが1つ増えること
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4184;
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
  page.on('dialog', (d) => d.accept());

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(500); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', '安打と失策');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(700);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(700); }
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(500); }
  // 守備の記録は「その位置を守っている選手」に付く。自動セットは登録された守備位置が
  // 無いと全員を控にするので、ここで位置を入れておく(入っていないと誰にも付かない)
  await page.click('nav button:has-text("オーダー")');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const want = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
    [...document.querySelectorAll('.card .row select')].forEach((sel, i) => {
      if (!want[i]) return;
      sel.value = want[i];
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page.waitForTimeout(600);
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(600);

  // ---- ツーベースを記録する ----
  await page.click('.result-pad button:has-text("ツーベース")');
  await page.waitForTimeout(400);
  const coach = page.locator('.pad-coach button');
  if (await coach.count()) { await coach.click(); await page.waitForTimeout(200); }
  // 右翼へ
  const rf = page.locator('.field-pad button.field-pos:has-text("右")').first();
  if (await rf.count()) { await rf.click(); } else { await page.locator('.field-pad button.field-pos').first().click(); }
  await page.waitForTimeout(600);

  const sheet = page.locator('.sheet').last();
  check('守備の欄が出ている', (await sheet.innerText()).includes('この打球の守備'),
    (await sheet.innerText()).slice(0, 400));

  // ---- 送球失策を足す ----
  // 失策 → 捕球/送球 の2段。ファインプレーと同じ場所に3択で置いてある
  await page.locator('.play-error button:has-text("失策")').click();
  await page.waitForTimeout(250);
  await page.locator('.play-error button:has-text("送球")').click();
  await page.waitForTimeout(300);
  const pos = await page.locator('.pe-pos button.primary').count();
  check('打った方向の野手が最初から選ばれている', pos === 1, `選択中=${pos}`);
  const posName = await page.locator('.pe-pos button.primary').innerText();
  check('右翼の失策として選ばれている', posName === '右', posName);

  const q = await page.locator('.confirm-card').innerText();
  check('確認文にツーベースが残っている', q.includes('ツーベース'), q);
  check('確認文に失策も出る', q.includes('失策'), q);

  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(800);

  // ---- 打った記録は安打のまま、Eが1つ増えている ----
  // 自チームは先攻(away)。R/H/E は行末の3つ
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.led-ls tr')].map((r) => ({
      cells: [...r.querySelectorAll('th,td')].map((c) => c.textContent.trim()),
      away: !!r.querySelector('td.ini'),
    })));
  const head = rows.find((r) => r.cells.includes('H') && r.cells.includes('E'));
  check('ラインスコアにH/Eの欄がある', !!head, JSON.stringify(rows.map((r) => r.cells)));
  const hi = head.cells.indexOf('H');
  const ei = head.cells.indexOf('E');
  const me = rows.find((r) => r.away && r.cells.length === head.cells.length);
  check('安打が1本ついている(失策に化けていない)', me?.cells[hi] === '1',
    JSON.stringify(rows.map((r) => r.cells)));
  check('相手のEが1つ増えている',
    rows.some((r) => r !== head && r.cells[ei] === '1'), JSON.stringify(rows.map((r) => r.cells)));

  const log = await page.locator('.scoretab').innerText();
  check('記録の文にも失策が残る', log.includes('失'), log.slice(0, 600));
  // ---- 悪送球がスタンドに入って打者に二個の塁が与えられた場合 ----
  // 記録は「遊撃エラー」のままなので、二塁まで行ったことが確認文に出ないと
  // 最後の確かめで拾えない
  await page.click('.result-pad button:has-text("エラー")');
  await page.waitForTimeout(400);
  const coach2 = page.locator('.pad-coach button');
  if (await coach2.count()) { await coach2.click(); await page.waitForTimeout(200); }
  const ss = page.locator('.field-pad button.field-pos:has-text("遊")').first();
  if (await ss.count()) { await ss.click(); } else { await page.locator('.field-pad button.field-pos').first().click(); }
  await page.waitForTimeout(600);
  const q1 = await page.locator('.confirm-card').innerText();
  check('既定の一塁のときは行き先を書き足さない', !q1.includes('打者'), q1);
  await page.locator('.runner-move button:has-text("二塁へ")').last().click();
  await page.waitForTimeout(300);
  const q2 = await page.locator('.confirm-card').innerText();
  check('二塁まで行ったことが確認文に出る', q2.includes('打者二塁へ'), q2);
  check('記録はエラーのまま', q2.includes('エラー'), q2);
  // 「二塁塁へ」のように塁が重ならないこと
  check('塁の字が重なっていない', !q2.includes('塁塁'), q2);

  // 開いたままのシートを閉じる(この打席は記録しない)
  await page.locator('.sheet-actions button:has-text("キャンセル")').last().click();
  await page.waitForTimeout(500);

  // ---- ファインプレー: 自チームが守っているときだけ選手の記録になる ----
  // 打った・投げたは残るのに、守った記録は失策しか残っていなかった。
  // 守備側の勝利貢献はその打席の投手に全部付くので、野手には何も残らない。
  await page.click('button:has-text("手動チェンジ")');
  await page.waitForTimeout(800);
  const oppPad = page.locator('.result-pad button:has-text("凡打")').first();
  check('相手の攻撃(自チームの守備)になった', await oppPad.count() > 0);
  // 守備側は投手を決めるまで入力がロックされる(仕様)。まず投手を選ぶ
  const psel = page.locator('select').filter({ has: page.locator('option') }).first();
  if (await psel.count()) {
    const opts = await psel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (opts.length) { await psel.selectOption(opts[0]); await page.waitForTimeout(600); }
  }
  check('投手を決めたら入力できる', !(await oppPad.isDisabled()),
    `locked=${await page.locator('.input-locked').count()}`);
  await oppPad.click();
  await page.waitForTimeout(400);
  const coach3 = page.locator('.pad-coach button');
  if (await coach3.count()) { await coach3.click(); await page.waitForTimeout(200); }
  const ss2 = page.locator('.field-pad button.field-pos:has-text("遊")').first();
  if (await ss2.count()) { await ss2.click(); } else { await page.locator('.field-pad button.field-pos').first().click(); }
  await page.waitForTimeout(600);

  const dsheet = page.locator('.sheet').last();
  check('守備の欄が3択になっている',
    (await dsheet.innerText()).includes('この打球の守備')
      && (await dsheet.innerText()).includes('ファインプレー'), (await dsheet.innerText()).slice(0, 400));
  await page.locator('.play-error button:has-text("ファインプレー")').click();
  await page.waitForTimeout(300);
  const q3 = await page.locator('.confirm-card').innerText();
  check('確認文にファインプレーが出る', q3.includes('ファインプレー'), q3);
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(800);

  const dlog = await page.locator('.scoretab').innerText();
  // ゲッツーの ⚡ とは別の印にする
  check('記録の文に✦が付く', dlog.includes('✦'), dlog.slice(0, 600));
  check('ゲッツーの印と混ざっていない', !/✦[^\n]*⚡|⚡[^\n]*✦/.test(dlog), dlog.slice(0, 600));

  // ---- 成績タブに守備の記録が出る ----
  await page.click('nav button:has-text("成績")');
  await page.waitForTimeout(900);
  const stats = await page.locator('#root').innerText();
  check('守備の記録の表が出る', stats.includes('守備の記録'), stats.slice(0, 800));
  const fieldRow = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('h2')?.textContent === '守備の記録');
    if (!card) return null;
    return [...card.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent.trim()));
  });
  check('野手が1人以上並んでいる', !!fieldRow && fieldRow.length > 0, JSON.stringify(fieldRow));
  check('ファインプレーが1つ数えられている',
    !!fieldRow && fieldRow.some((r) => r[1] === '✦1'), JSON.stringify(fieldRow));

} catch (e) {
  console.log('EXCEPTION:', e && e.message);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n✗ fielding FAIL (${failures})` : '\n✓ fielding PASS');
process.exit(failures ? 1 : 0);

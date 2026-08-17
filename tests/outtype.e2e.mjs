// 打球パッド下段(ダブルプレー / インフィールドフライ)e2e
// 守りたいこと:
//  - ダブルプレーを押したら走者が既定でアウトになり、そのあと打球方向を
//    押しても消えない(組み直しで消えて確定できなくなっていた)
//  - 一二塁・2アウト未満のときだけ押せる(規則どおり)
//  - 押したら選択状態になり、確定まで通る
//  - 確認文にi18nのキー名が漏れない / 日本語に余計な空白が入らない
//  - 打球方向を押す前は「確定できない理由」が出る
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
const PORT = 4212;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 500)); }

let failures = 0;
const check = (n, c, d = '') => { console.log(`${c ? 'ok' : 'NG'} - ${n}${c ? '' : ` :: ${d}`}`); if (!c) failures++; };
const browser = await chromium.launch({ executablePath: resolveChromium() });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => { console.log('PAGE EXCEPTION:', e.message); failures++; });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(400); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', 'インフィールドフライ');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(600);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(500); }
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(400); }

  const outs = () => page.locator('.out-dot.on').count();
  const baseOn = (b) => page.locator(`.base.b${b}.occupied`).count();
  const pickDir = async () => {
    const coach = page.locator('.pad-coach button');
    if (await coach.count()) { await coach.click(); await page.waitForTimeout(200); }
    const f = page.locator('.field-pad button.field-pos').first();
    if (await f.count()) { await f.click(); await page.waitForTimeout(650); }
  };

  // --- 走者なしでは押せない ---
  await page.click('.result-pad button:has-text("凡打")');
  await page.waitForTimeout(500);
  const noRunner = page.locator('.sheet .cpad-foot button:has-text("インフィールドフライ")');
  check('走者なしでは押せない', await noRunner.isDisabled());
  await page.click('.sheet-actions button.ghost');
  await page.waitForTimeout(400);

  // --- 一二塁・0アウトを作る ---
  for (let i = 0; i < 2; i++) {
    await page.click('.result-pad button:has-text("ヒット")');
    await page.waitForTimeout(350);
    await pickDir();
    await page.click('.sheet-actions button:has-text("確定")');
    await page.waitForTimeout(500);
  }
  check('一二塁になっている', (await baseOn(1)) > 0 && (await baseOn(2)) > 0);
  check('0アウトのまま', (await outs()) === 0, String(await outs()));

  await page.click('.result-pad button:has-text("凡打")');
  await page.waitForTimeout(500);

  // 打球方向を押す前は、確定できない理由が出ていること。
  // 問いだけ出して確定が灰色のままだと、何を待たれているのか分からない
  const before = await page.locator('.sheet .confirm-card').innerText();
  check('方向を押す前は理由が出る', before.includes('打球が落ちたところ'), before);
  check('その間は確定できない', await page.locator('.sheet-actions button.primary').isDisabled());

  await pickDir();
  // 実機と同じ順: 打球の強さを選んでからインフィールドフライを押す
  await page.locator('.sheet .cpad-cell:has-text("フライ")').first().click();
  await page.waitForTimeout(250);
  const ifly = page.locator('.sheet .cpad-foot button:has-text("インフィールドフライ")');
  check('一二塁・0アウトなら押せる', !(await ifly.isDisabled()));
  await ifly.click();
  await page.waitForTimeout(300);
  check('押すと選択状態になる', (await ifly.getAttribute('class')).includes('primary'),
    await ifly.getAttribute('class'));

  const q = await page.locator('.sheet .confirm-card').innerText();
  check('確認文にキー名が漏れていない', !q.includes('battedBall.'), q);
  check('インフィールドフライだと書いてある', q.includes('インフィールドフライ'), q);
  check('日本語に余計な空白が入らない', !/ でよろしいですか/.test(q), q);
  check('確定できる', !(await page.locator('.sheet-actions button.primary').isDisabled()));

  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(600);
  check('打者はアウトになった', (await outs()) === 1, String(await outs()));
  check('走者は残っている', (await baseOn(1)) > 0 && (await baseOn(2)) > 0);

  // --- 1死一二塁でも押せる(報告のあった場面) ---
  await page.click('.result-pad button:has-text("凡打")');
  await page.waitForTimeout(500);
  const oneOut = page.locator('.sheet .cpad-foot button:has-text("インフィールドフライ")');
  check('1死一二塁でも押せる', !(await oneOut.isDisabled()));
  await oneOut.click();
  await page.waitForTimeout(300);
  check('1死でも選択状態になる', (await oneOut.getAttribute('class')).includes('primary'),
    await oneOut.getAttribute('class'));

  // 確定できない理由は押せて、押すと打球方向の図まで戻れること。
  // 図はシートの最上部にあり、下までスクロールすると画面の外に出てしまう
  const needDir = page.locator('.sheet .need-dir');
  check('確定できない理由が押せる形で出ている', (await needDir.count()) === 1);
  await needDir.click();
  await page.waitForTimeout(700);
  const fieldSeen = await page.evaluate(() => {
    const el = document.querySelector('.sheet .field-pad');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
  check('押すと打球方向の図が画面に出る', fieldSeen);
  await pickDir();
  check('方向を入れたら確定できる', !(await page.locator('.sheet-actions button.primary').isDisabled()));
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(600);

  // --- 2アウトになったら押せない ---
  check('2アウトになった', (await outs()) === 2, String(await outs()));
  await page.click('.result-pad button:has-text("凡打")');
  await page.waitForTimeout(500);
  const twoOut = page.locator('.sheet .cpad-foot button:has-text("インフィールドフライ")');
  check('2アウトでは押せない', await twoOut.isDisabled());

  // --- 守備側(相手打者)でも同じように押せる ---
  // 報告のあった場面は1回裏の守備側。攻撃側とは別のシートを通るので、そちらも見る
  await page.locator('.sheet-actions button.ghost').click();
  await page.waitForTimeout(400);
  await page.click('.result-pad button:has-text("三振")');
  await page.waitForTimeout(900);
  const conf = page.locator('.sheet-actions button:has-text("確定")');
  if (await conf.count()) { await conf.click(); await page.waitForTimeout(700); }
  // 守備側に切り替わるまで待つ(守備確認が挟まることがある)
  for (let i = 0; i < 10; i++) {
    if ((await page.locator('.result-pad button:has-text("凡打")').count()) > 0
      && !(await page.locator('.result-pad button:has-text("凡打")').isDisabled())) break;
    const go = page.locator('.sheet-actions button.primary, button:has-text("この守備で開始")');
    if (await go.count()) { await go.first().click(); }
    await page.waitForTimeout(600);
  }
  const half = await page.locator('body').innerText();
  check('守備側(1回裏)に変わった', half.includes('1回裏') && half.includes('相手打者'), half.slice(0, 200));

  // 守備側は投手を決めるまで入力がロックされる(仕様)。まず投手を選ぶ
  const psel = page.locator('select').filter({ has: page.locator('option') }).first();
  const opts = await psel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  if (opts.length) { await psel.selectOption(opts[0]); await page.waitForTimeout(500); }
  check('投手を決めたら入力できる',
    (await page.locator('.input-locked').count()) === 0,
    String(await page.locator('.input-locked').count()));

  for (let i = 0; i < 2; i++) {
    await page.click('.result-pad button:has-text("ヒット")');
    await page.waitForTimeout(350);
    await pickDir();
    await page.click('.sheet-actions button:has-text("確定")');
    await page.waitForTimeout(600);
  }
  check('守備側でも一二塁になった', (await baseOn(1)) > 0 && (await baseOn(2)) > 0);
  await page.click('.result-pad button:has-text("凡打")');
  await page.waitForTimeout(500);
  const defIfly = page.locator('.sheet .cpad-foot button:has-text("インフィールドフライ")');
  check('守備側・0死一二塁でも押せる', !(await defIfly.isDisabled()));
  await defIfly.click();
  await page.waitForTimeout(300);
  check('守備側でも選択状態になる', (await defIfly.getAttribute('class')).includes('primary'),
    await defIfly.getAttribute('class'));
  await pickDir();
  check('守備側でも確定できる', !(await page.locator('.sheet-actions button.primary').isDisabled()));
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(700);
  check('守備側でも1死になった', (await outs()) === 1, String(await outs()));
  await page.click('.result-pad button:has-text("凡打")');
  await page.waitForTimeout(500);
  const defOne = page.locator('.sheet .cpad-foot button:has-text("インフィールドフライ")');
  check('守備側・1死一二塁でも押せる(報告の場面)', !(await defOne.isDisabled()));

    // ============================================================
  // ダブルプレー: 押したら走者が既定でアウトになり、方向を押しても消えない
  // ============================================================
  await page.locator('.sheet-actions button.ghost').click();
  await page.waitForTimeout(400);
  // 走者を一塁だけにする
  for (let i = 0; i < 3; i++) {
    if ((await baseOn(1)) > 0 && (await baseOn(2)) === 0) break;
    await page.click('.result-pad button:has-text("三振")');
    await page.waitForTimeout(700);
    const c2 = page.locator('.sheet-actions button:has-text("確定")');
    if (await c2.count()) { await c2.click(); await page.waitForTimeout(700); }
    for (let k = 0; k < 8; k++) {
      const locked = await page.locator('.input-locked').count();
      if (!locked) break;
      const sel2 = page.locator('select').first();
      const os2 = await sel2.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      if (os2.length) await sel2.selectOption(os2[0]);
      await page.waitForTimeout(400);
    }
    if ((await baseOn(1)) === 0) {
      await page.click('.result-pad button:has-text("ヒット")');
      await page.waitForTimeout(350);
      await pickDir();
      await page.click('.sheet-actions button:has-text("確定")');
      await page.waitForTimeout(600);
    }
  }
  check('一塁に走者が居る', (await baseOn(1)) > 0);

  await page.click('.result-pad button:has-text("凡打")');
  await page.waitForTimeout(500);
  // 打球方向より先にダブルプレーを押す(報告された順序)
  const dp = page.locator('.sheet .cpad-foot button:has-text("ダブルプレー")');
  check('ダブルプレーが押せる', !(await dp.isDisabled()));
  await dp.click();
  await page.waitForTimeout(350);
  // 走者の行き先は .runner-move .dests の中。選択中は 'sel'、アウトは 'sel out'
  const runnerOut = () => page.evaluate(() => {
    const row = document.querySelector('.sheet .runner-move');
    if (!row) return null;
    const sel = row.querySelector('.dests button.sel');
    return sel ? sel.textContent.trim() : null;
  });
  check('押した時点で走者がアウトになる', (await runnerOut()) === 'アウト', String(await runnerOut()));

  // ここで打球方向を押しても、走者のアウトが消えないこと(消えていた)
  await pickDir();
  const warn = await page.locator('.sheet').innerText();
  check('方向を押しても走者のアウトが残る', (await runnerOut()) === 'アウト', String(await runnerOut()));
  check('警告が出ない', !warn.includes('ダブルプレーには走者のアウトが必要'), warn.slice(0, 400));
  check('ダブルプレーのまま確定できる',
    !(await page.locator('.sheet-actions button.primary').isDisabled()));
  const outsBefore = await outs();
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(700);
  check('アウトが2つ増えた', (await outs()) === outsBefore + 2 || (await outs()) < outsBefore,
    `${outsBefore} → ${await outs()}`);

  console.log(failures === 0 ? '\n✓ out types PASS' : `\n✗ out types FAIL (${failures})`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);

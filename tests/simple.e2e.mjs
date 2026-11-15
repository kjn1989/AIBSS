// かんたん記録のe2e: 1球ごとのボタン無しで、結果と打球方向だけで1打席が付くこと。
// 守りたいこと:
//  - 初めての試合は「かんたん」から始まり、選んだ方を次の試合でも覚えている
//  - 球数・カウント・流れタグ・打球の強さ深さが画面に出ない
//  - 記録は同じ形で残る(球数・強さ・深さ・三振の内訳が空になるだけ)
//  - 試合の途中で「くわしく」に切り替えられる
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
const PORT = 4205;
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
  for (const [i, nm] of ['青木', '井上', '上田', '江口', '大野', '加藤', '木村', '工藤', '小林'].entries()) {
    await p.fill('.add-form input[placeholder="選手名"]', nm);
    await p.fill('.add-form input[placeholder="背番号"]', String(i + 1));
    await p.click('.add-form button.primary'); await W(100);
  }
  await p.click('nav button:has-text("スコア入力")'); await W(400);

  const simpleBtn = p.locator('button:has-text("かんたん")').first();
  ok('初めての試合は「かんたん」が選ばれている', (await simpleBtn.getAttribute('aria-pressed')) === 'true');
  const setup = await p.locator('.main').innerText();
  ok('かんたんでは記録員・力の差・リエントリーを聞かない',
    !setup.includes('記録員') && !setup.includes('相手との力の差') && !setup.includes('リエントリー'), setup.slice(0, 300));
  await p.fill('input[placeholder="対戦相手名"]', 'かんたん練習');
  await p.click('button:has-text("試合開始")'); await W(600);
  await p.click('.sheet-actions button.primary'); await W(600);
  await p.click('button:has-text("登録選手から打順を自動セット")'); await W(500);

  ok('1球ごとのボタンが無い', (await p.locator('.count-btns').count()) === 0);
  ok('流れタグが無い', (await p.locator('.flow-card').count()) === 0);
  ok('スコアボードにボール・ストライクが無い', (await p.locator('.led-bso .r.b, .led-bso .r.s').count()) === 0);
  ok('アウトカウントは出ている', (await p.locator('.led-bso .r.o').count()) === 1);
  ok('球数の表示が無い', (await p.locator('.li-pc, .led-pcpair').count()) === 0);

  // ヒット: 守備位置を1つ押して確定
  await p.click('.result-pad button:has-text("ヒット")'); await W(400);
  ok('フィールドの図は出ない(守備位置のボタンだけ)', (await p.locator('.field-pad').count()) === 0 && (await p.locator('.simple-dir button').count()) === 9);
  const sheet = await p.locator('.sheet').last().innerText();
  ok('打球の強さ・守備の出来を聞かない', !sheet.includes('強い') && !sheet.includes('ファインプレー'), sheet.slice(0, 300));
  ok('方向を押すまで確定できない', await p.locator('.sheet-actions button:has-text("確定")').isDisabled());
  await p.click('.simple-dir button:has-text("中堅")'); await W(200);
  await p.click('.sheet-actions button:has-text("確定")'); await W(500);
  ok('走者が一塁に出る', (await p.locator('.base.b1.occupied').count()) === 1);

  // 凡打: 位置からアウトの種類が決まる(遊撃=ゴロ、中堅=フライ)
  await p.click('.result-pad button:has-text("凡打")'); await W(400);
  await p.click('.simple-dir button:has-text("中堅")'); await W(200);
  ok('外野ならフライ', await p.locator('.simple-out button.primary').innerText() === 'フライ');
  await p.click('.simple-dir button:has-text("遊撃")'); await W(200);
  ok('内野ならゴロ', await p.locator('.simple-out button.primary').innerText() === 'ゴロ');
  await p.click('.sheet-actions button:has-text("確定")'); await W(500);

  // 三振: 内訳を聞かない
  await p.click('.result-pad button:has-text("三振")'); await W(400);
  const kSheet = await p.locator('.sheet').last().innerText();
  ok('三振の空振り/見逃しを聞かない', !kSheet.includes('空振り') && !kSheet.includes('見逃し'), kSheet.slice(0, 200));
  await p.click('.sheet-actions button:has-text("確定")'); await W(500);
  ok('アウトが2つ', (await p.locator('.out-dot.on').count()) === 2);

  await W(1500);
  const saved = await p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('aibss');
    req.onsuccess = () => {
      const r = req.result.transaction('games', 'readonly').objectStore('games').getAll();
      r.onsuccess = () => {
        const g = (r.result || []).map((x) => x.game || x).find((x) => x && x.opponent === 'かんたん練習');
        resolve(g ? { mode: g.recordMode, pas: g.playLogs.filter((l) => l.kind === 'atbat').map((l) => l.payload) } : null);
      };
    };
    req.onerror = () => resolve(null);
  }));
  ok('試合に「かんたん」が残る', saved?.mode === 'simple', JSON.stringify(saved?.mode));
  const [hit, out, k] = saved?.pas || [];
  ok('ヒット: 方向あり・深さと強さは空', hit?.direction === 'CF' && hit?.hitDepth == null && hit?.contact == null, JSON.stringify(hit));
  ok('凡打: 遊ゴロ', out?.direction === 'SS' && out?.outType === 'ground', JSON.stringify(out));
  ok('三振: 内訳は未記録', k?.result === 'so' && k?.soType == null, JSON.stringify(k));
  ok('球数は0のまま', (saved?.pas || []).every((x) => !x.pitchCount), JSON.stringify((saved?.pas || []).map((x) => x.pitchCount)));

  // 途中でくわしくに切り替える
  await p.click('button:has-text("くわしい記録に切り替える")'); await W(500);
  ok('切り替えると1球ごとのボタンが出る', (await p.locator('.count-btns').count()) === 1);
  await p.click('button:has-text("かんたん記録に切り替える")'); await W(500);
  ok('戻せる', (await p.locator('.count-btns').count()) === 0);

  // 次の試合でも「かんたん」を覚えている
  await p.click('button:has-text("試合終了")'); await W(800);
  await p.locator('.sheet-overlay button:has-text("閉じる")').first().click(); await W(500);
  ok('次の試合も「かんたん」から', (await p.locator('button:has-text("かんたん")').first().getAttribute('aria-pressed')) === 'true');
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ simple mode PASS' : `\n✗ simple mode FAIL (${fail})`);
process.exit(fail ? 1 : 0);

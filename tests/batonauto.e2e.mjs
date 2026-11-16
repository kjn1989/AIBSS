// 記録のバトンのe2e: 2台の端末で同じ試合を、交代しながら記録する。
//
// 本物のクラウドの代わりに、このテストが2台の間でデータを中継する
// (アプリ側は CloudSync の差し込み口 window.__AIBSS_TEST_CLOUD__ を通る以外、本番と同じ経路)。
// 守りたいこと:
//  - 記録できるのは常に1台。もう1台は見るだけで、相手の記録がそのまま届く
//  - 「記録を引き継ぐ」で交代でき、前の記録係の端末は自動で見るだけになる
//  - 見るだけの端末からは、どの画面からも試合を変えられない
//  - 電波が切れていた端末の未送信の記録は、黙って消さずに持ち主に選ばせる
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
const PORT = 4210;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 500)); }

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok' : 'NG'} - ${n}${c ? '' : ' :: ' + d}`); if (!c) fail++; };

// ---- 模擬クラウド: 行ごとに最後に送られたものが残る(本番の upsert と同じ) ----
const cloud = { game: new Map(), player: new Map() };
const devices = [];
async function makeDevice(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const dev = { label, online: true, page: null };
  await ctx.exposeFunction('__cloudLoad', () => JSON.stringify({ games: [...cloud.game.values()], players: [...cloud.player.values()] }));
  await ctx.exposeFunction('__cloudPush', async (kind, json) => {
    if (!dev.online) throw new Error('offline');
    const obj = JSON.parse(json);
    cloud[kind].set(obj.id, obj);
    for (const other of devices) {
      if (other !== dev && other.online) await other.page.evaluate(([k, j]) => window.__deliver(k, j), [kind, json]).catch(() => {});
    }
  });
  await ctx.addInitScript(() => {
    window.__AIBSS_TEST_CLOUD__ = {
      connect(cb) {
        window.__cb = cb;
        cb.onStatus('connecting');
        const ready = window.__cloudLoad().then((json) => {
          const d = JSON.parse(json);
          cb.onPlayers(d.players);
          cb.onGames(d.games);
          cb.onStatus('on');
          return true;
        });
        return {
          ready,
          pushGame: (g) => window.__cloudPush('game', JSON.stringify(g)),
          pushPlayer: (p) => window.__cloudPush('player', JSON.stringify(p)),
          teardown() {},
        };
      },
    };
    window.__deliver = (kind, json) => {
      const o = JSON.parse(json);
      if (kind === 'game') window.__cb.onGames([o]); else window.__cb.onPlayers([o]);
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log(`EXC(${label}):`, e.message); fail++; });
  page.on('dialog', (d) => d.accept());
  dev.page = page;
  devices.push(dev);
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  return dev;
}
// 電波が切れる / 戻る。戻ったときはクラウドにある版がまとめて届く(本番の再接続と同じ)
const goOffline = async (dev) => { dev.online = false; await dev.page.evaluate(() => window.__cb.onStatus('error')); };
const goOnline = async (dev) => {
  dev.online = true;
  await dev.page.evaluate((json) => {
    const d = JSON.parse(json);
    window.__cb.onStatus('on');
    window.__cb.onGames(d.games);
  }, JSON.stringify({ games: [...cloud.game.values()] }));
};

const b = await chromium.launch({ executablePath: resolveChromium() });
try {
  const A = await makeDevice(b, 'A');
  const a = A.page;
  const W = (ms) => a.waitForTimeout(ms);
  const cloudGame = () => [...cloud.game.values()][0];
  await a.click('button[aria-label="設定"]'); await W(400);
  for (const [i, nm] of ['青木', '井上', '上田', '江口', '大野', '加藤', '木村', '工藤', '小林'].entries()) {
    await a.fill('.add-form input[placeholder="選手名"]', nm);
    await a.fill('.add-form input[placeholder="背番号"]', String(i + 1));
    await a.click('.add-form button.primary'); await W(100);
  }
  await a.click('nav button:has-text("スコア入力")'); await W(400);
  await a.click('.mode-opt:has-text("かんたん")');
  await a.fill('input[placeholder="対戦相手名"]', '自動交代');
  await a.fill('input[placeholder="例: 中島"]', 'さくら');
  await a.click('button:has-text("試合開始")'); await W(600);
  await a.click('.sheet-actions button.primary'); await W(600);
  await a.click('button:has-text("登録選手から打順を自動セット")'); await W(500);
  await W(1500);

  const B = await makeDevice(b, 'B');
  const p = B.page;
  await p.click('nav button:has-text("スコア入力")'); await p.waitForTimeout(500);
  await p.click('button:has-text("再開")').catch(() => {}); await p.waitForTimeout(600);
  await p.click('button:has-text("記録を引き継ぐ")'); await p.waitForTimeout(300);
  await p.fill('.baton-take input', 'けんた');
  await p.click('.baton-take button:has-text("引き継ぐ")'); await p.waitForTimeout(1500);

  // 初期は使わない設定。B(記録係)が「攻めはけんた・守りはさくら」と決める
  ok('自動交代は初期では使わない設定', !cloudGame().batonPlan?.on);
  await p.click('button:has-text("攻守交代で自動交代")'); await p.waitForTimeout(400);
  await p.click('.sheet .toggle-row button:has-text("使う")'); await p.waitForTimeout(200);
  const selects = p.locator('.sheet select');
  await selects.nth(0).selectOption({ label: 'けんた' });
  await selects.nth(1).selectOption({ label: 'さくら' });
  await p.click('.sheet-actions button:has-text("保存")'); await p.waitForTimeout(1500);
  ok('設定がクラウドに残る', cloudGame().batonPlan?.on === true && cloudGame().batonPlan.defense?.name === 'さくら', JSON.stringify(cloudGame().batonPlan));

  // B が3アウト(三振×3)で攻守交代 → 自動で A に渡る
  for (let i = 0; i < 3; i++) { await p.click('.result-pad button:has-text("三振")'); await p.waitForTimeout(500); }
  await p.waitForTimeout(1800);
  ok('攻守交代でクラウドの記録係が さくら になる', cloudGame().recorder?.name === 'さくら', JSON.stringify(cloudGame().recorder));
  ok('B は見るだけになる', (await p.locator('.result-pad').count()) === 0 && (await p.locator('.main').innerText()).includes('いま さくら が記録しています'));
  ok('A に入力ボタンが出る(守りの回)', (await a.locator('.result-pad button').count()) > 0 && (await a.locator('.main').innerText()).includes('1回裏'));
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ baton auto PASS' : `\n✗ baton auto FAIL (${fail})`);
process.exit(fail ? 1 : 0);

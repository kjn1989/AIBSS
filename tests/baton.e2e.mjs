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
const PORT = 4206;
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
  const play = async (p, label, pos) => {
    await p.click(`.result-pad button:has-text("${label}")`); await p.waitForTimeout(350);
    if (pos) { await p.click(`.simple-dir button:has-text("${pos}")`); await p.waitForTimeout(200); }
    // 三振・四球は確認なしで記録される(かんたん記録)。シートが出たときだけ確定する
    const ok2 = p.locator('.sheet-actions button:has-text("確定")');
    if (await ok2.count()) await ok2.click();
    await p.waitForTimeout(450);
  };
  const logCount = (p) => p.locator('.log-line').count();
  const cloudGame = () => [...cloud.game.values()][0];

  // ---- A が試合を作って記録を始める ----
  await a.click('button[aria-label="設定"]'); await W(400);
  for (const [i, nm] of ['青木', '井上', '上田', '江口', '大野', '加藤', '木村', '工藤', '小林'].entries()) {
    await a.fill('.add-form input[placeholder="選手名"]', nm);
    await a.fill('.add-form input[placeholder="背番号"]', String(i + 1));
    await a.click('.add-form button.primary'); await W(100);
  }
  await a.click('nav button:has-text("スコア入力")'); await W(400);
  await a.click('.mode-opt:has-text("かんたん")');
  await a.fill('input[placeholder="対戦相手名"]', 'バトン練習');
  await a.fill('input[placeholder="例: 中島"]', 'さくら');
  await a.click('button:has-text("試合開始")'); await W(600);
  await a.click('.sheet-actions button.primary'); await W(600);
  await a.click('button:has-text("登録選手から打順を自動セット")'); await W(500);
  await play(a, 'ヒット', '中堅');
  await W(1500); // 送信は少し遅れて行われる
  ok('A の画面に「あなたが記録係」と出る', (await a.locator('.baton-mine').count()) === 1);
  ok('クラウドに記録係が残る', cloudGame()?.recorder?.name === 'さくら', JSON.stringify(cloudGame()?.recorder));

  // ---- B が同じチームに入る: 見るだけ ----
  const B = await makeDevice(b, 'B');
  const p = B.page;
  await p.click('nav button:has-text("スコア入力")'); await p.waitForTimeout(500);
  await p.click('button:has-text("再開")').catch(() => {});
  await p.waitForTimeout(600);
  let body = await p.locator('.main').innerText();
  ok('B には「いま さくら が記録しています」と出る', body.includes('いま さくら が記録しています'), body.slice(0, 200));
  ok('B には入力ボタンが無い', (await p.locator('.result-pad').count()) === 0);
  ok('B に A の記録が見えている', body.includes('青木'), body.slice(0, 300));

  // A が続けて記録 → B にそのまま届く
  await play(a, '凡打', '遊撃');
  await W(1500);
  body = await p.locator('.main').innerText();
  ok('A の次の打席が B に届く', body.includes('井上'), body.slice(0, 300));

  // B は別の画面からも変えられない(オーダーの守備位置を変えても反映されない)
  await p.click('nav button:has-text("オーダー")'); await p.waitForTimeout(600);
  ok('オーダーにも「変更できません」と出る', (await p.locator('.baton-box.locked').count()) === 1);
  const before = cloudGame().updatedAt;
  await p.locator('select.small').first().selectOption({ index: 5 }).catch(() => {});
  await p.waitForTimeout(1500);
  ok('見るだけの端末からはクラウドが変わらない', cloudGame().updatedAt === before, `${before} → ${cloudGame().updatedAt}`);

  // ---- B が引き継ぐ ----
  await p.click('nav button:has-text("スコア入力")'); await p.waitForTimeout(500);
  await p.click('button:has-text("記録を引き継ぐ")'); await p.waitForTimeout(300);
  await p.fill('.baton-take input', 'けんた');
  await p.click('.baton-take button:has-text("引き継ぐ")'); await p.waitForTimeout(600);
  ok('引き継ぐと B に入力ボタンが出る', (await p.locator('.result-pad button').count()) > 0);
  await p.waitForTimeout(1500);
  body = await a.locator('.main').innerText();
  ok('A は自動で見るだけになる', body.includes('いま けんた が記録しています') && (await a.locator('.result-pad').count()) === 0, body.slice(0, 200));
  await play(p, '三振');
  await p.waitForTimeout(1500);
  ok('B の記録が A に届く', (await a.locator('.main').innerText()).includes('上田'));
  ok('ここまで3打席がクラウドに揃っている', cloudGame().playLogs.filter((l) => l.kind === 'atbat').length === 3,
    String(cloudGame().playLogs.filter((l) => l.kind === 'atbat').length));

  // ---- 電波が切れた B が記録を続け、その間に A が引き継ぐ ----
  await goOffline(B);
  await p.click('.result-pad button:has-text("四球")').catch(() => {}); await p.waitForTimeout(700);
  // A は B の最新(四球)を知らないまま引き継いで、別の記録を付ける
  await a.click('button:has-text("記録を引き継ぐ")'); await W(300);
  await a.click('.baton-take button:has-text("引き継ぐ")'); await W(600);
  await play(a, 'ヒット', '左翼');
  await W(1500);
  const afterA = cloudGame().playLogs.filter((l) => l.kind === 'atbat').length;
  ok('A の記録がクラウドに入る', afterA >= 4 && cloudGame().recorder?.name === 'さくら', `${afterA} ${JSON.stringify(cloudGame().recorder)}`);

  // B の電波が戻る: 黙って上書きもされず、黙って消えもしない
  await goOnline(B);
  await p.waitForTimeout(1500);
  body = await p.locator('.main').innerText();
  ok('B に「つながっていない間に さくら が引き継ぎました」と出る', body.includes('つながっていない間に さくら が記録を引き継ぎました'), body.slice(0, 300));
  ok('この端末にだけある記録の件数が出る', /この端末にだけある記録が \d+ 件/.test(body), body.slice(0, 300));
  ok('B の未送信の記録でクラウドが上書きされていない',
    cloudGame().recorder?.name === 'さくら' && cloudGame().playLogs.filter((l) => l.kind === 'atbat').length === afterA);
  ok('B は見るだけになっている', (await p.locator('.result-pad').count()) === 0);

  // 「さくら の記録を残す」を選ぶと、警告が消えて A の記録のままになる
  await p.click('button:has-text("さくら の記録を残す")'); await p.waitForTimeout(800);
  ok('選ぶと警告が消える', (await p.locator('.baton-box.conflict').count()) === 0);
  await p.waitForTimeout(1200);
  ok('クラウドは A の記録のまま', cloudGame().recorder?.name === 'さくら' && cloudGame().playLogs.filter((l) => l.kind === 'atbat').length === afterA);

  // 電波が無いときは引き継げない(相手の最新を上書きしないため)
  await goOffline(B);
  await p.waitForTimeout(300);
  ok('つながっていない間は引き継げない', await p.locator('button:has-text("記録を引き継ぐ")').isDisabled());
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ baton PASS' : `\n✗ baton FAIL (${fail})`);
process.exit(fail ? 1 : 0);

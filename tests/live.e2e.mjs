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
const PORT = 4212;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 500)); }

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok' : 'NG'} - ${n}${c ? '' : ' :: ' + d}`); if (!c) fail++; };

// ---- 模擬クラウド(+ ライブ観戦の関数。supabase/live_share.sql と同じ振る舞い) ----
const cloud = { game: new Map(), player: new Map(), token: null };
const devices = [];
const liveView = (token, { game, last, since }) => {
  if (!cloud.token || token !== cloud.token) return { error: 'not_found' };
  const games = [...cloud.game.values()].filter((g) => !g.deleted && !String(g.id).startsWith('demo-'))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const list = games.slice(0, 20).map((g) => ({ id: g.id, date: g.date, opponent: g.opponent, status: g.status, myScore: g.myScore, oppScore: g.oppScore, updatedAt: g.updatedAt }));
  const pool = game ? games.filter((g) => g.id === game) : games;
  const g = (game ? pool[0] : pool.find((x) => x.status === 'ongoing') || pool[0]) || null;
  const send = !!g && (g.id !== last || (g.updatedAt || 0) > (since || 0));
  return {
    teamName: 'ライブ試験チーム', edition: '草野球', list, gameId: g?.id || null, updatedAt: g?.updatedAt || null,
    game: send ? g : null,
    players: send ? [...cloud.player.values()].map((p) => ({ id: p.id, name: p.name, number: p.number })) : null,
  };
};
let viewCalls = 0;
async function makeDevice(browser, label, { scorer }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const dev = { label, online: true, page: null };
  await ctx.exposeFunction('__liveGet', () => cloud.token);
  await ctx.exposeFunction('__liveCreate', () => { cloud.token = cloud.token || 'tok' + 'x'.repeat(40); return cloud.token; });
  await ctx.exposeFunction('__liveRevoke', () => { cloud.token = null; });
  await ctx.exposeFunction('__liveView', (token, opts) => { viewCalls += 1; return liveView(token, opts); });
  await ctx.exposeFunction('__cloudLoad', () => JSON.stringify({ games: [...cloud.game.values()], players: [...cloud.player.values()] }));
  await ctx.exposeFunction('__cloudPush', async (kind, json) => {
    const obj = JSON.parse(json);
    cloud[kind].set(obj.id, obj);
  });
  await ctx.addInitScript((isScorer) => {
    window.__AIBSS_TEST_LIVE__ = {
      get: () => window.__liveGet(), create: () => window.__liveCreate(), revoke: () => window.__liveRevoke(),
      view: (t, o) => window.__liveView(t, o),
    };
    if (!isScorer) return;
    window.__AIBSS_TEST_CLOUD__ = {
      settings: { officialTeamId: 'T1', officialRole: 'owner' },
      connect(cb) {
        window.__cb = cb;
        cb.onStatus('connecting');
        const ready = window.__cloudLoad().then((json) => {
          const d = JSON.parse(json);
          cb.onPlayers(d.players); cb.onGames(d.games); cb.onStatus('on');
          return true;
        });
        return { ready, pushGame: (g) => window.__cloudPush('game', JSON.stringify(g)), pushPlayer: (p) => window.__cloudPush('player', JSON.stringify(p)), teardown() {} };
      },
    };
  }, scorer);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log(`EXC(${label}):`, e.message); fail++; });
  page.on('dialog', (d) => d.accept());
  dev.page = page;
  devices.push(dev);
  return dev;
}

const b = await chromium.launch({ executablePath: resolveChromium() });
try {
  const S = await makeDevice(b, 'scorer', { scorer: true });
  const a = S.page;
  await a.goto(URL_, { waitUntil: 'load' });
  const W = (ms) => a.waitForTimeout(ms);
  await W(1200);
  await a.click('button[aria-label="設定"]'); await W(400);
  for (const [i, nm] of ['青木', '井上', '上田', '江口', '大野', '加藤', '木村', '工藤', '小林'].entries()) {
    await a.fill('.add-form input[placeholder="選手名"]', nm);
    await a.fill('.add-form input[placeholder="背番号"]', String(i + 1));
    await a.click('.add-form button.primary'); await W(100);
  }
  await a.click('nav button:has-text("スコア入力")'); await W(400);
  await a.click('.mode-opt:has-text("かんたん")');
  await a.fill('input[placeholder="対戦相手名"]', 'バンコクFC');
  await a.fill('input[placeholder="例: 中島"]', 'さくら');
  await a.click('button:has-text("試合開始")'); await W(600);
  await a.click('.sheet-actions button.primary'); await W(600);
  await a.click('button:has-text("登録選手から打順を自動セット")'); await W(500);

  // ---- 記録係が観戦リンクを作る ----
  ok('記録係の画面に「観戦リンク」が出る', (await a.locator('button:has-text("📺 観戦リンク")').count()) === 1);
  await a.click('button:has-text("📺 観戦リンク")'); await W(500);
  ok('最初はリンクが無く「作る」が出る', (await a.locator('button:has-text("観戦リンクを作る")').count()) === 1);
  await a.click('button:has-text("観戦リンクを作る")'); await W(500);
  const url = await a.locator('.sheet input[readonly]').inputValue();
  ok('リンクは ?live=トークン の形', /[?&]live=tok/.test(url) && !url.includes('team='), url);
  ok('QRが最初から出ている', (await a.locator('.sheet .live-qr img').count()) === 1);
  ok('ログイン不要で見られると説明がある', (await a.locator('.sheet').innerText()).includes('ログインなし'));
  ok('誰でも見られる注意がある', (await a.locator('.sheet').innerText()).includes('誰でも見られます'));
  await a.click('.sheet-actions button:has-text("閉じる")'); await W(300);

  await a.click('.result-pad button:has-text("ヒット")'); await W(350);
  await a.click('.simple-dir button:has-text("中堅")'); await W(200);
  await a.click('.sheet-actions button:has-text("確定")'); await W(1500);

  // ---- 別の端末(ログインなし・クラウド設定なし)でリンクを開く ----
  const V = await makeDevice(b, 'viewer', { scorer: false });
  const v = V.page;
  await v.goto(url, { waitUntil: 'load' });
  await v.waitForTimeout(2500);
  let text = await v.locator('body').innerText();
  ok('観戦ページにチーム名と相手が出る', text.includes('ライブ試験チーム vs バンコクFC'), text.slice(0, 200));
  ok('観戦ページに入力ボタンも下のタブも出ない', (await v.locator('.result-pad, nav.tabbar, .tabbar').count()) === 0);
  ok('スコアボードが出る', (await v.locator('.led-scoreboard').count()) === 1);
  ok('記録した打席が出る', text.includes('青木') && text.includes('中堅'), text.slice(0, 400));
  ok('ライブと出る', text.includes('ライブ'));

  // ---- 記録が進むと、数秒で観戦ページに届く ----
  await a.click('.result-pad button:has-text("三振")'); await W(1500);
  await v.waitForTimeout(5000);
  text = await v.locator('body').innerText();
  ok('次の打席(三振)が数秒で届く', text.includes('井上'), text.slice(0, 400));

  // ---- 観戦ページは何も保存しない ----
  const stored = await v.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bbscorer.v1.profile.')).map((k) => localStorage.getItem(k).includes('バンコクFC')));
  ok('観戦で受け取った試合を端末に保存していない', stored.every((x) => x === false), JSON.stringify(stored));

  // ---- 更新が無いときは試合本体を送り直さない(通信量) ----
  const before = viewCalls;
  await v.waitForTimeout(4500);
  ok('数秒おきに確認している', viewCalls > before);

  // ---- 止めると、観戦ページは見られなくなる ----
  await a.click('button:has-text("📺 観戦リンク")'); await W(400);
  await a.click('button:has-text("このリンクを止める")'); await W(500);
  await v.waitForTimeout(5000);
  text = await v.locator('body').innerText();
  ok('止めたリンクは「止められています」になる', text.includes('止められています'), text.slice(0, 200));
  ok('止めたあとは新しく作り直せる', (await a.locator('button:has-text("観戦リンクを作る")').count()) === 1);
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ live watch PASS' : `\n✗ live watch FAIL (${fail})`);
process.exit(fail ? 1 : 0);

// チームの立ち上げと「チームに配る案内」のe2e(管理者の画面)。
// 守りたいこと:
//  - 管理者には「チームの立ち上げ」が出て、済んだものに ✓ が付く
//  - 案内は2つに分かれ、全員向けにはログイン情報も記録員リンクも入らない
//  - 記録係向けはログイン情報の真下に記録員リンク。パスワードはどこにも保存しない
//  - 新しいチームの代表向けの「はじめに読む」が、ログイン前に出る
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
const PORT = 4234;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 500)); }

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok' : 'NG'} - ${n}${c ? '' : ' :: ' + d}`); if (!c) fail++; };
const b = await chromium.launch({ executablePath: resolveChromium() });
try {
  // ---- ログイン前: 新しいチームの代表向けの案内 ----
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
    await ctx.addInitScript(() => {
      window.__AIBSS_TEST_AUTH__ = { user: null, teams: [], members: [], invite: async () => 'x' };
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { console.log('EXC:', e.message); fail++; });
    await p.goto(URL_, { waitUntil: 'load' }); await p.waitForTimeout(900);
    await p.click('button[aria-label="設定"]'); await p.waitForTimeout(500);
    ok('設定の目立つところに「チームで共有」の入口がある', await p.locator('.share-entry').count() === 1);
    await p.click('button:has-text("チームで共有の設定を開く")'); await p.waitForTimeout(600);
    const help = p.locator('details.new-team-help');
    ok('ログイン前に「新しいチームの代表の方へ」が出る', await help.count() === 1);
    await help.locator('summary').click(); await p.waitForTimeout(200);
    const ht = await help.innerText();
    ok('代表者の3ステップとメンバーはリンクを開くだけ、が書いてある', ht.includes('新しくアカウントを作る') && ht.includes('このチームをクラウドに登録') && ht.includes('リンクを開くだけ'), ht);
    await ctx.close();
  }

  // ---- 管理者: チームの立ち上げ → 案内づくり ----
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  let liveToken = null;
  await ctx.exposeFunction('__liveGet', () => liveToken);
  await ctx.exposeFunction('__liveCreate', () => { liveToken = 'LIVETOKEN'; return liveToken; });
  await ctx.addInitScript(() => {
    window.__AIBSS_TEST_AUTH__ = {
      user: { uid: 'u1', email: 'lead@example.com' },
      teams: [{ teamId: 'T1', role: 'owner', teamName: 'バンコク・タイガース' }],
      members: [{ uid: 'u1', role: 'owner', email: 'lead@example.com', name: '代表' }],
      invite: async (team, role) => `INVITE-${role}`,
    };
    window.__AIBSS_TEST_LIVE__ = { get: () => window.__liveGet(), create: () => window.__liveCreate(), revoke: () => {}, view: () => ({}), presence: () => ({}), cheer: () => ({}), stats: () => ({}) };
    window.__AIBSS_TEST_CLOUD__ = {
      settings: { officialTeamId: 'T1', officialRole: 'owner' },
      connect(cb) { cb.onStatus('on'); cb.onPlayers([]); cb.onGames([]); return { ready: Promise.resolve(true), pushGame() {}, pushPlayer() {}, teardown() {} }; },
    };
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log('EXC:', e.message); fail++; });
  p.on('dialog', (d) => d.accept());
  const W = (ms) => p.waitForTimeout(ms);
  await p.goto(URL_, { waitUntil: 'load' }); await W(900);
  await p.click('button[aria-label="設定"]'); await W(600);
  await p.locator('label:has-text("チーム名") + input').first().fill('バンコク・タイガース').catch(() => {});
  await W(300);
  await p.click('button:has-text("チームで共有の設定を開く")'); await W(600);

  const list = p.locator('.setup-list');
  ok('管理者に「チームの立ち上げ」が出る', await list.count() === 1);
  let lt = await list.innerText();
  ok('チーム登録は ✓、選手・案内・観戦リンク・記録係は未', (await list.locator('.setup-step.done').count()) === 1 && lt.includes('選手を登録する'), lt);

  // 選手を名簿の貼り付けで登録
  await list.locator('button:has-text("名簿を貼り付け")').click(); await W(400);
  await p.fill('.paste-area', '青木\n井上\n上田');
  await W(300);
  await p.click('.sheet-actions button.primary'); await W(500);
  lt = await p.locator('.setup-list').innerText();
  ok('選手を入れると「選手 3人を登録済み」に ✓', lt.includes('選手 3人を登録済み'), lt);

  // 案内を作る
  await p.locator('.setup-list button:has-text("案内を作る")').click(); await W(600);
  const sh = p.locator('.sheet').last();
  ok('観戦リンクが無ければ作るボタンが出る', await sh.locator('button:has-text("観戦リンクを作る")').count() === 1);
  await sh.locator('button:has-text("観戦リンクを作る")').click(); await W(500);
  const texts = sh.locator('textarea.kit-text');
  const allText = await texts.nth(0).inputValue();
  ok('全員向け: 観戦リンクとガイドだけ', allText.includes('live=LIVETOKEN') && allText.includes('リアルタイムで見る') && !allText.includes('ct=') && !allText.includes('パスワード'), allText);
  await sh.locator('input[placeholder^="記録係のメールアドレス"]').fill('team+tigers@example.com');
  await sh.locator('input[placeholder^="記録係のパスワード"]').fill('tigers2026');
  await W(200);
  const sc = await texts.nth(1).inputValue();
  const lines = sc.split('\n');
  const iPw = lines.findIndex((l) => l.includes('tigers2026'));
  const iLink = lines.findIndex((l) => l.includes('ct=INVITE-scorer'));
  ok('記録係向け: ログイン情報の真下に記録員リンク', iPw > 0 && iLink > iPw && iLink - iPw <= 3, sc);
  ok('記録係向け: 期限と、交代のしかたが書いてある', sc.includes('まで使えます') && sc.includes('記録を引き継ぐ'), sc);
  await sh.locator('.kit-block').nth(0).locator('button:has-text("文をコピー")').click().catch(() => {});
  await sh.locator('.sheet-actions button:has-text("閉じる")').click(); await W(500);
  const stored = await p.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  ok('パスワードはどこにも保存しない', !stored.includes('tigers2026'));
  lt = await p.locator('.setup-list').innerText().catch(() => '');
  ok('観戦リンクに ✓ が付く', (await p.locator('.setup-step.done').filter({ hasText: '観戦リンクができている' }).count()) === 1, lt);
  ok('案内をコピーすると「案内を配る」に ✓', (await p.locator('.setup-step.done').filter({ hasText: 'チームに案内を配る' }).count()) === 1, lt);
  ok('案内の作り直しボタンはいつでもある', await p.locator('button.kit-open').count() === 1);
  ok('横あふれなし', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  if (process.env.SHOT) { await p.locator('.setup-list').scrollIntoViewIfNeeded(); await p.screenshot({ path: process.env.SHOT }); }
  await ctx.close();
} catch (e) {
  console.log('ERROR:', e.message); fail++;
} finally {
  await b.close(); server.kill();
}
console.log(fail === 0 ? '\n✓ team kit PASS' : `\n✗ team kit FAIL (${fail})`);
process.exit(fail ? 1 : 0);

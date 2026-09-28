// アプリ版(iOS)の音声入力の配線テスト。
//
// ネイティブ側(Capacitor のブリッジと音声認識プラグイン)を偽物に差し替え、
// アプリのコードは本物の @capacitor/core を通ってプラグインを呼ぶ。確かめること:
//   - WKWebView が露出する webkitSpeechRecognition は使わない(動かないので)
//   - OSの認識器を ja-JP で起動する
//   - iOS は自分で止まらないので、途中結果が止まったらアプリ側で止めて確定する
//   - 常時モードで、確定した発話が記録まで届き、次のセッションが始まる
// 偽プラグインの振る舞いは、プラグインの iOS 実装を読んで合わせてある
// (stop すると確定結果を出さずに stopped を出す)。実マイク・実機は使わない。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4188;
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
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(URL_)).ok) return; } catch { /* 起動待ち */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('preview server did not start');
};

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok' : 'NG'} - ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) failures++;
};

await waitUp();
const browser = await chromium.launch({ executablePath: resolveChromium() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  page.on('pageerror', (err) => { console.log('PAGE EXCEPTION:', err.message); failures++; });

  await page.addInitScript(() => {
    // WKWebView は動かない webkitSpeechRecognition を露出している。使われたら数える
    window.__webSR = 0;
    window.webkitSpeechRecognition = class { constructor() { window.__webSR += 1; } start() {} stop() {} abort() {} };

    // Capacitor の iOS ブリッジがあるように見せる(core はこれで platform=ios と判断する)
    window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    const methods = ['available', 'start', 'stop', 'forceStop', 'checkPermissions', 'requestPermissions',
      'getLastPartialResult', 'isListening', 'addListener', 'removeListener', 'removeAllListeners']
      .map((name) => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' }));
    const listeners = {};
    const sp = { starts: [], stops: 0, session: 0, running: false };
    window.__sp = sp;
    const emit = (name, data) => (listeners[name] || []).forEach((cb) => cb(data));
    window.__spEmit = emit;
    window.Capacitor = {
      // App は戻るボタンの購読だけ(nativeBridge.js)
      PluginHeaders: [{ name: 'SpeechRecognition', methods },
        { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] }],
      nativeCallback(plugin, method, options, cb) {
        if (plugin === 'SpeechRecognition' && method === 'addListener') {
          (listeners[options.eventName] ||= []).push(cb);
        }
        return String(Math.random());
      },
      async nativePromise(plugin, method, options) {
        if (plugin === 'App') return {};
        if (plugin !== 'SpeechRecognition') throw new Error('not implemented');
        switch (method) {
          case 'checkPermissions':
          case 'requestPermissions':
            return { speechRecognition: 'granted' };
          case 'start':
            if (sp.running) throw new Error('Speech recognition is already running.');
            sp.running = true;
            sp.session += 1;
            sp.starts.push(options);
            emit('listeningState', { state: 'startingListening', sessionId: sp.session, reason: 'userStart' });
            emit('listeningState', { state: 'started', sessionId: sp.session, reason: 'userStart', status: 'started' });
            return {};
          case 'stop':
          case 'forceStop':
            sp.stops += 1;
            if (sp.running) {
              sp.running = false;
              emit('listeningState', { state: 'stoppingListening', sessionId: sp.session, reason: 'userStop' });
              emit('listeningState', { state: 'stopped', sessionId: sp.session, reason: 'userStop', status: 'stopped' });
            }
            return {};
          default:
            return {};
        }
      },
    };
    // 話した内容を途中結果として流す(iOS は1語ずつ伸びていく)
    window.__say = (text) => emit('partialResults', { matches: [text] });
  });

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  check('アプリ版として動いている', await page.evaluate(() => window.Capacitor.isNativePlatform?.() === true));

  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  for (const [i, nm] of ['青木', '井上', '上田', '江口', '大野', '加藤', '木村', '工藤', '小林'].entries()) {
    await page.fill('.add-form input[placeholder="選手名"]', nm);
    await page.fill('.add-form input[placeholder="背番号"]', String(i + 1));
    await page.click('.add-form button.primary');
    await page.waitForTimeout(120);
  }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', 'アプリ音声');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(500);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(500); }
  await page.click('button:has-text("登録選手から打順を自動セット")').catch(() => {});
  await page.waitForTimeout(700);

  const contBtn = page.locator('button:has-text("常時")').first();
  check('音声ボタンが使える状態になっている', await contBtn.isEnabled());
  await contBtn.click();
  await page.waitForTimeout(600);

  const sp1 = await page.evaluate(() => ({ ...window.__sp }));
  check('OSの認識器が起動する', sp1.starts.length === 1, JSON.stringify(sp1));
  check('日本語で起動する', sp1.starts[0]?.language === 'ja-JP', JSON.stringify(sp1.starts[0]));
  check('WKWebView の webkitSpeechRecognition は使わない', (await page.evaluate(() => window.__webSR)) === 0);

  // 話す → 途中結果が画面に出る
  await page.evaluate(() => window.__say('ログ、フォア'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__say('ログ、フォアボール'));
  await page.waitForTimeout(300);
  check('聞き取り中の文字が画面に出る', (await page.locator('body').innerText()).includes('フォアボール'));

  // 黙る → アプリ側で止めて確定 → 常時モードの取り消し待ち(2.5秒)を経て記録
  await page.waitForTimeout(1500);
  const sp2 = await page.evaluate(() => ({ ...window.__sp }));
  check('黙ったらアプリ側で認識を止める', sp2.stops >= 1, JSON.stringify(sp2));
  await page.waitForTimeout(3200);
  check('四球が記録されて走者が出る', (await page.locator('.base.b1.occupied').count()) === 1,
    (await page.locator('body').innerText()).slice(0, 300));

  const sp3 = await page.evaluate(() => ({ ...window.__sp }));
  check('次の発話のために聞き直している', sp3.starts.length >= 2 && sp3.running, JSON.stringify({ starts: sp3.starts.length, running: sp3.running }));

  // 常時モードを止めたら、OS側も止まる
  await page.click('button:has-text("常時モード終了")');
  await page.waitForTimeout(600);
  const sp4 = await page.evaluate(() => ({ ...window.__sp }));
  check('常時モードを止めるとOSの認識も止まる', sp4.running === false, JSON.stringify({ running: sp4.running }));

  console.log(failures === 0 ? '\n✓ native voice wiring PASS' : `\n✗ native voice wiring FAIL (${failures})`);
} catch (e) {
  console.log('ERROR:', e.message);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
process.exit(failures ? 1 : 0);

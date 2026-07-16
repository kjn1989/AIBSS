// 音声入力(常時リスニング)の配線テスト: SpeechRecognitionをモックして
//  - 非iOS環境では continuous=true でセッション維持すること
//  - 認識テキスト(interim)がUIに流れること
//  - セッションが切れたら自動で再起動すること
// を検証する。実マイク・実音声は使わない。
// 実行: npm run test:e2e (golden の後に実行される)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4174;
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (err) => { console.log('PAGE EXCEPTION:', err.message); failures++; });

  // アプリ読み込み前にSpeechRecognitionをモック化
  await page.addInitScript(() => {
    window.__srInstances = [];
    window.__srStarts = 0;
    class MockSR {
      start() { window.__srStarts += 1; }
      stop() { this.onend && this.onend(); }
      abort() { this.onend && this.onend(); }
      constructor() { window.__srInstances.push(this); }
    }
    window.SpeechRecognition = MockSR;
    window.webkitSpeechRecognition = MockSR;
    window.__srEmitInterim = (text) => {
      const r = window.__srInstances.at(-1);
      const item = [{ transcript: text }];
      item.isFinal = false;
      r?.onresult?.({ resultIndex: 0, results: [item] });
    };
    window.__srEnd = () => window.__srInstances.at(-1)?.onend?.();
  });

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // 試合を開始して常時リスニングを起動
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', '音声テスト');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("常時")');
  await page.waitForTimeout(400);

  const starts1 = await page.evaluate(() => window.__srStarts);
  check('常時ONで認識セッションが開始される', starts1 >= 1, `starts=${starts1}`);

  const continuous = await page.evaluate(() => window.__srInstances.at(-1)?.continuous);
  check('非iOS環境では continuous=true でセッション維持', continuous === true, `actual=${continuous}`);

  // 認識テキスト(interim)がUIへ流れる
  await page.evaluate(() => window.__srEmitInterim('センター前ヒット(テスト)'));
  await page.waitForTimeout(300);
  const body = await page.locator('body').innerText();
  check('認識中テキストが画面に表示される', body.includes('センター前ヒット(テスト)'));

  // セッションが切れたら自動再起動する
  await page.evaluate(() => window.__srEnd());
  await page.waitForTimeout(400);
  const starts2 = await page.evaluate(() => window.__srStarts);
  check('セッション終了後に自動で再起動する', starts2 > starts1, `before=${starts1} after=${starts2}`);

  console.log(failures === 0 ? '\n✓ voice wiring PASS' : `\n✗ voice wiring FAIL (${failures})`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);

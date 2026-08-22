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
// 画面が落ちていないか。エラー境界が例外を握るので pageerror では拾えず、
// 「要素が見つからない」という別の顔で出てくる。原因が読めるように名指しする。
let pageRef = null;
const crashGuard = async (where) => {
  if (!pageRef) return false;
  if (await pageRef.locator('.crash').count()) {
    check(`画面が落ちていない (${where})`, false, await pageRef.locator('.crash').innerText());
    return true;
  }
  return false;
};

const browser = await chromium.launch({ executablePath: resolveChromium() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pageRef = page;
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
    // 確定した発話。常時モードの本処理はこちらを通る
    window.__srEmitFinal = (text) => {
      const r = window.__srInstances.at(-1);
      const item = [{ transcript: text }];
      item.isFinal = true;
      r?.onresult?.({ resultIndex: 0, results: [item] });
    };
  });

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // 打席を記録するには打順が要る。オーダーはデモ選手からは組めないので実在の選手を登録する
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  for (const [i, nm] of ['青木', '井上', '上田', '江口', '大野', '加藤', '木村', '工藤', '小林'].entries()) {
    await page.fill('.add-form input[placeholder="選手名"]', nm);
    await page.fill('.add-form input[placeholder="背番号"]', String(i + 1));
    await page.click('.add-form button.primary');
    await page.waitForTimeout(120);
  }

  // 試合を開始して常時リスニングを起動
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', '音声テスト');
  await page.click('button:has-text("試合開始")');
  // 試合開始は「今日のメンバー」を必ず通る。登録選手が全員来るとは限らないので、
  // 誰が来ているかを決めてから試合が始まる(既定は前回の参加者、初回は全員)
  await page.waitForTimeout(500);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) {
    await page.click('.sheet-actions button.primary');
    await page.waitForTimeout(500);
  }
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

  // ---- 確認カードで「はい」と言ったら進む ----
  // 打順が無いと打席を記録できないので、先に組む
  await page.click('nav button:has-text("オーダー")');
  await page.waitForTimeout(600);
  const auto = page.locator('button:has-text("登録順に9人選択")');
  if (await auto.count()) {
    await auto.click(); await page.waitForTimeout(400);
    await page.click('button:has-text("次へ")'); await page.waitForTimeout(400);
    await page.click('button:has-text("次へ")').catch(() => {});
    await page.waitForTimeout(400);
    await page.click('button:has-text("このオーダーで確定")').catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(700);
  // タブを往復したので、常時モードが続いているかを見てから始める
  const contOn = async () => (await page.locator('body').innerText()).includes('常時リスニング中');
  if (!(await contOn())) { await page.click('button:has-text("常時")'); await page.waitForTimeout(600); }
  check('常時モードが動いている', await contOn(), (await page.locator('body').innerText()).slice(0, 300));

  // 走者を1人出してから、走者確認の出るヒットを言う
  // 常時モードは 2.5秒の取り消し待ちを挟んでから確定する。走者が出るのはそのあと
  await page.evaluate(() => window.__srEmitFinal('ログ、フォアボール'));
  await page.waitForTimeout(3200);
  const onBase = await page.locator('.base.b1.occupied').count();
  check('四球で走者が出る', onBase === 1, (await page.locator('body').innerText()).slice(0, 300));
  await page.evaluate(() => window.__srEmitFinal('ログ、センター前ヒット'));
  await page.waitForTimeout(1500);
  const card = page.locator('.confirm-card');
  const bodyNow = async () => (await page.locator('body').innerText()).replace(/\n+/g, ' ');
  const hasCard = (await card.count()) > 0;
  check('走者ありのヒットで確認カードが出る', hasCard, (await bodyNow()).slice(0, 500));
  const q = hasCard ? await card.innerText() : '';
  check('中堅ヒットとして解釈されている', q.includes('中堅'), q.slice(0, 300) || (await bodyNow()).slice(0, 500));

  // 「はい、センター」= 念押し。方向の修正として扱うと、すでに中堅なので
  // 何も変わらないまま確定もされず、何度言い直しても進まなくなる
  const before = await bodyNow();
  await page.evaluate(() => window.__srEmitFinal('ログ、はい、センター'));
  await page.waitForTimeout(3200);
  check('「はい、センター」で確定して確認カードが閉じる',
    (await page.locator('.confirm-card').count()) === 0,
    (await page.locator('.confirm-card').innerText().catch(() => '')).slice(0, 300));
  const after = await bodyNow();
  check('打席が記録されている', after !== before && /安/.test(after), after.slice(0, 300));

  // ---- ウェイクワードが無い発話は、無視した理由を出す ----
  await page.evaluate(() => window.__srEmitFinal('ログ、センター前ヒット'));
  await page.waitForTimeout(1500);
  if (await page.locator('.confirm-card').count()) {
    await page.evaluate(() => window.__srEmitFinal('はい'));
    await page.waitForTimeout(900);
    const warn = await page.locator('.confirm-card .warn-box').innerText().catch(() => '');
    check('ウェイクワードなしは理由を出す', warn.includes('ログ'), warn || '(warn-box なし)');
    check('カードは開いたまま', (await page.locator('.confirm-card').count()) > 0);
  } else {
    check('2打席目も確認カードが出る', false, (await bodyNow()).slice(0, 300));
  }

  console.log(failures === 0 ? '\n✓ voice wiring PASS' : `\n✗ voice wiring FAIL (${failures})`);

} catch (e) {
  // 要素が見つからない失敗は、たいてい画面が落ちている。
  // エラー境界が例外を握るので pageerror では拾えず、原因が読めなくなる
  await crashGuard('例外時').catch(() => {});
  console.log('EXCEPTION:', e && e.message);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
process.exit(failures === 0 ? 0 : 1);

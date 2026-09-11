// 英語表示の総点検 e2e
//
// 守りたいこと: 英語に切り替えたとき、画面に日本語が出ないこと。
// 静的な検査(scripts/check-i18n.mjs)は辞書の整合とキーの実在しか見られない。
// 「辞書を通さず直接書いた日本語」と「未定義キーがキー名のまま出ている」のは
// 実際に描画して初めて分かるので、ここで実物を見る。
//
// デモデータの選手名・チーム名は日本語のままで正しい(記録された通りの名前)ので除く。
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
const PORT = 4219;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch { /* 起動待ち */ } await new Promise((r) => setTimeout(r, 500)); }

let failures = 0;
const check = (n, c, d = '') => { console.log(`${c ? 'ok' : 'NG'} - ${n}${c ? '' : ` :: ${d}`}`); if (!c) failures++; };
const browser = await chromium.launch({ executablePath: resolveChromium() });

// 描画エラーはErrorBoundaryに飲まれて「ロケータのタイムアウト」にしか見えないので、受け皿を直接見張る
const crashGuard = async (page, where) => {
  if (await page.locator('.crash').count()) {
    check(`画面が落ちていない (${where})`, false, (await page.locator('.crash').innerText()).slice(0, 200));
    return true;
  }
  return false;
};

const JA = /[぀-ヿ一-龯]/;
// 対象外にするもの:
//  - デモデータの選手名・チーム名(記録された通りの名前なので日本語で正しい)
//  - 言語切替ボタン自身の「日本語」(日本語話者が見つけるために必要)
const ALLOWED = /佐藤|鈴木|高橋|田中|伊藤|渡辺|山本|中村|小林|加藤|吉田|山田|グリーンホークス|ブルーウェーブス|レッドスターズ|マイチーム|^日本語$/;
// 顔写真が無いときに出る名前の頭文字1文字も、訳す対象ではない
const isInitial = (s) => s.trim().length === 1;

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // テキスト・placeholder・aria-label・title を、見えている要素だけ集める
  const visibleText = (scope) => page.evaluate((sel) => {
    const roots = sel ? [...document.querySelectorAll(sel)] : [document.body];
    const seen = new Set();
    const out = [];
    const walk = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          const t = n.textContent.trim();
          if (t && !seen.has(t)) { seen.add(t); out.push(t); }
        } else if (n.nodeType === 1) {
          const st = getComputedStyle(n);
          if (st.display === 'none' || st.visibility === 'hidden') continue;
          for (const a of ['placeholder', 'aria-label', 'title']) {
            const v = n.getAttribute?.(a);
            if (v && !seen.has(v)) { seen.add(v); out.push(v); }
          }
          walk(n);
        }
      }
    };
    for (const r of roots) if (r) walk(r);
    return out;
  }, scope);

  const scan = async (label, scope = null) => {
    await page.waitForTimeout(400);
    if (await crashGuard(page, label)) return;
    const lines = await visibleText(scope);
    const ja = lines.filter((l) => JA.test(l) && !ALLOWED.test(l) && !isInitial(l));
    check(`${label}: 日本語が出ていない`, ja.length === 0, JSON.stringify(ja.slice(0, 5)));
    // 未定義キーは translate() がキー名をそのまま返す。namespace.name の形だけが出ていたら取りこぼし
    const keyish = lines.filter((l) => /^[a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z0-9_.]*$/.test(l.trim()));
    check(`${label}: 辞書キーが素で出ていない`, keyish.length === 0, JSON.stringify(keyish.slice(0, 5)));
  };

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  // デモデータを入れてから英語へ
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(900); }
  const en = page.locator('button:has-text("English")').first();
  check('言語切替に English がある', (await en.count()) === 1);
  await en.click();
  await page.waitForTimeout(900);

  // 文書そのものの言語表示(タブの名前・スクリーンリーダー・ホーム画面の名前)
  check('html lang が en になる', (await page.evaluate(() => document.documentElement.lang)) === 'en');
  const title = await page.title();
  check('タイトルが英語になる', !JA.test(title), title);
  const mf = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href'));
  check('manifest が英語版に差し替わる', mf === './manifest.en.webmanifest', String(mf));

  await scan('設定タブ');

  // 5つのタブすべて
  const tabCount = await page.locator('.tabbar button').count();
  check('タブが5つある', tabCount === 5, String(tabCount));
  for (let i = 0; i < tabCount; i++) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);
    await page.locator('.tabbar button').nth(i).click();
    await scan(`タブ${i + 1}`);
  }

  // 成績 → 選手ページ → AI選手名鑑(t()を一度も通っていなかった画面)
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.locator('.tabbar button').nth(3).click();
  await page.waitForTimeout(600);
  const rows = page.locator('tr[role="button"]');
  check('成績の表に選手の行がある', (await rows.count()) > 0);
  await rows.first().click();
  await page.waitForTimeout(900);
  await scan('選手ページ', '.fullscreen-view');

  const prof = page.locator('button').filter({ hasText: 'Profile' }).first();
  check('選手ページに名鑑ボタンがある', (await prof.count()) === 1);
  await prof.click();
  await page.waitForTimeout(1100);
  // 名鑑は選手ページの上に重なるので、最後のポータルだけを見る
  const scoutText = await page.evaluate(() => {
    const vs = [...document.querySelectorAll('.fullscreen-view')];
    return vs.length ? vs[vs.length - 1].innerText : '';
  });
  const scoutJa = scoutText.split('\n').map((l) => l.trim())
    .filter((l) => l && JA.test(l) && !ALLOWED.test(l) && !isInitial(l));
  check('AI選手名鑑: 日本語が出ていない', scoutJa.length === 0, JSON.stringify(scoutJa.slice(0, 5)));
  check('AI選手名鑑: 英語のタグ語彙になっている', scoutText.includes('Power hitter'), scoutText.slice(0, 160));
  check('AI選手名鑑: 記録員カードのキーと衝突していない', !scoutText.includes('Scorer’s read'), scoutText.slice(0, 120));

  check('描画中の例外なし', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('例外なく完走', false, e.message);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\n✓ english PASS' : `\n✗ english FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

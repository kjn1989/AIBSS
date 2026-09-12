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
// 顔写真が無いときに出る名前の頭文字1文字は、訳す対象ではない。
// ただし守備位置は内部コードが1文字('投'等)なので、これを頭文字と一緒に
// 見逃すと「英語画面に漢字のポジションボタンが並ぶ」のを永久に検出できない。
const POS_CODE = /^[投捕一二三遊左中右打控]$/;
const isInitial = (s) => s.trim().length === 1 && !POS_CODE.test(s.trim());

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
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

  // ---- 言語の決まり方 ----
  // 以前は言語がチーム単位だったので、チームを増やした瞬間に日本語へ戻っていた。
  // 端末に1つ持つ形になったので、プロフィールをまたいでも英語のままであること。
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  check('端末に言語が保存されている', (await page.evaluate(() => localStorage.getItem('bbscorer.lang'))) === 'en');

  await page.click('button[aria-label="Settings"]');
  await page.waitForTimeout(500);
  const addBtn = page.locator('button:has-text("Add a team")').first();
  check('チームを追加するボタンがある', (await addBtn.count()) === 1);
  if (await addBtn.count()) {
    await addBtn.click();
    await page.waitForTimeout(400);
    const nameInput = page.locator('.card').filter({ has: page.locator('button:has-text("Add & switch")') })
      .locator('input').first();
    await nameInput.fill('Manila Test');
    await page.locator('button:has-text("Add & switch")').first().click();
    await page.waitForTimeout(1800);
    check('チームを増やしても英語のまま', (await page.evaluate(() => document.documentElement.lang)) === 'en',
      `html lang=${await page.evaluate(() => document.documentElement.lang)}`);
    await scan('チーム追加後');
  }

  // ---- 共有リンクが運ぶ言語(C) ----
  // 招待・観戦リンクを受け取るのは、まだ何の設定も持っていない端末。
  // 日本語の端末であっても、リンクに載った言語で開くこと。
  const jaCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const fromLink = await jaCtx.newPage();
  await fromLink.goto(`${URL_}?lang=en`, { waitUntil: 'load' });
  await fromLink.waitForTimeout(1000);
  check('?lang=en は日本語の端末でも英語で開く',
    (await fromLink.evaluate(() => document.documentElement.lang)) === 'en');
  check('リンクの言語が端末に残る',
    (await fromLink.evaluate(() => localStorage.getItem('bbscorer.lang'))) === 'en');
  const linkTabs = await fromLink.evaluate(() => [...document.querySelectorAll('.tabbar button')].map((b) => b.innerText.trim()).join(' '));
  check('リンクから開いた画面のタブが英語', !JA.test(linkTabs), linkTabs);
  await jaCtx.close();

  // ---- 端末の言語からの推定(B1) ----
  // 何も設定が無い初回だけ効く。日本語が無ければ英語に倒す
  const phCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-PH' });
  const ph = await phCtx.newPage();
  await ph.goto(URL_, { waitUntil: 'load' });
  await ph.waitForTimeout(1000);
  check('英語圏の端末は初回から英語で開く', (await ph.evaluate(() => document.documentElement.lang)) === 'en',
    `html lang=${await ph.evaluate(() => document.documentElement.lang)}`);
  const phTabs = await ph.evaluate(() => [...document.querySelectorAll('.tabbar button')].map((b) => b.innerText.trim()).join(' '));
  check('英語圏の端末はタブも英語', !JA.test(phTabs), phTabs);

  // 回数の確認。既定(7回制)のまま黙って始まらないよう、日本語以外の端末には
  // ホームで1回だけ出す。押すまで出続け、押したら消えることまで見る。
  const region = ph.locator('.region-setup');
  check('英語圏の端末には回数の確認が出る', await region.count() > 0);
  if (await region.count()) {
    const txt = await region.innerText();
    check('回数の確認が英語で出ている', !JA.test(txt), txt.slice(0, 80));
    await region.getByRole('button').first().click(); // 9回制にする
    await ph.waitForTimeout(500);
    check('選ぶと確認は消える', await ph.locator('.region-setup').count() === 0);
    await ph.reload({ waitUntil: 'load' });
    await ph.waitForTimeout(800);
    check('選んだあとは再訪しても出ない', await ph.locator('.region-setup').count() === 0);
  }
  await phCtx.close();

  // 日本語の端末には出さない(既定がそのまま正しいので、ただの邪魔になる)
  {
    const jaHome = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
    const jh = await jaHome.newPage();
    await jh.goto(URL_, { waitUntil: 'load' });
    await jh.waitForTimeout(900);
    check('日本語の端末には回数の確認を出さない', await jh.locator('.region-setup').count() === 0);
    await jaHome.close();
  }

  const jpCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const jp = await jpCtx.newPage();
  await jp.goto(URL_, { waitUntil: 'load' });
  await jp.waitForTimeout(1000);
  check('日本語の端末は初回から日本語で開く', (await jp.evaluate(() => document.documentElement.lang)) === 'ja');
  await jpCtx.close();

  // ---- 試合の導線(ここを開いていなかったので漏れていた) ----
  // 上でチームを増やしているので、この状態のまま続けると選手が0人のチームに当たる。
  // 汚れていないページで、デモを入れてから英語にして辿る。
  {
    const g = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
    g.on('dialog', (d) => d.accept());
    const gscan = async (label) => {
      await g.waitForTimeout(400);
      if (await g.locator('.crash').count()) {
        check(`画面が落ちていない (${label})`, false, (await g.locator('.crash').innerText()).slice(0, 200));
        return;
      }
      const lines = (await g.locator('body').innerText()).split('\n').map((x) => x.trim()).filter(Boolean);
      const ja = lines.filter((l) => JA.test(l) && !ALLOWED.test(l) && !isInitial(l));
      check(`${label}: 日本語が出ていない`, ja.length === 0, JSON.stringify(ja.slice(0, 5)));
    };

    await g.goto(URL_, { waitUntil: 'load' });
    await g.waitForTimeout(900);
    await g.click('button[aria-label="設定"]');
    await g.waitForTimeout(400);
    const demo2 = g.locator('button:has-text("デモデータを投入")');
    if (await demo2.count()) { await demo2.click(); await g.waitForTimeout(800); }
    await g.locator('button:has-text("English")').first().click();
    await g.waitForTimeout(900);

    // 既定のチーム名は「マイチーム」。英語では最初に変えるものなので、変えてから見る
    const teamBox = g.locator('input').first();
    if (await teamBox.count()) { await teamBox.fill('Manila Stars'); await g.waitForTimeout(400); }
    await g.locator('.tabbar button').nth(1).click();
    await g.waitForTimeout(700);
    await gscan('試合作成の画面');
    await g.locator('input[placeholder="Opponent name"]').first().fill('Manila Bay');
    await g.locator('button:has-text("Start Game")').last().click();
    await g.waitForTimeout(1100);
    await gscan('今日のメンバー');
    const go = g.locator('button:has-text("Start with these")').first();
    check('「今日のメンバー」の確定が英語で出ている', (await go.count()) > 0);
    if (await go.count()) { await go.click(); await g.waitForTimeout(1200); }
    await gscan('スコア入力(試合中)');

    const auto = g.locator('button:has-text("Auto-set lineup from players")').first();
    check('オーダーの自動セットが英語で出ている', (await auto.count()) > 0);
    if (await auto.count()) { await auto.click(); await g.waitForTimeout(1000); }

    // 守備位置が入っていないと、打球の守備欄に選手が出ない
    await g.locator('.tabbar button').nth(2).click();
    await g.waitForTimeout(800);
    await g.evaluate(() => {
      const want = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右'];
      [...document.querySelectorAll('.card .row select')].forEach((sel, i) => {
        if (!want[i]) return;
        sel.value = want[i];
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await g.waitForTimeout(700);
    await gscan('オーダー(試合中)');

    await g.locator('.tabbar button').nth(1).click();
    await g.waitForTimeout(900);
    const pad2 = g.locator('.result-pad button:not([disabled])').first();
    check('打撃結果のパッドが押せる', (await pad2.count()) > 0);
    if (await pad2.count()) {
      await pad2.click();
      await g.waitForTimeout(500);
      const coach = g.locator('.pad-coach button');
      if (await coach.count()) { await coach.click(); await g.waitForTimeout(200); }
      const spot = g.locator('.field-pad button.field-pos').first();
      if (await spot.count()) { await spot.click(); await g.waitForTimeout(800); }
      // 位置ボタンは「失策」等を選んだときだけ出る
      const errBtn = g.locator('button:has-text("Error")').last();
      if (await errBtn.count()) { await errBtn.click(); await g.waitForTimeout(600); }
      await gscan('打席の確定シート(失策の入力中)');
      // 守備位置ボタンは英語表記(P/C/1B…)のはず。漢字なら gscan が拾うが、
      // 「そもそも出ていない」と区別できないので実在も確かめる
      const posBtns = await g.locator('.pe-pos button').allInnerTexts().catch(() => []);
      check('打席シートに守備位置のボタンが出ている', posBtns.length > 0, String(posBtns.length));
      check('打席シートの守備位置が英語表記', posBtns.length > 0 && posBtns.every((x) => !JA.test(x)),
        JSON.stringify(posBtns.slice(0, 9)));

      // 確定してプレイログを出す。ログの文は保存時に日本語で焼かれているので、
      // ここが英語で出るかどうかが「表示時に組み直す」の実地確認になる
      const ok = g.locator('.sheet-actions button.primary').last();
      if (await ok.count()) { await ok.click(); await g.waitForTimeout(1200); }
      await gscan('打席を記録した後のスコア入力(プレイログを含む)');
      const logLines = await g.locator('.log-line, .pc-text').allInnerTexts().catch(() => []);
      check('プレイログが1行以上出ている', logLines.length > 0, String(logLines.length));
      // 選手名は訳す対象ではない(デモの名簿は日本語のまま)。他のスキャンと同じ扱いにする
      const jaInLogs = logLines.filter((x) => JA.test(x) && !ALLOWED.test(x));
      check('プレイログが英語で出ている', logLines.length > 0 && jaInLogs.length === 0,
        JSON.stringify(jaInLogs.slice(0, 4)));
    }
    await g.close();
  }

  check('描画中の例外なし', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('例外なく完走', false, e.message);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\n✓ english PASS' : `\n✗ english FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

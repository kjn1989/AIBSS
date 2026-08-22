// 試合ルールe2e: タイブレーク・守備人数・全員打ちを試合前と試合中に決める
// 実行: npm run test:e2e
// 守りたいこと:
//  - 試合前にも試合中にも決められる(草野球では当日その場で変わる)
//  - 「何回から」が2種類あるが混ざらない
//    変更を効かせる回 / タイブレークが始まる回
//  - 宣言した回より前の記録には効かない(履歴にその回が残る)
//  - 9人でないのが正しい試合では、記録ではなくルールを直す道がある
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4177;
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
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(URL_)).ok) break; } catch { /* まだ起動中 */ }
  await new Promise((r) => setTimeout(r, 500));
}

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok' : 'not ok'} - ${name}${cond ? '' : ` :: ${detail}`}`);
  if (!cond) failures++;
};

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

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(400); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);

  // ============================================================
  // 試合前に決める
  // ============================================================
  await page.fill('input[placeholder="対戦相手名"]', 'ルール確認');
  const openBtn = page.locator('button:has-text("ルールを決める（タイブレーク等）")');
  check('入口の名前が3か所で共通', (await page.locator('button:has-text("ルールを決める")').count()) === 1);
  check('試合前にルールを決める入口がある', (await openBtn.count()) === 1);
  await openBtn.click();
  await page.waitForTimeout(500);

  const sheet = () => page.locator('.sheet').last();
  check('ルールシートが開く', (await page.locator('.sheet:has-text("試合ルール")').count()) >= 1);
  // 試合前は「変更を効かせる回」を出さない(1回からに決まっているので選ばせる意味がない)
  check('試合前は効かせる回を聞かない',
    !(await sheet().innerText()).includes('この変更を何回から効かせるか'));

  // 並び: タイブレーク → 全員打ち → 守備の人数(いちばん下)
  // 前書きに3つとも名前が出るので、本文ではなく見出しの並びで見る
  let txt = await sheet().innerText();
  const titles = (await page.locator('.sheet .section-title').allInnerTexts()).map((x) => x.trim());
  check('カードの並びが タイブレーク→全員打ち→守備の人数',
    JSON.stringify(titles) === JSON.stringify(['タイブレーク', '全員打ち', '守備の人数']),
    JSON.stringify(titles));

  // --- 守備の人数 ---
  await page.locator('.sheet button:has-text("8人")').first().click();
  await page.waitForTimeout(300);
  txt = await sheet().innerText();
  check('8人にすると効き方の説明が変わる', txt.includes('1つ空いた'), txt.slice(0, 200));
  check('サマリに守備8人が出る', /守備の人数 8人/.test(txt), txt.slice(-400));

  // --- タイブレーク ---
  await page.click('.sheet .lr-sw[aria-label="タイブレークを使う"]');
  await page.waitForTimeout(350);
  txt = await sheet().innerText();
  check('タイブレークの詳細が開く', txt.includes('タイブレークを始める回'));
  check('走者の既定は一・二塁', /タイブレーク \d+回から／ノーアウト一・二塁/.test(txt), txt.slice(-400));
  check('アウトカウントを選べる', txt.includes('アウトカウント') && txt.includes('ワンアウト'));
  check('満塁が選べる', txt.includes('満塁'));
  check('自責点にならない理由が書いてある',
    txt.includes('投手が打たれて出した走者ではない') && txt.includes('失点には入ります'), txt.slice(0, 600));
  // 見出しが重複していないこと(「何回から」が2つあると、どちらを触ったか分からなくなる)
  const heads = await page.locator('.sheet .section-title, .sheet label').allInnerTexts();
  const dupHeads = heads.filter((h, i) => h.trim() && heads.indexOf(h) !== i);
  check('同じ見出しが2つ無い', dupHeads.length === 0, dupHeads.join(', '));

  // 選択ボタンの見た目: 数が多くて折り返すので、上下が緩いと選択肢だけで画面が埋まる。
  // 押せる大きさは保ちつつ詰める(28〜34px)。
  const chipBox = await page.evaluate(() => {
    const out = { tall: [], tiny: [], clipped: [] };
    document.querySelectorAll('.sheet .chips-row button').forEach((e) => {
      const r = e.getBoundingClientRect();
      const label = e.textContent.trim();
      if (r.height > 34) out.tall.push(`${label}:${Math.round(r.height)}`);
      if (r.height < 28) out.tiny.push(`${label}:${Math.round(r.height)}`);
      if (e.scrollWidth > e.clientWidth + 1) out.clipped.push(label);
    });
    return out;
  });
  check('選択ボタンの上下が詰まっている', chipBox.tall.length === 0, chipBox.tall.join(', '));
  check('選択ボタンが小さすぎない', chipBox.tiny.length === 0, chipBox.tiny.join(', '));
  check('選択ボタンの文字が切れていない', chipBox.clipped.length === 0, chipBox.clipped.join(', '));

  // 1アウト満塁(中学・一部アマチュア)にする
  await page.click('.sheet button:has-text("ワンアウト")');
  await page.waitForTimeout(200);
  await page.click('.sheet button:has-text("満塁")');
  await page.waitForTimeout(250);
  txt = await sheet().innerText();
  check('1アウト満塁がサマリに出る', /ワンアウト満塁/.test(txt), txt.slice(-400));
  check('満塁は3点まで自責点から外れると出る', /最大3点/.test(txt), txt.slice(0, 900));

  // --- 全員打ち ---
  await page.click('.sheet .lr-sw[aria-label="全員打ちにする"]');
  await page.waitForTimeout(350);
  txt = await sheet().innerText();
  check('全員打ちの詳細が開く', txt.includes('打順の人数'));
  check('全員打ちは18人まで選べる', txt.includes('18人'), txt.slice(0, 900));
  await page.click('.sheet button:has-text("12人")');
  await page.waitForTimeout(250);
  txt = await sheet().innerText();
  check('全員打ち12人がサマリに出る', /全員打ち 12人打順/.test(txt), txt.slice(-400));
  // ここでは切っておく。試合中に入れて打順が伸びるかを後で見る
  await page.click('.sheet .lr-sw[aria-label="全員打ちにする"]');
  await page.waitForTimeout(300);

  await page.click('.sheet .sheet-actions button.primary');
  await page.waitForTimeout(500);
  check('ルールシートが閉じる', (await page.locator('.sheet:has-text("試合ルール")').count()) === 0);
  const setupTxt = await page.locator('.card').first().innerText();
  check('決めた内容が試合前の画面に出る', /守備の人数 8人/.test(setupTxt), setupTxt.slice(0, 400));

  // ============================================================
  // 試合を始めて、試合中に変える
  // ============================================================
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(600);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(600); }
  await page.waitForTimeout(400);
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(400); }

  // 1打席だけ記録して、シートを開けるようにする
  await page.click('.result-pad button:has-text("四球")');
  await page.waitForTimeout(300);
  await page.click('.sheet-actions button:has-text("確定")');
  await page.waitForTimeout(500);

  // 入力している最中に「人が帰った」が起きるので、スコア入力画面からも開ける
  const fromScore = page.locator('button:has-text("ルールを決める（タイブレーク等）")');
  check('スコア入力画面からも開ける', (await fromScore.count()) >= 1);
  await fromScore.first().click();
  await page.waitForTimeout(500);
  check('入力画面から開いたシートは試合中の形', (await sheet().innerText()).includes('この変更を何回から効かせるか'));
  await page.click('.sheet .sheet-actions button.ghost');
  await page.waitForTimeout(400);

  await page.click('nav button:has-text("試合結果")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("スコアシートを開く")');
  await page.waitForTimeout(700);
  await page.click('.ss-editbtn');
  await page.waitForTimeout(400);

  const openMid = page.locator('.ss-edithint button:has-text("ルールを決める（タイブレーク等）")');
  check('修正モードからルールを開ける', (await openMid.count()) === 1);
  await openMid.click();
  await page.waitForTimeout(500);

  txt = await sheet().innerText();
  check('試合中は効かせる回を聞く', txt.includes('この変更を何回から効かせるか'));
  check('効かせる回とタイブレークの回を分けて説明している', txt.includes('何回から始まるか'));
  check('試合前に決めた守備8人が引き継がれている', /守備の人数 8人/.test(txt), txt.slice(-500));

  // 守備を9人に戻す(人が戻ってきた)
  const scope = page.locator('.sheet .chips-row').first();
  check('効かせる回が選べる', (await scope.locator('button').count()) >= 2);
  await page.locator('.sheet button:has-text("9人")').first().click();
  await page.waitForTimeout(300);
  txt = await sheet().innerText();
  check('9人に戻すとふつうの説明になる', txt.includes('ふつうの9人守備'), txt.slice(0, 400));

  await page.click('.sheet .sheet-actions button.primary');
  await page.waitForTimeout(600);
  check('変更後にシートが閉じる', (await page.locator('.sheet:has-text("試合ルール")').count()) === 0);

  // --- 履歴に残っているか ---
  await openMid.click();
  await page.waitForTimeout(500);
  txt = await sheet().innerText();
  check('ルール変更の履歴が残る', txt.includes('この試合のルール変更'), txt.slice(-500));
  check('履歴に何回からかが出る', /\d+回から/.test(txt));
  check('履歴の中身が読める', txt.includes('9人に戻した'), txt.slice(-500));

  // 変えずに保存しても履歴は増えない
  const rowsBefore = await page.locator('.lr-histrow').count();
  await page.click('.sheet .sheet-actions button.primary');
  await page.waitForTimeout(400);
  txt = await sheet().innerText();
  check('変えていないときは何も起きない', txt.includes('変えたところがありません'), txt.slice(-300));
  check('履歴が増えない', (await page.locator('.lr-histrow').count()) === rowsBefore);

  // 履歴は消せる(間違えて入れた宣言を取り消せないと詰む)
  await page.locator('.lr-histrow button').first().click();
  await page.waitForTimeout(400);
  check('履歴を消せる', (await page.locator('.lr-histrow').count()) === rowsBefore - 1);

  await page.click('.sheet .sheet-actions button.ghost');
  await page.waitForTimeout(400);
  // スコアシートは全画面なので、閉じないとタブを押せない
  await page.click('.fullscreen-header button:has-text("戻る")');
  await page.waitForTimeout(500);

  // ============================================================
  // 全員打ちにしたら、打順がその人数になる
  // 「18人にしたのに9人しか打者が居ない」= 宣言が打順に効いていなかった
  // ============================================================
  await page.click('nav button:has-text("オーダー")');
  await page.waitForTimeout(600);
  const orderRows = () => page.locator('.card .row .rank-badge');
  const before = await orderRows().count();
  check('宣言前の打順は9人', before === 9, `n=${before}`);

  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(500);
  await page.locator('button:has-text("ルールを決める（タイブレーク等）")').first().click();
  await page.waitForTimeout(600);
  await page.click('.sheet .lr-sw[aria-label="全員打ちにする"]');
  await page.waitForTimeout(400);
  await page.locator('.sheet button:has-text("12人")').first().click();
  await page.waitForTimeout(350);
  txt = await sheet().innerText();
  check('何人足すのかを先に言う', /打順の後ろに足します/.test(txt), txt.slice(0, 1200));
  await page.click('.sheet .sheet-actions button.primary');
  await page.waitForTimeout(800);

  await page.click('nav button:has-text("オーダー")');
  await page.waitForTimeout(700);
  const after = await orderRows().count();
  check('全員打ち12人にすると打順が12人になる', after === 12, `n=${after}`);
  const badges = await orderRows().allInnerTexts();
  check('打順が1から通しで振られている',
    JSON.stringify(badges.map(Number)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    JSON.stringify(badges));
  // 足した人は守備に就かない打者
  const opts = await page.locator('.card .row select').nth(11).inputValue();
  check('足した打者は「打」', opts === '打', `pos=${opts}`);
  // 足りているので案内は出ない
  check('足りていれば案内は出ない', !(await page.locator('body').innerText()).includes('足りていません'));

  // ============================================================
  // タイブレークは「走者を置いて始める回」
  // 宣言しただけで誰も置かれないと、画面はふつうの回のままで、
  // ルールが何も起きていないのと同じになる
  // ============================================================
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(500);
  await page.locator('button:has-text("ルールを決める（タイブレーク等）")').first().click();
  await page.waitForTimeout(600);
  // 試合前に入れたままのことも、切ってあることもある。入っている状態にそろえる
  const tbSw = page.locator('.sheet .lr-sw[aria-label="タイブレークを使う"]');
  if ((await tbSw.getAttribute('aria-pressed')) !== 'true') { await tbSw.click(); await page.waitForTimeout(400); }
  // いま進んでいる回からタイブレークにする(延長に入ってからその場で決めるのが実際の使い方)
  await page.locator('.sheet .chips-row[aria-label="この変更を何回から効かせるか"] button').first().click();
  await page.waitForTimeout(200);
  await page.locator('.sheet .chips-row[aria-label="タイブレークを始める回"] button').first().click();
  await page.waitForTimeout(200);
  await page.locator('.sheet .chips-row[aria-label="アウトカウント"] button:has-text("ノーアウト")').click();
  await page.waitForTimeout(200);
  await page.locator('.sheet .chips-row[aria-label="走者をどこに置くか"] button:has-text("一・二塁")').click();
  await page.waitForTimeout(250);
  await page.click('.sheet .sheet-actions button.primary');
  await page.waitForTimeout(800);

  // 攻守が入れ替われば、その半回の頭で置かれる
  page.once('dialog', (d) => d.accept());
  await page.click('button:has-text("手動チェンジ")');
  await page.waitForTimeout(900);
  check('タイブレークの回は一塁に走者が置かれる', (await page.locator('.base.b1.occupied').count()) >= 1);
  check('タイブレークの回は二塁に走者が置かれる', (await page.locator('.base.b2.occupied').count()) >= 1);
  check('三塁には置かれない(一・二塁を選んだので)', (await page.locator('.base.b3.occupied').count()) === 0);

  // --- 横はみ出しがない ---
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('横はみ出しなし', !over);

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

console.log(failures === 0 ? '\n✓ rules PASS' : `\n✗ rules FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

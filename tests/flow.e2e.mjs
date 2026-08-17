// 試合の流れ e2e: 勝率の線・線分スコアの重ね合わせ・打席の読み取り
// 実行: npm run test:e2e
// 守りたいこと:
//  - 縦軸は勝率(0〜100%)で、50%が互角の線として出ている
//  - 線分スコアの列が、線の回の区切りとぴったり重なっている
//    (等分にすると「5回の列の下が線の5回ではない」表になる)
//  - 打席を押すと、その打席の前と後の勝率が両方読める
//    (差だけだと、その概念を知らない人には何のことか分からない)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;
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

const browser = await chromium.launch({ executablePath: resolveChromium() });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (err) => { console.log('PAGE EXCEPTION:', err.message); failures++; });
  page.on('dialog', (d) => d.accept()); // 手動チェンジの確認

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('button[aria-label="設定"]');
  await page.waitForTimeout(400);
  const demo = page.locator('button:has-text("デモデータを投入")');
  if (await demo.count()) { await demo.click(); await page.waitForTimeout(400); }
  await page.click('nav button:has-text("スコア入力")');
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="対戦相手名"]', '流れ確認');
  await page.click('button:has-text("試合開始")');
  await page.waitForTimeout(600);
  const att = page.locator('.sheet').filter({ hasText: '今日のメンバー' });
  if (await att.count()) { await page.click('.sheet-actions button.primary'); await page.waitForTimeout(600); }
  const autoSet = page.locator('button:has-text("登録選手から打順を自動セット")');
  if (await autoSet.count()) { await autoSet.click(); await page.waitForTimeout(400); }

  const play = async (label) => {
    const btn = page.locator(`.result-pad button:has-text("${label}")`).first();
    if (!(await btn.isEnabled().catch(() => false))) return false;
    await btn.click();
    await page.waitForTimeout(300);
    const coach = page.locator('.pad-coach button');
    if (await coach.count()) { await coach.click(); await page.waitForTimeout(150); }
    const f = page.locator('.field-pad button.field-pos').first();
    if (await f.count()) { await f.click(); await page.waitForTimeout(550); }
    const ok = page.locator('.sheet-actions button:has-text("確定")');
    if (await ok.count()) { await ok.click(); await page.waitForTimeout(400); }
    return true;
  };
  const change = async () => { await page.click('button:has-text("手動チェンジ")'); await page.waitForTimeout(600); };

  // 打席数の違う回を作る(回ごとに列幅が変わることを見たいので、あえて数を変える)
  for (const l of ['ヒット', 'ヒット', 'ヒット', 'ホームラン', '凡打', '凡打', '凡打']) await play(l);
  await change();
  for (const l of ['凡打', '凡打', '凡打']) await play(l);
  await change();
  for (const l of ['ヒット', 'ヒット', '凡打', '凡打', '凡打']) await play(l);
  await change();

  await page.click('button:has-text("試合の流れを見る")');
  await page.waitForTimeout(900);
  const sheet = page.locator('.sheet').last();
  check('流れシートが開く', (await sheet.innerText()).includes('試合の流れ'));

  // --- 縦軸は勝率 ---
  const chartTxt = await page.locator('.fv-chart').innerText();
  check('縦軸に100%/50%/0%が出ている',
    chartTxt.includes('100%') && chartTxt.includes('50%') && chartTxt.includes('0%'), chartTxt.slice(0, 200));
  check('勝率だと書いてある', (await sheet.innerText()).includes('勝つ確率'));

  // --- 線分スコアが線と重なっている ---
  const geo = await page.evaluate(() => {
    const svg = document.querySelector('.fv-chart svg');
    const cells = [...document.querySelectorAll('.fvls-row.head .fvls-cell')]
      .map((c) => ({ n: c.textContent, l: c.getBoundingClientRect().left, w: c.getBoundingClientRect().width }));
    // 回の区切りに引いてある縦線(上端から下端まで通っているもの)
    const bounds = [...svg.querySelectorAll('line')]
      .filter((l) => l.getAttribute('y1') === '0' && l.getAttribute('y2') === '132')
      .map((l) => l.getBoundingClientRect().left);
    return { cells, bounds };
  });
  check('線分スコアが回ごとに出ている', geo.cells.length >= 3, `列数=${geo.cells.length}`);
  // 2回目以降の列は、線に引いてある区切りと同じ位置から始まる
  const offBy = geo.cells.slice(1).map((c) => Math.min(...geo.bounds.map((b) => Math.abs(b - c.l))));
  check('列の左端が線の回の区切りと一致する',
    offBy.every((d) => d < 1.5), `ズレ=${offBy.map((d) => d.toFixed(2)).join(', ')}px`);
  // 打席数が違えば列幅も違う(等分になっていない = 線に合わせている証拠)
  const widths = geo.cells.map((c) => c.w);
  check('打席数の多い回ほど列が広い',
    Math.max(...widths) - Math.min(...widths) > 8, widths.map((w) => w.toFixed(1)).join(', '));

  // --- 回の区切り線が上下でつながっている ---
  const divs = await page.evaluate(() => {
    const svg = document.querySelector('.fv-chart svg');
    const bounds = [...svg.querySelectorAll('line')]
      .filter((l) => l.getAttribute('y1') === '0' && l.getAttribute('y2') === '132')
      .map((l) => l.getBoundingClientRect().left);
    // 表の区切りは、セルの左境界線(border-left)の位置 = セルの左端
    const cells = [...document.querySelectorAll('.fvls-row:not(.head) .fvls-cell')].slice(1);
    const borders = cells
      .filter((c) => getComputedStyle(c).borderLeftWidth !== '0px')
      .map((c) => c.getBoundingClientRect().left);
    return { bounds, borders };
  });
  check('表にも回の区切り線が引かれている', divs.borders.length > 0, JSON.stringify(divs));
  const lineGap = divs.borders.map((x) => Math.min(...divs.bounds.map((b) => Math.abs(b - x))));
  check('表の区切り線がグラフの区切りと同じ位置',
    lineGap.every((d) => d < 1.5), `ズレ=${lineGap.map((d) => d.toFixed(2)).join(', ')}px`);

  // --- 回別の安打数も出る(スコアボードと同じ置き方) ---
  const hits = await page.evaluate(() => {
    const row = document.querySelectorAll('.fvls-row:not(.head)')[0]; // 先攻(この試合では自チーム)
    return [...row.querySelectorAll('.fvls-cell')].map((c) => ({
      run: c.querySelector('b')?.textContent || '',
      hit: (c.querySelector('i')?.textContent || '').trim(),
    }));
  });
  check('回別の安打数が出ている', hits.some((h) => h.hit !== ''), JSON.stringify(hits));
  check('1回は4安打(記録どおり)', hits[0]?.hit === '4', JSON.stringify(hits[0]));
  check('三者凡退の回は安打欄が空', hits[1]?.hit === '', JSON.stringify(hits[1]));
  check('得点と安打が別の数字として出ている', hits[0]?.run === '4' && hits[0]?.hit === '4', JSON.stringify(hits[0]));

  // --- 点差の内訳が勝率と読み違えられない ---
  // すぐ上に「勝率 7%」が並ぶので、この%が何の割合かを見出しと実数で示す
  const leadTxt = await page.locator('.fv-now').innerText();
  check('点差の内訳だと見出しに書いてある', leadTxt.includes('点差の内訳'), leadTxt);
  check('割合に打席数が添えてある', /\d+打席/.test(leadTxt), leadTxt);
  check('勝率とは別だと書いてある', leadTxt.includes('上の勝率とは別'), leadTxt);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.fv-lead > span')]
    .map((x) => ({ pct: x.querySelector('b')?.textContent, pa: x.querySelector('u')?.textContent })));
  check('3つとも割合と打席数の両方が出ている',
    tiles.length === 3 && tiles.every((x) => /%$/.test(x.pct || '') && /打席$/.test(x.pa || '')),
    JSON.stringify(tiles));

  // --- 打席を押すと前後の勝率が読める ---
  const box = await page.locator('.fv-chart svg').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(400);
  const read = await page.locator('.fv-read').innerText();
  check('押した打席の内容が出る', read.includes('回'), read);
  check('前と後の勝率が両方出ている', (read.match(/\d+%/g) || []).length >= 2, read);
  check('勝率だと分かる言葉が付いている', read.includes('勝率'), read);

  // --- 成績タブに勝利貢献・得点貢献が出る ---
  await page.locator('.sheet button:has-text("閉じる")').last().click();
  await page.waitForTimeout(500);
  await page.click('nav button:has-text("成績")');
  await page.waitForTimeout(1200);
  const cc = page.locator('.card').filter({ has: page.locator('.cc-table, .toggle-row') }).filter({ hasText: '勝利貢献' }).first();
  check('勝利貢献のカードが出る', (await cc.count()) === 1);
  const ccTxt = await cc.innerText();
  check('勝利貢献と得点貢献を並べている',
    ccTxt.includes('勝利貢献') && ccTxt.includes('得点貢献'), ccTxt.slice(0, 200));
  check('WARを出していない理由を書いてある', ccTxt.includes('WAR'), ccTxt.slice(-300));
  const ccRows = await page.evaluate(() => [...document.querySelectorAll('.cc-table tbody tr')]
    .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)));
  check('打者が並んでいる', ccRows.length > 0, JSON.stringify(ccRows));
  check('勝利貢献が大きい順', ccRows.every((r, i) => i === 0
    || parseFloat(String(ccRows[i - 1][1]).replace('−', '-')) >= parseFloat(String(r[1]).replace('−', '-'))),
    JSON.stringify(ccRows.map((r) => r[1])));
  // 投手側に切り替えられる。この試合は守備を記録していないので、
  // 空の表ではなく「記録が無い」と言う(0.00 が並ぶと記録済みに見える)
  await cc.locator('button:has-text("投手")').click();
  await page.waitForTimeout(500);
  const pitTxt = await cc.innerText();
  check('投手側に切り替わる', pitTxt.includes('まだ記録がありません'), pitTxt.slice(0, 300));
  // 同じ列でも打者と投手で意味が反転する。見出しも説明も切り替わっていること
  check('投手側は「防いだ失点」と言い換えている', pitTxt.includes('防いだ失点'), pitTxt.slice(0, 300));
  check('投手側の説明は防御率から入る', pitTxt.includes('防御率'), pitTxt.slice(0, 300));
  check('投手側は0が「場面どおり」だと書いてある', pitTxt.includes('場面どおり'), pitTxt.slice(-500));
  check('切り替えたら打者の表は消えている', (await page.locator('.cc-table tbody tr').count()) === 0);

  // --- 24通りの表の解説が開ける ---
  // 数字の土台になっている表を見せずに値だけ出すと、当たっているか誰も確かめられない
  await cc.locator('button:has-text("打者")').click();
  await page.waitForTimeout(300);
  await cc.locator('button:has-text("期待得点・期待失点とは")').click();
  await page.waitForTimeout(800);
  const ret = page.locator('.sheet:has-text("期待得点・期待失点とは")');
  check('解説シートが開く', (await ret.count()) >= 1);
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll('.ret-table tbody tr')].map((tr) => tr.querySelectorAll('td.num').length));
  check('24通りが並んでいる', cells.length === 8 && cells.every((c) => c === 3),
    `行=${cells.length} 列=${JSON.stringify(cells)}`);
  const retTxt = await ret.innerText();
  check('走者なしから満塁まで全部ある',
    ['走者なし', '一塁', '二塁', '三塁', '一二塁', '一三塁', '二三塁', '満塁'].every((x) => retTxt.includes(x)),
    retTxt.slice(0, 400));
  check('期待得点と期待失点が同じ表だと書いてある', retTxt.includes('同じ表'), retTxt.slice(0, 600));
  check('打席の数え方(式)が書いてある', retTxt.includes('打席前の期待得点'), retTxt.slice(0, 900));
  check('回数を併記している', /\d+回/.test(retTxt), retTxt.slice(0, 400));
  // 走者が進むほど・アウトが少ないほど期待値は高い(表が壊れていないこと)
  const grid = await page.evaluate(() =>
    [...document.querySelectorAll('.ret-table tbody tr')]
      .map((tr) => [...tr.querySelectorAll('td.num b')].map((b) => parseFloat(b.textContent))));
  check('アウトが増えるほど期待値は下がる',
    grid.every((row) => row[0] > row[1] && row[1] > row[2]), JSON.stringify(grid));
  check('走者なしより満塁のほうが高い', grid[7][0] > grid[0][0], JSON.stringify([grid[0][0], grid[7][0]]));
  const retOver = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('解説シートも横あふれなし', !retOver);
  await ret.locator('.sheet-actions button:has-text("閉じる")').click();
  await page.waitForTimeout(500);

  // --- 勝率の作り方も、出どころの札つきで開ける ---
  // 数値は根拠が書いていないと嘘くさくなる。どこが実測でどこが借り物かを言い切ること
  await cc.locator('button:has-text("勝率はどう出している")').click();
  await page.waitForTimeout(800);
  const wes = page.locator('.sheet:has-text("勝率の作り方")');
  check('勝率の解説シートが開く', (await wes.count()) >= 1);
  const weTxt = await wes.innerText();
  check('実測は1段だけだと最初に言っている', weTxt.includes('実測なのは1段だけ'), weTxt.slice(0, 300));
  check('自チームの実測ではないと明言している', weTxt.includes('あなたのチームの実測ではない'), weTxt.slice(0, 1600));
  check('設計上の選択だと明言している', weTxt.includes('設計上の選択'), weTxt.slice(0, 1200));
  check('土台の出どころを名指ししている', weTxt.includes('baseball.piupapp.com'), weTxt.slice(0, 1600));
  check('土台の対象と期間を書いてある', weTxt.includes('NPB') && weTxt.includes('2023'), weTxt.slice(0, 1600));
  check('していないことを並べている', weTxt.includes('この計算がしていないこと'), weTxt.slice(-800));
  check('チーム力を持っていないと書いてある', weTxt.includes('チームの強さも投手の質も持っていない'), weTxt.slice(-800));
  // 出どころの札が実際に付いていること
  const badges = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet .src-badge')].map((b) => b.textContent));
  check('出どころの札が付いている', badges.length >= 5, JSON.stringify(badges));
  check('自チーム実測とNPB実測の札を区別している',
    badges.some((b) => b.includes('自チーム実測')) && badges.some((b) => b.includes('自チームではない')),
    JSON.stringify(badges));
  // 1点以上入る確率の表が24通り出ている
  const probRows = await page.evaluate(() =>
    [...document.querySelectorAll('.sheet .ret-table tbody tr')].map((tr) => tr.querySelectorAll('td.num').length));
  check('「1点以上入る確率」も24通り出ている',
    probRows.length === 8 && probRows.every((c) => c === 3), JSON.stringify(probRows));
  const weOver = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('勝率の解説も横あふれなし', !weOver);
  await wes.locator('.sheet-actions button:has-text("閉じる")').click();
  await page.waitForTimeout(500);

  // --- 横あふれなし ---
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('横あふれなし', !over);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\n✓ flow PASS' : `\n✗ flow FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);

// スコア入力中の記録修正e2e: 得点だけでなく打席結果も直せる
// 実行: npm run test:e2e
// 守りたいこと:
//  - 修正のやり方を2通り作らない(スコアシートと同じ「回の流れ→その打席を直す」を使う)
//  - 直した結果が試合経過にそのまま出る
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
const PORT = 4199;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
for(let i=0;i<60;i++){try{if((await fetch(URL_)).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
let fail=0; const ok=(n,c,d='')=>{console.log(`${c?'ok':'not ok'} - ${n}${c?'':' :: '+d}`);if(!c)fail++;};
const b=await chromium.launch({executablePath:resolveChromium()});
const p=await b.newPage({viewport:{width:390,height:900}});
p.on('pageerror',e=>{console.log('EXC:',e.message);fail++;});
await p.goto(URL_,{waitUntil:'load'}); await p.waitForTimeout(900);
await p.click('button[aria-label="設定"]'); await p.waitForTimeout(400);
const d=p.locator('button:has-text("デモデータを投入")'); if(await d.count()){await d.click();await p.waitForTimeout(500);}
await p.click('nav button:has-text("スコア入力")'); await p.waitForTimeout(400);
await p.fill('input[placeholder="対戦相手名"]','記録修正');
await p.click('button:has-text("試合開始")'); await p.waitForTimeout(700);
const att=p.locator('.sheet').filter({hasText:'今日のメンバー'});
if(await att.count()){await p.click('.sheet-actions button.primary');await p.waitForTimeout(700);}
const auto=p.locator('button:has-text("登録選手から打順を自動セット")'); if(await auto.count()){await auto.click();await p.waitForTimeout(500);}
// 単打の走者の既定は打球方向で変わる。レフト前の二塁走者は三塁で止まるのが普通
const selDest = () => p.evaluate(() => {
  const btns = [...document.querySelectorAll('.sheet button')]
    .filter((b) => ['そのまま', '三塁へ', '得点', 'アウト'].includes(b.textContent.trim()));
  return btns.filter((b) => b.className.includes('sel')).map((b) => b.textContent.trim());
});
const hitTo = async (label, posName) => {
  await p.locator(`.result-pad button:has-text("${label}")`).first().click(); await p.waitForTimeout(350);
  const c = p.locator('.pad-coach button'); if (await c.count()) { await c.click(); await p.waitForTimeout(150); }
  const pos = p.locator(`.field-pad button.field-pos:has-text("${posName}")`);
  if (await pos.count()) await pos.first().click(); else await p.locator('.field-pad button.field-pos').first().click();
  await p.waitForTimeout(700);
};
// 走者を二塁に置いてから、レフト前ヒット
await hitTo('ツーベース', '中');
await p.locator('.sheet-actions button:has-text("確定")').click(); await p.waitForTimeout(600);
await hitTo('ヒット', '左');
ok('レフト前の二塁走者は三塁が既定', (await selDest()).includes('三塁へ'), JSON.stringify(await selDest()));
await p.locator('.sheet-actions button:has-text("キャンセル")').click(); await p.waitForTimeout(400);
// ライト前なら生還
await hitTo('ヒット', '右');
ok('ライト前の二塁走者は生還が既定', (await selDest()).includes('得点'), JSON.stringify(await selDest()));
await p.locator('.sheet-actions button:has-text("キャンセル")').click(); await p.waitForTimeout(400);


// 打席を1つ作る(ヒット)
await p.click('.result-pad button:has-text("ヒット")'); await p.waitForTimeout(350);
const c=p.locator('.pad-coach button'); if(await c.count()){await c.click();await p.waitForTimeout(150);}
const f=p.locator('.field-pad button.field-pos').first(); if(await f.count()){await f.click();await p.waitForTimeout(600);}
await p.click('.sheet-actions button:has-text("確定")'); await p.waitForTimeout(500);

// 試合操作 → 記録を直す
const btn=p.locator('button:has-text("記録を直す")');
ok('入口が「記録を直す」になっている',(await btn.count())>=1);
await btn.first().click(); await p.waitForTimeout(600);
const sh=()=>p.locator('.sheet').last();
let txt=await sh().innerText();
ok('打席か得点かを選べると書いてある',txt.includes('打席の記録か、得点そのもの'),txt.slice(0,200));
ok('打席を直す入口がある',txt.includes('回の打席を直す'),txt.slice(0,300));
ok('得点の増減も残っている',txt.includes('得点を直接増減する'),txt.slice(0,400));

// 1回を選んで打席を直す
await p.locator('.sheet button:has-text("1回")').first().click(); await p.waitForTimeout(250);
await p.locator('.sheet button:has-text("回の打席を直す")').click(); await p.waitForTimeout(700);
txt=await sh().innerText();
ok('回の流れが開く',/回の流れ/.test(txt),txt.slice(0,150));
const ev=p.locator('.flow-ev');
ok('打席が並んでいる',(await ev.count())>=1,String(await ev.count()));
const before=await ev.first().innerText();
await ev.first().click(); await p.waitForTimeout(300);
ok('この打席を直すが出る',(await p.locator('.flow-box button:has-text("この打席を直す")').count())===1);
await p.locator('.flow-box button:has-text("この打席を直す")').click(); await p.waitForTimeout(700);
txt=await sh().innerText();
ok('打席の編集が開く',/回/.test(txt)&&(await p.locator('.sheet button:has-text("三振")').count())>=1,txt.slice(0,200));
// 三振に変えて保存
await p.locator('.sheet button:has-text("三振")').first().click(); await p.waitForTimeout(400);
const save=p.locator('.sheet-actions button.primary');
await save.last().click(); await p.waitForTimeout(800);
ok('シートが閉じる',(await p.locator('.sheet').count())===0,String(await p.locator('.sheet').count()));
// 直った結果が試合経過に出るか
const prog=await p.locator('.log-line').allInnerTexts();
ok('直した結果が反映される',prog.join(' ').includes('三振'),prog.join(' | ').slice(0,200));
// ラインスコア: 終わった半回は0点でも数字を出す(空欄のままだと「表の得点が出ない」に見える)
// 三振3つで表を終わらせ、裏に移った時点で表の欄に0が出ることを見る
const play = async (label) => {
  const btn = p.locator(`.result-pad button:has-text("${label}")`);
  if (!(await btn.count()) || !(await btn.first().isEnabled().catch(() => false))) return false;
  await btn.first().click(); await p.waitForTimeout(300);
  const o = p.locator('.sheet-actions button:has-text("確定")');
  if (await o.count()) { await o.click(); await p.waitForTimeout(450); }
  return true;
};
const lineCells = () => p.evaluate(() => {
  const rows = [...document.querySelectorAll('tr')].filter((r) => r.querySelector('td.ini'));
  return rows.map((r) => [...r.querySelectorAll('td.inn')].map((td) => td.querySelector('.rn')?.textContent.trim() ?? ''));
});
for (let i = 0; i < 6; i++) { if (!(await play('三振'))) break; }
await p.waitForTimeout(500);
const cells = await lineCells();
const body = await p.locator('body').innerText();
const inBottom = /\d+回裏/.test(body);
ok('裏に移っている', inBottom, body.slice(0, 60));
if (inBottom) {
  ok('無得点で終わった表が0と出る', cells[0]?.[0] === '0', JSON.stringify(cells));
  ok('進行中の裏はまだ空欄', cells[1]?.[0] === '', JSON.stringify(cells));
}

ok('横あふれなし',!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
await b.close(); server.kill();
console.log(fail===0?'\n✓ fixplay PASS':`\n✗ fixplay FAIL (${fail})`);
process.exit(fail?1:0);

// 相手の控え登録e2e: 記号を選ばせず、名前を入れれば済むこと
// 実行: npm run test:e2e
// 守りたいこと:
//  - 交代の前に控えを名前で登録できる(記号は自動で割り当てる)
//  - 交代シートでは、登録した控えが名前で、先に出る
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
const PORT = 4205;
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
await p.fill('input[placeholder="対戦相手名"]','控え登録');
await p.click('button:has-text("試合開始")'); await p.waitForTimeout(700);
const att=p.locator('.sheet').filter({hasText:'今日のメンバー'});
if(await att.count()){await p.click('.sheet-actions button.primary');await p.waitForTimeout(700);}
const auto=p.locator('button:has-text("登録選手から打順を自動セット")'); if(await auto.count()){await auto.click();await p.waitForTimeout(500);}

await p.click('nav button:has-text("オーダー")'); await p.waitForTimeout(700);
await p.locator('[role="tab"]:has-text("控え登録"), button:has-text("控え登録")').last().click(); await p.waitForTimeout(600);
const txt=await p.locator('body').innerText();
ok('控え選手の欄がある', txt.includes('控え選手'), txt.slice(0,300));
ok('記号を自動で割り当てると書いてある', txt.includes('自動で割り当てます'));

// 名前を入れて追加(記号は選ばない)
const inp=p.locator('input[placeholder="控えの名前"]');
ok('名前だけ入れる欄がある',(await inp.count())===1);
await inp.fill('新井'); await p.locator('button:has-text("追加")').click(); await p.waitForTimeout(500);
await inp.fill('小池'); await p.locator('button:has-text("追加")').click(); await p.waitForTimeout(500);
const bench=await p.locator('.opp-bench .row').allInnerTexts();
ok('控えに2人入る', bench.length===2, JSON.stringify(bench));
ok('入力欄が空に戻る', (await inp.inputValue())==='', await inp.inputValue());
ok('記号が自動で付く', /J/.test(bench[0])&&/K/.test(bench[1]), JSON.stringify(bench));

// 交代シートで名前が選べる
await p.locator('.card .row button:has-text("交代")').first().click(); await p.waitForTimeout(600);
const opts=await p.locator('.sheet select option').allInnerTexts();
const groups=await p.locator('.sheet select optgroup').evaluateAll(gs=>gs.map(g=>g.label));
ok('控えのまとまりがある', groups.includes('控え選手'), JSON.stringify(groups));
ok('名前で選べる', opts.some(o=>o.includes('新井')), JSON.stringify(opts.slice(0,6)));
ok('先頭に控えが来る', opts.findIndex(o=>o.includes('新井')) < opts.findIndex(o=>/^L$|^M$/.test(o.trim())), JSON.stringify(opts.slice(0,8)));
await p.locator('.sheet-actions button:has-text("キャンセル")').click().catch(()=>{}); await p.waitForTimeout(300);

// 控えから外せる
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.click('nav button:has-text("オーダー")'); await p.waitForTimeout(500);
const del=p.locator('.opp-bench .row button:has-text("削除")').first();
if(await del.count()){ await del.click(); await p.waitForTimeout(500); }
ok('控えから外せる',(await p.locator('.opp-bench .row').count())===1,String(await p.locator('.opp-bench .row').count()));
ok('横あふれなし',!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
await b.close(); server.kill();
console.log(fail===0?'\n✓ oppbench PASS':`\n✗ oppbench FAIL (${fail})`);
process.exit(fail?1:0);

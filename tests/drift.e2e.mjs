// 打者ずれe2e: 画面の打者と記録が食い違ったら気づけること
// 実行: npm run test:e2e
// 守りたいこと:
//  - ずれたら、いまの打者とあるべき打者を名前で出す
//  - その場で1タップで合わせられ、スコアは壊れない
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
const PORT = 4207;
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
await p.fill('input[placeholder="対戦相手名"]','打者ずれ');
await p.click('button:has-text("試合開始")'); await p.waitForTimeout(700);
const att=p.locator('.sheet').filter({hasText:'今日のメンバー'});
if(await att.count()){await p.click('.sheet-actions button.primary');await p.waitForTimeout(700);}
const auto=p.locator('button:has-text("登録選手から打順を自動セット")'); if(await auto.count()){await auto.click();await p.waitForTimeout(500);}
const play=async(l)=>{const btn=p.locator(`.result-pad button:has-text("${l}")`);
 if(!(await btn.count())||!(await btn.first().isEnabled().catch(()=>false)))return false;
 await btn.first().click(); await p.waitForTimeout(300);
 const o=p.locator('.sheet-actions button:has-text("確定")'); if(await o.count()){await o.click();await p.waitForTimeout(450);} return true;};
await play('四球'); await play('四球');
ok('ふつうに記録している間は警告が出ない', !/アプリの打者と記録がずれています/.test(await p.locator('body').innerText()));

// 打者変更で1人ずらす(記録より先に進める) = 実際に起きた事故の形
await p.locator('button:has-text("打者変更")').first().click(); await p.waitForTimeout(600);
const rows=p.locator('.sheet .row');
const n=await rows.count();
// いま選ばれている行の1つ先を選ぶ
let curIdx=-1;
for(let i=0;i<n;i++){ if((await rows.nth(i).innerText()).includes('打席中')) curIdx=i; }
const target=(curIdx>=0?curIdx+1:3)%n;
await rows.nth(target).locator('button').last().click(); await p.waitForTimeout(700);

const body=await p.locator('body').innerText();
ok('ずれたら警告が出る', /アプリの打者と記録がずれています/.test(body), body.slice(0,400));
ok('いま表示している打者を書いている', /いま \d+番/.test(body), (body.match(/.{0,80}いま.{0,60}/)||[''])[0]);
ok('あるべき打者を書いている', /記録のとおりなら \d+番/.test(body));
const fixBtn=p.locator('button:has-text("に合わせる")');
ok('その場で直せるボタンがある',(await fixBtn.count())>=1);
await fixBtn.first().click(); await p.waitForTimeout(600);
ok('直したら警告が消える', !/アプリの打者と記録がずれています/.test(await p.locator('body').innerText()));
// スコアが壊れていないこと
const sc=await p.evaluate(()=>{const r=[...document.querySelectorAll('td.rc.rv')].map(e=>e.textContent.trim());return r.slice(0,2);});
ok('スコアは変わらない', sc.every(x=>/^\d+$/.test(x)), JSON.stringify(sc));
ok('横あふれなし',!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));
await b.close(); server.kill();
console.log(fail===0?'\n✓ drift PASS':`\n✗ drift FAIL (${fail})`);
process.exit(fail?1:0);

// 第11段階: ルールエンジン(規定回数終了・コールド・球数・時間制限の提案) + AI-BASEブランド表示
import { chromium } from 'playwright-core';
import { timeLimitCheck, gameEndCheck, initialPresetIdFor } from '../src/lib/rules.js';

// ---- エディション整合(記憶プリセットが他エディションへ漏れない) ----
console.log('整合 学童記憶→草野球:', initialPresetIdFor('gakudo6', '草野球'), '(kusa7期待)');
console.log('整合 草野球記憶→草野球:', initialPresetIdFor('kusa7', '草野球'), '(kusa7期待)');
console.log('整合 custom記憶は尊重:', initialPresetIdFor('custom', '草野球'), '(custom期待)');
console.log('整合 記憶なし→少年野球:', initialPresetIdFor(null, '少年野球'), '(gakudo6期待)');

// ---- 純関数の単体チェック(時間制限・X勝ち) ----
const past = Date.now() - 95 * 60000;
const t1 = timeLimitCheck({ rules: { timeLimitMin: 90 }, startedAt: past, status: 'ongoing' });
console.log('timeLimit 95分経過/90分制限:', t1 ? `limit=${t1.limit} elapsed=${t1.elapsedMin}` : 'null(NG)');
console.log('timeLimit 制限なし:', timeLimitCheck({ rules: { timeLimitMin: null }, startedAt: past, status: 'ongoing' }) === null ? 'null(OK)' : 'NG');
const xwin = gameEndCheck({ rules: { innings: 7, mercy: [] }, status: 'ongoing', inning: 7, isTop: false, isHome: true, myScore: 5, oppScore: 3, outs: 1 });
console.log('X勝ち判定(7回裏・後攻リード):', xwin?.type === 'xwin' ? 'OK' : `NG(${JSON.stringify(xwin)})`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('dialog', (d) => d.accept());

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// ---- ブランド表示 ----
console.log('title:', await page.title());
console.log('brand team info:', (await page.textContent('.header-team')).replace(/\s+/g, ' ').trim());

// 選手登録
await page.click('button[aria-label="設定"]');
for (const name of ['青木', '木村']) {
  await page.fill('input[placeholder="選手名"]', name);
  await page.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
}

// ---- シナリオ1: カスタムルール(1回制・コールド1回3点差・球数制限11球) ----
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'ルールズ');
await page.selectOption('select', 'custom');
await page.fill('.grid3 input >> nth=0', '1'); // 回数=1
await page.fill('.grid3 input >> nth=1', '1'); // コールド回=1
await page.fill('.grid3 input >> nth=2', '3'); // 点差=3
await page.fill('input[placeholder="例: 70"]', '11'); // 球数制限11(警告は1球から)
console.log('rules desc:', (await page.textContent('.card:has(h2:has-text("新しい試合を開始")) p.small.dim')).split('\n')[0].trim());
await page.click('text=試合開始');
await page.waitForTimeout(300);

// 回数制表示
console.log('scoreboard sub:', (await page.textContent('.scoreboard .mid .small.dim')).trim());

// 打順セット
await page.click('text=登録選手から打順を自動セット');
await page.waitForTimeout(200);

// 1回表: 3点入れる(スコア修正で+3) → コールド条件は「1回終了以降」なのでまだ出ない
await page.click('text=スコア修正');
await page.waitForTimeout(200);
for (let i = 0; i < 3; i++) await page.click('.sheet .stepper button:has-text("＋") >> nth=0');
await page.click('.sheet button:has-text("閉じる")');
await page.waitForTimeout(200);
console.log('banner before change (none expected):', await page.locator('text=コールドゲームの条件').count());

// 手動チェンジ → 1回裏(後攻=相手の攻撃…自チーム先攻なので守備)
await page.click('text=手動チェンジ');
await page.waitForTimeout(300);

// 守備時の球数警告: 投手選択 → 1球投げると警告(warnAt=1)
await page.selectOption('.card select', { label: '青木' });
await page.waitForTimeout(200);
await page.click('button:has-text("ボール")');
await page.waitForTimeout(200);
console.log('pitch warn shown:', (await page.locator('text=球数制限').count()) > 0);

// 1回裏終了(手動チェンジ) → 2回表開始時点で「1回終了・3点差」→ 規定1回終了の提案(コールドより規定回数優先)
await page.click('text=手動チェンジ');
await page.waitForTimeout(300);
const bannerText = await page.textContent('.card:has(button:has-text("試合を終了する")) p');
console.log('end banner:', bannerText.trim());

// 「このまま続行」で消え、スコアが動くと再表示されないことは仕様(同一状況のみ抑制)
await page.click('text=このまま続行');
await page.waitForTimeout(200);
console.log('banner dismissed:', (await page.locator('button:has-text("試合を終了する")').count()) === 0);

// ---- シナリオ2: 学童プリセットで開始→ルール説明が表示される ----
await page.click('text=試合終了'); // 現在の試合を終了(ハイライトが開く)
await page.waitForTimeout(300);
await page.reload({ waitUntil: 'networkidle' }); // 終了済みなのでリロードでGameSetupに戻る
await page.click('.tabbar button:has-text("スコア入力")');
await page.waitForTimeout(300);
await page.selectOption('select', 'gakudo6');
console.log('gakudo desc:', (await page.textContent('.card:has(h2:has-text("新しい試合を開始")) p.small.dim')).split('\n')[0].trim());

// ---- シナリオ3: イニング別球数・進行中のルール後変更(UI) ----
await page.reload({ waitUntil: 'networkidle' });
await page.click('button[aria-label="設定"]');
for (const name of ['磯野', '中島']) {
  await page.fill('input[placeholder="選手名"]', name);
  await page.click('.card:has(h2:has-text("選手登録")) button:has-text("追加")');
}
await page.click('.tabbar button:has-text("スコア入力")');
await page.fill('input[placeholder="対戦相手名"]', 'ペース確認');
await page.selectOption('select', 'none'); // ルール管理なしで開始(制限なしメーターの確認)
await page.click('button:has-text("後攻")');
await page.click('text=試合開始');
await page.waitForTimeout(300);
await page.selectOption('.card:has-text("投手") select', { label: '磯野' });
for (let i = 0; i < 6; i++) await page.click('.count-btns .foul'); // 1回に6球
await page.click('.card:has(h2:has-text("試合操作")) button:has-text("手動チェンジ")');
await page.waitForTimeout(120);
await page.click('.card:has(h2:has-text("試合操作")) button:has-text("手動チェンジ")');
await page.waitForTimeout(200);
for (let i = 0; i < 4; i++) await page.click('.count-btns .foul'); // 2回に4球
await page.waitForTimeout(150);
console.log('制限なしメーター:', (await page.textContent('.pitch-meter')).replace(/\s+/g, ' ').trim(), '/ バー非表示?', !(await page.isVisible('.pitch-meter .pm-bar')));
console.log('イニング別チップ:', (await page.textContent('.pitch-innings')).replace(/\s+/g, ' ').trim());

// ---- シナリオ4: 相手投手の球数(打撃時) ----
// 手動チェンジで自軍打撃の裏へ。相手投手Aを選び球数を積む → 相手投手メーターが出る
await page.click('.card:has(h2:has-text("試合操作")) button:has-text("手動チェンジ")');
await page.waitForTimeout(200);
// オーダー未設定なら自動セット(打撃ビューに相手投手カードを出すため)
if (await page.isVisible('button:has-text("登録選手から打順を自動セット")')) {
  await page.click('button:has-text("登録選手から打順を自動セット")');
  await page.waitForTimeout(200);
}
await page.selectOption('.card:has-text("相手投手") select', 'A');
await page.waitForTimeout(150);
for (let i = 0; i < 7; i++) await page.click('.count-btns .foul');
await page.waitForTimeout(150);
console.log('相手投手メーター(主役):', (await page.textContent('.pitch-meter')).replace(/\s+/g, ' ').trim());
// 打撃時も控えの自軍投手(磯野)が帯で見える(オプション①)
console.log('控え帯(自軍投手):', (await page.textContent('.pitch-mini')).replace(/\s+/g, ' ').trim());
// 帯タップで主役が自軍投手に入れ替わる
await page.click('.pitch-mini');
await page.waitForTimeout(150);
console.log('入替後 主役メーター(自軍):', (await page.textContent('.pitch-meter')).replace(/\s+/g, ' ').trim(), '/ 磯野?', /磯野/.test(await page.textContent('.pitch-meter')));
await page.click('.pitch-mini'); // 元に戻す
await page.waitForTimeout(150);
// 相手投手Bに交代 → 独立カウント(3球)
await page.selectOption('.card:has-text("相手投手") select', 'B');
await page.waitForTimeout(150);
for (let i = 0; i < 3; i++) await page.click('.count-btns .foul');
await page.waitForTimeout(150);
console.log('相手投手交代後メーター(独立):', (await page.textContent('.pitch-meter')).replace(/\s+/g, ' ').trim());

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
